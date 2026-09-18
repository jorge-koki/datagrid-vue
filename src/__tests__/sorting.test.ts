/**
 * Ordenamiento: el estado, el gesto y el menú de la columna.
 *
 * ## Qué protege este archivo
 *
 * **Que la tabla NO ordena `rows`.** Es la afirmación central y la que hace que
 * el mismo mecanismo sirva en memoria y contra un servidor: la tabla administra
 * los criterios y los anuncia, y el array lo sigue construyendo el consumidor.
 * Si algún día la tabla empezara a reordenar lo que recibe, el modo servidor
 * pasaría a mostrar un orden falso —correcto dentro de las 50 filas cargadas y
 * absurdo respecto de las 100.000 que hay— y nada más lo detectaría.
 *
 * ## Y tres cosas que se rompen en silencio
 *
 * 1. **El tercer clic.** Ascendente, descendente y de vuelta a sin orden. Sin la
 *    tercera vuelta no hay forma de recuperar el orden en que llegaron los datos.
 * 2. **El arrastre no ordena.** El navegador emite `click` después de un
 *    `pointerup`, también cuando entre los dos hubo un arrastre completo: mover
 *    una columna la ordenaba de paso.
 * 3. **Los botones del encabezado tampoco.** Anclar y abrir el menú son clics
 *    sobre el encabezado, y burbujean.
 */

import { describe, expect, it } from 'vitest'
import { mountTable } from './harness'
import type { TableHarness, TableProps } from './harness'
import { sortRows } from '../internal/sorting'
import { nextSortState } from '../internal/sorting'
import { reconcileSort } from '../internal/reconcile'
import type { ColumnSort, DataTableColumn } from '../types'

type Row = { id: number; name: string; amount: number; city: string }

const VIEWPORT = { width: 600, height: 400 }
const COLUMN_WIDTH = 120

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    name: `Name ${index}`,
    amount: (count - index) * 10,
    city: `City ${index % 3}`,
  }))
}

async function mountGrid(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: makeRows(20),
      columns: [
        { key: 'id', width: COLUMN_WIDTH },
        { key: 'name', width: COLUMN_WIDTH, sortable: true },
        { key: 'amount', width: COLUMN_WIDTH, sortable: true },
        { key: 'city', width: COLUMN_WIDTH },
      ],
      rowKey: 'id',
      ...overrides,
    },
  })
}

function header(harness: TableHarness, key: string): HTMLElement {
  for (const node of harness.wrapper.element.querySelectorAll('.dt-header-cell')) {
    if (node instanceof HTMLElement && node.getAttribute('data-column-key') === key) return node
  }
  throw new Error(`[test] no hay encabezado para "${key}"`)
}

async function clickHeader(harness: TableHarness, key: string, shift = false): Promise<void> {
  header(harness, key).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: shift }))
  await harness.flush()
}

function lastSort(harness: TableHarness): ColumnSort[] | null {
  const events = harness.wrapper.emitted('update:sort')
  if (!events || events.length === 0) return null
  return events[events.length - 1]?.[0] as ColumnSort[]
}

/* --------------------------------------------------------- El helper puro */

