/**
 * Un nodo del pool muestra UNA estructura por vez, y `hidden` es lo que apaga la
 * otra.
 *
 * ## El invariante que nadie estaba mirando
 *
 * Un nodo de fila conserva a la vez sus celdas de datos y su cabecera de grupo
 * —esa convivencia es deliberada, ver `ensureRowKind`— y las turna con `hidden`.
 * El invariante es que exactamente una de las dos esté encendida. Toda la suite
 * lo verificaba leyendo `node.hidden`, o sea el ESTADO QUE ESCRIBE EL POOL, y el
 * pool lo escribe bien. Lo que nadie verificaba es la otra mitad: que poner
 * `hidden` realmente apague el nodo.
 *
 * ## Por qué `hidden` puede no apagar nada
 *
 * `[hidden] { display: none }` no es una regla de esta hoja: vive en la hoja del
 * NAVEGADOR. Y una declaración de autor le gana a una del navegador por ORIGEN,
 * sin que la especificidad intervenga. Así que cualquier clase de la librería que
 * declare `display` deja a `hidden` sin efecto sobre los nodos que la llevan, en
 * silencio y solo en un navegador de verdad.
 *
 * Eso es lo que reproducen estos tests: no que el pool se olvide de esconder algo
 * —no se olvida— sino que esconderlo no alcance.
 *
 * ## Por qué el predicado se calcula contra el archivo `.css`
 *
 * `happy-dom` resuelve `getComputedStyle` contra las hojas del documento, pero no
 * modela la precedencia por origen: no trae la regla `[hidden]` del navegador, y
 * si se la inyecta a mano le gana a todo. Los dos errores van en direcciones
 * opuestas, así que ninguno sirve de testigo.
 *
 * La salida es no preguntarle al entorno y modelar las dos únicas reglas de
 * cascada que importan acá, leyendo la hoja como archivo igual que hace
 * `cell-layout.test.ts`:
 *
 * 1. Un nodo con `hidden` se sigue pintando si alguna regla de la hoja le declara
 *    `display`.
 * 2. Salvo que una regla de la hoja restituya `display: none !important`, que es
 *    lo único que le vuelve a ganar a una declaración normal de autor.
 *
 * Es el mismo resultado en `happy-dom` y en Chrome, y no depende de que el
 * entorno de tests calcule layout.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { measureDomWrites } from './dom-recorder'
import { createPoolFixture, mountTable } from './harness'
import type { DemoRow, GridRow, TableHarness } from './harness'
import { useRowGrouping } from '../composables/useRowGrouping'
import type { CellOption, DataTableColumn, FlatRow } from '../types'

/* ------------------------------------------- Qué significa "se ve" de verdad */

const STYLESHEET_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'styles',
  'datatable.css',
)

