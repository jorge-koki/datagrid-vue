/**
 * La variante `rows`: separar filas y ninguna columna.
 *
 * ## Qué protege este archivo
 *
 * Es un preset, no una combinación de `stripe` y `bordered`. La diferencia se
 * nota en un solo caso y es justamente el que se rompe solo: con `bordered`
 * encendido, las verticales tienen que seguir sin aparecer. Las dos reglas pesan
 * exactamente lo mismo —`.dt-root` más un atributo más `.dt-cell`—, así que sin
 * los ceros explícitos el desempate queda en el orden del archivo, y alguien que
 * mueva un bloque de sitio devuelve las líneas que esta variante existe para no
 * tener.
 *
 * `happy-dom` no resuelve la cascada de una hoja externa, así que aquí no se
 * puede afirmar que la línea SE PINTÓ. Se verifican las dos mitades del contrato
 * que la produce: que el componente escriba el atributo, y que la hoja cuelgue
 * las reglas de ese atributo y declare los dos lados.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mountTable } from './harness'
import type { GridRow } from './harness'
import type { DataTableVariant } from '../types'

const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
  'utf8',
)

/** La hoja sin comentarios, por lo mismo que en `crosshair.test.ts`. */
const CSS = STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, '')

const COLUMNS = [
  { key: 'id', width: 120 },
  { key: 'name', width: 200 },
] as const

function rows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, index) => ({ id: index, name: `Fila ${index}` }))
}

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

async function mountWith(variant: DataTableVariant, bordered = false) {
  return mountTable({
    viewport: { width: 600, height: 400 },
    props: { rows: rows(20), columns: COLUMNS, rowKey: 'id', variant, bordered },
  })
}

describe('variante rows — el atributo del que cuelga', () => {
  it('escribe el preset en la raíz', async () => {
    const harness = await mountWith('rows')

    expect(harness.grid.getAttribute('data-variant')).toBe('rows')

    harness.unmount()
  })

  it('no se enciende sola: las otras dos escriben lo suyo', async () => {
    for (const preset of ['default', 'cells'] as const) {
      const harness = await mountWith(preset)

      expect(harness.grid.getAttribute('data-variant')).toBe(preset)

      harness.unmount()
    }
  })
})

describe('variante rows — separa filas y ninguna columna', () => {
  it('pone la línea abajo y quita la de la derecha', () => {
    const celda = ruleBody(".dt-root[data-variant='rows'] .dt-cell") ?? ''

    expect(celda).toContain('border-bottom: 1px solid var(--dt-border)')
    // El cero es la mitad del preset, no una redundancia: ver la cabecera.
    expect(celda).toContain('border-right: 0')
  })

  it('también se la quita al encabezado', () => {
    const encabezado = ruleBody(".dt-root[data-variant='rows'] .dt-header-cell") ?? ''

    expect(encabezado).toContain('border-right: 0')
  })

  it('gana contra `bordered`, que es lo que la hace un preset', () => {
    // La prueba de verdad de este archivo. Las dos reglas pesan lo mismo, así que
    // la que decide es la que va última en el archivo. Si alguien mueve el bloque
    // de `bordered` más abajo, `variant: 'rows'` con `bordered` encendido vuelve
    // a dibujar verticales y nada más se entera.
    const posicionBordered = CSS.indexOf(".dt-root[data-bordered='true'] .dt-cell")
    const posicionRows = CSS.indexOf(".dt-root[data-variant='rows'] .dt-cell")

    expect(posicionBordered).toBeGreaterThan(-1)
    expect(posicionRows).toBeGreaterThan(posicionBordered)
  })

  it('nunca dibuja el borde de arriba, que sería la misma línea dos veces', () => {
    const celda = ruleBody(".dt-root[data-variant='rows'] .dt-cell") ?? ''

    // El borde inferior de una fila y el superior de la siguiente se apoyan en el
    // mismo píxel: dibujar los dos da una línea del doble de grosor que el resto.
    expect(celda).not.toMatch(/border-top/)
  })
})

describe('variante rows — lo que no toca', () => {
  it('deja en pie el corte del bloque anclado, que es estructura', () => {
    // La única vertical que sobrevive, y a propósito: dice dónde termina lo fijo
    // y empieza lo que scrollea. Sin él, justo en esta variante, un bloque anclado
    // y uno suelto se verían iguales hasta que el usuario scrollee.
    //
    // Que el corte se dibuje bien es asunto de `pinned-columns.test.ts`. Lo que
    // se afirma acá es lo único que esta variante podría romperle: que ninguna de
    // sus reglas lo alcance. Se apoya en que lo dibuja un pseudoelemento y no un
    // borde, así que los ceros de arriba no le llegan.
    const reglasDeLaVariante = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector = '']) => selector.replace(/\s+/g, ' ').trim())
      .filter((selector) => selector.includes("[data-variant='rows']"))

    expect(reglasDeLaVariante.length).toBeGreaterThan(0)
    expect(reglasDeLaVariante.some((selector) => selector.includes('pinned-edge'))).toBe(false)
  })

  it('no le toca nada a las otras dos variantes', () => {
    expect(ruleBody(".dt-root[data-variant='cells'] .dt-cell")).toContain('border-right: 1px')
    expect(ruleBody(".dt-root[data-bordered='true'] .dt-cell")).toContain('border-right: 1px')
  })
})
