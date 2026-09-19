/**
 * Mover columnas arrastrando su encabezado.
 *
 * ## Qué protege este archivo
 *
 * Que el arrastre no trae un modelo propio. Lo único que produce es una escritura
 * sobre `columnOrder`, que ya existía, ya se reconciliaba contra las columnas
 * declaradas y ya se persistía: la UI es una forma de mover ese estado con el
 * mouse, no un segundo lugar donde vive el orden.
 *
 * Y dos invariantes que se rompen en silencio:
 *
 * 1. **El umbral.** Sobre el mismo encabezado conviven dos gestos —seleccionar
 *    la columna y moverla—, y lo único que los distingue es cuánto se movió el
 *    puntero. Sin umbral, el temblor de la mano al hacer clic reordena la tabla.
 * 2. **Las columnas OCULTAS.** El arrastre ocurre entre las visibles y el orden
 *    que se emite las contiene a todas. Traducir por índice numérico corre la
 *    cuenta en cuanto hay una oculta en el medio; la traducción va por clave.
 */

import { describe, expect, it } from 'vitest'
import { mountTable } from './harness'
import type { TableHarness, TableProps } from './harness'

type Row = { id: number; name: string; amount: number; city: string }

const ROW_HEIGHT = 40
const VIEWPORT = { width: 600, height: 400 }
const COLUMN_WIDTH = 120

function makeRows(count: number): Row[] {
  const rows: Row[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({ id: index, name: `Name ${index}`, amount: index * 10, city: `City ${index}` })
  }
  return rows
}

const COLUMNS = [
  { key: 'id', width: COLUMN_WIDTH },
  { key: 'name', width: COLUMN_WIDTH },
  { key: 'amount', width: COLUMN_WIDTH },
  { key: 'city', width: COLUMN_WIDTH },
] as const

async function mountGrid(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: makeRows(20),
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      ...overrides,
    },
  })
}

/**
 * Encabezado de una columna por su clave.
 *
 * Se busca por texto y no por `aria-colindex` a propósito: el índice cambia
 * justamente cuando la columna se mueve, que es lo que estos tests verifican.
 */
function header(harness: TableHarness, columnKey: string): HTMLElement {
  for (const node of harness.wrapper.element.querySelectorAll('.dt-header-cell')) {
    if (!(node instanceof HTMLElement)) continue
    if (node.textContent?.trim() === columnKey) return node
  }
  throw new Error(`[test] no hay encabezado para "${columnKey}"`)
}

/**
 * Arrastra el encabezado de una columna hasta una coordenada horizontal.
 *
 * `x` está en píxeles del canvas —el mismo sistema que los offsets de columna—,
 * y el viewport del andamiaje arranca en 0, así que coincide con `clientX`.
 */
async function dragHeader(
  harness: TableHarness,
  columnKey: string,
  x: number,
  options: { drop?: boolean } = {},
): Promise<void> {
  const node = header(harness, columnKey)
  node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
  node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x }))
  await harness.flush()

  if (options.drop === false) return
  node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: x }))
  await harness.flush()
}

/** Orden anunciado por `update:columnOrder`, o `null` si no se anunció ninguno. */
function lastOrder(harness: TableHarness): string[] | null {
  const events = harness.wrapper.emitted('update:columnOrder')
  if (!events || events.length === 0) return null

  const payload: unknown = events[events.length - 1]?.[0]
  if (!Array.isArray(payload)) throw new Error('[test] update:columnOrder emitió otra cosa')
  return payload.map((key) => String(key))
}

