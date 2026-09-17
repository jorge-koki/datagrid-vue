/**
 * Selección y navegación con teclado, sobre el componente montado.
 *
 * Es el único bloque de la suite que necesita la tabla entera: la navegación
 * vive en el viewport, opera sobre la celda activa —que es estado del
 * componente, no el nodo con foco— y coordina scroll, edición y emisión de
 * eventos. Los nodos del pool se reciclan y el foco del DOM no sobrevive a un
 * scroll: ese es exactamente el motivo por el que el teclado no se maneja en el
 * pool.
 *
 * Las aserciones de auto-scroll son en píxeles exactos a propósito. "Se ve la
 * celda" es una afirmación que cualquier implementación cumple saltando al
 * medio de la tabla; lo que hay que proteger es que el desplazamiento sea el
 * MÍNIMO necesario, porque un salto de más pierde el contexto visual del
 * usuario.
 */

import { describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { mountTable } from './harness'
import type { GridRow, TableHarness, TableProps } from './harness'
import type { BeforeEditEvent, CellPosition } from '../types'

type Row = { id: number; name: string; amount: number; city: string; done: boolean }

/** Altura de fila y de viewport usadas en todo el archivo. */
const ROW_HEIGHT = 40
const VIEWPORT = { width: 600, height: 400 }
/** 400 / 40 = 10 filas completas visibles. */
const VISIBLE_ROWS = 10
const COLUMN_WIDTH = 120

function makeRows(count: number): Row[] {
  const rows: Row[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({
      id: index,
      name: `Name ${index}`,
      amount: index * 10,
      city: `City ${index}`,
      done: index % 2 === 0,
    })
  }
  return rows
}

/** Seis columnas de 120px: cinco entran en el viewport de 600px. */
const COLUMNS = [
  { key: 'id', width: COLUMN_WIDTH, editable: true },
  { key: 'name', width: COLUMN_WIDTH, editable: true },
  { key: 'amount', width: COLUMN_WIDTH, editable: true },
  { key: 'city', width: COLUMN_WIDTH, editable: true },
  { key: 'done', width: COLUMN_WIDTH },
  { key: 'extra', width: COLUMN_WIDTH },
] as const

const COLUMN_KEYS = COLUMNS.map((column) => column.key)

async function mountGrid(
  overrides: Partial<TableProps> = {},
  rowCount = 100,
): Promise<TableHarness> {
  return mountTable({
    viewport: VIEWPORT,
    props: {
      rows: makeRows(rowCount),
      columns: COLUMNS,
      rowKey: 'id',
      rowHeight: ROW_HEIGHT,
      ...overrides,
    },
  })
}

/** Última celda activa anunciada por `update:activeCell`. */
function lastActiveCell(wrapper: VueWrapper): CellPosition | null {
  const events = wrapper.emitted('update:activeCell')
  if (!events || events.length === 0) return null
  const payload: unknown = events[events.length - 1]?.[0]
  if (payload === null || payload === undefined) return null
  if (typeof payload !== 'object' || !('rowIndex' in payload) || !('columnKey' in payload)) {
    throw new Error('[test] update:activeCell emitió una forma inesperada')
  }
  const { rowIndex, columnKey } = payload
  if (typeof rowIndex !== 'number' || typeof columnKey !== 'string') {
    throw new Error('[test] update:activeCell emitió una forma inesperada')
  }
  return { rowIndex, columnKey }
}

/** Cantidad de veces que se anunció un cambio de celda activa. */
function activeCellEmissions(wrapper: VueWrapper): number {
  return wrapper.emitted('update:activeCell')?.length ?? 0
}

/**
 * Selecciona una celda que todavía no está pintada.
 *
 * Solo hay nodos para la ventana visible: para hacer clic en la fila 50 primero
 * hay que llevarla a pantalla, igual que haría un usuario.
 */
async function selectFarCell(
  harness: TableHarness,
  rowIndex: number,
  columnKey: string,
): Promise<void> {
  await harness.scrollTo({ top: rowIndex * ROW_HEIGHT })
  await harness.clickCell(rowIndex, columnKey)
}

describe('selection — a single click selects, it does not edit', () => {
  it('selects the clicked cell', async () => {
    const harness = await mountGrid()

    await harness.clickCell(2, 'name')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'name' })
    harness.unmount()
  })

  it('does not open the editor on a single click', async () => {
    const harness = await mountGrid()

    await harness.clickCell(2, 'name')

    // Seleccionar para mirar o para navegar con el teclado es mucho más
    // frecuente que editar: exigir doble clic para lo primero agregaría un gesto
    // al caso común.
    expect(harness.editor()).toBeNull()
    harness.unmount()
  })

  it('opens the editor on a double click', async () => {
    const harness = await mountGrid()

    await harness.doubleClickCell(2, 'name')

    expect(harness.editor()).not.toBeNull()
    harness.unmount()
  })

  it('emits cellSelect with the row, the column and the value', async () => {
    const harness = await mountGrid()

    await harness.clickCell(3, 'amount')

    const emitted = harness.wrapper.emitted('cellSelect')
    expect(emitted).toHaveLength(1)
    expect(emitted?.[0]?.[0]).toMatchObject({ rowIndex: 3, columnKey: 'amount', value: 30 })
    harness.unmount()
  })

  it('does not re-announce a click on the already active cell', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')
    const before = activeCellEmissions(harness.wrapper)

    await harness.clickCell(2, 'name')

    expect(activeCellEmissions(harness.wrapper)).toBe(before)
    harness.unmount()
  })

  it('marks the active cell in the DOM', async () => {
    const harness = await mountGrid()

    await harness.clickCell(2, 'name')

    expect(harness.cell(2, 'name')?.classList.contains('dt-cell--active')).toBe(true)
    expect(harness.cell(2, 'name')?.getAttribute('aria-selected')).toBe('true')
    harness.unmount()
  })
})

