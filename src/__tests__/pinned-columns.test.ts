/**
 * Columnas ancladas a los bordes.
 *
 * ## Qué protege este archivo
 *
 * Anclar una columna es hacer que se quede quieta mientras el canvas se
 * desplaza, y eso lo resuelve UN carril `position: sticky` por fila del que
 * cuelgan las celdas ancladas. De ahí salen los cuatro invariantes que se
 * verifican aquí:
 *
 * 1. **El orden.** El anclaje manda sobre el orden de columnas: las de `start`
 *    van primero y las de `end` al final, sin importar dónde estaban.
 * 2. **La posición no depende del scroll.** Es la propiedad central, y la que
 *    hace que la columna no tiemble: quien la sostiene es el compositor, no el
 *    pintado. Compensar el scroll desde JS —que es lo que hacía antes— se
 *    compone un frame tarde, y eso se ve.
 * 3. **Una sola copia.** Las ancladas salen de la ventana virtual. Si además
 *    cayeran en ella se pintarían dos veces —la quieta en el borde y la suelta
 *    pasando por debajo—, que es el fantasma clásico de esta función.
 * 4. **Todo lo demás sigue igual.** Una celda anclada se selecciona, se copia y
 *    se edita como cualquier otra, y el editor la sigue cuando el resto scrollea.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countMatching, measureDomWrites } from './dom-recorder'
import { createPoolFixture, makeRows as makeDemoRows, mountTable, resolveColumns } from './harness'
import type { TableHarness, TableProps } from './harness'

type Row = { id: number; name: string; amount: number; city: string; total: number }

const ROW_HEIGHT = 40
/** Seis columnas de 120px contra un viewport de 600: siempre hay scroll. */
const VIEWPORT = { width: 600, height: 400 }
const COLUMN_WIDTH = 120

function makeRows(count: number): Row[] {
  const rows: Row[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({
      id: index,
      name: `Name ${index}`,
      amount: index * 10,
      city: `City ${index}`,
      total: index * 100,
    })
  }
  return rows
}

const COLUMNS = [
  { key: 'id', width: COLUMN_WIDTH, pinned: 'start' as const },
  { key: 'name', width: COLUMN_WIDTH, editable: true },
  { key: 'amount', width: COLUMN_WIDTH },
  { key: 'city', width: COLUMN_WIDTH },
  { key: 'extra', width: COLUMN_WIDTH },
  { key: 'total', width: COLUMN_WIDTH, pinned: 'end' as const },
] as const

async function mountGrid(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: makeRows(50),
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      ...overrides,
    },
  })
}

/** Posición horizontal aplicada a un nodo, leída de su `transform`. */
function xOf(node: Element | null): number | null {
  if (!(node instanceof HTMLElement)) return null
  const match = /translate3d\((-?\d+(?:\.\d+)?)px/.exec(node.style.transform)
  return match ? Number(match[1]) : null
}

/** Encabezados pintados, en orden visual. */
function headerOrder(harness: TableHarness): string[] {
  const cells = [...harness.wrapper.element.querySelectorAll('.dt-header-cell')]
  return cells
    .map((node) => ({
      index: Number(node.getAttribute('aria-colindex') ?? 0),
      key: node.textContent?.trim() ?? '',
    }))
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.key)
}

/** Celdas pintadas de una fila para una clave de columna. */
function cellsFor(harness: TableHarness, rowIndex: number, columnKey: string): HTMLElement[] {
  const index = headerOrder(harness).indexOf(columnKey) + 1
  const row = harness.canvas.querySelector(`.dt-row[data-row-key="${rowIndex}"]`)
  if (!row) return []

  const found: HTMLElement[] = []
  for (const node of row.querySelectorAll(`.dt-cell[aria-colindex="${index}"]`)) {
    if (node instanceof HTMLElement && !node.hidden) found.push(node)
  }
  return found
}

/* --------------------------------------------------------------- El orden */

