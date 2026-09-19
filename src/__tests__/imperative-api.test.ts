/**
 * La API imperativa que el componente expone con `defineExpose`.
 *
 * Es la única superficie pública que no se puede ejercitar desde las props: se
 * llega por un template ref y se invoca a mano. Eso la deja fuera del alcance de
 * todo el resto de la suite, que opera sobre props, eventos y DOM, y explica que
 * hasta ahora solo se la rozara de costado —`refresh` una vez desde los tests de
 * agrupación, `expandAllGroups` y `collapseAllGroups` desde los de exclusividad
 * de fila, y siempre para verificar otra cosa—. Aquí se verifica el CONTRATO de
 * cada método: qué hace, qué hace en los bordes y qué anuncia.
 *
 * ## Los bordes son el punto
 *
 * Cuatro de los diez métodos reciben una clave de columna, y una clave puede no
 * resolver por dos motivos distintos que el componente trata igual: la columna
 * está oculta, o la clave no existe. "Oculta" llega por una acción normal del
 * usuario —el selector de columnas, un layout restaurado, `defaultVisible:
 * false`—, así que el silencio es deliberado y lo que hay que fijar es qué pasa
 * exactamente en ese silencio. Varios de los tests de aquí abajo existen
 * únicamente para que ese comportamiento no se "arregle" sin querer.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { mountTable, visibleColumnKeys } from './harness'
import type { GridRow, TableHarness, TableProps } from './harness'
import { groupId } from '../internal/aggregations'
import { STORAGE_KEY_PREFIX } from '../internal/constants'
import type {
  CellPosition,
  DataTableColumn,
  DataTableStorageAdapter,
  PersistedTableState,
} from '../types'

/* ------------------------------------------------------------- Andamiaje */

const ROW_HEIGHT = 40
const COLUMN_WIDTH = 120
/** 600 / 120 = 5 columnas enteras; 400 / 40 = 10 filas enteras. */
const VIEWPORT = { width: 600, height: 400 }
const VISIBLE_HEIGHT = VIEWPORT.height
const VISIBLE_WIDTH = VIEWPORT.width

/** Seis columnas de 120px: 720px de canvas contra 600px de viewport. */
const COLUMNS: readonly DataTableColumn<GridRow>[] = [
  { key: 'id', width: COLUMN_WIDTH },
  { key: 'name', width: COLUMN_WIDTH },
  { key: 'amount', width: COLUMN_WIDTH },
  { key: 'status', width: COLUMN_WIDTH },
  { key: 'city', width: COLUMN_WIDTH },
  { key: 'extra', width: COLUMN_WIDTH },
]

const COLUMN_KEYS = COLUMNS.map((column) => column.key)

/** Offset horizontal del borde izquierdo de una columna, en el orden declarado. */
function offsetOf(key: string): number {
  return COLUMN_KEYS.indexOf(key) * COLUMN_WIDTH
}

function makeRows(count: number): GridRow[] {
  const rows: GridRow[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({
      id: index,
      name: `Name ${index}`,
      amount: index * 10,
      status: index % 2 === 0 ? 'open' : 'done',
      city: `City ${index}`,
      extra: `Extra ${index}`,
    })
  }
  return rows
}

const ROW_COUNT = 100

async function mountGrid(
  overrides: Partial<TableProps> = {},
  rows: GridRow[] = makeRows(ROW_COUNT),
): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows,
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      ...overrides,
    },
  })
}