/**
 * Un solo anillo: la marca de selección y el foco del DOM no compiten.
 *
 * ## Qué se rompió y qué protege este bloque
 *
 * Había DOS sistemas independientes dibujando el mismo anillo verde. Las celdas
 * del pool llevaban `tabindex="-1"`, así que un clic le daba foco REAL del DOM a
 * la celda apuntada; la hoja de estilos tenía además una regla
 * `.dt-cell:focus-visible` con el mismo color que `.dt-cell--active`. Al hacer
 * clic en una celda y mover después la selección con una flecha, el navegador
 * pasaba a considerar la interacción como de teclado y le pintaba el anillo de
 * foco a la celda VIEJA, que seguía enfocada, mientras `dt-cell--active` ya
 * estaba en la nueva. El usuario veía dos celdas seleccionadas a la vez.
 *
 * Ese `tabindex` era además código muerto: nadie enfocaba una celda por
 * programa, y el manejador de teclado se había mudado al viewport cuando se
 * implementó la selección. Lo único que seguía haciendo era que las teclas
 * funcionaran de rebote después de un clic —la celda enfocada las dejaba
 * burbujear hasta el viewport—, y eso ahora se pide explícitamente.
 *
 * ## Por qué estos tests CUENTAN en lugar de preguntar
 *
 * Preguntarle a la celda nueva si tiene la marca es exactamente lo que ya hacen
 * los tests de más arriba, y seguía siendo cierto con el bug: la celda nueva
 * tenía su clase, y la vieja tenía además el anillo del navegador. La única
 * aserción que puede fallar ante este bug es cuántos anillos hay en TODA la
 * grilla.
 */
describe('selection ring — exactly one cell is ever painted', () => {
  /** Celdas con la marca de activa en toda la grilla. */
  function activeCells(harness: TableHarness): HTMLElement[] {
    return [...harness.grid.querySelectorAll('.dt-cell--active')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
  }

  /** Celda del pool que tenga el foco del DOM, o `null`. */
  function focusedCell(): Element | null {
    const focused = document.activeElement
    if (focused === null) return null
    return focused.classList.contains('dt-cell') ? focused : null
  }

  it('mouse then keyboard leaves exactly one painted cell', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')
    expect(activeCells(harness)).toHaveLength(1)

    await harness.press('ArrowDown')

    const painted = activeCells(harness)
    expect(painted).toHaveLength(1)
    expect(painted[0]).toBe(harness.cell(3, 'name'))
    harness.unmount()
  })

  it('keyboard then mouse also leaves exactly one', async () => {
    const harness = await mountGrid()
    await harness.press('ArrowDown')
    await harness.press('ArrowDown')
    expect(activeCells(harness)).toHaveLength(1)

    // La transición inversa importa tanto como la otra: el bug era simétrico,
    // porque el foco se quedaba donde lo hubiera dejado el último clic.
    await harness.clickCell(5, 'city')

    const painted = activeCells(harness)
    expect(painted).toHaveLength(1)
    expect(painted[0]).toBe(harness.cell(5, 'city'))
    harness.unmount()
  })

  it('no pooled cell carries a tabindex attribute', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')
    await harness.press('ArrowDown')

    const cells = [...harness.canvas.querySelectorAll('.dt-cell')]
    expect(cells.length).toBeGreaterThan(0)
    // Es la causa raíz, y por eso se verifica el mecanismo y no solo el
    // síntoma: con `tabindex` la celda vuelve a ser enfocable y el navegador
    // vuelve a tener dónde dibujar un segundo anillo. Una celda es un
    // `gridcell` y nada más.
    for (const cell of cells) {
      expect(cell.hasAttribute('tabindex')).toBe(false)
    }
    harness.unmount()
  })

  it('never leaves a pooled cell as the focused element', async () => {
    const harness = await mountGrid()

    await harness.clickCell(2, 'name')
    expect(focusedCell()).toBeNull()

    await harness.press('ArrowDown')
    expect(focusedCell()).toBeNull()

    await harness.press('ArrowRight')
    expect(focusedCell()).toBeNull()

    // Y tampoco después de scrollear, que es cuando un nodo enfocado pasaría a
    // representar otra fila sin que el usuario moviera nada.
    await harness.scrollTo({ top: 20 * ROW_HEIGHT })
    expect(focusedCell()).toBeNull()
    harness.unmount()
  })

  it('clicking a cell moves the focus to the viewport, so the next arrow key lands', async () => {
    const harness = await mountGrid()

    await harness.clickCell(2, 'name')

    // El manejador de teclado vive en el viewport y solo ve las teclas si el
    // foco está ahí adentro. Antes esto pasaba de rebote por el `tabindex` de
    // la celda; sin él, hay que pedirlo.
    expect(document.activeElement).toBe(harness.viewport)

    await harness.press('ArrowDown')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'name' })
    harness.unmount()
  })

  it('does not steal the focus on click when selection is off', async () => {
    const harness = await mountGrid({ selectionMode: 'none' })
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    await harness.clickCell(2, 'name')

    // Sin selección la tabla no participa del teclado: quitarle el foco a lo
    // que el usuario estuviera usando sería peor que no hacer nada.
    expect(document.activeElement).toBe(outside)
    outside.remove()
    harness.unmount()
  })

  it('the editor takes the focus, and gives it back to the viewport on Escape', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')

    await harness.doubleClickCell(2, 'name')

    const control = harness.editor()
    if (!control) throw new Error('[test] no se abrió el editor')
    expect(document.activeElement).toBe(control)

    // Escape se manda al control y no al viewport: mientras hay una edición
    // abierta el manejador del viewport se aparta, así que la tecla es del
    // editor.
    control.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await harness.flush()

    expect(harness.editor()).toBeNull()
    // Cerrar suelta el foco a propósito, y soltarlo lo manda al `body`: desde
    // ahí el manejador del viewport no vería ni una tecla más y la flecha
    // siguiente a un Escape no haría nada.
    expect(document.activeElement).toBe(harness.viewport)

    await harness.press('ArrowDown')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'name' })
    harness.unmount()
  })
})

