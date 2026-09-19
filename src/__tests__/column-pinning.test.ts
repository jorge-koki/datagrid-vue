/**
 * Anclar y desanclar columnas desde el encabezado.
 *
 * ## Qué protege este archivo
 *
 * Que el botón no trae un anclaje propio. Lo único que produce es una escritura
 * sobre `columnPinning`, un v-model que se reconcilia contra las columnas
 * declaradas y se persiste igual que el orden y los anchos: el botón es una
 * forma de mover ese estado con el mouse, no un segundo lugar donde vive el
 * anclaje.
 *
 * ## El invariante que se rompe en silencio
 *
 * **`null` y la clave ausente NO son lo mismo.** Ausente significa "el usuario
 * no la tocó" y deja mandar a `column.pinned`; `null` significa "el usuario la
 * soltó" y tiene que pisarlo. Si se colapsan, soltar una columna declarada
 * anclada es imposible: se vuelve a anclar sola en el mismo tick y el botón
 * parece no funcionar. Es el caso que más veces aparece aquí.
 */

import { describe, expect, it, vi } from 'vitest'
import { mountTable } from './harness'
import type { TableHarness, TableProps } from './harness'
import { reconcileColumnPinning } from '../internal/reconcile'
import type { ColumnPin } from '../types'

type Row = { id: number; name: string; amount: number; city: string }

const VIEWPORT = { width: 600, height: 400 }
const COLUMN_WIDTH = 120

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    name: `Name ${index}`,
    amount: index * 10,
    city: `City ${index}`,
  }))
}

async function mountGrid(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: makeRows(20),
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'name', width: COLUMN_WIDTH, pinnable: true },
        { key: 'amount', width: COLUMN_WIDTH, pinnable: 'end' },
        { key: 'city', width: COLUMN_WIDTH },
      ],
      rowKey: 'id',
      ...overrides,
    },
  })
}

/** Encabezado de una columna, buscado por su texto. */
function header(harness: TableHarness, key: string): HTMLElement {
  for (const node of harness.wrapper.element.querySelectorAll('.dt-header-cell')) {
    if (node instanceof HTMLElement && node.textContent?.trim() === key) return node
  }
  throw new Error(`[test] no hay encabezado para "${key}"`)
}

/** Botón de anclar de una columna, o `null` si esa columna no lo tiene. */
function pinButton(harness: TableHarness, key: string): HTMLElement | null {
  const node = header(harness, key).querySelector('.dt-pin-button')
  return node instanceof HTMLElement ? node : null
}

/** Aprieta el botón de anclar de una columna. */
async function clickPin(harness: TableHarness, key: string): Promise<void> {
  const button = pinButton(harness, key)
  if (!button) throw new Error(`[test] la columna "${key}" no tiene botón de anclar`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await harness.flush()
}

/** Último anclaje anunciado por `update:columnPinning`, o `null`. */
function lastPinning(harness: TableHarness): Record<string, ColumnPin | null> | null {
  const events = harness.wrapper.emitted('update:columnPinning')
  if (!events || events.length === 0) return null
  return events[events.length - 1]?.[0] as Record<string, ColumnPin | null>
}

/** Claves de los encabezados anclados, en el orden en que están pintados. */
function pinnedKeys(harness: TableHarness): string[] {
  const painted: { x: number; key: string }[] = []
  for (const node of harness.wrapper.element.querySelectorAll('.dt-header-cell--pinned')) {
    if (!(node instanceof HTMLElement)) continue
    const match = /translate3d\((-?\d+(?:\.\d+)?)px/.exec(node.style.transform)
    painted.push({ x: match ? Number(match[1]) : 0, key: node.textContent?.trim() ?? '' })
  }
  return painted.sort((a, b) => a.x - b.x).map((entry) => entry.key)
}

describe('anclar desde el encabezado — cuándo aparece el botón', () => {
  it('no aparece en una columna que no lo declara', async () => {
    const harness = await mountGrid()

    // Es el default, y es lo que hace que una tabla que no use la función no
    // pague ni un nodo por encabezado.
    expect(pinButton(harness, 'id')).toBeNull()
    expect(pinButton(harness, 'city')).toBeNull()
    harness.unmount()
  })

  it('aparece en las que lo declaran', async () => {
    const harness = await mountGrid()

    expect(pinButton(harness, 'name')).not.toBeNull()
    expect(pinButton(harness, 'amount')).not.toBeNull()
    harness.unmount()
  })

  it('dice si la columna está anclada, para un lector de pantalla', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'name', width: COLUMN_WIDTH, pinnable: true, pinned: 'start' },
      ],
    })

    // Un solo control con dos estados, no dos botones: es lo que hace que el
    // cambio se anuncie en vez de leerse como un botón nuevo.
    expect(pinButton(harness, 'name')?.getAttribute('aria-pressed')).toBe('true')
    harness.unmount()
  })
})

