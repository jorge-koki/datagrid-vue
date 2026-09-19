/**
 * Modo servidor: `rows` con huecos y pedidos por página.
 *
 * ## Qué protege este archivo
 *
 * La regla de oro es la primera y la más importante: **sin `rowCount` no cambia
 * absolutamente nada**. La tabla con sus datos en memoria no paga ni un pedido,
 * ni un marcador, ni una rama distinta en el camino de pintado. Todo lo demás de
 * aquí abajo describe un modo que hay que encender a propósito.
 *
 * Lo segundo que protege es que la tabla **no pida dos veces lo mismo**. Es el
 * punto entero de que el registro de páginas en vuelo viva en la librería y no
 * en cada consumidor: un scroll rápido atraviesa la misma página decenas de
 * veces por segundo, y sin ese registro cada travesía sería una consulta más
 * contra la base de datos.
 *
 * Lo tercero es que un hueco **se vea como lo que es**. Una fila que todavía no
 * llegó no es una fila vacía: lleva su marcador, lo anuncia con `aria-busy` y
 * —sobre todo— no deja a la vista el valor de la fila que ese nodo reciclado
 * mostraba antes.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { mountTable } from './harness'
import type { GridRow, TableHarness, TableProps } from './harness'

const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

type Row = { id: number; name: string }

const ROW_HEIGHT = 40
/** 400px de filas a 40px: entran diez, y el virtualizador pinta once. */
const VIEWPORT = { width: 600, height: 400 }
const COLUMNS = [
  { key: 'id', width: 120 },
  { key: 'name', width: 200 },
] as const

const TOTAL = 500
const PAGE = 50

/** Un array del largo del dataset, con todos sus lugares vacíos. */
function emptyRows(total = TOTAL): (Row | undefined)[] {
  return new Array<Row | undefined>(total)
}

/** Copia `rows` y llena el tramo `[start, end)`, como haría el consumidor. */
function fill(rows: readonly (Row | undefined)[], start: number, end: number): (Row | undefined)[] {
  const next = rows.slice()
  for (let index = start; index < end; index += 1) {
    next[index] = { id: index, name: `Fila ${index}` }
  }
  return next
}

async function mountServer(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: emptyRows() as GridRow[],
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      rowCount: TOTAL,
      pageSize: PAGE,
      // Sin adelanto: cada test que quiera medir el prefetch lo enciende.
      prefetchPages: 0,
      overscan: 0,
      ...overrides,
    },
  })
}

/** Los tramos pedidos, en orden, como pares legibles. */
function requests(harness: TableHarness): [number, number][] {
  const emitted = harness.wrapper.emitted('rowsRequest') ?? []
  return emitted.map((args) => {
    const event = args[0]
    if (typeof event !== 'object' || event === null) return [-1, -1]
    const start: unknown = Reflect.get(event, 'start')
    const end: unknown = Reflect.get(event, 'end')
    return [typeof start === 'number' ? start : -1, typeof end === 'number' ? end : -1]
  })
}

/** Filas pintadas como marcador, por su posición vertical. */
function placeholderRows(harness: TableHarness): HTMLElement[] {
  return [...harness.canvas.querySelectorAll('.dt-row--placeholder')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && !node.hidden,
  )
}

describe('modo servidor — encenderlo es explícito', () => {
  it('sin rowCount no pide una sola fila', async () => {
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows: fill(emptyRows(60), 0, 60) as GridRow[],
        columns: COLUMNS,
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
      },
    })

    await harness.scrollTo({ top: 1000 })

    // Ni un evento, ni un marcador: la tabla en memoria no sabe que este modo
    // existe.
    expect(harness.wrapper.emitted('rowsRequest')).toBeUndefined()
    expect(placeholderRows(harness)).toHaveLength(0)

    harness.unmount()
  })

  it('sin rowCount, un hueco retira la fila en vez de marcarla', async () => {
    const rows = fill(emptyRows(60), 0, 60)
    // `rows` se acortó: aquí un `undefined` significa "no existe", no "no llegó".
    const short = rows.slice(0, 20)

    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows: short as GridRow[],
        columns: COLUMNS,
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
      },
    })

    await harness.scrollTo({ top: 600 })
    expect(placeholderRows(harness)).toHaveLength(0)

    harness.unmount()
  })
})