/** Última posición anunciada por `update:activeCell`, ya validada de forma. */
function lastActiveCell(wrapper: VueWrapper): CellPosition | null {
  const events = wrapper.emitted('update:activeCell')
  if (!events || events.length === 0) throw new Error('[test] nunca se emitió update:activeCell')
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

function emissionCount(wrapper: VueWrapper, event: string): number {
  return wrapper.emitted(event)?.length ?? 0
}

/**
 * Estado exacto desde el que la hoja de estilos dibuja el anillo del viewport.
 *
 * Es el prefijo literal de la regla de `styles/datatable.css`, duplicado a
 * propósito igual que en `selection.test.ts`: si alguien cambia la condición,
 * estos tests tienen que enterarse.
 */
const RING_STATE = "[data-focus-ring='true'][data-active-cell='false']"

function paintsRing(harness: TableHarness): boolean {
  return harness.grid.matches(RING_STATE)
}

/** Celda pintada como activa, si la hay. Es la marca que ve el usuario. */
function paintedActiveCell(harness: TableHarness): HTMLElement | null {
  for (const node of harness.canvas.querySelectorAll('.dt-cell--active')) {
    if (node instanceof HTMLElement && !node.hidden) return node
  }
  return null
}

/* ------------------------------------------------------------ scrollToRow */

describe('imperative API — scrollToRow', () => {
  it('leaves the requested index at the top of the viewport', async () => {
    const harness = await mountGrid()

    harness.api.scrollToRow(20)
    await harness.flush()

    expect(harness.scrollPosition().top).toBe(20 * ROW_HEIGHT)
    // Es un salto vertical y nada más: no toca el eje horizontal ni la selección.
    expect(harness.scrollPosition().left).toBe(0)
    expect(emissionCount(harness.wrapper, 'update:activeCell')).toBe(0)
    harness.unmount()
  })

  it('clamps an index past the last row down to the last row', async () => {
    const harness = await mountGrid()

    harness.api.scrollToRow(9_999)
    await harness.flush()

    // El acotado es contra la ÚLTIMA fila, no contra el final del canvas: el
    // método promete dejar ese índice arriba de todo, y la última fila arriba de
    // todo deja el resto del viewport vacío. Es lo prometido, no un defecto.
    expect(harness.scrollPosition().top).toBe((ROW_COUNT - 1) * ROW_HEIGHT)
    harness.unmount()
  })

  it('clamps a negative index up to the first row', async () => {
    const harness = await mountGrid()
    await harness.scrollTo({ top: 800 })

    harness.api.scrollToRow(-5)
    await harness.flush()

    expect(harness.scrollPosition().top).toBe(0)
    harness.unmount()
  })

  it('truncates a fractional index instead of rounding it', async () => {
    const harness = await mountGrid()

    harness.api.scrollToRow(3.9)
    await harness.flush()

    // `Math.floor`, no `Math.round`: la fila 3.9 no existe, y la fila que la
    // contiene es la 3.
    expect(harness.scrollPosition().top).toBe(3 * ROW_HEIGHT)
    harness.unmount()
  })

  it('stays put and does not throw with no rows at all', async () => {
    const harness = await mountGrid({}, [])

    harness.api.scrollToRow(5)
    await harness.flush()

    // Sin filas, el máximo acotado es 0 y el mínimo también: el único destino
    // posible es el origen.
    expect(harness.scrollPosition().top).toBe(0)
    harness.unmount()
  })

  it('counts group headers, because the index walks the visible sequence', async () => {
    const harness = await mountGrid({ groupBy: ['status'] })

    harness.api.scrollToRow(3)
    await harness.flush()

    // Con `status` agrupado, las posiciones 0 y 1 son la cabecera de `open` y su
    // primera fila: el índice NO indexa `rows`, indexa lo que se ve.
    expect(harness.scrollPosition().top).toBe(3 * ROW_HEIGHT)
    expect(harness.grid.getAttribute('role')).toBe('treegrid')
    harness.unmount()
  })
})

/* --------------------------------------------------------- scrollToColumn */

describe('imperative API — scrollToColumn', () => {
  it('puts the left edge of the column at the left edge of the viewport', async () => {
    const harness = await mountGrid()

    harness.api.scrollToColumn('extra')
    await harness.flush()

    expect(harness.scrollPosition().left).toBe(offsetOf('extra'))
    // Alineado al borde izquierdo, no "lo mínimo necesario": eso es
    // `scrollToCell`. Son dos métodos con dos promesas distintas.
    expect(harness.scrollPosition().top).toBe(0)
    harness.unmount()
  })

  it('does nothing for an unknown column key', async () => {
    const harness = await mountGrid()
    await harness.scrollTo({ left: 60 })

    harness.api.scrollToColumn('nope')
    await harness.flush()

    expect(harness.scrollPosition().left).toBe(60)
    harness.unmount()
  })

  it('does nothing for a hidden column, exactly like for an unknown one', async () => {
    const harness = await mountGrid({ columnVisibility: { status: false } })
    await harness.scrollTo({ left: 60 })

    // Una columna oculta no tiene borde izquierdo al que llevar la vista, igual
    // que una que no existe. El no-op es silencioso a propósito: ocultar una
    // columna es una acción corriente del usuario y avisar por consola convertiría
    // el uso normal en ruido.
    harness.api.scrollToColumn('status')
    await harness.flush()

    expect(harness.scrollPosition().left).toBe(60)
    expect(visibleColumnKeys(harness.canvas)).not.toContain('status')
    harness.unmount()
  })
})

/* ----------------------------------------------------------- scrollToCell */

describe('imperative API — scrollToCell', () => {
  it('moves both axes by the minimum needed', async () => {
    const harness = await mountGrid()

    harness.api.scrollToCell({ rowIndex: 20, columnKey: 'extra' })
    await harness.flush()

    // Mínimo, no centrado: la fila 20 queda pegada al borde INFERIOR y la
    // columna `extra` al borde DERECHO, que es el desplazamiento más chico que
    // las deja visibles.
    expect(harness.scrollPosition().top).toBe(21 * ROW_HEIGHT - VISIBLE_HEIGHT)
    expect(harness.scrollPosition().left).toBe(offsetOf('extra') + COLUMN_WIDTH - VISIBLE_WIDTH)
    harness.unmount()
  })

  it('does not move at all when the cell is already visible', async () => {
    const harness = await mountGrid()

    harness.api.scrollToCell({ rowIndex: 2, columnKey: 'name' })
    await harness.flush()

    // Es la razón de ser del ajuste mínimo: navegando con flechas, moverse
    // dentro de la ventana no tiene que producir ningún salto.
    expect(harness.scrollPosition()).toEqual({ top: 0, left: 0 })
    harness.unmount()
  })

  it('scrolls the ROW axis but leaves scrollLeft alone for a HIDDEN column', async () => {
    const harness = await mountGrid({ columnVisibility: { extra: false } })

    harness.api.scrollToCell({ rowIndex: 20, columnKey: 'extra' })
    await harness.flush()

    // GUARDA DE REGRESIÓN. Esto NO es un caso a medio resolver: los dos ejes son
    // coordenadas independientes, y `rowIndex` sigue siendo un número de fila
    // válido sin importar qué diga `columnKey`. Se resuelve el eje sobre el que
    // había información y se deja quieto el otro.
    //
    // Convertirlo en un no-op rompería el caso ordinario de una celda activa
    // cuya columna el usuario acaba de ocultar: la navegación vertical dejaría
    // de traer filas a la vista por un motivo ajeno al eje vertical.
    expect(harness.scrollPosition().top).toBe(21 * ROW_HEIGHT - VISIBLE_HEIGHT)
    expect(harness.scrollPosition().left).toBe(0)
    harness.unmount()
  })

  it('behaves identically for an unknown column key', async () => {
    const harness = await mountGrid()

    harness.api.scrollToCell({ rowIndex: 20, columnKey: 'nope' })
    await harness.flush()

    // Misma respuesta que con la columna oculta, y es el punto: desde la
    // geometría, "está oculta" y "no existe" son indistinguibles.
    expect(harness.scrollPosition().top).toBe(21 * ROW_HEIGHT - VISIBLE_HEIGHT)
    expect(harness.scrollPosition().left).toBe(0)
    harness.unmount()
  })

  it('leaves the horizontal axis alone even when it was already scrolled', async () => {
    const harness = await mountGrid({ columnVisibility: { extra: false } })
    await harness.scrollTo({ left: 60 })

    harness.api.scrollToCell({ rowIndex: 20, columnKey: 'extra' })
    await harness.flush()

    // "No se mueve" es literal: no se reinicia a 0, se queda donde estaba.
    expect(harness.scrollPosition().left).toBe(60)
    harness.unmount()
  })

  it('does not reject an out-of-range row index, unlike scrollToRow', async () => {
    const clamping = await mountGrid()
    clamping.api.scrollToRow(9_999)
    await clamping.flush()
    const clamped = clamping.scrollPosition().top
    clamping.unmount()

    const harness = await mountGrid()
    harness.api.scrollToCell({ rowIndex: 9_999, columnKey: 'name' })
    await harness.flush()

    // La asimetría es DELIBERADA y responde a de dónde viene cada índice.
    // `scrollToRow` es un salto absoluto que el consumidor pide con un número
    // suelto, y acotar el ÍNDICE convierte un fuera de rango en el borde más
    // cercano en vez de en una posición vacía: se va a la última fila REAL.
    // `scrollToCell` no acota el índice —la posición que llega ya viene acotada
    // por `moveActiveTo`, el camino interno de navegación— y por eso apunta más
    // abajo: al final del contenido, no a la última fila.
    //
    // Esa diferencia de una fila es todo lo que queda de la asimetría. Antes de
    // las alturas variables, `scrollToCell` pedía una posición absurda —la fila
    // 10.000 de una tabla de 100— y era el navegador el que la acotaba. Ahora la
    // acota la geometría, que no puede decir dónde empieza una fila que no
    // existe. Lo que se VE es lo mismo en los dos casos: la vista se queda en el
    // extremo.
    expect(clamped).toBe((ROW_COUNT - 1) * ROW_HEIGHT)
    expect(harness.scrollPosition().top).toBe(ROW_COUNT * ROW_HEIGHT + ROW_HEIGHT - VISIBLE_HEIGHT)
    // Y sigue pidiendo una posición que el contenido NO tiene: el máximo real
    // es el alto total menos el viewport. Eso es lo que significa no acotar el
    // índice, y es lo que el navegador termina emparejando.
    expect(harness.scrollPosition().top).toBeGreaterThan(ROW_COUNT * ROW_HEIGHT - VISIBLE_HEIGHT)
    harness.unmount()
  })

  it('does not move the selection', async () => {
    const harness = await mountGrid()

    harness.api.scrollToCell({ rowIndex: 20, columnKey: 'extra' })
    await harness.flush()

    // Desplazar y seleccionar son dos cosas distintas. La que hace las dos es
    // `selectCell`.
    expect(emissionCount(harness.wrapper, 'update:activeCell')).toBe(0)
    expect(paintedActiveCell(harness)).toBeNull()
    harness.unmount()
  })
})

/* ------------------------------------------------------------- selectCell */

describe('imperative API — selectCell', () => {
  it('fixes the active cell and announces it twice over', async () => {
    const harness = await mountGrid()

    harness.api.selectCell({ rowIndex: 2, columnKey: 'name' })
    await harness.flush()

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'name' })
    // `cellSelect` es el evento rico: lleva la fila, la columna y el valor.
    const selected = harness.wrapper.emitted('cellSelect')
    expect(selected).toHaveLength(1)
    expect(selected?.[0]?.[0]).toMatchObject({ rowIndex: 2, columnKey: 'name', value: 'Name 2' })
    expect(paintedActiveCell(harness)).not.toBeNull()
    harness.unmount()
  })

  it('brings the cell into view, which an internal selection does not do', async () => {
    const harness = await mountGrid()

    harness.api.selectCell({ rowIndex: 60, columnKey: 'extra' })
    await harness.flush()

    // Es la diferencia entera con el `selectCell` interno: quien llama por
    // código —un resultado de búsqueda, un enlace profundo— no tiene forma de
    // saber si esa celda estaba en la ventana.
    expect(harness.scrollPosition().top).toBe(61 * ROW_HEIGHT - VISIBLE_HEIGHT)
    expect(harness.scrollPosition().left).toBe(offsetOf('extra') + COLUMN_WIDTH - VISIBLE_WIDTH)
    harness.unmount()
  })

  it('clears the selection with null and scrolls nowhere', async () => {
    const harness = await mountGrid()
    harness.api.selectCell({ rowIndex: 2, columnKey: 'name' })
    await harness.flush()
    const before = harness.scrollPosition()

    harness.api.selectCell(null)
    await harness.flush()

    expect(lastActiveCell(harness.wrapper)).toBeNull()
    expect(harness.scrollPosition()).toEqual(before)
    expect(paintedActiveCell(harness)).toBeNull()
    harness.unmount()
  })

  it('does not re-announce a position that is already the active one', async () => {
    const harness = await mountGrid()

    harness.api.selectCell({ rowIndex: 2, columnKey: 'name' })
    await harness.flush()
    harness.api.selectCell({ rowIndex: 2, columnKey: 'name' })
    await harness.flush()

    // La comparación es por valor, no por identidad de objeto: dos literales
    // distintos con la misma posición son la misma posición.
    expect(emissionCount(harness.wrapper, 'update:activeCell')).toBe(1)
    expect(emissionCount(harness.wrapper, 'cellSelect')).toBe(1)
    harness.unmount()
  })

  it('commits an unknown column but announces no cellSelect for it', async () => {
    const harness = await mountGrid()

    harness.api.selectCell({ rowIndex: 2, columnKey: 'nope' })
    await harness.flush()

    // La posición se guarda tal cual se pidió: el componente no inventa una
    // distinta ni la descarta en silencio.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'nope' })
    // Pero `cellSelect` no se puede emitir: no hay columna que reportar ni valor
    // que leer.
    expect(emissionCount(harness.wrapper, 'cellSelect')).toBe(0)
    expect(paintedActiveCell(harness)).toBeNull()
    harness.unmount()
  })

  it('commits a hidden column but announces no cellSelect for it either', async () => {
    const harness = await mountGrid({ columnVisibility: { status: false } })

    harness.api.selectCell({ rowIndex: 2, columnKey: 'status' })
    await harness.flush()

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'status' })
    expect(emissionCount(harness.wrapper, 'cellSelect')).toBe(0)
    expect(paintedActiveCell(harness)).toBeNull()
    harness.unmount()
  })

  it('commits an out-of-range row index without announcing a cellSelect', async () => {
    const harness = await mountGrid()

    harness.api.selectCell({ rowIndex: 9_999, columnKey: 'name' })
    await harness.flush()

    // Mismo reparto que con la columna: la posición se anuncia porque es la que
    // se pidió, y el evento rico se calla porque no hay fila que adjuntarle.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 9_999, columnKey: 'name' })
    expect(emissionCount(harness.wrapper, 'cellSelect')).toBe(0)
    harness.unmount()
  })

  it('commits a position on an empty table without announcing a cellSelect', async () => {
    const harness = await mountGrid({}, [])

    harness.api.selectCell({ rowIndex: 0, columnKey: 'name' })
    await harness.flush()

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'name' })
    expect(emissionCount(harness.wrapper, 'cellSelect')).toBe(0)
    harness.unmount()
  })
})