/**
 * El anillo de foco del viewport: opcional, apagado por defecto y suprimido
 * cuando ya hay una celda marcada.
 *
 * ## Qué se rompió y qué protege este bloque
 *
 * Sacarle el `tabindex` a las celdas obligó a enfocar el viewport de forma
 * explícita en cada clic, y eso volvió alcanzable una regla que hasta entonces no
 * se disparaba nunca: `.dt-viewport:focus-visible`. Antes el clic enfocaba la
 * celda y el viewport no recibía el foco, así que su anillo no existía en la
 * práctica; después, cada selección pasó a encerrar la tabla ENTERA en un borde
 * del color de acento mientras la celda activa llevaba el suyo. Dos señales para
 * una sola posición: el mismo error que se acababa de arreglar un nivel más
 * abajo.
 *
 * ## Por qué estos tests miran atributos y no estilo calculado
 *
 * El entorno de test no resuelve la cascada ni `:focus-visible`, que además
 * depende de una heurística del navegador sobre la modalidad de entrada. Lo que
 * sí se puede verificar —y lo que es el contrato real— es el ESTADO desde el que
 * la hoja de estilos decide: las dos condiciones que la regla exige sobre
 * `.dt-root`. Por eso los tests preguntan por el selector completo y no por cada
 * atributo suelto: encender uno y olvidar el otro pasaría una aserción por
 * atributo y fallaría acá, que es donde importa.
 */
describe('focus ring — opt-in, and never a second ring', () => {
  /**
   * Estado exacto desde el que la hoja de estilos dibuja el anillo del viewport.
   *
   * Es el prefijo literal de la regla en `styles/datatable.css`. Se duplica a
   * propósito: si alguien cambia la condición, este test tiene que enterarse.
   */
  const RING_STATE = "[data-focus-ring='true'][data-active-cell='false']"

  /** `true` si `.dt-root` está en el estado que produce el anillo. */
  function paintsRing(harness: TableHarness): boolean {
    return harness.grid.matches(RING_STATE)
  }

  it('does not paint a ring by default', async () => {
    const harness = await mountGrid()

    // El valor por defecto es el que pidió el usuario: sin anillo alrededor de
    // la tabla, nunca.
    expect(harness.grid.getAttribute('data-focus-ring')).toBe('false')
    expect(paintsRing(harness)).toBe(false)
    harness.unmount()
  })

  it('keeps the ring off by default even after selecting a cell', async () => {
    const harness = await mountGrid()

    await harness.clickCell(2, 'name')

    // Este es el síntoma que reportó el usuario: seleccionar pintaba de verde
    // toda la tabla, además de la celda.
    expect(paintsRing(harness)).toBe(false)
    harness.unmount()
  })

  it('exposes the ring state when focusRing is on and nothing is selected', async () => {
    const harness = await mountGrid({ focusRing: true })

    expect(harness.grid.getAttribute('data-focus-ring')).toBe('true')
    expect(harness.grid.getAttribute('data-active-cell')).toBe('false')
    expect(paintsRing(harness)).toBe(true)
    harness.unmount()
  })

  it('suppresses the ring as soon as a cell is active, even with focusRing on', async () => {
    const harness = await mountGrid({ focusRing: true })
    expect(paintsRing(harness)).toBe(true)

    await harness.clickCell(2, 'name')

    // La celda marcada ya dice dónde está parado el usuario. Encerrar además la
    // tabla entera sería exactamente el bug que se arregló un nivel más abajo,
    // reintroducido un nivel más arriba.
    expect(harness.grid.getAttribute('data-active-cell')).toBe('true')
    expect(paintsRing(harness)).toBe(false)
    harness.unmount()
  })

  it('keeps the ring suppressed while the selection moves with the keyboard', async () => {
    const harness = await mountGrid({ focusRing: true })
    await harness.clickCell(2, 'name')

    await harness.press('ArrowDown')
    await harness.press('ArrowRight')

    // Mover la selección no cambia si HAY selección: el atributo se queda quieto
    // y el anillo sigue apagado.
    expect(harness.grid.getAttribute('data-active-cell')).toBe('true')
    expect(paintsRing(harness)).toBe(false)
    harness.unmount()
  })

  it('flips when the prop is toggled at runtime', async () => {
    const harness = await mountGrid()
    expect(paintsRing(harness)).toBe(false)

    await harness.wrapper.setProps({ focusRing: true })
    await harness.flush()
    expect(harness.grid.getAttribute('data-focus-ring')).toBe('true')
    expect(paintsRing(harness)).toBe(true)

    await harness.wrapper.setProps({ focusRing: false })
    await harness.flush()
    expect(harness.grid.getAttribute('data-focus-ring')).toBe('false')
    expect(paintsRing(harness)).toBe(false)
    harness.unmount()
  })

  it('comes back when the selection is cleared', async () => {
    const harness = await mountGrid({ focusRing: true, activeCell: null })
    expect(paintsRing(harness)).toBe(true)

    await harness.wrapper.setProps({ activeCell: { rowIndex: 2, columnKey: 'name' } })
    await harness.flush()
    expect(paintsRing(harness)).toBe(false)

    // Vaciar la selección devuelve al usuario de teclado su única referencia: sin
    // celda marcada y sin anillo no quedaría ninguna señal de dónde está el foco.
    await harness.wrapper.setProps({ activeCell: null })
    await harness.flush()
    expect(paintsRing(harness)).toBe(true)
    harness.unmount()
  })

  it('still moves the focus to the viewport on click, in BOTH modes', async () => {
    // El anillo es cosmético; el foco es funcional. Apagar el dibujo no puede
    // apagar el mecanismo, porque el manejador de teclado vive en el viewport y
    // solo ve las teclas mientras el foco esté ahí adentro.
    for (const focusRing of [false, true]) {
      const harness = await mountGrid({ focusRing })

      await harness.clickCell(2, 'name')
      expect(document.activeElement).toBe(harness.viewport)

      await harness.press('ArrowDown')
      expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'name' })

      harness.unmount()
    }
  })

  it('takes focus without scrolling the page to the table', async () => {
    // Enfocar un elemento lo desplaza a la vista por defecto. Como el viewport
    // puede ser más alto que la ventana, sin `preventScroll` un clic en una
    // celda movería el scroll de la página para encuadrar la tabla, debajo del
    // puntero del usuario. El foco se toma para habilitar el teclado, nada más.
    const harness = await mountGrid({})
    const focus = vi.spyOn(harness.viewport, 'focus')

    await harness.clickCell(2, 'name')

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })

    focus.mockRestore()
    harness.unmount()
  })

  it('does not add a second ring: the active cell keeps carrying exactly one', async () => {
    const harness = await mountGrid({ focusRing: true })
    await harness.clickCell(2, 'name')

    await harness.press('ArrowDown')

    const painted = [...harness.grid.querySelectorAll('.dt-cell--active')]
    expect(painted).toHaveLength(1)
    expect(painted[0]).toBe(harness.cell(3, 'name'))
    harness.unmount()
  })
})

