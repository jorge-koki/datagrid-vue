/**
 * Seleccionar una columna entera desde su encabezado y una fila entera desde su
 * número.
 *
 * ## Qué protege este archivo
 *
 * Que los dos gestos no introducen un estado de selección nuevo. Una columna
 * entera ES un rango de la primera fila a la última; una fila entera ES un rango
 * de la primera columna visible a la última. Todo lo que ya sabía hacer el rango
 * —copiar, extender con `Shift`, colapsar con un clic— sigue funcionando sin que
 * nadie lo vuelva a implementar, y eso es exactamente lo que se verifica acá:
 * después de cada gesto se copia, se colapsa y se mira el rectángulo.
 *
 * Y que los dos vienen APAGADOS. Una tabla que no los espera no debería empezar
 * a seleccionar de a columnas enteras porque alguien apretó un título.
 */

import { describe, expect, it } from 'vitest'
import { mountTable } from './harness'
import type { TableHarness, TableProps } from './harness'

type Row = { id: number; name: string; amount: number }

const ROW_HEIGHT = 40
const VIEWPORT = { width: 600, height: 400 }
const COLUMN_WIDTH = 120

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
] as const

async function mountGrid(
  overrides: Partial<TableProps> = {},
  rowCount = 20,
): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: makeRows(rowCount),
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      showRowNumbers: true,
      columnSelection: true,
      rowSelection: true,
      ...overrides,
    },
  })
}

/** Aprieta sobre el encabezado de una columna. Devuelve el evento despachado. */
async function pressHeader(harness: TableHarness, columnKey: string): Promise<MouseEvent> {
  const index = COLUMNS.findIndex((column) => column.key === columnKey)
  const node = harness.wrapper.element.querySelector(
    `.dt-header-cell[aria-colindex="${index + 1}"]`,
  )
  if (!node) throw new Error(`[test] no hay encabezado para "${columnKey}"`)

  const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
  node.dispatchEvent(event)
  await harness.flush()
  return event
}

/** Aprieta sobre el número de una fila, en la regleta. */
async function pressRowNumber(harness: TableHarness, rowIndex: number): Promise<void> {
  const gutter = harness.wrapper.element.querySelector('.dt-gutter')
  if (!gutter) throw new Error('[test] la tabla no montó la regleta')

  const wanted = `translate3d(0, ${rowIndex * ROW_HEIGHT}px, 0)`
  for (const node of gutter.querySelectorAll('.dt-row-number')) {
    if (!(node instanceof HTMLElement) || node.hidden) continue
    if (node.style.transform !== wanted) continue
    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await harness.flush()
    return
  }
  throw new Error(`[test] no hay número pintado para la fila ${rowIndex}`)
}

/** Último rango anunciado, o `null`. */
function lastRange(
  harness: TableHarness,
): { rowStart: number; rowEnd: number; keys: string[] } | null {
  const events = harness.wrapper.emitted('rangeSelect')
  if (!events || events.length === 0) return null

  const payload: unknown = events[events.length - 1]?.[0]
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('[test] rangeSelect emitió una forma inesperada')
  }

  const event = payload as {
    rowStart: number
    rowEnd: number
    columns: readonly { key: string }[]
  }
  return {
    rowStart: event.rowStart,
    rowEnd: event.rowEnd,
    keys: event.columns.map((column) => column.key),
  }
}

/** Celdas teñidas visibles. */
function tintedCount(harness: TableHarness): number {
  return harness.canvas.querySelectorAll('.dt-cell--range:not([hidden])').length
}

/* ------------------------------------------------------ Columna entera */

