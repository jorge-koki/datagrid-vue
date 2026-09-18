import type {
  ColumnPin,
  ColumnSort,
  DataTableColumn,
  GroupByState,
  PersistedTableState,
} from '../types'
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './constants'
import { clamp } from './values'
import { groupIdColumnPath, reconcileGroupBy } from './aggregations'

/**
 * Reconciliación del estado persistido contra las columnas actuales.
 *
 * ## Por qué esto no se puede borrar
 *
 * El estado guardado está desactualizado por definición. Entre la sesión en que
 * el usuario acomodó su tabla y la sesión en que vuelve, el desarrollador agregó
 * columnas, borró otras y renombró alguna clave. Aplicar el estado guardado tal
 * cual produce fallas silenciosas y difíciles de rastrear:
 *
 * - Una columna nueva aparecería oculta, porque el mapa guardado no la menciona
 *   y una lectura ingenua interpretaría "ausente" como `false`.
 * - El orden guardado tendría claves fantasma de columnas borradas, y le
 *   faltarían las nuevas.
 * - Un ancho guardado antes de que el desarrollador bajara `maxWidth` volvería a
 *   meter un layout que hoy es ilegal.
 *
 * Por eso ninguna función de este módulo confía en la entrada: todas toman lo
 * guardado y las columnas actuales, y devuelven algo válido *hoy*.
 *
 * Todas son puras y sin dependencias de Vue ni del DOM.
 *
 * No forma parte de la API pública.
 */

/** Lo mínimo que estas funciones necesitan de una columna para ordenar. */
interface KeyedColumn {
  readonly key: string
}

/**
 * Devuelve el orden guardado, saneado para que sea una permutación válida de las
 * columnas actuales.
 *
 * INVARIANTE: el resultado contiene exactamente una vez cada clave de `columns`,
 * ni una de más ni una de menos. Primero se respeta el orden guardado filtrando
 * las claves que ya no existen, y después se agregan al final las columnas que
 * el estado guardado no conocía, en orden de definición. Una columna nueva
 * aparece donde el desarrollador la declaró, no en una posición arbitraria.
 *
 * El `Set` de vistas no es defensa decorativa: un estado escrito a mano o una
 * migración fallida pueden traer claves duplicadas, y duplicarlas en el
 * resultado haría que una misma columna ocupe dos slots del pool.
 */