describe('keyboard — arrows clamp at the edges instead of wrapping', () => {
  it('ArrowDown moves one row down', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')

    await harness.press('ArrowDown')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 1, columnKey: 'name' })
    harness.unmount()
  })

  it('ArrowUp stops at the first row and does not wrap to the last', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')
    const before = activeCellEmissions(harness.wrapper)

    await harness.press('ArrowUp')

    // Envolver al final de una tabla de 100.000 filas dejaría al usuario
    // perdido sin ninguna señal de lo que pasó.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'name' })
    expect(activeCellEmissions(harness.wrapper)).toBe(before)
    harness.unmount()
  })

  it('ArrowDown stops at the last row', async () => {
    const harness = await mountGrid({}, 12)
    await harness.clickCell(11, 'name')

    await harness.press('ArrowDown')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 11, columnKey: 'name' })
    harness.unmount()
  })

  it('ArrowLeft stops at the first column', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'id')

    await harness.press('ArrowLeft')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'id' })
    harness.unmount()
  })

  it('ArrowRight stops at the last column', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'id')
    for (let step = 0; step < 10; step += 1) await harness.press('ArrowRight')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'extra' })
    harness.unmount()
  })

  it('ArrowDown with nothing selected lands on row 0, it does not skip it', async () => {
    const harness = await mountGrid()

    await harness.press('ArrowDown')

    // Sin celda activa no hay "donde está" al que aplicarle un desplazamiento,
    // así que la primera tecla SIEMBRA la posición en lugar de moverse desde un
    // origen inventado. Antes se sembraba en (0, primera columna) y recién
    // después se aplicaba el delta, con lo cual la primera flecha hacia abajo
    // aterrizaba en la fila 1 y la fila 0 no había forma de alcanzarla con el
    // teclado sin pasar antes por otra.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'id' })
    harness.unmount()
  })

  it('ArrowRight with nothing selected lands on the first visible column', async () => {
    const harness = await mountGrid({ columnVisibility: { id: false } })

    await harness.press('ArrowRight')

    // La primera columna VISIBLE, no la primera declarada: una columna oculta no
    // ocupa lugar en la navegación.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'name' })
    harness.unmount()
  })

  it('ArrowUp with nothing selected enters from the bottom', async () => {
    const harness = await mountGrid({}, 100)

    await harness.press('ArrowUp')

    // La selección entra a la grilla por el borde OPUESTO al sentido del
    // movimiento, que es de donde viene: bajando se entra por arriba, subiendo
    // se entra por abajo. Antes esta tecla aterrizaba en (0, primera columna),
    // pero solo porque el acotado tapaba un índice negativo, no porque alguien
    // lo hubiera decidido.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 99, columnKey: 'id' })
    harness.unmount()
  })

  it('ArrowLeft with nothing selected enters from the right', async () => {
    const harness = await mountGrid()

    await harness.press('ArrowLeft')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'extra' })
    harness.unmount()
  })

  it('announces the seeded cell exactly once, not twice', async () => {
    const harness = await mountGrid()

    await harness.press('ArrowDown')

    // Sembrar no puede degenerar en "seleccionar el origen y después moverse":
    // eso emitiría dos veces y un padre controlado vería un parpadeo de
    // selección en una celda que el usuario nunca eligió.
    expect(activeCellEmissions(harness.wrapper)).toBe(1)
    harness.unmount()
  })
})

