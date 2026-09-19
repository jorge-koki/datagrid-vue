import type { CellRenderContext, CellRendererHandle } from '../../types'
import {
  BOX_CELL_LAYOUT,
  createElement,
  createSvgElement,
  writeCustomProperty,
  writeText,
} from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * Renderer de progreso: un anillo SVG con el porcentaje al lado.
 *
 * - **Acepta**: un `number` de 0 a 100. Un `string` numérico se parsea.
 * - **Fuera de rango**: se acota a 0..100. Un 150 dibuja el anillo completo en
 *   lugar de superponer el trazo sobre sí mismo.
 * - **Valor inesperado**: `null`, `undefined` y `NaN` se tratan como 0. Un
 *   anillo vacío al 0% comunica "sin avance"; dejar la celda en blanco haría
 *   que la fila pareciera rota.
 *
 * ## Por qué solo se escribe `stroke-dashoffset`
 *
 * El truco del anillo es un `stroke-dasharray` igual a la circunferencia, que
 * convierte el trazo en un único segmento del largo del círculo. Corriendo el
 * `stroke-dashoffset` se revela la fracción que corresponde. Como el dasharray
 * es constante, se fija en `create` y `update` escribe una sola propiedad. Es
 * además una propiedad que el navegador puede animar sin recalcular layout.
 */

/** Radio del anillo dentro del viewBox de 32x32, dejando lugar al grosor del trazo. */
const RADIUS = 13
/** Circunferencia del anillo. Constante: el dasharray nunca cambia. */
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface ProgressState {
  ring: SVGCircleElement
  label: HTMLElement
  root: HTMLElement
  offset: number
  text: string
  color: string
}

const states = new WeakMap<CellRendererHandle, ProgressState>()

/** Convierte cualquier entrada a un porcentaje válido. */
function toPercent(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(numeric)) return 0
  if (numeric < 0) return 0
  if (numeric > 100) return 100
  return numeric
}

/**
 * Token de color según el avance.
 *
 * Los umbrales viven aquí pero los colores son tokens del tema, así que la paleta
 * sigue siendo responsabilidad de la hoja de estilos.
 */
function colorForPercent(percent: number): string {
  if (percent >= 100) return 'var(--dt-color-green)'
  if (percent >= 60) return 'var(--dt-color-blue)'
  if (percent >= 30) return 'var(--dt-color-amber)'
  return 'var(--dt-color-red)'
}

function createCircle(className: string): SVGCircleElement {
  const circle = createSvgElement('circle', className)
  circle.setAttribute('cx', '16')
  circle.setAttribute('cy', '16')
  circle.setAttribute('r', String(RADIUS))
  circle.setAttribute('fill', 'none')
  return circle
}

/** La etiqueta del anillo. Única fuente de verdad de `update` y de `text`. */
function textOf<TRow>(ctx: CellRenderContext<TRow>): string {
  const format = ctx.column.format
  return format ? format(ctx.value, ctx.row, ctx.rowIndex) : `${Math.round(toPercent(ctx.value))}%`
}

export const progressRenderer: AnyCellRenderer = {
  type: 'progress',
  // El anillo es geometría fija: si la celda lo alinea por línea base, queda
  // descentrado respecto de la fila.
  layout: BOX_CELL_LAYOUT,

  create(cell: HTMLElement): CellRendererHandle {
    const root = createElement('span', 'dt-progress')

    const svg = createSvgElement('svg', 'dt-progress-ring')
    svg.setAttribute('viewBox', '0 0 32 32')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')

    const track = createCircle('dt-progress-track')
    const ring = createCircle('dt-progress-value')
    // El dasharray es constante: convierte el trazo en un segmento del largo de
    // la circunferencia para que `stroke-dashoffset` revele la fracción exacta.
    ring.setAttribute('stroke-dasharray', String(CIRCUMFERENCE))
    ring.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE))

    svg.appendChild(track)
    svg.appendChild(ring)

    const label = createElement('span', 'dt-progress-label')

    root.appendChild(svg)
    root.appendChild(label)
    cell.appendChild(root)

    const handle: CellRendererHandle = { root: cell }
    states.set(handle, {
      ring,
      label,
      root,
      offset: CIRCUMFERENCE,
      text: '',
      color: '',
    })
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = states.get(handle)
    if (!state) return

    const percent = toPercent(ctx.value)
    const offset = CIRCUMFERENCE * (1 - percent / 100)

    if (state.offset !== offset) {
      state.offset = offset
      state.ring.setAttribute('stroke-dashoffset', String(offset))
    }

    const text = textOf(ctx)
    if (writeText(state.label, state.text, text)) state.text = text

    const color = colorForPercent(percent)
    if (writeCustomProperty(state.root, '--dt-progress-color', state.color, color)) {
      state.color = color
    }
  },

  text: textOf,

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}
