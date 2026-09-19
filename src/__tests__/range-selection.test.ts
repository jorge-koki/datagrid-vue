/**
 * Selección de un rango de celdas y copiado al portapapeles.
 *
 * ## Qué protege este archivo
 *
 * Tres invariantes que se rompen de formas distintas y silenciosas:
 *
 * 1. **El ancla del rango ES la celda activa.** No hay dos estados de selección,
 *    y por eso arrastrar o extender con `Shift` no mueve la celda activa,
 *    mientras que cualquier movimiento sin `Shift` colapsa el rango. Si alguna
 *    vez se separan, la tabla puede terminar mostrando un rectángulo que no
 *    contiene a la celda que dice estar seleccionada.
 * 2. **El rectángulo se resuelve contra las columnas visibles al pintarlo.** Se
 *    guardan dos claves, no una lista: ocultar una columna de adentro lo
 *    angosta, y volver a mostrarla lo devuelve.
 * 3. **Se copia lo que se ve.** La tabla está virtualizada, así que el texto del
 *    portapapeles NO puede salir del DOM: de un rango de 5.000 filas hay treinta
 *    pintadas. Sale de `CellRenderer.text`, y un badge tiene que aportar su
 *    etiqueta y no el valor guardado.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { mountTable } from './harness'
import type { TableHarness, TableProps } from './harness'
import type { RangeCopyEvent, RangeSelectEvent } from '../types'

type Row = { id: number; name: string; amount: number; status: string; note: string }

const ROW_HEIGHT = 40
const VIEWPORT = { width: 600, height: 400 }
const COLUMN_WIDTH = 120

const STATUS_OPTIONS = [
  { value: 'open', label: 'Abierto' },
  { value: 'done', label: 'Cerrado' },
] as const

function makeRows(count: number): Row[] {
  const rows: Row[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({
      id: index,
      name: `Name ${index}`,
      amount: index * 1000,
      status: index % 2 === 0 ? 'open' : 'done',
      note: `Note ${index}`,
    })
  }
  return rows
}

/**
 * Cinco columnas de 120px. `status` se pinta como badge a propósito: es la que
 * demuestra que el copiado sale del renderer y no del valor crudo.
 */
const COLUMNS = [
  { key: 'id', width: COLUMN_WIDTH },
  { key: 'name', width: COLUMN_WIDTH, editable: true },
  { key: 'amount', width: COLUMN_WIDTH, renderer: 'number' },
  { key: 'status', width: COLUMN_WIDTH, renderer: 'badge', options: STATUS_OPTIONS },
  { key: 'note', width: COLUMN_WIDTH },
] as const

async function mountGrid(
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
      ...overrides,
    },
  })
}

/** Celdas teñidas ahora mismo, como pares `fila:columna`. */
function tintedCells(harness: TableHarness): string[] {
  const marked: string[] = []
  for (const row of harness.canvas.querySelectorAll('.dt-row')) {
    if (!(row instanceof HTMLElement) || row.hidden) continue
    const rowKey = row.dataset.rowKey ?? '?'
    for (const cell of row.querySelectorAll('.dt-cell--range')) {
      if (!(cell instanceof HTMLElement) || cell.hidden) continue
      marked.push(`${rowKey}:${cell.getAttribute('aria-colindex')}`)
    }
  }
  return marked.sort()
}

/** Cantidad de celdas teñidas. El ancla nunca cuenta: no se tiñe. */
function tintedCount(harness: TableHarness): number {
  return tintedCells(harness).length
}

/** El recuadro del rango, o `null` si no hay ninguno dibujado. */
function rangeBox(harness: TableHarness): HTMLElement | null {
  const node = harness.wrapper.element.querySelector('.dt-range-box')
  return node instanceof HTMLElement ? node : null
}

/** Último `rangeSelect` anunciado. */
function lastRangeSelect(wrapper: VueWrapper): RangeSelectEvent<Row> | null {
  const events = wrapper.emitted('rangeSelect')
  if (!events || events.length === 0) return null
  const payload: unknown = events[events.length - 1]?.[0]
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('[test] rangeSelect emitió una forma inesperada')
  }
  return payload as RangeSelectEvent<Row>
}

