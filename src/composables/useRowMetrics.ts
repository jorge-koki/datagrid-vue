import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { VirtualWindow } from '../types'
import { useVirtualWindow } from './useVirtualWindow'

/**
 * Traducción entre índice de fila y píxel, con alturas que pueden diferir.
 *
 * ## El problema que resuelve
 *
 * Con filas de altura uniforme, las dos preguntas del virtualizador son
 * divisiones: el borde superior de la fila `i` está en `i * alto`, y la fila que
 * ocupa el píxel `y` es `floor(y / alto)`. Es `O(1)` y no depende de cuántas
 * filas haya, que es exactamente lo que hace que 100.000 filas cuesten lo mismo
 * que 100. Ver {@link useVirtualWindow}.
 *
 * En cuanto dos filas pueden medir distinto, esas divisiones dejan de valer y no
 * hay fórmula que las reemplace: la posición de una fila depende de TODAS las de
 * arriba. La única salida es sumarlas una vez y guardar el resultado.
 *
 * ## La técnica, y por qué esta y no otra
 *
 * Un array de offsets acumulados: `offsets[i]` es el píxel donde arranca la fila
 * `i`, y `offsets[count]` es el alto total. Se construye en una pasada, y a
 * partir de ahí preguntar dónde está una fila es leer una posición —`O(1)`— y
 * preguntar qué fila hay en un píxel es una búsqueda binaria —`O(log n)`, 17
 * pasos para 100.000 filas—.
 *
 * Es la misma solución que `useColumnLayout` aplica a las columnas de ancho
 * variable, en el otro eje. Deliberadamente la misma: un segundo mecanismo para
 * el mismo problema sería una segunda cosa que mantener y que puede
 * desincronizarse de la primera.
 *
 * La alternativa considerada fue un árbol de Fenwick, que agrega corregir el
 * alto de una fila suelta en `O(log n)` sin rehacer las de abajo. Acá **no hace
 * falta**: las alturas las declara el consumidor con una función pura, así que
 * nunca cambia una sola —cambia la función, y entonces cambian todas—. Esa
 * estructura solo se paga cuando los altos se MIDEN del DOM, fila por fila y a
 * medida que aparecen, y este componente no mide nada.
 *
 * ## El camino uniforme sigue intacto
 *
 * Sin función de altura, este composable delega en {@link useVirtualWindow} y no
 * reserva un solo byte: la tabla se comporta exactamente igual que antes, con la
 * misma aritmética. La ventana variable es un camino aparte que solo se enciende
 * cuando hay algo variable de verdad —ver {@link RowMetrics.variable}—, de modo
 * que el costo de existir esta función, para quien no la usa, es cero.
 */

/** Opciones de {@link useRowMetrics}. */
export interface UseRowMetricsOptions {
  /** Cantidad de filas VISIBLES: ya aplanadas por la agrupación, si la hay. */
  rowCount: MaybeRefOrGetter<number>
  /**
   * Altura base en px.
   *
   * Es el alto de toda fila cuando no hay función, y el respaldo cuando la hay:
   * lo que se usa si devuelve algo que no sirve. También es el valor que viaja a
   * `--dt-row-height`, así que la hoja de estilos y esta cuenta no pueden
   * discrepar.
   */
  rowHeight: MaybeRefOrGetter<number>
  /**
   * Altura de la fila visible `index`, o `null` para el camino uniforme.
   *
   * Se la llama una vez por fila en cada reconstrucción, así que tiene que ser
   * barata y no puede leer el DOM. Un valor que no sea un número finito y
   * positivo se descarta y se usa {@link UseRowMetricsOptions.rowHeight}.
   */
  heightAt: MaybeRefOrGetter<((index: number) => number) | null>
  /** Alto visible para filas, en px: el del viewport menos el del encabezado. */
  viewportSize: MaybeRefOrGetter<number>
  /** Desplazamiento vertical actual, en px. */
  scrollOffset: MaybeRefOrGetter<number>
  /** Filas extra a cada lado de la ventana. Por defecto 0. */
  overscan?: MaybeRefOrGetter<number>
}

/**
 * La geometría vertical de la tabla, ya resuelta.
 *
 * Es un objeto con métodos y no un par de arrays sueltos porque el camino
 * uniforme no tiene arrays: son dos multiplicaciones. Quien lo consume —el pool,
 * el editor, el recuadro del rango, el teclado— pregunta lo mismo en los dos
 * casos y no necesita saber en cuál está.
 */
