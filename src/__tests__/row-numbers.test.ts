/**
 * Regleta de numeración y redondeo de la caja exterior.
 *
 * ## Qué protege este archivo
 *
 * La numeración **no es una columna**, y esa es toda la tesis. Si lo fuera
 * habría que excluirla a mano de la selección, del copiado, del reordenamiento,
 * del selector de columnas, de la navegación y del `aria-colcount`, y cada una
 * de esas exclusiones sería una oportunidad de olvidarse de una. Como carril
 * aparte no participa de nada de eso por construcción, y los tests de acá abajo
 * verifican justamente eso: que lo que se agregó a la izquierda no se metió en
 * ninguno de los otros sistemas.
 *
 * Lo único que la regleta sí toca es la GEOMETRÍA: reserva espacio antes de la
 * primera columna. Ese corrimiento entra una sola vez, en el layout, y de ahí se
 * propaga a todas las coordenadas horizontales; los tests miden que así sea.
 *
 * El resto de la suite monta sin regleta —ver `mountTable`— para que sus cuentas
 * de píxeles no lleven sumado un ancho ajeno. Por eso el primer test de acá es
 * que el valor por defecto del componente es `true`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countMatching, measureDomWrites } from './dom-recorder'
import { createPoolFixture, makeRows as makeDemoRows, mountTable, resolveColumns } from './harness'
import type { TableHarness, TableProps } from './harness'

type Row = { id: number; name: string; amount: number }

const ROW_HEIGHT = 40
const VIEWPORT = { width: 600, height: 400 }
const COLUMN_WIDTH = 120

/**
 * Ancho de la regleta con 100 filas y filas de 40px.
 *
 * Es un CUADRADO: tres dígitos entran de sobra en el lado de la fila, así que la
 * regleta se queda en 40 y no se ensancha. Está escrito a mano y no importado de
 * las constantes a propósito: si alguien cambia la fórmula, este número tiene que
 * fallar y obligar a mirar qué pasó con el layout, no acompañar el cambio en
 * silencio.
 */
const GUTTER = ROW_HEIGHT

function makeRows(count: number): Row[] {
  const rows: Row[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({ id: index, name: `Name ${index}`, amount: index * 10 })
  }
  return rows
}

const COLUMNS = [
  { key: 'id', width: COLUMN_WIDTH },
  { key: 'name', width: COLUMN_WIDTH },
  { key: 'amount', width: COLUMN_WIDTH },
  { key: 'extra', width: COLUMN_WIDTH },
  { key: 'more', width: COLUMN_WIDTH },
  { key: 'last', width: COLUMN_WIDTH },
] as const

/** Monta CON regleta: es el valor por defecto del componente, no del andamiaje. */
async function mountNumbered(
  overrides: Partial<TableProps> = {},
  rowCount = 100,
): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: makeRows(rowCount),
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      showRowNumbers: true,
      ...overrides,
    },
  })
}

