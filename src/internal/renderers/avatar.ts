import type { CellRenderContext, CellRendererHandle } from '../../types'
import {
  BOX_CELL_LAYOUT,
  createElement,
  DEFAULT_COLOR_TOKENS,
  hashToIndex,
  NEUTRAL_COLOR_TOKEN,
  writeCustomProperty,
  writeHidden,
  writeText,
} from './shared'
import type { AnyCellRenderer } from './shared'

/**
 * Renderer de avatar: un círculo con iniciales o con una foto.
 *
 * - **Acepta**: un `string` con el nombre, o un objeto `{ name, src }` leído de
 *   `ctx.raw`. Si trae `src` se muestra la imagen; si no, las iniciales.
 * - **Valor inesperado**: cualquier otra cosa se convierte a texto y se usa como
 *   nombre. Un valor vacío deja el círculo con el color neutro y sin iniciales,
 *   que se lee como "sin asignar" en vez de como un hueco.
 *
 * ## El color es estable por nombre
 *
 * El color sale de un hash del nombre contra una paleta fija, no de un contador
 * ni del índice de fila. Es la única forma de que la misma persona tenga el mismo
 * color en toda la tabla, entre sesiones y —sobre todo— después de que el pool
 * recicle el nodo: un color derivado de la posición haría que los avatares
 * cambiaran de color al scrollear.
 *
 * ## La imagen se reusa, no se recrea
 *
 * El `<img>` se construye una vez y se mantiene oculto mientras no haga falta.
 * Asignar `src` dispara una petición de red, así que solo se escribe cuando
 * cambió de verdad; reescribir el mismo `src` por frame generaría una tormenta
 * de revalidaciones.
 */

interface AvatarState {
  root: HTMLElement
  initialsNode: HTMLElement
  image: HTMLImageElement
  initials: string
  color: string
  src: string
  alt: string
  imageHidden: boolean
  initialsHidden: boolean
}

const states = new WeakMap<CellRendererHandle, AvatarState>()

/**
 * Objeto de trabajo reutilizado para devolver nombre y foto.
 *
 * Se muta y se consume de inmediato, dentro del mismo `update`. Devolver un
 * objeto nuevo sería una asignación por celda repintada; con cientos de celdas
 * por frame, esa basura la termina cobrando el recolector como un frame perdido.
 */
const scratch = { name: '', src: '' }

/** Llena {@link scratch} leyendo cualquiera de las formas aceptadas, sin castear. */
function readAvatarValue(raw: unknown, fallback: unknown): void {
  scratch.name = ''
  scratch.src = ''

  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    if ('name' in raw && typeof raw.name === 'string') scratch.name = raw.name
    if ('src' in raw && typeof raw.src === 'string') scratch.src = raw.src
    return
  }
  if (typeof raw === 'string') {
    scratch.name = raw
    return
  }
  if (raw === null || raw === undefined) {
    scratch.name = fallback === null || fallback === undefined ? '' : String(fallback)
    return
  }
  scratch.name = String(raw)
}

/**
 * Iniciales de un nombre: hasta dos letras.
 *
 * Toma la primera letra de la primera y de la última palabra, que es lo que
 * produce iniciales reconocibles tanto en "Ada Lovelace" como en nombres con
 * varios apellidos. Se recorre el texto a mano en vez de usar `split`, que
 * asignaría un array intermedio por cada celda repintada.
 */
function toInitials(name: string): string {
  let firstChar = ''
  let lastChar = ''
  let inWord = false

  for (let index = 0; index < name.length; index += 1) {
    const char = name.charAt(index)
    const isSpace = char === ' ' || char === '\t' || char === '\n' || char === '\r'
    if (isSpace) {
      inWord = false
      continue
    }
    if (!inWord) {
      inWord = true
      if (firstChar === '') firstChar = char
      else lastChar = char
    }
  }

  if (firstChar === '') return ''
  return (firstChar + lastChar).toUpperCase()
}

export const avatarRenderer: AnyCellRenderer = {
  type: 'avatar',
  // El círculo tiene alto propio: centrarlo por línea base lo deja bajo.
  layout: BOX_CELL_LAYOUT,

  create(cell: HTMLElement): CellRendererHandle {
    const root = createElement('span', 'dt-avatar')
    const initialsNode = createElement('span', 'dt-avatar-initials')
    const image = createElement('img', 'dt-avatar-image')
    image.hidden = true
    image.alt = ''
    // Descarga y decodificación fuera del hilo crítico: al scrollear rápido no
    // deben competir con el pintado.
    image.decoding = 'async'
    image.loading = 'lazy'

    root.appendChild(initialsNode)
    root.appendChild(image)
    cell.appendChild(root)

    const handle: CellRendererHandle = { root: cell }
    states.set(handle, {
      root,
      initialsNode,
      image,
      initials: '',
      color: '',
      src: '',
      alt: '',
      imageHidden: true,
      initialsHidden: false,
    })
    return handle
  },

  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    const state = states.get(handle)
    if (!state) return

    readAvatarValue(ctx.raw, ctx.value)
    const name = scratch.name
    const src = scratch.src

    const initials = toInitials(name)
    if (writeText(state.initialsNode, state.initials, initials)) state.initials = initials

    const color =
      name === ''
        ? NEUTRAL_COLOR_TOKEN
        : (DEFAULT_COLOR_TOKENS[hashToIndex(name, DEFAULT_COLOR_TOKENS.length)] ??
          NEUTRAL_COLOR_TOKEN)
    if (writeCustomProperty(state.root, '--dt-avatar-color', state.color, color)) {
      state.color = color
    }

    // Cada asignación de `src` puede disparar una petición de red, así que se
    // escribe únicamente cuando cambió.
    if (state.src !== src) {
      state.src = src
      if (src !== '') state.image.src = src
    }
    if (state.alt !== name) {
      state.alt = name
      state.image.alt = name
    }

    const hasImage = src !== ''
    if (writeHidden(state.image, state.imageHidden, !hasImage)) state.imageHidden = !hasImage
    if (writeHidden(state.initialsNode, state.initialsHidden, hasImage)) {
      state.initialsHidden = hasImage
    }
  },

  /**
   * El NOMBRE, no las iniciales ni la URL de la foto.
   *
   * Las iniciales son una abreviatura que la celda usa por falta de lugar, y la
   * foto no es texto. Lo que el avatar representa —y lo único que sirve pegado
   * en una planilla— es el nombre completo.
   */
  text<TRow>(ctx: CellRenderContext<TRow>): string {
    readAvatarValue(ctx.raw, ctx.value)
    return scratch.name
  },

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}
