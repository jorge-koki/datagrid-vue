<script setup lang="ts" generic="TRow extends Record<string, unknown>">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch, watchEffect } from 'vue'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellEditorSlotProps,
  CellPosition,
  CellRange,
  CellSelectEvent,
  CellValue,
  ColumnPin,
  ColumnPinState,
  ColumnResizeEvent,
  ColumnSort,
  ColumnVisibilityState,
  DataTableLabels,
  ColumnWidthState,
  DataTableColumn,
  DataTableProps,
  EditCommitEvent,
  GroupByState,
  GroupRow,
  GroupToggleEvent,
  PersistedTableState,
  RangeCopyEvent,
  RangeSelectEvent,
  RowKey,
  RowSelectionChangeEvent,
  RowSelectionState,
  RowsRequestEvent,
  SortChangeEvent,
  SortDirection,
  SortState,
} from './types'
import { nextSortState } from './internal/sorting'
import {
  EMPTY_ROW_SELECTION,
  isRowSelectedIn,
  listedKeySet,
  rowSelectionHeaderState,
  sameRowSelection,
  setAllRowsSelected,
  toggleRowSelection,
} from './internal/row-selection'
import { useRowMetrics } from './composables/useRowMetrics'
import { useRemoteRows } from './composables/useRemoteRows'
import { useColumnLayout } from './composables/useColumnLayout'
import type { ResolvedColumn } from './composables/useColumnLayout'
import { useCellRange } from './composables/useCellRange'
import type { RangeRect } from './composables/useCellRange'
import { useRowGrouping } from './composables/useRowGrouping'
import { useRowPool } from './composables/useRowPool'
import { useScrollSync } from './composables/useScrollSync'
import { useCellEditor } from './composables/useCellEditor'
import type { CellGeometry } from './composables/useCellEditor'
import { useTablePersistence } from './composables/useTablePersistence'
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_HEADER_HEIGHT,
  DEFAULT_OVERSCAN,
  DEFAULT_PERSIST_VERSION,
  DEFAULT_ROW_HEIGHT,
  DENSE_HEADER_HEIGHT,
  DENSE_ROW_HEIGHT,
  DENSE_ROW_NUMBER_DIGIT_WIDTH,
  DENSE_ROW_NUMBER_PADDING,
  ROW_NUMBER_DIGIT_WIDTH,
  ROW_NUMBER_MAX_WIDTH,
  ROW_NUMBER_MIN_WIDTH,
  ROW_NUMBER_PADDING,
  SELECTION_COLUMN_KEY,
  SELECTION_COLUMN_WIDTH,
} from './internal/constants'
import { SELECTION_HOOKS } from './internal/renderers'
import { EMPTY_GROUP_LABEL } from './internal/aggregations'
import { buildRangeText } from './internal/clipboard'
import { clamp, readCellValue } from './internal/values'
import './styles/datatable.css'

/**
 * Tabla virtualizada de alto rendimiento.
 *
 * ## El reparto de responsabilidades
 *
 * Vue conserva lo que cambia poco y se beneficia de ser declarativo: las props,
 * el header, el editor, el ciclo de vida. El pool de nodos conserva el camino
 * caliente del scroll, donde la reactividad no aporta nada porque ya se sabe
 * exactamente qué cambió y dónde.
 *
 * Concretamente: las celdas del cuerpo **no son nodos del VDOM**. Si lo fueran,
 * cada frame de scroll costaría ~450 diffs de vnode y el presupuesto de 16ms se
 * agotaría antes de llegar a pintar. Las filas las inyecta `useRowPool`
 * directamente en `.dt-canvas` y Vue nunca las toca.
 *
 * El header sí lo renderiza Vue: son pocos nodos, se rediferencian solo cuando
 * cambia la configuración de columnas —nunca durante el scroll, que no lo toca:
 * la fila de encabezado vive DENTRO del viewport y la desplaza el navegador
 * junto con el resto del contenido— y los handles de redimensionado se
 * benefician de tener estado reactivo.
 *
 * ## Por qué 100k filas no cuestan memoria
 *
 * El objeto `props` de Vue es `shallowReactive`, así que `props.rows` devuelve
 * el array original y no un proxy profundo. Ninguna fila se envuelve nunca. El
 * componente solo indexa dentro de la ventana visible.
 *
 * ## Es un componente controlado
 *
 * Nunca escribe sobre `rows`. Las ediciones se reportan con `editCommit` y el
 * padre decide si persiste.
 */
const props = withDefaults(defineProps<DataTableProps<TRow>>(), {
  // `rowHeight` y `headerHeight` quedan deliberadamente fuera: su valor por
  // defecto depende de `dense`, y `withDefaults` no admite defaults derivados de
  // otra prop. Se resuelven más abajo en un `computed`.
  dense: false,
  overscan: DEFAULT_OVERSCAN,
  defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
  virtualizeColumns: true,
  theme: 'auto',
  variant: 'default',
  radiusBorder: 'none',
  showRowNumbers: true,
  columnReorder: true,
  // Apagadas por defecto: son gestos EXTRA sobre el encabezado y la regleta, y
  // una tabla que no los espera no debería empezar a seleccionar de a columnas
  // enteras porque alguien presionó un título.
  columnSelection: false,
  rowSelection: false,
  emptyText: 'No data',
  loading: false,
  columnMenu: false,
  stripe: false,
  bordered: false,
  selectionMode: 'cell',
  rangeSelection: true,
  // Apagado por defecto: con una celda marcada, el anillo del viewport es una
  // segunda señal para la misma posición y encierra toda la tabla en un borde de
  // color. El costo de accesibilidad de este default está documentado en el
  // README, junto con el caso en el que conviene encenderlo.
  focusRing: false,
  // Apagada por defecto por la misma razón que el anillo del viewport: la celda
  // activa ya tiene su marca, y en una tabla que entra entera en pantalla las
  // dos líneas de la cruz son ruido. Se enciende cuando la tabla es lo bastante
  // grande como para que la celda activa se vaya de la vista.
  crosshair: false,
  // `columnVisibility`, `columnOrder`, `columnWidths`, `activeCell`, `groupBy` y
  // `expandedGroups` quedan deliberadamente sin default: `undefined` es lo que
  // distingue el modo no controlado del controlado, y darles un default borraría
  // esa distinción. Para `activeCell` la diferencia es doble, porque `null` ya
  // significa "controlado y sin selección", y para `expandedGroups` también,
  // porque una lista vacía significa "controlado y todo colapsado".
  persist: false,
  groupsDefaultExpanded: true,
  showGroupCount: true,
  // El default es la misma constante que usaba el literal incrustado, así que
  // una tabla que no pasa la prop escribe exactamente la etiqueta de siempre.
  emptyGroupLabel: EMPTY_GROUP_LABEL,
})

const emit = defineEmits<{
  beforeEdit: [BeforeEditEvent<TRow>]
  afterEdit: [AfterEditEvent<TRow>]
  editCommit: [EditCommitEvent<TRow>]
  columnResize: [ColumnResizeEvent]
  rowClick: [{ row: TRow; rowIndex: number }]
  cellSelect: [CellSelectEvent<TRow>]
  rangeSelect: [RangeSelectEvent<TRow>]
  rangeCopy: [RangeCopyEvent]
  groupToggle: [GroupToggleEvent]
  rowsRequest: [RowsRequestEvent]
  'update:activeCell': [CellPosition | null]
  'update:columnVisibility': [ColumnVisibilityState]
  'update:columnOrder': [string[]]
  'update:columnWidths': [ColumnWidthState]
  'update:columnPinning': [ColumnPinState]
  'update:selectedRows': [RowSelectionState]
  rowSelectionChange: [RowSelectionChangeEvent<TRow>]
  'update:sort': [ColumnSort[]]
  sortChange: [SortChangeEvent]
  'update:groupBy': [string[]]
  'update:expandedGroups': [string[]]
}>()

/**
 * El único slot del componente, y la única vía por la que entra un componente
 * Vue ajeno.
 *
 * Se renderiza SOLO sobre la celda que está en edición, dentro del host del
 * editor y nunca dentro de `.dt-canvas`, que es territorio del pool. Una celda
 * abierta a la vez significa una instancia montada a la vez, sin importar
 * cuántas filas tenga la tabla: es la misma disciplina del `<input>` reutilizado
 * que ya usaban los editores incluidos.
 *
 * Es opcional, y cuando no se declara el componente ni siquiera renderiza la
 * caja que lo contendría: una tabla que no lo usa produce exactamente el mismo
 * DOM que antes de que este slot existiera.
 */
defineSlots<{
  editor?: (props: CellEditorSlotProps<TRow>) => unknown
}>()

/* --------------------------------------------- Estado de layout de columnas */

/**
 * Visibilidad, orden y anchos: controlado o no controlado, por prop.
 *
 * Cada uno de los tres se puede usar de dos maneras y el componente sirve a las
 * dos sin bifurcar su lógica interna:
 *
 * - **No controlado**: si la prop llega `undefined`, el estado vive en el ref
 *   interno y la tabla funciona sola. Es el modo que usa la persistencia.
 * - **Controlado**: si la prop llega con valor, esa prop es la verdad. El
 *   componente NO escribe el ref interno, solo emite `update:*`, y el padre
 *   decide. Si el padre ignora el evento, no pasa nada: es la semántica normal
 *   de un v-model y evita que la vista se desincronice del estado del padre.
 *
 * El evento se emite siempre, incluso sin controlar, para que un consumidor
 * pueda escuchar los cambios sin tener que tomar posesión del estado.
 */
const internalVisibility = shallowRef<Record<string, boolean>>({})
const internalOrder = shallowRef<string[]>([])
const internalWidths = shallowRef<Record<string, number>>({})
const internalPinning = shallowRef<Record<string, ColumnPin | null>>({})
const internalSort = shallowRef<ColumnSort[]>([])
const internalRowSelection = shallowRef<RowSelectionState>(EMPTY_ROW_SELECTION)

const columnVisibility = computed<ColumnVisibilityState>(
  () => props.columnVisibility ?? internalVisibility.value,
)
const columnOrder = computed<readonly string[]>(() => props.columnOrder ?? internalOrder.value)
const columnWidths = computed<ColumnWidthState>(() => props.columnWidths ?? internalWidths.value)
const columnPinning = computed<ColumnPinState>(() => props.columnPinning ?? internalPinning.value)
const sort = computed<SortState>(() => props.sort ?? internalSort.value)
const selectedRowsState = computed<RowSelectionState>(
  () => props.selectedRows ?? internalRowSelection.value,
)

/**
 * Las claves LISTADAS, como conjunto.
 *
 * El bucle de pintado pregunta una vez por fila visible, y `Array.includes` es
 * lineal: con unos miles de claves eso es recorrer la lista treinta veces por
 * frame. El conjunto se arma cuando la selección cambia y el frame solo consulta.
 *
 * Son las listadas y no las marcadas: en modo `'all'` las listadas son las
 * EXCLUIDAS, y un conjunto de "todas las marcadas" no se puede construir sin
 * enumerar un dataset que ni siquiera está cargado.
 */
const listedRowKeys = computed(() => listedKeySet(selectedRowsState.value))

/**
 * Cuántas filas hay en total para la selección.
 *
 * En modo servidor es `rowCount` y no lo cargado: con 50 de 9000 en memoria, la
 * casilla del encabezado tiene que decir 9000, que es lo que el usuario acaba de
 * elegir.
 */
const selectableRowCount = computed(() => props.rowCount ?? props.rows.length)

function setRowSelection(
  next: RowSelectionState,
  reason: RowSelectionChangeEvent<TRow>['reason'],
  row: TRow | null,
  key: RowKey | null,
): void {
  if (sameRowSelection(selectedRowsState.value, next)) return
  if (props.selectedRows === undefined) internalRowSelection.value = next
  emit('update:selectedRows', next)
  emit('rowSelectionChange', { selection: next, row, key, reason })
}

function setColumnVisibility(next: Record<string, boolean>): void {
  if (props.columnVisibility === undefined) internalVisibility.value = next
  emit('update:columnVisibility', next)
}

function setColumnOrder(next: string[]): void {
  if (props.columnOrder === undefined) internalOrder.value = next
  emit('update:columnOrder', next)
}

function setColumnWidths(next: Record<string, number>): void {
  if (props.columnWidths === undefined) internalWidths.value = next
  emit('update:columnWidths', next)
}

function setColumnPinning(next: Record<string, ColumnPin | null>): void {
  if (props.columnPinning === undefined) internalPinning.value = next
  emit('update:columnPinning', next)
}

/**
 * Los textos de la librería, ya completados con los valores por defecto.
 *
 * Se resuelven en un `computed` y no al usarlos para que el `??` de cada cadena
 * ocurra una vez por cambio de prop y no una por encabezado y por render.
 */
const labels = computed<Required<DataTableLabels>>(() => {
  const declared = props.labels ?? {}
  return {
    pin: declared.pin ?? 'Pin column',
    unpin: declared.unpin ?? 'Unpin column',
    menu: declared.menu ?? 'Column menu',
    sortAsc: declared.sortAsc ?? 'Sort ascending',
    sortDesc: declared.sortDesc ?? 'Sort descending',
    clearSort: declared.clearSort ?? 'Clear sort',
    pinStart: declared.pinStart ?? 'Pin to start',
    pinEnd: declared.pinEnd ?? 'Pin to end',
    hideColumn: declared.hideColumn ?? 'Hide column',
    resetColumns: declared.resetColumns ?? 'Reset columns',
  }
})

/**
 * Escribe los criterios de ordenamiento y los anuncia.
 *
 * Emite DOS eventos y no uno: `update:sort` es el v-model, para quien quiera
 * poseer el estado; `sortChange` es el aviso, para quien solo quiera reaccionar
 * —volver a consultarle al servidor, típicamente— sin tomar posesión de nada.
 * Es la misma pareja que ya tienen la edición y la agrupación.
 */
function setSort(next: ColumnSort[], columnKey: string): void {
  if (props.sort === undefined) internalSort.value = next
  emit('update:sort', next)
  emit('sortChange', { sort: next, columnKey })
}

/**
 * Valor de `aria-sort` del encabezado.
 *
 * Solo lo llevan las columnas ordenables: en una que no lo es, `aria-sort="none"`
 * le anunciaría a un lector de pantalla que se puede ordenar y no se puede.
 */
function ariaSortFor(
  column: ResolvedColumn<TRow>,
): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortable) return undefined
  const entry = sortFor(column.key)
  if (entry === null) return 'none'
  return entry.direction === 'asc' ? 'ascending' : 'descending'
}

/** Criterio vigente de una columna, o `null` si no participa del orden. */
function sortFor(columnKey: string): ColumnSort | null {
  return sort.value.find((entry) => entry.columnKey === columnKey) ?? null
}

/**
 * Posición del criterio de una columna, en base 1, o `0` si no ordena.
 *
 * Solo se muestra cuando hay MÁS DE UN criterio: con uno solo, un "1" al lado de
 * la flecha no dice nada que la flecha no diga ya.
 */
function sortRankFor(columnKey: string): number {
  if (sort.value.length < 2) return 0
  const index = sort.value.findIndex((entry) => entry.columnKey === columnKey)
  return index + 1
}

/**
 * Avanza el orden de una columna: ascendente → descendente → sin orden.
 *
 * `Shift` suma un criterio en lugar de reemplazar los que había, que es lo que
 * permite "por estado, y dentro de cada estado por fecha".
 *
 * Volver al principio del dataset no es cosmético: con el orden cambiado, la
 * fila 50.000 es otra fila, así que quedarse donde estaba deja al usuario mirando
 * un tramo que no pidió. Solo se scrollea si el orden realmente cambió.
 */
function toggleSort(column: ResolvedColumn<TRow>, additive = false): void {
  if (!column.sortable) return

  setSort(nextSortState(sort.value, column.key, additive), column.key)
  scroll.scrollTo({ top: 0 })
}

/* ------------------------------------------------------- Estado de agrupación */

/**
 * Agrupación y expansión: exactamente la misma disciplina que las columnas.
 *
 * Si la prop llega `undefined` el estado vive adentro; si llega con valor, la
 * prop manda y el componente solo emite. La única diferencia con el trío de
 * columnas es que aquí el estado interno de expansión no lo guarda este
 * componente sino `useRowGrouping`, porque para decidir si un grupo está
 * expandido hace falta además saber cuáles existen.
 */
const internalGroupBy = shallowRef<string[]>([])

const groupBy = computed<GroupByState>(() => props.groupBy ?? internalGroupBy.value)

function setGroupBy(next: string[]): void {
  if (props.groupBy === undefined) internalGroupBy.value = next
  emit('update:groupBy', next)
}

/* ------------------------------------------------------------ Referencias DOM */

const rootEl = shallowRef<HTMLElement | null>(null)
const viewportEl = shallowRef<HTMLElement | null>(null)
const canvasEl = shallowRef<HTMLElement | null>(null)
const gutterEl = shallowRef<HTMLElement | null>(null)
const editorHostEl = shallowRef<HTMLElement | null>(null)
const slotEditorHostEl = shallowRef<HTMLElement | null>(null)

/* -------------------------------------------------------------- Métricas base */

/**
 * Altura de fila BASE, en px.
 *
 * Es un número y no un valor CSS porque el virtualizador hace cuentas con él. Se
 * replica a `--dt-row-height` para que la presentación coincida.
 *
 * Con `rowHeight` declarado como función, esto NO es el alto de ninguna fila en
 * particular: es el valor por defecto —el de las cabeceras de grupo si el
 * resolutor no dice otra cosa, el respaldo cuando devuelve algo que no sirve— y
 * el que viaja a la hoja de estilos. El alto de cada fila sale de
 * {@link rowVirtual}`.metrics`.
 */
const rowHeight = computed(() => {
  const declared = props.rowHeight
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) return declared
  return props.dense ? DENSE_ROW_HEIGHT : DEFAULT_ROW_HEIGHT
})

const headerHeight = computed(() => {
  const declared = props.headerHeight
  if (declared !== undefined && Number.isFinite(declared) && declared > 0) return declared
  return props.dense ? DENSE_HEADER_HEIGHT : DEFAULT_HEADER_HEIGHT
})

/* ---------------------------------------------------------- Modo servidor */

/**
 * `true` cuando el consumidor declaró `rowCount`, o sea cuando `rows` puede
 * tener huecos y la tabla tiene que pedir lo que falta.
 *
 * Es `!== undefined` y no un chequeo de valor: `rowCount: 0` es un dataset
 * remoto vacío, que no es lo mismo que una tabla que no usa el modo. **Sin la
 * prop, todo lo que sigue queda apagado y la tabla se comporta exactamente como
 * siempre.**
 */
const serverMode = computed(() => props.rowCount !== undefined)

/**
 * ¿La tabla está esperando datos? Cualquiera de las tres formas de decirlo.
 *
 * Separado de {@link showLoadingSkeleton} a propósito: "estoy esperando" y "lo
 * muestro con esqueleto" son dos preguntas distintas, y `'blank'` responde sí a
 * la primera y no a la segunda. Mezclarlas haría que con `'blank'` apareciera el
 * mensaje de tabla vacía, que es justo lo que no corresponde mientras se espera.
 */
const isLoading = computed(() => props.loading !== false)

/** ¿Y se pinta el esqueleto? Con `'blank'` no se pinta nada. */
const showLoadingSkeleton = computed(() => props.loading === true || props.loading === 'skeleton')

/**
 * Agrupar y modo servidor son excluyentes.
 *
 * Armar el árbol de grupos exige recorrer el dataset ENTERO —hay que leer la
 * clave de cada fila para saber a qué grupo va, y contar cuántas trae cada uno—,
 * y en modo servidor la mayor parte del dataset no está. Agrupar lo que llegó
 * produciría grupos que cambian de tamaño a medida que se scrollea, que es peor
 * que no agrupar.
 *
 * Se avisa una vez y se sigue sin agrupar, en lugar de tirar: una tabla que
 * funciona sin la agrupación es mejor resultado que una pantalla en blanco. Es
 * el mismo criterio que usa el registro de renderers ante un nombre desconocido.
 */
let warnedAboutGrouping = false

/** Identidad estable para "sin agrupar". Ver la nota dentro del computed. */
const EMPTY_GROUP_BY: readonly string[] = Object.freeze([])

