/**
 * El realce de la fila bajo el puntero, en modo de selección por fila.
 *
 * ## Qué protege este archivo
 *
 * El realce son tres reglas de la hoja de estilos y un puente en JS. Ninguna
 * prueba de comportamiento se entera si alguna de esas piezas se despega:
 * renombrar `data-selection` deja las reglas vivas pero sin nada de donde
 * colgar, y el realce desaparece en silencio sin que falle un solo test.
 *
 * `happy-dom` no resuelve la cascada de una hoja externa ni tiene puntero, así
 * que aquí no se puede afirmar que la fila SE PINTÓ —eso se verifica en un
 * navegador de verdad—. Lo que se verifica es el contrato que lo produce: que el
 * componente escriba el atributo, y que la hoja cuelgue el realce de ese
 * atributo y de ningún otro lado.
 *
 * Lo que este archivo NO deja pasar, y es la razón de que exista:
 *
 * - que el realce se escape a los modos `cell` y `none`, donde prometería un
 *   clic que selecciona la fila y el clic no hace eso;
 * - que el realce vuelva a ser un COLOR en vez de un tinte, que es lo que lo
 *   dejó invisible contra el fondo de la regleta la primera vez;
 * - que el tinte se meta en `background-color`, el canal que una celda anclada
 *   necesita opaco para tapar lo que scrollea por debajo;
 * - que el selector del puente en JS se despegue del de la hoja, con lo que la
 *   regleta dejaría de acompañar a su fila.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mountTable } from './harness'
import type { GridRow } from './harness'
import { HOVERED_ROW_SELECTOR } from '../internal/constants'
import type { SelectionMode } from '../types'

const STYLESHEET = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'datatable.css'),
  'utf8',
)

/*
 * La hoja sin comentarios.
 *
 * Se quitan ANTES de parsear, por lo mismo que en `crosshair.test.ts`: los
 * comentarios de la hoja citan selectores y llaves, y con ellos adentro el
 * cuerpo de una regla se corta en la primera llave de una cita.
 */
const CSS = STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, '')

const COLUMNS = [
  { key: 'id', width: 120 },
  { key: 'name', width: 200 },
] as const

function rows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, index) => ({ id: index, name: `Fila ${index}` }))
}

/** La fila apuntada. Lo único suyo es el cursor: la fila no pinta. */
const HOVER = HOVERED_ROW_SELECTOR

/** Sus celdas, que son las que llevan el tinte. */
const HOVER_CELL = `${HOVER} .dt-cell`

/** Y su número en la regleta, al que ningún selector llega desde la fila. */
const NUMERO = ".dt-root[data-selection='row'] .dt-row-number--hover"

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

/**
 * El contenido de cada `@media (hover: hover) { ... }`, contando llaves.
 *
 * Hace falta contarlas porque adentro hay reglas con su propio par, y cortar en
 * la primera llave de cierre devolvería media consulta.
 */