describe('keyboard — Tab wraps across rows, arrows do not', () => {
  it('Tab past the last column moves to the first column of the next row', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'extra')

    await harness.press('Tab')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'id' })
    harness.unmount()
  })

  it('Shift+Tab before the first column moves to the last column of the previous row', async () => {
    const harness = await mountGrid()
    await harness.clickCell(3, 'id')

    await harness.press('Tab', { shiftKey: true })

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'extra' })
    harness.unmount()
  })

  it('Tab stops at the very last cell of the table', async () => {
    const harness = await mountGrid({}, 4)
    await harness.clickCell(3, 'extra')
    const before = activeCellEmissions(harness.wrapper)

    await harness.press('Tab')

    expect(activeCellEmissions(harness.wrapper)).toBe(before)
    harness.unmount()
  })

  it('Shift+Tab stops at the very first cell of the table', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'id')
    const before = activeCellEmissions(harness.wrapper)

    await harness.press('Tab', { shiftKey: true })

    expect(activeCellEmissions(harness.wrapper)).toBe(before)
    harness.unmount()
  })
})

describe('keyboard — Home, End and paging', () => {
  it('Home moves to the first column of the current row', async () => {
    const harness = await mountGrid()
    await harness.clickCell(5, 'city')

    await harness.press('Home')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 5, columnKey: 'id' })
    harness.unmount()
  })

  it('End moves to the last column of the current row', async () => {
    const harness = await mountGrid()
    await harness.clickCell(5, 'id')

    await harness.press('End')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 5, columnKey: 'extra' })
    harness.unmount()
  })

  it('Ctrl+Home jumps to the very first cell', async () => {
    const harness = await mountGrid()
    await selectFarCell(harness, 50, 'city')

    await harness.press('Home', { ctrlKey: true })

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'id' })
    harness.unmount()
  })

  it('Ctrl+End jumps to the very last cell', async () => {
    const harness = await mountGrid({}, 30)
    await harness.clickCell(0, 'id')

    await harness.press('End', { ctrlKey: true })

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 29, columnKey: 'extra' })
    harness.unmount()
  })

  it('Cmd+Home behaves like Ctrl+Home, for macOS', async () => {
    const harness = await mountGrid()
    await selectFarCell(harness, 50, 'city')

    await harness.press('Home', { metaKey: true })

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'id' })
    harness.unmount()
  })

  it('PageDown moves down exactly one screenful of rows', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')

    await harness.press('PageDown')

    // El viewport mide 400px y la fila 40px: una página son 10 filas.
    expect(lastActiveCell(harness.wrapper)).toEqual({
      rowIndex: VISIBLE_ROWS,
      columnKey: 'name',
    })
    harness.unmount()
  })

  it('PageUp moves up exactly one screenful of rows', async () => {
    const harness = await mountGrid()
    await selectFarCell(harness, 25, 'name')

    await harness.press('PageUp')

    expect(lastActiveCell(harness.wrapper)).toEqual({
      rowIndex: 25 - VISIBLE_ROWS,
      columnKey: 'name',
    })
    harness.unmount()
  })

  it('PageUp clamps at the top instead of going negative', async () => {
    const harness = await mountGrid()
    await harness.clickCell(3, 'name')

    await harness.press('PageUp')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'name' })
    harness.unmount()
  })

  it('Home with nothing selected still means the FIRST column', async () => {
    const harness = await mountGrid()

    await harness.press('Home')

    // `Home` es un salto absoluto, no un movimiento con sentido. Expresarlo como
    // un delta negativo enorme lo volvía indistinguible de "hacia la izquierda",
    // y con la siembra por sentido habría entrado por el borde derecho: el
    // opuesto exacto de lo que significa la tecla.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'id' })
    harness.unmount()
  })

  it('End with nothing selected means the last column of the first row', async () => {
    const harness = await mountGrid()

    await harness.press('End')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'extra' })
    harness.unmount()
  })

  it('paging with nothing selected seeds by direction, like the arrows', async () => {
    const down = await mountGrid({}, 100)
    await down.press('PageDown')
    // Misma regla que ArrowDown: la primera tecla siembra en la primera fila en
    // lugar de aplicarle una página a un origen inventado. Antes aterrizaba en
    // la fila 10.
    expect(lastActiveCell(down.wrapper)).toEqual({ rowIndex: 0, columnKey: 'id' })
    down.unmount()

    const up = await mountGrid({}, 100)
    await up.press('PageUp')
    expect(lastActiveCell(up.wrapper)).toEqual({ rowIndex: 99, columnKey: 'id' })
    up.unmount()
  })
})

