/**
 * Alturas de fila distintas, de punta a punta.
 *
 * ## Qué protege este archivo
 *
 * `row-metrics.test.ts` verifica la aritmética; acá se verifica que esa
 * aritmética llegue al píxel. Son dos cosas separables, y el modo típico de
 * romper la segunda sin tocar la primera es dejar algún lugar que siga
 * multiplicando el índice por el alto: el recuadro de la selección, el editor,
 * la regleta, la cabecera de grupo. Cada uno tiene su caso acá.
 *
 * ## El invariante que lo sostiene todo
 *
 * **Una fila arranca donde termina la anterior.** Si eso se rompe, las filas se
 * superponen o dejan huecos, y no hay nada en la pantalla que diga cuál de los
 * cuatro lugares lo hizo. Por eso el primer bloque lo comprueba sobre lo
 * PINTADO, leyendo los `transform` del DOM, y no sobre lo calculado.
 *
 * ## Y el que protege al 99% que no usa esto
 *
 * Sin función de altura, el pool no escribe una sola propiedad de alto. La
 * función nueva no puede costarle nada a quien no la pide, y esa es una
 * afirmación verificable: ver el último bloque.
 */

import { describe, expect, it, vi } from 'vitest'
import { mountTable } from './harness'
import type { GridRow } from './harness'

const COLUMNS = [
  { key: 'id', width: 120 },
  { key: 'name', width: 200, editable: true },
] as const

const BASE = 40
const ALTA = 120

function rows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, index) => ({ id: index, name: `Fila ${index}` }))
}

/** Una de cada tres filas es alta. Índices 0, 3, 6… */
function unaDeCadaTres(row: GridRow | undefined): number {
  if (row === undefined) return BASE
  return Number(row.id) % 3 === 0 ? ALTA : BASE
}

async function mountVariable(
  rowHeight: (row: GridRow | undefined, index: number) => number,
  options: { rowCount?: number; height?: number; showRowNumbers?: boolean } = {},
) {
  return mountTable({
    viewport: { width: 600, height: options.height ?? 400 },
    props: {
      rows: rows(options.rowCount ?? 60),
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight,
      overscan: 0,
      showRowNumbers: options.showRowNumbers ?? false,
    },
  })
}