function hoverMediaBlocks(): string[] {
  const bloques: string[] = []
  const apertura = /@media\s*\(\s*hover:\s*hover\s*\)\s*\{/g
  let match = apertura.exec(CSS)
  while (match !== null) {
    let profundidad = 1
    let i = match.index + match[0].length
    const desde = i
    while (i < CSS.length && profundidad > 0) {
      if (CSS[i] === '{') profundidad += 1
      else if (CSS[i] === '}') profundidad -= 1
      i += 1
    }
    bloques.push(CSS.slice(desde, i - 1))
    match = apertura.exec(CSS)
  }
  return bloques
}

async function mountWith(selectionMode: SelectionMode) {
  return mountTable({
    viewport: { width: 600, height: 400 },
    props: { rows: rows(30), columns: COLUMNS, rowKey: 'id', selectionMode },
  })
}

describe('el realce de la fila — el atributo del que cuelga', () => {
  it('escribe el modo en la raíz, que es de donde cuelgan las reglas', async () => {
    const harness = await mountWith('row')

    expect(harness.grid.getAttribute('data-selection')).toBe('row')

    harness.unmount()
  })

  it('escribe los otros dos modos con su propio nombre', async () => {
    for (const modo of ['cell', 'none'] as const) {
      const harness = await mountWith(modo)

      expect(harness.grid.getAttribute('data-selection')).toBe(modo)

      harness.unmount()
    }
  })

  it('cambia de modo sin que el pool toque una sola fila', async () => {
    const harness = await mountWith('cell')

    const antes = harness.canvas.querySelectorAll('.dt-row').length
    await harness.wrapper.setProps({ selectionMode: 'row' })
    await harness.flush()

    // El atributo vive en la raíz: encender el realce no le cuesta al pool ni
    // una escritura, ni crea ni destruye un nodo.
    expect(harness.grid.getAttribute('data-selection')).toBe('row')
    expect(harness.canvas.querySelectorAll('.dt-row').length).toBe(antes)

    harness.unmount()
  })
})

describe('el realce de la fila — las reglas', () => {
  it('existen las tres y cuelgan del modo fila', () => {
    expect(ruleBody(HOVER)).not.toBeNull()
    expect(ruleBody(HOVER_CELL)).not.toBeNull()
    expect(ruleBody(NUMERO)).not.toBeNull()
  })

  it('la fila no pinta: lo suyo es el cursor y nada más', () => {
    // EL invariante de la tabla: la fila tiene el ancho entero, así que no pinta
    // nunca —lo suyo se vería de punta a punta— y lo que se ve son sus celdas.
    // `pinned-columns.test.ts` lo vigila para toda la hoja; aquí se afirma que el
    // realce lo respeta en lugar de abrirse una excepción.
    expect(ruleBody(HOVER)).toContain('cursor: pointer')
    expect(ruleBody(HOVER)).not.toMatch(/background/)
  })

  it('tiñe en una capa aparte, para no volver traslúcida una celda anclada', () => {
    const cuerpo = ruleBody(HOVER_CELL) ?? ''

    // La misma disciplina que `.dt-cell--range`, y por la misma razón exacta: una
    // celda anclada necesita su `background-color` OPACO para tapar lo que
    // scrollea por debajo. Un tinte semitransparente ahí la volvería una ventana.
    expect(cuerpo).toContain('background-image')
    expect(cuerpo).toContain('var(--dt-row-tint-hover)')
    expect(cuerpo).not.toMatch(/background-color/)
  })

  it('no se enciende donde no hay puntero que pasar', () => {
    // En una pantalla táctil `:hover` se queda pegado después de tocar: el
    // realce sobreviviría al toque y se leería como una selección que no es.
    const bloques = hoverMediaBlocks()

    expect(bloques.some((bloque) => bloque.includes('var(--dt-row-tint-hover)'))).toBe(true)
    expect(bloques.some((bloque) => bloque.includes('.dt-row-number--hover'))).toBe(true)
  })

  it('no deja ningún realce suelto fuera del modo fila', () => {
    // El corazón del archivo. Una regla `.dt-row:hover` sin el atributo delante
    // pintaría la fila entera también en modo `cell`, donde lo que se elige es
    // una celda, y en `none`, donde no se elige nada.
    const pattern = /([^{}]+)\{([^{}]*)\}/g
    const sueltas: string[] = []
    let match = pattern.exec(CSS)
    while (match !== null) {
      const selector = (match[1] ?? '').replace(/\s+/g, ' ').trim()
      const esDeFila = selector.includes('.dt-row') && selector.includes(':hover')
      if (esDeFila && !selector.includes("[data-selection='row']")) sueltas.push(selector)
      match = pattern.exec(CSS)
    }

    expect(sueltas).toEqual([])
  })
})

describe('el realce de la fila — la regleta, que el CSS no alcanza', () => {
  it('el selector de JS y el de la hoja son el mismo, carácter por carácter', () => {
    // La única copia del proyecto, y la razón de que exista está en el comentario
    // de `HOVERED_ROW_SELECTOR`: el número no es hijo de su fila, así que el pool
    // tiene que preguntarle a la hoja a quién le toca. Si alguien cambia una de
    // las dos puntas —agrega una exclusión, renombra una clase— la regleta se
    // desincroniza de la fila y no falla nada más que esto.
    const plano = CSS.replace(/\s+/g, ' ')

    expect(plano).toContain(HOVERED_ROW_SELECTOR.replace(/\s+/g, ' '))
  })

  it('tiñe la regleta con EL MISMO tinte que las celdas', () => {
    // Las dos mitades de UNA banda. Que se separen es exactamente el defecto que
    // trajo todo esto: la fila realzada y el número a su izquierda sin realzar,
    // con la banda cortada justo en el borde de la regleta.
    expect(ruleBody(NUMERO)).toContain('var(--dt-row-tint-hover)')
    expect(ruleBody(HOVER_CELL)).toContain('var(--dt-row-tint-hover)')
  })

  it('no le tapa el fondo a la regleta, se lo tiñe', () => {
    // La regleta se pinta un escalón MÁS ARRIBA que las filas. Un color fijo que
    // se vea sobre la fila se pierde contra ese fondo —con `--dt-bg-elevated`
    // quedó exactamente invisible, que es el bug que trajo el tinte— y uno que se
    // vea sobre la regleta gritaría sobre la fila. El tinte no elige: aclara lo
    // que tenga debajo, sea lo que sea.
    const cuerpo = ruleBody(NUMERO) ?? ''

    expect(cuerpo).toContain('background-image')
    expect(cuerpo).not.toMatch(/background-color/)
  })
})

describe('el realce de la fila — pesa menos que la selección', () => {
  it('usa un token propio, que el consumidor puede pisar solo', () => {
    // Separado a propósito de las superficies: quien quiera otro realce no tiene
    // por qué mover de paso el fondo de las cabeceras de grupo ni el de la regleta.
    expect(CSS).toContain('--dt-row-tint-hover:')
  })

  it('el tinte es semitransparente, que es lo que lo deja convivir con todo', () => {
    // Si fuera opaco taparía la marca de rango de un número, y en una celda
    // anclada —que necesita su fondo opaco— habría que elegir entre el realce y
    // no dejar ver lo que scrollea por debajo.
    const token = /--dt-row-tint-hover:([^;]+);/.exec(CSS)?.[1] ?? ''

    expect(token).toContain('transparent')
    expect(token).toContain('color-mix')
  })

  it('SÍ alcanza a la fila activa: el tinte se suma, no la reemplaza', () => {
    // Una regresión con nombre. La fila activa estuvo excluida mientras el realce
    // era un color que reemplazaba al suyo —uno más tenue encima de la elegida la
    // habría hecho ver soltarse—. Al pasar a un tinte, que se SUMA, la exclusión
    // se quedó sin motivo y con ella la fila que uno acababa de tocar era la única
    // que dejaba de responder al puntero. Se veía como una fila trabada.
    expect(HOVERED_ROW_SELECTOR).not.toContain('.dt-row--active')
    // Y sigue marcándose como activa: el tinte se apoya encima, no la borra.
    expect(ruleBody('.dt-row--active')).toContain('var(--dt-bg-accented)')
  })

  it('deja afuera solo lo que no es una fila que se elija', () => {
    // La cabecera de grupo no se selecciona —su clic pliega— y el esqueleto de
    // carga todavía no es ninguna fila. Prometer un clic que no llega es el único
    // motivo válido para excluir algo de aquí.
    expect(HOVERED_ROW_SELECTOR).toContain('.dt-group-row')
    expect(HOVERED_ROW_SELECTOR).toContain('.dt-row--placeholder')
  })
})