/** Los números pintados, de arriba hacia abajo. */
function numbers(harness: TableHarness): string[] {
  const gutter = harness.wrapper.element.querySelector('.dt-gutter')
  if (!gutter) return []

  const painted: { y: number; text: string }[] = []
  for (const node of gutter.querySelectorAll('.dt-row-number')) {
    if (!(node instanceof HTMLElement) || node.hidden) continue
    const match = /translate3d\(0, (-?\d+(?:\.\d+)?)px/.exec(node.style.transform)
    painted.push({ y: match ? Number(match[1]) : 0, text: node.textContent ?? '' })
  }
  return painted.sort((a, b) => a.y - b.y).map((entry) => entry.text)
}

/**
 * El número pintado en una posición visible concreta.
 *
 * Se busca por coordenada y no por orden: el pool pinta también las filas del
 * overscan, que están fuera de la ventana visible, así que "el primero de la
 * lista" no es "el primero que se ve".
 */
function numberAtRow(harness: TableHarness, rowIndex: number): string | null {
  const gutter = harness.wrapper.element.querySelector('.dt-gutter')
  if (!gutter) return null

  const wanted = `translate3d(0, ${rowIndex * ROW_HEIGHT}px, 0)`
  for (const node of gutter.querySelectorAll('.dt-row-number')) {
    if (!(node instanceof HTMLElement) || node.hidden) continue
    if (node.style.transform === wanted) return node.textContent ?? ''
  }
  return null
}

/** Posición horizontal aplicada a un nodo, leída de su `transform`. */
function xOf(node: Element | null): number | null {
  if (!(node instanceof HTMLElement)) return null
  const match = /translate3d\((-?\d+(?:\.\d+)?)px/.exec(node.style.transform)
  return match ? Number(match[1]) : null
}

/* ------------------------------------------------------------ Por defecto */

describe('row numbers — on by default', () => {
  it('numbers the rows without being asked to', async () => {
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows: makeRows(100),
        columns: COLUMNS,
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
        // `undefined` NO es lo mismo que omitirla acá: el andamiaje monta sin
        // regleta, así que hay que pisar ese default con el "sin valor" que hace
        // que Vue aplique el del componente, que es lo que este test mide.
        showRowNumbers: undefined,
      },
    })

    expect(harness.wrapper.element.querySelector('.dt-gutter')).not.toBeNull()
    expect(numberAtRow(harness, 0)).toBe('1')
    expect(numberAtRow(harness, 2)).toBe('3')
    harness.unmount()
  })

  it('counts from one, following the visible position', async () => {
    const harness = await mountNumbered()

    await harness.scrollTo({ top: 20 * ROW_HEIGHT })

    // La fila 21 de la pantalla lleva el 21, no el índice interno 20.
    expect(numberAtRow(harness, 20)).toBe('21')
    harness.unmount()
  })

  it('draws nothing when it is turned off', async () => {
    const harness = await mountNumbered({ showRowNumbers: false })

    expect(harness.wrapper.element.querySelector('.dt-gutter')).toBeNull()
    expect(harness.wrapper.element.querySelector('.dt-corner')).toBeNull()
    harness.unmount()
  })

  it('appears and disappears when the prop changes', async () => {
    const harness = await mountNumbered({ showRowNumbers: false })

    await harness.wrapper.setProps({ showRowNumbers: true })
    await harness.flush()
    expect(numberAtRow(harness, 0)).toBe('1')

    await harness.wrapper.setProps({ showRowNumbers: false })
    await harness.flush()
    expect(harness.wrapper.element.querySelector('.dt-gutter')).toBeNull()
    harness.unmount()
  })
})

/* -------------------------------------------------------------- Geometría */

describe('row numbers — the space they reserve', () => {
  it('pushes the first column to the right of the gutter', async () => {
    const harness = await mountNumbered()

    // Se mira la celda del CUERPO, que se ubica en coordenadas del canvas: ahí el
    // corrimiento de la regleta se lee directo. En el encabezado la primera
    // columna arranca en cero relativo a su tira, porque la esquina ya le reservó
    // el ancho al principio del `flex`.
    expect(xOf(harness.cell(0, 'id'))).toBe(GUTTER)
    harness.unmount()
  })

  it('reserves exactly the gutter width at the start of the header row', async () => {
    const harness = await mountNumbered()

    const row = harness.wrapper.element.querySelector('.dt-header-row')
    const first = row?.firstElementChild

    // La esquina es el primer tramo del `flex` y mide lo mismo que la regleta:
    // eso es lo que hace que la tira que sigue arranque donde terminan los
    // números en vez de quedar debajo de ellos.
    expect(first?.classList.contains('dt-corner')).toBe(true)
    expect(harness.grid.style.getPropertyValue('--dt-row-number-width')).toBe(`${GUTTER}px`)
    harness.unmount()
  })

  it('leaves the first column at zero when it is off', async () => {
    const harness = await mountNumbered({ showRowNumbers: false })

    // El corrimiento entra en el layout, no en el CSS: apagar la regleta lo
    // devuelve a cero sin que ninguna otra pieza tenga que enterarse.
    expect(xOf(harness.cell(0, 'id'))).toBe(0)
    expect(harness.wrapper.element.querySelector('.dt-corner')).toBeNull()
    harness.unmount()
  })

  it('does not park a column underneath the gutter when scrolling to it', async () => {
    const harness = await mountNumbered()

    harness.api.scrollToColumn('more')
    await harness.flush()

    // `more` es la quinta columna: su offset es 4 x 120 más la regleta. Dejarla
    // exactamente en ese offset la metería debajo de los números, así que el
    // desplazamiento descuenta el ancho de la regleta.
    expect(harness.scrollPosition().left).toBe(4 * COLUMN_WIDTH)
    harness.unmount()
  })

  it('stays square while the number fits', async () => {
    const few = await mountNumbered({}, 9)
    const hundreds = await mountNumbered({}, 100)

    // Uno y tres dígitos entran igual en el cuadrado: la regleta no se ensancha
    // por tener más filas, sino por no poder mostrar el número.
    expect(few.grid.style.getPropertyValue('--dt-row-number-width')).toBe(`${ROW_HEIGHT}px`)
    expect(hundreds.grid.style.getPropertyValue('--dt-row-number-width')).toBe(`${ROW_HEIGHT}px`)
    few.unmount()
    hundreds.unmount()
  })

  it('grows only when the number does not fit', async () => {
    const many = await mountNumbered({}, 100_000)

    // Seis dígitos no entran en 40px, y recortarlos sería peor que ensanchar: la
    // regleta existe justamente para leer el número.
    const width = Number.parseInt(many.grid.style.getPropertyValue('--dt-row-number-width'), 10)
    expect(width).toBeGreaterThan(ROW_HEIGHT)
    many.unmount()
  })
})