describe('pinned columns — the order they impose', () => {
  it('puts the start-pinned first and the end-pinned last', async () => {
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows: makeRows(10),
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
        // Declaradas en un orden cualquiera: el anclaje manda sobre él.
        columns: [
          { key: 'name', width: COLUMN_WIDTH },
          { key: 'total', width: COLUMN_WIDTH, pinned: 'end' },
          { key: 'amount', width: COLUMN_WIDTH },
          { key: 'id', width: COLUMN_WIDTH, pinned: 'start' },
        ],
      },
    })

    expect(headerOrder(harness)).toEqual(['id', 'name', 'amount', 'total'])
    harness.unmount()
  })

  it('lays the start strip right after the row numbers', async () => {
    const harness = await mountGrid({ showRowNumbers: true })

    const children = [...(harness.wrapper.element.querySelector('.dt-header-row')?.children ?? [])]
    const corner = children.findIndex((node) => node.classList.contains('dt-corner'))
    const strip = children.findIndex((node) => node.classList.contains('dt-header-pinned--start'))

    // La regleta ya ocupaba ese borde. Su esquina es el tramo anterior del
    // `flex`, así que la tira anclada empieza justo donde terminan los números, y
    // se pega ahí —no al borde del viewport— cuando el resto scrollea.
    expect(corner).toBe(0)
    expect(strip).toBe(1)
    expect(STYLESHEET).toContain('left: var(--dt-row-number-width, 0px)')
    harness.unmount()
  })

  it('cannot be dragged to another position', async () => {
    const harness = await mountGrid()

    const header = harness.wrapper.element.querySelector('.dt-header-cell')
    header?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
    header?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 400 }))
    header?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 400 }))
    await harness.flush()

    // Moverla significaría desanclarla, así que el arrastre no la levanta.
    expect(harness.wrapper.emitted('update:columnOrder')).toBeUndefined()
    expect(headerOrder(harness)[0]).toBe('id')
    harness.unmount()
  })
})

/* ------------------------------------------------------- Quedarse quietas */