/** Lee la `y` que el pool le escribió a una fila pintada. */
function topOf(node: Element): number {
  const match = /translate3d\(0(?:px)?,\s*(-?[\d.]+)px/.exec((node as HTMLElement).style.transform)
  return match ? Number(match[1]) : Number.NaN
}

/** Alto propio que el pool le escribió a una fila, o `null` si no le escribió ninguno. */
function heightOf(node: Element): number | null {
  const raw = (node as HTMLElement).style.getPropertyValue('--dt-row-h')
  return raw === '' ? null : Number.parseFloat(raw)
}

/** Las filas pintadas, ordenadas por su posición vertical. */
function paintedRows(canvas: HTMLElement): HTMLElement[] {
  return [...canvas.querySelectorAll<HTMLElement>('.dt-row:not([hidden])')].sort(
    (a, b) => topOf(a) - topOf(b),
  )
}

describe('alturas variables — una fila arranca donde termina la anterior', () => {
  it('apila lo pintado sin huecos ni superposiciones', async () => {
    const harness = await mountVariable(unaDeCadaTres)

    const pintadas = paintedRows(harness.canvas)
    expect(pintadas.length).toBeGreaterThan(3)

    for (let i = 1; i < pintadas.length; i += 1) {
      const anterior = pintadas[i - 1]!
      const alto = heightOf(anterior)
      expect(alto).not.toBeNull()
      // Este es el invariante entero. Un `índice * alto` olvidado en cualquier
      // lado lo rompe acá y en ningún otro lugar.
      expect(topOf(pintadas[i]!)).toBe(topOf(anterior) + alto!)
    }

    harness.unmount()
  })

  it('le da a cada fila el alto que pidió el resolutor', async () => {
    const harness = await mountVariable(unaDeCadaTres)

    for (const node of paintedRows(harness.canvas)) {
      const indice = Number(node.getAttribute('aria-rowindex')) - 2
      expect(heightOf(node)).toBe(indice % 3 === 0 ? ALTA : BASE)
    }

    harness.unmount()
  })

  it('dimensiona el canvas con la suma real, no con la cantidad por el alto', async () => {
    const harness = await mountVariable(unaDeCadaTres, { rowCount: 60 })

    // 20 filas de 120 y 40 de 40: 2400 + 1600.
    expect(harness.canvas.style.height).toBe('4000px')

    harness.unmount()
  })

  it('sigue apilando bien después de scrollear lejos', async () => {
    const harness = await mountVariable(unaDeCadaTres, { rowCount: 5_000 })
    await harness.scrollTo({ top: 100_000 })
    await harness.flush()

    const pintadas = paintedRows(harness.canvas)
    for (let i = 1; i < pintadas.length; i += 1) {
      const anterior = pintadas[i - 1]!
      expect(topOf(pintadas[i]!)).toBe(topOf(anterior) + heightOf(anterior)!)
    }

    harness.unmount()
  })

  it('pinta una pantalla y no el dataset', async () => {
    const harness = await mountVariable(unaDeCadaTres, { rowCount: 100_000 })

    // 400px de viewport con filas de 40 y 120: no puede haber más de once.
    expect(paintedRows(harness.canvas).length).toBeLessThanOrEqual(11)

    harness.unmount()
  })
})

describe('alturas variables — la regleta acompaña', () => {
  it('le da al número el mismo alto que a su fila', async () => {
    const harness = await mountVariable(unaDeCadaTres, { showRowNumbers: true })

    const numeros = [...document.querySelectorAll<HTMLElement>('.dt-row-number')].filter(
      (node) => node.textContent !== '',
    )
    expect(numeros.length).toBeGreaterThan(0)

    for (const numero of numeros) {
      // El número vive en la regleta, que es otro contenedor: no hereda de la
      // fila y necesita su propia escritura. Sin ella, la numeración se desfasa
      // de las filas apenas aparece la primera fila alta.
      const indice = Number(numero.textContent) - 1
      expect(heightOf(numero)).toBe(indice % 3 === 0 ? ALTA : BASE)
    }

    harness.unmount()
  })
})

describe('alturas variables — lo que se posiciona sobre las filas', () => {
  it('abre el editor sobre la celda y con su alto', async () => {
    const harness = await mountVariable(unaDeCadaTres)
    // La fila 3 es alta y arranca en 120 + 40 + 40 = 200.
    await harness.doubleClickCell(3, 'name')

    const caja = harness.grid.querySelector<HTMLElement>('.dt-editor')
    expect(caja).not.toBeNull()
    expect(caja!.style.transform).toContain('200px')
    expect(caja!.style.height).toBe(`${ALTA}px`)

    harness.unmount()
  })

  it('abraza el rango entero, no la cantidad de filas por el alto base', async () => {
    const harness = await mountVariable(unaDeCadaTres)
    await harness.clickCell(0, 'id')
    await harness.shiftClickCell(3, 'name')

    const caja = harness.grid.querySelector<HTMLElement>('.dt-range-box')
    expect(caja).not.toBeNull()
    // Filas 0 a 3: 120 + 40 + 40 + 120 = 320. Con la cuenta vieja habrían sido
    // cuatro por el alto base, o sea 160.
    expect(caja!.style.height).toBe('320px')

    harness.unmount()
  })
})

describe('alturas variables — traer una fila a la vista', () => {
  it('deja la fila alta entera dentro del viewport', async () => {
    const harness = await mountVariable(unaDeCadaTres, { rowCount: 500 })

    // La 30 es alta: arranca en 10 * (120 + 40 + 40) = 2000 y termina en 2120.
    harness.api.scrollToCell({ rowIndex: 30, columnKey: 'name' })
    await harness.flush()

    const top = harness.scrollPosition().top
    expect(top).toBeLessThanOrEqual(2_000)
    // Si el alto de la fila se hubiera tomado del base, el borde de abajo
    // quedaría 80px fuera y la fila entraría cortada.
    expect(top + 400).toBeGreaterThanOrEqual(2_120)

    harness.unmount()
  })

  it('scrollToRow lleva la fila al borde de arriba', async () => {
    const harness = await mountVariable(unaDeCadaTres, { rowCount: 500 })

    harness.api.scrollToRow(30)
    await harness.flush()

    expect(harness.scrollPosition().top).toBe(2_000)

    harness.unmount()
  })
})

describe('alturas variables — qué recibe el resolutor', () => {
  it('le pasa la fila y su posición visible', async () => {
    const visto: [unknown, number][] = []
    const harness = await mountVariable(
      (row, index) => {
        visto.push([row, index])
        return BASE
      },
      { rowCount: 5 },
    )

    expect(visto).toHaveLength(5)
    expect(visto[0]).toEqual([{ id: 0, name: 'Fila 0' }, 0])
    expect(visto[4]).toEqual([{ id: 4, name: 'Fila 4' }, 4])

    harness.unmount()
  })

  it('le pasa `undefined` en una cabecera de grupo, para que le dé su alto', async () => {
    const recibidos: (GridRow | undefined)[] = []
    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: {
        rows: rows(6),
        columns: COLUMNS,
        rowKey: 'id',
        groupBy: ['name'],
        overscan: 0,
        rowHeight: (row: GridRow | undefined) => {
          recibidos.push(row)
          return row === undefined ? 24 : BASE
        },
      },
    })

    // Seis grupos de una fila: la secuencia alterna cabecera y fila.
    expect(recibidos.filter((row) => row === undefined)).toHaveLength(6)

    const cabecera = harness.canvas.querySelector('.dt-group-row')
    expect(cabecera).not.toBeNull()
    expect(heightOf(cabecera!)).toBe(24)

    harness.unmount()
  })

  it('no lo llama en cada frame de scroll', async () => {
    const resolutor = vi.fn(unaDeCadaTres)
    const harness = await mountVariable(resolutor, { rowCount: 1_000 })

    const construccion = resolutor.mock.calls.length
    expect(construccion).toBe(1_000)

    for (let frame = 0; frame < 20; frame += 1) {
      await harness.scrollTo({ top: frame * 137 })
      await harness.flush()
    }

    // Veinte frames sobre mil filas: si el resolutor corriera por frame serían
    // veinte mil llamadas más, y la promesa de que scrollear no cuesta nada
    // dejaría de ser cierta.
    expect(resolutor.mock.calls.length).toBe(construccion)

    harness.unmount()
  })
})