/** Último `rangeCopy` anunciado. */
function lastRangeCopy(wrapper: VueWrapper): RangeCopyEvent | null {
  const events = wrapper.emitted('rangeCopy')
  if (!events || events.length === 0) return null
  const payload: unknown = events[events.length - 1]?.[0]
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('[test] rangeCopy emitió una forma inesperada')
  }
  return payload as RangeCopyEvent
}

/** Celda activa anunciada por `update:activeCell`, o `null`. */
function lastActiveCell(wrapper: VueWrapper): { rowIndex: number; columnKey: string } | null {
  const events = wrapper.emitted('update:activeCell')
  if (!events || events.length === 0) return null
  const payload: unknown = events[events.length - 1]?.[0]
  if (payload === null || payload === undefined) return null
  if (typeof payload !== 'object' || !('rowIndex' in payload) || !('columnKey' in payload)) {
    throw new Error('[test] update:activeCell emitió una forma inesperada')
  }
  const { rowIndex, columnKey } = payload
  if (typeof rowIndex !== 'number' || typeof columnKey !== 'string') {
    throw new Error('[test] update:activeCell emitió una forma inesperada')
  }
  return { rowIndex, columnKey }
}

/* ------------------------------------------------------------- Arrastre */

describe('range — dragging with the primary button', () => {
  it('selects the rectangle the pointer swept', async () => {
    const harness = await mountGrid()

    await harness.dragCells([
      [1, 'name'],
      [2, 'amount'],
      [3, 'status'],
    ])

    // 3 filas x 3 columnas = 9 celdas, menos el ancla, que no se tiñe.
    expect(tintedCount(harness)).toBe(8)
    expect(harness.grid.getAttribute('data-range')).toBe('true')
    harness.unmount()
  })

  it('leaves the anchor cell untinted and keeps it active', async () => {
    const harness = await mountGrid()

    await harness.dragCells([
      [1, 'name'],
      [3, 'status'],
    ])

    const anchor = harness.cell(1, 'name')
    expect(anchor?.classList.contains('dt-cell--range')).toBe(false)
    // El arrastre mueve el foco, nunca el ancla: la celda activa sigue siendo la
    // del `pointerdown`.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'name' })
    harness.unmount()
  })

  it('draws one box for the whole rectangle, with the geometry of the span', async () => {
    const harness = await mountGrid()

    await harness.dragCells([
      [1, 'name'],
      [3, 'status'],
    ])

    const box = rangeBox(harness)
    // De `name` (offset 120) a `status` (offset 360 + 120 de ancho) son 360px, y
    // tres filas de 40px son 120px de alto.
    expect(box?.style.width).toBe('360px')
    expect(box?.style.height).toBe('120px')
    expect(box?.style.transform).toBe('translate3d(120px, 40px, 0)')
    harness.unmount()
  })

  it('normalizes a rectangle dragged upwards and to the left', async () => {
    const harness = await mountGrid()

    await harness.dragCells([
      [4, 'status'],
      [2, 'name'],
    ])

    // El mismo rectángulo que si se hubiera arrastrado al revés: 3x3 menos el ancla.
    expect(tintedCount(harness)).toBe(8)
    expect(harness.cell(2, 'name')?.classList.contains('dt-cell--range')).toBe(true)
    expect(harness.cell(4, 'status')?.classList.contains('dt-cell--range')).toBe(false)
    harness.unmount()
  })

  it('announces every cell of the range as selected, not just the anchor', async () => {
    const harness = await mountGrid()

    await harness.dragCells([
      [1, 'name'],
      [2, 'amount'],
    ])

    // Un lector de pantalla que recorre el rango tiene que encontrar las cuatro
    // celdas seleccionadas, igual que en una hoja de cálculo.
    const selected = harness.canvas.querySelectorAll('.dt-cell[aria-selected="true"]')
    expect(selected).toHaveLength(4)
    harness.unmount()
  })

  it('stops extending once the button is released', async () => {
    const harness = await mountGrid()
    await harness.dragCells([
      [1, 'name'],
      [2, 'amount'],
    ])
    const afterDrag = tintedCount(harness)

    // Un movimiento suelto, sin nada presionado: el listener ya no está registrado.
    harness.cell(5, 'note')?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await harness.flush()

    expect(tintedCount(harness)).toBe(afterDrag)
    harness.unmount()
  })

  it('ignores a move that arrives without a drag in progress', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')

    harness.cell(4, 'status')?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await harness.flush()

    expect(tintedCount(harness)).toBe(0)
    expect(harness.grid.getAttribute('data-range')).toBe('false')
    harness.unmount()
  })

  it('does not select with the secondary button', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')

    // El botón secundario abre el menú contextual del navegador: mover la
    // selección debajo de un menú que se está abriendo no es lo que nadie espera.
    harness
      .cell(4, 'status')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }))
    await harness.flush()

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'name' })
    harness.unmount()
  })
})