export function reconcileColumnOrder(
  persisted: readonly string[],
  columns: readonly KeyedColumn[],
): string[] {
  const existing = new Set<string>()
  for (const column of columns) existing.add(column.key)

  const result: string[] = []
  const seen = new Set<string>()

  for (const key of persisted) {
    if (!existing.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }

  for (const column of columns) {
    if (seen.has(column.key)) continue
    seen.add(column.key)
    result.push(column.key)
  }

  return result
}

/**
 * Devuelve la visibilidad guardada, limitada a columnas que siguen existiendo.
 *
 * Una columna ausente del estado guardado queda con su `defaultVisible ?? true`.
 * Esa es la regla que evita el peor error posible de esta función: que una
 * columna recién agregada nazca invisible solo porque el estado guardado es
 * anterior a ella, y que el usuario no tenga forma de saber que existe.
 */
export function reconcileColumnVisibility<TRow>(
  persisted: Readonly<Record<string, boolean>>,
  columns: readonly DataTableColumn<TRow>[],
): Record<string, boolean> {
  const result: Record<string, boolean> = {}

  for (const column of columns) {
    const saved = persisted[column.key]
    result[column.key] = typeof saved === 'boolean' ? saved : (column.defaultVisible ?? true)
  }

  return result
}

/**
 * Reconcilia el orden guardado contra las columnas que existen hoy.
 *
 * Descarta los criterios de columnas que ya no están y los sentidos que no son
 * válidos, y **conserva el orden de prioridad** de los que sobreviven: es lo
 * único que distingue "primero por estado, después por fecha" de lo contrario.
 * Un criterio repetido se queda con el primero, que es el de más prioridad.
 */
export function reconcileSort<TRow>(
  persisted: readonly ColumnSort[],
  columns: readonly DataTableColumn<TRow>[],
): ColumnSort[] {
  const claves = new Set(columns.map((column) => column.key))
  const vistas = new Set<string>()
  const result: ColumnSort[] = []

  for (const entry of persisted) {
    if (!claves.has(entry.columnKey) || vistas.has(entry.columnKey)) continue
    if (entry.direction !== 'asc' && entry.direction !== 'desc') continue
    vistas.add(entry.columnKey)
    result.push({ columnKey: entry.columnKey, direction: entry.direction })
  }

  return result
}

/**
 * Reconcilia el anclaje guardado contra las columnas que existen hoy.
 *
 * Descarta las claves de columnas que ya no están y los valores que no son un
 * borde válido. `null` SÍ es válido y se conserva: significa "el usuario la
 * soltó", y perderlo volvería a anclar sola una columna declarada anclada.
 *
 * Una columna que perdió su `pinnable` conserva igual lo guardado. Es
 * deliberado: quitarle el permiso de anclar no debería mover de lugar una
 * columna que el usuario ya había anclado, solo sacarle el botón. Para
 * deshacerlo está `resetLayout()`.
 */
export function reconcileColumnPinning<TRow>(
  persisted: Readonly<Record<string, ColumnPin | null>>,
  columns: readonly DataTableColumn<TRow>[],
): Record<string, ColumnPin | null> {
  const result: Record<string, ColumnPin | null> = {}

  for (const column of columns) {
    // `hasOwn` y no una comparación contra `undefined`: la clave ausente y la
    // clave en `null` significan cosas distintas, y solo la segunda se guarda.
    if (!Object.hasOwn(persisted, column.key)) continue
    const saved = persisted[column.key]
    if (saved !== null && saved !== 'start' && saved !== 'end') continue
    result[column.key] = saved
  }

  return result
}

/**
 * Devuelve los anchos guardados, sin claves desconocidas y acotados a los
 * límites que la columna declara HOY.
 *
 * El acotado se hace acá y no solo al pintar porque el estado guardado es una
 * entrada externa: un `maxWidth` que el desarrollador bajó entre deploys, o un
 * valor editado a mano en las devtools, no deben poder reintroducir un layout
 * imposible. Los valores no finitos se descartan en lugar de acotarse, porque
 * `NaN` no tiene una posición sensata dentro de un rango.
 */
export function reconcileColumnWidths<TRow>(
  persisted: Readonly<Record<string, number>>,
  columns: readonly DataTableColumn<TRow>[],
): Record<string, number> {
  const result: Record<string, number> = {}

  for (const column of columns) {
    const saved = persisted[column.key]
    if (typeof saved !== 'number' || !Number.isFinite(saved)) continue

    const min = Math.max(MIN_COLUMN_WIDTH, column.minWidth ?? MIN_COLUMN_WIDTH)
    const max = Math.min(MAX_COLUMN_WIDTH, column.maxWidth ?? MAX_COLUMN_WIDTH)
    result[column.key] = clamp(saved, min, Math.max(min, max))
  }

  return result
}

/**
 * Devuelve los grupos colapsados guardados que todavía pueden existir.
 *
 * Un id de grupo es un camino de `columna:valor`, así que su lista de columnas
 * tiene que ser un PREFIJO de la agrupación vigente: un id
 * `status:open/priority:high` no puede corresponder a ningún grupo si hoy se
 * agrupa por `['owner']`, ni si se agrupa por `['status']` a secas, porque en
 * ese caso no existe un segundo nivel.
 *
 * Es la reconciliación exacta sobre la ESTRUCTURA. No se verifica que el valor
 * siga existiendo en los datos, y es deliberado: los datos cambian entre
 * sesiones, y descartar el estado de un grupo porque hoy no hay filas con ese
 * estado haría que el grupo reapareciera expandido en cuanto vuelvan.
 */
export function reconcileCollapsedGroups(
  persisted: readonly string[],
  groupBy: GroupByState,
): string[] {
  if (persisted.length === 0 || groupBy.length === 0) return []

  const result: string[] = []
  const seen = new Set<string>()

  for (const groupId of persisted) {
    if (seen.has(groupId)) continue

    const path = groupIdColumnPath(groupId)
    if (path.length === 0 || path.length > groupBy.length) continue

    let matches = true
    for (let level = 0; level < path.length; level += 1) {
      if (path[level] !== groupBy[level]) {
        matches = false
        break
      }
    }
    if (!matches) continue

    seen.add(groupId)
    result.push(groupId)
  }

  return result
}

/**
 * Reconcilia un estado persistido completo contra las columnas actuales.
 *
 * La versión ya debe haberse validado antes de llamar acá: esta función asume
 * que el payload es aplicable y solo se ocupa de ajustarlo a las columnas.
 *
 * Las claves de agrupación solo aparecen en la salida si aparecían en la
 * entrada. Es lo que permite que un payload escrito antes de que existiera la
 * agrupación siga reconciliándose a un estado idéntico al de siempre, sin
 * inventarle campos que después se escribirían de vuelta al almacenamiento.
 */
export function reconcilePersistedState<TRow>(
  state: PersistedTableState,
  columns: readonly DataTableColumn<TRow>[],
): PersistedTableState {
  const result: PersistedTableState = {
    version: state.version,
    columnVisibility: reconcileColumnVisibility(state.columnVisibility, columns),
    columnWidths: reconcileColumnWidths(state.columnWidths, columns),
    columnOrder: reconcileColumnOrder(state.columnOrder, columns),
  }

  // Opcional igual que las de agrupación, y por el mismo motivo: un payload
  // escrito antes de que el anclaje desde la UI existiera no la trae, y no hay
  // que inventarle el campo para después escribirlo de vuelta.
  if (state.columnPinning !== undefined) {
    result.columnPinning = reconcileColumnPinning(state.columnPinning, columns)
  }

  if (state.sort !== undefined) {
    result.sort = reconcileSort(state.sort, columns)
  }

  if (state.groupBy !== undefined || state.collapsedGroups !== undefined) {
    const groupBy = reconcileGroupBy(state.groupBy ?? [], columns)
    result.groupBy = groupBy
    result.collapsedGroups = reconcileCollapsedGroups(state.collapsedGroups ?? [], groupBy)
  }

  return result
}

/** `true` si el valor es un objeto plano indexable por string. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `true` si todas las propiedades del objeto son booleanas. */
function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  if (!isPlainRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'boolean')
}