describe('alturas variables — el camino de siempre no paga nada', () => {
  it('no le escribe alto a ninguna fila con `rowHeight` numérico', async () => {
    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: { rows: rows(60), columns: COLUMNS, rowKey: 'id', rowHeight: BASE, overscan: 0 },
    })

    for (const node of paintedRows(harness.canvas)) {
      // El alto lo pone la hoja de estilos. Una sola escritura acá serían treinta
      // por frame que antes no existían.
      expect(heightOf(node)).toBeNull()
    }

    harness.unmount()
  })

  it('tampoco cuando la función devuelve el alto base para todas', async () => {
    const harness = await mountVariable(() => BASE)

    for (const node of paintedRows(harness.canvas)) expect(heightOf(node)).toBeNull()

    harness.unmount()
  })

  it('le saca el alto propio a una fila que deja de tenerlo', async () => {
    const harness = await mountVariable(unaDeCadaTres)
    expect(heightOf(paintedRows(harness.canvas)[0]!)).toBe(ALTA)

    await harness.wrapper.setProps({ rowHeight: BASE })
    await harness.flush()

    // Borrar y no reescribir con el alto base: un valor inline le gana a la hoja
    // de estilos para siempre, así que dejarlo puesto congelaría el alto de esa
    // fila aunque la tabla vuelva a ser uniforme.
    for (const node of paintedRows(harness.canvas)) expect(heightOf(node)).toBeNull()

    harness.unmount()
  })
})
