import { COLOR_TOKENS } from 'datatable-vue'
import type { CellOption } from 'datatable-vue'

/**
 * Generador determinista del dataset de la demo.
 *
 * Todo sale de un generador pseudoaleatorio sembrado con una constante fija, de
 * modo que recargar la página produce exactamente las mismas filas. Eso es lo que
 * vuelve comparables dos mediciones de FPS: si los datos cambiaran en cada
 * recarga, la cantidad de etiquetas o el largo de los textos variaría y con eso
 * variaría el costo de pintado.
 *
 * Sin dependencias: el algoritmo es mulberry32, doce líneas de aritmética entera.
 */

/** Lista con al menos un elemento. Permite elegir al azar sin chequear vacíos. */
type NonEmpty<T> = readonly [T, ...T[]]

/** Semilla fija. Cambiarla produce otro dataset, igual de reproducible. */
const SEED = 0x5eed_1337

/**
 * Crea un generador pseudoaleatorio determinista en el rango [0, 1).
 *
 * `Math.random` no sirve acá porque no admite semilla: cada recarga daría otro
 * dataset y las mediciones dejarían de ser comparables entre sí.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Elige un elemento al azar.
 *
 * El genérico se ata a la tupla completa y no al tipo de elemento para que el
 * retorno sea la UNIÓN de sus miembros: con `NonEmpty<T>`, TypeScript infiere `T`
 * del primer elemento y rechazaría los demás. El fallback al primero satisface
 * `noUncheckedIndexedAccess` sin una aserción.
 */
function pick<T extends NonEmpty<unknown>>(random: () => number, list: T): T[number] {
  return list[Math.floor(random() * list.length)] ?? list[0]
}

/** Entero en el rango `[min, max]`, ambos inclusive. */
function pickInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

/* ------------------------------------------------------- Conjuntos cerrados */

/**
 * Estados posibles de un proyecto.
 *
 * Es la ÚNICA fuente de verdad: de acá salen las opciones que consumen el
 * renderer `select` y el editor desplegable, el texto de las cabeceras de grupo
 * cuando se agrupa por esta columna, y también el tipo literal del campo
 * `status` de una fila. Duplicar la lista sería la forma más rápida de que un
 * valor de datos deje de tener opción asociada.
 */
const STATUSES = [
  { value: 'planning', label: 'Planificación', color: COLOR_TOKENS.neutral },
  { value: 'active', label: 'Activo', color: COLOR_TOKENS.blue },
  { value: 'blocked', label: 'Bloqueado', color: COLOR_TOKENS.red },
  { value: 'review', label: 'En revisión', color: COLOR_TOKENS.amber },
  { value: 'done', label: 'Terminado', color: COLOR_TOKENS.green },
] as const satisfies NonEmpty<CellOption>

const PRIORITIES = [
  { value: 'low', label: 'Baja', color: COLOR_TOKENS.neutral },
  { value: 'medium', label: 'Media', color: COLOR_TOKENS.blue },
  { value: 'high', label: 'Alta', color: COLOR_TOKENS.amber },
  { value: 'critical', label: 'Crítica', color: COLOR_TOKENS.red },
] as const satisfies NonEmpty<CellOption>

const TAGS = [
  { value: 'frontend', label: 'frontend', color: COLOR_TOKENS.blue },
  { value: 'backend', label: 'backend', color: COLOR_TOKENS.purple },
  { value: 'infra', label: 'infra', color: COLOR_TOKENS.amber },
  { value: 'design', label: 'design', color: COLOR_TOKENS.green },
  { value: 'research', label: 'research', color: COLOR_TOKENS.neutral },
  { value: 'security', label: 'security', color: COLOR_TOKENS.red },
] as const satisfies NonEmpty<CellOption>

/** Opciones listas para pasar a `column.options`. */
export const STATUS_OPTIONS: readonly CellOption[] = STATUSES
export const PRIORITY_OPTIONS: readonly CellOption[] = PRIORITIES
export const TAG_OPTIONS: readonly CellOption[] = TAGS

export type ProjectStatus = (typeof STATUSES)[number]['value']
export type ProjectPriority = (typeof PRIORITIES)[number]['value']
export type ProjectTag = (typeof TAGS)[number]['value']

/* ------------------------------------------------------- Vocabulario base */

const PROJECT_PREFIXES: NonEmpty<string> = [
  'Atlas',
  'Beacon',
  'Cascade',
  'Delta',
  'Ember',
  'Foundry',
  'Granite',
  'Harbor',
  'Ion',
  'Juniper',
  'Kestrel',
  'Lumen',
]