describe('column selection — clicking a header', () => {
  it('selects the column from the first row to the last', async () => {
    const harness = await mountGrid()

    await pressHeader(harness, 'name')

    expect(lastRange(harness)).toEqual({ rowStart: 0, rowEnd: 19, keys: ['name'] })
    harness.unmount()
  })

  it('marks the header of the selected column', async () => {
    const harness = await mountGrid()

    await pressHeader(harness, 'amount')

    // El rectángulo de una columna entera casi nunca entra en pantalla, así que
    // el encabezado es la señal que queda a la vista al scrollear.
    const header = harness.wrapper.element.querySelector('.dt-header-cell[aria-colindex="3"]')
    expect(header?.classList.contains('dt-header-cell--range')).toBe(true)
    harness.unmount()
  })

  it('copies the whole column, and nothing else', async () => {
    const harness = await mountGrid({}, 3)

    await pressHeader(harness, 'name')
    const text = await harness.copy()

    // Lo que hace que esto funcione sin una línea de código propia es que la
    // selección de columna ES un rango.
    expect(text).toBe(['Name 0', 'Name 1', 'Name 2'].join('\n'))
    harness.unmount()
  })

  it('collapses with a click on any cell', async () => {
    const harness = await mountGrid()
    await pressHeader(harness, 'name')

    await harness.clickCell(2, 'id')

    expect(tintedCount(harness)).toBe(0)
    expect(harness.grid.getAttribute('data-range')).toBe('false')
    harness.unmount()
  })

  it('does nothing when the feature is off', async () => {
    const harness = await mountGrid({ columnSelection: false })

    await pressHeader(harness, 'name')

    expect(lastRange(harness)).toBeNull()
    expect(harness.grid.getAttribute('data-select-columns')).toBe('false')
    harness.unmount()
  })

  it('does not fire while dragging the resize handle', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'name', width: COLUMN_WIDTH, resizable: true },
        { key: 'amount', width: COLUMN_WIDTH },
      ],
    })

    const handle = harness.wrapper.element.querySelector('.dt-resize-handle')
    handle?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await harness.flush()

    // El handle vive DENTRO del encabezado: sin la guarda, cada arrastre de
    // ancho terminaría además seleccionando la columna.
    expect(lastRange(harness)).toBeNull()
    harness.unmount()
  })

  it('cancels the default so the click does not steal the focus', async () => {
    const harness = await mountGrid()

    const event = await pressHeader(harness, 'name')

    // Sin esto el copiado queda roto, y de una forma que ningún test en un DOM
    // simulado ve: apretar sobre un elemento no enfocable hace que el navegador
    // lleve el foco a su ancestro enfocable más cercano, y el del encabezado no
    // es el viewport —vive afuera— sino el `body`. Eso ocurre DESPUÉS de este
    // manejador, así que pisaba el foco que la tabla se acababa de dar y
    // `Ctrl`+`C` terminaba copiando la selección vacía de la página.
    expect(event.defaultPrevented).toBe(true)
    harness.unmount()
  })

  it('does not cancel anything when the feature is off', async () => {
    const harness = await mountGrid({ columnSelection: false })

    const event = await pressHeader(harness, 'name')

    // Una tabla que no selecciona columnas no tiene por qué alterar lo que el
    // navegador hace con un clic en su encabezado.
    expect(event.defaultPrevented).toBe(false)
    harness.unmount()
  })

  it('ignores the secondary button', async () => {
    const harness = await mountGrid()

    const header = harness.wrapper.element.querySelector('.dt-header-cell')
    header?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }))
    await harness.flush()

    expect(lastRange(harness)).toBeNull()
    harness.unmount()
  })
})

/* --------------------------------------------------------- Fila entera */

describe('row selection — clicking a row number', () => {
  it('selects every visible column of that row', async () => {
    const harness = await mountGrid()

    await pressRowNumber(harness, 3)

    expect(lastRange(harness)).toEqual({
      rowStart: 3,
      rowEnd: 3,
      keys: ['id', 'name', 'amount'],
    })
    harness.unmount()
  })

  it('leaves a hidden column out, because what is selected is what is seen', async () => {
    const harness = await mountGrid({ columnVisibility: { name: false } })

    await pressRowNumber(harness, 1)

    expect(lastRange(harness)?.keys).toEqual(['id', 'amount'])
    harness.unmount()
  })

  it('copies the row as a single line', async () => {
    const harness = await mountGrid()

    await pressRowNumber(harness, 2)
    const text = await harness.copy()

    expect(text).toBe('2\tName 2\t20')
    harness.unmount()
  })

  it('marks the numbers of the selected rows', async () => {
    const harness = await mountGrid()

    await pressRowNumber(harness, 2)

    const marked = harness.wrapper.element.querySelectorAll('.dt-row-number--range')
    expect(marked).toHaveLength(1)
    harness.unmount()
  })

  it('does nothing when the feature is off', async () => {
    const harness = await mountGrid({ rowSelection: false })

    await pressRowNumber(harness, 3)

    expect(lastRange(harness)).toBeNull()
    expect(harness.grid.getAttribute('data-select-rows')).toBe('false')
    harness.unmount()
  })

  it('extends to a block with Shift and the arrows, like any other range', async () => {
    const harness = await mountGrid()
    await pressRowNumber(harness, 2)

    await harness.press('ArrowDown', { shiftKey: true })

    // El ancla quedó en la primera columna de la fila 2 y el foco en la última;
    // bajarlo una fila convierte la selección en un bloque de dos filas por todo
    // el ancho, que es lo que hace una planilla. No hizo falta código propio:
    // una fila entera ya era un rango.
    expect(lastRange(harness)).toEqual({
      rowStart: 2,
      rowEnd: 3,
      keys: ['id', 'name', 'amount'],
    })
    harness.unmount()
  })
})

/* -------------------------------------------------------- Por defecto */

describe('both gestures — off unless asked for', () => {
  it('does not select a column or a row by default', async () => {
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows: makeRows(20),
        columns: COLUMNS,
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
        showRowNumbers: true,
      },
    })

    await pressHeader(harness, 'name')
    await pressRowNumber(harness, 1)

    expect(lastRange(harness)).toBeNull()
    expect(harness.grid.getAttribute('data-select-columns')).toBe('false')
    expect(harness.grid.getAttribute('data-select-rows')).toBe('false')
    harness.unmount()
  })

  it('needs the range to be available at all', async () => {
    const harness = await mountGrid({ rangeSelection: false })

    await pressHeader(harness, 'name')
    await pressRowNumber(harness, 1)

    // Los dos gestos producen un RANGO. Sin rango no hay forma de expresar
    // "esta columna entera", así que el gesto no hace nada en lugar de
    // seleccionar media cosa.
    expect(lastRange(harness)).toBeNull()
    expect(tintedCount(harness)).toBe(0)
    harness.unmount()
  })
})