describe('sortRows — lo que el consumidor usa para ordenar en memoria', () => {
  const columns: DataTableColumn<Row>[] = [{ key: 'name' }, { key: 'amount' }, { key: 'city' }]

  it('devuelve el MISMO array cuando no hay nada que ordenar', () => {
    const rows = makeRows(5)

    // Una copia con identidad nueva le haría rehacer a la tabla la geometría, la
    // agrupación y la ventana por nada.
    expect(sortRows(rows, [], columns)).toBe(rows)
    expect(sortRows(rows, [{ columnKey: 'fantasma', direction: 'asc' }], columns)).toBe(rows)
  })

  it('no muta el array que recibe', () => {
    const rows = makeRows(5)
    const copia = [...rows]

    sortRows(rows, [{ columnKey: 'amount', direction: 'asc' }], columns)

    expect(rows).toEqual(copia)
  })

  it('ordena por el valor crudo y no por el texto', () => {
    const rows = makeRows(5)
    const ordenadas = sortRows(rows, [{ columnKey: 'amount', direction: 'asc' }], columns)

    expect(ordenadas.map((row) => row.amount)).toEqual([10, 20, 30, 40, 50])
  })

  it('invierte con `desc`', () => {
    const rows = makeRows(5)
    const ordenadas = sortRows(rows, [{ columnKey: 'amount', direction: 'desc' }], columns)

    expect(ordenadas.map((row) => row.amount)).toEqual([50, 40, 30, 20, 10])
  })

  it('aplica el segundo criterio solo dentro de los empates del primero', () => {
    const rows = makeRows(9)
    const ordenadas = sortRows(
      rows,
      [
        { columnKey: 'city', direction: 'asc' },
        { columnKey: 'amount', direction: 'asc' },
      ],
      columns,
    )

    const ciudades = ordenadas.map((row) => row.city)
    expect(ciudades).toEqual([...ciudades].sort())
    // Dentro de "City 0", los importes suben.
    const primeras = ordenadas.filter((row) => row.city === 'City 0').map((row) => row.amount)
    expect(primeras).toEqual([...primeras].sort((a, b) => a - b))
  })

  it('es estable: un empate conserva el orden en que venía', () => {
    const rows = [
      { id: 1, name: 'a', amount: 1, city: 'x' },
      { id: 2, name: 'b', amount: 1, city: 'x' },
      { id: 3, name: 'c', amount: 1, city: 'x' },
    ]

    const ordenadas = sortRows(rows, [{ columnKey: 'amount', direction: 'asc' }], columns)

    // Sin estabilidad, ordenar por una segunda columna deshace lo que hizo la
    // primera y el orden multinivel no significa nada.
    expect(ordenadas.map((row) => row.id)).toEqual([1, 2, 3])
  })

  it('manda los vacíos al final, ordene como ordene', () => {
    const rows = [
      { id: 1, name: 'b', amount: 2, city: 'x' },
      { id: 2, name: '', amount: Number.NaN, city: 'x' },
      { id: 3, name: 'a', amount: 1, city: 'x' },
    ]

    const asc = sortRows(rows, [{ columnKey: 'amount', direction: 'asc' }], columns)
    const desc = sortRows(rows, [{ columnKey: 'amount', direction: 'desc' }], columns)

    // Ordenar es para ver los valores, no para ver primero los huecos.
    expect(asc[asc.length - 1]?.id).toBe(2)
    expect(desc[desc.length - 1]?.id).toBe(2)
  })

  it('usa el comparador de la columna cuando lo hay', () => {
    const escala = ['baja', 'media', 'alta']
    const filas = [
      { id: 1, nivel: 'alta' },
      { id: 2, nivel: 'baja' },
      { id: 3, nivel: 'media' },
    ]
    const cols: DataTableColumn<(typeof filas)[number]>[] = [
      {
        key: 'nivel',
        comparator: (a, b) => escala.indexOf(a.nivel) - escala.indexOf(b.nivel),
      },
    ]

    const ordenadas = sortRows(filas, [{ columnKey: 'nivel', direction: 'asc' }], cols)

    // Alfabéticamente "alta" va antes que "baja", justo al revés de lo que
    // significa. Para eso existe el comparador.
    expect(ordenadas.map((row) => row.nivel)).toEqual(['baja', 'media', 'alta'])
  })

  it('ordena números como números y no como texto', () => {
    const filas = [
      { id: 1, n: 10 },
      { id: 2, n: 9 },
      { id: 3, n: 100 },
    ]
    const cols: DataTableColumn<(typeof filas)[number]>[] = [{ key: 'n' }]

    const ordenadas = sortRows(filas, [{ columnKey: 'n', direction: 'asc' }], cols)

    expect(ordenadas.map((row) => row.n)).toEqual([9, 10, 100])
  })

  it('ordena fechas por su instante', () => {
    const filas = [
      { id: 1, f: new Date('2026-03-01') },
      { id: 2, f: new Date('2025-12-31') },
    ]
    const cols: DataTableColumn<(typeof filas)[number]>[] = [{ key: 'f' }]

    const ordenadas = sortRows(filas, [{ columnKey: 'f', direction: 'asc' }], cols)

    expect(ordenadas.map((row) => row.id)).toEqual([2, 1])
  })
})

