/**
 * Lo que tiene que quedarse quieto, y quién lo sostiene.
 *
 * ## Qué protege este archivo
 *
 * Tres piezas de la grilla no acompañan al scroll: el **encabezado**, la
 * **regleta de numeración** y las **columnas ancladas**. Las tres se resolvían
 * antes con un `transform` escrito desde el `requestAnimationFrame`, y las tres
 * fallaban del mismo modo, por una razón que no depende de cómo esté escrito el
 * código: el navegador scrollea en el hilo del compositor y compone el frame con
 * el desplazamiento nuevo ANTES de que el hilo principal llegue a escribir la
 * compensación. Medido frame compuesto por frame compuesto en el navegador, uno
 * de cada dos mostraba lo compensado corrido el delta entero del scroll y el
 * siguiente lo devolvía de un salto.
 *
 * El arreglo fue mover las tres dentro del scroller y dárselas al compositor con
 * `position: sticky`. Este archivo fija esa decisión desde dos lados:
 *
 * 1. **Nadie les escribe la posición.** Ni al montar ni después de scrollear, en
 *    ninguna dirección. Si alguien vuelve a "ayudar" con un `transform`, acá se
 *    nota.
 * 2. **La estructura que lo hace posible.** Estar en el flujo y dentro del
 *    scroller no es un detalle de maquetado: es la condición para que `sticky`
 *    exista. Y como el encabezado ahora ocupa alto real del contenido, todo lo
 *    que traduce entre scroll y filas tiene que descontarlo.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mountTable } from './harness'
import type { TableHarness, TableProps } from './harness'

type Row = { id: number; name: string; amount: number }

const ROW_HEIGHT = 40
const COLUMN_WIDTH = 200
/** Seis columnas de 200 contra 600 de ancho: siempre hay scroll horizontal. */
const VIEWPORT = { width: 600, height: 400 }

const COLUMNS = [
  { key: 'id', width: COLUMN_WIDTH, pinned: 'start' as const },
  { key: 'name', width: COLUMN_WIDTH },
  { key: 'amount', width: COLUMN_WIDTH },
  { key: 'extra', width: COLUMN_WIDTH },
  { key: 'more', width: COLUMN_WIDTH },
  { key: 'last', width: COLUMN_WIDTH, pinned: 'end' as const },
]

function makeRows(count: number): Row[] {
  const rows: Row[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({ id: index, name: `Name ${index}`, amount: index * 10 })
  }
  return rows
}

async function mountGrid(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: makeRows(200),
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      showRowNumbers: true,
      ...overrides,
    },
  })
}

/** Estilo inline de posición escrito sobre un nodo, si alguien escribió alguno. */
function inlinePosition(node: Element | null): string {
  if (!(node instanceof HTMLElement)) return '(sin nodo)'
  return [node.style.transform, node.style.left, node.style.top].filter(Boolean).join(' ')
}

/* ------------------------------------------------- Nadie escribe posición */

describe('what stays still — nobody writes its position', () => {
  it('leaves the header and the gutter untouched at any scroll position', async () => {
    const harness = await mountGrid()
    const header = harness.wrapper.element.querySelector('.dt-header')
    const gutter = harness.wrapper.element.querySelector('.dt-gutter')

    expect(inlinePosition(header)).toBe('')
    expect(inlinePosition(gutter)).toBe('')

    await harness.scrollTo({ left: 400, top: 800 })

    // Lo único inline que lleva el encabezado es su ANCHO, que no es posición y
    // no cambia al scrollear. Si acá aparece un `transform`, alguien volvió a
    // espejar el scroll desde JS y el desfasaje de un frame volvió con él.
    expect(inlinePosition(header)).toBe('')
    expect(inlinePosition(gutter)).toBe('')
    harness.unmount()
  })

  it('does not move the pinned lanes either', async () => {
    const harness = await mountGrid()

    await harness.scrollTo({ left: 600 })

    for (const lane of harness.canvas.querySelectorAll('.dt-pinned-lane')) {
      expect(inlinePosition(lane)).toBe('')
    }
    harness.unmount()
  })

  it('keeps the pinned header strips where the stylesheet put them', async () => {
    const harness = await mountGrid()

    await harness.scrollTo({ left: 600 })

    const strips = harness.wrapper.element.querySelectorAll('.dt-header-pinned')
    expect(strips).toHaveLength(2)
    for (const strip of strips) {
      // Solo el ancho, igual que el encabezado: dónde se plantan lo dice el CSS.
      expect(strip instanceof HTMLElement && strip.style.transform).toBe('')
    }
    harness.unmount()
  })
})

/* ------------------------------------------------------------ Estructura */

