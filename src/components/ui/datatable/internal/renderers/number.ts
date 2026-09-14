import type { CellRenderContext, CellRendererHandle } from '../../types'
import { writeText } from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * Renderer numérico: alinea a la derecha y da formato con separadores de miles.
 *
 * - **Acepta**: `number`. Un `string` numérico se parsea; cualquier otra cosa se
 *   muestra tal cual como texto.
 * - **Valor inesperado**: `null`, `undefined` y `NaN` rinden cadena vacía, no
 *   `"NaN"`, que en una columna de importes se lee como un dato corrupto.
 * - **Formato**: `column.format` gana si está declarado; si no, se usa el
 *   formateador compartido.
 *
 * ## El formateador se construye UNA sola vez
 *
 * `new Intl.NumberFormat()` es caro: negocia locale, arma tablas de símbolos y
 * reserva estado interno. Construirlo dentro de `update` significaría una
 * instancia por celda y por frame, con unas 450 celdas visibles: es una de las
 * formas más rápidas de perder el presupuesto de 16ms. Vive en el módulo y se
 * comparte entre todas las celdas.
 */

/** Formateador compartido por todas las celdas numéricas. Ver la nota de arriba. */
const sharedFormatter = new Intl.NumberFormat()

interface NumberState {
  root: HTMLElement
  text: string
}

const states = new WeakMap<CellRendererHandle, NumberState>()

/** Convierte el valor a número, o `null` si no representa uno. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const numberRenderer: AnyCellRenderer = {
  type: 'number',
  defaultAlign: 'right',

  create(cell: HTMLElement): CellRendererHandle {
    const handle: CellRendererHandle = { root: cell }
    states.set(handle, { root: cell, text: '' })
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = states.get(handle)
    if (!state) return

    const format = ctx.column.format
    let next: string
    if (format) {
      next = format(ctx.value, ctx.row, ctx.rowIndex)
    } else {
      const numeric = toNumber(ctx.value)
      next = numeric === null ? '' : sharedFormatter.format(numeric)
    }

    if (writeText(state.root, state.text, next)) state.text = next
  },

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}