/* ------------------------------------------- Lo que la regleta NO toca */

describe('row numbers — what they stay out of', () => {
  it('does not count as a column for a screen reader', async () => {
    const harness = await mountNumbered()

    // Seis columnas declaradas, seis anunciadas: la regleta no suma una.
    expect(harness.grid.getAttribute('aria-colcount')).toBe('6')
    expect(harness.wrapper.element.querySelector('.dt-gutter')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
    harness.unmount()
  })

  it('is not copied with the selection', async () => {
    const harness = await mountNumbered()
    await harness.clickCell(1, 'id')
    await harness.shiftClickCell(2, 'name')

    const text = await harness.copy()

    // La posición de la fila no es un dato del consumidor: pegarla en una
    // planilla metería una columna que nadie pidió.
    expect(text).toBe(['1\tName 1', '2\tName 2'].join('\n'))
    harness.unmount()
  })

  it('is not reachable with the keyboard', async () => {
    const harness = await mountNumbered()
    await harness.clickCell(1, 'id')

    await harness.press('ArrowLeft')
    await harness.press('Home')

    // `id` es la primera columna y sigue siéndolo: a la izquierda no hay ninguna
    // celda más a la que llegar.
    expect(harness.cell(1, 'id')?.classList.contains('dt-cell--active')).toBe(true)
    harness.unmount()
  })
})

/* ---------------------------------------------------------- Con grupos */

describe('row numbers — with grouping active', () => {
  it('leaves the group headers unnumbered', async () => {
    const rows = [
      { id: 0, name: 'a', amount: 1, team: 'x' },
      { id: 1, name: 'b', amount: 2, team: 'x' },
      { id: 2, name: 'c', amount: 3, team: 'y' },
    ]
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows,
        columns: [{ key: 'name', width: COLUMN_WIDTH }, { key: 'team' }],
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
        showRowNumbers: true,
        groupBy: ['team'],
      },
    })

    // Cabecera, dos filas, cabecera, una fila: las cabeceras ocupan una posición
    // visible pero no son filas del dataset, y numerarlas haría contar filas que
    // no existen.
    expect(numbers(harness)).toEqual(['', '2', '3', '', '5'])
    harness.unmount()
  })
})

/* ------------------------------------------------- Presupuesto por frame */