/* ----------------------------- El anillo de foco y una selección invisible */

describe('imperative API — the focus ring never hides behind an invisible selection', () => {
  it('suppresses the ring for a selection that does paint a cell', async () => {
    const harness = await mountGrid({ focusRing: true })
    expect(paintsRing(harness)).toBe(true)

    harness.api.selectCell({ rowIndex: 2, columnKey: 'name' })
    await harness.flush()

    // El caso normal no cambia: con la celda marcada, encerrar además la tabla
    // entera serían dos señales para una sola posición.
    expect(harness.grid.getAttribute('data-active-cell')).toBe('true')
    expect(paintsRing(harness)).toBe(false)
    harness.unmount()
  })

  it('keeps the ring for a selection on an unknown column, which paints nothing', async () => {
    const harness = await mountGrid({ focusRing: true })

    harness.api.selectCell({ rowIndex: 2, columnKey: 'nope' })
    await harness.flush()

    // El defecto que esto fija: la posición se comprometía, el atributo decía
    // `'true'` y el anillo se apagaba, pero NINGUNA celda se pintaba activa. La
    // tabla quedaba enfocada sin una sola señal visible de dónde estaba parado
    // el usuario.
    expect(paintedActiveCell(harness)).toBeNull()
    expect(harness.grid.getAttribute('data-active-cell')).toBe('false')
    expect(paintsRing(harness)).toBe(true)
    harness.unmount()
  })

  it('keeps the ring for a selection on a hidden column', async () => {
    const harness = await mountGrid({ focusRing: true, columnVisibility: { status: false } })

    harness.api.selectCell({ rowIndex: 2, columnKey: 'status' })
    await harness.flush()

    expect(paintedActiveCell(harness)).toBeNull()
    expect(harness.grid.getAttribute('data-active-cell')).toBe('false')
    expect(paintsRing(harness)).toBe(true)
    harness.unmount()
  })

  it('gives the ring back when the active column is hidden and takes it away when it returns', async () => {
    const harness = await mountGrid({ focusRing: true })

    harness.api.selectCell({ rowIndex: 2, columnKey: 'amount' })
    await harness.flush()
    expect(paintsRing(harness)).toBe(false)

    // Estado legítimo, y la razón por la que el anillo tiene que volver: el
    // usuario oculta la columna donde estaba parado. La selección NO se pierde
    // —sigue guardada y ya se anunció—, pero deja de tener marca en pantalla, y
    // el anillo pasa a ser la única señal que le queda a quien navega por
    // teclado.
    await harness.wrapper.setProps({ columnVisibility: { amount: false } })
    await harness.flush()

    expect(paintedActiveCell(harness)).toBeNull()
    expect(paintsRing(harness)).toBe(true)
    // La posición sobrevive intacta: lo que cambió es lo que se le cuenta a la
    // hoja de estilos, no la selección.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'amount' })

    await harness.wrapper.setProps({ columnVisibility: { amount: true } })
    await harness.flush()

    expect(paintedActiveCell(harness)).not.toBeNull()
    expect(paintsRing(harness)).toBe(false)
    harness.unmount()
  })
})