/* --------------------------------------------------------- Shift + clic */

describe('range — Shift + click', () => {
  it('extends from the anchor without moving the active cell', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')

    await harness.shiftClickCell(4, 'status')

    // 4 filas x 3 columnas = 12, menos el ancla.
    expect(tintedCount(harness)).toBe(11)
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'name' })
    harness.unmount()
  })

  it('re-extends from the same anchor, it does not chain', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(4, 'status')

    await harness.shiftClickCell(2, 'amount')

    // El ancla no se movió, así que el rango se achica: 2x2 menos el ancla.
    expect(tintedCount(harness)).toBe(3)
    harness.unmount()
  })

  it('does nothing without an anchor', async () => {
    const harness = await mountGrid()

    await harness.shiftClickCell(3, 'name')

    expect(tintedCount(harness)).toBe(0)
    expect(lastActiveCell(harness.wrapper)).toBeNull()
    harness.unmount()
  })
})

/* ------------------------------------------------------------- Teclado */

describe('range — keyboard', () => {
  it('extends with Shift + arrow and keeps the active cell in place', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')

    await harness.press('ArrowDown', { shiftKey: true })

    expect(tintedCount(harness)).toBe(1)
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'name' })
    harness.unmount()
  })

  it('grows from the focus, not from the anchor, on repeated presses', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')

    await harness.press('ArrowDown', { shiftKey: true })
    await harness.press('ArrowDown', { shiftKey: true })

    // Tres filas abarcadas menos el ancla. Creciendo desde el ancla, dos teclas
    // habrían seleccionado siempre las mismas dos filas.
    expect(tintedCount(harness)).toBe(2)
    harness.unmount()
  })

  it('collapses the range on an arrow without Shift', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.press('ArrowDown', { shiftKey: true })

    await harness.press('ArrowRight')

    expect(tintedCount(harness)).toBe(0)
    expect(harness.grid.getAttribute('data-range')).toBe('false')
    harness.unmount()
  })

  it('extends to the end of the row with Shift + End', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'id')

    await harness.press('End', { shiftKey: true })

    // Las cinco columnas de la fila, menos el ancla.
    expect(tintedCount(harness)).toBe(4)
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'id' })
    harness.unmount()
  })

  it('selects the whole grid with Ctrl + A', async () => {
    const harness = await mountGrid({}, 12)
    await harness.clickCell(3, 'name')

    await harness.press('a', { ctrlKey: true })

    const event = lastRangeSelect(harness.wrapper)
    expect(event?.rowStart).toBe(0)
    expect(event?.rowEnd).toBe(11)
    expect(event?.columns).toHaveLength(5)
    // El ancla va a la esquina superior izquierda: el rectángulo se define entre
    // las dos puntas, así que dejarla donde estaba habría seleccionado un cuadrante.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'id' })
    harness.unmount()
  })

  it('leaves Ctrl + A to the browser when the range is off', async () => {
    const harness = await mountGrid({ rangeSelection: false })
    await harness.clickCell(1, 'name')

    await harness.press('a', { ctrlKey: true })

    expect(lastRangeSelect(harness.wrapper)).toBeNull()
    harness.unmount()
  })

  it('keeps Shift + Tab meaning "previous cell"', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')

    await harness.press('Tab', { shiftKey: true })

    // Es la única tecla donde `Shift` ya significaba otra cosa, y esa otra cosa
    // la espera todo el mundo. Tabular mueve, así que además colapsa.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'id' })
    expect(tintedCount(harness)).toBe(0)
    harness.unmount()
  })
})