describe('pinned columns — they stay put while the rest scrolls', () => {
  it('does not move the pinned cell when the table scrolls sideways', async () => {
    const harness = await mountGrid()

    const before = xOf(cellsFor(harness, 0, 'id')[0] ?? null)
    await harness.scrollTo({ left: 200 })
    const after = xOf(cellsFor(harness, 0, 'id')[0] ?? null)

    // Es EL invariante: la posición de una anclada no es función del scroll. La
    // celda cuelga de un carril `sticky` y no se entera de que el canvas se
    // movió. Con la compensación por JS que había antes, este número cambiaba en
    // cada frame, y llegaba tarde en la mitad de ellos.
    expect(before).toBe(0)
    expect(after).toBe(0)
    harness.unmount()
  })

  it('hangs the pinned cells from a lane per side', async () => {
    const harness = await mountGrid()

    const row = harness.canvas.querySelector('.dt-row[data-row-key="0"]')
    const start = row?.querySelector('.dt-pinned-lane--start')
    const end = row?.querySelector('.dt-pinned-lane--end')

    expect(start?.querySelectorAll('.dt-cell--pinned')).toHaveLength(1)
    expect(end?.querySelectorAll('.dt-cell--pinned')).toHaveLength(1)
    harness.unmount()
  })

  it('gives the row a real width, which is what lets the lane travel', async () => {
    const harness = await mountGrid()

    const row = harness.canvas.querySelector('.dt-row[data-row-key="0"]')

    // Una fila sin ancho propio mide cero —todos sus hijos son absolutos—, y un
    // `sticky` no puede correrse más allí de su bloque contenedor: el carril se
    // quedaría clavado y no habría anclaje. Seis columnas de 120.
    expect(row instanceof HTMLElement && row.style.width).toBe('720px')
    harness.unmount()
  })

  it('measures the end-pinned column back from the right edge of the row', async () => {
    const harness = await mountGrid()

    await harness.scrollTo({ left: 0 })
    const cell = cellsFor(harness, 0, 'total')[0] ?? null

    // Su carril cuelga del final de la fila, así que la celda se ubica hacia
    // atrás desde ahí: seis columnas de 120 dan 720 de ancho y la última empieza
    // en 600, o sea 120 antes del borde.
    expect(xOf(cell)).toBe(-COLUMN_WIDTH)
    harness.unmount()
  })

  it('places it the same way when the whole table fits', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'name', width: COLUMN_WIDTH },
        { key: 'total', width: COLUMN_WIDTH, pinned: 'end' },
      ],
    })

    // El mismo número en los dos casos, y no es casualidad: el carril se pega al
    // borde del viewport solo mientras su posición natural quede fuera. Sin scroll
    // horizontal ya está adentro, no se corre, y la columna se queda donde termina
    // la tabla en vez de dejar un hueco. Esa distinción la hace el navegador.
    expect(xOf(cellsFor(harness, 0, 'total')[0] ?? null)).toBe(-COLUMN_WIDTH)
    harness.unmount()
  })

  it('paints exactly one copy of a pinned column', async () => {
    const harness = await mountGrid()

    await harness.scrollTo({ left: 240 })

    // El fantasma clásico: la copia anclada quieta en el borde y la suelta
    // pasando por debajo con el scroll, las dos con el mismo dato.
    expect(cellsFor(harness, 0, 'id')).toHaveLength(1)
    expect(cellsFor(harness, 0, 'total')).toHaveLength(1)
    harness.unmount()
  })

  it('keeps painting the pinned column when its natural place is far away', async () => {
    const harness = await mountGrid()

    await harness.scrollTo({ left: 120 })

    // Con la ventana virtual corrida, `id` ya no entra en el tramo visible por
    // su offset: sigue en pantalla porque se pinta por el camino de las ancladas.
    expect(cellsFor(harness, 0, 'id')).toHaveLength(1)
    expect(cellsFor(harness, 0, 'id')[0]?.textContent).toBe('0')
    harness.unmount()
  })
})

/* ------------------------------------------- Todo lo demás sigue valiendo */

describe('pinned columns — everything else still works on them', () => {
  it('selects a pinned cell with a click', async () => {
    const harness = await mountGrid()

    await harness.clickCell(2, 'id')

    expect(harness.cell(2, 'id')?.classList.contains('dt-cell--active')).toBe(true)
    harness.unmount()
  })

  it('copies a range that spans pinned and scrolling columns', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'id')
    await harness.shiftClickCell(1, 'amount')

    const text = await harness.copy()

    expect(text).toBe('1\tName 1\t10')
    harness.unmount()
  })

  it('opens the editor over the pinned cell and follows it while scrolling', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH, pinned: 'start', editable: true },
        { key: 'name', width: COLUMN_WIDTH },
        { key: 'amount', width: COLUMN_WIDTH },
        { key: 'city', width: COLUMN_WIDTH },
        { key: 'extra', width: COLUMN_WIDTH },
        { key: 'total', width: COLUMN_WIDTH },
      ],
    })

    await harness.doubleClickCell(1, 'id')
    const editor = harness.editor()
    expect(editor).not.toBeNull()
    const before = xOf(editor)

    await harness.scrollTo({ left: 200 })

    // El editor se posiciona en coordenadas del canvas: si no acompañara el
    // corrimiento de la columna anclada, quedaría flotando sobre la celda que
    // pasa por debajo.
    expect(xOf(harness.editor())).toBe((before ?? 0) + 200)
    harness.unmount()
  })

  it('hides the pinned cells on a group header row', async () => {
    const harness = await mountGrid({ groupBy: ['city'] })

    const groupRow = harness.canvas.querySelector('.dt-group-row')
    const visiblePinned = [...(groupRow?.querySelectorAll('.dt-cell--pinned') ?? [])].filter(
      (node) => node instanceof HTMLElement && !node.hidden,
    )

    // Una cabecera se extiende por todo el ancho: dejar encendidas las ancladas
    // pondría dos valores de una fila que no existe encima de su etiqueta.
    expect(visiblePinned).toHaveLength(0)
    harness.unmount()
  })
})