describe('keyboard — auto-scroll moves the minimum necessary', () => {
  it('does not scroll while the target row is already visible', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')

    for (let step = 0; step < VISIBLE_ROWS - 1; step += 1) await harness.press('ArrowDown')

    expect(harness.scrollPosition().top).toBe(0)
    harness.unmount()
  })

  it('scrolls by exactly one row when stepping past the bottom edge', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')

    for (let step = 0; step < VISIBLE_ROWS; step += 1) await harness.press('ArrowDown')

    // Fila 10: su borde inferior está en 11 * 40 = 440, el viewport mide 400,
    // así que el desplazamiento mínimo es 40. Un salto mayor perdería el
    // contexto visual del usuario.
    expect(harness.scrollPosition().top).toBe(ROW_HEIGHT)
    harness.unmount()
  })

  it('keeps scrolling one row at a time, never jumping ahead', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')

    for (let step = 0; step < VISIBLE_ROWS + 3; step += 1) await harness.press('ArrowDown')

    expect(harness.scrollPosition().top).toBe(4 * ROW_HEIGHT)
    harness.unmount()
  })

  it('scrolls horizontally by exactly the width of the column that went off-screen', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'id')

    // Cinco columnas de 120px entran en 600px. La sexta (`extra`) termina en
    // 720, así que hay que correr 120.
    for (let step = 0; step < 5; step += 1) await harness.press('ArrowRight')

    expect(harness.scrollPosition().left).toBe(COLUMN_WIDTH)
    harness.unmount()
  })

  it('scrolls back up when moving above the visible window', async () => {
    const harness = await mountGrid()
    await harness.clickCell(0, 'name')
    for (let step = 0; step < VISIBLE_ROWS + 3; step += 1) await harness.press('ArrowDown')
    expect(harness.scrollPosition().top).toBe(4 * ROW_HEIGHT)

    await harness.press('Home', { ctrlKey: true })

    expect(harness.scrollPosition().top).toBe(0)
    expect(harness.scrollPosition().left).toBe(0)
    harness.unmount()
  })
})

describe('keyboard — editing', () => {
  it('Enter opens the editor on the active cell', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')

    await harness.press('Enter')

    expect(harness.editor()).not.toBeNull()
    harness.unmount()
  })

  it('F2 opens the editor too', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')

    await harness.press('F2')

    expect(harness.editor()).not.toBeNull()
    harness.unmount()
  })

  it('Enter inside the editor commits and moves the selection down', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')
    await harness.press('Enter')

    const control = harness.editor()
    if (!control) throw new Error('[test] no se abrió el editor')
    control.value = 'Edited'
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await harness.flush()

    const committed = harness.wrapper.emitted('editCommit')
    expect(committed).toHaveLength(1)
    expect(committed?.[0]?.[0]).toMatchObject({
      rowIndex: 2,
      columnKey: 'name',
      newValue: 'Edited',
    })
    // Como en una planilla de cálculo: confirmar baja una fila.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'name' })
    harness.unmount()
  })

  it('typing a printable character opens the editor seeded with it', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')

    await harness.press('x')

    // La tecla que abrió la edición tiene que ser el primer carácter del valor
    // nuevo, no perderse.
    expect(harness.editor()?.value).toBe('x')
    harness.unmount()
  })

  it('type-to-edit respects the beforeEdit veto', async () => {
    const harness = await mountGrid({
      onBeforeEdit: (event: BeforeEditEvent<GridRow>) => event.cancel(),
    })
    await harness.clickCell(2, 'name')

    await harness.press('x')

    expect(harness.editor()).toBeNull()
    harness.unmount()
  })

  it('does not hijack a Ctrl-modified key', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')

    await harness.press('a', { ctrlKey: true })

    // Ctrl+A es "seleccionar todo" del navegador; capturarlo para empezar a
    // editar sería secuestrar un atajo del sistema.
    expect(harness.editor()).toBeNull()
    harness.unmount()
  })

  it('does not hijack an Alt-modified key', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')

    await harness.press('a', { altKey: true })

    expect(harness.editor()).toBeNull()
    harness.unmount()
  })

  it('does let Shift through, because Shift is how capitals are typed', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')

    await harness.press('A', { shiftKey: true })

    expect(harness.editor()?.value).toBe('A')
    harness.unmount()
  })

  it('ignores a named key that is not a navigation key', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')

    await harness.press('ContextMenu')

    expect(harness.editor()).toBeNull()
    harness.unmount()
  })

  it('does nothing on type-to-edit when there is no active cell', async () => {
    const harness = await mountGrid()

    await harness.press('x')

    expect(harness.editor()).toBeNull()
    expect(activeCellEmissions(harness.wrapper)).toBe(0)
    harness.unmount()
  })

  it('Escape keeps the selection instead of clearing it', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')
    const before = activeCellEmissions(harness.wrapper)

    await harness.press('Escape')

    // Escape cancela una edición; sin edición abierta no tiene por qué
    // deseleccionar, que sería perder el lugar en la tabla.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'name' })
    expect(activeCellEmissions(harness.wrapper)).toBe(before)
    harness.unmount()
  })

  it('ignores navigation keys while the editor is open', async () => {
    const harness = await mountGrid()
    await harness.clickCell(2, 'name')
    await harness.press('Enter')
    const before = activeCellEmissions(harness.wrapper)

    await harness.press('ArrowDown')

    // El manejador del viewport se aparta mientras hay un editor: las flechas
    // pertenecen al control de edición.
    expect(activeCellEmissions(harness.wrapper)).toBe(before)
    harness.unmount()
  })
})

describe('keyboard — hidden columns are skipped', () => {
  it('ArrowRight jumps over a hidden column', async () => {
    const harness = await mountGrid({ columnVisibility: { name: false } })
    await harness.clickCell(2, 'id')

    await harness.press('ArrowRight')

    // `name` está oculta: no ocupa un lugar en la navegación, igual que no
    // ocupa un slot del pool.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'amount' })
    harness.unmount()
  })

  it('End lands on the last VISIBLE column', async () => {
    const harness = await mountGrid({ columnVisibility: { extra: false } })
    await harness.clickCell(2, 'id')

    await harness.press('End')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 2, columnKey: 'done' })
    harness.unmount()
  })

  it('Tab wraps using the visible columns only', async () => {
    const harness = await mountGrid({ columnVisibility: { extra: false } })
    await harness.clickCell(2, 'done')

    await harness.press('Tab')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'id' })
    harness.unmount()
  })
})