export interface RowMetrics {
  /**
   * Si las alturas son variables de verdad.
   *
   * Es la señal que el pool necesita para decidir si escribe el alto de cada
   * fila o deja que lo ponga la hoja de estilos. En `false`, el pintado no toca
   * una sola propiedad de alto, igual que antes de que esto existiera.
   */
  variable: boolean
  /** Cantidad de filas contempladas. */
  count: number
  /** Alto total del contenido en px. Es lo que dimensiona la barra de scroll. */
  totalSize: number
  /**
   * Alto de la fila más baja.
   *
   * Acota cuántas filas pueden entrar a la vez en el viewport, y con eso el
   * tamaño máximo del pool de nodos. Con alturas mezcladas, usar el alto base
   * dejaría el pool corto justo cuando todas las visibles son de las bajas.
   */
  minSize: number
  /** Píxel donde arranca la fila. Fuera de rango se acota a los extremos. */
  offsetOf(index: number): number
  /** Alto de la fila en px. Fuera de rango devuelve el alto base. */
  sizeOf(index: number): number
  /** Índice de la fila que ocupa el píxel `y`. Fuera de rango se acota. */
  indexAt(y: number): number
}

/** Resultado de {@link useRowMetrics}. */
export interface UseRowMetricsReturn {
  /** La geometría vertical. Se reconstruye solo cuando las alturas cambian. */
  metrics: ComputedRef<RowMetrics>
  /** Tramo de filas a pintar. Cambia con el scroll, sin reconstruir nada. */
  window: ComputedRef<VirtualWindow>
  /** Alto total del contenido en px. */
  totalSize: ComputedRef<number>
}

/** Normaliza una cantidad de items a un entero no negativo. */
function normalizeCount(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.floor(raw)
}

/** Normaliza una altura. Un valor no positivo apaga la virtualización. */
function normalizeSize(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return raw
}

/**
 * La geometría cuando todas las filas miden igual.
 *
 * Sin arrays y sin búsquedas: las mismas dos operaciones que hacía el
 * virtualizador antes de que las alturas variables existieran.
 */
function uniformMetrics(count: number, size: number): RowMetrics {
  return {
    variable: false,
    count,
    totalSize: count * size,
    minSize: size,
    offsetOf: (index) => Math.min(Math.max(index, 0), count) * size,
    sizeOf: () => size,
    indexAt: (y) => {
      if (count === 0) return 0
      if (!(y > 0)) return 0
      return Math.min(Math.floor(y / size), count - 1)
    },
  }
}

/**
 * La geometría cuando las filas miden distinto.
 *
 * `offsets` lleva una posición más que filas hay: la última es el alto total, y
 * tenerla ahí hace que `offsets[i + 1] - offsets[i]` valga también para la
 * última fila, sin un caso especial.
 */
function variableMetrics(
  count: number,
  base: number,
  offsets: Float64Array,
  min: number,
): RowMetrics {
  /**
   * Búsqueda binaria del último offset que no pasa de `y`.
   *
   * Busca el mayor `i` con `offsets[i] <= y`, que es la fila que contiene ese
   * píxel. El `+ 1` en el punto medio es lo que hace que el invariante converja
   * hacia arriba en vez de quedarse girando entre dos vecinos.
   */
  function indexAt(y: number): number {
    if (count === 0) return 0
    if (!(y > 0)) return 0
    if (y >= offsets[count]!) return count - 1

    let low = 0
    let high = count - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (offsets[mid]! <= y) low = mid
      else high = mid - 1
    }
    return low
  }

  return {
    variable: true,
    count,
    totalSize: offsets[count]!,
    minSize: min,
    offsetOf: (index) => offsets[Math.min(Math.max(index, 0), count)]!,
    sizeOf: (index) => {
      if (index < 0 || index >= count) return base
      return offsets[index + 1]! - offsets[index]!
    },
    indexAt,
  }
}

/**
 * Calcula la geometría vertical de la tabla y el tramo de filas a pintar.
 *
 * @example
 * ```ts
 * const rows = useRowMetrics({
 *   rowCount: visibleRowCount,
 *   rowHeight,
 *   heightAt: rowHeightAt,
 *   viewportSize: () => rowViewportHeight.value,
 *   scrollOffset: () => scroll.state.value.scrollTop,
 *   overscan: () => props.overscan,
 * })
 * ```
 */
