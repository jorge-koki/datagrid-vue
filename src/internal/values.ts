import type { CellValue, DataTableColumn } from '../types'

/**
 * Primitivas de valor de celda compartidas por el camino de pintado y el editor.
 *
 * Están separadas de `dom.ts` porque no tocan el DOM en absoluto: son funciones
 * puras sobre datos, lo que las vuelve triviales de testear y seguras de llamar
 * desde cualquier lado. Todo lo de este módulo corre por cada celda visible en
 * cada frame, así que las implementaciones evitan asignaciones y ramas
 * impredecibles.
 *
 * No forma parte de la API pública.
 */

/**
 * Reduce una propiedad desconocida de la fila a un {@link CellValue}.
 *
 * Las filas se tipan como `Record<string, unknown>`, por lo que una lectura por
 * defecto `row[key]` devuelve `unknown`. En vez de castear —lo que dejaría que
 * un objeto cualquiera llegue a `textContent` y se renderice como
 * `[object Object]` sin ninguna señal— se estrecha el tipo en runtime y se
 * convierte el resto de forma explícita. El `[object Object]` que aparece en una
 * columna de objetos sin mapear pasa a ser entonces una señal deliberada y
 * visible de que esa columna necesita un `accessor` o un `format`.
 */
export function toCellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value instanceof Date) return value
  return String(value)
}

/**
 * Lee el valor de una columna dentro de una fila.
 *
 * Prioriza el `accessor` de la columna; si no existe, cae en `row[column.key]`.
 * Se invoca una vez por celda visible por frame, así que se mantiene como una
 * función de dos ramas sin objetos intermedios.
 */
export function readCellValue<TRow extends Record<string, unknown>>(
  column: DataTableColumn<TRow>,
  row: TRow,
): CellValue {
  return toCellValue(readRawValue(column, row))
}

/**
 * Lee el valor de una columna SIN reducirlo a {@link CellValue}.
 *
 * Es lo que reciben los renderers en `ctx.raw`. Existe porque `toCellValue`
 * convierte objetos y arrays a texto, y renderers como `tags` o `avatar`
 * necesitan la estructura original.
 */
export function readRawValue<TRow extends Record<string, unknown>>(
  column: DataTableColumn<TRow>,
  row: TRow,
): unknown {
  const accessor = column.accessor
  if (accessor) return accessor(row)
  return row[column.key]
}

/**
 * Representación por defecto de un valor que no tiene hook `format`.
 *
 * `Date` se convierte a ISO y no a string de locale a propósito: construir un
 * formateador `Intl` por celda y por frame dominaría el presupuesto de pintado,
 * y el resultado cambiaría en silencio según el locale del usuario. Para fechas
 * orientadas a personas corresponde definir `format`.
 */
export function formatCellValue(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  return String(value)
}

/**
 * Igualdad de valores usada para decidir si una celda necesita repintarse.
 *
 * Dos instancias de `Date` son iguales cuando marcan el mismo instante, porque
 * un padre que reconstruye los objetos de fila forzaría, de otro modo, una
 * reescritura completa del texto de cada columna de fecha en cada frame.
 * `Object.is` cubre el resto, lo que además hace que `NaN` sea igual a sí mismo
 * y evita un ciclo de repintado inútil.
 */
export function cellValuesEqual(a: CellValue, b: CellValue): boolean {
  if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime()
  if (b instanceof Date) return false
  return Object.is(a, b)
}

/**
 * Igualdad sobre el valor SIN normalizar, que es la clave de caché del pintado.
 *
 * Generaliza {@link cellValuesEqual} a las formas que `CellValue` no expresa:
 *
 * - `Date` se compara por instante, no por identidad, para que un padre que
 *   reconstruye las filas no fuerce una reescritura de cada columna de fecha.
 * - Los arrays se comparan superficialmente. Es lo que necesita el renderer
 *   `tags`: una lista reconstruida con los mismos elementos no debería repintar.
 *   La comparación es barata porque estas listas tienen unos pocos elementos.
 * - Cualquier otro objeto se compara por identidad. No hay forma barata de saber
 *   si dos objetos distintos representan lo mismo, y una comparación profunda en
 *   el camino caliente costaría más que el repintado que evitaría.
 */
export function rawValuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime()
  if (b instanceof Date) return false

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    const left: readonly unknown[] = a
    const right: readonly unknown[] = b
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!Object.is(left[index], right[index])) return false
    }
    return true
  }
  if (Array.isArray(b)) return false

  return Object.is(a, b)
}

/**
 * Convierte un valor al texto con el que debe abrirse un `<input>`.
 *
 * Deliberadamente no es {@link formatCellValue}: se edita el dato subyacente, no
 * su presentación. Una columna que formatea `1234.5` como `"$1.234,50"` igual
 * abre su editor con `"1234.5"`.
 */
export function toEditString(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  return String(value)
}

/**
 * Convierte un valor al formato `YYYY-MM-DD` que exige `<input type="date">`.
 *
 * Se usa UTC en las dos direcciones, acá y en {@link fromDateInputString}.
 * Mezclar zona local y UTC es el origen clásico del bug de "la fecha se corre un
 * día": basta con que el navegador esté al oeste de Greenwich para que el
 * ida y vuelta pierda una jornada. Con UTC de punta a punta el round-trip es
 * exacto, a costa de que la fecha mostrada sea la UTC y no la local.
 */
export function toDateInputString(value: CellValue): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  }
  return ''
}

/**
 * Convierte el `YYYY-MM-DD` de un `<input type="date">` de vuelta a un valor.
 *
 * Conserva el tipo de origen: si la celda tenía un `Date` devuelve un `Date`, y
 * si tenía un string devuelve el string ISO. El sufijo `T00:00:00Z` fuerza la
 * interpretación en UTC; sin él, algunos navegadores parsean la fecha suelta en
 * hora local y reaparece el corrimiento de un día.
 */
export function fromDateInputString(raw: string, previous: CellValue): CellValue {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const parsed = new Date(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return raw

  if (typeof previous === 'string') return trimmed
  return parsed
}

/**
 * Coacciona el string crudo del `<input>` de vuelta al tipo primitivo de origen.
 *
 * Escribir en un input de texto siempre produce un string, pero entregarle al
 * padre `"42"` donde tenía guardado `42` corrompe el dataset en silencio. Se usa
 * el valor previo como testigo de tipo y se cae al string crudo cada vez que la
 * coacción perdería información (un número no parseable, una fecha inválida).
 */
export function coerceEditValue(raw: string, previous: CellValue): CellValue {
  const trimmed = raw.trim()

  if (typeof previous === 'number') {
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isNaN(parsed) ? raw : parsed
  }

  if (typeof previous === 'boolean') {
    const lowered = trimmed.toLowerCase()
    if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true
    if (lowered === 'false' || lowered === '0' || lowered === 'no') return false
    return raw
  }

  if (previous instanceof Date) {
    if (trimmed === '') return null
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? raw : parsed
  }

  // `null` / `undefined` / `string`: no hay nada de donde inferir, se conserva
  // el texto tal cual lo escribió el usuario.
  return raw
}

/** Acota `value` al rango `[min, max]`, tolerando rangos invertidos o no finitos. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}