/** `true` si todas las propiedades del objeto son números finitos. */
function isFiniteNumberRecord(value: unknown): value is Record<string, number> {
  if (!isPlainRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

/** `true` si el valor es una lista de criterios de ordenamiento. */
function isColumnSortArray(value: unknown): value is ColumnSort[] {
  if (!Array.isArray(value)) return false
  const entries: readonly unknown[] = value
  return entries.every(
    (entry) =>
      isPlainRecord(entry) &&
      typeof entry.columnKey === 'string' &&
      (entry.direction === 'asc' || entry.direction === 'desc'),
  )
}

/** `true` si el valor es un mapa de bordes de anclaje, donde `null` es válido. */
function isColumnPinRecord(value: unknown): value is Record<string, ColumnPin | null> {
  if (!isPlainRecord(value)) return false
  return Object.values(value).every(
    (entry) => entry === null || entry === 'start' || entry === 'end',
  )
}

/** `true` si el valor es un array de strings. */
function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false
  // Se reasigna a `readonly unknown[]` para fijar el tipo del elemento: el
  // predicado de `Array.isArray` no alcanza para describir el contenido.
  const entries: readonly unknown[] = value
  for (const entry of entries) {
    if (typeof entry !== 'string') return false
  }
  return true
}

/**
 * Valida la forma de un payload leído del almacenamiento.
 *
 * El contenido de `localStorage` es entrada no confiable: lo puede editar
 * cualquiera desde las devtools, lo puede truncar una cuota agotada a mitad de
 * escritura, y lo puede haber escrito una versión anterior del componente. Un
 * `JSON.parse` que devuelve algo con la forma equivocada tiene que terminar en
 * "empiezo de cero", nunca en una excepción que deje la tabla sin renderizar.
 */
export function isPersistedTableState(value: unknown): value is PersistedTableState {
  if (!isPlainRecord(value)) return false
  if (typeof value.version !== 'number' || !Number.isFinite(value.version)) return false
  if (!isBooleanRecord(value.columnVisibility)) return false
  if (!isFiniteNumberRecord(value.columnWidths)) return false
  if (!isStringArray(value.columnOrder)) return false
  // Las dos claves de agrupación son OPCIONALES: un payload escrito antes de que
  // existiera la función no las trae, y rechazarlo por eso le borraría el layout
  // a todo el que actualice la librería. Si vienen, tienen que ser válidas.
  if (value.groupBy !== undefined && !isStringArray(value.groupBy)) return false
  if (value.collapsedGroups !== undefined && !isStringArray(value.collapsedGroups)) return false
  if (value.columnPinning !== undefined && !isColumnPinRecord(value.columnPinning)) return false
  if (value.sort !== undefined && !isColumnSortArray(value.sort)) return false
  return true
}
