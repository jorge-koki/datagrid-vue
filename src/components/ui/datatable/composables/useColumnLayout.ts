import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { CellAlign, ColumnVisibilityState, ColumnWidthState, DataTableColumn } from '../types'
import { DEFAULT_COLUMN_WIDTH, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../internal/constants'
import { reconcileColumnOrder } from '../internal/reconcile'
import { defaultAlignFor } from '../internal/renderers'
import { clamp } from '../internal/values'

/**
 * Una columna con su geometría ya resuelta.
 *
 * Es la forma que consume el camino de pintado: ancho y offset ya calculados,
 * sin fallbacks ni `??` pendientes, para que el pintado no tenga que decidir
 * nada por celda.
 */
export interface ResolvedColumn<TRow> {
  /** La definición original, tal cual la pasó el consumidor. */
  column: DataTableColumn<TRow>
  /** Alias de conveniencia de `column.key`. */
  key: string
  /** Texto del header ya resuelto (`column.label ?? column.key`). */
  label: string
  /** Ancho final en px, ya acotado por min/max. */
  width: number
  /** Posición horizontal en px respecto del borde izquierdo del canvas. */
  offset: number
  /** Índice dentro del tramo visible, en el orden vigente. */
  index: number
  /** Alineación ya resuelta. */
  align: CellAlign
  /** Si el header muestra un handle de redimensionado. */
  resizable: boolean
}

/** Tramo de columnas a pintar. `end` es exclusivo. */
export interface ColumnRange {
  /** Primer índice de columna a pintar, inclusive. */
  start: number
  /** Uno más allá del último índice de columna a pintar. */
  end: number
}

/** Opciones de {@link useColumnLayout}. */
export interface UseColumnLayoutOptions<TRow> {
  /** Definiciones de columna, en orden de declaración. */
  columns: MaybeRefOrGetter<readonly DataTableColumn<TRow>[]>
  /** Ancho aplicado a las columnas que no declaran el suyo. */
  defaultColumnWidth: MaybeRefOrGetter<number>
  /** Visibilidad vigente por clave. Una clave ausente cae en `defaultVisible ?? true`. */
  visibility: MaybeRefOrGetter<ColumnVisibilityState>
  /** Orden vigente por clave. Vacío significa "orden de declaración". */
  order: MaybeRefOrGetter<readonly string[]>
  /** Anchos vigentes por clave. Pisan a `column.width`, siempre acotados. */
  widths: MaybeRefOrGetter<ColumnWidthState>
  /**
   * Se invoca cuando un arrastre pide un ancho nuevo, ya acotado.
   *
   * El layout NO guarda anchos: los recibe. Quien los almacena es el componente,
   * que además decide si son estado interno o un v-model del consumidor. Así hay
   * una sola fuente de verdad y el ancho puede persistirse.
   */
  onWidthChange?: (key: string, width: number) => void
}

/** Resultado de {@link useColumnLayout}. */
export interface UseColumnLayoutReturn<TRow> {
  /** Todas las columnas en el orden vigente, incluidas las ocultas. */
  orderedColumns: ComputedRef<readonly DataTableColumn<TRow>[]>
  /** Columnas visibles con ancho y offset resueltos, en el orden vigente. */
  resolvedColumns: ComputedRef<readonly ResolvedColumn<TRow>[]>
  /** Offsets acumulados en px, alineados por índice con `resolvedColumns`. */
  offsets: ComputedRef<readonly number[]>
  /** Suma de los anchos visibles. Es lo que dimensiona el canvas horizontal. */
  totalWidth: ComputedRef<number>
  /** Cantidad de columnas actualmente visibles. */
  visibleCount: ComputedRef<number>
  /** Devuelve el tramo de columnas que intersecta la franja horizontal visible. */
  findColumnRange(scrollLeft: number, viewportWidth: number, overscan: number): ColumnRange
  /** Pide un ancho nuevo. Devuelve el ancho efectivo tras acotarlo. */
  setColumnWidth(key: string, width: number): number
  /** Ancho resuelto actual de una columna visible, o `null` si no lo está. */
  getColumnWidth(key: string): number | null
  /** Columna resuelta por clave, o `null` si está oculta o es desconocida. */
  getResolvedColumn(key: string): ResolvedColumn<TRow> | null
  /** Si una columna está visible según el estado vigente. */
  isColumnVisible(key: string): boolean
}

/**
 * Resuelve orden, visibilidad, anchos y posiciones horizontales.
 *
 * ## Solo lo visible ocupa lugar
 *
 * La cadena es: columnas declaradas -> reordenadas -> filtradas por visibilidad
 * -> con ancho y offset resueltos. Los offsets se calculan únicamente sobre las
 * visibles, de modo que ocultar una columna no deja un hueco: las siguientes se
 * corren y el ancho total se achica. Una columna oculta tampoco consume un slot
 * del pool, porque el pool pinta exactamente lo que este composable expone.
 *
 * ## De dónde sale cada ancho
 *
 * Por prioridad: el ancho del estado vigente (arrastre del usuario o layout
 * restaurado), después `column.width`, después `defaultColumnWidth`. Cualquiera
 * de los tres se acota por los límites de la columna y por los globales, así que
 * ningún origen —ni siquiera un estado guardado de una versión anterior— puede
 * producir una columna imposible de agarrar o un canvas desmedido.
 *
 * ## Por qué los offsets acumulados
 *
 * La virtualización horizontal tiene que funcionar con anchos variables. Con
 * anchos uniformes bastaría una división, como en `useVirtualWindow`; con anchos
 * arbitrarios hay que buscar, y una búsqueda binaria sobre un array precalculado
 * resuelve en O(log n) lo que un barrido lineal resolvería en O(n) por frame.
 */
export function useColumnLayout<TRow>(
  options: UseColumnLayoutOptions<TRow>,
): UseColumnLayoutReturn<TRow> {
  /**
   * Columnas en el orden vigente, ocultas incluidas.
   *
   * Se reconcilia con la misma función que usa la persistencia: el orden que
   * llega por props puede venir de un v-model del consumidor y traer claves
   * fantasma o faltantes igual que un estado guardado. El resultado siempre es
   * una permutación exacta de las columnas actuales.
   */
  const orderedColumns = computed<readonly DataTableColumn<TRow>[]>(() => {
    const columns = toValue(options.columns)
    const order = toValue(options.order)
    if (order.length === 0) return columns

    const byKey = new Map<string, DataTableColumn<TRow>>()
    for (const column of columns) byKey.set(column.key, column)

    const result: DataTableColumn<TRow>[] = []
    for (const key of reconcileColumnOrder(order, columns)) {
      const column = byKey.get(key)
      // `reconcileColumnOrder` solo devuelve claves existentes, así que la guarda
      // es formalidad de `noUncheckedIndexedAccess`.
      if (column) result.push(column)
    }
    return result
  })

  function resolveVisible(column: DataTableColumn<TRow>): boolean {
    const state = toValue(options.visibility)
    const explicit = state[column.key]
    if (typeof explicit === 'boolean') return explicit
    return column.defaultVisible ?? true
  }

  /**
   * Columnas visibles con geometría resuelta.
   *
   * Un `computed` produce un array nuevo en cada recálculo, que es exactamente
   * la semántica buscada: reemplazo completo, nunca mutación en el lugar. Además
   * el array queda plano —Vue no envuelve en proxy lo que devuelve un
   * `computed`—, así que las columnas no pasan por reactividad profunda.
   */
  const resolvedColumns = computed<readonly ResolvedColumn<TRow>[]>(() => {
    const rawFallback = toValue(options.defaultColumnWidth)
    const fallbackWidth =
      Number.isFinite(rawFallback) && rawFallback > 0 ? rawFallback : DEFAULT_COLUMN_WIDTH
    const widths = toValue(options.widths)

    const resolved: ResolvedColumn<TRow>[] = []
    let offset = 0

    for (const column of orderedColumns.value) {
      if (!resolveVisible(column)) continue

      const override = widths[column.key]
      const declared =
        typeof override === 'number' && Number.isFinite(override)
          ? override
          : (column.width ?? fallbackWidth)
      const width = clampColumnWidth(declared, column)

      resolved.push({
        column,
        key: column.key,
        label: column.label ?? column.key,
        width,
        offset,
        index: resolved.length,
        // El renderer puede proponer una alineación (una columna numérica va
        // a la derecha). Un `align` explícito de la columna siempre gana.
        align: column.align ?? defaultAlignFor(column.renderer) ?? 'left',
        resizable: column.resizable ?? false,
      })

      offset += width
    }

    return resolved
  })

  /**
   * Bordes izquierdos acumulados, alineados por índice con `resolvedColumns`.
   *
   * Se materializan aparte porque la búsqueda binaria recorre solo números: leer
   * `offsets[mid]` evita traer a caché el objeto de columna completo en cada
   * paso de la búsqueda.
   */
  const offsets = computed<readonly number[]>(() =>
    resolvedColumns.value.map((entry) => entry.offset),
  )

  const totalWidth = computed(() => {
    const resolved = resolvedColumns.value
    const last = resolved[resolved.length - 1]
    if (!last) return 0
    return last.offset + last.width
  })

  const visibleCount = computed(() => resolvedColumns.value.length)

  /** Índice de la última columna cuyo borde izquierdo es menor o igual a `x`. */
  function findColumnIndexAt(x: number): number {
    const list = offsets.value
    let low = 0
    let high = list.length - 1
    let found = 0

    while (low <= high) {
      const mid = (low + high) >>> 1
      const value = list[mid]
      // Guarda exigida por `noUncheckedIndexedAccess`. Inalcanzable mientras
      // `mid` se derive de la longitud del propio array.
      if (value === undefined) break
      if (value <= x) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    return found
  }

  function findColumnRange(
    scrollLeft: number,
    viewportWidth: number,
    overscan: number,
  ): ColumnRange {
    const count = resolvedColumns.value.length
    if (count === 0) return { start: 0, end: 0 }

    const left = Number.isFinite(scrollLeft) && scrollLeft > 0 ? scrollLeft : 0
    const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0
    const margin = Number.isFinite(overscan) && overscan > 0 ? Math.floor(overscan) : 0

    const first = findColumnIndexAt(left)
    const last = findColumnIndexAt(left + width)

    const start = Math.max(0, first - margin)
    const end = Math.min(count, last + 1 + margin)

    return { start, end: Math.max(start, end) }
  }

  function setColumnWidth(key: string, width: number): number {
    const target = orderedColumns.value.find((column) => column.key === key)
    if (!target) return 0

    const next = clampColumnWidth(width, target)
    options.onWidthChange?.(key, next)
    return next
  }

  function getColumnWidth(key: string): number | null {
    return resolvedColumns.value.find((entry) => entry.key === key)?.width ?? null
  }

  function getResolvedColumn(key: string): ResolvedColumn<TRow> | null {
    return resolvedColumns.value.find((entry) => entry.key === key) ?? null
  }

  function isColumnVisible(key: string): boolean {
    return resolvedColumns.value.some((entry) => entry.key === key)
  }

  return {
    orderedColumns,
    resolvedColumns,
    offsets,
    totalWidth,
    visibleCount,
    findColumnRange,
    setColumnWidth,
    getColumnWidth,
    getResolvedColumn,
    isColumnVisible,
  }
}

/**
 * Acota un ancho candidato por los límites de la columna y los globales.
 *
 * Los límites propios de la columna ganan cuando son más estrictos; los globales
 * existen para que una configuración errónea (`minWidth: 0`, `width: 1e9`) o un
 * ancho restaurado de una versión anterior no produzcan una columna imposible de
 * agarrar ni un canvas que desborde el límite de tamaño de elemento del
 * navegador.
 */
function clampColumnWidth<TRow>(width: number, column: DataTableColumn<TRow>): number {
  const min = Math.max(MIN_COLUMN_WIDTH, column.minWidth ?? MIN_COLUMN_WIDTH)
  const max = Math.min(MAX_COLUMN_WIDTH, column.maxWidth ?? MAX_COLUMN_WIDTH)
  return clamp(width, min, Math.max(min, max))
}
