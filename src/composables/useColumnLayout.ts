import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type {
  CellAlign,
  ColumnPin,
  ColumnPinState,
  ColumnVisibilityState,
  ColumnWidthState,
  DataTableColumn,
} from '../types'
import { DEFAULT_COLUMN_WIDTH, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../internal/constants'
import { reconcileColumnOrder } from '../internal/reconcile'
import { defaultAlignFor } from '../internal/renderers'
import { clamp } from '../internal/values'

/**
 * Mapa vacío compartido para el caso sin anclaje del usuario.
 *
 * Un literal nuevo por recálculo sería basura por frame en el caso que usa todo
 * el mundo, que es no haber tocado ningún ancla nunca.
 */
const EMPTY_PINNING: ColumnPinState = Object.freeze({})

/**
 * A qué borde llevaría el BOTÓN del encabezado a esta columna, o `null` si no
 * lleva botón.
 *
 * `true` y `'start'` son lo mismo: el borde izquierdo es a donde se ancla en la
 * enorme mayoría de los casos, así que es lo que significa decir "sí" sin más.
 * `'menu'` es "se puede anclar, pero sin botón".
 */
function pinButtonSideOf<TRow>(column: DataTableColumn<TRow>): ColumnPin | null {
  const declared = column.pinnable
  if (declared === undefined || declared === false || declared === 'menu') return null
  if (declared === true) return 'start'
  return declared
}

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
  /** Si la columna participa del ordenamiento, por el gesto que sea. */
  sortable: boolean
  /**
   * Si el CLIC en el encabezado la ordena.
   *
   * Es una decisión aparte de `sortable`: una columna puede ordenarse solo desde
   * el menú. Separarlas es lo que impide que el encabezado prometa un gesto que
   * no tiene —cursor de mano incluido—.
   */
  sortOnHeaderClick: boolean
  /** Si la columna se puede mover arrastrando su encabezado. */
  reorderable: boolean
  /** Borde al que está anclada, o `null` si scrollea con el resto. */
  pinned: ColumnPin | null
  /** Si la columna se puede anclar, por el gesto que sea. */
  pinnable: boolean
  /**
   * Borde al que el BOTÓN del encabezado la anclaría, o `null` si no lleva
   * botón.
   *
   * Es el lado DECLARADO, no el vigente: una columna con `pinnable: 'start'`
   * conserva `'start'` aquí aunque ahora mismo esté suelta. Lo que decide si el
   * botón ancla o desancla es {@link ResolvedColumn.pinned}.
   *
   * El menú no lo usa: ofrece los dos lados siempre. Ver
   * {@link DataTableColumn.pinnable}.
   */
  pinSide: ColumnPin | null
}

/** Tramo de columnas a pintar. `end` es exclusivo. */
export interface ColumnRange {
  /** Primer índice de columna a pintar, inclusive. */
  start: number
  /** Uno más allí del último índice de columna a pintar. */
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
   * Anclaje elegido por el usuario. Pisa a `column.pinned`.
   *
   * Igual que `widths` respecto de `column.width`: el layout no lo guarda, lo
   * recibe. Una clave ausente deja mandar a la declaración; una clave en `null`
   * es una decisión del usuario y la pisa.
   */
  pinning?: MaybeRefOrGetter<ColumnPinState>
  /**
   * Espacio reservado a la izquierda de la primera columna, en px.
   *
   * Es el ancho de la regleta de numeración. Se suma aquí y no en cada consumidor
   * porque el offset resuelto es la ÚNICA coordenada horizontal del componente:
   * la usan el header, las celdas, el editor, el recuadro del rango, la búsqueda
   * binaria de la ventana y los handles de redimensionado. Corriéndolo en el
   * origen, todo eso queda alineado sin que ninguno sepa que la regleta existe.
   */
  leadingOffset?: MaybeRefOrGetter<number>
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
  /**
   * Las ancladas a cada borde, sus anchos, y el tramo de las que scrollean.
   *
   * Lo consumen el header —que renderiza una tira por borde— y el componente,
   * que se lo pasa al pool: las ancladas se pintan con su posición compensada y
   * las sueltas por la ventana virtual de siempre.
   */
  pinnedColumns: ComputedRef<{
    start: readonly ResolvedColumn<TRow>[]
    end: readonly ResolvedColumn<TRow>[]
    all: readonly ResolvedColumn<TRow>[]
    startWidth: number
    endWidth: number
    scrollFrom: number
    scrollTo: number
  }>
  /** Devuelve el tramo de columnas que intersecta la franja horizontal visible. */
  findColumnRange(scrollLeft: number, viewportWidth: number, overscan: number): ColumnRange
  /** Pide un ancho nuevo. Devuelve el ancho efectivo tras acotarlo. */
  setColumnWidth(key: string, width: number): number
  /**
   * Columna resuelta por clave, o `null` si está oculta o es desconocida.
   *
   * Los dos casos devuelven exactamente lo mismo, y es deliberado: para la
   * geometría, "oculta" y "no existe" son la misma respuesta —no hay ancho ni
   * offset que dar— y distinguirlas obligaría a todos los llamadores a decidir
   * qué hacer con una diferencia que ninguno necesita. Quien sí necesita
   * distinguirlas tiene `orderedColumns`, que incluye las ocultas.
   */
  getResolvedColumn(key: string): ResolvedColumn<TRow> | null
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

