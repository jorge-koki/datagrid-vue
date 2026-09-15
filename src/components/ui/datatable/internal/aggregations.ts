import type {
  AggregationFn,
  BuiltInAggregation,
  CellValue,
  DataTableColumn,
  GroupByState,
} from '../types'
import { formatCellValue, readCellValue } from './values'
import { findOption } from './renderers/shared'

/**
 * Primitivas puras de la agrupación: identidad de grupo, etiquetas y agregación.
 *
 * Están separadas de `useRowGrouping` por el mismo motivo por el que `values.ts`
 * está separado de `dom.ts`: son funciones sobre datos, sin Vue y sin DOM, así
 * que se pueden probar sueltas y llamar desde cualquier lado.
 *
 * ## Por qué la agregación es incremental
 *
 * Un grupo anidado tiene que agregar sobre TODAS sus filas descendientes, no
 * sobre los agregados de sus subgrupos. Para `sum`, `min` y `max` daría lo mismo
 * porque son asociativas; para `avg` no: el promedio de los promedios de dos
 * subgrupos de tamaños distintos no es el promedio del conjunto, y esa es
 * exactamente la versión ingenua que se ve en la mayoría de las grillas.
 *
 * La salida es acumular por nivel: cada fila alimenta a los acumuladores de
 * todos los grupos de su camino, uno por nivel de anidamiento. El costo total es
 * O(filas x niveles) —niveles es 1, 2 o 3 en la práctica—, nunca O(filas x
 * grupos), y cada grupo ve todas sus filas de primera mano.
 *
 * No forma parte de la API pública.
 */

/**
 * Etiqueta por defecto del grupo que junta los valores ausentes.
 *
 * Es el default de la prop `emptyGroupLabel`, no un literal incrustado: el texto
 * es de cara al usuario y una aplicación que no está en inglés tiene que poder
 * traducirlo. Se conserva como constante para que una tabla que no pasa la prop
 * escriba exactamente la misma etiqueta de siempre.
 */
export const EMPTY_GROUP_LABEL = '(empty)'

/** Separador entre niveles dentro de un {@link GroupRow.groupId}. */
export const GROUP_ID_SEPARATOR = '/'

/** Separador entre la clave de columna y el valor dentro de un segmento de id. */
export const GROUP_SEGMENT_SEPARATOR = ':'

/**
 * Texto que identifica un valor dentro de su nivel de agrupación.
 *
 * Los no-strings llevan una marca de tipo delante para que el `1` numérico y el
 * `'1'` de texto no se confundan. Un string se usa tal cual, así que el id queda
 * legible en el caso habitual —`status:active`— que es el que uno termina
 * mirando en el almacenamiento o en un test.
 *
 * Esta función es a la vez la clave del bucket y el segmento del id, y eso no es
 * casualidad: si fueran dos funciones distintas, dos valores podrían caer en
 * buckets separados con el mismo id, y colapsar uno colapsaría el otro. Siendo la
 * misma, dos valores que produzcan el mismo texto caen en el MISMO grupo, que es
 * un modo de falla visible y benigno en lugar de uno silencioso.
 */
export function groupValueKey(value: CellValue): string {
  if (value === null) return '~null'
  if (value === undefined) return '~undefined'
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '@invalid' : `@${value.toISOString()}`
  }
  if (typeof value === 'number') return `#${value}`
  if (typeof value === 'boolean') return `?${value}`
  return value
}

/**
 * Segmento de {@link GroupRow.groupId} correspondiente a un nivel.
 *
 * El formato es `columna:valor`, y los segmentos se unen con `/`. Que el id sea
 * un camino y no un número es lo que lo vuelve estable entre sesiones: un
 * contador se desplazaría en cuanto llegara una fila nueva.
 */
export function groupSegment(columnKey: string, value: CellValue): string {
  return `${columnKey}${GROUP_SEGMENT_SEPARATOR}${groupValueKey(value)}`
}

/**
 * Claves de columna que atraviesa un id de grupo, de la raíz hacia abajo.
 *
 * Se usa para reconciliar un conjunto colapsado guardado contra la agrupación
 * vigente. Asume que las claves de columna no contienen `/` ni `:`; si las
 * contuvieran, el camino se leería mal y el id se descartaría, que es la falla
 * segura: el grupo simplemente vuelve a aparecer expandido.
 */