describe('anclar desde el encabezado — el gesto', () => {
  it('ancla al borde que declaró la columna', async () => {
    const harness = await mountGrid()

    await clickPin(harness, 'name')
    expect(lastPinning(harness)).toEqual({ name: 'start' })
    expect(pinnedKeys(harness)).toEqual(['name'])

    await clickPin(harness, 'amount')
    // `pinnable: 'end'` la lleva al borde derecho, no al izquierdo.
    expect(lastPinning(harness)).toEqual({ name: 'start', amount: 'end' })
    expect(pinnedKeys(harness)).toEqual(['name', 'amount'])
    harness.unmount()
  })

  it('`pinnable: true` significa el borde izquierdo', async () => {
    const harness = await mountGrid()

    await clickPin(harness, 'name')

    // Es donde se ancla en la enorme mayoría de los casos, así que es lo que
    // significa decir "sí" sin aclarar nada.
    expect(lastPinning(harness)?.name).toBe('start')
    harness.unmount()
  })

  it('suelta una columna ya anclada', async () => {
    const harness = await mountGrid()

    await clickPin(harness, 'name')
    await clickPin(harness, 'name')

    expect(lastPinning(harness)).toEqual({ name: null })
    expect(pinnedKeys(harness)).toEqual([])
    harness.unmount()
  })

  it('suelta una columna DECLARADA anclada, que es el caso que se rompe solo', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'name', width: COLUMN_WIDTH, pinnable: true, pinned: 'start' },
      ],
    })
    expect(pinnedKeys(harness)).toEqual(['name'])

    await clickPin(harness, 'name')

    // `null` y no borrar la clave: borrarla devolvería el mando a `pinned`, y la
    // columna se habría vuelto a anclar sola sin que el botón pareciera fallar.
    expect(lastPinning(harness)).toEqual({ name: null })
    expect(pinnedKeys(harness)).toEqual([])
    harness.unmount()
  })

  it('deja de poder moverse cuando se la ancla', async () => {
    const harness = await mountGrid()

    await clickPin(harness, 'name')
    // El encabezado se vuelve a buscar DESPUÉS de anclar: al anclarse, la
    // columna se muda a la tira anclada, que es otro nodo del DOM. Con el de
    // antes en la mano se arrastraría la columna que quedó en su lugar.
    const node = header(harness, 'name')
    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 400 }))
    node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 400 }))
    await harness.flush()

    // Anclar y poder mover son incompatibles —moverla significaría desanclarla—
    // y eso sale del mismo lugar que cuando el anclaje era declarativo.
    expect(harness.wrapper.emitted('update:columnOrder')).toBeFalsy()
    harness.unmount()
  })

  it('presionar el botón no arrastra la columna ni la selecciona', async () => {
    const harness = await mountGrid({ columnSelection: true })
    const button = pinButton(harness, 'name')

    // El `pointerdown` del botón burbujea hasta el encabezado, que es donde
    // viven los otros dos gestos. Sin la exclusión, un clic aquí arrancaría
    // además un arrastre y seleccionaría la columna entera.
    button?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
    await harness.flush()

    expect(harness.wrapper.emitted('rangeSelect')).toBeFalsy()
    harness.unmount()
  })
})

describe('anclar desde el encabezado — controlado por el padre', () => {
  it('la prop manda y el componente solo anuncia', async () => {
    const harness = await mountGrid({ columnPinning: {} })

    await clickPin(harness, 'name')

    // Con la prop controlada el componente no escribe su estado interno: anuncia
    // y el padre decide. Si el padre ignora el evento, nada se mueve.
    expect(lastPinning(harness)).toEqual({ name: 'start' })
    expect(pinnedKeys(harness)).toEqual([])
    harness.unmount()
  })

  it('aplica lo que el padre le pasa', async () => {
    const harness = await mountGrid({ columnPinning: { amount: 'end' } })

    expect(pinnedKeys(harness)).toEqual(['amount'])
    harness.unmount()
  })

  it('pisa a `pinned` con un `null` del padre', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'name', width: COLUMN_WIDTH, pinned: 'start' },
      ],
      columnPinning: { name: null },
    })

    expect(pinnedKeys(harness)).toEqual([])
    harness.unmount()
  })
})