const effectiveGroupBy = computed<readonly string[]>(() => {
  const requested = groupBy.value
  if (!serverMode.value || requested.length === 0) return requested

  if (!warnedAboutGrouping) {
    warnedAboutGrouping = true
    console.warn(
      '[DataTable] `groupBy` se ignora porque la tabla está en modo servidor ' +
        '(`rowCount` declarado): no se puede agrupar un dataset que no está cargado ' +
        'entero. Agrupa del lado del servidor y manda las filas ya ordenadas.',
    )
  }
  // Una constante y no un `[]` nuevo: este computed se lee en cada
  // reconstrucción del aplanado, y una identidad distinta cada vez lo dispararía
  // en loop.
  return EMPTY_GROUP_BY
})

/* ------------------------------------------------------------- Agrupación */

/**
 * La vista aplanada que consume el virtualizador.
 *
 * Con `groupBy` vacío devuelve `null` y el resto del componente sigue indexando
 * `props.rows` exactamente como antes: la agrupación no cuesta nada mientras no
 * se use.
 */
const grouping = useRowGrouping<TRow>({
  rows: () => props.rows,
  columns: () => props.columns,
  groupBy: effectiveGroupBy,
  expandedGroups: () => props.expandedGroups,
  defaultExpanded: () => props.groupsDefaultExpanded,
  emptyGroupLabel: () => props.emptyGroupLabel,
  onExpandedChange: (expanded) => emit('update:expandedGroups', expanded),
  onToggle: (groupId, expanded) => emit('groupToggle', { groupId, expanded }),
})

/**
 * Cantidad de entradas verticales, o sea hasta dónde se puede scrollear.
 *
 * Es el punto exacto donde el modo servidor separa las dos cosas que hasta aquí
 * eran una sola: cuántas filas HAY lo dice `rowCount`, y qué hay en cada índice
 * lo dice `rows`. Sin `rowCount` las dos siguen saliendo del mismo lado.
 */
const visibleRowCount = computed(() => {
  const real = serverMode.value
    ? (() => {
        const raw = props.rowCount ?? 0
        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
      })()
    : grouping.totalCount.value

  /*
   * Esperando y sin una sola fila, hay que inventar cuántas dibujar.
   *
   * Es el caso de la primera carga: `rows` vacío y `rowCount` todavía sin
   * responder. Sin un número no hay filas que pintar y el esqueleto no se vería
   * —la tabla quedaría en blanco, que es justo lo que `loading` viene a evitar—.
   *
   * Se llena la pantalla y ni una fila más: el esqueleto es una señal de espera,
   * no una promesa de cuántos resultados van a llegar. Inventar una barra de
   * scroll larga y que después lleguen tres filas se lee como un error.
   */
  /*
   * `'blank'` no pinta NADA, y eso incluye las filas que ya estuvieran.
   *
   * Es la misma razón por la que el esqueleto tapa el dato: en una reconsulta
   * `rows` sigue trayendo el resultado anterior. Quitar el esqueleto y dejar las
   * filas viejas sería lo peor de los dos mundos —datos que no son, sin ninguna
   * señal de que algo está pasando—. Sin filas visibles, el cuerpo queda vacío,
   * que es lo que `'blank'` promete.
   */
  if (props.loading === 'blank') return 0

  if (showLoadingSkeleton.value && real === 0) {
    const alto = rowHeight.value
    return alto > 0 ? Math.ceil(rowViewportHeight.value / alto) : 0
  }
  return real
})

/* ------------------------------------------------------------ Layout y scroll */

/**
 * Ancho de la regleta de numeración, o 0 si la tabla no numera.
 *
 * ## Primero cuadrada, después lo que haga falta
 *
 * El ancho de referencia es la ALTURA DE FILA: una casilla cuadrada, que es la
 * forma que tiene la numeración en cualquier hoja de cálculo y la que hace que se lea
 * como un margen y no como una columna más. Solo si el número más alto no entra
 * en ese cuadrado —cinco dígitos o más— la regleta se ensancha, y lo hace lo
 * justo para el número que tiene que mostrar.
 *
 * El cálculo no mide texto: medir obliga a escribir en el DOM y leer layout, que
 * es justamente lo que este componente no hace para calcular geometría. El
 * resultado entra en el layout como espacio reservado antes de la primera
 * columna, así que TODAS las coordenadas horizontales —header, celdas, editor,
 * recuadro del rango, ventana visible— salen ya corridas de un solo lugar.
 */
const rowNumberWidth = computed(() => {
  if (!props.showRowNumbers) return 0

  // Con filas muy bajas o muy altas el cuadrado dejaría de tener sentido: un
  // borde grueso en un caso, una franja enorme en el otro.
  const square = clamp(rowHeight.value, ROW_NUMBER_MIN_WIDTH, ROW_NUMBER_MAX_WIDTH)

  const digits = String(Math.max(1, visibleRowCount.value)).length
  const perDigit = props.dense ? DENSE_ROW_NUMBER_DIGIT_WIDTH : ROW_NUMBER_DIGIT_WIDTH
  const padding = props.dense ? DENSE_ROW_NUMBER_PADDING : ROW_NUMBER_PADDING

  return Math.max(square, digits * perDigit + padding)
})

/**
 * La columna de casillas, si `selectionColumn` está encendida.
 *
 * La arma la tabla y no el consumidor: no se declara en `columns` ni hay que
 * reservarle ancho. Va anclada al inicio y por delante de lo que el consumidor
 * haya anclado ahí, porque marcar una fila tiene que poder hacerse con la tabla
 * corrida a cualquier lado.
 *
 * El predicado viaja COLGADO DE LA COLUMNA, en `SELECTION_HOOKS`. Un renderer
 * está registrado globalmente y no puede ver el estado de esta instancia; la
 * columna sí la controla la instancia, y es lo único que llega hasta el renderer.
 *
 * Todo lo que la haría comportarse como una columna de datos queda apagado: no
 * se redimensiona, no se mueve, no se ordena, no se ancla a mano y no se
 * esconde. Dejar cualquiera de esas encendidas permitiría que el usuario se
 * quede sin forma de marcar una fila.
 */
/**
 * El índice que NO tiene un `accessor`.
 *
 * `accessor` recibe la fila y nada más, así que un `rowKey` en forma de función
 * no puede recibir acá su segundo parámetro. No es una limitación en la
 * práctica: un `rowKey` cuyo resultado dependa del índice está diciendo que la
 * identidad de una fila es su POSICIÓN, que es exactamente el bug que esta
 * función existe para evitar. Con él, marcar filas no puede funcionar de ninguna
 * forma: filtrar corre las posiciones y la selección queda sobre otras filas.
 *
 * El pintado no depende de esto: el renderer recibe el índice de verdad por
 * `ctx.rowIndex` y pregunta por `SELECTION_HOOKS`. Esto solo alimenta
 * `ctx.value`, que es la comodidad que se le da a un renderer propio.
 */
const ACCESSOR_HAS_NO_ROW_INDEX = -1

const selectionColumnDef = computed<DataTableColumn<TRow> | null>(() => {
  const pedido = props.selectionColumn
  if (!pedido) return null
  const encargo = typeof pedido === 'object' ? pedido : {}

  const isSelected = (row: TRow, rowIndex: number): boolean =>
    isRowSelectedIn(selectedRowsState.value, listedRowKeys.value, rowKeyOf(row, rowIndex))

  return {
    header: '',
    width: SELECTION_COLUMN_WIDTH,
    renderer: 'selection',
    align: 'center',
    pinned: 'start',
    // Lo que el consumidor quiera cambiar va ENTRE el aspecto de fábrica y los
    // invariantes de abajo: puede poner su propia casilla, no puede dejarse sin
    // forma de marcar una fila.
    ...encargo,
    key: SELECTION_COLUMN_KEY,
    resizable: false,
    reorderable: false,
    sortable: false,
    pinnable: false,
    hideable: false,
    // Sin menú. Lo que ofrece —ordenar, anclar, esconder— no aplica a esta
    // columna, y lo único que quedaba era "restablecer columnas", que no tiene
    // nada que ver con marcar filas y aparecía justo donde el usuario apunta
    // para seleccionar.
    menu: false,
    /*
     * El valor de la celda ES si la fila está marcada.
     *
     * No sale de la fila —no hay ningún campo que lo diga— sino del estado, y
     * ponerlo acá tiene dos efectos que importan: un renderer propio lo recibe
     * en `ctx.value` sin tener que conocer los dos modos del conjunto, y el
     * caché del pool vuelve a servir para algo, porque ahora el valor crudo de
     * la celda cambia cuando cambia la marca.
     */
    accessor: (row: TRow) => isSelected(row, ACCESSOR_HAS_NO_ROW_INDEX),
    [SELECTION_HOOKS]: { isSelected },
  } as DataTableColumn<TRow>
})

/**
 * Las columnas que ve el layout: las del consumidor, con la de casillas adelante.
 *
 * Se inyecta acá y no más abajo para que todo lo demás —anclaje, anchos,
 * virtualización horizontal, pintado— la trate como a cualquier otra sin una
 * sola rama especial.
 */
const columnsWithSelection = computed<readonly DataTableColumn<TRow>[]>(() => {
  const propia = selectionColumnDef.value
  return propia ? [propia, ...props.columns] : props.columns
})

/**
 * El orden que ve el layout, con la casilla siempre adelante.
 *
 * Un orden guardado no conoce la clave de la columna de selección —no existía
 * cuando se guardó— y la reconciliación agrega al final lo que no reconoce. El
 * resultado era que la casilla apareciera DESPUÉS de la primera columna anclada,
 * que es justo donde nadie la busca.
 *
 * Forzarla adelante no le quita control a nadie: esa columna no se reordena, así
 * que su posición nunca fue una preferencia del usuario que haya que respetar.
 */
const effectiveColumnOrder = computed<readonly string[]>(() => {
  const guardado = columnOrder.value
  if (!props.selectionColumn || guardado.length === 0) return guardado
  return [SELECTION_COLUMN_KEY, ...guardado.filter((key) => key !== SELECTION_COLUMN_KEY)]
})

const layout = useColumnLayout<TRow>({
  columns: () => columnsWithSelection.value,
  defaultColumnWidth: () => props.defaultColumnWidth,
  visibility: columnVisibility,
  order: effectiveColumnOrder,
  widths: columnWidths,
  pinning: columnPinning,
  leadingOffset: () => rowNumberWidth.value,
  // El arrastre pide el ancho, el componente lo guarda. El layout no almacena
  // nada: así el ancho puede venir de un v-model o de un layout restaurado sin
  // que existan dos fuentes de verdad compitiendo.
  onWidthChange: (key, width) => {
    const current = columnWidths.value
    if (current[key] === width) return
    setColumnWidths({ ...current, [key]: width })
  },
})

// El template solo desenvuelve refs de nivel superior, no refs anidados dentro
// de un objeto. Se extraen los que el header necesita para no tener que escribir
// `.value` en el markup.
const { resolvedColumns, totalWidth, pinnedColumns } = layout

/**
 * Columnas que scrollean. Las ancladas van en sus propias tiras, quietas.
 */
const scrollingColumns = computed(() =>
  resolvedColumns.value.slice(pinnedColumns.value.scrollFrom, pinnedColumns.value.scrollTo),
)

/**
 * Las tres tiras del encabezado: anclada al inicio, la que scrollea, anclada al
 * final.
 *
 * ## Por qué tres contenedores y no uno
 *
 * Porque la fila de encabezado vive DENTRO del viewport y por lo tanto scrollea
 * sola —nadie la mueve, ni JS ni Vue—, y una columna anclada tiene que quedarse
 * quieta contra ese movimiento. Cada tira anclada se queda con `position: sticky`
 * y la del medio simplemente se deja llevar. Ninguna de las tres cuesta una
 * escritura por frame.
 *
 * Es el mismo reparto que en el cuerpo: fila que scrollea, carriles anclados que
 * el compositor sostiene. Ver `.dt-pinned-lane`.
 *
 * ## Los orígenes
 *
 * Las tiras se ubican una al lado de la otra —la fila de encabezado es un `flex`—
 * y cada una lleva su ORIGEN, que es la coordenada de canvas donde empieza. Las
 * celdas de adentro se posicionan restándolo, así que la misma pieza de markup
 * sirve para las tres y todas las posiciones siguen saliendo de `column.offset`,
 * que es la única fuente de verdad que comparten header y cuerpo.
 */
const headerStrips = computed(() => {
  const pinned = pinnedColumns.value
  const firstEndOffset = pinned.end[0]?.offset ?? 0
  // Donde termina la regleta y la tira anclada al inicio: ahí empieza la tira que
  // scrollea, porque el `flex` la coloca justo después de las dos.
  const scrollOrigin = rowNumberWidth.value + pinned.startWidth
  const scrollWidth = Math.max(0, totalWidth.value - scrollOrigin - pinned.endWidth)

  return [
    {
      id: 'start',
      className: 'dt-header-pinned dt-header-pinned--start',
      style: { width: `${pinned.startWidth}px` },
      origin: rowNumberWidth.value,
      columns: pinned.start,
    },
    {
      id: 'scroll',
      className: 'dt-header-inner',
      style: { width: `${scrollWidth}px` },
      origin: scrollOrigin,
      columns: scrollingColumns.value,
    },
    {
      id: 'end',
      className: 'dt-header-pinned dt-header-pinned--end',
      style: { width: `${pinned.endWidth}px` },
      origin: firstEndOffset,
      columns: pinned.end,
    },
  ]
})

/* ------------------------------------------------------------- Persistencia */

/**
 * Estado que se guarda y se restaura.
 *
 * El orden se materializa a partir de las columnas ya ordenadas en lugar de
 * guardar el array crudo: mientras el usuario no reordene nada, `columnOrder`
 * está vacío, y guardar un orden vacío haría que al volver no se restaure nada.
 * Guardar el orden efectivo deja el layout reproducible desde la primera sesión.
 */
const persistedState = computed<PersistedTableState>(() => {
  const state: PersistedTableState = {
    version: DEFAULT_PERSIST_VERSION,
    columnVisibility: { ...columnVisibility.value },
    columnWidths: { ...columnWidths.value },
    columnOrder: layout.orderedColumns.value.map((column) => column.key),
  }

  // Mismo criterio que el corte de agrupación: la clave solo aparece si el
  // usuario tocó algún ancla. Una tabla donde nadie presionó el botón escribe el
  // payload de siempre, así que los layouts guardados antes de que esto
  // existiera siguen valiendo y no hizo falta subir la versión del esquema.
  const pinning = columnPinning.value
  if (Object.keys(pinning).length > 0) state.columnPinning = { ...pinning }

  const criterios = sort.value
  if (criterios.length > 0) state.sort = criterios.map((entry) => ({ ...entry }))

  // El corte de agrupación solo aparece si hay algo que decir. Una tabla que
  // nunca agrupó escribe exactamente el mismo payload que antes de que esta
  // función existiera, que es lo que permitió sumarla sin subir la versión del
  // esquema ni invalidarle el layout guardado a nadie.
  const currentGroupBy = groupBy.value
  const collapsed = grouping.collapsedGroups.value
  if (currentGroupBy.length > 0 || collapsed.length > 0) {
    state.groupBy = [...currentGroupBy]
    state.collapsedGroups = [...collapsed]
  }

  return state
})

const persistence = useTablePersistence<TRow>({
  tableId: () => props.tableId,
  persist: () => props.persist,
  columns: () => props.columns,
  state: persistedState,
  onLoad: (loaded) => {
    // Llega ya reconciliado contra las columnas actuales: se puede aplicar tal
    // cual. Se pasa por los mismos setters que la UI para respetar el modo
    // controlado, donde el padre es quien decide si acepta el layout guardado.
    setColumnVisibility(loaded.columnVisibility)
    setColumnWidths(loaded.columnWidths)
    setColumnOrder(loaded.columnOrder)
    if (loaded.columnPinning !== undefined) setColumnPinning({ ...loaded.columnPinning })
    // Se aplica en silencio: restaurar un layout no es que el usuario haya
    // presionado un encabezado, y emitir `sortChange` aquí le dispararía una
    // consulta al servidor a cada montaje. El v-model sí se emite, que es lo que
    // un padre controlado necesita para quedar en sincronía.
    if (loaded.sort !== undefined) {
      if (props.sort === undefined) internalSort.value = [...loaded.sort]
      emit('update:sort', [...loaded.sort])
    }
    // El orden importa: `useRowGrouping` reconstruye su árbol de forma síncrona
    // al cambiar `groupBy`, y el conjunto colapsado se resuelve contra los grupos
    // que ese árbol tiene. Aplicarlo al revés lo resolvería contra el árbol viejo.
    if (loaded.groupBy !== undefined) setGroupBy([...loaded.groupBy])
    if (loaded.collapsedGroups !== undefined) grouping.setCollapsedGroups(loaded.collapsedGroups)
  },
})

const scroll = useScrollSync({
  viewport: viewportEl,
  onFrame: paintFrame,
})

/**
 * Alto del viewport disponible para FILAS.
 *
 * El encabezado vive dentro del viewport y se queda pegado arriba con
 * `position: sticky`: ocupa alto real del contenido y tapa esa franja. Todo lo
 * que traduzca entre scroll y filas tiene que descontarlo, o la ventana virtual
 * pediría más filas de las que caben y traer una celda a la vista la dejaría
 * justo debajo de los títulos.
 */
const rowViewportHeight = computed(() =>
  Math.max(0, scroll.state.value.viewportHeight - headerHeight.value),
)

/** Lo mismo, con las métricas VIVAS: para el teclado, que no espera al frame. */
function liveRowViewportHeight(): number {
  return Math.max(0, scroll.live.viewportHeight - headerHeight.value)
}

/**
 * El resolutor de alturas, ya envuelto para el composable de geometría.
 *
 * Traduce la posición visible a la fila que le toca, que es lo que el consumidor
 * espera recibir. `rowAt` devuelve `undefined` para una cabecera de grupo y para
 * una fila que el servidor todavía no mandó, y eso se pasa tal cual: son los dos
 * casos que el resolutor tiene documentado que puede recibir.
 *
 * Las dos lecturas sueltas de abajo son la SUSCRIPCIÓN y no un dato. Sin ellas
 * este `computed` solo dependería de `props.rowHeight`, así que reemplazar
 * `rows` por otro array del mismo largo —o plegar un grupo— devolvería el mismo
 * resolutor, y la geometría se quedaría con las alturas viejas sin que nada
 * avisara. Es el único lugar donde una dependencia tiene que declararse a mano,
 * porque la función del consumidor lee datos que el `computed` no toca.
 */
const rowHeightAt = computed<((index: number) => number) | null>(() => {
  const declared = props.rowHeight
  if (typeof declared !== 'function') return null

  void props.rows
  void grouping.flatRows.value

  return (index) => declared(grouping.rowAt(index), index)
})

const rowVirtual = useRowMetrics({
  rowCount: visibleRowCount,
  rowHeight,
  heightAt: rowHeightAt,
  viewportSize: () => rowViewportHeight.value,
  scrollOffset: () => scroll.state.value.scrollTop,
  overscan: () => props.overscan,
})

/** Atajo: la geometría vertical vigente. La leen el pool, el editor y el teclado. */
const rowMetrics = computed(() => rowVirtual.metrics.value)

/**
 * Los pedidos al consumidor cuando `rows` no tiene lo que la ventana necesita.
 *
 * Va DESPUÉS de `rowVirtual` porque necesita su ventana, y `visibleRowCount` va
 * antes porque la ventana lo necesita a él. Esa es toda la razón del orden: el
 * total lo calcula el componente y se lo pasa ya hecho, para que las dos cuentas
 * no puedan discrepar.
 *
 * Apagado —sin `rowCount`— este composable no hace absolutamente nada: el
 * barrido sale por la primera línea.
 */
const remote = useRemoteRows<TRow>({
  enabled: serverMode,
  total: visibleRowCount,
  rows: () => props.rows,
  pageSize: () => props.pageSize,
  prefetchPages: () => props.prefetchPages,
  window: () => rowVirtual.window.value,
  onRequest: (event) => emit('rowsRequest', event),
})

/**
 * Tramo horizontal de columnas a pintar.
 *
 * Con `virtualizeColumns` apagado se devuelve el rango completo: en tablas
 * angostas la búsqueda binaria y el recorte son overhead puro.
 */
const columnRange = computed(() => {
  const all = resolvedColumns.value
  if (!props.virtualizeColumns) return { start: 0, end: all.length }
  const metrics = scroll.state.value
  return layout.findColumnRange(metrics.scrollLeft, metrics.viewportWidth, props.overscan)
})

