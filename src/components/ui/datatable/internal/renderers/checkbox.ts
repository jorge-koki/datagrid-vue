import type { CellRenderContext, CellRendererHandle } from '../../types'
import { createElement } from './shared'
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

  create(cell: HTMLElement): CellRendererHandle {
    const input = createElement('input', 'dt-checkbox')
    input.type = 'checkbox'
    // La celda ya es enfocable y maneja el teclado; el input no debe sumar una
    // segunda parada de tabulación por cada celda visible.
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
