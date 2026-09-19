import { computed, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'
import type { CellPosition, CellRange } from '../types'
import type { ResolvedColumn } from './useColumnLayout'

/**
 * Selección de un rango rectangular de celdas, como en una hoja de cálculo.
 *
 * ## El rango no es un segundo estado de selección
 *
 * Es el mismo, con una punta más. El ancla del rango ES la celda activa, que ya
 * existía, y aquí solo vive el FOCO: la punta que se mueve al arrastrar o al
 * presionar `Shift`+flecha. Esa decisión elimina de raíz el estado imposible que
 * tendría un `selectedRange` independiente —un rango que no contiene a la celda
 * activa— y hace que mover la selección colapse el rango sin que nadie tenga que
 * acordarse de sincronizar dos cosas.
 *
 * De ahí que este módulo no escriba la celda activa por su cuenta: la pide por
 * `anchor()` y, cuando necesita moverla, lo hace por `setAnchor()`, que es el
 * mismo camino que usa un clic. El componente sigue siendo el único dueño de la
 * selección.
 *
 * ## Qué es el rectángulo y en qué coordenadas vive
 *
 * Las dos puntas son {@link CellPosition}: fila de la secuencia VISIBLE y clave
 * de columna. El rectángulo se resuelve contra las columnas visibles EN EL
 * MOMENTO de leerlo, no al fijarlo. Esa es la razón de que sea un `computed` y
 * no un valor guardado: ocultar, mostrar o reordenar columnas mientras hay un
 * rango vivo lo reinterpreta solo, y un rango guardado como lista de claves
 * habría quedado hablando de un layout que ya no existe.
 *
 * Si una de las dos puntas no resuelve a ninguna columna visible no hay
 * rectángulo, exactamente como la celda activa deja de pintarse cuando ocultan
 * su columna. Volver a mostrarla lo devuelve intacto.
 */

/** Rectángulo del rango, ya normalizado y resuelto contra las columnas visibles. */
export interface RangeRect {
  /** Primera fila abarcada, en la secuencia visible. */
  rowStart: number
  /** Última fila abarcada. Incluida. */
  rowEnd: number
  /** Índice de la primera columna abarcada, dentro de las VISIBLES. */
  columnStart: number
  /** Índice de la última columna abarcada, dentro de las VISIBLES. Incluido. */
  columnEnd: number
}

/** Lo que el rango necesita saber del componente. */
export interface CellRangeOptions<TRow> {
  /** Si la selección de rango está habilitada ahora mismo. */
  enabled: () => boolean
  /** Columnas visibles, en orden. */
  columns: () => readonly ResolvedColumn<TRow>[]
  /** Cantidad de filas de la secuencia visible. */
  rowCount: () => number
  /** La celda activa, que es el ancla del rango. */
  anchor: () => CellPosition | null
  /** Mueve la celda activa. Es el mismo camino que usa un clic. */
  setAnchor: (position: CellPosition) => void
}

/** API del rango de celdas. */
export interface CellRangeApi {
  /**
   * El rango con sus dos puntas, o `null` si la selección es una sola celda.
   *
   * `null` no significa "no hay selección": significa que alcanza con la celda
   * activa para describirla. Es lo que decide si se dibuja el recuadro y si el
   * pool tiñe algo.
   */
  range: ComputedRef<CellRange | null>
  /**
   * El rectángulo abarcado, INCLUIDO el caso de una sola celda.
   *
   * Es lo que consume el copiado, que tiene que funcionar igual con una celda
   * que con diez mil. Vale `null` cuando no hay celda activa o cuando su columna
   * no resuelve.
   */
  rect: ComputedRef<RangeRect | null>
  /** Mueve la punta móvil. Acota a la grilla. No toca la celda activa. */
  extendTo(position: CellPosition): void
  /** Vuelve a una sola celda. La celda activa queda donde está. */
  collapse(): void
  /** Selecciona la grilla entera. Lleva la celda activa a la esquina superior izquierda. */
  selectAll(): void
  /** Fija las dos puntas de una vez. `null` colapsa. Para la API imperativa. */
  set(range: CellRange | null): void
}

/** Crea el estado de rango de una tabla. */
export function useCellRange<TRow extends Record<string, unknown>>(
  options: CellRangeOptions<TRow>,
): CellRangeApi {
  /**
   * Punta móvil del rango, junto al ancla que tenía cuando se fijó.
   *
   * `null` es el estado normal: una selección de una sola celda no necesita
   * foco, porque el ancla ya la describe entera.
   *
   * El ancla se guarda ADEMÁS del foco, y no es redundante. La celda activa
   * puede cambiar por un camino que este módulo no ve: un padre que controla
   * `activeCell` y la mueve por su cuenta. Sin el testigo, ese foco viejo se
   * combinaría con el ancla nueva y la tabla dibujaría un rectángulo que el
   * usuario nunca seleccionó; con él, un foco que ya no corresponde simplemente
   * no cuenta. Los movimientos que sí pasan por aquí colapsan el rango antes, así
   * que la comparación solo descarta lo que vino de afuera.
   */
  const focus = shallowRef<{ from: CellPosition; to: CellPosition } | null>(null)

  /** Índice de una clave dentro de las columnas visibles, o -1. */
  function columnIndexOf(columnKey: string): number {
    return options.columns().findIndex((column) => column.key === columnKey)
  }

  /** Dos posiciones que apuntan a la misma celda. */
  function samePosition(a: CellPosition, b: CellPosition): boolean {
    return a.rowIndex === b.rowIndex && a.columnKey === b.columnKey
  }

  /**
   * La punta móvil vigente, o `null` si no hay ninguna que valga.
   *
   * Descarta el foco cuya ancla ya no es la celda activa: ver el comentario de
   * {@link focus}.
   */
  function currentFocus(): CellPosition | null {
    const current = focus.value
    if (!current) return null

    const anchor = options.anchor()
    if (!anchor || !samePosition(anchor, current.from)) return null
    return current.to
  }

  const range = computed<CellRange | null>(() => {
    const anchor = options.anchor()
    const end = currentFocus()
    if (!anchor || !end) return null
    if (samePosition(anchor, end)) return null
    return { anchor, focus: end }
  })

  const rect = computed<RangeRect | null>(() => {
    const anchor = options.anchor()
    if (!anchor) return null

    const anchorColumn = columnIndexOf(anchor.columnKey)
    if (anchorColumn === -1) return null

    const end = currentFocus()
    if (!end) {
      return {
        rowStart: anchor.rowIndex,
        rowEnd: anchor.rowIndex,
        columnStart: anchorColumn,
        columnEnd: anchorColumn,
      }
    }

    const focusColumn = columnIndexOf(end.columnKey)
    if (focusColumn === -1) return null

    return {
      rowStart: Math.min(anchor.rowIndex, end.rowIndex),
      rowEnd: Math.max(anchor.rowIndex, end.rowIndex),
      columnStart: Math.min(anchorColumn, focusColumn),
      columnEnd: Math.max(anchorColumn, focusColumn),
    }
  })

  /** Acota una posición a la grilla vigente, o `null` si no hay grilla. */
  function clampPosition(position: CellPosition): CellPosition | null {
    const columns = options.columns()
    const rowCount = options.rowCount()
    if (columns.length === 0 || rowCount === 0) return null

    const rowIndex = Math.min(Math.max(position.rowIndex, 0), rowCount - 1)

    // Una clave desconocida se acota a la columna más cercana que EXISTE, no se
    // descarta: el llamador ya expresó una intención sobre el eje vertical, y
    // tirar el movimiento entero por el eje horizontal dejaría la tecla sin
    // efecto visible.
    const index = columnIndexOf(position.columnKey)
    const column = columns[index === -1 ? 0 : index]
    if (!column) return null

    return { rowIndex, columnKey: column.key }
  }

  function extendTo(position: CellPosition): void {
    if (!options.enabled()) return
    const anchor = options.anchor()
    if (!anchor) return

    const next = clampPosition(position)
    if (!next) return

    // Un arrastre dispara un evento por cada movimiento del puntero, y la mayoría
    // cae sobre la misma celda que el anterior. Cortar aquí es lo que evita
    // agendar un repintado por cada píxel recorrido.
    const current = currentFocus()
    if (current && samePosition(current, next)) return

    focus.value = { from: anchor, to: next }
  }

  function collapse(): void {
    if (focus.value === null) return
    focus.value = null
  }

  function selectAll(): void {
    if (!options.enabled()) return

    const columns = options.columns()
    const rowCount = options.rowCount()
    const first = columns[0]
    const last = columns[columns.length - 1]
    if (!first || !last || rowCount === 0) return

    // El ancla va a la esquina superior izquierda porque el rectángulo se define
    // entre las dos puntas: dejar el ancla donde estaba seleccionaría solo el
    // cuadrante que le queda por delante. Es la única diferencia con una
    // hoja de cálculo, y a cambio el modelo sigue teniendo un solo estado.
    const anchor: CellPosition = { rowIndex: 0, columnKey: first.key }
    options.setAnchor(anchor)
    focus.value = { from: anchor, to: { rowIndex: rowCount - 1, columnKey: last.key } }
  }

  function set(next: CellRange | null): void {
    if (!options.enabled()) return
    if (!next) {
      collapse()
      return
    }

    const anchor = clampPosition(next.anchor)
    const to = clampPosition(next.focus)
    if (!anchor || !to) return

    options.setAnchor(anchor)
    // Se guarda como testigo el ancla que se PIDIÓ y no la vigente. Con
    // `activeCell` controlada, el padre solo la aplica en el próximo tick, así
    // que leerla ahora dejaría guardada la anterior y el rango se descartaría
    // solo en cuanto el padre la moviera.
    focus.value = { from: anchor, to }
  }

  return { range, rect, extendTo, collapse, selectAll, set }
}