/** La hoja de estilos sin comentarios, que explican reglas que ya no existen. */
const STYLESHEET = readFileSync(STYLESHEET_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Una regla de la hoja que declara `display`, con lo que hace falta para ordenarla. */
interface DisplayRule {
  /** Selector individual, ya separado de su lista. */
  selector: string
  /** Valor declarado, en minúsculas y sin `!important`. */
  value: string
  /** Si la declaración lleva `!important`. */
  important: boolean
}

/**
 * Todas las declaraciones de `display` de la hoja, una entrada por selector.
 *
 * El recorrido salta los preludios de `@media` solo, sin caso especial: la
 * expresión no admite llaves adentro del cuerpo, así que un preludio de at-rule
 * nunca cierra y las reglas anidadas se encuentran por su cuenta.
 */
const DISPLAY_RULES: readonly DisplayRule[] = (() => {
  const rules: DisplayRule[] = []
  const blocks = /([^{}]+)\{([^{}]*)\}/g
  let block = blocks.exec(STYLESHEET)

  while (block !== null) {
    const prelude = (block[1] ?? '').trim()
    const body = block[2] ?? ''
    block = blocks.exec(STYLESHEET)

    if (prelude.startsWith('@')) continue

    const declaration = /(?:^|;)\s*display\s*:\s*([^;!]+)(!important)?/i.exec(body)
    if (declaration === null) continue

    const value = (declaration[1] ?? '').trim().toLowerCase()
    const important = declaration[2] !== undefined
    for (const selector of prelude.split(',')) {
      const trimmed = selector.trim()
      if (trimmed !== '') rules.push({ selector: trimmed, value, important })
    }
  }

  return rules
})()

/**
 * Si un nodo se pinta, con la cascada real del navegador.
 *
 * Sin `hidden` siempre se pinta —ninguna regla de la hoja apaga nada por su
 * cuenta—. Con `hidden` puesto, decide la cascada: gana el `display: none
 * !important` de la hoja si lo hay, después cualquier `display` de autor, y solo
 * si no hay ninguno queda en pie la regla del navegador.
 */
function isRendered(node: HTMLElement): boolean {
  if (!node.hidden) return true

  const restored = DISPLAY_RULES.some(
    (rule) => rule.important && rule.value === 'none' && node.matches(rule.selector),
  )
  if (restored) return false

  return DISPLAY_RULES.some((rule) => !rule.important && node.matches(rule.selector))
}

/* ------------------------------------------------------- El barrido completo */

/** Un nodo de fila que muestra las dos estructuras a la vez. */
interface Offender {
  rowKey: string
  rowClass: string
  headerText: string
  cellText: string[]
}

/**
 * Nodos de fila que muestran cabecera de grupo Y celdas de datos al mismo tiempo.
 *
 * Barre TODOS los nodos del pool, no los que se sospechan: el modo de falla es
 * que un slot cualquiera quede con las dos estructuras encendidas, y cuál es ese
 * slot cambia en cada pintado porque el pool rota.
 */
function overlappingRows(canvas: HTMLElement): Offender[] {
  const offenders: Offender[] = []

  for (const node of canvas.querySelectorAll('.dt-row')) {
    if (!(node instanceof HTMLElement)) continue
    if (!isRendered(node)) continue

    const header = node.querySelector('.dt-group-header')
    const headerShown = header instanceof HTMLElement && isRendered(header)

    const cells: HTMLElement[] = []
    for (const cell of node.querySelectorAll('.dt-cell')) {
      if (cell instanceof HTMLElement && isRendered(cell)) cells.push(cell)
    }

    if (!headerShown || cells.length === 0) continue

    offenders.push({
      rowKey: node.dataset.rowKey ?? '(sin clave)',
      rowClass: node.className,
      headerText: header instanceof HTMLElement ? (header.textContent ?? '') : '',
      cellText: cells.map((cell) => cell.textContent ?? ''),
    })
  }

  return offenders
}

/** Celdas de datos que se pintan sobre una cabecera de grupo. */
function cellsOnGroupRows(canvas: HTMLElement): Offender[] {
  const offenders: Offender[] = []

  for (const node of canvas.querySelectorAll('.dt-row.dt-group-row')) {
    if (!(node instanceof HTMLElement)) continue
    if (!isRendered(node)) continue

    const cells: HTMLElement[] = []
    for (const cell of node.querySelectorAll('.dt-cell')) {
      if (cell instanceof HTMLElement && isRendered(cell)) cells.push(cell)
    }
    if (cells.length === 0) continue

    const header = node.querySelector('.dt-group-header')
    offenders.push({
      rowKey: node.dataset.rowKey ?? '(sin clave)',
      rowClass: node.className,
      headerText: header instanceof HTMLElement ? (header.textContent ?? '') : '',
      cellText: cells.map((cell) => cell.textContent ?? ''),
    })
  }

  return offenders
}

/** Texto legible de los infractores, para que el fallo diga qué se vio montado. */
function describeOffenders(offenders: readonly Offender[]): string {
  if (offenders.length === 0) return 'sin filas montadas'
  return offenders
    .map(
      (entry) =>
        `[${entry.rowKey}] class="${entry.rowClass}" cabecera="${entry.headerText}" celdas=${JSON.stringify(entry.cellText)}`,
    )
    .join('\n')
}

/* --------------------------------------------------------- Datos del montaje */

const STATUS_OPTIONS: readonly CellOption[] = [
  { value: 'open', label: 'Abierto', color: 'var(--dt-color-blue)' },
  { value: 'blocked', label: 'Bloqueado', color: 'var(--dt-color-red)' },
  { value: 'done', label: 'Terminado', color: 'var(--dt-color-green)' },
]

const PRIORITY_OPTIONS: readonly CellOption[] = [
  { value: 'high', label: 'Alta', color: 'var(--dt-color-red)' },
  { value: 'low', label: 'Baja', color: 'var(--dt-color-neutral)' },
]

/**
 * Columnas con renderers de CAJA a propósito.
 *
 * `avatar`, `badge` y `progress` declaran el modo caja, y ese modo es el que
 * declara `display` sobre la celda. Una tabla de puras columnas de texto no
 * mostraría el defecto: `.dt-cell` no declara `display`, así que ahí `hidden`
 * alcanza. Es exactamente el patrón del reporte, donde solo se montaban las
 * columnas de avatar y de estado.
 */
const COLUMNS: readonly DataTableColumn<GridRow>[] = [
  { key: 'id', width: 90 },
  { key: 'owner', width: 110, renderer: 'avatar' },
  { key: 'status', width: 120, renderer: 'badge', options: STATUS_OPTIONS },
  { key: 'priority', width: 110, renderer: 'badge', options: PRIORITY_OPTIONS },
  { key: 'name', width: 160 },
]

/** Filas repartidas en tres estados y dos prioridades, en tamaños distintos. */
function projectRows(count: number): GridRow[] {
  const rows: GridRow[] = []
  for (let index = 0; index < count; index += 1) {
    // Tamaños de grupo DESIGUALES: colapsar uno u otro acorta el aplanado en
    // cantidades distintas, que es lo que mueve la base de la rotación.
    const status = index % 7 === 0 ? 'blocked' : index % 3 === 0 ? 'done' : 'open'
    rows.push({
      id: `PRJ-${String(index + 1).padStart(5, '0')}`,
      owner: { name: `Owner ${index}` },
      status,
      priority: index % 2 === 0 ? 'high' : 'low',
      name: `Project ${index}`,
    })
  }
  return rows
}

const VIEWPORT = { width: 700, height: 400 }

/** Monta la tabla agrupada por los niveles que se le pidan. */
async function mountGrouped(groupBy: string[], rowCount = 60): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: projectRows(rowCount),
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: 40,
      groupBy,
    },
  })
}