describe('row numbers — what they cost per frame', () => {
  it('writes only the number of the row that entered', () => {
    const fixture = createPoolFixture({
      rows: makeDemoRows(200),
      columns: [{ key: 'name' }, { key: 'amount' }],
      visibleRows: 10,
      rowNumbers: true,
    })
    fixture.paint()
    const gutter = fixture.gutter
    if (!gutter) throw new Error('[test] el fixture no montó el carril')

    const measurement = measureDomWrites(gutter, () => {
      fixture.paint({ start: 1, end: 11 })
    })

    // Un paso de scroll deja nueve de las diez filas en pantalla, y el pool las
    // conserva en su slot: esas nueve no escriben nada. La que entró escribe su
    // posición y su texto, y nada más.
    expect(countMatching(measurement.entries, 'transform')).toBe(1)
    expect(countMatching(measurement.entries, 'textContent')).toBe(1)
    fixture.destroy()
  })

  it('costs nothing at all when the table does not number', () => {
    const fixture = createPoolFixture({ visibleRows: 10 })
    fixture.paint()

    // Sin carril no hay nodos de número: el camino de la numeración no existe
    // para una tabla que la tiene apagada.
    expect(fixture.gutter).toBeNull()
    expect(document.querySelectorAll('.dt-row-number')).toHaveLength(0)
    fixture.destroy()
  })

  it('never writes a transform on the gutter itself, at any scroll position', async () => {
    const harness = await mountNumbered()
    const gutter = harness.wrapper.element.querySelector('.dt-gutter')

    await harness.scrollTo({ left: 240 })

    // La regleta se queda quieta por `position: sticky`, o sea que la sostiene el
    // compositor. Compensar el scroll desde JS —que es lo que hacía antes— no
    // puede llegar a tiempo: el navegador compone el frame con el desplazamiento
    // nuevo antes de que el hilo principal escriba la compensación, y medido en el
    // navegador uno de cada dos frames mostraba la regleta corrida el delta entero.
    expect(gutter instanceof HTMLElement && gutter.style.transform).toBe('')
    harness.unmount()
  })
})

/* --------------------------------------------------- Redondeo exterior */

/** La hoja de estilos, sin comentarios. Ver `cell-layout.test.ts`. */
const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('row numbers — what the stylesheet has to guarantee', () => {
  it('keeps the gutter still with sticky', () => {
    const body = /\.dt-gutter\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    expect(body).toContain('position: sticky')
    expect(body).toContain('left: 0')
    // Ya no lo mueve nadie, así que prometerle una capa al navegador sería pedir
    // memoria por una animación que no existe.
    expect(body).not.toContain('will-change')
  })

  it('takes the canvas out of the flow so the gutter can be in it', () => {
    const body = /\.dt-canvas\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // `sticky` solo existe en el flujo. Un canvas absoluto sigue contando para el
    // área desplazable —que es todo lo que se le pide— y deja el flujo libre.
    expect(body).toContain('position: absolute')
  })
})

describe('radiusBorder — the corners of the table', () => {
  it('is square by default', async () => {
    const harness = await mountNumbered()

    // Una grilla casi siempre va adentro de un panel que ya tiene su propio
    // redondeo, y dos radios distintos a pocos píxeles se leen como un error.
    expect(harness.grid.getAttribute('data-radius')).toBe('none')
    harness.unmount()
  })

  it('writes the step it was given', async () => {
    const harness = await mountNumbered({ radiusBorder: 'xl' })

    expect(harness.grid.getAttribute('data-radius')).toBe('xl')
    harness.unmount()
  })

  it('declares a step for each value except the default', () => {
    for (const step of ['sm', 'md', 'lg', 'xl']) {
      expect(STYLESHEET).toContain(`.dt-root[data-radius='${step}']`)
    }
    // `none` no necesita regla: es el valor de la declaración base.
    expect(STYLESHEET).not.toContain(`.dt-root[data-radius='none']`)
  })

  it('keeps the outer radius separate from the theme radius', () => {
    const body = /\.dt-root\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Son dos cosas distintas: `--dt-radius` es el radio del TEMA —editores,
    // píldoras, el panel del selector— y este es el de la tabla como caja.
    // Compartirlos obligaba a elegir entre una tabla cuadrada con píldoras
    // cuadradas o ninguna de las dos.
    expect(body).toContain('--dt-root-radius: 0;')
    expect(body).toContain('border-radius: var(--dt-root-radius)')
    expect(STYLESHEET).toContain('--dt-root-radius: var(--dt-radius)')
  })
})
