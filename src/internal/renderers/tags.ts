import type { CellOption, CellRenderContext, CellRendererHandle } from '../../types'
import {
  BOX_CELL_LAYOUT,
  createElement,
  fallbackText,
  findOption,
  NEUTRAL_COLOR_TOKEN,
  writeHidden,
} from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * Renderer de etiquetas: varias píldoras a partir de un valor de lista.
 *
 * - **Acepta**: un array leído de `ctx.raw`. Cada elemento se resuelve contra
 *   `column.options` para obtener etiqueta y color.
 * - **Valor único**: si no es un array se trata como una lista de un elemento,
 *   así una columna puede pasar de simple a múltiple sin cambiar de renderer.
 * - **Vacío o nulo**: no se dibuja nada. Una lista vacía es un estado legítimo,
 *   no un error.
 * - **Elemento desconocido**: se muestra su texto crudo con el color neutro.
 *
 * ## Un pool dentro del pool
 *
 * Es el único renderer que puede necesitar crear nodos en `update`, porque la
 * cantidad de etiquetas depende del dato. Aplica la misma disciplina que el pool
 * de filas, un nivel más abajo: las píldoras se guardan por celda, crecen solo
 * cuando hace falta más que nunca antes, y las sobrantes se ocultan en lugar de
 * quitarse del DOM. Al scrollear, una celda con dos etiquetas reusa las
 * píldoras que dejó una de cinco sin tocar el DOM salvo para ocultar tres.
 */

interface TagPill {
  element: HTMLElement
  label: string
  color: string
  hidden: boolean
}

interface TagsState {
  root: HTMLElement
  pills: TagPill[]
}

const states = new WeakMap<CellRendererHandle, TagsState>()

/** Lista de trabajo reutilizada para no asignar un array por celda repintada. */
const scratch: unknown[] = []

/** Normaliza el valor crudo a {@link scratch} como lista de elementos. */
function readEntries(raw: unknown, fallback: unknown): void {
  scratch.length = 0

  if (Array.isArray(raw)) {
    const entries: readonly unknown[] = raw
    for (const entry of entries) scratch.push(entry)
    return
  }

  const single = raw ?? fallback
  if (single === null || single === undefined || single === '') return
  scratch.push(single)
}

function createPill(root: HTMLElement): TagPill {
  const element = createElement('span', 'dt-tag')
  root.appendChild(element)
  return { element, label: '', color: '', hidden: false }
}

/**
 * La regla de la etiqueta, a partir de la opción ya buscada.
 *
 * Recibe la opción en vez de buscarla porque `update` necesita además su color:
 * así el camino caliente hace un solo `findOption` por píldora.
 */
function labelOf(option: CellOption | null, entry: unknown): string {
  return option ? option.label : fallbackText(entry)
}

/**
 * Las etiquetas visibles, separadas por coma.
 *
 * Es UNA sola celda del portapapeles: las etiquetas conviven en una celda de la
 * tabla, así que tienen que convivir en una celda de la hoja de cálculo. Separarlas en
 * columnas correría todo lo que tengan a la derecha.
 */
function textOf<TRow>(ctx: CellRenderContext<TRow>): string {
  readEntries(ctx.raw, ctx.value)
  let text = ''
  for (let index = 0; index < scratch.length; index += 1) {
    const entry = scratch[index]
    if (index > 0) text += ', '
    text += labelOf(findOption(ctx.column.options, entry), entry)
  }
  return text
}

export const tagsRenderer: AnyCellRenderer = {
  type: 'tags',
  // Es el renderer donde más se notaba el desfase: la lista heredaba la altura
  // de línea de la fila y volvía a aplicar el mismo error sobre sus píldoras.
  layout: BOX_CELL_LAYOUT,

  create(cell: HTMLElement): CellRendererHandle {
    const root = createElement('span', 'dt-tags')
    cell.appendChild(root)

    const handle: CellRendererHandle = { root: cell }
    states.set(handle, { root, pills: [] })
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = states.get(handle)
    if (!state) return

    readEntries(ctx.raw, ctx.value)
    const count = scratch.length

    // Se crece solo hasta el máximo que esta celda haya necesitado alguna vez.
    while (state.pills.length < count) state.pills.push(createPill(state.root))

    for (let index = 0; index < state.pills.length; index += 1) {
      const pill = state.pills[index]
      if (!pill) continue

      if (index >= count) {
        // Sobrante: se oculta, no se elimina. El próximo valor más largo la
        // vuelve a necesitar.
        if (writeHidden(pill.element, pill.hidden, true)) pill.hidden = true
        continue
      }

      if (writeHidden(pill.element, pill.hidden, false)) pill.hidden = false

      const entry = scratch[index]
      const option = findOption(ctx.column.options, entry)
      const label = labelOf(option, entry)
      const color = option?.color ?? NEUTRAL_COLOR_TOKEN

      if (pill.label !== label) {
        pill.label = label
        pill.element.textContent = label
      }
      if (pill.color !== color) {
        pill.color = color
        pill.element.style.setProperty('--dt-badge-color', color)
      }
    }
  },

  text: textOf,

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}