export function useRowMetrics(options: UseRowMetricsOptions): UseRowMetricsReturn {
  /**
   * La geometría.
   *
   * Depende de la cantidad de filas, del alto base y de la función, y de NADA
   * del scroll: esa separación es lo que hace que scrollear no reconstruya los
   * offsets. Un scroll de 1000 frames sobre 100.000 filas no suma una sola
   * pasada.
   */
  const metrics = computed<RowMetrics>(() => {
    const count = normalizeCount(toValue(options.rowCount))
    const base = normalizeSize(toValue(options.rowHeight))
    const heightAt = toValue(options.heightAt)

    if (heightAt === null || count === 0 || base === 0) return uniformMetrics(count, base)

    // Una sola pasada: acumula, y de paso se entera del mínimo y de si la
    // función terminó devolviendo el alto base para todas.
    const offsets = new Float64Array(count + 1)
    let min = Number.POSITIVE_INFINITY
    let allBase = true

    for (let index = 0; index < count; index += 1) {
      const raw = heightAt(index)
      const size = Number.isFinite(raw) && raw > 0 ? raw : base
      offsets[index + 1] = offsets[index]! + size
      if (size < min) min = size
      if (size !== base) allBase = false
    }

    // La función existe pero hoy todas las filas miden lo mismo que la base:
    // `(row) => row.abierta ? 160 : 40` sin ninguna abierta todavía. Se vuelve al
    // camino `O(1)` y el pool deja de escribir alturas.
    //
    // La condición es contra la BASE y no contra "todas iguales entre sí" a
    // propósito: una función que devuelva 60 para todas también es uniforme, pero
    // 60 no es lo que dice `--dt-row-height`, y degradar ahí dejaría la hoja de
    // estilos pintando celdas de 40 dentro de filas de 60.
    if (allBase) return uniformMetrics(count, base)

    return variableMetrics(count, base, offsets, min)
  })

  /**
   * La ventana del camino uniforme, tal cual era.
   *
   * Se delega en lugar de reimplementarla para que el caso que usa todo el mundo
   * no dependa de que dos cuentas parecidas sigan dando lo mismo. Es un
   * `computed`: si la tabla es variable, no se evalúa nunca.
   */
  const uniform = useVirtualWindow({
    // Las opciones CRUDAS, no las de `metrics`: así esta llamada es letra por
    // letra la que había antes, y el camino de siempre no depende de que la
    // normalización nueva coincida con la vieja.
    itemCount: options.rowCount,
    itemSize: options.rowHeight,
    viewportSize: options.viewportSize,
    scrollOffset: options.scrollOffset,
    overscan: options.overscan ?? 0,
  })

  /** La ventana del camino variable: dos búsquedas binarias. */
  const variable = computed<VirtualWindow>(() => {
    const geometry = metrics.value
    const total = geometry.totalSize
    if (geometry.count === 0 || total === 0) return { start: 0, end: 0, offset: 0 }

    const rawViewport = toValue(options.viewportSize)
    const viewportSize = Number.isFinite(rawViewport) && rawViewport > 0 ? rawViewport : 0

    // Mismo acotado que el camino uniforme: el scroll llega negativo durante el
    // rebote elástico de iOS y puede exceder el contenido durante un resize.
    const rawOffset = toValue(options.scrollOffset)
    const maxOffset = Math.max(0, total - viewportSize)
    const scrollOffset = Number.isFinite(rawOffset)
      ? Math.min(Math.max(rawOffset, 0), maxOffset)
      : 0

    const rawOverscan = toValue(options.overscan ?? 0)
    const overscan = Number.isFinite(rawOverscan) && rawOverscan > 0 ? Math.floor(rawOverscan) : 0

    const first = geometry.indexAt(scrollOffset)
    // La fila que ocupa el píxel de abajo del viewport ya ES la última que
    // asoma, así que `+ 1` cierra el tramo y alcanza. El camino uniforme suma
    // uno de más porque `ceil(viewport / alto)` puede quedarse corto cuando el
    // scroll no está alineado; una búsqueda binaria no tiene ese problema.
    //
    // Con el viewport en cero —antes de la primera medición— las dos búsquedas
    // dan la misma fila y se pinta una, que es justo lo que hace el `+ 1` del
    // camino uniforme: algo en pantalla en vez de un parpadeo en blanco.
    const last = geometry.indexAt(scrollOffset + viewportSize)

    const start = Math.max(0, first - overscan)
    const end = Math.min(geometry.count, last + 1 + overscan)

    return {
      start,
      end: Math.max(start, end),
      offset: geometry.offsetOf(start),
    }
  })

  const window = computed<VirtualWindow>(() =>
    metrics.value.variable ? variable.value : uniform.window.value,
  )

  const totalSize = computed(() => metrics.value.totalSize)

  return { metrics, window, totalSize }
}