/* ---------------------------- La reparación de la flecha, que se conserva */

describe('keyboard — the arrow key recovers from an active column that paints nothing', () => {
  /** Deja la celda activa sobre una columna y después la oculta. */
  async function selectThenHide(columnKey: string): Promise<TableHarness> {
    const harness = await mountGrid()
    harness.api.selectCell({ rowIndex: 3, columnKey })
    await harness.flush()
    await harness.wrapper.setProps({ columnVisibility: { [columnKey]: false } })
    await harness.flush()
    return harness
  }

  it('re-enters at the second visible column on ArrowRight', async () => {
    const harness = await selectThenHide('amount')

    await harness.press('ArrowRight')

    // El `Math.max(activeColumnIndex, 0)` de `moveActiveBy` es una RECUPERACIÓN
    // y se conserva a propósito: sin él, la flecha no haría nada y el usuario
    // quedaría atrapado en una selección que no ve y de la que no puede salir
    // con el teclado. Un teclado que no responde es peor accesibilidad que un
    // reingreso predecible.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'name' })
    harness.unmount()
  })

  it('re-enters at the first visible column on ArrowLeft', async () => {
    const harness = await selectThenHide('amount')

    await harness.press('ArrowLeft')

    // Hacia la izquierda el índice recuperado da -1 y el acotado de
    // `moveActiveTo` lo lleva a la primera columna.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'id' })
    harness.unmount()
  })

  it('keeps the row index while the column axis recovers on ArrowDown', async () => {
    const harness = await selectThenHide('amount')

    await harness.press('ArrowDown')

    // El eje vertical nunca estuvo roto: la fila avanza una, como siempre. Lo
    // único que se repara es la columna.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 4, columnKey: 'id' })
    harness.unmount()
  })

  it('paints a cell again after the recovery, which brings the ring back down', async () => {
    const harness = await mountGrid({ focusRing: true })
    harness.api.selectCell({ rowIndex: 3, columnKey: 'amount' })
    await harness.flush()
    await harness.wrapper.setProps({ columnVisibility: { amount: false } })
    await harness.flush()
    expect(paintsRing(harness)).toBe(true)

    await harness.press('ArrowRight')

    // La recuperación cierra el círculo: vuelve a haber una celda pintada, así
    // que el anillo vuelve a sobrar.
    expect(paintedActiveCell(harness)).not.toBeNull()
    expect(paintsRing(harness)).toBe(false)
    harness.unmount()
  })
})