/** Orden en el que están pintados los encabezados. */
function paintedOrder(harness: TableHarness): string[] {
  const painted: { x: number; key: string }[] = []
  for (const node of harness.wrapper.element.querySelectorAll('.dt-header-cell')) {
    if (!(node instanceof HTMLElement)) continue
    const match = /translate3d\((-?\d+(?:\.\d+)?)px/.exec(node.style.transform)
    painted.push({ x: match ? Number(match[1]) : 0, key: node.textContent?.trim() ?? '' })
  }
  return painted.sort((a, b) => a.x - b.x).map((entry) => entry.key)
}

/** La línea de caída, o `null`. */
function indicator(harness: TableHarness): HTMLElement | null {
  const node = harness.wrapper.element.querySelector('.dt-drop-indicator')
  return node instanceof HTMLElement ? node : null
}

/** El fantasma que sigue al puntero, o `null`. */
function ghost(harness: TableHarness): HTMLElement | null {
  const node = harness.wrapper.element.querySelector('.dt-column-ghost')
  return node instanceof HTMLElement ? node : null
}

/** La `x` que el fantasma tiene escrita en su `transform`. */
function ghostX(harness: TableHarness): number {
  const node = ghost(harness)
  if (!node) throw new Error('[test] no hay fantasma')
  const match = /translate3d\((-?\d+(?:\.\d+)?)px/.exec(node.style.transform)
  return match ? Number(match[1]) : Number.NaN
}

/* ------------------------------------------------------------- El gesto */

describe('column reorder — dragging a header', () => {
  it('drops the column where it was released', async () => {
    const harness = await mountGrid()

    // `id` sale de la posición 0 y se suelta pasado el medio de `amount`.
    await dragHeader(harness, 'id', 2 * COLUMN_WIDTH + 70)

    expect(lastOrder(harness)).toEqual(['name', 'amount', 'id', 'city'])
    expect(paintedOrder(harness)).toEqual(['name', 'amount', 'id', 'city'])
    harness.unmount()
  })

  it('drops it at the end when released past the last column', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'name', 4 * COLUMN_WIDTH)

    expect(lastOrder(harness)).toEqual(['id', 'amount', 'city', 'name'])
    harness.unmount()
  })

  it('moves to the left when released before the midpoint', async () => {
    const harness = await mountGrid()

    // La mitad de `id` está en 60: soltar antes significa "delante de todo".
    await dragHeader(harness, 'city', 20)

    expect(lastOrder(harness)).toEqual(['city', 'id', 'name', 'amount'])
    harness.unmount()
  })

  it('does nothing when dropped back on its own gap', async () => {
    const harness = await mountGrid()

    // Se mueve lo suficiente como para superar el umbral, pero sin salir del
    // propio hueco: soltar ahí no reordena nada.
    await dragHeader(harness, 'name', COLUMN_WIDTH + 70)

    expect(lastOrder(harness)).toBeNull()
    expect(paintedOrder(harness)).toEqual(['id', 'name', 'amount', 'city'])
    harness.unmount()
  })
})

/* ----------------------------------------------------------- El umbral */

describe('column reorder — the threshold between a click and a drag', () => {
  it('does not reorder on a click that barely moves', async () => {
    const harness = await mountGrid()
    const node = header(harness, 'id')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100 }))
    // Tres píxeles: por debajo del umbral, sigue siendo un clic.
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 103 }))
    node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 103 }))
    await harness.flush()

    expect(lastOrder(harness)).toBeNull()
    expect(indicator(harness)).toBeNull()
    harness.unmount()
  })

  it('still selects the column on that click, when selection is on', async () => {
    const harness = await mountGrid({ columnSelection: true })
    const node = header(harness, 'name')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100 }))
    node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 100 }))
    await harness.flush()

    // Los dos gestos conviven sobre el mismo encabezado: presionar y soltar sin
    // mover selecciona, presionar y arrastrar mueve.
    expect(harness.wrapper.emitted('rangeSelect')).toBeTruthy()
    expect(lastOrder(harness)).toBeNull()
    harness.unmount()
  })

  it('does not reorder if the gesture is cancelled', async () => {
    const harness = await mountGrid()
    const node = header(harness, 'id')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 300 }))
    node.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true, clientX: 300 }))
    await harness.flush()

    // Cancelar es lo contrario de soltar: el gesto se abandona y nada se mueve.
    expect(lastOrder(harness)).toBeNull()
    expect(indicator(harness)).toBeNull()
    harness.unmount()
  })
})

/* ------------------------------------------------- La línea de caída */

describe('column reorder — the drop line', () => {
  it('shows where the column would land', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'id', 2 * COLUMN_WIDTH + 70, { drop: false })

    // Soltar ahí la pondría delante de `city`, cuyo borde izquierdo está en 360.
    expect(indicator(harness)?.style.transform).toBe('translate3d(360px, 0, 0)')
    harness.unmount()
  })

  it('hides itself when dropping would not move anything', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'name', COLUMN_WIDTH + 70, { drop: false })

    // La línea aparece solo si el gesto va a producir un cambio: su presencia ya
    // responde "¿esto sirve de algo?" antes de soltar.
    expect(indicator(harness)).toBeNull()
    harness.unmount()
  })

  it('goes away when the column is dropped', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'id', 3 * COLUMN_WIDTH)

    expect(indicator(harness)).toBeNull()
    harness.unmount()
  })

  it('marks the header in flight', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'id', 3 * COLUMN_WIDTH, { drop: false })

    expect(header(harness, 'id').classList.contains('dt-header-cell--dragging')).toBe(true)
    harness.unmount()
  })
})

