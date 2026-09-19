/**
 * Modo de maquetado de la celda: texto centrado por altura de línea contra caja
 * centrada por flex.
 *
 * ## Qué se puede verificar aquí y qué no
 *
 * `happy-dom` no calcula layout ni resuelve la cascada de una hoja de estilos
 * externa: `getComputedStyle` sobre una celda devuelve valores vacíos aunque el
 * `<style>` esté en el documento. Así que ningún test de este archivo —ni de
 * ningún otro— puede afirmar que un badge quedó centrado en píxeles. **Eso lo
 * tiene que mirar una persona en un navegador.**
 *
 * Lo que sí se puede verificar, y es lo que se verifica, son las dos mitades del
 * contrato que producen ese centrado:
 *
 * 1. **El estado que escribe el pool**: qué clase lleva cada celda, cuándo se
 *    escribe y —sobre todo— cuándo NO. Un badge centrado que costara una
 *    escritura por frame sería una regresión, no un arreglo.
 * 2. **Lo que esa clase significa en la hoja de estilos**: que exista la regla
 *    que traduce la alineación a `justify-content`, y que la celda de texto
 *    conserve intacto su recorte con puntos suspensivos. Se leen del archivo
 *    `.css` porque es el único lugar donde esa verdad vive.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countMatching, measureDomWrites } from './dom-recorder'
import { createPoolFixture, DEMO_OPTIONS, makeRows, resolveColumns } from './harness'
import type { DemoRow } from './harness'
import {
  avatarRenderer,
  badgeRenderer,
  checkboxRenderer,
  numberRenderer,
  progressRenderer,
  selectRenderer,
  tagsRenderer,
  textRenderer,
} from '../internal/renderers'
import type { AnyCellRenderer } from '../internal/renderers'
import type { CellAlign, CellPosition, DataTableColumn } from '../types'

/** La clase que el pool escribe sobre una celda en modo caja. */
const BOX_CLASS = 'dt-cell--box'

/**
 * Cómo se ve una escritura de esa clase en el registro de la grabadora.
 *
 * Incluye deliberadamente el nombre del método: la grabadora describe cada nodo
 * con su lista de clases, así que buscar solo `dt-cell--box` contaría también
 * cualquier otra escritura sobre una celda que YA está en modo caja —su
 * `transform`, su texto— y el test diría que hubo escrituras de maquetado donde
 * no las hubo.
 */
const BOX_CLASS_WRITE = `classList.toggle(${BOX_CLASS}`

/**
 * Una columna por renderer incluido, apuntando a la propiedad de {@link DemoRow}
 * cuya forma le corresponde.
 */
const COLUMNS_BY_RENDERER: readonly DataTableColumn<DemoRow>[] = [
  { key: 'name', renderer: 'text' },
  { key: 'amount', renderer: 'number' },
  { key: 'status', renderer: 'badge', options: DEMO_OPTIONS },
  { key: 'choice', renderer: 'select', options: DEMO_OPTIONS },
  { key: 'progress', renderer: 'progress' },
  { key: 'owner', renderer: 'avatar' },
  { key: 'done', renderer: 'checkbox', editable: true },
  { key: 'tags', renderer: 'tags', options: DEMO_OPTIONS },
]

/** Los renderers que se centran con flex, con su instancia y su nombre. */
const BOX_RENDERERS: readonly [string, AnyCellRenderer][] = [
  ['badge', badgeRenderer],
  ['select', selectRenderer],
  ['progress', progressRenderer],
  ['avatar', avatarRenderer],
  ['checkbox', checkboxRenderer],
  ['tags', tagsRenderer],
]

describe('renderer metadata — who declares the box layout', () => {
  for (const [name, renderer] of BOX_RENDERERS) {
    it(`renderer "${name}" declares the box layout`, () => {
      expect(renderer.layout).toBe('box')
    })
  }

  it('text and number declare no layout, so they keep the line-height centring', () => {
    // Ausente y no `'text'` explícito: es lo que garantiza que un renderer
    // propio escrito antes de que este eje existiera siga comportándose igual.
    expect(textRenderer.layout).toBeUndefined()
    expect(numberRenderer.layout).toBeUndefined()
  })
})

