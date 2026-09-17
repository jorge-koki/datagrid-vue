<script setup lang="ts" generic="TRow extends Record<string, unknown>">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellEditorSlotProps,
  CellPosition,
  CellRange,
  CellSelectEvent,
  CellValue,
  ColumnResizeEvent,
  ColumnVisibilityState,
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
  RowsRequestEvent,
} from './types'
import { useVirtualWindow } from './composables/useVirtualWindow'
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
} from './internal/constants'
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
  // enteras porque alguien apretó un título.
  columnSelection: false,
  rowSelection: false,
  emptyText: 'No data',
  stripe: false,
  bordered: false,
  selectionMode: 'cell',
  rangeSelection: true,
  // Apagado por defecto: con una celda marcada, el anillo del viewport es una
  // segunda señal para la misma posición y encierra toda la tabla en un borde de
  // color. El costo de accesibilidad de este default está documentado en el
  // README, junto con el caso en el que conviene encenderlo.
  focusRing: false,
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

const columnVisibility = computed<ColumnVisibilityState>(
  () => props.columnVisibility ?? internalVisibility.value,
)
const columnOrder = computed<readonly string[]>(() => props.columnOrder ?? internalOrder.value)
const columnWidths = computed<ColumnWidthState>(() => props.columnWidths ?? internalWidths.value)

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

/* ------------------------------------------------------- Estado de agrupación */

/**
 * Agrupación y expansión: exactamente la misma disciplina que las columnas.
 *
 * Si la prop llega `undefined` el estado vive adentro; si llega con valor, la
 * prop manda y el componente solo emite. La única diferencia con el trío de
 * columnas es que acá el estado interno de expansión no lo guarda este
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

const viewportEl = shallowRef<HTMLElement | null>(null)
const canvasEl = shallowRef<HTMLElement | null>(null)
const gutterEl = shallowRef<HTMLElement | null>(null)
const editorHostEl = shallowRef<HTMLElement | null>(null)
const slotEditorHostEl = shallowRef<HTMLElement | null>(null)

/* -------------------------------------------------------------- Métricas base */

/**
 * Altura de fila efectiva.
 *
 * Es un número en px y no un valor CSS porque el virtualizador divide por él en
 * cada frame. Se replica a `--dt-row-height` para que la presentación coincida.
 */