/* ------------------------------------------------- Presupuesto por frame */

describe('pinned columns — what they cost per frame', () => {
  /** Dos sueltas y una anclada al inicio, con diez filas visibles. */
  function fixtureWithPinned() {
    const pinned = resolveColumns([{ key: 'id', width: COLUMN_WIDTH, pinned: 'start' }])
    const fixture = createPoolFixture({
      rows: makeDemoRows(200),
      columns: [{ key: 'name' }, { key: 'amount' }],
      visibleRows: 10,
    })
    fixture.paint({ pinnedColumns: pinned })
    return { fixture, pinned }
  }

  it('costs nothing per frame, because the scroll is not one of its inputs', () => {
    const { fixture, pinned } = fixtureWithPinned()

    const measurement = measureDomWrites(fixture.container, () => {
      fixture.paint({ pinnedColumns: pinned })
    })

    // El precio de la función, dicho sin maquillaje: cero. Antes costaba una
    // escritura por celda anclada visible en CADA frame en que el scroll
    // horizontal se movía —diez filas, diez escrituras—, porque la posición se
    // recalculaba a partir del scroll. Ahora no depende de él, y por eso ningún
    // frame de scroll escribe nada: no hay nada que reposicionar.
    expect(countMatching(measurement.entries, 'transform')).toBe(0)
  })

  it('does not add a lane to a table without pinned columns', () => {
    const fixture = createPoolFixture({
      rows: makeDemoRows(200),
      columns: [{ key: 'name' }, { key: 'amount' }],
      visibleRows: 10,
    })
    fixture.paint()

    // Los carriles se crean al necesitarse: una tabla que no ancla nada no paga
    // ni un nodo por una función que no usa.
    expect(fixture.container.querySelectorAll('.dt-pinned-lane')).toHaveLength(0)
    fixture.destroy()
  })
})

/* ---------------------------------------- Contrato de la hoja de estilos */