describe('anclar desde el encabezado — restablecer', () => {
  it('`resetLayout()` devuelve el mando a lo que declaran las columnas', async () => {
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'name', width: COLUMN_WIDTH, pinnable: true, pinned: 'start' },
      ],
    })

    await clickPin(harness, 'name')
    expect(pinnedKeys(harness)).toEqual([])

    harness.api.resetLayout()
    await harness.flush()

    // Vacío y no "todo en null": restablecer es volver a la declaración, así que
    // la columna declarada anclada vuelve a estarlo.
    expect(lastPinning(harness)).toEqual({})
    expect(pinnedKeys(harness)).toEqual(['name'])
    harness.unmount()
  })
})

describe('anclar desde el encabezado — el agregado que se pierde', () => {
  it('avisa al anclar una columna con `aggregate` y grupos activos', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'city', width: COLUMN_WIDTH },
        { key: 'amount', width: COLUMN_WIDTH, pinnable: true, aggregate: 'sum' },
      ],
      groupBy: ['city'],
    })

    await clickPin(harness, 'amount')

    // Un agregado se dibuja en el offset de SU columna, así que anclado caería
    // encima de la etiqueta del grupo y se ignora. Mientras el anclaje era
    // declarativo eso se descubría al escribir la columna; con un botón lo
    // dispara cualquiera, y lo que se ve es una cifra que desaparece sin motivo.
    const avisos = warn.mock.calls.filter((call) => String(call[0]).includes('aggregate'))
    expect(avisos).toHaveLength(1)

    warn.mockRestore()
    harness.unmount()
  })

  it('avisa una sola vez por columna', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'city', width: COLUMN_WIDTH },
        { key: 'amount', width: COLUMN_WIDTH, pinnable: true, aggregate: 'sum' },
      ],
      groupBy: ['city'],
    })

    await clickPin(harness, 'amount')
    await clickPin(harness, 'amount')
    await clickPin(harness, 'amount')

    const avisos = warn.mock.calls.filter((call) => String(call[0]).includes('aggregate'))
    expect(avisos).toHaveLength(1)

    warn.mockRestore()
    harness.unmount()
  })

  it('no avisa sin agrupación, porque no hay ningún agregado que perder', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const harness = await mountGrid({
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'amount', width: COLUMN_WIDTH, pinnable: true, aggregate: 'sum' },
      ],
    })

    await clickPin(harness, 'amount')

    const avisos = warn.mock.calls.filter((call) => String(call[0]).includes('aggregate'))
    expect(avisos).toHaveLength(0)

    warn.mockRestore()
    harness.unmount()
  })
})

describe('anclar desde el encabezado — lo que se guarda', () => {
  const columnas = [{ key: 'id' }, { key: 'name' }] as const

  it('conserva un `null`, que es una decisión del usuario', () => {
    expect(reconcileColumnPinning({ name: null }, columnas)).toEqual({ name: null })
  })

  it('descarta las claves de columnas que ya no existen', () => {
    expect(reconcileColumnPinning({ name: 'start', fantasma: 'end' }, columnas)).toEqual({
      name: 'start',
    })
  })

  it('descarta un valor que no es un borde', () => {
    const sucio = { id: 'izquierda', name: 'end' } as unknown as Record<string, ColumnPin | null>

    // El estado guardado es una entrada externa: lo pudo escribir una versión
    // anterior o alguien desde las devtools.
    expect(reconcileColumnPinning(sucio, columnas)).toEqual({ name: 'end' })
  })

  it('distingue la clave ausente de la clave en `null`', () => {
    const ausente = reconcileColumnPinning({}, columnas)
    const suelta = reconcileColumnPinning({ name: null }, columnas)

    // Es la distinción entera: la primera deja mandar a `column.pinned`, la
    // segunda lo pisa. Colapsarlas haría imposible soltar una columna declarada
    // anclada, y el síntoma sería un botón que no hace nada.
    expect(Object.hasOwn(ausente, 'name')).toBe(false)
    expect(Object.hasOwn(suelta, 'name')).toBe(true)
  })
})
