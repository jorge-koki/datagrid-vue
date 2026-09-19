/**
 * `loading`: el esqueleto encendido a mano.
 *
 * ## Qué protege este archivo
 *
 * El esqueleto ya existía, pero atado a una sola causa: en modo servidor, una
 * fila cuya página todavía no llegó. Eso deja fuera los dos momentos en que más
 * falta hace, y son los que se verifican aquí:
 *
 * - **la primera carga**, con `rows` vacío. Sin esta prop la tabla muestra
 *   `emptyText`, que afirma algo que nadie sabe todavía: «no hay datos» y «no sé
 *   todavía» no son lo mismo;
 * - **una reconsulta** —cambiar un filtro, reordenar contra el servidor— donde
 *   `rows` sigue trayendo el resultado ANTERIOR. Pintarlo sería mostrar datos
 *   viejos como si fueran los nuevos, que es peor que no mostrar nada. Por eso
 *   `loading` gana sobre el dato en lugar de rellenar solo los huecos.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mountTable } from './harness'
import type { GridRow } from './harness'

const COLUMNS = [
  { key: 'id', width: 120 },
  { key: 'name', width: 200 },
] as const

const ROW_HEIGHT = 40
const VIEWPORT = { width: 600, height: 400 }

function rows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, index) => ({ id: index, name: `Fila ${index}` }))
}

async function mountWith(props: Record<string, unknown>) {
  return mountTable({
    viewport: VIEWPORT,
    props: { columns: COLUMNS, rowKey: 'id', rowHeight: ROW_HEIGHT, ...props } as never,
  })
}

describe('loading — la primera carga, sin una sola fila', () => {
  it('dibuja esqueleto en vez del mensaje de vacío', async () => {
    const harness = await mountWith({ rows: [], loading: true })

    // «No hay datos» sobre una consulta que todavía no respondió es afirmar algo
    // que nadie sabe. Mientras se espera, el mensaje se calla.
    expect(harness.wrapper.element.querySelector('.dt-empty')).toBeNull()
    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder').length).toBeGreaterThan(0)

    harness.unmount()
  })

  it('llena la pantalla y ni una fila más', async () => {
    const harness = await mountWith({ rows: [], loading: true })

    // El esqueleto es una señal de espera, no una promesa de cuántos resultados
    // van a llegar: inventar una barra de scroll larga y que después lleguen tres
    // filas se lee como un error.
    const pintadas = harness.canvas.querySelectorAll('.dt-row--placeholder').length
    const entran = Math.ceil(VIEWPORT.height / ROW_HEIGHT)

    expect(pintadas).toBeGreaterThan(0)
    expect(pintadas).toBeLessThanOrEqual(entran + 2)

    harness.unmount()
  })

  it('apagado, la tabla vacía vuelve a decir que está vacía', async () => {
    const harness = await mountWith({ rows: [], loading: false })

    expect(harness.wrapper.element.querySelector('.dt-empty')).not.toBeNull()
    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder')).toHaveLength(0)

    harness.unmount()
  })
})

describe('loading — la reconsulta, con datos viejos todavía en `rows`', () => {
  it('tapa el resultado anterior en lugar de mostrarlo', async () => {
    const harness = await mountWith({ rows: rows(20), loading: true })

    // EL caso que separa esta prop del esqueleto automático. Aquel solo rellena
    // huecos —filas que no llegaron—; aquí las filas SÍ están, con el resultado
    // de la consulta anterior, y mostrarlas sería mentir sobre lo que se ve.
    const celdas = harness.canvas.querySelectorAll('.dt-cell')
    const esqueletos = harness.canvas.querySelectorAll('.dt-cell--placeholder')

    expect(celdas.length).toBeGreaterThan(0)
    expect(esqueletos.length).toBe(celdas.length)
    expect(harness.canvas.textContent).not.toContain('Fila 0')

    harness.unmount()
  })

  it('al apagarse aparecen los datos, sin recrear el pool', async () => {
    const harness = await mountWith({ rows: rows(20), loading: true })
    const antes = harness.canvas.querySelectorAll('.dt-row').length

    await harness.wrapper.setProps({ loading: false })
    await harness.flush()

    // El esqueleto es un estado de PINTADO, no una estructura distinta: apagarlo
    // no crea ni destruye un nodo de fila.
    expect(harness.canvas.querySelectorAll('.dt-row').length).toBe(antes)
    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder')).toHaveLength(0)
    expect(harness.canvas.textContent).toContain('Fila 0')

    harness.unmount()
  })
})

describe('la tabla vacía — sin texto, sin caja', () => {
  it('con `emptyText` vacío no dibuja NADA', async () => {
    const harness = await mountWith({ rows: [], emptyText: '' })

    // El elemento entero, no solo su texto. `.dt-empty` dibuja una línea arriba y
    // reserva 2rem de aire a cada lado: con la cadena vacía quedaba una franja de
    // 4rem cruzada por un separador que no separa nada.
    expect(harness.wrapper.element.querySelector('.dt-empty')).toBeNull()

    harness.unmount()
  })

  it('un texto de puros espacios cuenta como vacío', async () => {
    const harness = await mountWith({ rows: [], emptyText: '   ' })

    // No se ve, y de todas formas arrastraría la caja.
    expect(harness.wrapper.element.querySelector('.dt-empty')).toBeNull()

    harness.unmount()
  })

  it('con texto, ahí sí aparece', async () => {
    const harness = await mountWith({ rows: [], emptyText: 'Sin resultados' })

    expect(harness.wrapper.element.querySelector('.dt-empty')?.textContent).toBe('Sin resultados')

    harness.unmount()
  })
})

describe("loading: 'blank' — esperando, sin mostrar nada", () => {
  it('no pinta esqueleto ni mensaje', async () => {
    const harness = await mountWith({ rows: [], loading: 'blank' })

    // Sigue siendo "estoy esperando", así que el mensaje de vacío tampoco aparece:
    // eso afirmaría algo que nadie sabe todavía. Simplemente no hay nada que ver.
    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder')).toHaveLength(0)
    expect(harness.wrapper.element.querySelector('.dt-empty')).toBeNull()

    harness.unmount()
  })

  it('tampoco muestra los datos viejos de una reconsulta', async () => {
    const harness = await mountWith({ rows: rows(20), loading: 'blank' })

    // Lo mismo que con el esqueleto: `rows` trae el resultado anterior y
    // mostrarlo sería mentir. La diferencia es qué se pone en su lugar, no si se
    // tapa o no.
    expect(harness.canvas.textContent).not.toContain('Fila 0')
    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder')).toHaveLength(0)

    harness.unmount()
  })

  it("`'skeleton'` es el nombre largo de `true`", async () => {
    const harness = await mountWith({ rows: [], loading: 'skeleton' })

    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder').length).toBeGreaterThan(0)

    harness.unmount()
  })
})

describe('el mensaje de vacío — centrado y sin línea', () => {
  it('no dibuja ningún borde', () => {
    const hoja = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const cuerpo = /\.dt-empty\s*\{([^}]*)\}/.exec(hoja)?.[1] ?? ''

    // El `border-top` se leía como un separador que no separaba nada: el mensaje
    // no es una sección de la tabla, es lo único que hay.
    expect(cuerpo).not.toMatch(/border/)
    // Y va en capa sobre el cuerpo, que es lo que lo centra de verdad en los dos
    // ejes. En el flujo quedaba pegado abajo del viewport.
    expect(cuerpo).toContain('position: absolute')
    expect(cuerpo).toContain('align-items: center')
    expect(cuerpo).toContain('justify-content: center')
    // Empieza bajo el encabezado: los títulos siguen ahí aunque no haya filas.
    expect(cuerpo).toContain('var(--dt-header-height)')
    // Y no se come la rueda del mouse.
    expect(cuerpo).toContain('pointer-events: none')
  })
})

describe('loading — lo que no cambia', () => {
  it('viene apagado', async () => {
    const harness = await mountWith({ rows: rows(10) })

    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder')).toHaveLength(0)
    expect(harness.canvas.textContent).toContain('Fila 0')

    harness.unmount()
  })

  it('el esqueleto de modo servidor sigue apareciendo solo', async () => {
    // Sin `loading`: la página que no llegó se pinta como esqueleto igual. Esta
    // prop suma un disparador, no reemplaza el que ya existía.
    const harness = await mountWith({ rows: [], rowCount: 500 })

    expect(harness.canvas.querySelectorAll('.dt-cell--placeholder').length).toBeGreaterThan(0)

    harness.unmount()
  })
})