/**
 * Las columnas que el pool debe pintar en este frame.
 *
 * El `slice` asigna un array nuevo por frame, pero de ~15 elementos: es
 * irrelevante frente a evitar que el pool tenga que decidir por celda si le toca
 * pintar o no.
 */
const visibleColumns = computed<readonly ResolvedColumn<TRow>[]>(() =>
  resolvedColumns.value.slice(columnRange.value.start, columnRange.value.end),
)

/* ------------------------------------------------------------------- Pool */

const pool = useRowPool<TRow>({
  onCellDoubleClick: (position) => {
    editor.beginEdit(position)
  },
  onRowClick: (rowIndex) => {
    const row = grouping.rowAt(rowIndex)
    if (row === undefined) return
    // El índice que ve el consumidor es SIEMPRE el de su propio array: la
    // posición dentro de la vista aplanada no le sirve para nada, y confundirlas
    // le haría escribir sobre otra fila.
    emit('rowClick', { row, rowIndex: grouping.toSourceIndex(rowIndex) })
  },
  onCellPointerDown: (position) => {
    // Un clic simple SELECCIONA. No abre el editor: eso lo hacen el doble clic,
    // Enter y F2.
    if (props.selectionMode === 'none') return
    // Solo alcanza al editor de slot, que no confirma por `blur`: apuntar otra
    // celda es lo que lo cierra, con la misma semántica de hoja de cálculo que ya
    // aplicaba `beginEdit`. Los controles incluidos no pasan por aquí; los
    // confirma el `blur` que dispara el foco de la línea siguiente.
    editor.commitIfElsewhere(position)
    // El foco va PRIMERO: si había un editor abierto sobre otra celda, moverlo
    // dispara su `blur` y lo confirma antes de que la selección se mueva.
    focusViewport(position)
    selectCell(position)
  },
  onCellShiftPointerDown: (position) => {
    if (props.selectionMode === 'none') return
    // `Shift`+clic extiende: la celda activa —el ancla— se queda donde está, y
    // por eso este camino no pasa por `selectCell`, que la movería y colapsaría
    // el rango en el acto.
    editor.commitIfElsewhere(position)
    focusViewport(position)
    cellRange.extendTo(position)
  },
  onCellDragOver: (position) => {
    cellRange.extendTo(position)
  },
  onRowNumberPointerDown: (rowIndex) => {
    if (props.selectionMode === 'none') return
    // El foco va al viewport igual que con un clic en una celda: después de
    // seleccionar la fila, las flechas tienen que seguir funcionando.
    const columnKey = resolvedColumns.value[0]?.key
    if (columnKey !== undefined) focusViewport({ rowIndex, columnKey })
    selectWholeRow(rowIndex)
  },
  onCellToggle: (position, nextValue) => {
    // La casilla de selección comparte el gesto con las de datos —las dos son un
    // `<input type="checkbox">` dentro de una celda— pero no la tubería: marcar
    // una fila no edita nada, y un `beforeEdit` que vete la edición no tiene por
    // qué impedir seleccionarla.
    if (position.columnKey === SELECTION_COLUMN_KEY) {
      toggleRowAt(position.rowIndex)
      return
    }
    editor.commitValue(position, nextValue)
  },
  onGroupToggle: (groupId) => {
    grouping.toggleGroup(groupId)
  },
})

/**
 * Alterna la marca de una fila, por su posición VISIBLE.
 *
 * La posición solo sirve para llegar a la fila: lo que se guarda es su clave. Una
 * cabecera de grupo no es ninguna fila y no se marca.
 */
function toggleRowAt(rowIndex: number): void {
  const row = grouping.rowAt(rowIndex)
  if (row === undefined) return
  const key = rowKeyOf(row, grouping.toSourceIndex(rowIndex))
  setRowSelection(toggleRowSelection(selectedRowsState.value, key), 'row', row, key)
}

/**
 * En qué va la tricasilla del encabezado: vacía, cuadrito o palomita.
 *
 * Se mide contra el total del DATASET —`rowCount` en modo servidor— y no contra
 * lo cargado. Con 50 filas en memoria de 9000, marcar todo tiene que dejar la
 * casilla llena, no en "algunas".
 */
const headerSelectionState = computed(() =>
  rowSelectionHeaderState(selectedRowsState.value, selectableRowCount.value),
)

/**
 * La casilla del encabezado, para escribirle sus propiedades a mano.
 *
 * `checked` e `indeterminate` no se ligan: ver el comentario en el template.
 */
const headerSelectionInput = shallowRef<HTMLInputElement | null>(null)

function registerHeaderSelectionInput(el: unknown): void {
  headerSelectionInput.value = el instanceof HTMLInputElement ? el : null
}

watchEffect(
  () => {
    const input = headerSelectionInput.value
    if (!input) return
    const estado = headerSelectionState.value
    input.checked = estado === 'all'
    input.indeterminate = estado === 'some'
  },
  // Después de que Vue tocó el DOM: antes, el nodo podría no existir todavía.
  { flush: 'post' },
)

const headerSelectionLabel = computed(() =>
  headerSelectionState.value === 'all' ? 'Quitar la selección' : 'Seleccionar todas las filas',
)

/**
 * El gesto del encabezado: marcar todo o limpiar.
 *
 * Marcar todo entra en modo `'all'`, que es lo único que puede responder por
 * filas que no se descargaron. Con algunas marcadas, el gesto LIMPIA en vez de
 * completar: es lo que espera quien acaba de marcar tres a mano y presiona la
 * casilla para deshacerlo.
 */
function onHeaderSelectionToggle(): void {
  const marcarTodas = headerSelectionState.value === 'none'
  setRowSelection(setAllRowsSelected(marcarTodas), marcarTodas ? 'all' : 'none', null, null)
}

/**
 * ¿Se muestra el mensaje de tabla vacía?
 *
 * Tres condiciones, y cada una descarta un estado que NO es "no hay datos":
 * que haya filas, que se esté esperando —ver `loading`— y que el consumidor
 * tenga algo que decir. El último se mide con la cadena ya recortada, porque un
 * texto de puros espacios no se ve y de todas formas arrastraría la caja.
 */
const showEmptyMessage = computed(
  () => props.rows.length === 0 && !isLoading.value && props.emptyText.trim().length > 0,
)

/** Valor actual de una celda, para poder alternarlo desde el teclado. */
function readCurrentValue(position: CellPosition): CellValue {
  const row = grouping.rowAt(position.rowIndex)
  const column = layout.getResolvedColumn(position.columnKey)?.column
  if (row === undefined || !column) return undefined
  return readCellValue(column, row)
}

/**
 * Reescribe el índice de fila de un evento al del dataset del consumidor.
 *
 * Es el ÚNICO punto por el que un índice de la vista aplanada puede salir del
 * componente, y por eso se hace aquí y no en cada emisión. Adentro todo trabaja en
 * coordenadas visibles —que es lo que necesitan la geometría del editor, el
 * auto-scroll y las flechas—; afuera, el consumidor solo puede escribir sobre su
 * propio array.
 *
 * Se muta el evento en lugar de copiarlo a propósito: `BeforeEditEvent` lleva un
 * `cancel()` que cierra sobre el objeto original, y una copia dejaría al listener
 * viendo `canceled: false` después de haber vetado la edición.
 */
function withSourceRowIndex<TEvent extends { rowIndex: number }>(event: TEvent): TEvent {
  event.rowIndex = grouping.toSourceIndex(event.rowIndex)
  return event
}

/* --------------------------------------------------------------- Selección */

/**
 * Celda activa: controlada o no controlada, igual que el trío de columnas.
 *
 * La comparación es contra `undefined` y no contra un valor falsy, porque `null`
 * es un estado legítimo del modo controlado: significa "el padre manda y ahora
 * mismo no hay nada seleccionado". Confundirlos haría que un padre que limpia la
 * selección perdiera el control sobre ella.
 */
const internalActiveCell = shallowRef<CellPosition | null>(null)

const activeCell = computed<CellPosition | null>(() =>
  props.activeCell !== undefined ? props.activeCell : internalActiveCell.value,
)

/** Índice de la columna activa dentro de las columnas VISIBLES, o -1. */
const activeColumnIndex = computed(() => {
  const current = activeCell.value
  if (!current) return -1
  return resolvedColumns.value.findIndex((column) => column.key === current.columnKey)
})

/* ------------------------------------------------------- Rango de celdas */

/**
 * Si el rango está habilitado ahora mismo.
 *
 * `'row'` queda afuera porque ahí la unidad seleccionada es la fila entera y un
 * rectángulo de celdas no significaría nada; `'none'` porque no hay selección de
 * ninguna clase.
 */
const rangeEnabled = computed(() => props.rangeSelection && props.selectionMode === 'cell')

/**
 * En modo fila la unidad elegida es la FILA, y la columna deja de ser parte de
 * la selección.
 *
 * Adentro sigue habiendo una celda activa —el teclado necesita una posición y el
 * editor necesita saber qué se edita—, pero su columna no se pinta. Todo lo que
 * la exponía o actuaba sobre ella cuelga de esta bandera: si el usuario no puede
 * VER en qué columna está, ninguna tecla puede moverlo por ellas ni decidir
 * según cuál sea. Lo contrario es lo que había: el encabezado marcaba una
 * columna que la fila no decía, las flechas la corrían sin que se viera nada
 * moverse, y `Enter` abría el editor de una celda que el usuario no eligió.
 */
const rowMode = computed(() => props.selectionMode === 'row')

/**
 * El rango, con la celda activa como ancla.
 *
 * No es un segundo estado de selección: el ancla ES `activeCell`, y aquí solo
 * vive la punta que se mueve. Ver la cabecera de `useCellRange`.
 */
const cellRange = useCellRange<TRow>({
  enabled: () => rangeEnabled.value,
  columns: () => resolvedColumns.value,
  rowCount: () => visibleRowCount.value,
  anchor: () => activeCell.value,
  setAnchor: (position) => selectCell(position),
})

/**
 * El rectángulo que se pinta: solo cuando abarca más de una celda.
 *
 * Con una sola celda seleccionada no hay nada que teñir ni que recuadrar —la
 * marca de celda activa ya lo dice—, así que el pool recibe `null` y ni entra en
 * la comparación por celda.
 */
const rangeRect = computed<RangeRect | null>(() =>
  cellRange.range.value ? cellRange.rect.value : null,
)

/**
 * Geometría de un rectángulo de celdas, en coordenadas del canvas.
 *
 * Es aritmética pura sobre el layout ya resuelto, igual que la del editor: ni un
 * `getBoundingClientRect`. La comparten el recuadro de la selección y el
 * destello del copiado, que son dos cajas sobre la misma caja.
 */
function boxStyleFor(rect: RangeRect): Record<string, string> | null {
  const columns = resolvedColumns.value
  const first = columns[rect.columnStart]
  const last = columns[rect.columnEnd]
  if (!first || !last) return null

  // Las puntas se resuelven por su posición REAL, no por su offset: con una
  // columna anclada en un extremo, el recuadro tiene que abrazar donde la
  // columna está, no donde estaría si scrolleara con el resto.
  const left = columnCanvasX(first)
  const right = columnCanvasX(last) + last.width

  // El alto del recuadro es la distancia entre el borde de arriba de la primera
  // fila y el de abajo de la última, no la cantidad de filas por el alto: con
  // alturas distintas esas dos cuentas dejan de coincidir.
  const geometry = rowMetrics.value
  const top = geometry.offsetOf(rect.rowStart)
  const bottom = geometry.offsetOf(rect.rowEnd) + geometry.sizeOf(rect.rowEnd)

  return {
    transform: `translate3d(${left}px, ${top}px, 0)`,
    width: `${Math.max(0, right - left)}px`,
    height: `${Math.max(0, bottom - top)}px`,
  }
}

/**
 * El recuadro de la selección.
 *
 * Es un `computed` de Vue y no una escritura del pool porque cambia cuando
 * cambia la SELECCIÓN —decenas de veces durante un arrastre— y no una vez por
 * frame de scroll: vive dentro del viewport que se desplaza, así que scrollear
 * no lo mueve ni lo recalcula.
 */
const rangeBox = computed<Record<string, string> | null>(() => {
  const rect = rangeRect.value
  return rect ? boxStyleFor(rect) : null
})

/* --------------------------------------------------- Destello del copiado */

/**
 * Cuánto dura la confirmación de un copiado.
 *
 * Es el dueño del número: el nodo se quita al vencer este plazo y la duración de
 * la animación se escribe inline a partir de él, así que el CSS no puede quedar
 * desincronizado y dejar la línea de otro color en pantalla.
 */
const COPY_FLASH_MS = 520

/**
 * Confirmación vigente, o `null`.
 *
 * El `id` existe para que dos copiados seguidos se vean como dos: se usa como
 * `key`, así que Vue reemplaza el nodo y la animación vuelve a arrancar. Sin
 * eso, el segundo `Ctrl`+`C` no mostraría nada, porque una animación CSS no se
 * reinicia sola sobre un elemento que ya la terminó.
 */
const copyFlash = shallowRef<{ id: number; style: Record<string, string> } | null>(null)

let copyFlashCount = 0
let copyFlashTimer = 0

/**
 * Confirma visualmente un copiado sobre el área que se copió.
 *
 * Es un nodo aparte y no una clase sobre el recuadro de la selección porque el
 * copiado también alcanza a UNA celda, y ahí no hay recuadro: el contorno lo
 * dibuja la propia celda activa, que es territorio del pool. Con una caja propia,
 * la misma confirmación sirve para los dos casos y no le agrega ni un estado al
 * camino caliente.
 */
function flashCopied(rect: RangeRect): void {
  const style = boxStyleFor(rect)
  if (!style) return

  copyFlashCount += 1
  copyFlash.value = {
    id: copyFlashCount,
    style: { ...style, animationDuration: `${COPY_FLASH_MS}ms` },
  }

  if (copyFlashTimer !== 0) clearTimeout(copyFlashTimer)
  copyFlashTimer = window.setTimeout(() => {
    copyFlash.value = null
    copyFlashTimer = 0
  }, COPY_FLASH_MS)
}

/**
 * Si una columna cae dentro del rango, mirando solo el eje horizontal.
 *
 * Alimenta la marca del encabezado, que es lo que vuelve legible una selección
 * de varias columnas: el rectángulo puede estar íntegramente fuera de la
 * pantalla —una columna entera de 50.000 filas— y el encabezado seguir a la
 * vista.
 */
function isColumnInRange(columnIndex: number): boolean {
  const rect = rangeRect.value
  return rect !== null && columnIndex >= rect.columnStart && columnIndex <= rect.columnEnd
}

/** Columnas abarcadas por un rectángulo, en orden visual. */
function columnsOfRect(rect: RangeRect): DataTableColumn<TRow>[] {
  const columns = resolvedColumns.value
  const slice: DataTableColumn<TRow>[] = []
  for (let index = rect.columnStart; index <= rect.columnEnd; index += 1) {
    const column = columns[index]
    if (column) slice.push(column.column)
  }
  return slice
}

/**
 * Anuncia el rango cada vez que cambia.
 *
 * Se observa `range` y no `rect`: el rectángulo también cambia al ocultar una
 * columna o al plegar un grupo, y eso no es una selección nueva sino la misma
 * reinterpretada. El evento describe SIEMPRE lo que está seleccionado ahora, así
 * que al colapsar viaja `range: null` con el rectángulo de una sola celda de la
 * celda activa.
 */
watch(
  () => cellRange.range.value,
  (range) => {
    const rect = cellRange.rect.value
    // Sin rectángulo no hay nada que contar que `update:activeCell` no haya
    // dicho ya: o no hay celda activa, o su columna está oculta.
    if (!rect) return
    emit('rangeSelect', {
      range,
      rowStart: rect.rowStart,
      rowEnd: rect.rowEnd,
      columns: columnsOfRect(rect),
    })
  },
)

/* ------------------------------- Seleccionar una columna o una fila entera */

/**
 * Selecciona una columna completa, de la primera fila a la última.
 *
 * Es un RANGO, no un estado nuevo: se copia, se extiende y se deshace con las
 * mismas reglas que cualquier otra selección. Ese es todo el motivo por el que
 * esta función son tres líneas en vez de un sistema aparte.
 *
 * No desplaza la vista aunque el ancla quede en la fila 0 y el usuario esté
 * mirando la 500: pidió seleccionar una columna, no ir a ningún lado.
 */
function selectWholeColumn(columnKey: string): void {
  if (!props.columnSelection || !rangeEnabled.value) return

  const rowCount = visibleRowCount.value
  if (rowCount === 0) return

  cellRange.set({
    anchor: { rowIndex: 0, columnKey },
    focus: { rowIndex: rowCount - 1, columnKey },
  })
}

/**
 * Selecciona una fila completa, de la primera columna visible a la última.
 *
 * Las columnas ocultas no entran, y no es un detalle: lo que se selecciona es lo
 * que se ve, así que copiar la fila devuelve exactamente las columnas que el
 * usuario tiene delante.
 */
function selectWholeRow(rowIndex: number): void {
  if (!props.rowSelection || !rangeEnabled.value) return

  const columns = resolvedColumns.value
  const first = columns[0]
  const last = columns[columns.length - 1]
  if (!first || !last) return

  cellRange.set({
    anchor: { rowIndex, columnKey: first.key },
    focus: { rowIndex, columnKey: last.key },
  })
}

/**
 * Clic sobre el encabezado de una columna.
 *
 * Se atiende en `pointerdown` y no en `click` por lo mismo que las celdas: la
 * marca tiene que aparecer al presionar. El handle de redimensionado queda afuera
 * —es un hijo del encabezado y tiene su propio gesto—, porque terminar un
 * arrastre de ancho seleccionando la columna sería una sorpresa en cada resize.
 */
/**
 * Clic que hay que ignorar porque el gesto terminó siendo un arrastre.
 *
 * El navegador emite `click` después de un `pointerup`, también cuando entre los
 * dos hubo un arrastre completo. Sin esta bandera, mover una columna la ordenaba
 * de paso.
 */
let headerClickWasDrag = false

/**
 * Si el gesto sobre un encabezado quiere SELECCIONAR la columna en vez de
 * ordenarla.
 *
 * ## Quién se queda con el clic pelado
 *
 * Sobre el encabezado conviven dos acciones cuando `columnSelection` está
 * encendida, y no caben en el mismo gesto. **Se la queda ordenar**, por dos
 * razones:
 *
 * - Presionar un encabezado para ordenar es la interacción más común que existe en
 *   una grilla; seleccionar la columna entera para copiarla es ocasional. La
 *   acción frecuente tiene que llevarse el gesto frecuente.
 * - Al revés quedaba un agujero: con `columnSelection` encendida y sin
 *   `columnMenu`, una columna con `sortable: true` no hacía absolutamente nada.
 *   Una prop que se enciende y no pasa nada es peor que una que falla.
 *
 * Seleccionar pasa entonces a `Ctrl`/`Cmd`+clic, que no es una convención nueva:
 * es el mismo modificador de `Ctrl`/`Cmd`+`A`, `Ctrl`/`Cmd`+`C` y
 * `Ctrl`/`Cmd`+`Home`. `Shift` no servía —lo usa el orden multinivel—.
 *
 * En una columna que NO ordena no hay conflicto, y el clic pelado la selecciona
 * como siempre.
 */
function headerGestureIsSelection(event: MouseEvent, column: ResolvedColumn<TRow>): boolean {
  if (!props.columnSelection) return false
  // Solo compite con el clic la columna que ordena AL CLIC: con `sortable:
  // 'menu'` el gesto está libre y la selección se lo queda sin modificador.
  if (!column.sortOnHeaderClick) return true
  return event.ctrlKey || event.metaKey
}

/**
 * Clic sobre el encabezado: cambia el orden de la columna.
 *
 * Va en `click` y no en `pointerdown` —al revés que la selección de columna—
 * porque sobre el mismo encabezado empieza el arrastre de reordenamiento, y
 * ordenar al presionar dejaría la tabla reordenada cada vez que alguien intenta
 * mover una columna.
 */
function onHeaderClick(event: MouseEvent, column: ResolvedColumn<TRow>): void {
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('.dt-resize-handle, .dt-pin-button, .dt-menu-button')
  )
    return

  if (headerClickWasDrag) {
    headerClickWasDrag = false
    return
  }
  // El `pointerdown` ya seleccionó la columna: este `click` es la cola del mismo
  // gesto y no tiene que ordenar además.
  if (headerGestureIsSelection(event, column)) return
  // Con `sortable: 'menu'` la columna se ordena, pero no desde aquí.
  if (!column.sortOnHeaderClick) return

  toggleSort(column, event.shiftKey)
}

