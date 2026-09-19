import { computed, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { DEFAULT_PAGE_SIZE, DEFAULT_PREFETCH_PAGES } from '../internal/constants'
import type { RowsRequestEvent, VirtualWindow } from '../types'

/**
 * Pide al consumidor los tramos de `rows` que hacen falta para pintar.
 *
 * ## Qué problema resuelve
 *
 * La tabla ya tenía separadas las dos cosas que el modo servidor necesita
 * separadas: **cuántas filas hay** —que dimensiona la barra de scroll— y **qué
 * hay en el índice `i`** —que decide qué se pinta—. Hasta aquí las dos salían de
 * `props.rows`. Este composable las desacopla: el largo lo dice `rowCount` y el
 * contenido lo dice `rows`, que puede tener huecos.
 *
 * ## La tabla nunca pide datos
 *
 * Aquí no hay `fetch`, ni adapter, ni una sola función asíncrona. Este módulo
 * calcula qué páginas faltan y avisa; el transporte, la caché, los reintentos y
 * la cancelación son del consumidor. Es la misma decisión que hace que `rows`
 * sea controlada para editar: la librería no es dueña de los datos de nadie.
 *
 * ## Por qué los pedidos se alinean a la página
 *
 * Una ventana visible `[137, 162)` NO se pide tal cual: se pide `[100, 150)` y
 * `[150, 200)`. Alineados, la clave de caché del otro lado es `start / pageSize`
 * y dos posiciones de scroll sobre la misma página producen el mismo pedido. Sin
 * alinear, cada píxel de scroll generaría un tramo distinto y solapado, y del
 * otro lado habría que reconstruir a mano qué se pidió ya.
 *
 * ## Cuándo una página deja de estar en vuelo
 *
 * Una página se pide UNA vez y queda marcada. La marca se levanta cuando sus
 * filas aparecen en `rows`, y no antes.
 *
 * La tentación es limpiar todas las marcas cada vez que `rows` cambia de
 * identidad, para que un error de red se reintente solo. No sirve: las páginas
 * llegan de a una, así que la llegada de la 2 volvería a pedir la 3 —que sigue
 * en vuelo— y la 4, y así. Un scroll rápido dispararía decenas de pedidos
 * duplicados contra la base de datos, que es exactamente lo que este módulo
 * existe para evitar.
 *
 * Quedan entonces dos vías explícitas para volver a pedir, y las dos cubren un
 * caso real:
 *
 * 1. **`rows` se acorta por debajo del inicio de la página.** Es el gesto normal
 *    de invalidar —`rows = []` al cambiar un filtro o un orden—, y se detecta
 *    solo.
 * 2. **`refresh()`**, expuesto como `refreshRows()` en la instancia. Es la vía
 *    para reintentar después de un error, y para cualquier invalidación que no
 *    pase por acortar el array.
 */

/** Opciones de {@link useRemoteRows}. */
export interface UseRemoteRowsOptions<TRow> {
  /**
   * `true` cuando el consumidor declaró `rowCount`. Es el único interruptor del
   * módulo: apagado, aquí no corre nada.
   */
  enabled: MaybeRefOrGetter<boolean>
  /**
   * Cuántas filas tiene el dataset entero, ya saneado.
   *
   * Lo calcula el componente y no este módulo, y no es un detalle: es el MISMO
   * número que dimensiona la ventana virtual, y la ventana es una de las
   * entradas de aquí. Calcularlo dos veces abriría la puerta a que las dos cuentas
   * discrepen por un redondeo y se pidan páginas que la tabla nunca pinta.
   */
  total: MaybeRefOrGetter<number>
  /** El dataset, posiblemente con huecos. */
  rows: MaybeRefOrGetter<readonly (TRow | undefined)[]>
  /** Tamaño de página. Se sanea a un entero de al menos 1. */
  pageSize: MaybeRefOrGetter<number | undefined>
  /** Páginas pedidas por adelantado a cada lado de la ventana. */
  prefetchPages: MaybeRefOrGetter<number | undefined>
  /** Ventana vertical que el virtualizador quiere pintar. */
  window: MaybeRefOrGetter<VirtualWindow>
  /** Se invoca una vez por página que hace falta pedir. */
  onRequest: (event: RowsRequestEvent) => void
}

/** Resultado de {@link useRemoteRows}. */
export interface UseRemoteRowsReturn {
  /** Tamaño de página ya saneado. */
  pageSize: ComputedRef<number>
  /**
   * `true` si la fila de ese índice todavía no llegó y hay que pintar un
   * marcador. Fuera del modo servidor devuelve siempre `false`.
   */
  isPlaceholder: (index: number) => boolean
  /**
   * Olvida todas las marcas y vuelve a pedir lo que falte en la ventana actual.
   *
   * Es la vía para reintentar después de un error de red, y para invalidar sin
   * acortar `rows`.
   */
  refresh: () => void
}

/** Entero de al menos `min`, o `fallback` si el valor no sirve. */
function positiveInt(raw: number | undefined, fallback: number, min: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback
  const floored = Math.floor(raw)
  return floored < min ? min : floored
}

export function useRemoteRows<TRow>(options: UseRemoteRowsOptions<TRow>): UseRemoteRowsReturn {
  /**
   * Páginas pedidas cuyas filas todavía no llegaron, y CON QUÉ `rows` se pidió
   * cada una.
   *
   * Guardar la referencia y no solo el número de página es lo que distingue "el
   * consumidor invalidó" de "todavía no contestó". Las dos situaciones se ven
   * igual desde aquí —el lugar sigue vacío—, y sin ese testigo la única regla
   * disponible sería mirar el largo del array: con `rows = []` eso da "se
   * acortó" para TODAS las páginas, en cada barrido, y el mismo pedido saldría
   * una y otra vez mientras la respuesta no llegue.
   *
   * Un `Map` plano y NO reactivo: lo lee y lo escribe solamente el barrido de
   * abajo, y volverlo reactivo haría que cada pedido agendase una reevaluación
   * de todo lo que lo observe, en medio de un scroll.
   */
  const pending = new Map<number, readonly (TRow | undefined)[]>()

  const pageSize = computed(() => positiveInt(toValue(options.pageSize), DEFAULT_PAGE_SIZE, 1))

  const prefetchPages = computed(() =>
    positiveInt(toValue(options.prefetchPages), DEFAULT_PREFETCH_PAGES, 0),
  )

  /**
   * Levanta las marcas que ya no corresponden.
   *
   * Dos motivos, y ninguno es "pasó el tiempo": o las filas llegaron, o `rows`
   * se acortó por debajo del inicio de la página, que es lo que pasa cuando el
   * consumidor invalida con `rows = []`.
   */
  function settle(rows: readonly (TRow | undefined)[], size: number): void {
    if (pending.size === 0) return
    for (const [page, askedWith] of pending) {
      const start = page * size

      // El consumidor reemplazó el array por uno que ni siquiera llega hasta
      // aquí: es el gesto de invalidar, `rows = []` al cambiar un filtro o un
      // orden. La comparación de identidad es imprescindible —sin ella, el mismo
      // `[]` que todavía está esperando respuesta se leería como una
      // invalidación nueva en cada barrido—.
      if (rows !== askedWith && start >= rows.length) {
        pending.delete(page)
        continue
      }

      // Llegó la respuesta. Alcanza con mirar el primer lugar del tramo: que la
      // respuesta haya venido completa o corta es asunto del servidor, no de la
      // tabla, y volver a pedir una página que ya contestó sería un bucle.
      if (rows[start] !== undefined) pending.delete(page)
    }
  }

  /** Recorre las páginas que la ventana necesita y pide las que faltan. */
  function sweep(): void {
    if (!toValue(options.enabled)) return

    const count = toValue(options.total)
    const size = pageSize.value
    const rows = toValue(options.rows)

    settle(rows, size)

    if (count === 0) return

    const view = toValue(options.window)
    const lastPage = Math.ceil(count / size) - 1
    if (lastPage < 0) return

    // La ventana llega vacía antes de la primera medición del viewport. Pedir la
    // primera página igual es lo correcto: es la que se va a necesitar en cuanto
    // haya alto, y esperar un frame más solo agrega latencia visible.
    const firstVisible = Math.min(Math.max(view.start, 0), count - 1)
    const lastVisible = Math.min(Math.max(view.end - 1, firstVisible), count - 1)

    const extra = prefetchPages.value
    const from = Math.max(0, Math.floor(firstVisible / size) - extra)
    const to = Math.min(lastPage, Math.floor(lastVisible / size) + extra)

    for (let page = from; page <= to; page += 1) {
      if (pending.has(page)) continue

      const start = page * size
      if (start < rows.length && rows[start] !== undefined) continue

      const end = Math.min(count, start + size)
      // Se anota con qué `rows` se pidió: es el testigo que `settle` compara
      // para distinguir una invalidación de una respuesta que todavía no llegó.
      pending.set(page, rows)
      options.onRequest({ start, end, page })
    }
  }

  /*
   * `post` y no `pre`: emitir durante el render dejaría al consumidor
   * escribiendo `rows` en medio de la evaluación del árbol que lo lee. Con el
   * flush posterior, el pedido sale con el frame ya pintado —marcadores
   * incluidos— y la respuesta entra por el camino normal de un cambio de prop.
   */
  watch(
    [
      () => toValue(options.enabled),
      () => toValue(options.total),
      pageSize,
      prefetchPages,
      () => toValue(options.rows),
      () => toValue(options.window),
    ],
    sweep,
    { flush: 'post', immediate: true },
  )

  return {
    pageSize,

    isPlaceholder: (index: number) => {
      if (!toValue(options.enabled)) return false
      if (index < 0 || index >= toValue(options.total)) return false
      return toValue(options.rows)[index] === undefined
    },

    refresh: () => {
      pending.clear()
      sweep()
    },
  }
}