const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('pinned columns — what the stylesheet has to guarantee', () => {
  it('holds the lane still with sticky, not with a transform', () => {
    const body = /\.dt-pinned-lane\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Es la diferencia entre que la sostenga el compositor o el hilo principal, y
    // se ve: con un `transform` escrito por frame, uno de cada dos frames
    // compuestos mostraba la columna corrida el delta entero del scroll.
    expect(body).toContain('position: sticky')
    expect(body).toContain('left: 0')
    // Tamaño cero: está en el flujo —condición para ser `sticky`— sin ocupar un
    // píxel de la fila.
    expect(body).toContain('width: 0')
    expect(body).toContain('height: 0')
    // Y por encima de las celdas que scrollean, que pasan por debajo.
    expect(body).toContain('z-index')
  })

  it('anchors the end lane to the right edge of the row', () => {
    const body = /\.dt-pinned-lane--end\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // `margin-left: auto` lo empuja hasta el final de la fila y `right: 0` lo trae
    // desde ahí al borde del viewport. Los dos juntos dan el comportamiento
    // completo sin medir nada.
    expect(body).toContain('margin-left: auto')
    expect(body).toContain('right: 0')
  })

  it('gives a pinned cell an opaque background taken from its row', () => {
    const body = /\.dt-cell--pinned\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Sin fondo propio, las celdas que scrollean se verían A TRAVÉS de la
    // anclada. El color sale de `--dt-row-bg`, que es el de SU fila —normal,
    // rayado o activo— y llega hasta aquí por herencia.
    expect(body).toContain('background: var(--dt-row-bg)')
  })

  it('declares the row colour without painting the row', () => {
    const body = /\n\.dt-row\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // La fila declara de qué color es y NADA MÁS. Que no pinte no es un detalle:
    // tiene el ancho de la tabla entera —lo necesita para sostener los carriles
    // anclados—, así que cualquier fondo, raya o borde suyo se vería de punta a
    // punta. Lo que se ve son sus celdas, no ella.
    expect(body).toContain('--dt-row-bg: var(--dt-bg)')
    expect(body).not.toMatch(/\n\s*background/)
    expect(body).not.toMatch(/\n\s*border/)
    expect(body).not.toMatch(/\n\s*box-shadow/)
  })

  it('never leaves a row colour unset, whatever the variant or the selection', () => {
    // La garantía completa: si una sola regla deja el color de la fila en nada,
    // las celdas ancladas de ESA fila quedan transparentes y el contenido que
    // scrollea se lee a través. Pasaba en dos configuraciones: la variante
    // `cells` en las filas rayadas, y la fila de la celda ancla mientras hubiera
    // un rango seleccionado.
    const reglasDeFila = [...STYLESHEET.matchAll(/\.dt-(?:row|group-row)[^{]*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? '')
      .filter((body) => /--dt-row-bg\s*:/.test(body))

    // Un piso, solo para no dar por buena una lista vacía si el barrido falla.
    expect(reglasDeFila.length).toBeGreaterThanOrEqual(4)
    for (const body of reglasDeFila) {
      expect(body).not.toMatch(/--dt-row-bg\s*:\s*(none|transparent|;)/)
    }
  })

  it('does not paint a row background, a row border or a row ring anywhere', () => {
    // El barrido completo, no solo la regla base: ninguna variante puede volver a
    // encender decoración a lo ancho de la fila.
    const reglas = [...STYLESHEET.matchAll(/([^\n{}]*\.dt-(?:row|group-row)[^\n{}]*)\{([^}]*)\}/g)]

    for (const [, selector = '', body = ''] of reglas) {
      // Los números de la regleta sí pintan: son su propio carril, no la fila.
      if (selector.includes('.dt-row-number')) continue
      expect([selector.trim(), body]).toEqual([
        selector.trim(),
        expect.not.stringMatching(/\n\s*(background|border|box-shadow)\s*:/),
      ])
    }
  })

  it('draws the cut between pinned and scrolling at double thickness', () => {
    const body = /\.dt-cell--pinned-edge::after\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Es la única señal de que ahí termina el bloque anclado, así que va al doble
    // del grosor de una separación de celda, que es de 1px.
    expect(body).toContain('width: 2px')
    // Y va por pseudoelemento: un `border` ensancharía la tira del encabezado y
    // correría al resto del `flex`, que es justo lo que no puede pasar.
    expect(body).toContain('position: absolute')
    expect(body).toContain("content: ''")
    // Las dos caras del mismo corte: el encabezado la dibuja igual.
    expect(STYLESHEET).toContain('.dt-header-pinned--start::after')
    expect(STYLESHEET).toContain('.dt-header-pinned--end::before')
  })

  it('marks exactly one cell per lane as the cut', async () => {
    const harness = await mountGrid()

    const row = harness.canvas.querySelector('.dt-row[data-row-key="0"]')
    const start = row?.querySelector('.dt-pinned-lane--start')
    const end = row?.querySelector('.dt-pinned-lane--end')

    // La última del bloque del inicio y la primera del del final. Con una columna
    // por lado son esas mismas dos.
    expect(start?.querySelectorAll('.dt-cell--pinned-edge')).toHaveLength(1)
    expect(end?.querySelectorAll('.dt-cell--pinned-edge')).toHaveLength(1)
    harness.unmount()
  })

  it('tints the range with an image layer, not with the background colour', () => {
    const body = /\.dt-cell--range\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // El tinte es semitransparente y el color de fondo es lo que vuelve opaca a
    // una celda anclada: si el tinte viviera ahí, una celda anclada dentro del
    // rango dejaría ver lo que pasa por debajo.
    expect(body).toContain('background-image')
    expect(body).not.toContain('background-color')
  })
})