function onHeaderPointerDown(event: PointerEvent, column: ResolvedColumn<TRow>): void {
  const target = event.target
  // Los tres controles que viven adentro del encabezado —redimensionar, anclar
  // y el menú— tienen su propio gesto: ninguno selecciona la columna, la mueve
  // ni la ordena. Sin esta línea, presionar el botón de anclar arrancaría además
  // un arrastre, y abrir el menú ordenaría la columna de paso.
  if (
    target instanceof Element &&
    target.closest('.dt-resize-handle, .dt-pin-button, .dt-menu-button')
  )
    return
  if (event.button !== 0) return

  if (props.columnReorder && column.reorderable) startColumnDrag(event, column)
  // Con una columna ordenable, el clic pelado es para ordenar y la selección
  // pide `Ctrl`/`Cmd`. Ver `headerGestureIsSelection`.
  if (!headerGestureIsSelection(event, column)) return

  /*
   * `preventDefault` aquí no es ceremonia: sin él, el copiado no funciona.
   *
   * Presionar sobre un elemento que no es enfocable hace que el navegador lleve el
   * foco a su ancestro enfocable más cercano, y el del encabezado no es el
   * viewport —vive afuera— sino el `body`. Ese movimiento ocurre DESPUÉS de este
   * manejador, así que pisaba el `focusViewport` de abajo y dejaba a la tabla sin
   * foco: `Ctrl`+`C` no llegaba a su listener y el navegador copiaba la
   * selección vacía de la página.
   *
   * Un clic sobre una CELDA no tiene este problema y por eso no lo necesita: la
   * celda sí está adentro del viewport, así que el ancestro que el navegador
   * elige es justamente el que queremos.
   */
  event.preventDefault()

  focusViewport({ rowIndex: 0, columnKey: column.key })
  selectWholeColumn(column.key)
}

/**
 * Apagar el rango —por prop o por cambio de modo— colapsa el que hubiera.
 *
 * Sin esto, el rectángulo pintado sobreviviría a la prop que lo habilitaba: la
 * tabla quedaría mostrando una selección que ya no se puede mover ni deshacer.
 */
watch(rangeEnabled, (enabled) => {
  if (!enabled) cellRange.collapse()
})

/**
 * Lleva el foco al viewport cuando el puntero apunta una celda.
 *
 * Es necesario porque las celdas NO son enfocables: el manejador de teclado vive
 * en `.dt-viewport` y solo ve las teclas mientras el foco esté ahí adentro.
 * Antes esto pasaba de rebote —cada celda llevaba `tabindex="-1"`, el clic la
 * enfocaba a ella y desde ahí las teclas burbujeaban hasta el viewport—, pero
 * ese mismo `tabindex` era el que hacía que el navegador le pintara un anillo de
 * `:focus-visible` a una celda distinta de la activa, y se veían DOS celdas
 * seleccionadas. Quitado el `tabindex`, el foco deja de ser un efecto colateral
 * y se pide explícitamente, en un único lugar.
 *
 * Dos guardas:
 *
 * 1. Si el viewport ya tiene el foco no se hace nada. Es el caso de venir
 *    navegando con el teclado, y reenfocar sería trabajo sin cambio.
 * 2. Si hay un editor abierto sobre ESTA misma celda, el foco le pertenece al
 *    control y quitárselo lo cerraría por `blur`. Un clic sobre OTRA celda sí
 *    mueve el foco: esa edición se confirma igual —es la misma semántica de
 *    hoja de cálculo que ya aplica `beginEdit`— y el teclado tiene que quedar
 *    apuntando al viewport.
 *
 * En modo `none` no se llega hasta aquí: el llamador corta antes, así que una
 * tabla sin selección nunca le roba el foco a nada de la página.
 */
function focusViewport(position: CellPosition): void {
  const viewport = viewportEl.value
  if (!viewport || viewport.ownerDocument.activeElement === viewport) return

  const editing = editor.editing.value
  if (
    editing !== null &&
    editing.rowIndex === position.rowIndex &&
    editing.columnKey === position.columnKey
  ) {
    return
  }

  // `preventScroll` no es un detalle: por defecto, enfocar un elemento lo
  // desplaza a la vista, y el viewport puede ser más alto que la ventana. Sin
  // esto, hacer clic en una celda movería el scroll de la PÁGINA para encuadrar
  // la tabla, justo debajo del puntero del usuario. El foco aquí se toma para
  // habilitar el teclado, no para llevar a nadie a ningún lado.
  viewport.focus({ preventScroll: true })
}

/**
 * Fija la celda activa y avisa.
 *
 * Emite siempre, incluso sin controlar, para que un consumidor pueda escuchar la
 * selección sin tomar posesión del estado.
 */
function selectCell(position: CellPosition | null): void {
  // ANTES de la comparación de abajo, que corta cuando la posición no cambió.
  // Volver a hacer clic sobre el ancla de un rango no mueve la celda activa y
  // aun así tiene que deshacer el rango: es la forma normal de deseleccionar.
  cellRange.collapse()

  const current = activeCell.value
  if (
    (current === null && position === null) ||
    (current !== null &&
      position !== null &&
      current.rowIndex === position.rowIndex &&
      current.columnKey === position.columnKey)
  ) {
    return
  }

  if (props.activeCell === undefined) internalActiveCell.value = position
  emit('update:activeCell', position)

  if (!position) return

  // Una cabecera de grupo se puede recorrer con el teclado, pero no representa
  // ninguna fila: `rowAt` devuelve `undefined` y no hay selección que anunciar.
  const row = grouping.rowAt(position.rowIndex)
  const column = layout.getResolvedColumn(position.columnKey)?.column
  if (row === undefined || !column) return

  emit('cellSelect', {
    row,
    rowIndex: grouping.toSourceIndex(position.rowIndex),
    column,
    columnKey: position.columnKey,
    value: readCellValue(column, row),
  })
}

/**
 * Desplaza lo MÍNIMO necesario para que una celda quede visible.
 *
 * Mínimo y no centrado: centrar mueve la vista incluso cuando la celda ya estaba
 * a la vista, y al navegar con flechas eso produce un salto en cada tecla que
 * desorienta. Con el ajuste mínimo, moverse dentro de la ventana no desplaza
 * nada y llegar al borde corre exactamente una fila o una columna.
 *
 * Se leen las métricas VIVAS y no el espejo reactivo: el espejo se publica una
 * vez por frame y podría estar un frame atrasado, lo que haría calcular el
 * desplazamiento contra una posición que ya cambió. Escribir el scroll dispara
 * el evento nativo, así que el repintado sigue el camino de siempre y no pelea
 * con el acelerador de rAF.
 *
 * ## Los dos ejes son independientes, y es deliberado
 *
 * Si la columna no resuelve —está oculta, o la clave es desconocida— el eje
 * horizontal no se mueve y el VERTICAL SÍ. No es un caso a medio resolver: son
 * dos coordenadas separadas, y `rowIndex` sigue siendo un número de fila válido
 * sin importar qué diga `columnKey`. Llevar la fila a la vista es exactamente lo
 * que se pidió en el eje sobre el que sí había información.
 *
 * Lo contrario —cortar y no hacer nada— rompería el caso ordinario de una celda
 * activa cuya columna el usuario acaba de ocultar: la navegación vertical
 * dejaría de traer filas a la vista por un motivo que no tiene nada que ver con
 * el eje vertical.
 *
 * ## No acota el índice de fila, y `scrollToRow` sí
 *
 * La asimetría es real. `scrollToRow` es un salto absoluto que el consumidor
 * pide con un número, y acotarlo es lo que convierte un índice fuera de rango en
 * el borde más cercano en vez de en una posición vacía. `scrollToCell` recibe
 * una posición de celda que en el camino interno YA viene acotada por
 * `moveActiveTo`, así que volver a acotarla aquí sería trabajo repetido en cada
 * flecha.
 *
 * Lo que SÍ está acotado es la geometría: preguntarle dónde empieza una fila que
 * no existe devuelve el final del contenido, no un píxel inventado. Es
 * inevitable —con alturas variables, más allí de la última fila no hay nada que
 * sumar— y no cambia nada de lo que se ve: el navegador acota la escritura de
 * `scrollTop` contra la altura real del canvas, así que la vista se queda en el
 * extremo igual que antes.
 */
function scrollToCell(position: CellPosition): void {
  const metrics = scroll.live
  const geometry = rowMetrics.value

  const rowTop = geometry.offsetOf(position.rowIndex)
  const rowBottom = rowTop + geometry.sizeOf(position.rowIndex)
  // El encabezado tapa la franja de arriba, igual que la regleta tapa la de la
  // izquierda: el alto visible para filas es el del viewport menos el suyo.
  const visibleHeight = liveRowViewportHeight()
  let top = metrics.scrollTop
  if (rowTop < top) top = rowTop
  else if (rowBottom > top + visibleHeight) top = rowBottom - visibleHeight

  let left = metrics.scrollLeft
  const column = layout.getResolvedColumn(position.columnKey)
  if (column) {
    const columnRight = column.offset + column.width
    // La regleta tapa la franja izquierda del viewport, así que el borde visible
    // para una columna no es `scrollLeft` sino `scrollLeft + regleta`. Sin esto,
    // traer una celda a la vista la dejaba justo debajo de los números.
    const gutter = rowNumberWidth.value
    if (column.offset - gutter < left) left = column.offset - gutter
    else if (columnRight > left + metrics.viewportWidth) left = columnRight - metrics.viewportWidth
  }

  top = Math.max(0, top)
  left = Math.max(0, left)
  if (top === metrics.scrollTop && left === metrics.scrollLeft) return
  scroll.scrollTo({ top, left })
}

/* ---------------------------------------------- Navegación con el teclado */

/**
 * Cantidad de filas que entran enteras en el viewport. Mínimo 1.
 *
 * Con alturas uniformes es una división y da lo mismo dónde esté el scroll. Con
 * alturas mezcladas no existe "la cantidad de filas que entran" como número
 * único: entran las que entren DESDE DONDE UNO ESTÁ, y por eso la cuenta parte
 * del scroll vivo. Un `Av Pág` sobre un tramo de filas altas avanza menos filas
 * que sobre uno de filas bajas, que es exactamente lo que el usuario ve.
 */
function pageSize(): number {
  const visible = liveRowViewportHeight()
  const geometry = rowMetrics.value
  if (!geometry.variable) return Math.max(1, Math.floor(visible / rowHeight.value))

  const top = scroll.live.scrollTop
  return Math.max(1, geometry.indexAt(top + visible) - geometry.indexAt(top))
}

/**
 * Mueve la selección a una coordenada de la grilla y la trae a la vista.
 *
 * Trabaja sobre las columnas RESUELTAS, que ya excluyen las ocultas y respetan
 * el orden vigente. Navegar sobre la prop `columns` haría que una flecha se
 * detuviera en una columna invisible y pareciera que la tecla no funciona.
 */
function moveActiveTo(rowIndex: number, columnIndex: number): void {
  const columns = resolvedColumns.value
  const rowCount = visibleRowCount.value
  if (columns.length === 0 || rowCount === 0) return

  const clampedRow = Math.min(Math.max(rowIndex, 0), rowCount - 1)
  const clampedColumn = Math.min(Math.max(columnIndex, 0), columns.length - 1)
  const column = columns[clampedColumn]
  if (!column) return

  const position: CellPosition = { rowIndex: clampedRow, columnKey: column.key }
  selectCell(position)
  scrollToCell(position)
}

/**
 * La punta que mueve `Shift`: el foco del rango, o la celda activa si no hay.
 *
 * Es lo que hace que `Shift`+flecha crezca desde donde quedó la última vez y no
 * desde el ancla. Sin esto, dos `Shift`+↓ seguidas seleccionarían siempre las
 * mismas dos filas.
 */
function currentFocus(): CellPosition | null {
  return cellRange.range.value?.focus ?? activeCell.value
}

/**
 * Extiende el rango hasta una coordenada de la grilla y la trae a la vista.
 *
 * Es el gemelo de {@link moveActiveTo}: mismo acotado, mismo desplazamiento
 * mínimo, y lo único que cambia es qué punta se mueve. La celda activa —el
 * ancla— no se toca.
 */
function extendActiveTo(rowIndex: number, columnIndex: number): void {
  const columns = resolvedColumns.value
  const rowCount = visibleRowCount.value
  if (columns.length === 0 || rowCount === 0) return

  const clampedRow = Math.min(Math.max(rowIndex, 0), rowCount - 1)
  const column = columns[Math.min(Math.max(columnIndex, 0), columns.length - 1)]
  if (!column) return

  const position: CellPosition = { rowIndex: clampedRow, columnKey: column.key }
  cellRange.extendTo(position)
  scrollToCell(position)
}

/**
 * Extiende el rango relativo a la punta móvil.
 *
 * Sin nada seleccionado no hay punta que mover, así que la tecla hace lo mismo
 * que haría sin `Shift`: sembrar la posición. Es la misma regla que ya aplica
 * {@link moveActiveBy}, un nivel más arriba.
 */
function extendActiveBy(rowDelta: number, columnDelta: number): void {
  const focus = currentFocus()
  if (!focus) {
    moveActiveBy(rowDelta, columnDelta)
    return
  }

  const columnIndex = resolvedColumns.value.findIndex((column) => column.key === focus.columnKey)
  extendActiveTo(focus.rowIndex + rowDelta, Math.max(columnIndex, 0) + columnDelta)
}

/** Una flecha: mueve la selección, o la extiende si viene con `Shift`. */
function moveOrExtendBy(extend: boolean, rowDelta: number, columnDelta: number): void {
  if (extend && rangeEnabled.value) extendActiveBy(rowDelta, columnDelta)
  else moveActiveBy(rowDelta, columnDelta)
}

/** Un salto absoluto —`Home`, `End`—: mueve, o extiende si viene con `Shift`. */
function moveOrExtendTo(extend: boolean, rowIndex: number, columnIndex: number): void {
  if (extend && rangeEnabled.value) extendActiveTo(rowIndex, columnIndex)
  else moveActiveTo(rowIndex, columnIndex)
}

/**
 * La fila sobre la que trabajan `Home` y `End`: la punta que se va a mover.
 *
 * Con `Shift` se mueve el foco, así que el salto es al principio o al final de
 * SU fila; sin `Shift` se mueve la celda activa y la fila es la de ella. Usar
 * siempre la misma haría que `Home` sobre un rango saltara a una fila donde la
 * celda activa no está.
 */
function rowForAbsoluteJump(extend: boolean): number {
  const position = extend && rangeEnabled.value ? currentFocus() : activeCell.value
  return position?.rowIndex ?? 0
}

/**
 * Índice con el que entra un eje cuando todavía no hay nada seleccionado.
 *
 * La selección entra a la grilla por el borde OPUESTO al sentido del
 * movimiento, que es de donde viene: bajando se entra por arriba, subiendo se
 * entra por abajo. Un delta nulo no expresa intención sobre ese eje y arranca
 * por el principio.
 */
function seedIndexFor(delta: number, count: number): number {
  return delta < 0 ? count - 1 : 0
}

/**
 * Mueve la selección relativa a donde está. Se acota en los bordes, no da la
 * vuelta.
 *
 * ## Sin celda activa la tecla SIEMBRA, no mueve
 *
 * Esta función tomaba el origen (0, primera columna) cuando no había selección y
 * después le aplicaba el delta, con lo cual la primera flecha hacia abajo
 * aterrizaba en la fila 1 y se salteaba la 0. El error no está en el acotado
 * sino en el orden: sin celda activa no existe un "donde está" al que aplicarle
 * un desplazamiento, así que la primera tecla tiene que FIJAR la posición y no
 * moverse desde una inventada.
 *
 * Con la posición sembrada, la primera flecha hacia abajo o hacia la derecha
 * selecciona la primera fila o la primera columna visible, y la primera flecha
 * hacia arriba o hacia la izquierda selecciona la última. La misma regla vale
 * para PageUp y PageDown, que también son movimientos con sentido.
 *
 * `Home` y `End` no pasan por aquí justamente porque no son movimientos con
 * sentido sino saltos absolutos: ver el manejador de teclado.
 *
 * ## El `Math.max(..., 0)` es una RECUPERACIÓN, y se conserva a propósito
 *
 * `activeColumnIndex` vale -1 cuando la columna de la posición activa no
 * resuelve a ninguna columna pintada: o la clave es desconocida, o el usuario
 * ocultó la columna donde estaba parado. Ese segundo caso es estado legítimo y
 * llega por una acción normal del usuario.
 *
 * Desde ahí, el acotado a 0 hace que la flecha siguiente reingrese a la grilla
 * por la primera columna visible en vez de no hacer nada. Convertirlo en un
 * no-op dejaría al usuario atrapado: sin marca en pantalla y sin ninguna tecla
 * que lo saque de ahí, la única salida sería el mouse. Un teclado que no
 * responde es peor accesibilidad que un reingreso predecible.
 */
function moveActiveBy(rowDelta: number, columnDelta: number): void {
  const current = activeCell.value
  if (!current) {
    moveActiveTo(
      seedIndexFor(rowDelta, visibleRowCount.value),
      seedIndexFor(columnDelta, resolvedColumns.value.length),
    )
    return
  }

  moveActiveTo(current.rowIndex + rowDelta, Math.max(activeColumnIndex.value, 0) + columnDelta)
}

/**
 * Avanza o retrocede una celda en orden de lectura.
 *
 * A diferencia de las flechas, aquí sí se pasa a la fila siguiente o anterior al
 * llegar al borde: es lo que hace Tab en un formulario y en una hoja de cálculo, y es
 * lo que permite recorrer la tabla entera sin levantar la mano del teclado.
 */
function moveActiveInReadingOrder(forward: boolean): void {
  const columns = resolvedColumns.value
  const rowCount = visibleRowCount.value
  if (columns.length === 0 || rowCount === 0) return

  const current = activeCell.value
  const rowIndex = current ? current.rowIndex : 0
  const columnIndex = current ? Math.max(activeColumnIndex.value, 0) : 0

  if (forward) {
    if (columnIndex < columns.length - 1) moveActiveTo(rowIndex, columnIndex + 1)
    else if (rowIndex < rowCount - 1) moveActiveTo(rowIndex + 1, 0)
    return
  }

  if (columnIndex > 0) moveActiveTo(rowIndex, columnIndex - 1)
  else if (rowIndex > 0) moveActiveTo(rowIndex - 1, columns.length - 1)
}

/**
 * Cabecera de grupo bajo la celda activa, o `null`.
 *
 * Es lo que decide si una tecla significa "plegar" o lo que significa siempre.
 * Se consulta por posición y no por un estado aparte: la fila activa puede pasar
 * de ser un grupo a ser una fila de datos sin que nadie mueva la selección, con
 * solo colapsar el grupo de más arriba.
 */
function activeGroupRow(): GroupRow | null {
  const current = activeCell.value
  if (!current) return null
  const entry = grouping.entryAt(current.rowIndex)
  return entry !== null && entry.kind === 'group' ? entry : null
}

/** Abre el editor sobre la celda activa, o alterna si es una casilla. */
function editActiveCell(initialText?: string): void {
  const position = activeCell.value
  if (!position) return

  // Una casilla no abre control flotante: se alterna por la misma tubería que
  // usa el clic, veto incluido.
  if (editor.resolveEditorType(position) === 'checkbox') {
    editor.commitValue(position, !(readCurrentValue(position) === true))
    return
  }

  editor.beginEdit(position, initialText)
}

/**
 * Manejador de teclado de la grilla.
 *
 * Vive en el viewport y opera sobre la celda ACTIVA, no sobre el nodo enfocado.
 * Los nodos se reciclan al scrollear, así que el foco del DOM no es un lugar
 * confiable donde guardar "dónde está parado el usuario"; la posición activa es
 * estado del componente y sobrevive a cualquier repintado.
 */