const PROJECT_SUFFIXES: NonEmpty<string> = [
  'Migration',
  'Rollout',
  'Rewrite',
  'Audit',
  'Pipeline',
  'Dashboard',
  'Gateway',
  'Toolkit',
  'Sync',
  'Portal',
]

const FIRST_NAMES: NonEmpty<string> = [
  'Ada',
  'Grace',
  'Alan',
  'Barbara',
  'Edsger',
  'Radia',
  'Linus',
  'Margaret',
  'Ken',
  'Sophie',
  'Tomas',
  'Irene',
]

const LAST_NAMES: NonEmpty<string> = [
  'Lovelace',
  'Hopper',
  'Turing',
  'Liskov',
  'Dijkstra',
  'Perlman',
  'Torvalds',
  'Hamilton',
  'Thompson',
  'Wilson',
  'Alvarez',
  'Costa',
]

const DESCRIPTION_VERBS: NonEmpty<string> = [
  'Replace',
  'Consolidate',
  'Instrument',
  'Decommission',
  'Harden',
  'Document',
]

const DESCRIPTION_OBJECTS: NonEmpty<string> = [
  'the legacy reporting jobs',
  'the shared authentication layer',
  'the nightly export pipeline',
  'the customer onboarding flow',
  'the internal metrics dashboard',
  'the multi-region failover path',
]

/* ----------------------------------------------------------------- Filas */

/** Persona responsable. Es la forma de objeto que acepta el renderer `avatar`. */
export type ProjectOwner = {
  /** Nombre completo. De acá salen las iniciales y el color estable del círculo. */
  name: string
  /** URL de la foto. Sin ella, el avatar dibuja iniciales. */
  src?: string
}

/**
 * Una fila de la demo.
 *
 * Es un `type` y no una `interface` a propósito: el componente exige
 * `TRow extends Record<string, unknown>`, y en TypeScript solo los alias de tipo
 * obtienen una firma de índice implícita. Una `interface` con estos mismos campos
 * no sería asignable y el genérico no compilaría.
 */
export type ProjectRow = {
  id: string
  name: string
  owner: ProjectOwner
  description: string
  status: ProjectStatus
  priority: ProjectPriority
  progress: number
  budget: number
  tags: ProjectTag[]
  active: boolean
  /** Filas bloqueadas: el handler de `beforeEdit` de la demo veta su edición. */
  locked: boolean
  dueDate: Date
}

/** Una de cada doce filas nace bloqueada, suficiente para ver el veto sin buscarlo. */
const LOCKED_EVERY = 12

/**
 * Tamaños de dataset ofrecidos en la demo. El primero es el que se carga al
 * abrir la página.
 *
 * Vive acá y no en la pantalla porque lo necesitan los dos lados: el panel de
 * controles para armar el desplegable, y `App.vue` para saber con cuántas filas
 * arrancar. Una segunda copia se desincronizaría de esta en el primer cambio.
 */
export const ROW_COUNTS = [100, 1_000, 10_000, 50_000] as const

/**
 * Genera `count` filas deterministas.
 *
 * El array se dimensiona de entrada con `new Array(count)` en lugar de crecer con
 * `push`: para 50.000 filas eso evita una decena de realocaciones del array.
 */
export function createProjects(count: number): ProjectRow[] {
  const random = createRandom(SEED)
  const rows: ProjectRow[] = new Array<ProjectRow>(count)

  for (let index = 0; index < count; index += 1) {
    const owner = `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}`

    const tagCount = pickInt(random, 1, 3)
    const tags: ProjectTag[] = []
    for (let tagIndex = 0; tagIndex < tagCount; tagIndex += 1) {
      const tag = pick(random, TAGS).value
      // Sin repetidos: dos píldoras idénticas en la misma celda se leen como un bug.
      if (!tags.includes(tag)) tags.push(tag)
    }

    rows[index] = {
      id: `PRJ-${String(index + 1).padStart(5, '0')}`,
      name: `${pick(random, PROJECT_PREFIXES)} ${pick(random, PROJECT_SUFFIXES)}`,
      owner: { name: owner },
      description: `${pick(random, DESCRIPTION_VERBS)} ${pick(random, DESCRIPTION_OBJECTS)}`,
      status: pick(random, STATUSES).value,
      priority: pick(random, PRIORITIES).value,
      progress: pickInt(random, 0, 100),
      budget: pickInt(random, 12, 900) * 1_000,
      tags,
      active: random() > 0.25,
      locked: index % LOCKED_EVERY === 0,
      // UTC de punta a punta, igual que hace el editor de fechas del componente:
      // mezclar hora local y UTC es el origen clásico del corrimiento de un día.
      dueDate: new Date(Date.UTC(2026, pickInt(random, 0, 11), pickInt(random, 1, 28))),
    }
  }

  return rows
}