describe('modo servidor — qué se pide y cuándo', () => {
  it('mide la altura scrolleable con rowCount y no con rows.length', async () => {
    const harness = await mountServer()

    // 500 filas de 40px, aunque `rows` no tenga ni una cargada.
    const canvasHeight = harness.canvas.style.height
    expect(canvasHeight).toBe(`${TOTAL * ROW_HEIGHT}px`)

    harness.unmount()
  })

  it('alinea el pedido a pageSize en lugar de pedir la ventana cruda', async () => {
    const harness = await mountServer()

    // La ventana inicial es [0, 11): se pide la página entera.
    expect(requests(harness)).toEqual([[0, 50]])

    // Scroll a la fila 137. La ventana cruda sería [137, 148); lo que se pide es
    // la página que la contiene, que es lo que el consumidor puede cachear.
    await harness.scrollTo({ top: 137 * ROW_HEIGHT })
    expect(requests(harness)).toContainEqual([100, 150])

    harness.unmount()
  })

  it('no repite un pedido mientras la página sigue en vuelo', async () => {
    const harness = await mountServer()

    // Tres pasos de scroll DENTRO de la primera página. Sin registro de páginas
    // en vuelo, cada uno sería una consulta más contra la base de datos.
    await harness.scrollTo({ top: 5 * ROW_HEIGHT })
    await harness.scrollTo({ top: 12 * ROW_HEIGHT })
    await harness.scrollTo({ top: 20 * ROW_HEIGHT })

    expect(requests(harness)).toEqual([[0, 50]])

    harness.unmount()
  })

  it('no vuelve a pedir una página cuyas filas ya llegaron', async () => {
    const harness = await mountServer()
    expect(requests(harness)).toEqual([[0, 50]])

    await harness.wrapper.setProps({ rows: fill(emptyRows(), 0, 50) })
    await harness.flush()

    // Ir y volver sobre una página resuelta no cuesta ningún pedido.
    await harness.scrollTo({ top: 20 * ROW_HEIGHT })
    await harness.scrollTo({ top: 0 })

    expect(requests(harness)).toEqual([[0, 50]])

    harness.unmount()
  })

  it('no insiste con una página que el servidor contestó corta', async () => {
    const harness = await mountServer()

    // El servidor devuelve treinta de las cincuenta pedidas. Es su respuesta, no
    // un error de la tabla: volver a pedir esa página sería un bucle contra un
    // servidor que ya dijo lo que tenía. Las veinte filas restantes se quedan
    // como marcador hasta que el consumidor corrija `rowCount` o llame a
    // `refreshRows()`.
    await harness.wrapper.setProps({ rows: fill(emptyRows(), 0, 30) })
    await harness.flush()

    // La ventana cae sobre el tramo que el servidor no mandó: se ve como lo que
    // es, y NO se vuelve a pedir la página.
    await harness.scrollTo({ top: 35 * ROW_HEIGHT })
    expect(placeholderRows(harness).length).toBeGreaterThan(0)
    expect(requests(harness).filter(([start]) => start === 0)).toHaveLength(1)

    await harness.scrollTo({ top: 0 })
    expect(requests(harness).filter(([start]) => start === 0)).toHaveLength(1)

    harness.unmount()
  })

  it('pide las páginas vecinas cuando hay adelanto', async () => {
    const harness = await mountServer({ prefetchPages: 1 })

    // La ventana cae entera en la página 0, pero la 1 se pide igual: para cuando
    // su primera fila entre en pantalla, ya va a estar.
    expect(requests(harness)).toEqual([
      [0, 50],
      [50, 100],
    ])

    harness.unmount()
  })

  it('acota el último pedido a rowCount', async () => {
    const harness = await mountServer({ rowCount: 120 })

    await harness.scrollTo({ top: 110 * ROW_HEIGHT })

    // La página 2 iría de 100 a 150, pero el dataset termina en 120.
    expect(requests(harness)).toContainEqual([100, 120])

    harness.unmount()
  })
})

