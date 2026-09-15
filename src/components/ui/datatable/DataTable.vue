<script setup lang="ts" generic="TRow extends Record<string, unknown>">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellPosition,
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
} from './types'
import { useVirtualWindow } from './composables/useVirtualWindow'
import { useColumnLayout } from './composables/useColumnLayout'
import type { ResolvedColumn } from './composables/useColumnLayout'
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
} from './internal/constants'
import { EMPTY_GROUP_LABEL } from './internal/aggregations'
import { readCellValue } from './internal/values'
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
 * cambia la configuración de columnas —nunca durante el scroll, que se resuelve
 * con un único `transform` sobre `.dt-header-inner`— y los handles de
 * redimensionado se benefician de tener estado reactivo.
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
  emptyText: 'No data',
  stripe: false,
  bordered: false,
  selectionMode: 'cell',
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
  groupToggle: [GroupToggleEvent]
  'update:activeCell': [CellPosition | null]
  'update:columnVisibility': [ColumnVisibilityState]
  'update:columnOrder': [string[]]
  'update:columnWidths': [ColumnWidthState]
  'update:groupBy': [string[]]
  'update:expandedGroups': [string[]]
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
const headerInnerEl = shallowRef<HTMLElement | null>(null)
const canvasEl = shallowRef<HTMLElement | null>(null)
const editorHostEl = shallowRef<HTMLElement | null>(null)

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

/* ------------------------------------------------------------ Layout y scroll */

const layout = useColumnLayout<TRow>({
  columns: () => props.columns,
  defaultColumnWidth: () => props.defaultColumnWidth,
  visibility: columnVisibility,
  order: columnOrder,
  widths: columnWidths,
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
const { resolvedColumns, totalWidth } = layout

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
  groupBy,
  expandedGroups: () => props.expandedGroups,
  defaultExpanded: () => props.groupsDefaultExpanded,
  emptyGroupLabel: () => props.emptyGroupLabel,
  onExpandedChange: (expanded) => emit('update:expandedGroups', expanded),
  onToggle: (groupId, expanded) => emit('groupToggle', { groupId, expanded }),
})

/** Cantidad de entradas verticales: filas del dataset, o de la vista aplanada. */
const visibleRowCount = computed(() => grouping.totalCount.value)

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
  headerInner: headerInnerEl,
  onFrame: paintFrame,
})