describe('layout class — the pool applies what the renderer declares', () => {
  it('marks every box renderer and leaves text and number untouched', () => {
    const fixture = createPoolFixture({ columns: [...COLUMNS_BY_RENDERER], visibleRows: 3 })
    fixture.paint()

    const cells = fixture.cellNodes(0)
    expect(cells).toHaveLength(COLUMNS_BY_RENDERER.length)

    for (let index = 0; index < COLUMNS_BY_RENDERER.length; index += 1) {
      const column = COLUMNS_BY_RENDERER[index]
      const cell = cells[index]
      const rendererName = String(column?.renderer)
      const expected = rendererName !== 'text' && rendererName !== 'number'

      expect(cell?.classList.contains(BOX_CLASS), `renderer "${rendererName}"`).toBe(expected)
    }

    fixture.destroy()
  })

  it('treats a custom renderer that declares no layout as text', () => {
    // El campo es opcional a propósito: agregarlo no puede cambiar el
    // comportamiento de un renderer que ya existía.
    const custom: DataTableColumn<DemoRow> = {
      key: 'name',
      renderer: {
        type: 'custom-without-layout',
        create: (cell) => ({ root: cell }),
        update: () => {},
      },
    }
    const fixture = createPoolFixture({ columns: [custom], visibleRows: 1 })
    fixture.paint()

    expect(fixture.cellNodes(0)[0]?.classList.contains(BOX_CLASS)).toBe(false)
    fixture.destroy()
  })

  it('keeps the class while the cell scrolls through rows of the same column', () => {
    const fixture = createPoolFixture({
      rows: makeRows(200),
      columns: [{ key: 'status', renderer: 'badge', options: DEMO_OPTIONS }],
      visibleRows: 10,
    })
    fixture.paint()
    for (let step = 1; step <= 20; step += 1) fixture.paint({ start: step })

    for (const row of fixture.rowNodes()) {
      for (const cell of row.querySelectorAll('.dt-cell')) {
        expect(cell.classList.contains(BOX_CLASS)).toBe(true)
      }
    }

    fixture.destroy()
  })
})

describe('layout class — written on a renderer change, never per frame', () => {
  it('a scroll step over a window of badge cells writes the class zero times', () => {
    const fixture = createPoolFixture({
      rows: makeRows(200),
      columns: [{ key: 'status', renderer: 'badge', options: DEMO_OPTIONS }],
      visibleRows: 10,
    })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 1 }))

    expect(countMatching(measured.entries, BOX_CLASS_WRITE), measured.report).toBe(0)
    // Y ninguna clase en absoluto: la fila que entra reescribe su contenido y su
    // identidad, no su maquetado.
    expect(measured.counts.classList, measured.report).toBe(0)
    fixture.destroy()
  })

  it('twenty scroll steps still write the class zero times', () => {
    const fixture = createPoolFixture({
      rows: makeRows(200),
      columns: [
        { key: 'status', renderer: 'badge', options: DEMO_OPTIONS },
        { key: 'owner', renderer: 'avatar' },
        { key: 'name' },
      ],
      visibleRows: 10,
    })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => {
      for (let step = 1; step <= 20; step += 1) fixture.paint({ start: step })
    })

    expect(countMatching(measured.entries, BOX_CLASS_WRITE), measured.report).toBe(0)
    fixture.destroy()
  })

  it('a redundant repaint of a box cell writes nothing at all', () => {
    const fixture = createPoolFixture({ columns: [...COLUMNS_BY_RENDERER], visibleRows: 12 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint())

    expect(measured.counts.total, measured.report).toBe(0)
    fixture.destroy()
  })
})