describe('selectionMode', () => {
  it('attaches no keyboard handler when selection is off', async () => {
    const harness = await mountGrid({ selectionMode: 'none' })

    await harness.press('ArrowDown')

    // No es que el manejador ignore la tecla: Vue directamente no registra el
    // listener, así que la tabla no interfiere con el scroll nativo.
    expect(activeCellEmissions(harness.wrapper)).toBe(0)
    harness.unmount()
  })

  it('does not select on click when selection is off', async () => {
    const harness = await mountGrid({ selectionMode: 'none' })

    await harness.clickCell(2, 'name')

    expect(activeCellEmissions(harness.wrapper)).toBe(0)
    harness.unmount()
  })

  it('keeps the viewport out of the tab order when selection is off', async () => {
    const harness = await mountGrid({ selectionMode: 'none' })

    expect(harness.viewport.getAttribute('tabindex')).toBe('-1')
    harness.unmount()
  })

  it('makes the viewport focusable when selection is on', async () => {
    const harness = await mountGrid()

    expect(harness.viewport.getAttribute('tabindex')).toBe('0')
    harness.unmount()
  })

  it('marks the row instead of the cell in row mode', async () => {
    const harness = await mountGrid({ selectionMode: 'row' })

    await harness.clickCell(2, 'name')

    const cell = harness.cell(2, 'name')
    const row = cell?.closest('.dt-row')
    expect(row?.classList.contains('dt-row--active')).toBe(true)
    // En modo `row` la unidad seleccionada es la fila y lo anuncia ella: marcar
    // además la celda duplicaría el anuncio del lector de pantalla.
    expect(row?.getAttribute('aria-selected')).toBe('true')
    expect(cell?.classList.contains('dt-cell--active')).toBe(false)
    harness.unmount()
  })

  it('still tracks the active column in row mode, so the keyboard knows where it is', async () => {
    const harness = await mountGrid({ selectionMode: 'row' })
    await harness.clickCell(2, 'amount')

    await harness.press('ArrowDown')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'amount' })
    harness.unmount()
  })
})

/**
 * Estructura accesible de la grilla.
 *
 * ## Qué se rompió antes y qué protege este bloque
 *
 * El rol de grilla vivía en `.dt-viewport`, el contenedor que scrollea, y el
 * header se dibuja ARRIBA de él. La fila de encabezado quedaba entonces fuera de
 * la grilla, pero la aritmética de índices la contaba igual: `aria-rowcount` era
 * entradas + 1 y `aria-rowindex` era posición + 2. O sea que la tecnología
 * asistiva recibía una grilla con una fila 1 que no podía encontrar, y la primera
 * fila de datos se anunciaba como "fila 2" sin que existiera una fila 1.
 *
 * Como efecto colateral, los nombres de las columnas no se asociaban con ninguna
 * celda: sin `columnheader` dentro de la misma grilla no hay de dónde sacar la
 * asociación, y el usuario escuchaba valores pelados.
 *
 * El rol está ahora en `.dt-root`, que es el único nodo que contiene a la vez el
 * header y el cuerpo. Los dos números que ya se escribían pasan a ser CIERTOS, y
 * ninguno de los dos cambió de valor: lo que cambió es que ahora describen algo
 * que existe.
 */
