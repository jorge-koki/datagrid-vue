import type { CellAlign, CellRenderer } from '../../types'
import { TEXT_RENDERER_TYPE } from './shared'
import type { AnyCellRenderer, CellRendererFactory } from './shared'
import { textRenderer } from './text'
import { numberRenderer } from './number'
import { badgeRenderer } from './badge'
import { selectRenderer } from './select'
import { progressRenderer } from './progress'
import { avatarRenderer } from './avatar'
import { checkboxRenderer } from './checkbox'
import { tagsRenderer } from './tags'

/**
 * Registro de renderers de celda.
 *
 * Un renderer es una estrategia SIN estado: `create` construye la estructura de
 * un nodo una vez y devuelve un handle, y `update` muta ese handle en cada
 * frame. Como el renderer en sí no guarda nada, alcanza con una instancia
 * compartida por nombre; todo el estado por celda vive asociado al handle.
 *
 * Es el único módulo de `internal/` con superficie pública: `registerRenderer` y
 * `resolveRenderer` se reexportan desde `index.ts` para que un consumidor pueda
 * sumar sus propios renderers sin bifurcar el componente.
 */

export { TEXT_RENDERER_TYPE } from './shared'
export type { AnyCellRenderer, CellRendererFactory, CellRendererLifecycle } from './shared'
export { textRenderer } from './text'
export { numberRenderer } from './number'
export { badgeRenderer } from './badge'
export { selectRenderer } from './select'
export { progressRenderer } from './progress'
export { avatarRenderer } from './avatar'
export { checkboxRenderer, revertCheckbox } from './checkbox'
export { tagsRenderer } from './tags'

/** Renderers incluidos, listos para usarse por nombre desde `column.renderer`. */
const builtIn: readonly AnyCellRenderer[] = [
  textRenderer,
  numberRenderer,
  badgeRenderer,
  selectRenderer,
  progressRenderer,
  avatarRenderer,
  checkboxRenderer,
  tagsRenderer,
]

/** Factories registradas, indexadas por nombre. */
const factories = new Map<string, CellRendererFactory>()

/** Instancias ya construidas. Evita invocar la factory por celda y por frame. */
const instances = new Map<string, AnyCellRenderer>()

for (const renderer of builtIn) {
  factories.set(renderer.type, () => renderer)
  instances.set(renderer.type, renderer)
}

/**
 * Registra un renderer bajo un nombre utilizable desde `column.renderer`.
 *
 * Volver a registrar el mismo nombre reemplaza la factory y descarta la
 * instancia memoizada, de modo que el próximo pintado construya la nueva. Los
 * nodos que ya existen se reconstruyen solos en cuanto cambia el `type`.
 */
export function registerRenderer(name: string, factory: CellRendererFactory): void {
  factories.set(name, factory)
  instances.delete(name)
}

/** El renderer de texto por defecto, para componer renderers propios sobre él. */
export function createTextRenderer<TRow>(): CellRenderer<TRow> {
  return textRenderer
}

/**
 * Resuelve lo que declara `column.renderer` a una instancia concreta.
 *
 * Un nombre desconocido cae al renderer de texto en lugar de lanzar: esto corre
 * dentro del pintado, y una excepción por frame dejaría la tabla en blanco en
 * vez de mostrar el dato tal cual.
 */
export function resolveRenderer<TRow>(
  spec: string | CellRenderer<TRow> | undefined,
): CellRenderer<TRow> {
  if (spec !== undefined && typeof spec !== 'string') return spec

  const name = spec ?? TEXT_RENDERER_TYPE
  const cached = instances.get(name)
  if (cached) return cached

  const factory = factories.get(name)
  if (!factory) return textRenderer

  const instance = factory()
  instances.set(name, instance)
  return instance
}

/**
 * Alineación por defecto de una columna según su renderer.
 *
 * La resuelve el layout para que el header y las celdas de una columna numérica
 * queden alineados igual sin que el consumidor tenga que pedirlo dos veces. Un
 * `column.align` explícito siempre gana sobre esto.
 */
export function defaultAlignFor<TRow>(
  spec: string | CellRenderer<TRow> | undefined,
): CellAlign | undefined {
  return resolveRenderer(spec).defaultAlign
}