/* ---------------------------------------------------------------- refresh */

/** Cuatro filas en dos grupos, con un agregado por suma sobre `amount`. */
const GROUP_COLUMNS: readonly DataTableColumn<GridRow>[] = [
  { key: 'id', width: COLUMN_WIDTH },
  { key: 'status', width: COLUMN_WIDTH },
  { key: 'amount', width: COLUMN_WIDTH, aggregate: 'sum' },
]

function groupedRows(): GridRow[] {
  return [
    { id: 0, status: 'open', amount: 10 },
    { id: 1, status: 'open', amount: 20 },
    { id: 2, status: 'done', amount: 30 },
    { id: 3, status: 'done', amount: 40 },
  ]
}

/** Cabecera de grupo pintada, buscada por su id y no por su posición en el DOM. */
function groupHeader(harness: TableHarness, id: string): HTMLElement | null {
  for (const node of harness.canvas.querySelectorAll('.dt-group-row')) {
    if (!(node instanceof HTMLElement) || node.hidden) continue
    if (node.dataset.rowKey === id) return node
  }
  return null
}

/** Contador y suma que anuncia una cabecera de grupo. */
function groupSummary(harness: TableHarness, id: string): { count: string; total: string } {
  const header = groupHeader(harness, id)
  if (!header) throw new Error(`[test] no está pintada la cabecera "${id}"`)
  return {
    count: header.querySelector('.dt-group-count')?.textContent ?? '',
    total: header.querySelector('.dt-group-aggregate')?.textContent ?? '',
  }
}