describe('layout class — a recycled slot follows the renderer it receives', () => {
  const asText = resolveColumns([{ key: 'name', renderer: 'text' }])
  const asBadge = resolveColumns([{ key: 'status', renderer: 'badge', options: DEMO_OPTIONS }])

  it('text -> badge -> text ends up in the right state each time', () => {
    const fixture = createPoolFixture({ rows: makeRows(10), visibleRows: 1 })

    fixture.paint({ columns: asText })
    const cell = fixture.cellNodes(0)[0]
    expect(cell).toBeDefined()
    expect(cell?.classList.contains(BOX_CLASS)).toBe(false)

    fixture.paint({ columns: asBadge })
    // El mismo nodo: el slot se recicla, no se recrea. Si se recreara, este test
    // pasaría por el motivo equivocado.
    expect(fixture.cellNodes(0)[0]).toBe(cell)
    expect(cell?.classList.contains(BOX_CLASS)).toBe(true)

    fixture.paint({ columns: asText })
    expect(fixture.cellNodes(0)[0]).toBe(cell)
    expect(cell?.classList.contains(BOX_CLASS)).toBe(false)

    fixture.destroy()
  })

  it('writes the class exactly once per swap, in each direction', () => {
    const fixture = createPoolFixture({ rows: makeRows(10), visibleRows: 1 })
    fixture.paint({ columns: asText })

    const toBox = measureDomWrites(fixture.container, () => fixture.paint({ columns: asBadge }))
    expect(countMatching(toBox.entries, BOX_CLASS_WRITE), toBox.report).toBe(1)

    const backToText = measureDomWrites(fixture.container, () => fixture.paint({ columns: asText }))
    expect(countMatching(backToText.entries, BOX_CLASS_WRITE), backToText.report).toBe(1)

    fixture.destroy()
  })

  it('does not rewrite the class when the renderer type stays the same', () => {
    // Dos columnas distintas con el MISMO renderer: el slot cambia de columna y
    // de valor, pero no de forma, así que el maquetado no se toca.
    const firstBadge = resolveColumns([{ key: 'status', renderer: 'badge', options: DEMO_OPTIONS }])
    const secondBadge = resolveColumns([
      { key: 'choice', renderer: 'badge', options: DEMO_OPTIONS },
    ])

    const fixture = createPoolFixture({ rows: makeRows(10), visibleRows: 1 })
    fixture.paint({ columns: firstBadge })
    fixture.paint({ columns: firstBadge })

    const measured = measureDomWrites(fixture.container, () =>
      fixture.paint({ columns: secondBadge }),
    )

    expect(countMatching(measured.entries, BOX_CLASS_WRITE), measured.report).toBe(0)
    expect(fixture.cellNodes(0)[0]?.classList.contains(BOX_CLASS)).toBe(true)
    fixture.destroy()
  })
})

/**
 * La alineación horizontal significa lo mismo en los dos modos.
 *
 * El pool escribe UNA sola cosa —el valor de `align`, traducido a las mismas dos
 * clases— y es la hoja de estilos la que lo resuelve con `text-align` o con
 * `justify-content` según el modo. Estos tests verifican esa mitad: que el estado
 * escrito sea idéntico. La otra mitad, que las dos reglas existan y digan lo
 * mismo, la verifica el bloque de la hoja de estilos más abajo.
 */
describe('alignment — the same three states in both layout modes', () => {
  const ALIGNMENTS: readonly [CellAlign, readonly string[]][] = [
    ['left', []],
    ['center', ['dt-cell--center']],
    ['right', ['dt-cell--right']],
  ]

  /** Clases de alineación presentes en una celda, en orden estable. */
  function alignmentTokens(cell: HTMLElement | undefined): string[] {
    return ['dt-cell--center', 'dt-cell--right'].filter((token) => cell?.classList.contains(token))
  }

  /** Pinta una celda con un renderer y una alineación, y la devuelve. */
  function paintAligned(renderer: string, align: CellAlign): HTMLElement | undefined {
    const fixture = createPoolFixture({
      rows: makeRows(4),
      columns: [{ key: 'status', renderer, align, options: DEMO_OPTIONS }],
      visibleRows: 1,
    })
    fixture.paint()
    const cell = fixture.cellNodes(0)[0]
    fixture.destroy()
    return cell
  }

  for (const [align, expected] of ALIGNMENTS) {
    it(`align "${align}" writes the same classes for a text cell and a box cell`, () => {
      const textCell = paintAligned('text', align)
      const boxCell = paintAligned('badge', align)

      expect(alignmentTokens(textCell)).toEqual([...expected])
      expect(alignmentTokens(boxCell)).toEqual([...expected])
      // Lo que importa no es solo que cada uno acierte, sino que acierten con el
      // MISMO estado: es lo que vuelve imposible que los dos modos diverjan.
      expect(alignmentTokens(boxCell)).toEqual(alignmentTokens(textCell))

      expect(textCell?.classList.contains(BOX_CLASS)).toBe(false)
      expect(boxCell?.classList.contains(BOX_CLASS)).toBe(true)
    })
  }

  it('gives a checkbox column the centred state it declares by default', () => {
    // `defaultAlign` y `layout` son ejes independientes y aquí conviven: la
    // casilla se centra horizontalmente por su alineación y verticalmente por su
    // modo de maquetado.
    const fixture = createPoolFixture({
      rows: makeRows(4),
      columns: [{ key: 'done', renderer: 'checkbox', editable: true }],
      visibleRows: 1,
    })
    fixture.paint()

    const cell = fixture.cellNodes(0)[0]
    expect(cell?.classList.contains('dt-cell--center')).toBe(true)
    expect(cell?.classList.contains(BOX_CLASS)).toBe(true)
    fixture.destroy()
  })
})