/* ----------------------------------------------------------- Colapsado */

describe('range — collapsing', () => {
  it('collapses when clicking the anchor itself', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(4, 'status')

    // La celda activa no se mueve, así que el camino de selección corta antes de
    // emitir: el colapso tiene que ocurrir igual, y es la forma normal de
    // deshacer un rango.
    await harness.clickCell(1, 'name')

    expect(tintedCount(harness)).toBe(0)
    harness.unmount()
  })

  it('collapses when a new drag starts', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'id')
    await harness.shiftClickCell(5, 'note')

    await harness.dragCells([
      [2, 'name'],
      [3, 'amount'],
    ])

    expect(tintedCount(harness)).toBe(3)
    harness.unmount()
  })

  it('collapses when the editor opens', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(4, 'status')

    await harness.doubleClickCell(2, 'name')

    expect(harness.editor()).not.toBeNull()
    expect(tintedCount(harness)).toBe(0)
    harness.unmount()
  })

  it('collapses when range selection is turned off', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(4, 'status')

    await harness.wrapper.setProps({ rangeSelection: false })
    await harness.flush()

    // Sin esto, el rectángulo sobreviviría a la prop que lo habilitaba y quedaría
    // una selección que ya no se puede mover ni deshacer.
    expect(tintedCount(harness)).toBe(0)
    harness.unmount()
  })

  it('drops the range when the parent moves the controlled active cell', async () => {
    const harness = await mountGrid({ activeCell: { rowIndex: 1, columnKey: 'name' } })
    await harness.shiftClickCell(3, 'status')
    expect(tintedCount(harness)).toBe(8)

    await harness.wrapper.setProps({ activeCell: { rowIndex: 6, columnKey: 'name' } })
    await harness.flush()

    // El ancla se movió por un camino que el rango no ve. Sin descartar el foco
    // viejo, la tabla dibujaría un rectángulo entre la celda nueva y una punta
    // que el usuario eligió para otra: un rango que nadie seleccionó.
    expect(tintedCount(harness)).toBe(0)
    harness.unmount()
  })

  it('collapses when the selection mode stops being `cell`', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(4, 'status')

    await harness.wrapper.setProps({ selectionMode: 'row' })
    await harness.flush()

    expect(tintedCount(harness)).toBe(0)
    harness.unmount()
  })
})

/* -------------------------------------------------------------- Eventos */

describe('range — rangeSelect', () => {
  it('reports the span and the columns it covers', async () => {
    const harness = await mountGrid()

    await harness.dragCells([
      [1, 'name'],
      [3, 'status'],
    ])

    const event = lastRangeSelect(harness.wrapper)
    expect(event?.rowStart).toBe(1)
    expect(event?.rowEnd).toBe(3)
    expect(event?.columns.map((column) => column.key)).toEqual(['name', 'amount', 'status'])
    expect(event?.range).toMatchObject({
      anchor: { rowIndex: 1, columnKey: 'name' },
      focus: { rowIndex: 3, columnKey: 'status' },
    })
    harness.unmount()
  })

  it('reports `range: null` when the selection goes back to a single cell', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(3, 'status')

    await harness.clickCell(1, 'name')

    const event = lastRangeSelect(harness.wrapper)
    // El evento describe siempre lo que está seleccionado ahora: con una sola
    // celda, el rectángulo es el de esa celda y el rango es `null`.
    expect(event?.range).toBeNull()
    expect(event?.rowStart).toBe(1)
    expect(event?.rowEnd).toBe(1)
    expect(event?.columns.map((column) => column.key)).toEqual(['name'])
    harness.unmount()
  })

  it('does not re-announce a drag that stays on the same cell', async () => {
    const harness = await mountGrid()

    await harness.dragCells([
      [1, 'name'],
      [2, 'amount'],
      [2, 'amount'],
    ])

    expect(harness.wrapper.emitted('rangeSelect')).toHaveLength(1)
    harness.unmount()
  })
})

/* ------------------------------------------------------------- Copiado */