describe('nextSortState — el ciclo del clic', () => {
  it('recorre ascendente, descendente y sin orden', () => {
    const uno = nextSortState([], 'name', false)
    expect(uno).toEqual([{ columnKey: 'name', direction: 'asc' }])

    const dos = nextSortState(uno, 'name', false)
    expect(dos).toEqual([{ columnKey: 'name', direction: 'desc' }])

    // La tercera vuelta es la que devuelve el orden en que llegaron los datos.
    expect(nextSortState(dos, 'name', false)).toEqual([])
  })

  it('sin `Shift` reemplaza los criterios que había', () => {
    const previo: ColumnSort[] = [{ columnKey: 'city', direction: 'asc' }]

    expect(nextSortState(previo, 'name', false)).toEqual([{ columnKey: 'name', direction: 'asc' }])
  })

  it('con `Shift` agrega al final', () => {
    const previo: ColumnSort[] = [{ columnKey: 'city', direction: 'asc' }]

    expect(nextSortState(previo, 'name', true)).toEqual([
      { columnKey: 'city', direction: 'asc' },
      { columnKey: 'name', direction: 'asc' },
    ])
  })

  it('con `Shift` conserva la posición al cambiar el sentido', () => {
    const previo: ColumnSort[] = [
      { columnKey: 'city', direction: 'asc' },
      { columnKey: 'name', direction: 'asc' },
    ]

    // Cambiarle el sentido al primer criterio no lo manda al final: seguiría
    // mandando el otro y el orden cambiaría de significado.
    expect(nextSortState(previo, 'city', true)).toEqual([
      { columnKey: 'city', direction: 'desc' },
      { columnKey: 'name', direction: 'asc' },
    ])
  })
})

/* ------------------------------------------------------------- El gesto */

describe('ordenar desde el encabezado', () => {
  it('no toca `rows`', async () => {
    const rows = makeRows(20)
    const original = [...rows]
    const harness = await mountGrid({ rows })

    await clickHeader(harness, 'amount')

    // La afirmación central del archivo: la tabla anuncia y nada más.
    expect(rows).toEqual(original)
    expect(lastSort(harness)).toEqual([{ columnKey: 'amount', direction: 'asc' }])
    harness.unmount()
  })

  it('recorre los tres estados', async () => {
    const harness = await mountGrid()

    await clickHeader(harness, 'name')
    expect(lastSort(harness)).toEqual([{ columnKey: 'name', direction: 'asc' }])

    await clickHeader(harness, 'name')
    expect(lastSort(harness)).toEqual([{ columnKey: 'name', direction: 'desc' }])

    await clickHeader(harness, 'name')
    expect(lastSort(harness)).toEqual([])
    harness.unmount()
  })

  it('no hace nada sobre una columna que no es ordenable', async () => {
    const harness = await mountGrid()

    await clickHeader(harness, 'city')

    expect(lastSort(harness)).toBeNull()
    harness.unmount()
  })

  it('anuncia el orden a un lector de pantalla', async () => {
    const harness = await mountGrid()

    // `none` solo en las ordenables: en una que no lo es, anunciaría que se
    // puede ordenar y no se puede.
    expect(header(harness, 'name').getAttribute('aria-sort')).toBe('none')
    expect(header(harness, 'city').getAttribute('aria-sort')).toBeNull()

    await clickHeader(harness, 'name')
    expect(header(harness, 'name').getAttribute('aria-sort')).toBe('ascending')

    await clickHeader(harness, 'name')
    expect(header(harness, 'name').getAttribute('aria-sort')).toBe('descending')
    harness.unmount()
  })

  it('suma un criterio con `Shift` y numera la prioridad', async () => {
    const harness = await mountGrid()

    await clickHeader(harness, 'amount')
    await clickHeader(harness, 'name', true)

    expect(lastSort(harness)).toEqual([
      { columnKey: 'amount', direction: 'asc' },
      { columnKey: 'name', direction: 'asc' },
    ])
    // El número solo aparece con más de un criterio: con uno, no agrega nada a
    // la flecha. Se lee por columna y no por posición en el DOM: los
    // encabezados están en el orden de la tabla, no en el de prioridad.
    const rango = (key: string) =>
      header(harness, key).querySelector('.dt-sort-rank')?.textContent?.trim()
    expect(rango('amount')).toBe('1')
    expect(rango('name')).toBe('2')
    harness.unmount()
  })

  it('vuelve al principio del dataset', async () => {
    const harness = await mountGrid({ rows: makeRows(500) })
    await harness.scrollTo({ top: 4_000 })
    await harness.flush()

    await clickHeader(harness, 'name')

    // Con el orden cambiado, la fila 100 es otra fila: quedarse donde estaba
    // deja al usuario mirando un tramo que no pidió.
    expect(harness.scrollPosition().top).toBe(0)
    harness.unmount()
  })

  it('NO ordena si el gesto terminó siendo un arrastre', async () => {
    const harness = await mountGrid()
    const node = header(harness, 'name')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }))
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 300 }))
    node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 300 }))
    // El navegador emite `click` después del `pointerup`, también cuando hubo
    // arrastre. Sin la guarda, mover una columna la ordenaba de paso.
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await harness.flush()

    expect(lastSort(harness)).toBeNull()
    harness.unmount()
  })

  it('ordena igual con la selección de columna encendida', async () => {
    const harness = await mountGrid({ columnSelection: true })

    await clickHeader(harness, 'name')

    // El clic pelado se lo queda ordenar, que es la acción frecuente. Al revés
    // quedaba un agujero: sin `columnMenu`, `sortable` no hacía nada.
    expect(lastSort(harness)).toEqual([{ columnKey: 'name', direction: 'asc' }])
    expect(harness.wrapper.emitted('rangeSelect')).toBeFalsy()
    harness.unmount()
  })

  it('selecciona la columna con `Ctrl`/`Cmd`+clic, sin ordenarla', async () => {
    const harness = await mountGrid({ columnSelection: true })
    const node = header(harness, 'name')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: true }))
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await harness.flush()

    // No es una convención nueva: es el mismo modificador de `Ctrl`/`Cmd`+`A`,
    // `Ctrl`/`Cmd`+`C` y `Ctrl`/`Cmd`+`Home`. `Shift` no servía, lo usa el
    // orden multinivel.
    expect(harness.wrapper.emitted('rangeSelect')).toBeTruthy()
    expect(lastSort(harness)).toBeNull()
    harness.unmount()
  })

  it('en una columna que no ordena, el clic pelado sigue seleccionando', async () => {
    const harness = await mountGrid({ columnSelection: true })
    const node = header(harness, 'city')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await harness.flush()

    // Sin nada con qué competir, no hay motivo para pedir un modificador.
    expect(harness.wrapper.emitted('rangeSelect')).toBeTruthy()
    harness.unmount()
  })

  it('con `Cmd` también, que es lo mismo en Mac', async () => {
    const harness = await mountGrid({ columnSelection: true })
    const node = header(harness, 'name')

    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, metaKey: true }))
    await harness.flush()

    expect(harness.wrapper.emitted('rangeSelect')).toBeTruthy()
    harness.unmount()
  })
})

