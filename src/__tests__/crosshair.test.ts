/**
 * La cruz de la celda activa: las dos líneas de los bordes que no scrollean.
 *
 * ## Qué protege este archivo
 *
 * Son dos marcas que tienen que comportarse como UNA: la línea bajo el
 * encabezado de la columna activa y la del costado del número de la fila activa.
 * El modo de romperlo es dejar una encendida y la otra no —que es exactamente el
 * estado del que salió esta prop, con la del encabezado puesta de fábrica y la
 * de la regleta inexistente—, y eso no se ve en ningún test de comportamiento:
 * las dos son reglas de la hoja de estilos.
 *
 * `happy-dom` no resuelve la cascada de una hoja externa, así que acá no se
 * puede afirmar que la línea se PINTÓ. Lo que se verifica son las dos mitades
 * del contrato que la producen: que el componente escriba el atributo que la
 * enciende, y que la hoja de estilos cuelgue las dos reglas de ese atributo y de
 * ningún otro lado.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mountTable } from './harness'
import type { GridRow } from './harness'

const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
  'utf8',
)

const COLUMNS = [
  { key: 'id', width: 120 },
  { key: 'name', width: 200 },
] as const

function rows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, index) => ({ id: index, name: `Fila ${index}` }))
}

async function mountWith(crosshair?: boolean) {
  return mountTable({
    viewport: { width: 600, height: 400 },
    props: { rows: rows(30), columns: COLUMNS, rowKey: 'id', showRowNumbers: true, crosshair },
  })
}

/**
 * La hoja sin comentarios.
 *
 * Se quitan ANTES de parsear, y no es cosmético: los comentarios de este archivo
 * citan selectores y llaves, y con ellos adentro el selector de una regla queda
 * pegado al párrafo que la explica y el cuerpo se corta en la primera llave de
 * una cita.
 */
const CSS = STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, '')

/** Cuerpo de la regla cuyo selector coincide exactamente, o `null`. */
function ruleBody(selector: string): string | null {
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  const target = selector.replace(/\s+/g, ' ').trim()
  let match = pattern.exec(CSS)
  while (match !== null) {
    if ((match[1] ?? '').replace(/\s+/g, ' ').trim() === target) return match[2] ?? ''
    match = pattern.exec(CSS)
  }
  return null
}

describe('la cruz — el interruptor', () => {
  it('viene apagada', async () => {
    const harness = await mountWith()

    expect(harness.grid.getAttribute('data-crosshair')).toBe('false')

    harness.unmount()
  })

  it('escribe el atributo que la enciende', async () => {
    const harness = await mountWith(true)

    expect(harness.grid.getAttribute('data-crosshair')).toBe('true')

    harness.unmount()
  })

  it('se apaga y se enciende sin repintar el cuerpo', async () => {
    const harness = await mountWith(false)
    await harness.clickCell(3, 'name')

    const antes = harness.canvas.querySelectorAll('.dt-row').length
    await harness.wrapper.setProps({ crosshair: true })
    await harness.flush()

    // El atributo vive en la raíz, no en las filas: encender la cruz no le
    // cuesta al pool una sola escritura, ni crea ni destruye un nodo.
    expect(harness.grid.getAttribute('data-crosshair')).toBe('true')
    expect(harness.canvas.querySelectorAll('.dt-row').length).toBe(antes)

    harness.unmount()
  })
})

describe('la cruz — las dos líneas van juntas o no van', () => {
  it('cuelga las dos del mismo atributo', () => {
    const header = ruleBody(".dt-root[data-crosshair='true'] .dt-header-cell--active")
    const numero = ruleBody(".dt-root[data-crosshair='true'] .dt-row-number--active")

    expect(header).not.toBeNull()
    expect(numero).not.toBeNull()
    // Las dos con el mismo grosor y el mismo color: son una sola marca vista
    // desde dos bordes, y que se separen es justamente el bug que originó la
    // prop.
    expect(header).toContain('var(--dt-crosshair-width)')
    expect(header).toContain('var(--dt-primary)')
    expect(numero).toContain('var(--dt-crosshair-width)')
    expect(numero).toContain('var(--dt-primary)')
  })

  it('no deja ninguna línea suelta fuera del interruptor', () => {
    // Este es el corazón del archivo. La línea del encabezado estuvo puesta de
    // fábrica durante toda la vida del componente; si alguien la devuelve acá,
    // `crosshair: false` deja de significar "ninguna línea".
    const header = ruleBody('.dt-header-cell--active') ?? ''
    const numero = ruleBody('.dt-row-number--active') ?? ''

    expect(header).not.toContain('var(--dt-primary)')
    expect(numero).not.toContain('var(--dt-primary)')
  })

  it('le deja el fondo acentuado a las dos, que no depende del interruptor', () => {
    // Apagar la cruz apaga LAS LÍNEAS. Saber en qué columna y en qué fila está
    // uno sigue estando, con la señal más discreta de siempre.
    expect(ruleBody('.dt-header-cell--active')).toContain('var(--dt-bg-accented)')
    expect(ruleBody('.dt-row-number--active')).toContain('var(--dt-bg-accented)')
  })

  it('declara el grosor como token propio, separado del de la selección', () => {
    // No comparten token a propósito: el contorno de la selección tiene que
    // confundirse con la grilla, y la cruz tiene que verse desde el otro extremo
    // de la tabla. Mismo valor hoy no significa misma razón.
    const raiz = ruleBody('.dt-root') ?? ''
    expect(raiz).toContain('--dt-crosshair-width:')
    expect(raiz).toContain('--dt-selection-width:')
  })
})