/** Invoca uno de los métodos de grupo que expone el componente. */
async function callGroupApi(
  harness: TableHarness,
  method: 'expandAllGroups' | 'collapseAllGroups',
): Promise<void> {
  const instance: unknown = harness.wrapper.vm
  if (typeof instance !== 'object' || instance === null || !(method in instance)) {
    throw new Error(`[test] el componente no expuso "${method}"`)
  }
  const fn: unknown = Reflect.get(instance, method)
  if (typeof fn !== 'function') throw new Error(`[test] "${method}" no es una función`)
  fn.call(instance)
  await harness.flush()
}

/** Clic sobre la n-ésima cabecera de grupo que se está pintando. */
async function clickGroupHeader(harness: TableHarness, position = 0): Promise<void> {
  const headers = [...harness.canvas.querySelectorAll('.dt-row.dt-group-row')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isRendered(node),
  )
  const target = headers[position]
  if (!target) throw new Error(`[test] no hay cabecera de grupo en la posición ${position}`)
  target.dispatchEvent(new Event('click', { bubbles: true }))
  await harness.flush()
}

/** Barre el pool entero y falla nombrando cada fila que quedó montada. */
function expectNoOverlap(harness: TableHarness, step: string): void {
  const offenders = overlappingRows(harness.canvas)
  expect(offenders, `${step}\n${describeOffenders(offenders)}`).toEqual([])
}

/* ------------------------------------------------------------------- Tests */