describe('what stays still — the structure that makes it possible', () => {
  it('puts the header inside the scroller', async () => {
    const harness = await mountGrid()

    const viewport = harness.wrapper.element.querySelector('.dt-viewport')
    const header = harness.wrapper.element.querySelector('.dt-header')

    // Es la condición de todo lo demás: afuera del scroller no hay `sticky` que
    // valga, y habría que volver a espejarle el scroll a mano.
    expect(viewport?.contains(header ?? null)).toBe(true)
    expect(header?.getAttribute('role')).toBe('rowgroup')
    harness.unmount()
  })

  it('still reports the header row as the first row of the grid', async () => {
    const harness = await mountGrid()

    const row = harness.grid.querySelector('.dt-header-row')

    // Mudarse adentro del viewport no la saca de la grilla: sigue siendo la fila
    // 1, y las de datos siguen contando desde la 2.
    expect(row?.getAttribute('role')).toBe('row')
    expect(row?.getAttribute('aria-rowindex')).toBe('1')
    expect(harness.cell(0, 'name')?.closest('.dt-row')?.getAttribute('aria-rowindex')).toBe('2')
    harness.unmount()
  })

  it('discounts the header height from a page of rows', async () => {
    // Los dos scrollers miden lo mismo —el andamiaje suma el encabezado al alto
    // pedido—, así que lo único que cambia es cuánto de ese alto se come el
    // encabezado: 44px en uno, 144px en el otro.
    const normal = await mountGrid({ headerHeight: 44 })
    const gordo = await mountTable({
      viewport: { width: VIEWPORT.width, height: 300 },
      props: {
        rows: makeRows(200),
        columns: COLUMNS,
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
        showRowNumbers: true,
        headerHeight: 144,
      },
    })

    await normal.clickCell(0, 'name')
    await normal.press('PageDown')
    await gordo.clickCell(0, 'name')
    await gordo.press('PageDown')

    // 400px de filas son diez; 300px son siete y media, y media fila no se
    // cuenta. Si el alto del encabezado no se descontara, las dos darían once.
    expect(lastActiveRow(normal)).toBe(10)
    expect(lastActiveRow(gordo)).toBe(7)
    normal.unmount()
    gordo.unmount()
  })
})

/** Índice de fila del último `update:activeCell` emitido. */
function lastActiveRow(harness: TableHarness): number | null {
  const emitted = harness.wrapper.emitted('update:activeCell')
  if (!emitted || emitted.length === 0) return null
  const last = emitted[emitted.length - 1]?.[0]
  if (last && typeof last === 'object' && 'rowIndex' in last) {
    return (last as { rowIndex: number }).rowIndex
  }
  return null
}

/* ---------------------------------------- Contrato de la hoja de estilos */

/** La hoja de estilos, sin comentarios. Ver `cell-layout.test.ts`. */
const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('what stays still — what the stylesheet has to guarantee', () => {
  /** Las cinco piezas que no acompañan al scroll, y el eje en que se plantan. */
  const QUIETAS = [
    ['.dt-header', 'top: 0'],
    ['.dt-gutter', 'left: 0'],
    ['.dt-corner', 'left: 0'],
    ['.dt-pinned-lane', 'left: 0'],
    // La etiqueta de un grupo se planta a la derecha de la regleta, no en el
    // cero: la regleta también es sticky y está por encima.
    ['.dt-group-header-inner', 'left: var(--dt-row-number-width, 0px)'],
  ] as const

  for (const [selector, anclaje] of QUIETAS) {
    it(`holds ${selector} still with sticky`, () => {
      const body = new RegExp(`\\${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(STYLESHEET)?.[1] ?? ''

      expect(body).toContain('position: sticky')
      expect(body).toContain(anclaje)
      // Prometerle una capa al navegador por una animación que ya no existe es
      // pedir memoria a cambio de nada.
      expect(body).not.toContain('will-change')
    })
  }

  it('lets the header scroll sideways on its own', () => {
    const body = /\.dt-header\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Se planta arriba y NADA MÁS. Un `left` acá lo dejaría clavado también en
    // horizontal y el encabezado dejaría de acompañar a las columnas.
    expect(body).not.toMatch(/\n\s*left:/)
    expect(body).not.toMatch(/\n\s*right:/)
  })

  it('draws the header rule without adding a pixel to its box', () => {
    const body = /\.dt-header\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Con `border-bottom`, la caja mediría un píxel más que `--dt-header-height`
    // y el canvas —que arranca en ese valor— quedaría corrido respecto de la
    // regleta, que se ubica sola por el flujo.
    expect(body).not.toContain('border-bottom')
    expect(body).toContain('box-shadow: inset 0 -1px 0')
  })

  it('starts the canvas below the header', () => {
    const body = /\.dt-canvas\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''
    expect(body).toContain('top: var(--dt-header-height)')
  })

  it('leaves the group label room to slide inside its band', () => {
    const banda = /\.dt-group-header\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''
    const interior = /\.dt-group-header-inner\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Los dos requisitos que hacen que el anclaje funcione, y que se rompen sin
    // dejar rastro: el navegador no avisa, el nodo simplemente se va con el
    // scroll.
    //
    // 1. Un `overflow` distinto de `visible` en la banda la convierte en
    //    contenedor de scroll, y entonces el hijo se mide contra ELLA —que se
    //    mueve con la fila— en lugar de contra el viewport.
    expect(banda).not.toContain('overflow')
    // 2. `sticky` corre al elemento dentro de su bloque contenedor. Como hijo de
    //    una caja absoluta, este nodo se estiraría al ancho entero de la banda y
    //    no le quedaría margen para correrse.
    expect(interior).toContain('width: fit-content')
  })

  it('spans the group band across the whole row, pinned block included', () => {
    const banda = /\.dt-group-header\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''

    // Arranca en el borde de la fila. El ancho se lo escribe el pool, y es el de
    // la fila entera: si en cambio siguiera al tramo de columnas que scrollean,
    // el bloque anclado quedaría como un hueco vacío.
    expect(banda).toContain('left: 0')
    expect(banda).not.toContain('transform')
  })
})