function onViewportKeyDown(event: KeyboardEvent): void {
  // Mientras se edita, las teclas son del control: Enter y Escape ya las
  // consume el editor, que además detiene su propagación.
  if (editor.editing.value) return

  const rowCount = visibleRowCount.value
  if (rowCount === 0) return

  const ctrl = event.ctrlKey || event.metaKey
  const shift = event.shiftKey
  const columns = resolvedColumns.value
  const lastRow = rowCount - 1
  const lastColumn = Math.max(0, columns.length - 1)

  // `Ctrl`+`A` selecciona la grilla entera. Se atiende antes del `switch` porque
  // es un atajo con modificador y no una tecla de navegación, y se deja pasar
  // cuando el rango está apagado: ahí la tabla no tiene nada que seleccionar de
  // más y el "seleccionar todo" del navegador es lo que corresponde.
  if (ctrl && rangeEnabled.value && (event.key === 'a' || event.key === 'A')) {
    event.preventDefault()
    cellRange.selectAll()
    return
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveOrExtendBy(shift, 1, 0)
      return
    case 'ArrowRight': {
      event.preventDefault()
      // Comportamiento de `treegrid`: sobre un grupo plegado, la flecha derecha
      // lo abre en lugar de moverse. Sobre uno ya abierto no hay nada que abrir
      // y la tecla vuelve a significar lo de siempre.
      const group = activeGroupRow()
      // Plegar y desplegar NO es moverse entre columnas: sigue valiendo en los
      // dos modos, porque actúa sobre la fila en la que uno ya está parado.
      if (group && !group.expanded) grouping.toggleGroup(group.groupId)
      else if (!rowMode.value) moveOrExtendBy(shift, 0, 1)
      return
    }
    case 'ArrowUp':
      event.preventDefault()
      moveOrExtendBy(shift, -1, 0)
      return
    case 'ArrowLeft': {
      event.preventDefault()
      const group = activeGroupRow()
      if (group && group.expanded) grouping.toggleGroup(group.groupId)
      else if (!rowMode.value) moveOrExtendBy(shift, 0, -1)
      return
    }
    case 'Tab':
      // En modo fila no hay celdas que recorrer, y tabular por ellas sería
      // moverse a ciegas. Sin `preventDefault` la tecla vuelve a significar lo
      // que significa en toda la página: salir de la tabla.
      if (rowMode.value) return
      event.preventDefault()
      // `Shift`+`Tab` es "la celda anterior" y no "extender": es la única tecla
      // donde `Shift` ya significaba otra cosa, y esa otra cosa la espera todo
      // el mundo. Tabular colapsa el rango como cualquier movimiento.
      moveActiveInReadingOrder(!shift)
      return
    case 'Home':
      event.preventDefault()
      // En modo fila `Home` es la PRIMERA FILA, que es lo único que puede
      // significar donde no hay columnas que recorrer: sin esto quedaría
      // llevándote a una columna invisible y se vería como una tecla muerta.
      if (ctrl || rowMode.value) moveOrExtendTo(shift, 0, 0)
      // Absoluto, igual que `End` aquí abajo, y no un delta negativo enorme que
      // `moveActiveTo` termine acotando. Expresado como delta, `Home` sería un
      // movimiento "hacia la izquierda" y sin celda activa entraría por el borde
      // derecho, que es exactamente lo contrario de lo que significa `Home`.
      else moveOrExtendTo(shift, rowForAbsoluteJump(shift), 0)
      return
    case 'End':
      event.preventDefault()
      if (ctrl || rowMode.value) moveOrExtendTo(shift, lastRow, lastColumn)
      else moveOrExtendTo(shift, rowForAbsoluteJump(shift), lastColumn)
      return
    case 'PageDown':
      event.preventDefault()
      moveOrExtendBy(shift, pageSize(), 0)
      return
    case 'PageUp':
      event.preventDefault()
      moveOrExtendBy(shift, -pageSize(), 0)
      return
    case 'Enter':
    case 'F2': {
      event.preventDefault()
      // Sobre una cabecera, Enter pliega: es la misma acción que el click, y no
      // compite con la edición porque un grupo no tiene ninguna celda que editar.
      const group = activeGroupRow()
      if (group) grouping.toggleGroup(group.groupId)
      // En modo fila no se edita desde el teclado: `Enter` abriría el editor de
      // una celda que el usuario no eligió ni puede ver. Editar sigue estando,
      // pero por doble clic, que es el gesto donde se señala una celda concreta.
      else if (!rowMode.value) editActiveCell()
      return
    }
    case ' ': {
      const group = activeGroupRow()
      if (group) {
        event.preventDefault()
        grouping.toggleGroup(group.groupId)
        return
      }
      // Sobre una fila de datos el espacio sigue siendo un carácter imprimible y
      // cae en el camino de "escribir para editar", más abajo.
      break
    }
    case 'Escape':
      // Sin editor abierto, Escape no limpia la selección: perder de vista
      // dónde estabas parado es más molesto que seguir seleccionado.
      return
    default:
      break
  }

  // Escribir para editar. Se exige exactamente un carácter para descartar
  // nombres de tecla como "ArrowUp" o "F5", y se excluyen los modificadores
  // —menos Shift, que solo cambia el carácter— para no secuestrar los atajos
  // del navegador.
  if (event.key.length !== 1 || ctrl || event.altKey) return
  // Misma razón que `Enter`: sin una columna a la vista, escribir no puede
  // decidir dónde escribe.
  if (rowMode.value) return
  const position = activeCell.value
  if (!position) return
  event.preventDefault()
  editActiveCell(event.key)
}

/**
 * Forma de los listeners del viewport.
 *
 * La clave es OPCIONAL, no de tipo `Fn | undefined`: la diferencia es
 * justamente el punto. Con `Record<string, Fn>` habría que producir un valor
 * para `keydown` siempre, y con `Record<string, Fn | undefined>` se produciría
 * la clave con valor indefinido. Aquí, en modo `none`, la clave no existe y Vue
 * no tiene nada que registrar.
 */
/**
 * Copia la selección al portapapeles.
 *
 * ## Por qué escucha `copy` y no `Ctrl`+`C`
 *
 * Porque `event.clipboardData.setData` dentro del evento `copy` es la única vía
 * que escribe el portapapeles SIN pedir permisos: es el navegador quien abre la
 * puerta, en respuesta al gesto del usuario, y el manejador solo la llena.
 * `navigator.clipboard.writeText` desde el `keydown` sería asíncrono, pediría
 * permiso en algunos navegadores y fallaría en silencio en un contexto no
 * seguro. Además, escuchar el evento en vez de la tecla cubre gratis el copiar
 * del menú contextual y el de la barra de menús.
 *
 * Mientras hay un editor abierto NO se hace nada: el foco está en un control de
 * texto, el evento burbujea desde ahí, y el usuario está copiando lo que
 * seleccionó adentro del `<input>`. Robarle ese copiado para pegarle el
 * contenido de la grilla sería exactamente lo contrario de lo que pidió.
 */
/**
 * Qué abarca el copiado.
 *
 * En modo celda es el rango, que sin arrastre colapsa en la celda activa. En
 * modo fila es LA FILA ENTERA, de la primera a la última columna visible: ahí la
 * unidad elegida es la fila, y devolver una sola celda copiaba algo que el
 * usuario nunca seleccionó —ni podía ver cuál era—.
 *
 * Se arma con las columnas VISIBLES y en el orden en que están, no con las
 * declaradas: lo que se pega tiene que corresponderse con lo que se ve, igual
 * que ya hacía el copiado de un rango.
 */
function copyRect(): RangeRect | null {
  if (!rowMode.value) return cellRange.rect.value

  const position = activeCell.value
  if (!position) return null
  const lastColumn = resolvedColumns.value.length - 1
  if (lastColumn < 0) return null

  return {
    rowStart: position.rowIndex,
    rowEnd: position.rowIndex,
    columnStart: 0,
    columnEnd: lastColumn,
  }
}

function onViewportCopy(event: ClipboardEvent): void {
  if (editor.editing.value) return

  const rect = copyRect()
  if (!rect) return

  const data = event.clipboardData
  // Sin `clipboardData` no hay dónde escribir, y entonces tampoco corresponde
  // cancelar el evento: cancelarlo sin dejar nada vaciaría el portapapeles.
  if (!data) return

  const columns = columnsOfRect(rect)
  if (columns.length === 0) return

  const { text, rowCount } = buildRangeText<TRow>(rect.rowStart, rect.rowEnd, columns, {
    rowAt: (rowIndex) => grouping.rowAt(rowIndex),
    toSourceIndex: (rowIndex) => grouping.toSourceIndex(rowIndex),
  })
  // Un rango que solo abarca cabeceras de grupo no aporta ninguna línea. Dejar
  // pasar el evento conserva lo que ya hubiera en el portapapeles, que es mejor
  // que reemplazarlo por una cadena vacía.
  if (rowCount === 0) return

  data.setData('text/plain', text)
  event.preventDefault()
  // El portapapeles no deja rastro visible: sin esto, el usuario no tiene forma
  // de saber si el atajo llegó a la tabla o se lo comió otra cosa.
  flashCopied(rect)

  emit('rangeCopy', {
    range: cellRange.range.value,
    text,
    rowCount,
    columnCount: columns.length,
  })
}

interface ViewportListeners {
  keydown?: (event: KeyboardEvent) => void
  copy?: (event: ClipboardEvent) => void
}

/**
 * Listeners del viewport, como objeto para `v-on`.
 *
 * En modo `none` el objeto viene vacío y no se registra ningún listener de
 * teclado: no es un early return adentro del manejador, es que no hay manejador.
 *
 * Se usa la forma de objeto y no `@keydown="expr"` porque el compilador de Vue
 * envuelve los manejadores en una closure cacheada, así que un `undefined`
 * igual terminaría registrando un listener que no hace nada. Con `v-on` sobre un
 * objeto, la clave simplemente no existe.
 */
const viewportListeners = computed<ViewportListeners>(() => {
  if (props.selectionMode === 'none') return {}
  return { keydown: onViewportKeyDown, copy: onViewportCopy }
})

/* ----------------------------------------------------------------- Editor */

function getColumnDefinition(columnKey: string): DataTableColumn<TRow> | undefined {
  return layout.getResolvedColumn(columnKey)?.column
}

/**
 * Geometría de una celda en coordenadas del canvas.
 *
 * Se calcula con aritmética pura sobre el layout ya resuelto, sin leer el DOM:
 * un `getBoundingClientRect` aquí forzaría layout en cada frame mientras hay una
 * celda en edición.
 */
function getCellGeometry(position: CellPosition): CellGeometry | null {
  const resolved = layout.getResolvedColumn(position.columnKey)
  if (!resolved) return null
  const geometry = rowMetrics.value
  return {
    x: columnCanvasX(resolved),
    y: geometry.offsetOf(position.rowIndex),
    width: resolved.width,
    height: geometry.sizeOf(position.rowIndex),
  }
}

/**
 * Coordenada horizontal REAL de una columna en el canvas, ahora mismo.
 *
 * Para una columna suelta es su offset y nada más. Para una anclada, ese offset
 * corrido por la compensación del frame: la columna está quieta en pantalla, así
 * que su lugar dentro del canvas —que sí se desplaza— cambia con el scroll.
 *
 * Lo usan el editor y el recuadro del rango, que se posicionan en coordenadas
 * del canvas: sin esto, editar una columna anclada abriría el control sobre la
 * celda que pasa por debajo.
 */
function columnCanvasX(column: ResolvedColumn<TRow>): number {
  if (column.pinned === null) return column.offset

  const metrics = scroll.state.value
  if (column.pinned === 'start') return column.offset + metrics.scrollLeft

  return column.offset + Math.min(0, metrics.scrollLeft + metrics.viewportWidth - totalWidth.value)
}

const editor = useCellEditor<TRow>({
  host: editorHostEl,
  slotHost: slotEditorHostEl,
  // El editor trabaja en coordenadas VISIBLES, igual que el pool: es lo que le
  // permite ubicar su control con una multiplicación. La traducción al índice
  // del dataset ocurre al emitir, y solo ahí.
  getRow: (rowIndex) => grouping.rowAt(rowIndex),
  getColumn: getColumnDefinition,
  getCellGeometry,
  isCellPainted: (position) => pool.getCellElement(position.rowIndex, position.columnKey) !== null,
  emitBeforeEdit: (event) => emit('beforeEdit', withSourceRowIndex(event)),
  emitAfterEdit: (event) => emit('afterEdit', withSourceRowIndex(event)),
  emitEditCommit: (event) => emit('editCommit', withSourceRowIndex(event)),
  onEnterCommit: () => {
    // Enter confirma y baja una fila, como en una hoja de cálculo. La selección se
    // mueve aunque el padre no persista el valor: es navegación, no edición.
    moveActiveBy(1, 0)
  },
  onReleaseFocus: () => {
    // El editor soltó el foco al cerrarse y sin esto quedaría en el `body`, o
    // sea fuera de la tabla: el manejador de teclado escucha en el viewport, así
    // que la flecha siguiente a un Escape no llegaría a ningún lado. Se lo
    // devuelve al único elemento enfocable de la tabla, que es de donde salió.
    viewportEl.value?.focus()
  },
})

/**
 * Abrir un editor colapsa el rango.
 *
 * Editar es una operación de UNA celda, y dejar el rectángulo pintado alrededor
 * mientras se escribe en una sola sugiere que la edición va a alcanzarlas a
 * todas. Va sobre `editor.editing` y no adentro de cada llamador porque las vías
 * de entrada son cuatro —doble clic, `Enter`, `F2` y empezar a escribir— y este
 * es el único punto por el que pasan las cuatro.
 */
watch(
  () => editor.editing.value,
  (editing) => {
    if (editing) cellRange.collapse()
  },
)

/* -------------------------------------------------------- Editor por slot */

/**
 * Lo que recibe el slot `#editor`, o `null` cuando no hay ninguna celda de slot
 * abierta.
 *
 * Es un `computed` y no un estado propio para que no exista una segunda fuente
 * de verdad sobre qué se está editando: deriva de `editor.editing`, que es la
 * misma que consume el pintado. Durante el scroll ninguna de sus dependencias se
 * mueve, así que no se recalcula y el slot no se vuelve a renderizar: el camino
 * caliente no paga absolutamente nada por esta función.
 *
 * Se consulta `column.editor` en crudo en lugar de inferir el tipo porque
 * `'slot'` nunca se infiere: declararlo es la única forma de pedirlo.
 */
const editorSlotProps = computed<CellEditorSlotProps<TRow> | null>(() => {
  const position = editor.editing.value
  if (position === null) return null

  const column = getColumnDefinition(position.columnKey)
  if (!column || column.editor !== 'slot') return null

  const row = grouping.rowAt(position.rowIndex)
  if (row === undefined) return null

  return {
    row,
    // El índice que ve el consumidor es SIEMPRE el de su propio array, igual que
    // en todos los eventos: la posición dentro de la vista aplanada no le sirve
    // para escribir, y confundirlas le tocaría otra fila.
    rowIndex: grouping.toSourceIndex(position.rowIndex),
    column,
    columnKey: position.columnKey,
    value: readCellValue(column, row),
    commit: (newValue: CellValue) => editor.commitSlotValue(newValue),
    cancel: () => editor.cancelEdit(),
  }
})

/**
 * Qué se considera enfocable dentro del contenido del slot.
 *
 * Se excluye `tabindex="-1"` a propósito: es la marca de "enfocable por código,
 * no por Tab", y la caja del editor la lleva ella misma como último recurso.
 */
const FOCUSABLE_SELECTOR =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Lleva el foco al control que puso el consumidor, una vez que existe.
 *
 * Corre en un watcher `post` porque el contenido del slot lo monta Vue al ver
 * cambiar `editing`: en el momento en que `beginEdit` retorna todavía no hay
 * ningún nodo que enfocar. Es la diferencia con los controles incluidos, que
 * este módulo crea él mismo y puede enfocar en el acto.
 *
 * Si el componente del consumidor ya tomó el foco por su cuenta —un `autofocus`,
 * un `onMounted` propio— no se le disputa: quien mejor sabe qué parte de un
 * control compuesto debe recibir el foco es quien lo escribió.
 */
function focusSlotEditor(): void {
  const host = slotEditorHostEl.value
  if (!host) return

  const focused = host.ownerDocument.activeElement
  if (focused instanceof HTMLElement && host.contains(focused)) return

  const focusable = host.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
  // Sin nada enfocable adentro, el foco se queda en la caja, que lleva
  // `tabindex="-1"` para eso: sin foco ahí, Escape no llegaría a ningún lado.
  ;(focusable ?? host).focus({ preventScroll: true })
}

watch(
  editorSlotProps,
  (current) => {
    if (current === null) return
    focusSlotEditor()
  },
  { flush: 'post' },
)

/**
 * Teclas dentro del editor de slot.
 *
 * Escape descarta, igual que en un editor incluido. El resto se detiene aquí y no
 * llega al viewport: el editor comparte el contenedor que scrollea, y dejar
 * burbujear las flechas o la barra espaciadora lo desplazaría mientras el
 * usuario opera el control. `stopPropagation` no le quita nada al control del
 * consumidor, que es el `target` y ya vio el evento.
 */
function onSlotEditorKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    editor.cancelEdit()
    return
  }
  event.stopPropagation()
}

/* ------------------------------------------------------------------ Pintado */

/** Resuelve la clave estable de una fila para `data-row-key`. */
/**
 * Identidad sintética, para cuando el consumidor no declaró `rowKey`.
 *
 * Se ata a la REFERENCIA del objeto y no a su contenido, y en esa diferencia
 * está todo lo que puede y lo que no. Filtrar, ordenar o reagrupar del lado del
 * cliente devuelven LOS MISMOS objetos —`filter` y `toSorted` no clonan nada—,
 * así que la identidad sobrevive a todo eso sola. Editar un campo tampoco la
 * mueve, cosa que un hash del contenido sí haría.
 *
 * Lo que no puede: cruzar un `fetch`. Una página nueva trae objetos nuevos, y
 * ningún esquema sintético los reconoce. De ahí el aviso de más abajo.
 *
 * `WeakMap` y no `Map`: la tabla no tiene por qué sostener viva una fila que el
 * consumidor ya soltó. Cuando el arreglo se reemplaza, las claves viejas se
 * recolectan con él.
 */
const syntheticRowKeys = new WeakMap<object, string>()
let syntheticRowKeyCount = 0

function syntheticRowKey(row: TRow): string {
  if (typeof row !== 'object' || row === null) return String(row)
  const yaTiene = syntheticRowKeys.get(row)
  if (yaTiene !== undefined) return yaTiene
  syntheticRowKeyCount += 1
  const nueva = `dt-${syntheticRowKeyCount}`
  syntheticRowKeys.set(row, nueva)
  return nueva
}

/**
 * La identidad de una fila, CON SU TIPO.
 *
 * No se convierte a texto, y no es un detalle: si `rowKey` es `'id'` sobre un
 * número, el consumidor va a comparar lo que recibe en `selectedRows` contra
 * `row.id`. Devolver `'42'` donde él tiene `42` hace que esa comparación falle
 * siempre, y en silencio.
 *
 * El texto lo pide una sola cosa —el atributo del DOM— y lo resuelve
 * {@link resolveRowKey}.
 */
function rowKeyOf(row: TRow, index: number): RowKey {
  const key = props.rowKey
  if (key === undefined) return syntheticRowKey(row)
  if (typeof key === 'function') return key(row, index)
  const bruto = row[key]
  return typeof bruto === 'number' ? bruto : String(bruto)
}

/** La misma identidad, ya como texto: es lo único que acepta un atributo. */
function resolveRowKey(row: TRow, index: number): string {
  return String(rowKeyOf(row, index))
}

/**
 * Avisa una vez si se pide marcar filas contra un servidor sin declarar
 * identidad.
 *
 * Es el único caso donde la tabla NO puede arreglarlo por su cuenta: cada página
 * llega como objetos nuevos, y la identidad sintética se apoya en la referencia.
 * El usuario marcaría filas, cambiaría de página y las encontraría desmarcadas
 * al volver, sin ninguna pista de por qué.
 */
let warnedAboutRowIdentity = false

function warnIfSelectionHasNoIdentity(): void {
  if (warnedAboutRowIdentity) return
  if (props.rowKey !== undefined) return
  if (!props.selectionColumn) return
  if (props.rowCount === undefined) return

  warnedAboutRowIdentity = true
  console.warn(
    '[DataTable] Hay casillas de selección y modo servidor, pero no se declaró `rowKey`. ' +
      'Sin él la tabla identifica cada fila por la referencia de su objeto, y una página ' +
      'nueva trae objetos nuevos: lo marcado se pierde al cambiar de página o al filtrar. ' +
      'Declara `rowKey` con un campo que el servidor devuelva siempre igual.',
  )
}

/**
 * Pinta un frame completo.
 *
 * Se invoca desde el `requestAnimationFrame` de `useScrollSync`, siempre después
 * de que el espejo reactivo del scroll quedó publicado. Los `computed` que se
 * leen aquí son perezosos: se resuelven en este instante, con los valores de
 * este frame.
 */