describe('box cells keep taking events through the single delegated listener', () => {
  it('a checkbox inside a box cell still reports its toggle intent', () => {
    const toggles: { position: CellPosition; next: boolean }[] = []
    const fixture = createPoolFixture({
      rows: makeRows(4),
      columns: [{ key: 'done', renderer: 'checkbox', editable: true }],
      visibleRows: 2,
      callbacks: {
        onCellToggle: (position, next) => toggles.push({ position, next }),
      },
    })
    fixture.paint()

    const input = fixture.cellNodes(1)[0]?.querySelector('.dt-checkbox')
    expect(input).toBeInstanceOf(HTMLInputElement)
    if (!(input instanceof HTMLInputElement)) return

    // La fila 1 arranca destildada (`index % 2 === 0` es falso): el clic pide
    // tildarla.
    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(toggles).toHaveLength(1)
    expect(toggles[0]?.position).toEqual({ rowIndex: 1, columnKey: 'done' })
    expect(toggles[0]?.next).toBe(true)
    // El pool revierte el estado visual: el DOM lo gobierna el dato, no el clic.
    expect(input.checked).toBe(false)

    fixture.destroy()
  })
})

/* ------------------------------------------- Contrato de la hoja de estilos */

/**
 * La hoja de estilos, leída como archivo y sin sus comentarios.
 *
 * Se abre con `node:fs` y no con un `import ... from '...css?raw'` porque Vitest
 * no procesa CSS —`test.css` viene apagado— y ese import devuelve un string
 * vacío: el test pasaría en verde sin haber leído nada. Las firmas de `node:fs`,
 * `node:path` y `node:url` las declara `node-fs.d.ts` aquí al lado, para no meter
 * `@types/node` en el proyecto de tests; el archivo explica por qué.
 *
 * Los comentarios se quitan porque explican reglas y mencionan propiedades que
 * justamente YA NO se declaran; dejarlos adentro haría que la búsqueda de
 * `vertical-align` encontrara la explicación de por qué desapareció.
 *
 * La ruta se arma con `dirname` y `join` en lugar del `new URL('...',
 * import.meta.url)` de siempre: Vite reconoce ese patrón y lo reescribe a una
 * URL de asset del servidor de desarrollo, que después no es un `file:`.
 */
const STYLESHEET_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'styles',
  'datatable.css',
)