describe('modo servidor — volver a pedir', () => {
  it('vuelve a pedir cuando el consumidor vacía rows', async () => {
    const harness = await mountServer()
    await harness.wrapper.setProps({ rows: fill(emptyRows(), 0, 50) })
    await harness.flush()
    expect(requests(harness)).toEqual([[0, 50]])

    // El gesto normal de invalidar: cambió el orden o el filtro del lado del
    // servidor, y lo cargado ya no sirve. Se detecta solo.
    await harness.wrapper.setProps({ rows: [] })
    await harness.flush()

    expect(requests(harness)).toEqual([
      [0, 50],
      [0, 50],
    ])

    harness.unmount()
  })

  it('refreshRows vuelve a pedir lo que falta', async () => {
    const harness = await mountServer()
    expect(requests(harness)).toEqual([[0, 50]])

    // Simula el caso real: el `fetch` falló, las filas nunca llegaron y la tabla
    // no insiste sola. Esta es la vía para recuperarse.
    harness.api.refreshRows()
    await harness.flush()

    expect(requests(harness)).toEqual([
      [0, 50],
      [0, 50],
    ])

    harness.unmount()
  })

  it('refreshRows fuera del modo servidor no hace nada', async () => {
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows: fill(emptyRows(60), 0, 60) as GridRow[],
        columns: COLUMNS,
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
      },
    })

    harness.api.refreshRows()
    await harness.flush()

    expect(harness.wrapper.emitted('rowsRequest')).toBeUndefined()

    harness.unmount()
  })
})

describe('modo servidor — cómo se ve un hueco', () => {
  it('marca la fila que no llegó y lo anuncia con aria-busy', async () => {
    const harness = await mountServer()

    const marked = placeholderRows(harness)
    expect(marked.length).toBeGreaterThan(0)
    for (const row of marked) {
      expect(row.getAttribute('aria-busy')).toBe('true')
    }

    harness.unmount()
  })

  it('alinea la barra con la columna, celda por celda', async () => {
    const harness = await mountServer()

    const row = placeholderRows(harness)[0]
    expect(row).toBeDefined()
    const cells = [...(row?.querySelectorAll('.dt-cell--placeholder') ?? [])]
    expect(cells).toHaveLength(COLUMNS.length)

    // Cada celda conserva la caja de SU columna: la barra sale del pseudoelemento
    // y por eso cae exactamente debajo de su encabezado.
    const boxes = cells.map((node) =>
      node instanceof HTMLElement ? [node.style.transform, node.style.width] : null,
    )
    expect(boxes).toEqual([
      ['translate3d(0px, 0, 0)', '120px'],
      ['translate3d(120px, 0, 0)', '200px'],
    ])

    harness.unmount()
  })

  it('no deja a la vista el valor de la fila que el nodo mostraba antes', async () => {
    const harness = await mountServer()

    // Llegan las primeras cincuenta y se pintan de verdad.
    await harness.wrapper.setProps({ rows: fill(emptyRows(), 0, 50) })
    await harness.flush()
    expect(harness.canvas.textContent).toContain('Fila 0')

    // Se salta a una zona sin cargar: los MISMOS nodos se reciclan.
    await harness.scrollTo({ top: 300 * ROW_HEIGHT })

    // Una celda no tiene `aria-label`: su nombre accesible es su texto. Dejar el
    // anterior haría que el lector de pantalla anuncie un dato concreto y
    // equivocado sobre una fila que ni siquiera cargó.
    for (const row of placeholderRows(harness)) {
      expect(row.textContent).toBe('')
    }

    harness.unmount()
  })

  it('numera la fila igual, porque la posición sí se conoce', async () => {
    const harness = await mountServer({ showRowNumbers: true })

    const gutter = harness.wrapper.element.querySelector('.dt-gutter')
    const numbers = [...(gutter?.querySelectorAll('.dt-row-number') ?? [])]
      .filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hidden)
      .map((node) => node.textContent)

    expect(numbers).toContain('1')
    expect(numbers).toContain('2')

    harness.unmount()
  })

  it('recupera el renderer real cuando las filas llegan', async () => {
    const harness = await mountServer()
    expect(placeholderRows(harness).length).toBeGreaterThan(0)

    await harness.wrapper.setProps({ rows: fill(emptyRows(), 0, 50) })
    await harness.flush()

    expect(placeholderRows(harness)).toHaveLength(0)
    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder')).toHaveLength(0)
    expect(harness.canvas.textContent).toContain('Fila 3')

    harness.unmount()
  })
})

