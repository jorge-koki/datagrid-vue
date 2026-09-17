import type { DataTableColumn } from '../types'
import { formatCellValue, readRawValue, toCellValue } from './values'
import { resolveRenderer } from './renderers'

/**
 * Serialización de un rango de celdas al portapapeles.
 *
 * ## Por qué no se lee el DOM
 *
 * Porque la tabla está virtualizada. De un rango de 5.000 filas hay unas treinta
 * pintadas; las otras 4.970 no tienen un solo nodo del que leer texto. Copiar lo
 * que se ve exige entonces CALCULAR lo que se vería, y el único que sabe cómo se
 * ve una celda es el renderer que la pinta: un badge muestra la etiqueta de su
 * opción y no el valor guardado, `number` mete separadores de miles, `tags`
 * junta varias etiquetas. De ahí `CellRenderer.text`, que es una función pura
 * del contexto y por eso vale igual para una fila pintada que para una que no.
 *
 * Un renderer que no la implemente cae en la representación por defecto del
 * valor, que es exactamente lo que hace el renderer de texto sin `format`.
 *
 * ## El formato es TSV, y eso no es una preferencia
 *
 * Tabulación entre columnas y salto de línea entre filas es lo que Excel, Google
 * Sheets, Numbers y LibreOffice interpretan como una tabla al pegar. Cualquier
 * otra cosa —comas, JSON, HTML— aterriza como texto suelto en una sola celda.
 *
 * No forma parte de la API pública.
 */

/** Lo que el serializador necesita saber de la secuencia visible. */
export interface ClipboardRangeSource<TRow> {
  /**
   * Fila de datos en esa posición visible, o `undefined`.
   *
   * `undefined` es la respuesta para una cabecera de grupo, que ocupa una
   * posición visible sin ser una fila del dataset.
   */
  rowAt(rowIndex: number): TRow | undefined
  /** Índice de esa posición dentro de la prop `rows`, para el contexto del renderer. */
  toSourceIndex(rowIndex: number): number
}

/** Resultado de {@link buildRangeText}. */
export interface RangeText {
  /** El texto listo para el portapapeles. */
  text: string
  /** Cuántas filas de datos aportaron una línea. */
  rowCount: number
}

/** Caracteres que obligan a encomillar un campo: los dos separadores y la comilla. */
const NEEDS_QUOTING = /["\t\r\n]/

/**
 * Protege un campo que contiene un separador.
 *
 * Es la convención de CSV aplicada al TSV, y es la que entienden las planillas:
 * un campo con tabulación, salto de línea o comilla doble se encierra entre
 * comillas y sus comillas internas se duplican. Sin esto, una etiqueta con un
 * salto de línea partiría la fila en dos y correría todas las columnas
 * siguientes: el dato pegado quedaría mal sin que nada avise.
 */
function escapeField(value: string): string {
  if (!NEEDS_QUOTING.test(value)) return value
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * Arma el texto de un rango rectangular de celdas.
 *
 * Las cabeceras de grupo que caigan adentro del rango NO aportan una línea. La
 * alternativa —una línea vacía por cabecera— metería filas en blanco en medio
 * de los datos pegados, y la etiqueta del grupo tampoco pertenece a ninguna de
 * las columnas copiadas: no hay una celda de la planilla donde ponerla sin
 * correr el resto.
 *
 * @param rowStart - Primera fila de la secuencia visible. Incluida.
 * @param rowEnd - Última fila de la secuencia visible. Incluida.
 * @param columns - Columnas abarcadas, en orden visual.
 */
export function buildRangeText<TRow extends Record<string, unknown>>(
  rowStart: number,
  rowEnd: number,
  columns: readonly DataTableColumn<TRow>[],
  source: ClipboardRangeSource<TRow>,
): RangeText {
  const lines: string[] = []

  for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
    const row = source.rowAt(rowIndex)
    if (row === undefined) continue

    const sourceIndex = source.toSourceIndex(rowIndex)
    let line = ''

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index]
      if (!column) continue

      const raw = readRawValue(column, row)
      const renderer = resolveRenderer<TRow>(column.renderer)
      const ctx = {
        value: toCellValue(raw),
        raw,
        row,
        rowIndex: sourceIndex,
        column,
        isEditing: false,
      }
      const text = renderer.text ? renderer.text(ctx) : formatCellValue(ctx.value)

      if (index > 0) line += '\t'
      line += escapeField(text)
    }

    lines.push(line)
  }

  return { text: lines.join('\n'), rowCount: lines.length }
}