    const leading = toValue(options.leadingOffset ?? 0)

    const resolved: ResolvedColumn<TRow>[] = []
    let offset = Number.isFinite(leading) && leading > 0 ? leading : 0

    /*
     * El anclaje manda sobre el orden.
     *
     * Se recorre tres veces —ancladas al inicio, sueltas, ancladas al final— en
     * lugar de ordenar con un comparador, y no es lo mismo: `sort` no promete
     * estabilidad entre motores para las claves iguales, y aquí el orden RELATIVO
     * de las columnas que comparten anclaje es exactamente el que el usuario
     * eligió arrastrando. Tres pasadas sobre una lista de decenas de elementos
     * cuestan nada y no dependen de esa promesa.
     */
    const pinning = toValue(options.pinning ?? EMPTY_PINNING)
    /*
     * Lo elegido por el usuario gana; la declaración es el valor inicial.
     *
     * El chequeo es contra `undefined` y no contra un valor falsy: `null`
     * significa "el usuario la soltó" y tiene que pisar a un `pinned` declarado.
     * Con `??` sobre el valor, soltar una columna declarada anclada habría sido
     * imposible.
     */
    const pinnedOf = (column: DataTableColumn<TRow>): ColumnPin | null => {
      const chosen = pinning[column.key]
      if (chosen !== undefined) return chosen
      return column.pinned ?? null
    }
    const visible = orderedColumns.value.filter(resolveVisible)
    const sequence = [
      ...visible.filter((column) => pinnedOf(column) === 'start'),
      ...visible.filter((column) => pinnedOf(column) === null),
      ...visible.filter((column) => pinnedOf(column) === 'end'),
    ]

    for (const column of sequence) {
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
        sortable: column.sortable !== undefined && column.sortable !== false,
        sortOnHeaderClick: column.sortable === true,
        // Al revés que `resizable`: mover es lo normal, anclar es la excepción.
        // Redimensionar cambia cómo se ve una columna y puede arruinar un layout
        // pensado; moverla solo cambia el orden, que ya es estado del usuario.
        // Una columna anclada es la excepción de la excepción: moverla
        // significaría desanclarla.
        reorderable: pinnedOf(column) === null && (column.reorderable ?? true),
        pinned: pinnedOf(column),
        pinnable: column.pinnable !== undefined && column.pinnable !== false,
        pinSide: pinButtonSideOf(column),
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

  /**
   * Las columnas ancladas a cada borde y las que scrollean, ya separadas.
   *
   * Se calcula una vez por cambio de layout y no en cada consumidor: lo mismo lo
   * necesitan el header —que renderiza tres tiras— y el pool, que pinta las
   * ancladas por un camino distinto que las sueltas.
   *
   * Las sueltas quedan como un TRAMO contiguo, con su primer y último índice.
   * Eso es lo que permite que la virtualización horizontal siga siendo la de
   * siempre: busca en el mismo array de offsets y solo se acota a ese tramo.
   */
  const pinnedColumns = computed(() => {
    const start: ResolvedColumn<TRow>[] = []
    const end: ResolvedColumn<TRow>[] = []

    for (const column of resolvedColumns.value) {
      if (column.pinned === 'start') start.push(column)
      else if (column.pinned === 'end') end.push(column)
    }

    const startWidth = start.reduce((total, column) => total + column.width, 0)
    const endWidth = end.reduce((total, column) => total + column.width, 0)

    return {
      start,
      end,
      /**
       * Las dos tiras en una sola lista, en orden visual.
       *
       * Es lo que consume el pool: le da un índice estable por columna anclada,
       * que es el mismo que el de su nodo de celda. Se materializa aquí, una vez
       * por cambio de layout, en vez de concatenarla por frame.
       */
      all: [...start, ...end],
      startWidth,
      endWidth,
      /** Primer índice suelto. Igual a la cantidad de ancladas al inicio. */
      scrollFrom: start.length,
      /** Uno más allí del último suelto. */
      scrollTo: resolvedColumns.value.length - end.length,
    }
  })

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

    /*
     * La ventana cubre SOLO el tramo suelto.
     *
     * Las ancladas se pintan por un camino propio, con su posición compensada
     * frame a frame. Si además cayeran en esta ventana se pintarían dos veces: la
     * copia anclada quieta en el borde y la suelta pasando por debajo con el
     * scroll, como un fantasma de sí misma.
     */
    const { scrollFrom, scrollTo } = pinnedColumns.value

    const start = clamp(first - margin, scrollFrom, scrollTo)
    const end = clamp(last + 1 + margin, scrollFrom, Math.min(count, scrollTo))

    return { start, end: Math.max(start, end) }
  }

  function setColumnWidth(key: string, width: number): number {
    const target = orderedColumns.value.find((column) => column.key === key)
    if (!target) return 0

    const next = clampColumnWidth(width, target)
    options.onWidthChange?.(key, next)
    return next
  }

  function getResolvedColumn(key: string): ResolvedColumn<TRow> | null {
    return resolvedColumns.value.find((entry) => entry.key === key) ?? null
  }

  return {
    orderedColumns,
    resolvedColumns,
    offsets,
    totalWidth,
    visibleCount,
    pinnedColumns,
    findColumnRange,
    setColumnWidth,
    getResolvedColumn,
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
