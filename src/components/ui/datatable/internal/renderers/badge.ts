import type { CellRenderContext, CellRendererHandle } from '../../types'
import {
  createElement,
  fallbackText,
  findOption,
  NEUTRAL_COLOR_TOKEN,
  writeCustomProperty,
  writeText,
} from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * Renderer de badge: una píldora con etiqueta y color.
 *
 * - **Acepta**: cualquier valor que coincida con una entrada de
 *   `column.options`, comparando por identidad y después por texto.
 * - **Valor inesperado**: se muestra el valor crudo con el color neutro. NUNCA
 *   se deja la celda vacía: un estado que la UI no conoce sigue siendo un dato
 *   que el usuario necesita ver, y una celda en blanco lo escondería.
 * - **Sin `options`**: se comporta como un badge neutro con el texto del valor.
 *
 * ## Por qué el color va por custom property
 *
 * Se escribe una sola propiedad, `--dt-badge-color`, en lugar de `background` y
 * `color` por separado: una escritura en vez de dos, y la hoja de estilos queda
 * como dueña de cómo se deriva el fondo del color de acento. Eso permite cambiar
 * el tratamiento —fondo teñido o relleno sólido— sin tocar una línea de JS, y
 * que el contraste se resuelva distinto en tema claro y oscuro.
 */

interface BadgeState {
  pill: HTMLElement
  label: string
  color: string
}

const states = new WeakMap<CellRendererHandle, BadgeState>()

/** Crea la píldora y registra su estado. Compartido con el renderer `select`. */
export function createBadgeState(cell: HTMLElement, handle: CellRendererHandle): BadgeState {
  const pill = createElement('span', 'dt-badge')
  cell.appendChild(pill)
  const state: BadgeState = { pill, label: '', color: '' }
  states.set(handle, state)
  return state
}

/** Aplica el valor sobre una píldora ya construida. Compartido con `select`. */
export function updateBadgeState<TRow>(state: BadgeState, ctx: CellRenderContext<TRow>): void {
  const option = findOption(ctx.column.options, ctx.value)
  const label = option ? option.label : fallbackText(ctx.value)
  const color = option?.color ?? NEUTRAL_COLOR_TOKEN

  if (writeText(state.pill, state.label, label)) state.label = label
  if (writeCustomProperty(state.pill, '--dt-badge-color', state.color, color)) state.color = color
}

/** Estado de badge asociado a un handle, si lo tiene. */
export function getBadgeState(handle: CellRendererHandle): BadgeState | undefined {
  return states.get(handle)
}

/** Libera el estado de badge de un handle. */
export function deleteBadgeState(handle: CellRendererHandle): void {
  states.delete(handle)
}

export const badgeRenderer: AnyCellRenderer = {
  type: 'badge',

  create(cell: HTMLElement): CellRendererHandle {
    const handle: CellRendererHandle = { root: cell }
    createBadgeState(cell, handle)
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = states.get(handle)
    if (!state) return
    updateBadgeState(state, ctx)
  },

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}