describe('range — copying', () => {
  it('copies the range as TSV, with the text each cell shows', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(2, 'status')

    const text = await harness.copy()

    // `status` guarda `'open'` y muestra `'Abierto'`; `amount` guarda 1000 y
    // muestra `1,000`. Copiar el valor crudo sería copiar algo que el usuario no
    // vio nunca.
    expect(text).toBe(['Name 1\t1,000\tCerrado', 'Name 2\t2,000\tAbierto'].join('\n'))
    harness.unmount()
  })

  it('copies the single active cell when there is no range', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'status')

    const text = await harness.copy()

    expect(text).toBe('Abierto')
    harness.unmount()
  })

  it('copies rows that are not painted', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')
    // Sesenta filas: muy por encima de las diez que entran en el viewport y de
    // las que tienen nodo. El texto no puede salir del DOM.
    harness.api.selectRange({
      anchor: { rowIndex: 0, columnKey: 'name' },
      focus: { rowIndex: 59, columnKey: 'name' },
    })
    await harness.flush()

    const text = await harness.copy()

    expect(text?.split('\n')).toHaveLength(60)
    expect(text?.split('\n')[59]).toBe('Name 59')
    harness.unmount()
  })

  it('quotes a value that carries a separator', async () => {
    const rows = makeRows(3)
    rows[1] = { ...rows[1]!, note: 'uno\tdos' }
    const harness = await mountGrid({ rows })
    await harness.clickCell(1, 'note')

    const text = await harness.copy()

    // Sin comillas, esa tabulación partiría la fila y correría todo lo que
    // tuviera a la derecha: el dato pegado quedaría mal sin que nada avise.
    expect(text).toBe('"uno\tdos"')
    harness.unmount()
  })

  it('announces what it copied', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(3, 'amount')

    await harness.copy()

    const event = lastRangeCopy(harness.wrapper)
    expect(event?.rowCount).toBe(3)
    expect(event?.columnCount).toBe(2)
    expect(event?.text.split('\n')).toHaveLength(3)
    harness.unmount()
  })

  it('leaves the copy alone while the editor is open', async () => {
    const harness = await mountGrid()
    await harness.doubleClickCell(1, 'name')

    const text = await harness.copy()

    // El foco está en el `<input>` y el evento burbujea desde ahí: el usuario
    // está copiando lo que seleccionó adentro del control, no la grilla.
    expect(text).toBeNull()
    expect(harness.wrapper.emitted('rangeCopy')).toBeUndefined()
    harness.unmount()
  })

  it('does not touch the clipboard without a selection', async () => {
    const harness = await mountGrid()

    const text = await harness.copy()

    expect(text).toBeNull()
    harness.unmount()
  })

  it('marks the outline of what it copied', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(3, 'status')

    await harness.copy()

    // El portapapeles no deja rastro visible: el cambio de color de la línea es
    // lo único que distingue "se copió" de "el atajo se lo comió otra cosa".
    const flash = harness.wrapper.element.querySelector('.dt-copy-flash')
    expect(flash).not.toBeNull()
    // La misma caja que el recuadro de la selección: tres filas de 40px de alto,
    // desde `name` (offset 120) hasta el final de `status`.
    expect(flash instanceof HTMLElement && flash.style.height).toBe('120px')
    expect(flash instanceof HTMLElement && flash.style.width).toBe('360px')
    harness.unmount()
  })

  it('marks a single cell too, where there is no range box', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'status')

    await harness.copy()

    // Con una sola celda no hay recuadro que teñir: la confirmación es una caja
    // propia, y por eso cubre los dos casos con el mismo código.
    expect(rangeBox(harness)).toBeNull()
    const flash = harness.wrapper.element.querySelector('.dt-copy-flash')
    expect(flash instanceof HTMLElement && flash.style.height).toBe('40px')
    expect(flash instanceof HTMLElement && flash.style.width).toBe('120px')
    harness.unmount()
  })

  it('takes the flash away once it is over', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')

    vi.useFakeTimers()
    try {
      await harness.copy()
      expect(harness.wrapper.element.querySelector('.dt-copy-flash')).not.toBeNull()

      // Holgado respecto de la duración real: lo que se verifica es que el nodo
      // se vaya solo, no el número exacto.
      vi.advanceTimersByTime(2000)
      await harness.flush()

      expect(harness.wrapper.element.querySelector('.dt-copy-flash')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
    harness.unmount()
  })

  it('does not flash when there was nothing to copy', async () => {
    const harness = await mountGrid()

    await harness.copy()

    expect(harness.wrapper.element.querySelector('.dt-copy-flash')).toBeNull()
    harness.unmount()
  })

  it('skips the group headers a range runs over', async () => {
    const harness = await mountGrid({ groupBy: ['status'] }, 6)
    // Con `status` agrupado, la secuencia visible arranca con una cabecera y
    // sigue con las filas del grupo. El rango abarca las dos cosas.
    harness.api.selectRange({
      anchor: { rowIndex: 0, columnKey: 'name' },
      focus: { rowIndex: 3, columnKey: 'name' },
    })
    await harness.flush()

    const text = await harness.copy()

    // Tres líneas y no cuatro: una cabecera no es una fila del dataset y su
    // etiqueta no pertenece a ninguna de las columnas copiadas. Una línea vacía
    // en su lugar metería un hueco en medio de los datos pegados.
    expect(text?.split('\n')).toHaveLength(3)
    expect(lastRangeCopy(harness.wrapper)?.rowCount).toBe(3)
    harness.unmount()
  })
})