describe('grid accessibility structure', () => {
  /** Nodos de fila del cuerpo que están efectivamente pintados. */
  function paintedRows(harness: TableHarness): HTMLElement[] {
    return [...harness.canvas.querySelectorAll('.dt-row')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && !node.hidden,
    )
  }

  it('puts the grid role on the element that CONTAINS the header', async () => {
    const harness = await mountGrid()

    const headerRow = harness.grid.querySelector('.dt-header-row')
    expect(headerRow).not.toBeNull()
    expect(harness.grid.getAttribute('role')).toBe('grid')
    // Lo que estaba mal no era el rol sino dónde estaba: la fila de encabezado
    // tiene que caer DENTRO del elemento que dice ser la grilla.
    expect(headerRow && harness.grid.contains(headerRow)).toBe(true)
    // Y el cuerpo sigue adentro de la misma grilla, claro.
    expect(harness.grid.contains(harness.canvas)).toBe(true)
    harness.unmount()
  })

  it('leaves the scrolling viewport without a role of its own', async () => {
    const harness = await mountGrid()

    // El viewport scrollea y recibe el teclado, pero ya no es la grilla. Dejarle
    // el rol encima duplicaría la grilla y volvería a dejar el header afuera.
    expect(harness.viewport.hasAttribute('role')).toBe(false)
    expect(harness.viewport.hasAttribute('aria-rowcount')).toBe(false)
    expect(harness.viewport.hasAttribute('aria-colcount')).toBe(false)
    harness.unmount()
  })

  it('declares a rowgroup / row / columnheader structure over the header', async () => {
    const harness = await mountGrid()

    expect(harness.grid.querySelector('.dt-header')?.getAttribute('role')).toBe('rowgroup')
    expect(harness.grid.querySelector('.dt-header-row')?.getAttribute('role')).toBe('row')

    const headerCells = [...harness.grid.querySelectorAll('.dt-header-cell')]
    expect(headerCells).toHaveLength(COLUMN_KEYS.length)
    for (const cell of headerCells) {
      expect(cell.getAttribute('role')).toBe('columnheader')
    }
    harness.unmount()
  })

  it('keeps the strips inside the header row transparent to ARIA', async () => {
    const harness = await mountGrid()

    // Entre la fila y sus `columnheader` hay cajas de posicionamiento —la que
    // scrollea y las de las columnas ancladas—. Tienen que ser `role="none"`
    // para que los encabezados sigan perteneciendo a la FILA: con un rol propio
    // en el medio, la grilla dejaría de tener columnas donde el lector las busca.
    const strips = [...harness.grid.querySelectorAll('.dt-header-row > *')]
    expect(strips.length).toBeGreaterThan(0)
    for (const strip of strips) {
      expect(strip.getAttribute('role')).toBe('none')
    }
    harness.unmount()
  })

  it('declares a rowgroup over the body, with rows and gridcells inside', async () => {
    const harness = await mountGrid()

    // El rowgroup va en el canvas y no en el viewport: el canvas contiene
    // exactamente las filas, mientras que el viewport contiene además el host
    // del editor, que no es una fila de nada.
    expect(harness.canvas.getAttribute('role')).toBe('rowgroup')

    const row = paintedRows(harness)[0]
    expect(row?.getAttribute('role')).toBe('row')
    expect(row?.querySelector('.dt-cell')?.getAttribute('role')).toBe('gridcell')
    harness.unmount()
  })

  it('gives the header row aria-rowindex 1, which is what makes the rest true', async () => {
    const harness = await mountGrid()

    expect(harness.grid.querySelector('.dt-header-row')?.getAttribute('aria-rowindex')).toBe('1')
    harness.unmount()
  })

  it('makes the first data row announce itself as row 2, with a row 1 that exists', async () => {
    const harness = await mountGrid()

    const first = harness.canvas.querySelector('.dt-row[data-row-key="0"]')
    expect(first?.getAttribute('aria-rowindex')).toBe('2')
    harness.unmount()
  })

  it('announces the row count including the header row', async () => {
    const harness = await mountGrid({}, 25)

    expect(harness.grid.getAttribute('aria-rowcount')).toBe('26')
    harness.unmount()
  })

  it('announces a row count that matches what the grid actually contains', async () => {
    const harness = await mountGrid({}, 25)
    await harness.scrollTo({ top: (25 - VISIBLE_ROWS) * ROW_HEIGHT })

    // La última fila del dataset tiene que anunciar exactamente `aria-rowcount`:
    // ni uno más —que sería una fila fuera de la grilla— ni uno menos, que
    // dejaría la última fila sin anunciar.
    const indexes = paintedRows(harness).map((node) =>
      Number(node.getAttribute('aria-rowindex') ?? '0'),
    )
    expect(Math.max(...indexes)).toBe(26)
    expect(harness.grid.getAttribute('aria-rowcount')).toBe('26')
    harness.unmount()
  })

  it('announces the visible column count', async () => {
    const harness = await mountGrid({ columnVisibility: { extra: false } })

    expect(harness.grid.getAttribute('aria-colcount')).toBe(String(COLUMN_KEYS.length - 1))
    harness.unmount()
  })

  it('lines up aria-colindex between header and body, with hidden and reordered columns', async () => {
    const harness = await mountTable({
      viewport: VIEWPORT,
      props: {
        rows: [{ id: 0, a: 'A', b: 'B', c: 'C', d: 'D' }],
        columns: [
          { key: 'a', width: COLUMN_WIDTH },
          { key: 'b', width: COLUMN_WIDTH },
          { key: 'c', width: COLUMN_WIDTH },
          { key: 'd', width: COLUMN_WIDTH },
        ],
        rowKey: 'id',
        rowHeight: ROW_HEIGHT,
        columnVisibility: { b: false },
        columnOrder: ['d', 'c', 'a', 'b'],
      },
    })

    // Los índices son 1..N sobre las columnas VISIBLES y en el orden vigente:
    // una columna oculta no ocupa lugar en la grilla accesible, así que no deja
    // un hueco en la numeración.
    const header = [...harness.grid.querySelectorAll('.dt-header-cell')].map((node) => ({
      label: node.querySelector('.dt-header-label')?.textContent,
      colindex: node.getAttribute('aria-colindex'),
    }))
    expect(header).toEqual([
      { label: 'd', colindex: '1' },
      { label: 'c', colindex: '2' },
      { label: 'a', colindex: '3' },
    ])

    // El cuerpo tiene que anunciar el MISMO índice para la misma columna. Las
    // celdas se identifican por su valor, que es distinto en cada columna, y no
    // por su `aria-colindex`: resolverlas con la convención que se está
    // verificando haría que el test no pudiera fallar.
    const body = [...harness.canvas.querySelectorAll('.dt-cell')]
      .filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hidden)
      .map((node) => ({ text: node.textContent, colindex: node.getAttribute('aria-colindex') }))
      .sort((left, right) => Number(left.colindex) - Number(right.colindex))
    expect(body).toEqual([
      { text: 'D', colindex: '1' },
      { text: 'C', colindex: '2' },
      { text: 'A', colindex: '3' },
    ])

    harness.unmount()
  })

  it('keeps the keyboard and the tab stop on the viewport after the role moved', async () => {
    const harness = await mountGrid()

    expect(harness.viewport.getAttribute('tabindex')).toBe('0')

    // El manejador sigue viviendo en el viewport, que es la caja que scrollea:
    // mover el rol no movió ni el foco ni el teclado.
    await harness.press('ArrowDown')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 0, columnKey: 'id' })
    harness.unmount()
  })
})