describe('stylesheet — hidden turns a node off, with no exceptions', () => {
  it('restores the browser rule with a declaration nothing in the sheet can outrank', () => {
    // Es UNA regla para todos los nodos que el componente apaga, no una excepción
    // por clase. La diferencia importa: auditar clase por clase deja el problema
    // abierto para la próxima que declare `display`.
    const guards = DISPLAY_RULES.filter(
      (rule) => rule.important && rule.value === 'none' && rule.selector.includes('[hidden]'),
    )

    expect(guards.length, 'la hoja no restituye el significado de `hidden`').toBeGreaterThan(0)
  })

  it('leaves no class inside the component able to ignore hidden', () => {
    // El barrido va al revés que el anterior: por cada clase que declara
    // `display`, se construye un nodo con esa clase y `hidden` puesto dentro del
    // subárbol del componente, y se pregunta si se pinta. No hay lista de clases
    // sospechosas que mantener: la lista sale de la hoja.
    const root = document.createElement('div')
    root.className = 'dt-root'
    document.body.appendChild(root)

    const offenders: string[] = []

    for (const rule of DISPLAY_RULES) {
      if (rule.important) continue
      // Solo las reglas de una clase simple se pueden montar sin inventar
      // contexto; las compuestas nunca son MENOS específicas que estas, así que
      // una regla que cubra a todas las simples las cubre también a ellas.
      const simple = /^\.([\w-]+)$/.exec(rule.selector)
      if (!simple) continue

      const node = document.createElement('div')
      node.className = simple[1] ?? ''
      node.hidden = true
      root.appendChild(node)
      if (isRendered(node)) offenders.push(rule.selector)
    }

    expect(offenders, `estas clases ignoran \`hidden\`: ${offenders.join(', ')}`).toEqual([])
    root.remove()
  })
})

