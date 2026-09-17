import type { CellRenderContext, CellRendererHandle } from '../../types'
import { formatCellValue } from '../values'
import { TEXT_RENDERER_TYPE, writeText } from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * Renderer por defecto: escribe el valor como texto plano.
 *
 * - **Acepta**: cualquier {@link CellValue}. Usa `column.format` si existe y si
 *   no cae en `formatCellValue`.
 * - **Valor inesperado**: un objeto o un array llegan ya convertidos a texto por
 *   `toCellValue`, así que se ven como `[object Object]`. Es deliberado: una
 *   celda en blanco escondería el problema, esto lo muestra.
 *
 * Nunca toca `innerHTML`. Asignar `textContent` destruye y recrea el nodo de
 * texto e invalida el layout de la celda aunque el string sea idéntico, así que
 * la comparación previa convierte en un no-op real los repintados por resize,
 * por edición o por cambio de tema.
 */

interface TextState {
  root: HTMLElement
  text: string
}

const states = new WeakMap<CellRendererHandle, TextState>()

/** El texto de la celda. Única fuente de verdad de `update` y de `text`. */
function textOf<TRow>(ctx: CellRenderContext<TRow>): string {
  const format = ctx.column.format
  return format ? format(ctx.value, ctx.row, ctx.rowIndex) : formatCellValue(ctx.value)
}

export const textRenderer: AnyCellRenderer = {
  type: TEXT_RENDERER_TYPE,

  create(cell: HTMLElement): CellRendererHandle {
    const handle: CellRendererHandle = { root: cell }
    states.set(handle, { root: cell, text: '' })
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = states.get(handle)
    if (!state) return

    const next = textOf(ctx)
    if (writeText(state.root, state.text, next)) state.text = next
  },

  text: textOf,

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}