function paintFrame(): void {
  /*
   * Nada de lo que se pasa aquí depende del scroll horizontal, y eso es
   * deliberado: las columnas ancladas y la regleta de numeración se quedan
   * quietas por `position: sticky`, o sea que las sostiene el compositor.
   *
   * Antes se las corría desde aquí, leyendo el scroll del instante para que "no
   * fueran un frame atrasadas". Es inalcanzable: el navegador scrollea en el hilo
   * del compositor y compone el frame con el desplazamiento nuevo antes de que el
   * hilo principal llegue a escribir la compensación. Medido frame a frame en el
   * navegador, uno de cada dos frames compuestos mostraba las ancladas corridas
   * el delta entero del scroll. El problema no era qué valor se leía sino quién
   * aplicaba la posición.
   */
  pool.paint({
    rows: props.rows,
    pinnedColumns: pinnedColumns.value.all,
    totalWidth: totalWidth.value,
    flatRows: grouping.flatRows.value,
    groupDepth: grouping.depth.value,
    showGroupCount: props.showGroupCount,
    placeholders: serverMode.value,
    loading: showLoadingSkeleton.value,
    rowRange: rowVirtual.window.value,
    columns: visibleColumns.value,
    rowMetrics: rowMetrics.value,
    editing: editor.editing.value,
    active: activeCell.value,
    range: rangeRect.value,
    selectionMode: props.selectionMode,
    stripe: props.stripe,
    resolveRowKey,
  })
  // Después del pool: `syncPosition` consulta si la celda editada sigue pintada,
  // y esa respuesta solo es válida una vez que el pool corrió.
  editor.syncPosition()

  warnIfCollapsed()
  warnIfSelectionHasNoIdentity()
}

/**
 * Avisa una vez si la tabla se quedó sin alto donde pintar.
 *
 * ## Qué falla, y por qué falla en silencio
 *
 * `.dt-root` NO declara alto propio: lo toma del contenedor, y eso está
 * documentado. Lo que no se ve venir es el modo en que falla cuando el
 * contenedor no le da ninguno. La tabla no se rompe ni tira nada: pinta el
 * encabezado, deja la barra de scroll —el canvas es absoluto y genera desborde
 * igual— y muestra CERO filas. Parece un problema de datos y no de layout.
 *
 * Peor todavía, el síntoma depende de una prop que no tiene nada que ver: con
 * `showRowNumbers` encendida la regleta va en flujo con el alto total escrito
 * inline, así que le da alto de contenido al viewport y todo "funciona". Apagarla
 * hace desaparecer ese alto y la tabla se vacía. O sea que funcionaba de
 * casualidad.
 *
 * ## Por qué esta condición y no otra
 *
 * `viewportWidth > 0` cumple dos funciones a la vez: prueba que el
 * `ResizeObserver` ya midió —antes de eso el alto es cero de forma legítima y
 * avisar sería un falso positivo— y descarta que la tabla esté simplemente
 * oculta, porque un `display: none` o una pestaña cerrada dan ancho cero
 * también. Sin ese testigo, cualquier tabla montada dentro de un acordeón
 * cerrado avisaría sin motivo.
 */
let warnedAboutHeight = false

function warnIfCollapsed(): void {
  if (warnedAboutHeight) return
  if (visibleRowCount.value === 0) return
  if (rowViewportHeight.value > 0) return
  if (scroll.state.value.viewportWidth === 0) return

  warnedAboutHeight = true
  console.warn(
    '[DataTable] La tabla no tiene alto para pintar filas, así que no se ve ninguna. ' +
      '`.dt-root` toma su alto del contenedor y el contenedor no le está dando ninguno. ' +
      'Dale una altura al contenedor (`height: 600px`), o si está dentro de un flex, ' +
      'pon `flex: 1; min-height: 0` en `.dt-root`.',
  )
}

/**
 * Todo lo que obliga a repintar y no pasa por el scroll.
 *
 * Se agenda el mismo `requestAnimationFrame` que usa el scroll en lugar de
 * pintar en el acto: varios cambios en el mismo tick colapsan en un solo
 * pintado, y ese pintado cae alineado con el compositor.
 */
watch(
  [
    () => props.rows,
    () => props.columns,
    () => props.stripe,
    () => props.virtualizeColumns,
    // La geometría vertical entera de una sola vez: es un objeto nuevo cada vez
    // que cambia el alto base, el resolutor de alturas o la cantidad de filas.
    // Cubre el caso que no se ve venir: un cambio de altura que NO mueve el
    // tramo visible igual tiene que repintarlo, porque cada fila se posiciona
    // por su offset propio.
    rowMetrics,
    // `resolvedColumns` cubre visibilidad, orden y anchos de una sola vez: es un
    // array nuevo en cada recálculo. `totalWidth` por sí solo no alcanzaría,
    // porque intercambiar dos columnas del mismo ancho no lo mueve.
    resolvedColumns,
    editor.editing,
    // Mover la selección tiene que agendar un frame; sin esto la marca no se
    // pintaría hasta el próximo scroll.
    activeCell,
    // Y extenderla también: el tinte del rango lo pinta el pool, así que cada
    // paso del arrastre necesita su frame.
    rangeRect,
    () => props.selectionMode,
    // La vista aplanada es un array nuevo en cada reconstrucción, así que alcanza
    // con observarla para cubrir `groupBy`, la expansión y los agregados de una
    // sola vez. Durante el scroll no cambia, y por eso no agenda nada.
    grouping.flatRows,
    () => props.showGroupCount,
    // Encender o apagar la espera cambia lo que se pinta en TODAS las filas.
    () => props.loading,
  ],
  () => scroll.requestFrame(),
  { flush: 'post' },
)

/**
 * Repinta las casillas cuando cambia la selección.
 *
 * Tiene watcher propio porque necesita algo que los demás no: INVALIDAR el pool,
 * no solo agendar un frame. El camino rápido del pintado saltea toda celda cuyo
 * valor crudo no haya cambiado, y el valor crudo de una casilla de selección no
 * cambia nunca —no sale de la fila, sale del estado—. Sin invalidar, marcar una
 * fila actualizaba el estado y la tricasilla del encabezado, pero la casilla de
 * la fila se quedaba como estaba.
 *
 * Invalidar repinta las celdas visibles, no la tabla entera: son unos cientos, y
 * cada renderer compara antes de escribir, así que las que no cambiaron no tocan
 * el DOM. Se paga trabajo de JS en un frame, no un reflow.
 */
watch(
  selectedRowsState,
  () => {
    pool.invalidate()
    scroll.requestFrame()
  },
  { flush: 'post' },
)

/**
 * Recorta el pool cuando el viewport se achica.
 *
 * Es el único momento en que el pool puede encoger: hacerlo durante el scroll
 * destruiría los nodos que el frame siguiente va a volver a pedir.
 */
watch(rowViewportHeight, (height) => {
  // La cota es la fila MÁS BAJA, no el alto base: con alturas mezcladas, un
  // tramo de puras filas bajas mete más filas en la misma pantalla, y recortar
  // el pool contra el alto base lo dejaría corto justo ahí —obligando a crear
  // nodos en mitad del scroll, que es lo que el pool existe para evitar—.
  const minimo = rowMetrics.value.minSize
  if (minimo <= 0) return
  pool.trim(Math.ceil(height / minimo) + props.overscan * 2 + 1)
})

/* ------------------------------------------ Redimensionado de columnas */

/**
 * Arrastre del handle de redimensionado.
 *
 * Con `setPointerCapture` los eventos siguen llegando al handle aunque el cursor
 * salga de él, lo que evita tener que escuchar en `document` y perder el
 * arrastre al soltar fuera de la ventana.
 */
function onResizePointerDown(event: PointerEvent, column: ResolvedColumn<TRow>): void {
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement)) return

  event.preventDefault()
  event.stopPropagation()
  handle.setPointerCapture(event.pointerId)

  const startX = event.clientX
  const startWidth = column.width
  // Se recuerda el último ancho aplicado en lugar de releerlo del layout al
  // soltar: en modo controlado el padre puede no haber actualizado la prop
  // todavía, y la relectura devolvería el ancho viejo.
  let appliedWidth = startWidth

  // Los listeners se declaran como `const` con función flecha y no como
  // declaraciones de función: una `function` se iza al tope del scope, y para
  // TypeScript eso significa que se creó antes del `instanceof` de más arriba,
  // por lo que dentro de su cuerpo `handle` volvería a ser `EventTarget | null`.
  // Declarándolos después del estrechamiento, el tipo `HTMLElement` sobrevive y
  // `addEventListener` resuelve su sobrecarga tipada.
  const onPointerMove = (moveEvent: PointerEvent): void => {
    appliedWidth = layout.setColumnWidth(column.key, startWidth + (moveEvent.clientX - startX))
  }

  const onPointerUp = (upEvent: PointerEvent): void => {
    handle.removeEventListener('pointermove', onPointerMove)
    handle.removeEventListener('pointerup', onPointerUp)
    handle.removeEventListener('pointercancel', onPointerUp)
    if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId)

    // Solo se emite ante un cambio real: un click sin arrastre no es un resize.
    if (appliedWidth === startWidth) return
    emit('columnResize', { columnKey: column.key, width: appliedWidth, previousWidth: startWidth })
  }

  handle.addEventListener('pointermove', onPointerMove)
  handle.addEventListener('pointerup', onPointerUp)
  handle.addEventListener('pointercancel', onPointerUp)
}

/* ------------------------------------------- Mover columnas arrastrando */

/**
 * Cuánto hay que mover el puntero para que un clic pase a ser un arrastre, en px.
 *
 * Es lo único que separa las dos cosas que se pueden hacer sobre un encabezado:
 * seleccionar la columna y moverla. Sin umbral, el temblor de la mano al hacer
 * clic reordenaría la tabla; con uno muy grande, mover una columna al lugar de
 * al lado se volvería imposible. Cuatro píxeles es el valor que usan los
 * sistemas operativos para lo mismo.
 */
const REORDER_THRESHOLD = 4

/** Arrastre de columna en curso, o `null`. */
const columnDrag = shallowRef<{
  /** Clave de la columna que se está moviendo. */
  key: string
  /** Índice —entre las VISIBLES— donde caería ahora mismo. */
  dropIndex: number
  /**
   * Esquina superior izquierda del fantasma, en coordenadas de `.dt-root`.
   *
   * Ya resueltas aquí y no en un `computed`: el arrastre las produce a partir del
   * puntero, y traducirlas después obligaría a guardar además el rectángulo de
   * la raíz y el punto donde se agarró. Ver {@link startColumnDrag}.
   */
  ghostX: number
  ghostY: number
  /** Título y ancho de la columna, congelados al empezar el gesto. */
  label: string
  width: number
} | null>(null)

/**
 * Posición de la línea que muestra dónde caería la columna, en px del canvas.
 *
 * `null` cuando no hay arrastre, o cuando soltar ahí no movería nada: la línea
 * aparece solo si el gesto va a producir un cambio, así que su presencia ya es
 * la respuesta a "¿esto sirve de algo?".
 */
const dropIndicatorX = computed<number | null>(() => {
  const drag = columnDrag.value
  if (!drag) return null

  const columns = resolvedColumns.value
  const from = columns.findIndex((column) => column.key === drag.key)
  if (from === -1) return null
  // Soltar en el propio hueco —antes o después de sí misma— no mueve nada.
  if (drag.dropIndex === from || drag.dropIndex === from + 1) return null

  const target = columns[drag.dropIndex]
  if (target) return target.offset

  // Más allí de la última: la línea va contra su borde derecho.
  const last = columns[columns.length - 1]
  return last ? last.offset + last.width : null
})

/**
 * Ancho máximo del fantasma, en px.
 *
 * Una columna ancha arrastrada a tamaño real tapa media tabla, y justo lo que
 * hay que ver mientras se arrastra es dónde va a caer. Recortarlo conserva la
 * idea —"esto es lo que estoy moviendo"— sin esconder la respuesta.
 */
const GHOST_MAX_WIDTH = 260

/**
 * Estilo del fantasma que sigue al puntero, o `null` si no hay arrastre.
 *
 * Es la pieza que convierte el gesto en un objeto: sin ella, arrastrar una
 * columna atenúa su encabezado y dibuja una línea a lo lejos, y entre esas dos
 * cosas no hay NADA agarrado al cursor. El fantasma aparece exactamente encima
 * del encabezado en el momento en que el gesto pasa a ser arrastre, así que se
 * lee como si el encabezado se hubiera despegado.
 */
const columnGhostStyle = computed<Record<string, string> | null>(() => {
  const drag = columnDrag.value
  if (!drag) return null
  return {
    transform: `translate3d(${drag.ghostX}px, ${drag.ghostY}px, 0)`,
    width: `${Math.min(drag.width, GHOST_MAX_WIDTH)}px`,
    height: `${headerHeight.value}px`,
  }
})

/**
 * Estilo de la línea de caída, o `null` si no hay ninguna que dibujar.
 *
 * La línea vive en `.dt-root`, que NO scrollea, así que la coordenada del canvas
 * se convierte a coordenada de pantalla restándole el scroll horizontal. Es la
 * misma cuenta que hace el header, con el que tiene que quedar alineada al
 * píxel: si la línea viviera adentro del viewport se desplazaría con el cuerpo y
 * dejaría de coincidir con el hueco que promete.
 */
const dropIndicatorStyle = computed<Record<string, string> | null>(() => {
  const x = dropIndicatorX.value
  if (x === null) return null
  return { transform: `translate3d(${x - scroll.state.value.scrollLeft}px, 0, 0)` }
})

/**
 * Traduce una coordenada de pantalla al hueco entre columnas donde caería.
 *
 * Devuelve un índice de INSERCIÓN sobre las columnas visibles: 0 es "antes de
 * la primera" y `length` es "después de la última". El corte está en el medio de
 * cada columna, que es lo que hace que el gesto se sienta continuo —la línea
 * salta cuando el puntero pasa el centro, no cuando cruza un borde—.
 */
function dropIndexAt(clientX: number, key: string): number {
  const viewport = viewportEl.value
  const columns = resolvedColumns.value
  if (!viewport || columns.length === 0) return 0

  const x = clientX - viewport.getBoundingClientRect().left + scroll.live.scrollLeft

  let raw = columns.length
  for (const column of columns) {
    if (x < column.offset + column.width / 2) {
      raw = column.index
      break
    }
  }

  return clampToPins(
    raw,
    columns.findIndex((column) => column.key === key),
  )
}

/**
 * Acota el hueco de caída para que ninguna columna anclada se mueva de lugar.
 *
 * Anclar una columna con `reorderable: false` tiene que significar las dos
 * cosas: que no se la puede agarrar Y que nadie puede empujarla. Lo segundo no
 * sale gratis —insertar una columna antes de la anclada la corre un lugar a la
 * derecha—, y sin esto un `id` "fijo" en la primera posición dejaba de serlo en
 * cuanto alguien soltaba otra columna delante.
 *
 * La regla completa es: la columna que viaja no puede CRUZAR a una anclada. Eso
 * deja a cada anclada donde está y parte el encabezado en zonas, que es
 * exactamente lo que alguien espera al fijar una columna del medio.
 */
function clampToPins(dropIndex: number, from: number): number {
  if (from === -1) return dropIndex

  let min = 0
  let max = resolvedColumns.value.length

  for (const column of resolvedColumns.value) {
    if (column.reorderable) continue
    if (column.index < from) min = Math.max(min, column.index + 1)
    else if (column.index > from) max = Math.min(max, column.index)
  }

  return clamp(dropIndex, min, max)
}

/**
 * Aplica el movimiento sobre el orden COMPLETO, ocultas incluidas.
 *
 * El orden que se persiste y se emite contiene todas las columnas declaradas,
 * mientras que el arrastre ocurre entre las visibles. Traducir de uno a otro por
 * índice numérico sería el error clásico: con una columna oculta en el medio, la
 * cuenta se corre. Se traduce por CLAVE —la de la columna visible que va a
 * quedar a la derecha— y así las ocultas se quedan donde están, pegadas a su
 * vecina de siempre.
 */
function moveColumn(key: string, dropIndex: number): void {
  const columns = resolvedColumns.value
  const from = columns.findIndex((column) => column.key === key)
  if (from === -1 || dropIndex === from || dropIndex === from + 1) return

  const full = layout.orderedColumns.value.map((column) => column.key)
  const without = full.filter((candidate) => candidate !== key)

  // La columna visible que queda a la derecha del hueco ancla la inserción. Sin
  // ninguna —se soltó al final— la columna va al final del orden completo.
  const anchorKey = columns[dropIndex]?.key
  const at = anchorKey === undefined ? without.length : without.indexOf(anchorKey)
  if (at === -1) return

  without.splice(at, 0, key)
  setColumnOrder(without)
}

/**
 * Arrastre de un encabezado.
 *
 * Arranca armado pero SIN moverse: hasta que el puntero no supera el umbral, el
 * gesto sigue siendo un clic y la selección de columna —si está encendida— ya
 * ocurrió en `pointerdown`. Solo al cruzarlo aparece la línea de caída y el
 * encabezado se marca como en vuelo.
 *
 * Se usa `setPointerCapture` sobre el encabezado: aquí sí conviene, al revés que
 * en el arrastre de celdas. Ahí hacía falta saber sobre qué celda estaba el
 * puntero, y la captura habría retargeteado todos los eventos; aquí la posición
 * se calcula con aritmética sobre `clientX`, así que capturar solo garantiza que
 * el `pointerup` llegue aunque se suelte fuera de la tabla.
 */
function startColumnDrag(event: PointerEvent, column: ResolvedColumn<TRow>): void {
  const header = event.currentTarget
  if (!(header instanceof HTMLElement)) return

  const startX = event.clientX
  let dragging = false

  // Los dos rectángulos se leen UNA vez, al empezar. La raíz no se mueve
  // mientras el puntero está capturado, y el encabezado tampoco: leerlos en cada
  // `pointermove` sería forzar layout sesenta veces por segundo para obtener el
  // mismo número.
  const rootBox = rootEl.value?.getBoundingClientRect()
  const headerBox = header.getBoundingClientRect()
  // Dónde AGARRÓ el usuario dentro del encabezado. Conservarlo es lo que hace
  // que el fantasma no salte al aparecer: nace justo encima del encabezado, en
  // la misma posición relativa al dedo, y solo desde ahí se mueve.
  const grabX = event.clientX - headerBox.left
  const grabY = event.clientY - headerBox.top

  header.setPointerCapture(event.pointerId)

  const onPointerMove = (moveEvent: PointerEvent): void => {
    if (!dragging) {
      if (Math.abs(moveEvent.clientX - startX) < REORDER_THRESHOLD) return
      dragging = true
    }
    columnDrag.value = {
      key: column.key,
      dropIndex: dropIndexAt(moveEvent.clientX, column.key),
      ghostX: moveEvent.clientX - grabX - (rootBox?.left ?? 0),
      ghostY: moveEvent.clientY - grabY - (rootBox?.top ?? 0),
      label: column.label,
      width: column.width,
    }
  }

  const finish = (upEvent: PointerEvent, drop: boolean): void => {
    header.removeEventListener('pointermove', onPointerMove)
    header.removeEventListener('pointerup', onPointerUp)
    header.removeEventListener('pointercancel', onPointerCancel)
    if (header.hasPointerCapture(upEvent.pointerId)) {
      header.releasePointerCapture(upEvent.pointerId)
    }

    const drag = columnDrag.value
    columnDrag.value = null
    // El `click` que viene después de esto no es un clic: es el final de un
    // arrastre, y no tiene que ordenar la columna.
    if (dragging) headerClickWasDrag = true
    if (drop && drag) moveColumn(drag.key, drag.dropIndex)
  }

  const onPointerUp = (upEvent: PointerEvent): void => finish(upEvent, true)
  // Cancelar es lo contrario de soltar: el gesto se abandona y nada se mueve.
  const onPointerCancel = (cancelEvent: PointerEvent): void => finish(cancelEvent, false)

  header.addEventListener('pointermove', onPointerMove)
  header.addEventListener('pointerup', onPointerUp)
  header.addEventListener('pointercancel', onPointerCancel)
}

