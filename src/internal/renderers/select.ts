import type { CellRenderContext, CellRendererHandle } from '../../types'
import {
  badgeTextOf,
  createBadgeState,
  deleteBadgeState,
  getBadgeState,
  updateBadgeState,
} from './badge'
import { BOX_CELL_LAYOUT, createSvgElement } from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * Renderer de selección: badge más un chevron que indica que se puede desplegar.
 *
 * - **Acepta**: lo mismo que `badge`, y se resuelve contra `column.options`.
 * - **Valor inesperado**: igual que `badge`, valor crudo con color neutro.
 * - **No abre nada**: este renderer solo comunica visualmente que la celda es
 *   desplegable. El desplegable en sí lo arma el editor `select`. Son ejes
 *   independientes: una columna puede verse así y no ser editable.
 *
 * El `<svg>` del chevron se construye una única vez en `create` y `update` no lo
 * toca jamás: es geometría fija, no depende del valor, y volver a escribir sus
 * atributos por frame sería trabajo puro sin ningún cambio visible.
 */

const states = new WeakMap<CellRendererHandle, true>()

/** Dibuja la punta de flecha. Coordenadas fijas sobre un viewBox de 16x16. */
function createChevron(): SVGSVGElement {
  const svg = createSvgElement('svg', 'dt-select-chevron')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const path = createSvgElement('path', 'dt-select-chevron-path')
  path.setAttribute('d', 'M4 6.5 8 10.5 12 6.5')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.75')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')

  svg.appendChild(path)
  return svg
}

export const selectRenderer: AnyCellRenderer = {
  type: 'select',
  // Píldora y chevron son dos cajas que además hay que alinear entre sí.
  layout: BOX_CELL_LAYOUT,

  create(cell: HTMLElement): CellRendererHandle {
    const handle: CellRendererHandle = { root: cell }
    createBadgeState(cell, handle)
    cell.appendChild(createChevron())
    states.set(handle, true)
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = getBadgeState(handle)
    if (!state) return
    updateBadgeState(state, ctx)
  },

  // El chevron no es texto: lo que se copia de una celda `select` es su etiqueta,
  // igual que la de un badge.
  text: badgeTextOf,

  destroy(handle: CellRendererHandle): void {
    deleteBadgeState(handle)
    states.delete(handle)
  },
}
