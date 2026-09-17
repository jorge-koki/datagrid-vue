import type { CellRenderContext, CellRendererHandle } from '../../types'
import { BOX_CELL_LAYOUT, createElement } from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * Renderer de casilla: un `<input type="checkbox">` real.
 *
 * - **Acepta**: `boolean`. Cualquier otro valor se interpreta por veracidad.
 * - **`null` / `undefined`**: la casilla queda en estado indeterminado, que es
 *   visualmente distinto de "sin tildar". La diferencia importa: "todavía no se
 *   respondió" no es lo mismo que "se respondió que no".
 * - **Solo lectura**: queda `disabled` salvo que la columna sea `editable`.
 *
 * ## Por qué un input nativo y no un div estilizado
 *
 * El soporte de teclado, el rol de accesibilidad, el estado indeterminado y el
 * anuncio del lector de pantalla vienen gratis y bien hechos. Reimplementarlos
 * sobre un `<div role="checkbox">` es trabajo que casi siempre queda a medias.
 *
 * ## El tilde NO escribe el dato
 *
 * El clic solo expresa una intención. El listener delegado del pool revierte el
 * estado visual en el acto y manda la intención por la tubería normal de
 * edición: `beforeEdit` (cancelable) -> `editCommit` -> `afterEdit`. Si un
 * listener veta, o si el padre ignora `editCommit`, la casilla no cambia. Así el
 * componente sigue siendo controlado y el veto no se puede esquivar por acá.
 */

interface CheckboxState {
  input: HTMLInputElement
  checked: boolean
  indeterminate: boolean
  disabled: boolean
}

const states = new WeakMap<CellRendererHandle, CheckboxState>()

export const checkboxRenderer: AnyCellRenderer = {
  type: 'checkbox',
  defaultAlign: 'center',
  // Un control de formulario es una caja con alto propio, decidido por el
  // navegador: la altura de línea de la celda no lo centra.
  layout: BOX_CELL_LAYOUT,

  create(cell: HTMLElement): CellRendererHandle {
    const input = createElement('input', 'dt-checkbox')
    input.type = 'checkbox'
    // Fuera del orden de tabulación: con ~450 celdas visibles, una parada por
    // casilla haría imposible atravesar la tabla con Tab. La celda no es
    // enfocable y el teclado lo maneja el viewport, así que la casilla no tiene
    // que ofrecer una parada propia. Sigue siendo enfocable por clic, que es lo
    // que necesita para comportarse como un control nativo.
    input.tabIndex = -1
    cell.appendChild(input)

    const handle: CellRendererHandle = { root: cell }
    states.set(handle, { input, checked: false, indeterminate: false, disabled: false })
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = states.get(handle)
    if (!state) return

    const isNullish = ctx.value === null || ctx.value === undefined
    const checked = !isNullish && Boolean(ctx.value)
    const disabled = ctx.column.editable !== true

    if (state.checked !== checked) {
      state.checked = checked
      state.input.checked = checked
    }
    if (state.indeterminate !== isNullish) {
      state.indeterminate = isNullish
      state.input.indeterminate = isNullish
    }
    if (state.disabled !== disabled) {
      state.disabled = disabled
      state.input.disabled = disabled
    }
  },

  /**
   * `true` / `false`, y vacío para el estado indeterminado.
   *
   * Una casilla no muestra texto, así que acá no hay "lo que se ve" que copiar y
   * se copia lo que la casilla SIGNIFICA. El vacío para nulo no es un descuido:
   * una casilla indeterminada dice justamente que no hay dato, y `false` diría
   * algo distinto.
   */
  text<TRow>(ctx: CellRenderContext<TRow>): string {
    if (ctx.value === null || ctx.value === undefined) return ''
    return ctx.value ? 'true' : 'false'
  },

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}

/**
 * Devuelve la casilla al estado que el renderer pintó por última vez.
 *
 * El navegador cambia `checked` antes de emitir el evento. Si se dejara así, el
 * caché del renderer creería que ya está sincronizado y nunca volvería a
 * escribirlo: una edición vetada dejaría la casilla tildada para siempre.
 * Revertir en el acto mantiene el DOM gobernado por el estado, no por el clic.
 */
export function revertCheckbox(input: HTMLInputElement): void {
  input.checked = !input.checked
}