/**
 * Alterna el anclaje de una columna desde su encabezado.
 *
 * ## Qué escribe, y por qué `null` en vez de borrar la clave
 *
 * Anclada pasa a suelta y suelta pasa a anclada, al borde que declaró
 * `pinnable`. Soltar escribe `null` y NO borra la clave: borrarla devolvería el
 * mando a `column.pinned`, así que una columna declarada anclada se habría
 * vuelto a anclar sola en el mismo tick. `null` es "el usuario la soltó" y tiene
 * que sobrevivir.
 *
 * ## Por qué avisa de los agregados
 *
 * `aggregate` sobre una columna anclada se ignora, y está documentado: el
 * agregado se dibuja en el offset de SU columna, así que anclado al inicio
 * caería encima del chevron y la etiqueta del grupo. Mientras el anclaje era
 * solo declarativo eso se descubría al escribir la columna; con un botón lo
 * dispara cualquiera en caliente, y lo que se ve es una cifra que desaparece sin
 * motivo aparente. Se avisa una vez por columna, y solo si hay agrupación
 * activa: sin grupos no hay ningún agregado que perder.
 */
const warnedAboutPinnedAggregate = new Set<string>()

function toggleColumnPinned(column: ResolvedColumn<TRow>): void {
  const side = column.pinSide
  if (side === null) return

  const next = column.pinned === null ? side : null

  if (
    next !== null &&
    column.column.aggregate !== undefined &&
    effectiveGroupBy.value.length > 0 &&
    !warnedAboutPinnedAggregate.has(column.key)
  ) {
    warnedAboutPinnedAggregate.add(column.key)
    console.warn(
      `[DataTable] La columna "${column.key}" tiene \`aggregate\` y se acaba de anclar, ` +
        'así que su cifra de grupo deja de mostrarse. Un agregado se dibuja en el offset de su ' +
        'columna, y anclado caería encima de la etiqueta del grupo. Desanclala para recuperarlo.',
    )
  }

  setColumnPinning({ ...columnPinning.value, [column.key]: next })
}

/* --------------------------------------------------- Menú de la columna */

/**
 * Los dibujos del menú, como listas de trazados sobre un lienzo de 16×16.
 *
 * Todos de LÍNEA y ninguno relleno: mezclar las dos cosas en una misma lista
 * hace que unos pesen más que otros aunque midan igual. El trazo, el redondeo de
 * las puntas y el tamaño salen de la hoja de estilos, así que aquí solo vive la
 * forma.
 *
 * Son genéricos a propósito —flechas, una barra, un ojo, un círculo— y no
 * ilustraciones: un ícono de menú se lee de reojo, al lado de su texto, y lo
 * único que tiene que hacer es distinguir una fila de la siguiente.
 *
 * Anclar al inicio y al final NO comparten dibujo. Son la misma acción hacia
 * lados opuestos, y esa diferencia es justamente lo que el usuario está
 * eligiendo: una flecha que entra contra una barra dice a cuál de los dos bordes
 * va, cosa que una chinche no puede decir.
 */
const MENU_ICONS: Record<string, readonly string[]> = {
  sortAsc: ['M8 13V3.5', 'M4.5 7 8 3.5 11.5 7'],
  sortDesc: ['M8 3v9.5', 'M4.5 9 8 12.5 11.5 9'],
  // Una cruz, y no una flecha tachada.
  //
  // Se probaron las dos versiones con dibujo: dos galones con una diagonal
  // encima, y después una flecha de dos puntas tachada. Las dos terminan en un
  // borrón a 14px, que es el tamaño al que esto se ve de verdad. La cruz es la
  // marca universal de "quitar", sobrevive a cualquier tamaño y aquí no se puede
  // confundir con cerrar: el menú no tiene botón de cerrar.
  sortClear: ['M4.5 4.5 11.5 11.5', 'M11.5 4.5 4.5 11.5'],
  pinStart: ['M3 2.5v11', 'M13 8H6.5', 'M9 5 6 8l3 3'],
  pinEnd: ['M13 2.5v11', 'M3 8h6.5', 'M7 5l3 3-3 3'],
  unpin: ['M3 2.5v11', 'M6.5 8H13', 'M10 5l3 3-3 3'],
  // El ojo con curvas cúbicas explícitas: con `S` las puntas quedaban en pico y
  // el conjunto se leía como una hoja, no como un ojo.
  hide: ['M2 8c2-2.4 4-3.6 6-3.6s4 1.2 6 3.6c-2 2.4-4 3.6-6 3.6S4 10.4 2 8Z', 'M2.5 13.5 13.5 2.5'],
  // Casi una vuelta completa, con la punta al llegar arriba. El hueco arriba a
  // la derecha es lo que la distingue de un círculo: sin él no se lee como un
  // giro.
  reset: ['M11.2 4.8A4.5 4.5 0 1 1 8 3.5', 'M6.5 2.2 8 3.5 6.5 4.8'],
}

/** Una entrada del menú, ya resuelta a su texto, su dibujo y su acción. */
interface ColumnMenuItem {
  id: string
  label: string
  /** Clave dentro de {@link MENU_ICONS}. */
  icon: string
  /** Separador por encima. Agrupa sin necesidad de un nodo aparte. */
  separated?: boolean
  run: () => void
}

/**
 * El menú abierto, o `null`.
 *
 * Guarda la posición YA resuelta en coordenadas de `.dt-root`, calculada al
 * abrir. No se recalcula después: el menú se cierra ante cualquier cosa que lo
 * movería —scroll, resize, una acción— en lugar de seguir al botón frame a
 * frame, que sería trabajo por frame para algo que dura dos segundos.
 */
const columnMenu = shallowRef<{ key: string; x: number; y: number } | null>(null)
const columnMenuEl = shallowRef<HTMLElement | null>(null)

/** Ancho estimado del panel, para decidir si abre hacia la izquierda. */
const COLUMN_MENU_WIDTH = 208

/** Si una columna muestra el botón del menú. */
function hasColumnMenu(column: ResolvedColumn<TRow>): boolean {
  return props.columnMenu && column.column.menu !== false
}

/**
 * Las entradas del menú de la columna abierta.
 *
 * Se arman a partir de lo que la columna PUEDE hacer: una columna que no ordena
 * no muestra las de ordenar, y una que no se puede anclar no muestra las de
 * anclar. Un menú con la mitad de las opciones deshabilitadas obliga a leerlo
 * entero para descubrir que no servían.
 */
const columnMenuItems = computed<ColumnMenuItem[]>(() => {
  const open = columnMenu.value
  if (!open) return []
  const column = layout.getResolvedColumn(open.key)
  if (!column) return []

  const items: ColumnMenuItem[] = []
  const text = labels.value
  const current = sortFor(column.key)

  if (column.sortable) {
    if (current?.direction !== 'asc') {
      items.push({
        id: 'sort-asc',
        label: text.sortAsc,
        icon: 'sortAsc',
        run: () => setSortDirection(column, 'asc'),
      })
    }
    if (current?.direction !== 'desc') {
      items.push({
        id: 'sort-desc',
        label: text.sortDesc,
        icon: 'sortDesc',
        run: () => setSortDirection(column, 'desc'),
      })
    }
    if (current !== null) {
      items.push({
        id: 'sort-clear',
        label: text.clearSort,
        icon: 'sortClear',
        run: () => setSortDirection(column, null),
      })
    }
  }

  if (column.pinnable) {
    /*
     * Los DOS lados, no el declarado.
     *
     * `pinnable` declara a qué borde lleva el BOTÓN del encabezado, porque un
     * botón es un gesto y solo puede significar una cosa. El menú no tiene esa
     * limitación: tiene lugar para preguntar, así que pregunta. Es la única
     * forma de que el usuario mueva una columna de un borde al otro sin pasar
     * por soltarla.
     */
    // Solo la PRIMERA entrada del grupo lleva separador, y solo si hubo algo
    // antes. Calcularlo con el largo de la lista en cada `push` era correcto y
    // no se entendía.
    const grupoEmpiezaEn = items.length
    const agregar = (item: Omit<ColumnMenuItem, 'separated'>): void => {
      items.push({ ...item, separated: items.length === grupoEmpiezaEn && grupoEmpiezaEn > 0 })
    }

    if (column.pinned !== 'start') {
      agregar({
        id: 'pin-start',
        label: text.pinStart,
        icon: 'pinStart',
        run: () => pinColumnTo(column, 'start'),
      })
    }
    if (column.pinned !== 'end') {
      agregar({
        id: 'pin-end',
        label: text.pinEnd,
        icon: 'pinEnd',
        run: () => pinColumnTo(column, 'end'),
      })
    }
    if (column.pinned !== null) {
      agregar({
        id: 'unpin',
        label: text.unpin,
        icon: 'unpin',
        run: () => pinColumnTo(column, null),
      })
    }
  }

  if (column.column.hideable !== false) {
    items.push({
      id: 'hide',
      label: text.hideColumn,
      icon: 'hide',
      separated: items.length > 0,
      run: () => hideColumn(column.key),
    })
  }

  items.push({
    id: 'reset',
    label: text.resetColumns,
    icon: 'reset',
    separated: items.length > 0,
    run: () => resetLayout(),
  })

  return items
})

/** Fija el sentido de una columna sin pasar por el ciclo del clic. */
function setSortDirection(column: ResolvedColumn<TRow>, direction: SortDirection | null): void {
  const otros = sort.value.filter((entry) => entry.columnKey !== column.key)
  const next = direction === null ? otros : [...otros, { columnKey: column.key, direction }]
  setSort(next, column.key)
  scroll.scrollTo({ top: 0 })
}

/** Ancla o suelta desde el menú, sin el ciclo de alternar del botón. */
function pinColumnTo(column: ResolvedColumn<TRow>, pin: ColumnPin | null): void {
  setColumnPinning({ ...columnPinning.value, [column.key]: pin })
}

/**
 * Oculta una columna desde su menú.
 *
 * Se niega a ocultar la última visible: una tabla sin columnas no tiene forma de
 * volver, porque el menú desde el que se recupera vive justamente en un
 * encabezado. Es la misma regla que ya aplica `DataTableColumnToggle`.
 */
function hideColumn(columnKey: string): void {
  if (resolvedColumns.value.length <= 1) return
  setColumnVisibility({ ...columnVisibility.value, [columnKey]: false })
}

function openColumnMenu(event: MouseEvent, column: ResolvedColumn<TRow>): void {
  const button = event.currentTarget
  const root = rootEl.value
  if (!(button instanceof HTMLElement) || !root) return

  if (columnMenu.value?.key === column.key) {
    closeColumnMenu()
    return
  }

  const boton = button.getBoundingClientRect()
  const caja = root.getBoundingClientRect()
  // Si abrir hacia la derecha se sale de la tabla, se abre hacia la izquierda.
  // `.dt-root` recorta, así que un panel fuera de su caja no se vería.
  const derecha = boton.left - caja.left
  const x =
    derecha + COLUMN_MENU_WIDTH > caja.width
      ? Math.max(0, derecha + boton.width - COLUMN_MENU_WIDTH)
      : derecha

  columnMenu.value = { key: column.key, x, y: boton.bottom - caja.top + 2 }
  void nextTick(() => columnMenuEl.value?.querySelector('button')?.focus())
}

function closeColumnMenu(restoreFocus = false): void {
  const open = columnMenu.value
  columnMenu.value = null
  if (!open || !restoreFocus) return
  // El foco vuelve al botón que lo abrió: sin esto queda en el `body` y quien
  // navega con teclado pierde el lugar.
  void nextTick(() => {
    const selector = `.dt-header-cell[data-column-key="${CSS.escape(open.key)}"] .dt-menu-button`
    const button = rootEl.value?.querySelector(selector)
    if (button instanceof HTMLElement) button.focus()
  })
}

function runColumnMenuItem(item: ColumnMenuItem): void {
  closeColumnMenu(true)
  item.run()
}

/**
 * Cierra al hacer clic fuera del menú.
 *
 * En `pointerdown` y no en `click`: si esperara al `click`, presionar sobre una
 * celda cerraría el menú DESPUÉS de que la celda ya procesó el gesto, y el
 * usuario vería la selección moverse con el menú todavía abierto.
 */
function onDocumentPointerDown(event: PointerEvent): void {
  if (!columnMenu.value) return
  const target = event.target
  if (target instanceof Element && target.closest('.dt-column-menu, .dt-menu-button')) return
  closeColumnMenu()
}

/** Flechas para recorrer, `Escape` para salir. Mismo teclado que el selector. */
function onColumnMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeColumnMenu(true)
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

  const panel = columnMenuEl.value
  if (!panel) return
  const buttons = [...panel.querySelectorAll('button')].filter(
    (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
  )
  if (buttons.length === 0) return

  event.preventDefault()
  const current = buttons.findIndex((node) => node === document.activeElement)
  const delta = event.key === 'ArrowDown' ? 1 : -1
  const next =
    current === -1
      ? delta === 1
        ? 0
        : buttons.length - 1
      : (current + delta + buttons.length) % buttons.length
  buttons[next]?.focus()
}

/* ------------------------------------------------------------ API imperativa */

/**
 * Scrollea hasta dejar `index` como primera fila visible.
 *
 * ACOTA el índice: fuera de rango se va al borde más cercano, y una fracción se
 * trunca. Es la asimetría con {@link scrollToCell}, que no acota el suyo; el
 * porqué está documentado ahí.
 */
function scrollToRow(index: number): void {
  const maxIndex = Math.max(0, visibleRowCount.value - 1)
  const clamped = Math.min(Math.max(Math.floor(index), 0), maxIndex)
  scroll.scrollTo({ top: rowMetrics.value.offsetOf(clamped) })
}

/**
 * Scrollea hasta dejar la columna en el borde izquierdo.
 *
 * No hace nada si la columna está OCULTA o si la clave es DESCONOCIDA. Los dos
 * casos se tratan igual porque una columna oculta no tiene borde izquierdo al
 * que llevar la vista, exactamente como una que no existe. El silencio es
 * intencional: ocultar una columna es una acción normal del usuario —el selector
 * de columnas, un layout restaurado, `defaultVisible: false`—, y una tabla que
 * se queja de eso se quejaría durante el uso corriente.
 */
function scrollToColumn(key: string): void {
  const resolved = layout.getResolvedColumn(key)
  if (!resolved) return
  // Menos el ancho de la regleta: el borde izquierdo ÚTIL del viewport empieza
  // donde termina ella, y dejar la columna en `offset` la metería debajo.
  scroll.scrollTo({ left: resolved.offset - rowNumberWidth.value })
}

/**
 * Invalida el caché de celdas y agenda un repintado.
 *
 * Hace falta en dos situaciones, y conviene no confundirlas:
 *
 * 1. **Mutación de una fila en el lugar.** El caché compara por valor crudo, así
 *    que detectaría el cambio, pero nadie agenda el frame donde esa comparación
 *    ocurriría. Los repintados nacen del scroll, del `ResizeObserver` o del
 *    watcher sobre `rows`, `columns`, `stripe`, `virtualizeColumns`,
 *    `rowHeight`, las columnas resueltas y la celda en edición. Reemplazar el
 *    array de filas dispara ese watcher; mutar un objeto de fila no.
 * 2. **`format` o `cellClass` que cambian su salida por estado externo**
 *    capturado por closure —un locale, una cotización—, donde las entradas del
 *    caché son idénticas y el resultado no.
 *
 * Dentro del flujo de edición no hace falta llamarlo: cerrar el editor modifica
 * `editing`, y ese watcher ya agenda el frame.
 */
function refresh(): void {
  pool.invalidate()
  // Con grupos, el caché de celdas no es el único que quedó viejo: los
  // contadores y los agregados salen del árbol, y el árbol se reconstruye por
  // identidad de `rows`. Una mutación en el lugar no la cambia, así que sin esto
  // las cabeceras seguirían anunciando los totales anteriores mientras las celdas
  // ya muestran los nuevos. Sin agrupación es un no-op.
  grouping.rebuild()
  scroll.requestFrame()
}

/**
 * Descarta el layout guardado y vuelve al estado por defecto.
 *
 * Es el "restablecer columnas" que toda tabla configurable necesita: borrar el
 * almacenamiento sin limpiar el estado vivo dejaría al usuario mirando la misma
 * configuración que quiso descartar hasta el próximo reload.
 */
function resetLayout(): void {
  persistence.clear()
  setColumnVisibility({})
  setColumnWidths({})
  setColumnOrder([])
  // Vacío y no "todo en null": el mapa vacío devuelve el mando a lo que declaran
  // las columnas, que es lo que significa restablecer. Un mapa lleno de `null`
  // soltaría además las que el consumidor declaró ancladas.
  setColumnPinning({})
  setSort([], '')
  setGroupBy([])
  grouping.setCollapsedGroups([])
}

/** Escribe de inmediato el layout pendiente por el debounce. */
function flushPersistence(): void {
  persistence.flush()
}

/**
 * Fija la celda activa desde fuera del componente.
 *
 * Se diferencia del `selectCell` interno en que además trae la celda a la vista:
 * quien la llama por código —un resultado de búsqueda, un enlace profundo— no
 * tiene forma de saber si esa celda estaba dentro de la ventana.
 *
 * ## Con una columna oculta o desconocida
 *
 * La posición se GUARDA y se anuncia por `update:activeCell` igual que
 * cualquier otra, porque es la posición que pidió quien llamó y el componente no
 * inventa una distinta. Lo que no ocurre es el resto: no se emite `cellSelect`
 * —no hay columna que reportar—, ninguna celda se pinta activa, y `.dt-root`
 * informa `data-active-cell="false"`, de modo que el anillo de foco del viewport
 * sigue disponible como única señal visible.
 */
function selectCellFromApi(position: CellPosition | null): void {
  selectCell(position)
  if (position) scrollToCell(position)
}

/**
 * Fija el rango desde fuera del componente.
 *
 * Mueve también la celda activa, porque el ancla del rango y la celda activa son
 * la misma posición. Desplaza hasta el FOCO y no hasta el ancla: la punta móvil
 * es la que interesa ver, igual que al terminar un arrastre.
 */
function selectRangeFromApi(range: CellRange | null): void {
  if (!rangeEnabled.value) return
  cellRange.set(range)
  if (range) scrollToCell(range.focus)
}

defineExpose({
  scrollToRow,
  scrollToColumn,
  scrollToCell,
  selectCell: selectCellFromApi,
  selectRange: selectRangeFromApi,
  refresh,
  refreshRows: remote.refresh,
  resetLayout,
  flushPersistence,
  toggleGroup: grouping.toggleGroup,
  expandAllGroups: grouping.expandAll,
  collapseAllGroups: grouping.collapseAll,
})

/* ------------------------------------------------------------- Ciclo de vida */