/* -------------------------------------------------------------- El menú */

async function mountConMenu(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountGrid({
    columnMenu: true,
    columns: [
      { key: 'id', width: COLUMN_WIDTH },
      { key: 'name', width: COLUMN_WIDTH, sortable: true, pinnable: true },
      { key: 'amount', width: COLUMN_WIDTH, sortable: true },
      { key: 'city', width: COLUMN_WIDTH, menu: false },
    ],
    ...overrides,
  })
}

function menuButton(harness: TableHarness, key: string): HTMLElement | null {
  const node = header(harness, key).querySelector('.dt-menu-button')
  return node instanceof HTMLElement ? node : null
}

async function openMenu(harness: TableHarness, key: string): Promise<void> {
  menuButton(harness, key)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await harness.flush()
}

function menuItems(harness: TableHarness): string[] {
  return [...harness.wrapper.element.querySelectorAll('.dt-column-menu-item')].map(
    (node) => node.textContent?.trim() ?? '',
  )
}

async function clickItem(harness: TableHarness, text: string): Promise<void> {
  const item = [...harness.wrapper.element.querySelectorAll('.dt-column-menu-item')].find((node) =>
    node.textContent?.includes(text),
  )
  if (!item) throw new Error(`[test] el menú no tiene "${text}": ${menuItems(harness).join(', ')}`)
  item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await harness.flush()
}