const OPEN_GROUP = groupId(['status', 'open'])
const DONE_GROUP = groupId(['status', 'done'])

describe('imperative API — refresh', () => {
  it('repaints a cell mutated in place, which nothing else can observe', async () => {
    const rows = makeRows(20)
    const harness = await mountGrid({}, rows)
    expect(harness.cell(0, 'name')?.textContent).toBe('Name 0')

    const first = rows[0]
    if (!first) throw new Error('[test] falta la fila 0')
    first.name = 'Mutated'
    await harness.flush()

    // Sin `refresh()` no pasa nada: mutar el objeto no cambia la identidad de
    // `rows`, así que ningún watcher agenda un frame. Es exactamente el agujero
    // que el método existe para tapar.
    expect(harness.cell(0, 'name')?.textContent).toBe('Name 0')

    harness.api.refresh()
    await harness.flush()

    expect(harness.cell(0, 'name')?.textContent).toBe('Mutated')
    harness.unmount()
  })

  it('rebuilds the group tree, so counts and aggregates refresh too', async () => {
    const rows = groupedRows()
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows,
        columns: GROUP_COLUMNS,
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
        groupBy: ['status'],
      },
    })

    expect(groupSummary(harness, OPEN_GROUP)).toEqual({ count: '2', total: '30' })
    expect(groupSummary(harness, DONE_GROUP)).toEqual({ count: '2', total: '70' })

    // La mutación cambia de grupo a la fila 3 Y su aporte al agregado: es el
    // caso donde el caché de celdas del pool no alcanza, porque los contadores y
    // las sumas salen del ÁRBOL, que se reconstruye por identidad de `rows`.
    const moved = rows[3]
    if (!moved) throw new Error('[test] falta la fila 3')
    moved.status = 'open'
    moved.amount = 100

    harness.api.refresh()
    await harness.flush()

    expect(groupSummary(harness, OPEN_GROUP)).toEqual({ count: '3', total: '130' })
    expect(groupSummary(harness, DONE_GROUP)).toEqual({ count: '1', total: '30' })
    harness.unmount()
  })

  it('is harmless with grouping off', async () => {
    const harness = await mountGrid()

    harness.api.refresh()
    await harness.flush()

    // Sin agrupación, `rebuild()` es un no-op y el método se reduce a invalidar
    // el caché y pedir un frame. Ni la vista ni la selección se mueven.
    expect(harness.scrollPosition()).toEqual({ top: 0, left: 0 })
    expect(emissionCount(harness.wrapper, 'update:activeCell')).toBe(0)
    expect(harness.cell(0, 'name')?.textContent).toBe('Name 0')
    harness.unmount()
  })
})

/* --------------------------------------------- resetLayout y persistencia */

const TABLE_ID = 'imperative'
const STORAGE_KEY = `${STORAGE_KEY_PREFIX}${TABLE_ID}`

/** Adaptador espía con las tres operaciones registradas. */
function createSpyAdapter(load: DataTableStorageAdapter['load'] = () => null) {
  const save = vi.fn()
  const remove = vi.fn()
  return { adapter: { load, save, remove } satisfies DataTableStorageAdapter, save, remove }
}

/** Layout guardado que toca las cinco cosas que `resetLayout` tiene que limpiar. */
function savedLayout(): PersistedTableState {
  return {
    version: 1,
    columnVisibility: { amount: false },
    columnWidths: { id: 200 },
    columnOrder: ['name', 'id', 'amount', 'status', 'city', 'extra'],
    groupBy: ['status'],
    collapsedGroups: [groupId(['status', 'open'])],
  }
}