/* ------------------------------------------------- Columnas ocultas */

describe('column reorder — with a hidden column in between', () => {
  it('keeps the hidden column next to the same neighbour', async () => {
    const harness = await mountGrid({ columnVisibility: { amount: false } })

    // Visibles: id, name, city. Se mueve `id` detrás de `name`, cuyo medio está
    // en 180. `amount` está oculta entre las dos.
    await dragHeader(harness, 'id', 200)

    // `amount` sigue pegada a `name`, que es donde estaba. Traducir el hueco por
    // índice numérico en vez de por clave la habría corrido de lugar.
    expect(lastOrder(harness)).toEqual(['name', 'amount', 'id', 'city'])
    harness.unmount()
  })
})

/* ------------------------------------------------------ Apagado y anclado */

describe('column reorder — when it does not apply', () => {
  it('does nothing with the feature off', async () => {
    const harness = await mountGrid({ columnReorder: false })

    await dragHeader(harness, 'id', 3 * COLUMN_WIDTH)

    expect(lastOrder(harness)).toBeNull()
    expect(harness.grid.getAttribute('data-reorder')).toBe('false')
    harness.unmount()
  })

  it('does not pick up a column pinned with `reorderable: false`', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH, reorderable: false },
        { key: 'name', width: COLUMN_WIDTH },
        { key: 'amount', width: COLUMN_WIDTH },
        { key: 'city', width: COLUMN_WIDTH },
      ],
    })

    await dragHeader(harness, 'id', 3 * COLUMN_WIDTH)

    expect(lastOrder(harness)).toBeNull()
    expect(header(harness, 'id').classList.contains('dt-header-cell--fixed')).toBe(true)
    harness.unmount()
  })

  it('lets the other columns move around the pinned one', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH, reorderable: false },
        { key: 'name', width: COLUMN_WIDTH },
        { key: 'amount', width: COLUMN_WIDTH },
        { key: 'city', width: COLUMN_WIDTH },
      ],
    })

    // Entre el medio de `id` y el de `name`: el hueco de la segunda posición.
    await dragHeader(harness, 'city', 150)

    // Anclar una columna no congela la tabla: es la columna la que no se agarra.
    expect(lastOrder(harness)).toEqual(['id', 'city', 'name', 'amount'])
    harness.unmount()
  })

  it('does not let another column push the pinned one out of its place', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH, reorderable: false },
        { key: 'name', width: COLUMN_WIDTH },
        { key: 'amount', width: COLUMN_WIDTH },
        { key: 'city', width: COLUMN_WIDTH },
      ],
    })

    // Se suelta ANTES de `id`, que es la anclada.
    await dragHeader(harness, 'city', 10)

    // Anclar tiene que significar las dos cosas: que no se la agarra y que nadie
    // la empuja. Insertar delante la habría corrido a la segunda posición, así
    // que el hueco se acota al primero válido: justo detrás de ella.
    expect(lastOrder(harness)).toEqual(['id', 'city', 'name', 'amount'])
    harness.unmount()
  })

  it('does not start from the resize handle', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH, resizable: true },
        { key: 'name', width: COLUMN_WIDTH },
        { key: 'amount', width: COLUMN_WIDTH },
        { key: 'city', width: COLUMN_WIDTH },
      ],
    })

    const handle = harness.wrapper.element.querySelector('.dt-resize-handle')
    handle?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 118 }))
    handle?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 400 }))
    await harness.flush()

    // El handle vive adentro del encabezado y tiene su propio gesto: sin la
    // guarda, cada arrastre de ancho movería además la columna.
    expect(indicator(harness)).toBeNull()
    expect(lastOrder(harness)).toBeNull()
    harness.unmount()
  })
})

/* --------------------------------------------- Lo que ya existía sigue */

