import type { CellRenderContext, CellRendererHandle } from '../../types'
import { BOX_CELL_LAYOUT, createElement } from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * La casilla de la columna de selección.
 *
 * ## Por qué no es el renderer `checkbox`
 *
 * Porque lo que muestra no sale de la fila. `checkbox` pinta un campo booleano
 * del dato y su clic viaja por la tubería de edición —`beforeEdit`,
 * `editCommit`—, que es justo lo que no corresponde aquí: marcar una fila no
 * edita nada, y un `beforeEdit` que vetara la edición no tiene por qué impedir
 * seleccionar.
 *
 * Lo que muestra sale del ESTADO de selección, que vive en el componente. Un
 * renderer está registrado globalmente y no puede ver el estado de una instancia,
 * así que el puente viaja en la definición de columna: la tabla arma esa columna
 * y le cuelga el predicado, y el renderer lo lee de `ctx.column`. La columna es
 * lo único que llega hasta acá y que la instancia controla.
 *
 * Por eso el campo no es público: nadie declara esta columna a mano, la inyecta
 * `selectionColumn`.
 */

/** El puente entre el estado de la instancia y este renderer. */
export const SELECTION_HOOKS = '__dtSelectionHooks'

export interface SelectionColumnHooks<TRow> {
  /** ¿Está marcada esta fila? Ya sabe invertir la pregunta en modo `'all'`. */
  isSelected: (row: TRow, rowIndex: number) => boolean
}

interface SelectionState {
  input: HTMLInputElement
  checked: boolean
}

const states = new WeakMap<CellRendererHandle, SelectionState>()

function hooksOf<TRow>(ctx: CellRenderContext<TRow>): SelectionColumnHooks<TRow> | undefined {
  const column = ctx.column as unknown as Record<string, unknown>
  const hooks = column[SELECTION_HOOKS]
  return typeof hooks === 'object' && hooks !== null
    ? (hooks as SelectionColumnHooks<TRow>)
    : undefined
}

export const selectionRenderer: AnyCellRenderer = {
  type: 'selection',
  defaultAlign: 'center',
  // Un control de formulario trae su propio alto, decidido por el navegador: la
  // altura de línea de la celda no lo centra. Mismo caso que `checkbox`.
  layout: BOX_CELL_LAYOUT,

  create(cell: HTMLElement): CellRendererHandle {
    const input = createElement('input', 'dt-checkbox dt-selection-checkbox')
    input.type = 'checkbox'
    // Fuera del orden de tabulación, por lo mismo que en `checkbox`: con cientos
    // de celdas visibles, una parada por casilla haría imposible atravesar la
    // tabla con Tab. El teclado lo maneja el viewport.
    input.tabIndex = -1
    input.setAttribute('aria-label', 'Seleccionar fila')
    cell.appendChild(input)

    const handle: CellRendererHandle = { root: cell }
    states.set(handle, { input, checked: false })
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = states.get(handle)
    if (!state) return

    const checked = hooksOf(ctx)?.isSelected(ctx.row, ctx.rowIndex) ?? false
    // Se compara antes de escribir, como todo el pool: una asignación al DOM que
    // no cambia nada igual cuesta, y esto corre por fila visible y por frame.
    if (state.checked !== checked) {
      state.checked = checked
      state.input.checked = checked
    }
  },

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}