const rowHeight = computed(() => {
  const declared = props.rowHeight
  if (declared !== undefined && Number.isFinite(declared) && declared > 0) return declared
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
        'entero. Agrupá del lado del servidor y mandá las filas ya ordenadas.',
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
 * Es el punto exacto donde el modo servidor separa las dos cosas que hasta acá
 * eran una sola: cuántas filas HAY lo dice `rowCount`, y qué hay en cada índice
 * lo dice `rows`. Sin `rowCount` las dos siguen saliendo del mismo lado.
 */
const visibleRowCount = computed(() => {
  if (!serverMode.value) return grouping.totalCount.value
  const raw = props.rowCount ?? 0
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
})

/* ------------------------------------------------------------ Layout y scroll */

/**
 * Ancho de la regleta de numeración, o 0 si la tabla no numera.
 *
 * ## Primero cuadrada, después lo que haga falta
 *
 * El ancho de referencia es la ALTURA DE FILA: una casilla cuadrada, que es la
 * forma que tiene la numeración en cualquier planilla y la que hace que se lea
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

const layout = useColumnLayout<TRow>({
  columns: () => props.columns,
  defaultColumnWidth: () => props.defaultColumnWidth,
  visibility: columnVisibility,
  order: columnOrder,
  widths: columnWidths,
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

const rowVirtual = useVirtualWindow({
  itemCount: visibleRowCount,
  itemSize: rowHeight,
  viewportSize: () => rowViewportHeight.value,
  scrollOffset: () => scroll.state.value.scrollTop,
  overscan: () => props.overscan,
})

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
    // celda es lo que lo cierra, con la misma semántica de planilla que ya
    // aplicaba `beginEdit`. Los controles incluidos no pasan por acá; los
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
    editor.commitValue(position, nextValue)
  },
  onGroupToggle: (groupId) => {
    grouping.toggleGroup(groupId)
  },
})

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
 * componente, y por eso se hace acá y no en cada emisión. Adentro todo trabaja en
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
 * El rango, con la celda activa como ancla.
 *
 * No es un segundo estado de selección: el ancla ES `activeCell`, y acá solo
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

  const height = rowHeight.value
  return {
    transform: `translate3d(${left}px, ${rect.rowStart * height}px, 0)`,
    width: `${Math.max(0, right - left)}px`,
    height: `${(rect.rowEnd - rect.rowStart + 1) * height}px`,
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
 * marca tiene que aparecer al apretar. El handle de redimensionado queda afuera
 * —es un hijo del encabezado y tiene su propio gesto—, porque terminar un
 * arrastre de ancho seleccionando la columna sería una sorpresa en cada resize.
 */
function onHeaderPointerDown(event: PointerEvent, column: ResolvedColumn<TRow>): void {
  const target = event.target
  // El handle de redimensionado vive adentro del encabezado y tiene su propio
  // gesto: ni selecciona la columna ni la mueve.
  if (target instanceof Element && target.closest('.dt-resize-handle')) return
  if (event.button !== 0) return

  if (props.columnReorder && column.reorderable) startColumnDrag(event, column)
  if (!props.columnSelection) return

  /*
   * `preventDefault` acá no es ceremonia: sin él, el copiado no funciona.
   *
   * Apretar sobre un elemento que no es enfocable hace que el navegador lleve el
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
 *    planilla que ya aplica `beginEdit`— y el teclado tiene que quedar
 *    apuntando al viewport.
 *
 * En modo `none` no se llega hasta acá: el llamador corta antes, así que una
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
  // la tabla, justo debajo del puntero del usuario. El foco acá se toma para
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
 * `moveActiveTo`, así que volver a acotarla sería trabajo repetido en cada
 * flecha. Fuera de rango, el navegador acota la escritura de `scrollTop` contra
 * la altura real del canvas, de modo que la consecuencia observable es la misma:
 * la vista se queda en el extremo.
 */
function scrollToCell(position: CellPosition): void {
  const metrics = scroll.live
  const height = rowHeight.value

  const rowTop = position.rowIndex * height
  const rowBottom = rowTop + height
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

/** Cantidad de filas que entran enteras en el viewport. Mínimo 1. */
function pageSize(): number {
  const rows = Math.floor(liveRowViewportHeight() / rowHeight.value)
  return Math.max(1, rows)
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
 * `Home` y `End` no pasan por acá justamente porque no son movimientos con
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
 * A diferencia de las flechas, acá sí se pasa a la fila siguiente o anterior al
 * llegar al borde: es lo que hace Tab en un formulario y en una planilla, y es
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
      if (group && !group.expanded) grouping.toggleGroup(group.groupId)
      else moveOrExtendBy(shift, 0, 1)
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
      else moveOrExtendBy(shift, 0, -1)
      return
    }
    case 'Tab':
      event.preventDefault()
      // `Shift`+`Tab` es "la celda anterior" y no "extender": es la única tecla
      // donde `Shift` ya significaba otra cosa, y esa otra cosa la espera todo
      // el mundo. Tabular colapsa el rango como cualquier movimiento.
      moveActiveInReadingOrder(!shift)
      return
    case 'Home':
      event.preventDefault()
      if (ctrl) moveOrExtendTo(shift, 0, 0)
      // Absoluto, igual que `End` acá abajo, y no un delta negativo enorme que
      // `moveActiveTo` termine acotando. Expresado como delta, `Home` sería un
      // movimiento "hacia la izquierda" y sin celda activa entraría por el borde
      // derecho, que es exactamente lo contrario de lo que significa `Home`.
      else moveOrExtendTo(shift, rowForAbsoluteJump(shift), 0)
      return
    case 'End':
      event.preventDefault()
      if (ctrl) moveOrExtendTo(shift, lastRow, lastColumn)
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
      else editActiveCell()
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
 * la clave con valor indefinido. Acá, en modo `none`, la clave no existe y Vue
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
function onViewportCopy(event: ClipboardEvent): void {
  if (editor.editing.value) return

  const rect = cellRange.rect.value
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
  return {
    x: columnCanvasX(resolved),
    y: position.rowIndex * rowHeight.value,
    width: resolved.width,
    height: rowHeight.value,
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
    // Enter confirma y baja una fila, como en una planilla. La selección se
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
 * Escape descarta, igual que en un editor incluido. El resto se detiene acá y no
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
function resolveRowKey(row: TRow, index: number): string {
  const key = props.rowKey
  if (typeof key === 'function') return String(key(row, index))
  return String(row[key])
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
   * Nada de lo que se pasa acá depende del scroll horizontal, y eso es
   * deliberado: las columnas ancladas y la regleta de numeración se quedan
   * quietas por `position: sticky`, o sea que las sostiene el compositor.
   *
   * Antes se las corría desde acá, leyendo el scroll del instante para que "no
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
    rowRange: rowVirtual.window.value,
    columns: visibleColumns.value,
    rowHeight: rowHeight.value,
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
    rowHeight,
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
  ],
  () => scroll.requestFrame(),
  { flush: 'post' },
)

/**
 * Recorta el pool cuando el viewport se achica.
 *
 * Es el único momento en que el pool puede encoger: hacerlo durante el scroll
 * destruiría los nodos que el frame siguiente va a volver a pedir.
 */
watch(rowViewportHeight, (height) => {
  pool.trim(Math.ceil(height / rowHeight.value) + props.overscan * 2 + 1)
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

  // Más allá de la última: la línea va contra su borde derecho.
  const last = columns[columns.length - 1]
  return last ? last.offset + last.width : null
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
 * ocurrió en `pointerdown`. Recién al cruzarlo aparece la línea de caída y el
 * encabezado se marca como en vuelo.
 *
 * Se usa `setPointerCapture` sobre el encabezado: acá sí conviene, al revés que
 * en el arrastre de celdas. Ahí hacía falta saber sobre qué celda estaba el
 * puntero, y la captura habría retargeteado todos los eventos; acá la posición
 * se calcula con aritmética sobre `clientX`, así que capturar solo garantiza que
 * el `pointerup` llegue aunque se suelte fuera de la tabla.
 */
function startColumnDrag(event: PointerEvent, column: ResolvedColumn<TRow>): void {
  const header = event.currentTarget
  if (!(header instanceof HTMLElement)) return

  const startX = event.clientX
  let dragging = false

  header.setPointerCapture(event.pointerId)

  const onPointerMove = (moveEvent: PointerEvent): void => {
    if (!dragging) {
      if (Math.abs(moveEvent.clientX - startX) < REORDER_THRESHOLD) return
      dragging = true
    }
    columnDrag.value = {
      key: column.key,
      dropIndex: dropIndexAt(moveEvent.clientX, column.key),
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
    if (drop && drag) moveColumn(drag.key, drag.dropIndex)
  }

  const onPointerUp = (upEvent: PointerEvent): void => finish(upEvent, true)
  // Cancelar es lo contrario de soltar: el gesto se abandona y nada se mueve.
  const onPointerCancel = (cancelEvent: PointerEvent): void => finish(cancelEvent, false)

  header.addEventListener('pointermove', onPointerMove)
  header.addEventListener('pointerup', onPointerUp)
  header.addEventListener('pointercancel', onPointerCancel)
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
  scroll.scrollTo({ top: clamped * rowHeight.value })
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
})

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
 * flechas sigue sin escribir nada acá.
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
    :data-active-cell="hasActiveCell"
    :data-range="rangeRect ? 'true' : 'false'"
    :data-select-columns="columnSelection ? 'true' : 'false'"
    :data-select-rows="rowSelection ? 'true' : 'false'"
    :data-reorder="columnReorder ? 'true' : 'false'"
  >
    <!--
      El viewport scrollea y recibe el teclado, pero ya no es la grilla: es un
      contenedor sin rol propio entre la grilla y su cuerpo. El foco se queda
      acá porque es el elemento que scrollea, y moverlo a la raíz separaría el
      anillo de foco de la caja que el usuario está desplazando. En modo `none`
      el manejador es `undefined`, y entonces Vue directamente no registra el
      listener.

      RECIBIR el foco y PINTARLO son dos cosas distintas: el foco vive siempre
      acá, porque es lo que hace que las teclas lleguen, y si además se dibuja un
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
                { 'dt-header-cell--active': column.key === activeCell?.columnKey },
                { 'dt-header-cell--range': isColumnInRange(column.index) },
                { 'dt-header-cell--dragging': columnDrag?.key === column.key },
                { 'dt-header-cell--fixed': columnReorder && !column.reorderable },
                { 'dt-header-cell--pinned': column.pinned !== null },
              ]"
              :style="{
                transform: `translate3d(${column.offset - strip.origin}px, 0, 0)`,
                width: `${column.width}px`,
              }"
              :title="column.label"
              @pointerdown="onHeaderPointerDown($event, column)"
            >
              <span class="dt-header-label">{{ column.label }}</span>
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
        `rowgroup` va acá y no en el viewport, que además contiene al host del
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

        Vive acá y NO dentro de `.dt-canvas` por la misma razón que el host de los
        editores incluidos: el canvas es territorio del pool, que recicla sus
        nodos por slot de viewport y no puede convivir con un árbol que administre
        Vue. Acá adentro el contenido acompaña al scroll sin reposicionarse,
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

    <div v-if="rows.length === 0" class="dt-empty">{{ emptyText }}</div>

    <!--
      Línea de caída: dónde va a quedar la columna que se está arrastrando.

      Va acá, en la raíz, y no adentro del viewport: la raíz no scrollea, así que
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
  </div>
</template>
