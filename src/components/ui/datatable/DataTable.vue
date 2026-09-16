<script setup lang="ts" generic="TRow extends Record<string, unknown>">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellEditorSlotProps,
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
  groupToggle: [GroupToggleEvent]
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
const headerInnerEl = shallowRef<HTMLElement | null>(null)
const canvasEl = shallowRef<HTMLElement | null>(null)
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
    :data-bordered="bordered ? 'true' : 'false'"
    :data-selection="selectionMode"
    :data-focus-ring="focusRing ? 'true' : 'false'"
    :data-active-cell="hasActiveCell"
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
  </div>
</template>