export function groupIdColumnPath(groupId: string): string[] {
  const path: string[] = []
  for (const segment of groupId.split(GROUP_ID_SEPARATOR)) {
    const cut = segment.indexOf(GROUP_SEGMENT_SEPARATOR)
    if (cut <= 0) return []
    path.push(segment.slice(0, cut))
  }
  return path
}

/**
 * Texto mostrado en la cabecera de un grupo.
 *
 * Se consulta `column.options` antes que el valor crudo para que una columna de
 * estados agrupe bajo "Open" y no bajo "open": la lista de opciones ya es la
 * fuente de verdad de cómo se llama cada valor de cara al usuario, y tenerla que
 * repetir en un `format` sería duplicarla.
 *
 * `column.format` NO se aplica: su firma exige una fila y un índice, y una
 * cabecera de grupo no representa a ninguna fila en particular. Para dar formato
 * a las CIFRAS de la cabecera está `column.formatAggregate`, que es otra cosa:
 * esta función resuelve el nombre del grupo, no sus agregados.
 *
 * @param emptyLabel - Texto de los valores ausentes. Se recibe como parámetro y
 * no se lee de la constante para que la prop `emptyGroupLabel` pueda traducirlo.
 */
export function groupValueLabel<TRow>(
  column: DataTableColumn<TRow> | undefined,
  value: CellValue,
  emptyLabel: string = EMPTY_GROUP_LABEL,
): string {
  if (value === null || value === undefined) return emptyLabel
  const option = findOption(column?.options, value)
  if (option) return option.label
  const text = formatCellValue(value)
  return text === '' ? emptyLabel : text
}

/** Una columna que declara agregación, ya resuelta para el camino de agregado. */
export interface AggregateColumn<TRow extends Record<string, unknown>> {
  /** La definición, para poder leer el valor con su `accessor`. */
  readonly column: DataTableColumn<TRow>
  /** Alias de conveniencia de `column.key`. */
  readonly key: string
  /** Agregación incluida, o `null` si la columna declaró una función. */
  readonly builtIn: BuiltInAggregation | null
  /** Función propia, o `null` si la columna declaró una agregación incluida. */
  readonly custom: AggregationFn<TRow> | null
}

/**
 * Columnas que declaran agregación, en orden de declaración.
 *
 * Se resuelve una vez por reconstrucción del árbol y no por grupo: leer
 * `column.aggregate` dentro del bucle costaría una rama por fila y por columna.
 */
export function resolveAggregateColumns<TRow extends Record<string, unknown>>(
  columns: readonly DataTableColumn<TRow>[],
): AggregateColumn<TRow>[] {
  const resolved: AggregateColumn<TRow>[] = []
  for (const column of columns) {
    const aggregate = column.aggregate
    if (aggregate === undefined) continue
    resolved.push({
      column,
      key: column.key,
      builtIn: typeof aggregate === 'function' ? null : aggregate,
      custom: typeof aggregate === 'function' ? aggregate : null,
    })
  }
  return resolved
}

/** `true` si alguna columna declara una función propia, que necesita las filas. */
export function needsRowCollection<TRow extends Record<string, unknown>>(
  columns: readonly AggregateColumn<TRow>[],
): boolean {
  for (const entry of columns) {
    if (entry.custom !== null) return true
  }
  return false
}

/**
 * Estado incremental de una agregación sobre un grupo.
 *
 * Es un objeto plano de campos numéricos y no un cierre por operación: se crea
 * uno por grupo y por columna agregada, y se actualiza una vez por fila
 * descendiente. Guardar la suma y la cantidad por separado es lo que hace que
 * `avg` de un nivel intermedio sea el promedio real de sus filas y no el
 * promedio de los promedios de sus hijos.
 */
