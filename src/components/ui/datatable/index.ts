/**
 * Punto de entrada público del DataTable.
 *
 * Este directorio es autocontenido: todo lo que importa lo hace por rutas
 * relativas y su única dependencia de runtime es `vue`. Se puede copiar tal cual
 * a cualquier proyecto Vue 3 sin arrastrar alias de build ni utilidades del
 * repositorio de origen.
 *
 * Solo se exporta el contrato. Los composables y el pool de nodos quedan
 * deliberadamente fuera: son detalles de implementación y exportarlos los
 * convertiría en API que después habría que sostener. Las excepciones son el
 * registro de renderers y el adaptador de almacenamiento, que son puntos de
 * extensión pensados para el consumidor.
 */

import DataTable from './DataTable.vue'
import DataTableColumnToggle from './DataTableColumnToggle.vue'

export { DataTable, DataTableColumnToggle }
export default DataTable

export type {
  AfterEditEvent,
  AggregationFn,
  BeforeEditEvent,
  BuiltInAggregation,
  CellAlign,
  CellEditorSlotProps,
  CellEditorType,
  CellLayout,
  CellOption,
  CellPosition,
  CellRenderContext,
  CellRenderer,
  CellRendererHandle,
  CellSelectEvent,
  CellValue,
  ColumnAggregation,
  ColumnResizeEvent,
  ColumnVisibilityState,
  ColumnWidthState,
  DataRow,
  DataTableColumn,
  DataTableInstance,
  DataTablePersistOptions,
  DataTableProps,
  DataTableStorageAdapter,
  DataTableTheme,
  EditCommitEvent,
  FlatRow,
  GroupByState,
  GroupIdSegment,
  GroupRow,
  GroupToggleEvent,
  PersistedTableState,
  SelectionMode,
  VirtualWindow,
} from './types'

export {
  createTextRenderer,
  registerRenderer,
  resolveRenderer,
  TEXT_RENDERER_TYPE,
} from './internal/renderers'
export type { AnyCellRenderer, CellRendererFactory } from './internal/renderers'

/**
 * Instancias de los renderers incluidos.
 *
 * Se exportan para poder componer sobre ellas: un renderer propio puede delegar
 * en `badgeRenderer.create` y agregarle algo encima, en vez de reimplementar la
 * píldora desde cero.
 */
export {
  avatarRenderer,
  badgeRenderer,
  checkboxRenderer,
  numberRenderer,
  progressRenderer,
  selectRenderer,
  tagsRenderer,
  textRenderer,
} from './internal/renderers'

/**
 * Nombres de los tokens de color de la paleta de estados.
 *
 * Pensado para escribir `color: COLOR_TOKENS.red` en un `CellOption` sin tener
 * que recordar la forma exacta del `var(--dt-color-*)`, y para que un cambio de
 * nomenclatura en la hoja de estilos se propague desde un solo lugar.
 */
export const COLOR_TOKENS = {
  blue: 'var(--dt-color-blue)',
  red: 'var(--dt-color-red)',
  amber: 'var(--dt-color-amber)',
  green: 'var(--dt-color-green)',
  purple: 'var(--dt-color-purple)',
  neutral: 'var(--dt-color-neutral)',
} as const

/** Nombre de un color de la paleta de estados incluida. */
export type ColorTokenName = keyof typeof COLOR_TOKENS

/**
 * Constructor del {@link GroupRow.groupId} de un grupo.
 *
 * Sale de `internal/` y no de `types.ts` por la misma razón que el registro de
 * renderers: es la implementación REAL, la que usa la construcción del árbol, y
 * no una copia hecha para el consumidor. Una segunda implementación del formato
 * se desincronizaría de la primera, y el síntoma —un grupo que no abre— es
 * exactamente la falla silenciosa que este export existe para eliminar.
 */
export { groupId } from './internal/aggregations'

export { createLocalStorageAdapter } from './composables/useTablePersistence'