describe('imperative API — resetLayout', () => {
  it('erases the stored layout', async () => {
    const { adapter, remove } = createSpyAdapter()
    const harness = await mountGrid({ tableId: TABLE_ID, persist: { adapter } })

    harness.api.resetLayout()
    await harness.flush()

    expect(remove).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY)
    harness.unmount()
  })

  it('erases the live state too, not only the storage', async () => {
    const { adapter } = createSpyAdapter(() => savedLayout())
    const harness = await mountGrid({ tableId: TABLE_ID, persist: { adapter } })

    // El layout guardado ya está aplicado: `name` adelante, `amount` oculta.
    expect(visibleColumnKeys(harness.canvas)).toEqual(['name', 'id', 'status', 'city', 'extra'])

    harness.api.resetLayout()
    await harness.flush()

    // Borrar solo el almacenamiento dejaría al usuario mirando exactamente la
    // configuración que quiso descartar hasta el próximo reload.
    expect(visibleColumnKeys(harness.canvas)).toEqual([...COLUMN_KEYS])
    harness.unmount()
  })

  it('announces every piece of state it cleared', async () => {
    const { adapter } = createSpyAdapter(() => savedLayout())
    const harness = await mountGrid({ tableId: TABLE_ID, persist: { adapter } })

    harness.api.resetLayout()
    await harness.flush()

    // Se emite siempre, controlado o no: es lo que le permite a un padre que sí
    // controla el estado enterarse y decidir.
    const lastOf = (event: string): unknown => {
      const events = harness.wrapper.emitted(event)
      if (!events || events.length === 0) throw new Error(`[test] nunca se emitió ${event}`)
      return events[events.length - 1]?.[0]
    }
    expect(lastOf('update:columnVisibility')).toEqual({})
    expect(lastOf('update:columnWidths')).toEqual({})
    expect(lastOf('update:columnOrder')).toEqual([])
    expect(lastOf('update:groupBy')).toEqual([])
    expect(lastOf('update:expandedGroups')).toEqual([])
    harness.unmount()
  })

  it('clears groupBy and the collapsed groups, not just the columns', async () => {
    const { adapter } = createSpyAdapter(() => savedLayout())
    const harness = await mountGrid({ tableId: TABLE_ID, persist: { adapter } })

    // Restaurado: la tabla es un árbol y el grupo `open` vino plegado.
    expect(harness.grid.getAttribute('role')).toBe('treegrid')
    expect(groupHeader(harness, OPEN_GROUP)?.getAttribute('aria-expanded')).toBe('false')

    harness.api.resetLayout()
    await harness.flush()

    // Vuelve a ser una grilla plana: sin agrupación no hay cabeceras que plegar.
    expect(harness.grid.getAttribute('role')).toBe('grid')
    expect(harness.canvas.querySelector('.dt-group-row:not([hidden])')).toBeNull()
    harness.unmount()
  })

  it('does nothing to the storage when persistence is off', async () => {
    const { adapter, remove } = createSpyAdapter()
    const harness = await mountGrid({ persist: { adapter } })

    // Sin `tableId` la persistencia queda desactivada, y `clear()` no tiene
    // ninguna clave que borrar. El estado vivo sí se limpia igual.
    harness.api.resetLayout()
    await harness.flush()

    expect(remove).not.toHaveBeenCalled()
    expect(visibleColumnKeys(harness.canvas)).toEqual([...COLUMN_KEYS])
    harness.unmount()
  })
})

describe('imperative API — flushPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes a pending debounced save immediately', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = await mountGrid({ tableId: TABLE_ID, persist: { adapter, debounce: 300 } })

    await harness.wrapper.setProps({ columnVisibility: { amount: false } })
    await harness.flush()

    // El debounce existe porque arrastrar el borde de una columna emite un
    // `pointermove` por frame y `setItem` es sincrónico: escribir a 60Hz es jank
    // real. Todavía no se escribió nada.
    expect(save).not.toHaveBeenCalled()

    harness.api.flushPersistence()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toBe(STORAGE_KEY)
    expect(save.mock.calls[0]?.[1]).toMatchObject({ columnVisibility: { amount: false } })

    // Y lo pendiente se canceló: el timer que ya no tiene nada que escribir no
    // puede producir una segunda escritura.
    vi.advanceTimersByTime(1_000)
    expect(save).toHaveBeenCalledTimes(1)
    harness.unmount()
  })

  it('writes nothing when there is no pending save', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = await mountGrid({ tableId: TABLE_ID, persist: { adapter, debounce: 300 } })

    harness.api.flushPersistence()

    // No es "escribe el estado actual por las dudas": vuelca lo PENDIENTE, y sin
    // nada pendiente no hay nada que volcar.
    expect(save).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('writes nothing when persistence is off', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = await mountGrid({ persist: { adapter, debounce: 300 } })

    await harness.wrapper.setProps({ columnVisibility: { amount: false } })
    await harness.flush()
    harness.api.flushPersistence()

    expect(save).not.toHaveBeenCalled()
    harness.unmount()
  })
})

/* -------------------------------------------------- Los métodos de grupo */

async function mountGrouped(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: groupedRows(),
      columns: GROUP_COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      groupBy: ['status'],
      ...overrides,
    },
  })
}

function isCollapsed(harness: TableHarness, id: string): boolean {
  return groupHeader(harness, id)?.getAttribute('aria-expanded') === 'false'
}

/** Última lista anunciada por `update:expandedGroups`. */
function lastExpanded(wrapper: VueWrapper): unknown {
  const events = wrapper.emitted('update:expandedGroups')
  if (!events || events.length === 0)
    throw new Error('[test] nunca se emitió update:expandedGroups')
  return events[events.length - 1]?.[0]
}