/* ----------------------------------------------- Columnas y virtualización */

describe('range — layout and virtualization', () => {
  it('re-resolves the rectangle when a column inside it is hidden', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(1, 'status')

    await harness.wrapper.setProps({ columnVisibility: { amount: false } })
    await harness.flush()

    // El rango se guarda como dos claves, no como una lista de columnas: al
    // ocultar la del medio, el rectángulo se angosta solo. Se comprueba sobre lo
    // que se copia y sobre el tinte, que leen el rectángulo VIVO; `rangeSelect`
    // no vuelve a emitir, porque ocultar una columna no es una selección nueva
    // sino la misma reinterpretada.
    expect(await harness.copy()).toBe('Name 1\tCerrado')
    expect(tintedCount(harness)).toBe(1)
    harness.unmount()
  })

  it('drops the rectangle when an end of the range is hidden', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(1, 'status')

    await harness.wrapper.setProps({ columnVisibility: { status: false } })
    await harness.flush()

    // Igual que la celda activa deja de pintarse cuando ocultan su columna. La
    // selección no se pierde: volver a mostrarla la devuelve.
    expect(harness.grid.getAttribute('data-range')).toBe('false')
    harness.unmount()
  })

  it('keeps the tint on rows that leave the window and come back', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')
    await harness.shiftClickCell(3, 'name')

    await harness.scrollTo({ top: 40 * ROW_HEIGHT })
    await harness.scrollTo({ top: 0 })

    // Los nodos se reciclan: el tinte no puede vivir en el nodo, tiene que
    // volver a salir del estado en cada pintado.
    expect(harness.cell(1, 'name')?.classList.contains('dt-cell--range')).toBe(true)
    expect(tintedCount(harness)).toBe(3)
    harness.unmount()
  })

  it('does not tint anything outside the window', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')
    harness.api.selectRange({
      anchor: { rowIndex: 0, columnKey: 'name' },
      focus: { rowIndex: 80, columnKey: 'name' },
    })
    await harness.flush()

    // Solo hay nodos para la ventana visible más el overscan: el rango abarca 81
    // filas y el DOM no crece por eso.
    expect(tintedCount(harness)).toBeLessThan(20)
    harness.unmount()
  })
})

/* --------------------------------------------------------------- Modos */

describe('range — modes', () => {
  it('does not build a range with `rangeSelection: false`', async () => {
    const harness = await mountGrid({ rangeSelection: false })

    await harness.dragCells([
      [1, 'name'],
      [3, 'status'],
    ])

    expect(tintedCount(harness)).toBe(0)
    // Lo que sí sigue funcionando es la selección de una celda: apagar el rango
    // no apaga el clic.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'name' })
    harness.unmount()
  })

  it('does not build a range in `row` mode', async () => {
    const harness = await mountGrid({ selectionMode: 'row' })

    await harness.dragCells([
      [1, 'name'],
      [3, 'status'],
    ])

    expect(tintedCount(harness)).toBe(0)
    harness.unmount()
  })

  it('ignores selectRange when the range is off', async () => {
    const harness = await mountGrid({ rangeSelection: false })

    harness.api.selectRange({
      anchor: { rowIndex: 1, columnKey: 'name' },
      focus: { rowIndex: 3, columnKey: 'status' },
    })
    await harness.flush()

    expect(tintedCount(harness)).toBe(0)
    expect(lastActiveCell(harness.wrapper)).toBeNull()
    harness.unmount()
  })
})