const STYLESHEET = readFileSync(STYLESHEET_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Colapsa espacios para poder comparar sin depender del formateo. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cuerpo de la regla cuyo selector coincide exactamente, o `null`. */
function ruleBody(selector: string): string | null {
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  const target = normalize(selector)
  let match = pattern.exec(STYLESHEET)
  while (match !== null) {
    if (normalize(match[1] ?? '') === target) return match[2] ?? ''
    match = pattern.exec(STYLESHEET)
  }
  return null
}

/** Declaraciones de una regla, ya normalizadas a `propiedad: valor`. */
function declarationsOf(selector: string): string[] {
  const body = ruleBody(selector)
  if (body === null) {
    throw new Error(`[test] la hoja de estilos no declara la regla "${selector}"`)
  }
  return body
    .split(';')
    .map(normalize)
    .filter((declaration) => declaration !== '')
}

describe('stylesheet — what the classes the pool writes actually mean', () => {
  it('centres a box cell with flex and undoes the inherited line height', () => {
    expect(declarationsOf(`.${BOX_CLASS}`)).toEqual([
      'display: flex',
      'align-items: center',
      'line-height: normal',
    ])
  })

  it('translates the three alignments to justify-content in box mode', () => {
    expect(declarationsOf(`.${BOX_CLASS}.dt-cell--center`)).toEqual(['justify-content: center'])
    expect(declarationsOf(`.${BOX_CLASS}.dt-cell--right`)).toEqual(['justify-content: flex-end'])
    // `left` no lleva clase y no necesita regla: `flex-start` ya es el valor
    // inicial de `justify-content`.
    expect(ruleBody(`.${BOX_CLASS}.dt-cell--left`)).toBeNull()
  })

  it('keeps the very same two classes driving the text mode', () => {
    expect(declarationsOf('.dt-cell--center')).toEqual(['text-align: center'])
    expect(declarationsOf('.dt-cell--right')).toEqual(['text-align: right'])
  })

  it('leaves the truncation of a text cell exactly as it was', () => {
    // Es la razón por la que `.dt-cell` se centra con `line-height` y no con
    // flex: romper esto sería un bug peor que el que se estaba arreglando.
    const declarations = declarationsOf('.dt-cell')

    // `--dt-row-h` y no `--dt-row-height`: el alto que hereda de SU fila, que
    // con alturas variables no es el de todas. El centrado por altura de línea
    // —que es lo que este test protege— no cambió.
    expect(declarations).toContain('line-height: var(--dt-row-h)')
    expect(declarations).toContain('white-space: nowrap')
    expect(declarations).toContain('text-overflow: ellipsis')
    expect(declarations).toContain('overflow: hidden')
    // Y `.dt-cell` sigue sin declarar `display`: el flex llega SOLO con la clase
    // de modo caja. Si estuviera aquí, el texto anónimo dejaría de recortarse.
    expect(declarations.filter((entry) => entry.startsWith('display:'))).toEqual([])
  })

  it('no longer compensates with vertical-align in any renderer class', () => {
    const selectors = [
      '.dt-badge, .dt-tag',
      '.dt-select-chevron',
      '.dt-progress',
      '.dt-progress-ring',
      '.dt-progress-label',
      '.dt-avatar',
      '.dt-avatar-initials',
      '.dt-checkbox',
      '.dt-tags',
    ]

    for (const selector of selectors) {
      const offenders = declarationsOf(selector).filter((entry) =>
        entry.startsWith('vertical-align'),
      )
      expect(offenders, selector).toEqual([])
    }
  })

  it('centres the tag pills inside their own flex box, not against a line', () => {
    // Era el peor caso: la lista heredaba la altura de línea de la fila y el
    // desfase se aplicaba dos veces.
    const declarations = declarationsOf('.dt-tags')

    expect(declarations).toContain('display: flex')
    expect(declarations).toContain('align-items: center')
  })

  it('centres the progress ring against its label with flex too', () => {
    const declarations = declarationsOf('.dt-progress')

    expect(declarations).toContain('display: inline-flex')
    expect(declarations).toContain('align-items: center')
    // El `line-height: 1` existía para que la línea de la etiqueta no inflara la
    // caja por encima del anillo. Con flex el alto es el del hijo más alto.
    expect(declarations.filter((entry) => entry.startsWith('line-height'))).toEqual([])
  })

  it('derives every box height from --dt-row-height, so dense centres too', () => {
    // `dense` solo cambia `--dt-row-height`. Mientras las alturas salgan de ahí
    // y el centrado sea `align-items: center`, no hace falta ninguna regla extra
    // para el preset compacto.
    const heights: readonly [string, string][] = [
      ['.dt-badge, .dt-tag', 'height: calc(var(--dt-row-height) - 14px)'],
      ['.dt-progress-ring', 'height: calc(var(--dt-row-height) - 18px)'],
      ['.dt-avatar', 'height: calc(var(--dt-row-height) - 16px)'],
    ]

    for (const [selector, declaration] of heights) {
      expect(declarationsOf(selector), selector).toContain(declaration)
    }
    // Y la celda en modo caja no fija ninguna altura propia: la suya sigue
    // saliendo de `.dt-cell`.
    expect(declarationsOf(`.${BOX_CLASS}`).filter((entry) => entry.startsWith('height'))).toEqual(
      [],
    )
  })
})