describe('imperative API — toggleGroup', () => {
  it('flips a group and announces both the toggle and the new expanded set', async () => {
    const harness = await mountGrouped()
    expect(isCollapsed(harness, OPEN_GROUP)).toBe(false)

    harness.api.toggleGroup(OPEN_GROUP)
    await harness.flush()

    expect(isCollapsed(harness, OPEN_GROUP)).toBe(true)
    expect(harness.wrapper.emitted('groupToggle')?.[0]?.[0]).toEqual({
      groupId: OPEN_GROUP,
      expanded: false,
    })
    expect(lastExpanded(harness.wrapper)).toEqual([DONE_GROUP])
    harness.unmount()
  })

  it('flips the same group back', async () => {
    const harness = await mountGrouped()

    harness.api.toggleGroup(OPEN_GROUP)
    await harness.flush()
    harness.api.toggleGroup(OPEN_GROUP)
    await harness.flush()

    expect(isCollapsed(harness, OPEN_GROUP)).toBe(false)
    expect(emissionCount(harness.wrapper, 'groupToggle')).toBe(2)
    harness.unmount()
  })

  it('announces an unknown group id but changes nothing in the tree', async () => {
    const harness = await mountGrouped()

    harness.api.toggleGroup('status:ghost')
    await harness.flush()

    // El evento sale igual, porque el método reporta lo que se le pidió y no
    // consulta el árbol para decidirlo. Lo que no ocurre es ningún cambio: la
    // lista de expandidos se arma recorriendo los grupos que EXISTEN, así que un
    // id fantasma no puede colarse en ella ni esconder una cabecera.
    expect(harness.wrapper.emitted('groupToggle')?.[0]?.[0]).toEqual({
      groupId: 'status:ghost',
      expanded: false,
    })
    expect(lastExpanded(harness.wrapper)).toEqual([OPEN_GROUP, DONE_GROUP])
    expect(isCollapsed(harness, OPEN_GROUP)).toBe(false)
    expect(isCollapsed(harness, DONE_GROUP)).toBe(false)
    harness.unmount()
  })

  it('does nothing at all with grouping off', async () => {
    const harness = await mountGrouped({ groupBy: [] })

    harness.api.toggleGroup(OPEN_GROUP)
    await harness.flush()

    expect(harness.grid.getAttribute('role')).toBe('grid')
    expect(lastExpanded(harness.wrapper)).toEqual([])
    harness.unmount()
  })
})

describe('imperative API — expandAllGroups and collapseAllGroups', () => {
  it('collapses every group in the current tree and announces an empty set', async () => {
    const harness = await mountGrouped()

    harness.api.collapseAllGroups()
    await harness.flush()

    expect(isCollapsed(harness, OPEN_GROUP)).toBe(true)
    expect(isCollapsed(harness, DONE_GROUP)).toBe(true)
    expect(lastExpanded(harness.wrapper)).toEqual([])
    // Colapsar deja solo las cabeceras: las filas de datos dejan de existir en
    // la secuencia visible.
    expect(harness.grid.getAttribute('aria-rowcount')).toBe('3')
    harness.unmount()
  })

  it('expands every group again and announces the full set', async () => {
    const harness = await mountGrouped()
    harness.api.collapseAllGroups()
    await harness.flush()

    harness.api.expandAllGroups()
    await harness.flush()

    expect(isCollapsed(harness, OPEN_GROUP)).toBe(false)
    expect(isCollapsed(harness, DONE_GROUP)).toBe(false)
    expect(lastExpanded(harness.wrapper)).toEqual([OPEN_GROUP, DONE_GROUP])
    // Dos cabeceras más cuatro filas, más la de encabezado de la grilla.
    expect(harness.grid.getAttribute('aria-rowcount')).toBe('7')
    harness.unmount()
  })

  it('reaches a group that is not painted, because it works on the tree and not on the DOM', async () => {
    const rows: GridRow[] = []
    for (let index = 0; index < 60; index += 1) {
      rows.push({ id: index, status: `bucket-${index % 20}`, amount: index })
    }
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows,
        columns: GROUP_COLUMNS,
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
        groupBy: ['status'],
      },
    })

    harness.api.collapseAllGroups()
    await harness.flush()

    // 20 grupos, de los que el viewport pinta un puñado. El método no recorre
    // nodos: recorre el árbol, así que los 20 se pliegan igual.
    expect(harness.grid.getAttribute('aria-rowcount')).toBe('21')
    expect(lastExpanded(harness.wrapper)).toEqual([])
    harness.unmount()
  })

  it('are harmless no-ops with grouping off', async () => {
    const harness = await mountGrouped({ groupBy: [] })

    harness.api.collapseAllGroups()
    await harness.flush()
    harness.api.expandAllGroups()
    await harness.flush()

    expect(harness.grid.getAttribute('role')).toBe('grid')
    expect(harness.grid.getAttribute('aria-rowcount')).toBe('5')
    expect(lastExpanded(harness.wrapper)).toEqual([])
    harness.unmount()
  })
})

/* ----------------------------------------------------- El contrato entero */

describe('imperative API — the exposed surface', () => {
  it('exposes exactly the ten documented methods and nothing less', async () => {
    const harness = await mountGrid()

    // `TableHarness.api` está tipado como `DataTableInstance`, así que este
    // barrido es el que convierte ese tipo en una verificación real: cada
    // miembro se busca en tiempo de ejecución sobre lo que `defineExpose`
    // entregó, y falla nombrando al que falte.
    expect(() => {
      harness.api.scrollToRow(0)
      harness.api.scrollToColumn('id')
      harness.api.scrollToCell({ rowIndex: 0, columnKey: 'id' })
      harness.api.selectCell(null)
      harness.api.refresh()
      harness.api.resetLayout()
      harness.api.flushPersistence()
      harness.api.toggleGroup('nothing')
      harness.api.expandAllGroups()
      harness.api.collapseAllGroups()
    }).not.toThrow()

    harness.unmount()
  })
})