/* ------------------------------------------------------------ API imperativa */

/* ---------------------------------------- Contrato de la hoja de estilos */

/**
 * La hoja de estilos, leída como archivo y sin comentarios.
 *
 * Se abre con `node:fs` por lo mismo que en `cell-layout.test.ts`: Vitest no
 * procesa CSS, así que un `import '...css?raw'` devolvería una cadena vacía y el
 * test pasaría en verde sin haber leído nada.
 */
const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('range — the copy confirmation, read from the stylesheet', () => {
  /** El cuerpo de la animación del copiado. */
  function keyframes(): string {
    const match = /@keyframes dt-copy-flash\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)
    if (!match) throw new Error('[test] no se encontró la animación del copiado')
    return match[1] ?? ''
  }

  it('starts and ends the line on the accent colour', () => {
    const frames = keyframes()
    const steps = [...frames.matchAll(/(\d+)%\s*\{\s*border-color:\s*([^;]+);/g)].map(
      ([, percent, color]) => [percent, (color ?? '').trim()] as const,
    )

    // El nodo aparece encima de un contorno que YA es del color de acento y
    // desaparece dejándolo ahí: si la animación no empezara y terminara en ese
    // mismo color, se vería un salto al montarlo y otro al quitarlo.
    expect(steps[0]).toEqual(['0', 'var(--dt-primary)'])
    expect(steps[steps.length - 1]).toEqual(['100', 'var(--dt-primary)'])
    expect(steps.some(([, color]) => color === 'var(--dt-copy-flash-color)')).toBe(true)
  })

  it('never animates the opacity of the line', () => {
    // Lo que cambia es el COLOR. Un contorno que se apaga y se enciende compite
    // con el fondo y con el tinte de la selección —que están ahí mismo y con el
    // mismo color de acento— y se pierde; de hecho ese fue el primer intento.
    expect(keyframes()).not.toContain('opacity')
  })

  it('declares the colour as a token on the root, where a theme can override it', () => {
    const root = /\.dt-root\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Tiene que estar en `.dt-root` y no adentro de `.dt-copy-flash`: los
    // selectores de tema apuntan a la raíz, así que es el único lugar desde el
    // que un consumidor puede elegir un color para claro y otro para oscuro.
    expect(root).toMatch(/--dt-copy-flash-color:\s*[^;]+;/)
  })

  it('keeps the same flash colour in dark theme, so white is the default in both', () => {
    const dark = /\.dt-root\[data-theme='dark'\][\s\S]*?\n\}/.exec(STYLESHEET)?.[0] ?? ''

    // El bloque oscuro redefine un montón de tokens; este NO, y es deliberado.
    // Si algún día se lo agregara, un consumidor que eligió su color para oscuro
    // se lo encontraría pisado por una regla más específica que la suya.
    expect(dark).not.toContain('--dt-copy-flash-color')
  })
})

describe('range — selectRange', () => {
  it('moves the active cell to the anchor and brings the focus into view', async () => {
    const harness = await mountGrid()

    harness.api.selectRange({
      anchor: { rowIndex: 30, columnKey: 'name' },
      focus: { rowIndex: 34, columnKey: 'status' },
    })
    await harness.flush()

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 30, columnKey: 'name' })
    // Desplaza hasta el FOCO, que es la punta que interesa ver: la fila 34
    // termina de entrar con el viewport en 35 filas menos las 10 que caben.
    expect(harness.scrollPosition().top).toBe((34 + 1) * ROW_HEIGHT - VIEWPORT.height)
    harness.unmount()
  })

  it('collapses with null', async () => {
    const harness = await mountGrid()
    await harness.clickCell(1, 'name')
    await harness.shiftClickCell(3, 'status')

    harness.api.selectRange(null)
    await harness.flush()

    expect(tintedCount(harness)).toBe(0)
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'name' })
    harness.unmount()
  })
})