describe('pool — a row node never shows both structures at once', () => {
  it('stays exclusive through collapse-all and expand-all, several times over', async () => {
    const harness = await mountGrouped(['status'])
    expectNoOverlap(harness, 'estado inicial')

    for (let round = 1; round <= 3; round += 1) {
      await callGroupApi(harness, 'collapseAllGroups')
      expectNoOverlap(harness, `colapsar todo, vuelta ${round}`)

      await callGroupApi(harness, 'expandAllGroups')
      expectNoOverlap(harness, `expandir todo, vuelta ${round}`)
    }

    harness.unmount()
  })

  it('never paints a data cell on a group row', async () => {
    // La otra mitad del mismo invariante, y la que se ve peor: una cabecera de
    // grupo con avatares y badges de la fila que ocupaba ese slot antes.
    const harness = await mountGrouped(['status'])

    await callGroupApi(harness, 'collapseAllGroups')
    const collapsed = cellsOnGroupRows(harness.canvas)
    expect(collapsed, `colapsar todo\n${describeOffenders(collapsed)}`).toEqual([])

    await callGroupApi(harness, 'expandAllGroups')
    const expanded = cellsOnGroupRows(harness.canvas)
    expect(expanded, `expandir todo\n${describeOffenders(expanded)}`).toEqual([])

    harness.unmount()
  })

  it('stays exclusive toggling one group at a time, back and forth', async () => {
    const harness = await mountGrouped(['status'])

    for (let round = 1; round <= 6; round += 1) {
      await clickGroupHeader(harness, 0)
      expectNoOverlap(harness, `clic sobre la primera cabecera, vuelta ${round}`)
    }

    harness.unmount()
  })

  it('stays exclusive with multi-level grouping', async () => {
    const harness = await mountGrouped(['status', 'priority'])
    expectNoOverlap(harness, 'dos niveles, estado inicial')

    await callGroupApi(harness, 'collapseAllGroups')
    expectNoOverlap(harness, 'dos niveles, todo colapsado')

    await callGroupApi(harness, 'expandAllGroups')
    expectNoOverlap(harness, 'dos niveles, todo expandido')

    // Y plegando un nivel intermedio, que es donde el aplanado cambia de largo
    // sin que se muevan ni la primera ni la última posición visible.
    await clickGroupHeader(harness, 1)
    expectNoOverlap(harness, 'dos niveles, un grupo intermedio plegado')

    harness.unmount()
  })

  it('stays exclusive while scrolled into the middle', async () => {
    const harness = await mountGrouped(['status'], 120)
    await harness.scrollTo({ top: 40 * 40 })
    expectNoOverlap(harness, 'scrolleada al medio')

    await callGroupApi(harness, 'collapseAllGroups')
    expectNoOverlap(harness, 'scrolleada al medio, todo colapsado')

    await callGroupApi(harness, 'expandAllGroups')
    expectNoOverlap(harness, 'scrolleada al medio, todo expandido')

    harness.unmount()
  })

  it('stays exclusive when the toggled group is entirely ABOVE the window', async () => {
    const harness = await mountGrouped(['status'], 120)
    await harness.scrollTo({ top: 60 * 40 })
    expectNoOverlap(harness, 'scrolleada abajo del primer grupo')

    // Plegar un grupo que quedó arriba corre TODO lo que está debajo sin mover
    // ninguna posición visible: las diez filas de la ventana pasan a mostrar
    // otra cosa, y algunas cambian de tipo.
    await callGroupApi(harness, 'collapseAllGroups')
    expectNoOverlap(harness, 'grupo de arriba plegado')

    await callGroupApi(harness, 'expandAllGroups')
    expectNoOverlap(harness, 'grupo de arriba vuelto a abrir')

    harness.unmount()
  })

  it('stays exclusive when the toggled group is entirely BELOW the window', async () => {
    const harness = await mountGrouped(['status'], 120)
    await harness.scrollTo({ top: 0 })

    const headers = [...harness.canvas.querySelectorAll('.dt-row.dt-group-row')].length
    expect(headers).toBeGreaterThan(0)

    // Plegar el último grupo no toca la ventana, pero sí acorta el aplanado: la
    // ventana siguiente se calcula contra un total distinto.
    await callGroupApi(harness, 'collapseAllGroups')
    await harness.scrollTo({ top: 0 })
    expectNoOverlap(harness, 'grupo de abajo plegado')

    harness.unmount()
  })

  it('stays exclusive when one slot crosses the boundary over and over', async () => {
    const harness = await mountGrouped(['status'], 120)

    // Un barrido fila por fila sobre la frontera de un grupo: el mismo slot pasa
    // de datos a cabecera y de vuelta en pasos consecutivos, que es el camino que
    // la rotación hace más probable y el que más veces ejercita el cambio de tipo.
    for (let step = 0; step <= 24; step += 1) {
      await harness.scrollTo({ top: step * 40 })
      expectNoOverlap(harness, `scroll paso a paso, fila ${step}`)
    }

    harness.unmount()
  })

  it('stays exclusive combining a toggle with a scroll in the same frame', async () => {
    const harness = await mountGrouped(['status'], 120)
    await harness.scrollTo({ top: 20 * 40 })

    for (let round = 1; round <= 4; round += 1) {
      await callGroupApi(harness, 'collapseAllGroups')
      await harness.scrollTo({ top: round * 40 })
      expectNoOverlap(harness, `colapsar y scrollear, vuelta ${round}`)

      await callGroupApi(harness, 'expandAllGroups')
      await harness.scrollTo({ top: round * 80 })
      expectNoOverlap(harness, `expandir y scrollear, vuelta ${round}`)
    }

    harness.unmount()
  })
})

/**
 * Una cabecera de grupo no lleva información salvo la que se le pida.
 *
 * Es la otra mitad del mismo reporte. Las celdas montadas encima eran un defecto;
 * los agregados NO lo son, pero se confunden con él porque aparecen en la misma
 * fila y en la posición de una columna. La diferencia es que un agregado se pinta
 * únicamente donde una columna declara `aggregate`, así que una tabla que no lo
 * declara tiene cabeceras con chevrón, etiqueta y contador, y nada más.
 */