describe('column reorder — it writes the state that already existed', () => {
  it('is controlled by `columnOrder` like everything else', async () => {
    const harness = await mountGrid({ columnOrder: ['city', 'id', 'name', 'amount'] })

    await dragHeader(harness, 'city', 3 * COLUMN_WIDTH)

    // Con la prop controlada, el componente anuncia y el padre decide: el orden
    // pintado no cambia hasta que el padre lo aplique.
    expect(lastOrder(harness)).toEqual(['id', 'name', 'city', 'amount'])
    expect(paintedOrder(harness)).toEqual(['city', 'id', 'name', 'amount'])
    harness.unmount()
  })

  it('keeps the cells aligned with their header after the move', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'id', 2 * COLUMN_WIDTH + 70)

    // Las celdas las pinta el pool y los encabezados los pinta Vue: si el orden
    // no saliera de una sola fuente, aquí se vería el desfasaje.
    const cell = harness.cell(0, 'id')
    const headerCell = header(harness, 'id')
    expect(cell?.style.transform).toBe(headerCell.style.transform)
    harness.unmount()
  })
})

/* ------------------------------------------------------ El fantasma */

/**
 * La caja que sigue al cursor mientras se arrastra.
 *
 * Es lo único del gesto que está agarrado al puntero: el encabezado atenuado
 * dice de dónde sale la columna y la línea dice dónde va a caer, pero entre esas
 * dos cosas no había nada que se moviera con la mano. Lo que estos tests fijan
 * es su ciclo de vida, que es donde un nodo que sigue al cursor se convierte en
 * un nodo que se quedó pegado en la pantalla.
 */
describe('column reorder — the drag ghost', () => {
  it('does not exist before a drag starts', async () => {
    const harness = await mountGrid()

    expect(ghost(harness)).toBeNull()
    harness.unmount()
  })

  it('does not appear on a click that stays under the threshold', async () => {
    const harness = await mountGrid()
    const node = header(harness, 'id')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100 }))
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 103 }))
    await harness.flush()

    // Mismo umbral que el resto del gesto: presionar y temblar es un clic, y un
    // clic no puede hacer aparecer una caja flotando.
    expect(ghost(harness)).toBeNull()

    node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 103 }))
    await harness.flush()
    harness.unmount()
  })

  it('carries the label of the column being dragged', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'name', 3 * COLUMN_WIDTH, { drop: false })

    expect(ghost(harness)?.textContent?.trim()).toBe('name')
    harness.unmount()
  })

  it('follows the pointer', async () => {
    const harness = await mountGrid()
    const node = header(harness, 'id')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 120 }))
    await harness.flush()
    const primera = ghostX(harness)

    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 260 }))
    await harness.flush()

    // El desplazamiento del fantasma es el del puntero, ni más ni menos: es lo
    // que hace que se sienta agarrado a la mano y no arrastrado con retraso.
    expect(ghostX(harness) - primera).toBe(140)
    harness.unmount()
  })

  it('disappears when the column is dropped', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'id', 2 * COLUMN_WIDTH + 70)

    // La columna ya está en su lugar nuevo: un fantasma que sobreviva al soltar
    // la muestra todavía en vuelo cuando ya llegó.
    expect(ghost(harness)).toBeNull()
    expect(lastOrder(harness)).toEqual(['name', 'amount', 'id', 'city'])
    harness.unmount()
  })

  it('disappears when the gesture is cancelled', async () => {
    const harness = await mountGrid()
    const node = header(harness, 'id')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 300 }))
    await harness.flush()
    expect(ghost(harness)).not.toBeNull()

    node.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true, clientX: 300 }))
    await harness.flush()

    // Cancelar deja todo como estaba, y "todo" incluye no dejar una caja
    // flotando en el medio de la tabla.
    expect(ghost(harness)).toBeNull()
    expect(lastOrder(harness)).toBeNull()
    harness.unmount()
  })

  it('stays out of the accessibility tree', async () => {
    const harness = await mountGrid()

    await dragHeader(harness, 'name', 3 * COLUMN_WIDTH, { drop: false })

    // El título que muestra ya está en el encabezado, que sigue en el documento
    // durante todo el gesto: anunciarlo dos veces no agrega nada y desordena el
    // recorrido.
    expect(ghost(harness)?.getAttribute('aria-hidden')).toBe('true')
    harness.unmount()
  })

  it('does not appear when the column cannot be moved', async () => {
    const harness = await mountGrid({ columnReorder: false })
    const node = header(harness, 'id')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 300 }))
    await harness.flush()

    expect(ghost(harness)).toBeNull()
    harness.unmount()
  })
})
