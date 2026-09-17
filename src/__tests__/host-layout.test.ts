/**
 * Lo que la tabla necesita del contenedor, y qué pasa cuando no lo recibe.
 *
 * ## Qué protege este archivo
 *
 * `.dt-root` no declara alto propio: lo toma del contenedor. Eso está
 * documentado y es deliberado —una tabla que se impone un alto pelea con
 * cualquier layout—, pero el modo en que fallaba cuando el contenedor no daba
 * ninguno era inaceptable: la tabla pintaba el encabezado, dejaba la barra de
 * scroll y mostraba CERO filas, sin un solo error. Parecía un problema de datos.
 *
 * Y el síntoma dependía de una prop que no tiene nada que ver. Con
 * `showRowNumbers` encendida, la regleta va en flujo con el alto total escrito
 * inline y le daba alto de contenido al viewport, así que la tabla "andaba" por
 * accidente; apagarla la vaciaba.
 *
 * Acá se verifica que ese caso avisa, que avisa UNA sola vez, y que no avisa
 * cuando la tabla simplemente está oculta —que se ve igual desde adentro y es
 * perfectamente normal—.
 *
 * El segundo bloque protege una verdad de la hoja de estilos que la
 * documentación afirma: los tokens `--dt-*` hay que declararlos sobre
 * `.dt-root`, porque la propia `.dt-root` se los declara a sí misma y una
 * declaración en el elemento le gana a cualquier valor heredado de un ancestro.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

/** Monta con el área de filas del alto que se pida. Cero = contenedor colapsado. */
async function mountWith(viewport: { width: number; height: number }) {
  return mountTable({
    viewport,
    // Sin overscan para que el conteo sea exacto: con el valor por defecto se
    // pintan además las filas de margen y el número deja de decir algo.
    props: { rows: rows(50), columns: COLUMNS, rowKey: 'id', rowHeight: 40, overscan: 0 },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('el contenedor no le da alto a la tabla', () => {
  it('avisa en lugar de quedarse vacía en silencio', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const harness = await mountWith({ width: 600, height: 0 })

    // Una fila pintada de cincuenta: la tabla queda vacía a los ojos de
    // cualquiera. No son cero porque el virtualizador suma uno a propósito —así
    // se pinta algo antes de la primera medición en lugar de parpadear en
    // blanco—, y ese mismo `+1` es lo que vuelve el síntoma todavía más confuso
    // sin el aviso: se ve UNA fila suelta y nada más.
    expect(harness.canvas.querySelectorAll('.dt-row:not([hidden])').length).toBeLessThanOrEqual(1)

    const mensajes = warn.mock.calls.map((call) => String(call[0]))
    expect(mensajes.some((m) => m.includes('no tiene alto'))).toBe(true)

    harness.unmount()
  })

  it('avisa una sola vez, no una por frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const harness = await mountWith({ width: 600, height: 0 })
    await harness.scrollTo({ top: 100 })
    await harness.flush()
    await harness.scrollTo({ top: 200 })
    await harness.flush()

    const avisos = warn.mock.calls.filter((call) => String(call[0]).includes('no tiene alto'))
    expect(avisos).toHaveLength(1)

    harness.unmount()
  })

  it('no avisa cuando la tabla solo está oculta', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Ancho cero es lo que mide una tabla dentro de un acordeón cerrado o de una
    // pestaña que no está activa. No hay nada mal configurado ahí, y avisar
    // sería ruido en la consola de cualquiera que monte tablas ocultas.
    const harness = await mountWith({ width: 0, height: 0 })

    const avisos = warn.mock.calls.filter((call) => String(call[0]).includes('no tiene alto'))
    expect(avisos).toHaveLength(0)

    harness.unmount()
  })

  it('no avisa cuando el contenedor sí le da alto', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const harness = await mountWith({ width: 600, height: 400 })
    expect(harness.canvas.querySelectorAll('.dt-row:not([hidden])').length).toBeGreaterThan(0)

    const avisos = warn.mock.calls.filter((call) => String(call[0]).includes('no tiene alto'))
    expect(avisos).toHaveLength(0)

    harness.unmount()
  })
})

describe('dónde se declaran los tokens del tema', () => {
  it('la raíz se declara los tokens a sí misma, y por eso un ancestro no alcanza', () => {
    const cuerpo = /^\.dt-root \{([\s\S]*?)\n\}/m.exec(STYLESHEET)?.[1] ?? ''

    // Es la razón EXACTA por la que la documentación dice que `--dt-*` va sobre
    // `.dt-root`: una declaración en el elemento le gana a un valor heredado, así
    // que un `--dt-primary` puesto en un contenedor padre queda pisado por esta
    // línea y no tiene ningún efecto.
    expect(cuerpo).toContain('--dt-primary: var(--ui-primary,')
    expect(cuerpo).toContain('--dt-bg: var(--ui-bg,')
  })

  it('la documentación no le promete al consumidor que un contenedor alcance', () => {
    const readme = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'),
      'utf8',
    )

    // El ejemplo equivocado —el token suelto sobre una clase cualquiera— estuvo
    // publicado y mandó a alguien por el camino que no funciona. Queda como
    // aserción para que no vuelva.
    expect(readme).toContain('Dónde se declaran los tokens')
    expect(readme).toContain('.mi-contenedor .dt-root')
  })
})
