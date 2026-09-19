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
import { selectionRenderer } from './selection'
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

export { BOX_CELL_LAYOUT, TEXT_CELL_LAYOUT, TEXT_RENDERER_TYPE } from './shared'
export type { AnyCellRenderer, CellRendererFactory, CellRendererLifecycle } from './shared'
export { textRenderer } from './text'
export { numberRenderer } from './number'
export { badgeRenderer } from './badge'
export { selectRenderer } from './select'
export { progressRenderer } from './progress'
export { avatarRenderer } from './avatar'
export { checkboxRenderer, revertCheckbox } from './checkbox'
export { SELECTION_HOOKS, selectionRenderer } from './selection'
export type { SelectionColumnHooks } from './selection'
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
  selectionRenderer,
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
 * Nombres desconocidos que ya se reportaron por consola.
 *
 * Solo lo toca la rama de fallo de {@link resolveRenderer}. Un nombre que sí
 * está registrado no lee ni escribe este conjunto: el camino de éxito no paga
 * nada por esta función.
 */
const warnedUnknownNames = new Set<string>()

/**
 * Avisa UNA sola vez por cada nombre de renderer desconocido.
 *
 * ## Por qué la deduplicación es obligatoria
 *
 * `resolveRenderer` se ejecuta una vez por columna y por frame. Con quince
 * columnas a 60 fps, un `console.warn` sin memoria emitiría unos novecientos
 * mensajes por segundo: dejaría la consola de las devtools inutilizable y se
 * comería el presupuesto de pintado que el componente promete cuidar. El aviso
 * sería peor que el silencio que viene a corregir.
 *
 * El conjunto no se limpia nunca: vive lo que vive el módulo. Un nombre
 * desconocido no se arregla solo, así que repetir el mensaje no aportaría
 * información nueva. El registro sí puede crecer más tarde con
 * `registerRenderer`, y a partir de ese momento el nombre deja de entrar en esta
 * rama por sí mismo.
 */
function warnUnknownRenderer(name: string): void {
  if (warnedUnknownNames.has(name)) return
  warnedUnknownNames.add(name)

  const registered = [...factories.keys()].sort().join(', ')

  console.warn(
    `[DataTable] \`column.renderer: '${name}'\` no corresponde a ningún renderer registrado. ` +
      `La celda se pintó con \`${TEXT_RENDERER_TYPE}\`, así que el valor se ve como texto plano.\n` +
      `Renderers registrados: ${registered}.\n` +
      `Si es un error de tipeo, corregir el nombre comparándolo con esa lista. ` +
      `Si es un renderer propio, registrarlo antes de montar la tabla con ` +
      `\`registerRenderer('${name}', () => miRenderer)\`, o pasar la instancia ` +
      `directamente en \`column.renderer\`. Ver "Escribir un renderer propio" en el README.`,
  )
}

/**
 * Resuelve lo que declara `column.renderer` a una instancia concreta.
 *
 * Un nombre desconocido cae al renderer de texto en lugar de lanzar: esto corre
 * dentro del pintado, y una excepción por frame dejaría la tabla en blanco en
 * vez de mostrar el dato tal cual. Pero caer en silencio tampoco sirve: un
 * nombre que nadie registró NUNCA es un estado legítimo, siempre es un error, y
 * la única pista visible sería una columna que se ve como texto plano. Por eso
 * en desarrollo se avisa por consola, una vez por nombre.
 *
 * El aviso vive dentro de la rama de fallo y detrás de `import.meta.env.DEV`. La
 * rama de éxito —la que corre por columna y por frame en toda aplicación
 * correcta— no gana ni una instrucción: el `Set` de nombres ya reportados se
 * consulta DESPUÉS de que la búsqueda en el registro falló, nunca antes.
 */
export function resolveRenderer<TRow>(
  spec: string | CellRenderer<TRow> | undefined,
): CellRenderer<TRow> {
  if (spec !== undefined && typeof spec !== 'string') return spec

  const name = spec ?? TEXT_RENDERER_TYPE
  const cached = instances.get(name)
  if (cached) return cached

  const factory = factories.get(name)
  if (!factory) {
    // `import.meta.env.DEV` lo reemplaza Vite por un literal al compilar, así
    // que el bundle publicado queda con `if (false)` y el minificador borra la
    // llamada junto con la función y el `Set`. Un consumidor en producción no
    // paga ni el código ni la comprobación.
    if (import.meta.env.DEV) warnUnknownRenderer(name)
    return textRenderer
  }

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