export interface AggregateAccumulator<TRow> {
  /** Filas con valor distinto de `null` y `undefined`. Es lo que devuelve `count`. */
  presentCount: number
  /** Cantidad de valores que eran números finitos. */
  numericCount: number
  /** Suma de esos números. */
  sum: number
  /** Mínimo numérico visto, o `Infinity` si no hubo ninguno. */
  minNumber: number
  /** Máximo numérico visto, o `-Infinity` si no hubo ninguno. */
  maxNumber: number
  /** Cantidad de fechas válidas vistas. */
  dateCount: number
  /** Menor instante visto, en ms. */
  minTime: number
  /** Mayor instante visto, en ms. */
  maxTime: number
  /** Filas descendientes, solo cuando alguna columna declara una función propia. */
  rows: TRow[] | null
}

/** Crea un acumulador vacío. `collectRows` solo se enciende si hace falta. */
export function createAccumulator<TRow>(collectRows: boolean): AggregateAccumulator<TRow> {
  return {
    presentCount: 0,
    numericCount: 0,
    sum: 0,
    minNumber: Number.POSITIVE_INFINITY,
    maxNumber: Number.NEGATIVE_INFINITY,
    dateCount: 0,
    minTime: Number.POSITIVE_INFINITY,
    maxTime: Number.NEGATIVE_INFINITY,
    rows: collectRows ? [] : null,
  }
}

/**
 * Incorpora una fila al acumulador.
 *
 * Los booleanos y los strings cuentan como presentes pero no entran en `sum` ni
 * en `min`/`max`: sumar booleanos es una decisión de dominio que le corresponde
 * a una función propia, no a un valor por defecto que después nadie recuerda.
 */
export function accumulate<TRow extends Record<string, unknown>>(
  accumulator: AggregateAccumulator<TRow>,
  entry: AggregateColumn<TRow>,
  row: TRow,
): void {
  if (accumulator.rows !== null) accumulator.rows.push(row)

  const value = readCellValue(entry.column, row)
  if (value === null || value === undefined) return
  accumulator.presentCount += 1

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return
    accumulator.numericCount += 1
    accumulator.sum += value
    if (value < accumulator.minNumber) accumulator.minNumber = value
    if (value > accumulator.maxNumber) accumulator.maxNumber = value
    return
  }

  if (value instanceof Date) {
    const time = value.getTime()
    if (Number.isNaN(time)) return
    accumulator.dateCount += 1
    if (time < accumulator.minTime) accumulator.minTime = time
    if (time > accumulator.maxTime) accumulator.maxTime = time
  }
}

/** Cierra un acumulador y produce el valor final de la columna para ese grupo. */
export function finishAggregate<TRow extends Record<string, unknown>>(
  accumulator: AggregateAccumulator<TRow>,
  entry: AggregateColumn<TRow>,
): CellValue {
  const custom = entry.custom
  if (custom !== null) return custom(accumulator.rows ?? [], entry.key)

  switch (entry.builtIn) {
    case 'count':
      return accumulator.presentCount
    case 'sum':
      return accumulator.numericCount > 0 ? accumulator.sum : null
    case 'avg':
      return accumulator.numericCount > 0 ? accumulator.sum / accumulator.numericCount : null
    case 'min':
      if (accumulator.numericCount > 0) return accumulator.minNumber
      return accumulator.dateCount > 0 ? new Date(accumulator.minTime) : null
    case 'max':
      if (accumulator.numericCount > 0) return accumulator.maxNumber
      return accumulator.dateCount > 0 ? new Date(accumulator.maxTime) : null
    default:
      return null
  }
}

/**
 * Deja una lista de agrupación en claves utilizables HOY.
 *
 * Descarta las claves desconocidas, las de columnas con `groupable: false` y los
 * duplicados. Un duplicado no es teórico: crearía dos niveles con el mismo valor
 * en cada rama, o sea un nivel entero de grupos de un solo hijo.
 *
 * Es la misma defensa que `reconcileColumnOrder` aplica al orden, y por el mismo
 * motivo: `groupBy` puede venir de un v-model del consumidor o de un layout
 * guardado hace dos deploys.
 */
export function reconcileGroupBy<TRow>(
  groupBy: GroupByState,
  columns: readonly DataTableColumn<TRow>[],
): string[] {
  if (groupBy.length === 0) return []

  const groupable = new Set<string>()
  for (const column of columns) {
    if (column.groupable === false) continue
    groupable.add(column.key)
  }

  const result: string[] = []
  const seen = new Set<string>()
  for (const key of groupBy) {
    if (!groupable.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  return result
}
