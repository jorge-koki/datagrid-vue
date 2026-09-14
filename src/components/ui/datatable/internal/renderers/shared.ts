import type { CellOption, CellRenderContext, CellRendererHandle, CellAlign } from '../../types'

/**
 * Infraestructura común de los renderers de celda.
 *
 * ## El contrato que todos respetan
 *
 * `create` se ejecuta UNA vez por nodo de celda y arma la estructura interna.
 * `update` se ejecuta en cada repintado de esa celda y solo MUTA lo que armó
 * `create`. Dentro de `update` está prohibido:
 *
 * - crear nodos,
 * - leer layout (`getBoundingClientRect`, `offsetWidth`, `getComputedStyle`),
 * - escribir algo que no haya cambiado.
 *
 * Los tres tienen la misma raíz: `update` corre por celda visible y por frame.
 * Crear nodos genera basura que el GC después cobra con un frame perdido; leer
 * layout fuerza un reflow sincrónico en medio del pintado; y escribir de más
 * invalida estilo sin motivo.
 *
 * ## Dónde vive el estado de cada renderer
 *
 * En un `WeakMap` indexado por el handle, no en propiedades del handle. El
 * handle declara una firma de índice `unknown`, así que guardar ahí obligaría a
 * estrechar el tipo en cada lectura; un `WeakMap` tipado da acceso directo por
 * una sola búsqueda hash. Y esa búsqueda solo ocurre cuando el pool decide que
 * la celda cambió: si el valor es el mismo, `update` no llega a ejecutarse.
 *
 * No forma parte de la API pública.
 */

/** Nombre del renderer aplicado cuando una columna no declara ninguno. */
export const TEXT_RENDERER_TYPE = 'text'

/**
 * Un renderer que sirve para cualquier forma de fila.
 *
 * La diferencia con `CellRenderer` está en `update`, que aquí es un método
 * genérico en lugar de estar fijado a un `TRow` concreto. Eso es lo que permite
 * guardar una sola instancia en el registro y entregarla después como
 * `CellRenderer<TRow>` para cualquier `TRow`, sin una sola aserción de tipo: una
 * firma genérica es asignable a cada una de sus instanciaciones.
 *
 * Un renderer registrado no puede depender de la forma de la fila, y eso es
 * exactamente lo correcto: si necesita conocerla, pertenece a una columna
 * puntual vía `column.renderer`, no al registro global.
 */
export interface AnyCellRenderer {
  /** Identificador del renderer. */
  readonly type: string
  /** Alineación que adopta la columna si no declara `align`. */
  readonly defaultAlign?: CellAlign
  /** Construye la estructura interna de la celda una única vez. */
  create(cell: HTMLElement): CellRendererHandle
  /** Actualiza la celda con el valor actual. */
  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void
  /** Libera recursos del handle. */
  destroy?(handle: CellRendererHandle): void
}

/**
 * Lo único que un nodo de celda necesita recordar de su renderer.
 *
 * Existe para que `PooledCellElement` pueda guardar la referencia sin volverse
 * genérico: tanto {@link AnyCellRenderer} como un `CellRenderer<TRow>` propio
 * del consumidor encajan estructuralmente. Guardar el objeto entero —en vez de
 * solo la función `destroy`— conserva su `this` y evita crear una closure por
 * cada cambio de renderer.
 */
export interface CellRendererLifecycle {
  /** Identificador del renderer con el que se construyó el nodo. */
  readonly type: string
  /** Libera recursos del handle, si el renderer lo necesita. */
  destroy?(handle: CellRendererHandle): void
}

/** Construye una instancia de renderer. Se memoiza por nombre en el registro. */
export type CellRendererFactory = () => AnyCellRenderer

/** Crea un elemento HTML con su clase ya puesta. */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = className
  return element
}

/** Espacio de nombres SVG. Sin esto, `createElement('svg')` produce un HTMLUnknownElement. */
const SVG_NS = 'http://www.w3.org/2000/svg'

/** Crea un elemento SVG con su clase ya puesta. */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag)
  element.setAttribute('class', className)
  return element
}

/**
 * Busca la opción que corresponde a un valor.
 *
 * Compara primero por identidad y después por representación en texto, porque un
 * backend puede devolver `"1"` donde las opciones declaran `1`. Devuelve `null`
 * si no hay coincidencia: cada renderer decide qué hacer con un valor
 * desconocido, y ninguno debe dejar la celda en blanco por eso.
 */
export function findOption(
  options: readonly CellOption[] | undefined,
  value: unknown,
): CellOption | null {
  if (!options || options.length === 0) return null
  for (const option of options) {
    if (option.value === value) return option
  }
  const text = value === null || value === undefined ? '' : String(value)
  for (const option of options) {
    if (String(option.value) === text) return option
  }
  return null
}

/** Paleta por defecto para badges y avatares, como tokens del tema. */
export const DEFAULT_COLOR_TOKENS = [
  'var(--dt-color-blue)',
  'var(--dt-color-green)',
  'var(--dt-color-amber)',
  'var(--dt-color-red)',
  'var(--dt-color-purple)',
  'var(--dt-color-neutral)',
] as const

/** Color usado cuando un valor no coincide con ninguna opción declarada. */
export const NEUTRAL_COLOR_TOKEN = 'var(--dt-color-neutral)'

/**
 * Hash determinista de un texto a un índice de paleta.
 *
 * Es djb2, elegido por ser una multiplicación y un XOR por carácter: sobre
 * nombres de personas cuesta nanosegundos. Lo importante no es la calidad de la
 * distribución sino que sea ESTABLE: el mismo nombre tiene que dar el mismo
 * color en cada sesión, en cada máquina y después de cada reciclado de nodo, o
 * los avatares parpadearían de color al scrollear.
 */
export function hashToIndex(text: string, buckets: number): number {
  if (buckets <= 0) return 0
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index)
  }
  // `>>> 0` lo vuelve entero sin signo: el corrimiento de arriba puede dejarlo
  // negativo, y un módulo negativo daría un índice fuera del array.
  return (hash >>> 0) % buckets
}

/** Escribe `textContent` solo si cambió. Devuelve `true` si escribió. */
export function writeText(node: Node, previous: string, next: string): boolean {
  if (previous === next) return false
  node.textContent = next
  return true
}

/** Escribe una custom property solo si cambió. Devuelve `true` si escribió. */
export function writeCustomProperty(
  element: HTMLElement | SVGElement,
  property: string,
  previous: string,
  next: string,
): boolean {
  if (previous === next) return false
  element.style.setProperty(property, next)
  return true
}

/** Alterna `hidden` solo si cambió. */
export function writeHidden(element: HTMLElement, previous: boolean, next: boolean): boolean {
  if (previous === next) return false
  element.hidden = next
  return true
}

/** Texto de la celda cuando el valor no tiene una representación mejor. */
export function fallbackText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}