describe('group rows carry no data — aggregates are opt-in', () => {
  /** Nodos de agregado que se están pintando en el canvas. */
  function renderedAggregates(canvas: HTMLElement): HTMLElement[] {
    const found: HTMLElement[] = []
    for (const node of canvas.querySelectorAll('.dt-group-aggregate')) {
      if (node instanceof HTMLElement && isRendered(node)) found.push(node)
    }
    return found
  }

  it('paints nothing but the chevron, the label and the count when no column asks', async () => {
    const harness = await mountGrouped(['status'])

    expect(renderedAggregates(harness.canvas)).toEqual([])

    const header = harness.canvas.querySelector('.dt-row.dt-group-row .dt-group-header')
    expect(header).not.toBeNull()
    if (header instanceof HTMLElement) {
      // La banda contiene una sola caja: la que se queda quieta con `sticky`.
      expect([...header.children].map((node) => node.className)).toEqual(['dt-group-header-inner'])
    }

    const inner = harness.canvas.querySelector('.dt-row.dt-group-row .dt-group-header-inner')
    expect(inner).not.toBeNull()
    if (inner instanceof HTMLElement) {
      const parts = [...inner.children].map((node) => node.className)
      expect(parts).toEqual(['dt-group-chevron', 'dt-group-label', 'dt-group-count'])
    }

    harness.unmount()
  })

  it('paints one figure per column that declares aggregate, and only those', async () => {
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows: projectRows(30),
        // Una sola de las cinco columnas lo declara.
        columns: COLUMNS.map((column) =>
          column.key === 'name' ? { ...column, aggregate: 'count' as const } : column,
        ),
        rowKey: 'id',
        rowHeight: 40,
        groupBy: ['status'],
      },
    })

    const headers = [...harness.canvas.querySelectorAll('.dt-row.dt-group-row')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && isRendered(node),
    )
    expect(headers.length).toBeGreaterThan(0)

    for (const header of headers) {
      const figures: HTMLElement[] = []
      for (const node of header.querySelectorAll('.dt-group-aggregate')) {
        if (node instanceof HTMLElement && isRendered(node)) figures.push(node)
      }
      expect(figures).toHaveLength(1)
    }

    harness.unmount()
  })
})

/**
 * El mismo peligro un eje más abajo.
 *
 * `ensureRenderer` es el hermano horizontal de `ensureRowKind`, pero no comparte
 * el defecto: su guarda incluye un testigo ESTRUCTURAL —`__dtHandle !== null`— y
 * no solo la etiqueta de tipo, y al cambiar de tipo destruye y vacía en lugar de
 * turnar con `hidden`. Donde sí conviven dos estados en un mismo nodo es un nivel
 * más abajo, dentro del renderer `tags`: las píldoras sobrantes se esconden. Ese
 * es el punto que compartía el defecto, porque `.dt-tag` declara `display`.
 */
describe('renderer axis — the same hazard one axis down', () => {
  it('stops painting the surplus pills when a recycled cell shows a shorter list', async () => {
    const rows: GridRow[] = []
    for (let index = 0; index < 40; index += 1) {
      rows.push({
        id: index,
        // La primera fila es la larga: su slot se recicla para filas cortas.
        tags: index === 0 ? ['open', 'blocked', 'done'] : ['open'],
      })
    }

    const harness = await mountTable({
      viewport: { width: 400, height: 400 },
      props: {
        rows,
        columns: [
          { key: 'id', width: 90 },
          { key: 'tags', width: 220, renderer: 'tags', options: STATUS_OPTIONS },
        ],
        rowKey: 'id',
        rowHeight: 40,
      },
    })

    await harness.scrollTo({ top: 20 * 40 })

    for (const node of harness.canvas.querySelectorAll('.dt-row')) {
      if (!(node instanceof HTMLElement) || !isRendered(node)) continue
      const key = node.dataset.rowKey ?? ''
      const expected = key === '0' ? 3 : 1

      const pills: string[] = []
      for (const pill of node.querySelectorAll('.dt-tag')) {
        if (pill instanceof HTMLElement && isRendered(pill)) pills.push(pill.textContent ?? '')
      }
      expect(pills, `fila ${key} pinta ${JSON.stringify(pills)}`).toHaveLength(expected)
    }

    harness.unmount()
  })

  it('leaves no trace of the previous structure when a slot swaps renderer type', async () => {
    const harness = await mountTable({
      viewport: { width: 400, height: 400 },
      props: {
        rows: [{ id: 0, status: 'blocked' }],
        columns: [{ key: 'status', width: 200, renderer: 'badge', options: STATUS_OPTIONS }],
        rowKey: 'id',
        rowHeight: 40,
      },
    })

    const cell = harness.canvas.querySelector('.dt-cell')
    expect(cell?.querySelector('.dt-badge')).not.toBeNull()

    await harness.wrapper.setProps({
      columns: [{ key: 'status', width: 200, renderer: 'text' }],
    })
    await harness.flush()

    // `ensureRenderer` vacía el nodo, así que acá no hay nada que `hidden` tenga
    // que apagar: la píldora ya no existe. Es lo que distingue a este eje del
    // vertical, donde las dos estructuras conviven a propósito.
    expect(harness.canvas.querySelector('.dt-badge')).toBeNull()
    expect(cell?.textContent).toBe('blocked')

    harness.unmount()
  })
})