const rowVirtual = useVirtualWindow({
  itemCount: visibleRowCount,
  itemSize: rowHeight,
  viewportSize: () => scroll.state.value.viewportHeight,
  scrollOffset: () => scroll.state.value.scrollTop,
  overscan: () => props.overscan,
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
    // El foco va PRIMERO: si había un editor abierto sobre otra celda, moverlo
    // dispara su `blur` y lo confirma antes de que la selección se mueva.
    focusViewport(position)
    selectCell(position)
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

  viewport.focus()
}

/**
 * Fija la celda activa y avisa.
 *
 * Emite siempre, incluso sin controlar, para que un consumidor pueda escuchar la
 * selección sin tomar posesión del estado.
 */
function selectCell(position: CellPosition | null): void {
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
 */
function scrollToCell(position: CellPosition): void {
  const metrics = scroll.live
  const height = rowHeight.value

  const rowTop = position.rowIndex * height
  const rowBottom = rowTop + height
  let top = metrics.scrollTop
  if (rowTop < top) top = rowTop
  else if (rowBottom > top + metrics.viewportHeight) top = rowBottom - metrics.viewportHeight

  let left = metrics.scrollLeft
  const column = layout.getResolvedColumn(position.columnKey)
  if (column) {
    const columnRight = column.offset + column.width
    if (column.offset < left) left = column.offset
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
  const rows = Math.floor(scroll.live.viewportHeight / rowHeight.value)
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
  const columns = resolvedColumns.value
  const lastRow = rowCount - 1
  const lastColumn = Math.max(0, columns.length - 1)

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveActiveBy(1, 0)
      return
    case 'ArrowRight': {
      event.preventDefault()
      // Comportamiento de `treegrid`: sobre un grupo plegado, la flecha derecha
      // lo abre en lugar de moverse. Sobre uno ya abierto no hay nada que abrir
      // y la tecla vuelve a significar lo de siempre.
      const group = activeGroupRow()
      if (group && !group.expanded) grouping.toggleGroup(group.groupId)
      else moveActiveBy(0, 1)
      return
    }
    case 'ArrowUp':
      event.preventDefault()
      moveActiveBy(-1, 0)
      return
    case 'ArrowLeft': {
      event.preventDefault()
      const group = activeGroupRow()
      if (group && group.expanded) grouping.toggleGroup(group.groupId)
      else moveActiveBy(0, -1)
      return
    }
    case 'Tab':
      event.preventDefault()
      moveActiveInReadingOrder(!event.shiftKey)
      return
    case 'Home':
      event.preventDefault()
      if (ctrl) moveActiveTo(0, 0)
      // Absoluto, igual que `End` acá abajo, y no un delta negativo enorme que
      // `moveActiveTo` termine acotando. Expresado como delta, `Home` sería un
      // movimiento "hacia la izquierda" y sin celda activa entraría por el borde
      // derecho, que es exactamente lo contrario de lo que significa `Home`.
      else moveActiveTo(activeCell.value?.rowIndex ?? 0, 0)
      return
    case 'End':
      event.preventDefault()
      if (ctrl) moveActiveTo(lastRow, lastColumn)
      else moveActiveTo(activeCell.value?.rowIndex ?? 0, lastColumn)
      return
    case 'PageDown':
      event.preventDefault()
      moveActiveBy(pageSize(), 0)
      return
    case 'PageUp':
      event.preventDefault()
      moveActiveBy(-pageSize(), 0)
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
interface ViewportListeners {
  keydown?: (event: KeyboardEvent) => void
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
  return { keydown: onViewportKeyDown }
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
    x: resolved.offset,
    y: position.rowIndex * rowHeight.value,
    width: resolved.width,
    height: rowHeight.value,
  }
}

const editor = useCellEditor<TRow>({
  host: editorHostEl,
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
  pool.paint({
    rows: props.rows,
    flatRows: grouping.flatRows.value,
    groupDepth: grouping.depth.value,
    showGroupCount: props.showGroupCount,
    rowRange: rowVirtual.window.value,
    columns: visibleColumns.value,
    rowHeight: rowHeight.value,
    editing: editor.editing.value,
    active: activeCell.value,
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
watch(
  () => scroll.state.value.viewportHeight,
  (height) => {
    pool.trim(Math.ceil(height / rowHeight.value) + props.overscan * 2 + 1)
  },
)

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

/* ------------------------------------------------------------ API imperativa */

/** Scrollea hasta dejar `index` como primera fila visible. */
function scrollToRow(index: number): void {
  const maxIndex = Math.max(0, visibleRowCount.value - 1)
  const clamped = Math.min(Math.max(Math.floor(index), 0), maxIndex)
  scroll.scrollTo({ top: clamped * rowHeight.value })
}

/** Scrollea hasta dejar la columna en el borde izquierdo. */
function scrollToColumn(key: string): void {
  const resolved = layout.getResolvedColumn(key)
  if (!resolved) return
  scroll.scrollTo({ left: resolved.offset })
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
 */
function selectCellFromApi(position: CellPosition | null): void {
  selectCell(position)
  if (position) scrollToCell(position)
}

defineExpose({
  scrollToRow,
  scrollToColumn,
  scrollToCell,
  selectCell: selectCellFromApi,
  refresh,
  resetLayout,
  flushPersistence,
  toggleGroup: grouping.toggleGroup,
  expandAllGroups: grouping.expandAll,
  collapseAllGroups: grouping.collapseAll,
})

/* ------------------------------------------------------------- Ciclo de vida */

onMounted(() => {
  const canvas = canvasEl.value
  if (canvas) pool.mount(canvas)
  scroll.requestFrame()
})

onBeforeUnmount(() => {
  // `useScrollSync` y `useCellEditor` limpian lo suyo con sus propios hooks; el
  // pool no es un composable de Vue, así que se desmonta explícitamente.
  pool.unmount()
})

/* --------------------------------------------------------------- Presentación */

const rootStyle = computed(() => ({
  '--dt-row-height': `${rowHeight.value}px`,
  '--dt-header-height': `${headerHeight.value}px`,
}))

const canvasStyle = computed(() => ({
  width: `${totalWidth.value}px`,
  height: `${rowVirtual.totalSize.value}px`,
}))

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
 * Porque la grilla tiene que CONTENER a su fila de encabezado. El header se
 * dibuja arriba del contenedor que scrollea, así que mientras el rol estaba en
 * `.dt-viewport` la fila de encabezado quedaba afuera, y la aritmética de
 * índices —`aria-rowcount` = entradas + 1, `aria-rowindex` = posición + 2—
 * anunciaba una fila 1 que la tecnología asistiva no podía encontrar. Con el rol
 * en la raíz, esa fila existe de verdad y los dos números pasan a ser correctos.
 *
 * ARIA no exige que la grilla sea el contenedor con scroll, y moverlo no cuesta
 * ni una escritura por frame: es un atributo estructural que se escribe una vez.
 */
const gridRole = computed(() => (grouping.active.value ? 'treegrid' : 'grid'))

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
    :data-bordered="bordered ? 'true' : 'false'"
    :data-selection="selectionMode"
  >
    <div class="dt-header" role="rowgroup">
      <!--
        Las celdas de header las renderiza Vue: son pocas y cambian solo cuando
        cambia la configuración de columnas. El scroll horizontal no las vuelve a
        diferenciar, se resuelve con un único transform sobre este contenedor.

        Este mismo nodo es la FILA de encabezado de la grilla. No hace falta uno
        aparte: ya existía, ya envuelve a todas las celdas de header y ya es el
        que se desplaza en espejo.
      -->
      <div
        ref="headerInnerEl"
        class="dt-header-inner"
        role="row"
        aria-rowindex="1"
        :style="{ width: `${totalWidth}px` }"
      >
        <div
          v-for="column in resolvedColumns"
          :key="column.key"
          class="dt-header-cell"
          role="columnheader"
          :aria-colindex="column.index + 1"
          :class="[
            headerAlignClass(column),
            { 'dt-header-cell--active': column.key === activeCell?.columnKey },
          ]"
          :style="{
            transform: `translate3d(${column.offset}px, 0, 0)`,
            width: `${column.width}px`,
          }"
          :title="column.label"
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

    <!--
      El viewport scrollea y recibe el teclado, pero ya no es la grilla: es un
      contenedor sin rol propio entre la grilla y su cuerpo. El foco se queda
      acá porque es el elemento que scrollea, y moverlo a la raíz separaría el
      anillo de foco de la caja que el usuario está desplazando. En modo `none`
      el manejador es `undefined`, y entonces Vue directamente no registra el
      listener.
    -->
    <div
      ref="viewportEl"
      class="dt-viewport"
      :tabindex="selectionMode === 'none' ? -1 : 0"
      v-on="viewportListeners"
    >
      <!--
        El canvas solo dimensiona la barra de scroll. Sus hijos los inyecta
        useRowPool, y son exactamente las filas del cuerpo: por eso el
        `rowgroup` va acá y no en el viewport, que además contiene al host del
        editor.
      -->
      <div ref="canvasEl" class="dt-canvas" role="rowgroup" :style="canvasStyle" />
      <!--
        Host de los controles de edición. Vue lo renderiza una vez y nunca toca
        sus hijos: useCellEditor monta ahí un control por tipo, de forma
        perezosa. Al vivir dentro del viewport que scrollea, los controles
        acompañan al scroll sin reposicionarse.
      -->
      <div ref="editorHostEl" class="dt-editor-host" />
    </div>

    <div v-if="rows.length === 0" class="dt-empty">{{ emptyText }}</div>
  </div>
</template>
