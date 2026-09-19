import type { ColumnSort, DataTableColumn, SortState } from '../types'
import { readRawValue } from './values'

/**
 * Ordenar un array de filas según los criterios que produjo la tabla.
 *
 * ## Por qué esto es un helper y no algo que hace la tabla
 *
 * La tabla **nunca ordena `rows`**, y no es una omisión: no puede. En modo
 * servidor solo tiene una ventana del dataset, así que ordenar lo que tiene a
 * mano daría un orden falso —correcto dentro de las 50 filas cargadas y absurdo
 * respecto de las 100.000 que hay—. Y aun en memoria, ordenar adentro la
 * volvería dueña de una copia del array que el consumidor no controla, en un
 * componente cuya regla es que nunca escribe sobre lo que recibe.
 *
 * Así que la tabla administra el ESTADO del orden y lo anuncia, y reordenar es
 * del consumidor. Esta función existe para que ese "reordenar" sean dos líneas
 * en el caso en memoria, sin que la tabla toque nada.
 *
 * ## Qué garantiza
 *
 * - **No muta la entrada.** Devuelve un array nuevo.
 * - **Devuelve el MISMO array** cuando no hay nada que ordenar. Es deliberado:
 *   una copia con identidad nueva le haría rehacer a la tabla la geometría, la
 *   agrupación y la ventana por nada.
 * - **Es estable.** Dos filas que empatan en todos los criterios conservan su
 *   orden relativo, que es lo que hace que ordenar por una segunda columna no
 *   deshaga lo que hizo la primera.
 *
 * @example
 * ```ts
 * const sort = ref<SortState>([])
 * const filas = computed(() => sortRows(datos.value, sort.value, columnas))
 * ```
 */
export function sortRows<TRow extends Record<string, unknown>>(
  rows: readonly TRow[],
  sort: SortState,
  columns: readonly DataTableColumn<TRow>[],
): readonly TRow[] {
  const criterios = resolveCriteria(sort, columns)
  if (criterios.length === 0) return rows

  // `slice` antes de `sort`: `Array.prototype.sort` ordena EN EL LUGAR, y el
  // array que llega es del consumidor.
  return rows.slice().sort((a, b) => {
    for (const compare of criterios) {
      const resultado = compare(a, b)
      if (resultado !== 0) return resultado
    }
    return 0
  })
}

/**
 * Traduce los criterios a funciones de comparación, una sola vez.
 *
 * Resolver la columna y elegir el comparador adentro del `sort` significaría
 * hacerlo `n log n` veces en lugar de una por criterio. Con 100.000 filas son
 * casi dos millones de búsquedas de columna que no hacen falta.
 *
 * Los criterios que apuntan a una columna que ya no existe se descartan en
 * silencio: el estado del orden sobrevive a un cambio de columnas —puede venir
 * del almacenamiento— y quedarse sin columna no es un error, es que esa columna
 * ya no está.
 */
function resolveCriteria<TRow extends Record<string, unknown>>(
  sort: SortState,
  columns: readonly DataTableColumn<TRow>[],
): ((a: TRow, b: TRow) => number)[] {
  const criterios: ((a: TRow, b: TRow) => number)[] = []

  for (const entry of sort) {
    const column = columns.find((candidate) => candidate.key === entry.columnKey)
    if (!column) continue

    const descending = entry.direction === 'desc'
    const custom = column.comparator

    if (custom) {
      // Un comparador propio se invierte y nada más: quien lo escribió decide
      // todo, incluido qué hacer con los vacíos.
      criterios.push(descending ? (a, b) => -custom(a, b) : custom)
      continue
    }

    criterios.push(defaultComparatorFor(column, descending))
  }

  return criterios
}

/**
 * El colador, construido una sola vez.
 *
 * `String.prototype.localeCompare` construye uno nuevo en cada llamada en varios
 * motores, y eso sobre un `sort` de 100.000 filas son más de un millón de
 * construcciones. Reutilizar uno es la diferencia entre ordenar en decenas de
 * milisegundos y en segundos.
 *
 * `numeric: true` hace que "Fila 2" vaya antes que "Fila 10", que es lo que
 * cualquiera espera de una lista con números adentro del texto.
 */
let collator: Intl.Collator | null = null

function compareText(a: string, b: string): number {
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return collator.compare(a, b)
}

/**
 * Comparador por defecto de una columna, en sentido ascendente.
 *
 * Compara el valor CRUDO —el que devuelve el accessor, o la propiedad— y no el
 * texto formateado: ordenar por el texto pondría `$1.000` antes que `$900`, y
 * una fecha mostrada como `03 Jul 2026` antes que `26 Mar 2026`. Formatear es
 * para leer, no para comparar.
 *
 * Los vacíos —`null`, `undefined`, `NaN`— van SIEMPRE al final, sin importar el
 * sentido. Es lo que hace un usuario de hoja de cálculo: ordenar para ver los valores,
 * no para ver primero los huecos.
 */
function defaultComparatorFor<TRow extends Record<string, unknown>>(
  column: DataTableColumn<TRow>,
  descending: boolean,
): (a: TRow, b: TRow) => number {
  return (rowA, rowB) => {
    const a = readRawValue(column, rowA)
    const b = readRawValue(column, rowB)

    const vacioA = isEmpty(a)
    const vacioB = isEmpty(b)
    if (vacioA || vacioB) {
      if (vacioA && vacioB) return 0
      // AL FINAL EN LOS DOS SENTIDOS, y por eso el sentido se aplica adentro de
      // esta función y no afuera: invertir el resultado completo daba vuelta
      // también esta regla, y en descendente los huecos aparecían primero.
      return vacioA ? 1 : -1
    }

    const resultado = compareValues(a, b)
    return descending ? -resultado : resultado
  }
}

/** Compara dos valores crudos en sentido ascendente. */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    // `false` antes que `true`: es el orden de "sin marcar" a "marcado", que es
    // como se lee una columna de casillas.
    return Number(a) - Number(b)
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()

  return compareText(String(a), String(b))
}

/** Un valor que no participa del orden y se va al final. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  return typeof value === 'number' && Number.isNaN(value)
}

/**
 * El criterio siguiente al presionar el encabezado de una columna.
 *
 * El ciclo es **ascendente → descendente → sin orden**. La tercera vuelta
 * importa: sin ella, una vez ordenada una tabla no hay forma de volver al orden
 * en que llegaron los datos, que muchas veces es el que trae el significado —lo
 * que el servidor consideró relevante, el orden de inserción—.
 *
 * `additive` es el `Shift`+clic: en vez de reemplazar los criterios, agrega o
 * actualiza el de esta columna al final. Es lo que permite "por estado, y dentro
 * de cada estado por fecha".
 */
export function nextSortState(
  current: SortState,
  columnKey: string,
  additive: boolean,
): ColumnSort[] {
  const existing = current.find((entry) => entry.columnKey === columnKey)
  const otros = current.filter((entry) => entry.columnKey !== columnKey)

  const siguiente: ColumnSort | null =
    existing === undefined
      ? { columnKey, direction: 'asc' }
      : existing.direction === 'asc'
        ? { columnKey, direction: 'desc' }
        : null

  if (!additive) return siguiente === null ? [] : [siguiente]
  if (siguiente === null) return otros
  // Se conserva la posición: una columna que ya era el segundo criterio sigue
  // siéndolo al cambiarle el sentido, en lugar de saltar al final.
  return existing === undefined
    ? [...otros, siguiente]
    : current.map((entry) => (entry.columnKey === columnKey ? siguiente : entry))
}