describe('el menú de la columna', () => {
  it('no existe sin la prop', async () => {
    const harness = await mountGrid()

    expect(menuButton(harness, 'name')).toBeNull()
    harness.unmount()
  })

  it('una columna puede quedarse afuera', async () => {
    const harness = await mountConMenu()

    expect(menuButton(harness, 'name')).not.toBeNull()
    expect(menuButton(harness, 'city')).toBeNull()
    harness.unmount()
  })

  it('ofrece solo lo que la columna puede hacer', async () => {
    const harness = await mountConMenu()

    await openMenu(harness, 'amount')
    // `amount` ordena pero no se ancla: sin entradas de anclaje. Un menú con la
    // mitad de las opciones deshabilitadas obliga a leerlo entero para descubrir
    // que no servían.
    expect(menuItems(harness)).toEqual([
      'Sort ascending',
      'Sort descending',
      'Hide column',
      'Reset columns',
    ])
    harness.unmount()
  })

  it('ofrece anclar en una columna que lo permite', async () => {
    const harness = await mountConMenu()

    await openMenu(harness, 'name')

    expect(menuItems(harness)).toContain('Pin to start')
    harness.unmount()
  })

  it('no ofrece el sentido que ya está vigente', async () => {
    const harness = await mountConMenu()
    await clickHeader(harness, 'amount')

    await openMenu(harness, 'amount')

    expect(menuItems(harness)).not.toContain('Sort ascending')
    expect(menuItems(harness)).toContain('Clear sort')
    harness.unmount()
  })

  it('ordena y se cierra', async () => {
    const harness = await mountConMenu()
    await openMenu(harness, 'amount')

    await clickItem(harness, 'Sort descending')

    expect(lastSort(harness)).toEqual([{ columnKey: 'amount', direction: 'desc' }])
    expect(harness.wrapper.element.querySelector('.dt-column-menu')).toBeNull()
    harness.unmount()
  })

  it('ancla desde el menú', async () => {
    const harness = await mountConMenu()
    await openMenu(harness, 'name')

    await clickItem(harness, 'Pin to start')

    const events = harness.wrapper.emitted('update:columnPinning')
    expect(events?.[events.length - 1]?.[0]).toEqual({ name: 'start' })
    harness.unmount()
  })

  it('oculta la columna', async () => {
    const harness = await mountConMenu()
    await openMenu(harness, 'amount')

    await clickItem(harness, 'Hide column')

    const events = harness.wrapper.emitted('update:columnVisibility')
    expect(events?.[events.length - 1]?.[0]).toMatchObject({ amount: false })
    harness.unmount()
  })

  it('se niega a ocultar la última columna visible', async () => {
    const harness = await mountGrid({
      columnMenu: true,
      columns: [{ key: 'name', width: COLUMN_WIDTH }],
    })
    await openMenu(harness, 'name')

    await clickItem(harness, 'Hide column')

    // Una tabla sin columnas no tiene forma de volver: el menú desde el que se
    // recupera vive justamente en un encabezado.
    const events = harness.wrapper.emitted('update:columnVisibility')
    expect(events).toBeFalsy()
    harness.unmount()
  })

  it('cierra con Escape', async () => {
    const harness = await mountConMenu()
    await openMenu(harness, 'amount')

    const panel = harness.wrapper.element.querySelector('.dt-column-menu')
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await harness.flush()

    expect(harness.wrapper.element.querySelector('.dt-column-menu')).toBeNull()
    harness.unmount()
  })

  it('cierra al apretar afuera', async () => {
    const harness = await mountConMenu()
    await openMenu(harness, 'amount')

    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await harness.flush()

    expect(harness.wrapper.element.querySelector('.dt-column-menu')).toBeNull()
    harness.unmount()
  })

  it('abrir el menú no ordena la columna', async () => {
    const harness = await mountConMenu()

    await openMenu(harness, 'amount')

    // El clic del botón burbujea hasta el encabezado, donde vive el gesto de
    // ordenar. Sin la exclusión, abrir el menú ordenaba de paso.
    expect(lastSort(harness)).toBeNull()
    harness.unmount()
  })

  it('traduce sus textos', async () => {
    const harness = await mountConMenu({ labels: { sortAsc: 'Ordenar ascendente' } })
    await openMenu(harness, 'amount')

    expect(menuItems(harness)).toContain('Ordenar ascendente')
    // Lo que no se declara conserva el valor por defecto.
    expect(menuItems(harness)).toContain('Sort descending')
    harness.unmount()
  })
})

/* ------------------------------------------------------- Lo que se guarda */

describe('el orden guardado', () => {
  const columnas = [{ key: 'name' }, { key: 'amount' }] as const

  it('conserva la prioridad de los criterios', () => {
    const guardado: ColumnSort[] = [
      { columnKey: 'amount', direction: 'desc' },
      { columnKey: 'name', direction: 'asc' },
    ]

    // El orden de la lista es lo único que distingue "por importe y después por
    // nombre" de lo contrario.
    expect(reconcileSort(guardado, columnas)).toEqual(guardado)
  })

  it('descarta columnas que ya no existen y sentidos inválidos', () => {
    const sucio = [
      { columnKey: 'fantasma', direction: 'asc' },
      { columnKey: 'name', direction: 'arriba' },
      { columnKey: 'amount', direction: 'desc' },
    ] as unknown as ColumnSort[]

    expect(reconcileSort(sucio, columnas)).toEqual([{ columnKey: 'amount', direction: 'desc' }])
  })

  it('se queda con el primero de un criterio repetido', () => {
    const repetido: ColumnSort[] = [
      { columnKey: 'name', direction: 'asc' },
      { columnKey: 'name', direction: 'desc' },
    ]

    expect(reconcileSort(repetido, columnas)).toEqual([{ columnKey: 'name', direction: 'asc' }])
  })
})