/**
 * Lo que un nodo retirado deja de afirmar.
 *
 * `retireRow` no limpia `__dtRowKind` ni `__dtGroupId`, y eso es correcto: el
 * tipo describe con qué estructura está CONSTRUIDO el nodo, no qué está
 * mostrando, y volver a marcarlo como fila de datos obligaría a un cambio de tipo
 * en cada regreso. Lo que sí borra —y es lo único que hace falta— es la
 * IDENTIDAD: sin índice de fila, el nodo ya no responde por nada.
 *
 * Estos tests fijan esa división, que hasta ahora estaba implícita.
 */
describe('retireRow — a retired node stops answering for what it showed', () => {
  const columns: readonly DataTableColumn<DemoRow>[] = [{ key: 'name' }, { key: 'amount' }]

  /** Dos filas en un solo grupo: el aplanado mide 3 y la ventana pide 8. */
  function tinyGroupedView(): readonly FlatRow<DemoRow>[] {
    const rows: DemoRow[] = [0, 1].map((index) => ({
      id: index,
      name: `Row ${index}`,
      amount: index * 100,
      status: 'open',
      progress: 0,
      done: false,
      tags: [],
      owner: { name: `Owner ${index}` },
      choice: 'open',
    }))
    const grouping = useRowGrouping<DemoRow>({
      rows: () => rows,
      columns: () => [{ key: 'name' }, { key: 'amount' }, { key: 'status' }],
      groupBy: () => ['status'],
      expandedGroups: () => undefined,
      defaultExpanded: () => true,
    })
    const flat = grouping.flatRows.value
    if (flat === null) throw new Error('[test] se esperaba una vista agrupada')
    return flat
  }

  it('neither toggles a group nor reports a row click after being retired', () => {
    const toggled: string[] = []
    const clicked: number[] = []
    const flatRows = tinyGroupedView()
    const fixture = createPoolFixture({
      flatRows,
      groupDepth: 1,
      columns,
      visibleRows: 8,
      callbacks: {
        onGroupToggle: (groupId) => toggled.push(groupId),
        onRowClick: (rowIndex) => clicked.push(rowIndex),
      },
    })

    // La ventana pide ocho posiciones y el aplanado tiene tres: las otras cinco
    // se retiran. El slot 0 mostró la cabecera, así que conserva `__dtGroupId`.
    fixture.paint({ start: 0, end: 8 })
    const headerNode = fixture.rowNodes()[0]
    expect(headerNode?.classList.contains('dt-group-row')).toBe(true)

    // Se corre la ventana para que ese mismo slot quede fuera del aplanado.
    fixture.paint({ start: 8, end: 16 })
    expect(headerNode?.hidden).toBe(true)

    headerNode?.dispatchEvent(new Event('click', { bubbles: true }))

    // Sigue teniendo la estructura de cabecera y su id, pero ya no representa
    // ninguna posición: un evento sobre él no puede plegar el grupo que mostraba.
    expect(toggled).toEqual([])
    expect(clicked).toEqual([])
    fixture.destroy()
  })

  it('rewrites its identity when it comes back, instead of trusting the stale one', () => {
    const flatRows = tinyGroupedView()
    const fixture = createPoolFixture({
      flatRows,
      groupDepth: 1,
      columns,
      visibleRows: 8,
    })

    fixture.paint({ start: 0, end: 8 })
    const slotZero = fixture.rowNodes()[0]
    const keyAsGroup = slotZero?.dataset.rowKey

    fixture.paint({ start: 8, end: 16 })
    fixture.paint({ start: 0, end: 8 })

    // Vuelve a la misma posición visible con el mismo contenido, y la clave se
    // reescribe igual: la comparación de identidad la hace contra el centinela,
    // no contra el índice que tenía antes de retirarse.
    expect(slotZero?.dataset.rowKey).toBe(keyAsGroup)
    expect(slotZero?.hidden).toBe(false)
    fixture.destroy()
  })
})