onMounted(() => {
  const canvas = canvasEl.value
  if (canvas) pool.mount(canvas, gutterEl.value)
  scroll.requestFrame()
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

/**
 * El menú se cierra al scrollear, en lugar de seguir a su encabezado.
 *
 * Su posición se resuelve UNA vez, al abrir. Recalcularla por frame sería
 * trabajo en el camino caliente del scroll para algo que dura dos segundos, y
 * dejarla quieta lo mostraría flotando lejos de la columna a la que pertenece.
 * Cerrar es la tercera opción y la única que no miente.
 */
watch(
  () => scroll.state.value.scrollLeft,
  () => {
    if (columnMenu.value) closeColumnMenu()
  },
)

/**
 * Encender o apagar la numeración reconstruye el pool.
 *
 * Es deliberadamente lo más caro que hace esta prop, y también lo más simple: el
 * nodo de número nace junto a su fila y comparte su slot, así que agregarlo o
 * sacarlo a mitad de vuelo significaría recorrer el pool entero igual. Es una
 * prop de configuración —se decide una vez por tabla—, no algo que cambie
 * durante el uso.
 */
watch(
  () => props.showRowNumbers,
  async () => {
    // Después del render: con la prop recién encendida, el carril todavía no
    // existe en el DOM cuando este watcher corre.
    await nextTick()
    const canvas = canvasEl.value
    if (canvas) pool.mount(canvas, gutterEl.value)
    scroll.requestFrame()
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  // `useScrollSync` y `useCellEditor` limpian lo suyo con sus propios hooks; el
  // pool no es un composable de Vue, así que se desmonta explícitamente.
  pool.unmount()
  // El destello del copiado se apaga con un temporizador propio, que podría
  // vencer después del desmontaje y escribir sobre un componente que ya no está.
  if (copyFlashTimer !== 0) clearTimeout(copyFlashTimer)
})

/* --------------------------------------------------------------- Presentación */

const rootStyle = computed(() => ({
  '--dt-row-height': `${rowHeight.value}px`,
  '--dt-header-height': `${headerHeight.value}px`,
  // Igual que las alturas: el número lo decide JS —porque de él dependen los
  // offsets de todas las columnas— y el CSS lo espeja, nunca al revés.
  '--dt-row-number-width': `${rowNumberWidth.value}px`,
}))

const canvasStyle = computed(() => ({
  width: `${totalWidth.value}px`,
  height: `${rowVirtual.totalSize.value}px`,
}))

/**
 * El encabezado mide lo mismo que el canvas de ancho.
 *
 * Vive dentro del scroller, así que ser tan ancho como el contenido es lo que
 * hace que se desplace con él sin que nadie lo empuje, y lo que le da a la tira
 * anclada al final un borde derecho contra el cual pegarse.
 */
const headerStyle = computed(() => ({ width: `${totalWidth.value}px` }))

/**
 * Rol de la grilla.
 *
 * Con grupos activos la estructura ES un árbol tabular: filas que se pliegan,
 * anidadas en niveles. `treegrid` es lo que hace que un lector de pantalla
 * anuncie `aria-expanded` y `aria-level`, que con `grid` simplemente ignoraría.
 * Sin grupos vuelve a ser una grilla plana, que es exactamente lo que es.
 *
 * ## Por qué el rol vive en `.dt-root` y no en el viewport
 *
 * Porque la grilla tiene que CONTENER a su fila de encabezado, y la raíz es lo
 * único que con seguridad la contiene. Cuando el rol estuvo en `.dt-viewport` el
 * encabezado se dibujaba por fuera, y la aritmética de índices —`aria-rowcount` =
 * entradas + 1, `aria-rowindex` = posición + 2— anunciaba una fila 1 que la
 * tecnología asistiva no podía encontrar.
 *
 * Desde que el encabezado se mudó adentro del viewport, ese contenedor también
 * sería un lugar válido para el rol: los dos `rowgroup` son suyos. Se deja en la
 * raíz igual, para no cambiar el contrato público ni separar al elemento que
 * anuncia la grilla del que recibe el foco. ARIA no exige que la grilla sea el
 * contenedor con scroll.
 */
const gridRole = computed(() => (grouping.active.value ? 'treegrid' : 'grid'))

/**
 * Si hay una celda activa QUE SE PINTA, expuesto como atributo para la hoja de
 * estilos.
 *
 * Es lo que suprime el anillo de foco del viewport cuando `focusRing` está
 * encendido: con la celda ya marcada, encerrar además la tabla entera serían dos
 * señales para una sola posición.
 *
 * ## Por qué mira la columna resuelta y no solo `activeCell`
 *
 * La condición que la hoja de estilos necesita no es "hay una posición
 * guardada", es "hay una marca visible en pantalla". Las dos se separan cuando
 * la columna de la posición activa no resuelve a ninguna columna pintada, y eso
 * pasa por dos caminos distintos:
 *
 * 1. `selectCell()` recibió por código una clave de columna que no existe.
 * 2. El usuario ocultó la columna donde estaba parado, con el selector de
 *    columnas o restaurando un layout guardado.
 *
 * En los dos casos `activeColumnIndex` vale -1 y NINGUNA celda se pinta activa.
 * Reportar `'true'` ahí apagaba el anillo sin poner nada en su lugar: la tabla
 * quedaba enfocada, el usuario navegando por teclado, y cero señales visuales de
 * dónde estaba parado. El anillo vuelve justamente porque ahora es la única
 * señal que queda.
 *
 * Nótese que esto NO cambia la selección: la posición sigue guardada y se sigue
 * anunciando por `update:activeCell`. Lo único que cambia es qué se le dice a la
 * hoja de estilos, que es la parte que estaba mintiendo.
 *
 * ## Sigue sin costar nada por frame
 *
 * Va como atributo escrito por Vue sobre `.dt-root` y NO como una escritura del
 * pool. `activeColumnIndex` es un `computed` que ya existía y que depende de
 * `activeCell` y de `resolvedColumns`: ninguna de las dos se mueve durante el
 * scroll, que es el único camino verdaderamente caliente. Cambia al aparecer o
 * desaparecer la selección, y ahora también al ocultar o mostrar la columna
 * activa —un cambio de configuración, no un frame—. Vue parchea un atributo
 * únicamente cuando su valor cambia, así que recorrer la tabla entera con las
 * flechas sigue sin escribir nada aquí.
 */
const hasActiveCell = computed(() => (activeColumnIndex.value >= 0 ? 'true' : 'false'))

function headerAlignClass(column: ResolvedColumn<TRow>): string | undefined {
  if (column.align === 'center') return 'dt-header-cell--center'
  if (column.align === 'right') return 'dt-header-cell--right'
  return undefined
}
</script>

<template>
  <!--
    La raíz ES la grilla accesible: es el único elemento que contiene a la vez la
    fila de encabezado y el cuerpo. Por eso `aria-rowcount` cuenta esa fila de
    más, y por eso cada fila de datos anuncia su posición corrida en uno.
  -->
  <div
    ref="rootEl"
    class="dt-root"
    :style="rootStyle"
    :role="gridRole"
    :aria-rowcount="visibleRowCount + 1"
    :aria-colcount="resolvedColumns.length"
    :data-dense="dense ? 'true' : 'false'"
    :data-theme="theme"
    :data-variant="variant"
    :data-radius="radiusBorder"
    :data-bordered="bordered ? 'true' : 'false'"
    :data-selection="selectionMode"
    :data-focus-ring="focusRing ? 'true' : 'false'"
    :data-crosshair="crosshair ? 'true' : 'false'"
    :data-active-cell="hasActiveCell"
    :data-range="rangeRect ? 'true' : 'false'"
    :data-select-columns="columnSelection ? 'true' : 'false'"
    :data-select-rows="rowSelection ? 'true' : 'false'"
    :data-reorder="columnReorder ? 'true' : 'false'"
  >
    <!--
      El viewport scrollea y recibe el teclado, pero ya no es la grilla: es un
      contenedor sin rol propio entre la grilla y su cuerpo. El foco se queda
      aquí porque es el elemento que scrollea, y moverlo a la raíz separaría el
      anillo de foco de la caja que el usuario está desplazando. En modo `none`
      el manejador es `undefined`, y entonces Vue directamente no registra el
      listener.

      RECIBIR el foco y PINTARLO son dos cosas distintas: el foco vive siempre
      aquí, porque es lo que hace que las teclas lleguen, y si además se dibuja un
      anillo lo deciden `focusRing` y `data-active-cell` desde la hoja de
      estilos.
    -->
    <div
      ref="viewportEl"
      class="dt-viewport"
      :tabindex="selectionMode === 'none' ? -1 : 0"
      v-on="viewportListeners"
    >
      <div class="dt-header" role="rowgroup" :style="headerStyle">
        <!--
          La FILA de encabezado de la grilla. Las celdas las renderiza Vue: son
          pocas y cambian solo cuando cambia la configuración de columnas. El
          scroll horizontal NO las vuelve a diferenciar y tampoco las mueve nadie:
          esta fila vive dentro del viewport y se desplaza con el contenido, como
          cualquier otra cosa que esté ahí adentro.

          Sus hijos —la esquina y las tres tiras— son `role="none"`: son cajas de
          posicionamiento, y para ARIA tienen que ser transparentes para que los
          `columnheader` sigan perteneciendo a esta fila y no a un contenedor
          intermedio.
        -->
        <div class="dt-header-row" role="row" aria-rowindex="1">
          <!--
            Esquina sobre la regleta de numeración. Es el primer tramo del `flex`,
            así que además de taparla le reserva su ancho: la tira anclada que sigue
            arranca justo donde termina. Decorativa, y por eso `aria-hidden`.
          -->
          <div v-if="showRowNumbers" class="dt-corner" role="none" aria-hidden="true" />
          <div
            v-for="strip in headerStrips"
            :key="strip.id"
            :class="strip.className"
            :style="strip.style"
            role="none"
          >
            <div
              v-for="column in strip.columns"
              :key="column.key"
              class="dt-header-cell"
              role="columnheader"
              :aria-colindex="column.index + 1"
              :class="[
                headerAlignClass(column),
                {
                  'dt-header-cell--active': !rowMode && column.key === activeCell?.columnKey,
                },
                { 'dt-header-cell--range': isColumnInRange(column.index) },
                { 'dt-header-cell--dragging': columnDrag?.key === column.key },
                { 'dt-header-cell--fixed': columnReorder && !column.reorderable },
                { 'dt-header-cell--pinned': column.pinned !== null },
                { 'dt-header-cell--pinnable': column.pinSide !== null },
                { 'dt-header-cell--menu': hasColumnMenu(column) },
                { 'dt-header-cell--sortable': column.sortOnHeaderClick && !columnSelection },
                { 'dt-header-cell--sorted': sortFor(column.key) !== null },
              ]"
              :style="{
                transform: `translate3d(${column.offset - strip.origin}px, 0, 0)`,
                width: `${column.width}px`,
              }"
              :data-column-key="column.key"
              :aria-sort="ariaSortFor(column)"
              :title="column.label"
              @pointerdown="onHeaderPointerDown($event, column)"
              @click="onHeaderClick($event, column)"
            >
              <!--
                La tricasilla de la columna de selección, que reemplaza al título:
                esa columna no tiene ninguno y la casilla es todo su contenido.

                `checked` e `indeterminate` se escriben A MANO, desde un
                `watchEffect`, en lugar de ligarlas. No es preferencia y costó dos
                intentos fallidos:

                Ligar `:checked` termina escribiendo el ATRIBUTO `checked`, y en un
                checkbox el atributo solo fija el valor INICIAL: después del primer
                clic el elemento queda "sucio" y el atributo ya no mueve nada. La
                casilla se quedaba vacía con la tabla entera marcada.
                `indeterminate` ni siquiera existe como atributo. Las dos viven
                solo como propiedad, así que se escriben como propiedad.

                Y NO lleva `.prevent`, aunque parezca que debería. El navegador
                alterna la casilla él solo al recibir el clic, y `preventDefault`
                no cancela ese cambio: lo REVIERTE después de los manejadores,
                pisando lo que el efecto acababa de escribir. Se lo deja alternar y
                el efecto corrige, que siempre alcanza: cada clic sobre esta
                casilla cambia el estado, así que el efecto siempre vuelve a
                correr.
              -->
              <input
                v-if="column.key === SELECTION_COLUMN_KEY"
                class="dt-checkbox dt-selection-checkbox"
                type="checkbox"
                tabindex="-1"
                :aria-label="headerSelectionLabel"
                :ref="registerHeaderSelectionInput"
                @click.stop="onHeaderSelectionToggle"
              />
              <span v-else class="dt-header-label">{{ column.label }}</span>
              <!--
                Indicador del orden. Solo existe mientras la columna ordena, así
                que una tabla sin ordenamiento no paga un nodo por encabezado.

                `aria-hidden` porque lo que dice ya lo dice `aria-sort` sobre el
                encabezado, que es el atributo que un lector de pantalla anuncia
                al recorrer la fila de títulos. La flecha es para los ojos.
              -->
              <span v-if="sortFor(column.key)" class="dt-sort-indicator" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <path
                    :d="
                      sortFor(column.key)?.direction === 'asc'
                        ? 'M8 3.5 12.5 9h-9z'
                        : 'M8 12.5 3.5 7h9z'
                    "
                    fill="currentColor"
                  />
                </svg>
                <!-- La posición solo aparece con más de un criterio: con uno, no
                     agrega nada a la flecha. -->
                <span v-if="sortRankFor(column.key) > 0" class="dt-sort-rank">
                  {{ sortRankFor(column.key) }}
                </span>
              </span>
              <!--
                Botón de anclar. Solo existe si la columna declara `pinnable`, y
                por eso una tabla que no use la función no paga ni un nodo.

                `aria-pressed` y no dos botones distintos: es UN control con dos
                estados, y es lo que hace que un lector de pantalla anuncie el
                cambio en vez de leer un botón nuevo.
              -->
              <button
                v-if="column.pinSide"
                type="button"
                class="dt-pin-button"
                :class="{ 'dt-pin-button--on': column.pinned !== null }"
                :aria-pressed="column.pinned !== null"
                :aria-label="column.pinned !== null ? labels.unpin : labels.pin"
                :title="column.pinned !== null ? labels.unpin : labels.pin"
                tabindex="-1"
                @click="toggleColumnPinned(column)"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path
                    d="M10.3 1.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-.4.4a2 2 0 0 1-2.3.4L10 8.1l.3 2.6a1 1 0 0 1-.3.8l-.6.6a1 1 0 0 1-1.4 0L5.6 9.6l-3.2 3.2a.6.6 0 0 1-.9-.9l3.2-3.2-2.5-2.4a1 1 0 0 1 0-1.4l.6-.6a1 1 0 0 1 .8-.3L6.2 4l1.2-1.6a2 2 0 0 1 .4-2.3z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <!--
                Botón del menú. Va DESPUÉS del de anclar y antes del handle, que
                es el orden en que están sobre el borde derecho.
              -->
              <button
                v-if="hasColumnMenu(column)"
                type="button"
                class="dt-menu-button"
                :class="{ 'dt-menu-button--on': columnMenu?.key === column.key }"
                :aria-label="labels.menu"
                :title="labels.menu"
                :aria-expanded="columnMenu?.key === column.key"
                aria-haspopup="menu"
                tabindex="-1"
                @click="openColumnMenu($event, column)"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle cx="8" cy="3.5" r="1.4" fill="currentColor" />
                  <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                  <circle cx="8" cy="12.5" r="1.4" fill="currentColor" />
                </svg>
              </button>
              <span
                v-if="column.resizable"
                class="dt-resize-handle"
                role="separator"
                aria-orientation="vertical"
                @pointerdown="onResizePointerDown($event, column)"
              />
            </div>
          </div>
        </div>
      </div>
      <!--
        El canvas solo dimensiona la barra de scroll. Sus hijos los inyecta
        useRowPool, y son exactamente las filas del cuerpo: por eso el
        `rowgroup` va aquí y no en el viewport, que además contiene al host del
        editor.
      -->
      <div ref="canvasEl" class="dt-canvas" role="rowgroup" :style="canvasStyle" />
      <!--
        Carril de numeración.

        Vive adentro del viewport y fuera del canvas, y esas dos cosas son las
        que lo definen: adentro del viewport acompaña al scroll VERTICAL sin que
        nadie lo reposicione, y fuera del canvas está en el FLUJO, que es lo que
        le permite quedarse quieto en horizontal con `position: sticky` —o sea,
        sostenido por el compositor y no por JS—.

        Sus hijos los inyecta el pool, por el mismo slot que la fila a la que
        acompañan: el número y su fila nacen juntos y se reciclan juntos.
      -->
      <div
        v-if="showRowNumbers"
        ref="gutterEl"
        class="dt-gutter"
        aria-hidden="true"
        :style="{ height: `${rowVirtual.totalSize.value}px` }"
      />
      <!--
        Recuadro del rango: UN nodo para las cuatro líneas y el cuadradito de la
        esquina, en lugar de un borde por celda. Las celdas del rango solo ponen
        el tinte, que sí es por celda; el contorno no lo es, y pintarlo con
        bordes obligaría a saber cuál celda es la del extremo —dato que el pool
        no tiene, porque recicla sus nodos por slot y no por posición visual.

        Vive fuera de `.dt-canvas` por lo mismo que el host del editor: el canvas
        es territorio del pool. `pointer-events: none` lo deja fuera del camino
        del arrastre, que tiene que seguir viendo las celdas de abajo.
      -->
      <div v-if="rangeBox" class="dt-range-box" :style="rangeBox" aria-hidden="true" />
      <!--
        Confirmación del copiado: las mismas líneas, cambiando de color y
        volviendo. Se monta sobre el área que se copió y se desmonta al terminar.
        El `key` es lo que hace que dos copiados seguidos se vean como dos.
      -->
      <div
        v-if="copyFlash"
        :key="copyFlash.id"
        class="dt-copy-flash"
        :style="copyFlash.style"
        aria-hidden="true"
      />
      <!--
        Host de los controles de edición. Vue lo renderiza una vez y nunca toca
        sus hijos: useCellEditor monta ahí un control por tipo, de forma
        perezosa. Al vivir dentro del viewport que scrollea, los controles
        acompañan al scroll sin reposicionarse.
      -->
      <div ref="editorHostEl" class="dt-editor-host" />
      <!--
        Caja del editor por slot. Solo existe si la tabla declara `#editor`: sin
        el slot, este nodo no se renderiza y el DOM queda exactamente como antes
        de que la función existiera.

        Vive aquí y NO dentro de `.dt-canvas` por la misma razón que el host de los
        editores incluidos: el canvas es territorio del pool, que recicla sus
        nodos por slot de viewport y no puede convivir con un árbol que administre
        Vue. Aquí adentro el contenido acompaña al scroll sin reposicionarse,
        porque el viewport es el elemento que se desplaza.

        `hidden` lo escribe Vue a partir de `editorSlotProps`; la posición y el
        tamaño los escribe `useCellEditor` en cada frame con editor abierto. Son
        dos dueños para dos cosas distintas, nunca para la misma.
      -->
      <div
        v-if="$slots.editor"
        ref="slotEditorHostEl"
        class="dt-editor-slot"
        tabindex="-1"
        :hidden="editorSlotProps === null"
        @keydown="onSlotEditorKeyDown"
      >
        <slot v-if="editorSlotProps" name="editor" v-bind="editorSlotProps" />
      </div>
    </div>

    <!--
      Esperando NO es "sin datos". Mientras `loading` esté encendido el mensaje se
      calla: decir "no hay resultados" sobre una consulta que todavía no respondió
      es afirmar algo que nadie sabe.
    -->
    <!--
      Sin texto no hay elemento, y no solo un elemento sin texto.
      `.dt-empty` dibuja una línea arriba y reserva 2rem de aire a cada lado: con
      la cadena vacía eso dejaba una franja de 4rem cruzada por un separador que
      no separa nada de nada. `emptyText=""` es la forma de decir "no muestres
      nada", y eso tiene que incluir lo que dibuja la caja.
    -->
    <div v-if="showEmptyMessage" class="dt-empty">{{ emptyText }}</div>

    <!--
      Línea de caída: dónde va a quedar la columna que se está arrastrando.

      Va aquí, en la raíz, y no adentro del viewport: la raíz no scrollea, así que
      la línea puede atravesar el header y el cuerpo de una sola pieza. Adentro
      del viewport se desplazaría con el cuerpo y dejaría de coincidir con el
      hueco que promete.
    -->
    <div
      v-if="dropIndicatorStyle"
      class="dt-drop-indicator"
      :style="dropIndicatorStyle"
      aria-hidden="true"
    />
    <!--
      El fantasma de la columna que se arrastra.

      Va en la raíz por lo mismo que la línea de caída: la raíz no scrollea, así
      que el fantasma sigue al puntero por toda la tabla sin que el scroll lo
      corra. Y queda recortado por ella, que es lo correcto: soltar fuera de la
      tabla no mueve nada, y el fantasma desapareciendo en el borde lo anticipa.

      `aria-hidden` porque no es información: el título que muestra ya está en el
      encabezado, y ese sigue en el documento mientras dura el gesto.
    -->
    <!--
      Menú de la columna.

      Vive en la raíz y no adentro del encabezado por dos razones: la tira de
      encabezados scrollea en horizontal y se llevaría el panel con ella, y
      además recorta, así que un panel más alto que el encabezado quedaría
      cortado. Aquí queda recortado por la tabla entera, que es lo correcto.
    -->
    <div
      v-if="columnMenu"
      ref="columnMenuEl"
      class="dt-column-menu"
      role="menu"
      :style="{ transform: `translate3d(${columnMenu.x}px, ${columnMenu.y}px, 0)` }"
      @keydown="onColumnMenuKeyDown"
    >
      <button
        v-for="item in columnMenuItems"
        :key="item.id"
        type="button"
        class="dt-column-menu-item"
        :class="{ 'dt-column-menu-item--separated': item.separated }"
        role="menuitem"
        @click="runColumnMenuItem(item)"
      >
        <svg class="dt-column-menu-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path v-for="d in MENU_ICONS[item.icon]" :key="d" :d="d" />
        </svg>
        <span>{{ item.label }}</span>
      </button>
    </div>
    <div
      v-if="columnGhostStyle"
      class="dt-column-ghost"
      :style="columnGhostStyle"
      aria-hidden="true"
    >
      {{ columnDrag?.label }}
    </div>
  </div>
</template>