describe('modo servidor — el marcador y las columnas ancladas', () => {
  it('también marca y ubica las celdas ancladas', async () => {
    const harness = await mountServer({
      columns: [
        { key: 'id', width: 120, pinned: 'start' },
        { key: 'name', width: 200 },
      ],
    })

    const row = placeholderRows(harness)[0]
    const pinned = row?.querySelector('.dt-cell--pinned.dt-cell--placeholder')
    expect(pinned).toBeInstanceOf(HTMLElement)

    // Con caja de verdad: sin ancho, la barra —que se dibuja de borde a borde del
    // padding— saldría de ancho negativo y se colapsaría en una rayita.
    if (pinned instanceof HTMLElement) {
      expect(pinned.style.width).toBe('120px')
      expect(pinned.hidden).toBe(false)
    }

    harness.unmount()
  })

  it('no le pisa el pseudoelemento a la línea del corte', () => {
    // Los dos dibujan sobre la misma celda: la que cierra el bloque anclado y
    // está esperando datos. Compartiendo pseudoelemento, el corte gana por orden
    // de cascada y la barra del marcador desaparece —se ve una rayita de 2px
    // donde tendría que haber una barra—.
    expect(STYLESHEET).toContain('.dt-cell--placeholder::before')
    expect(STYLESHEET).not.toContain('.dt-cell--placeholder::after')
    expect(STYLESHEET).toContain('.dt-cell--pinned-edge::after')
  })

  it('deja la barra quieta para quien pidió menos movimiento', () => {
    // TODOS los bloques de movimiento reducido, no el primero: la hoja tiene
    // varios —el chevron del grupo, la transición del botón de anclar— y
    // quedarse con uno hacía que agregar una regla de movimiento más arriba
    // rompiera este test sin que nada de la barra hubiera cambiado.
    const bloques = [
      ...STYLESHEET.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
    ].map((match) => match[1] ?? '')

    expect(bloques.some((cuerpo) => cuerpo.includes('animation: none'))).toBe(true)
  })
})

describe('modo servidor — lo que no se puede combinar', () => {
  it('ignora groupBy y avisa una sola vez', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const harness = await mountServer({ groupBy: ['name'] })
    await harness.scrollTo({ top: 200 })
    await harness.scrollTo({ top: 400 })

    // No se puede armar un árbol de grupos sobre un dataset que no está cargado
    // entero: los grupos cambiarían de tamaño a medida que se scrollea.
    expect(harness.canvas.querySelectorAll('.dt-group-row')).toHaveLength(0)

    const mentions = warn.mock.calls.filter((call) => String(call[0]).includes('groupBy'))
    expect(mentions).toHaveLength(1)

    warn.mockRestore()
    harness.unmount()
  })
})