/* --------------------------------------------------------- Presupuesto */

/**
 * El arreglo no puede costar escrituras.
 *
 * Lo que estaba roto era el SIGNIFICADO de `hidden`, no quién lo escribe: el pool
 * ya escribía exactamente las que hacían falta. Restituir ese significado no
 * agrega ni una escritura por frame, y estos números son los mismos que
 * `pool.perf.test.ts` afirma desde antes del arreglo.
 */
describe('grouping cost — restoring hidden adds no per-frame writes', () => {
  const columns: readonly DataTableColumn<DemoRow>[] = [
    { key: 'name' },
    { key: 'id' },
    { key: 'amount' },
  ]

  const ROWS: readonly DemoRow[] = (() => {
    const rows: DemoRow[] = []
    for (let index = 0; index < 200; index += 1) {
      rows.push({
        id: index,
        name: `Row ${index}`,
        amount: index * 100,
        status: index < 100 ? 'open' : 'done',
        progress: index % 101,
        done: false,
        tags: [],
        owner: { name: `Owner ${index}` },
        choice: 'open',
      })
    }
    return rows
  })()

  function groupedView(): readonly FlatRow<DemoRow>[] {
    const grouping = useRowGrouping<DemoRow>({
      rows: () => ROWS,
      columns: () => [{ key: 'name' }, { key: 'id' }, { key: 'amount' }, { key: 'status' }],
      groupBy: () => ['status'],
      expandedGroups: () => undefined,
      defaultExpanded: () => true,
    })
    const flat = grouping.flatRows.value
    if (flat === null) throw new Error('[test] se esperaba una vista agrupada')
    return flat
  }

  it('a slot crossing a group boundary still costs exactly thirteen writes', () => {
    const fixture = createPoolFixture({
      rows: ROWS,
      flatRows: groupedView(),
      groupDepth: 1,
      columns,
      visibleRows: 10,
    })

    // La cabecera de `done` está en la posición 101: con la ventana 92..102 el
    // slot que la recibe venía mostrando una fila de datos.
    fixture.paint({ start: 91, end: 101 })
    fixture.paint({ start: 91, end: 101 })
    fixture.paint({ start: 92, end: 102 })
    fixture.paint({ start: 91, end: 101 })

    const measured = measureDomWrites(fixture.container, () =>
      fixture.paint({ start: 92, end: 102 }),
    )

    // Tres celdas que se esconden, la cabecera que se muestra, su posición, su
    // clave, su `aria-rowindex` y los cinco atributos y clases del árbol.
    expect(measured.counts.total, measured.report).toBe(13)
    expect(measured.counts.hidden, measured.report).toBe(4)
    expect(measured.counts.createNode, measured.report).toBe(0)
    expect(measured.counts.removeNode, measured.report).toBe(0)
    fixture.destroy()
  })

  it('a redundant repaint with a header on screen still writes nothing', () => {
    const fixture = createPoolFixture({
      rows: ROWS,
      flatRows: groupedView(),
      groupDepth: 1,
      columns,
      visibleRows: 10,
    })
    fixture.paint({ start: 0, end: 10 })
    fixture.paint({ start: 0, end: 10 })

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 0, end: 10 }))

    expect(measured.counts.total, measured.report).toBe(0)
    fixture.destroy()
  })
})
