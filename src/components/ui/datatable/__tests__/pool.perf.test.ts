/**
 * Tests de regresión de rendimiento del pool de nodos.
 *
 * ## Leer esto antes de tocar un número
 *
 * Las constantes de este archivo no son arbitrarias: cada una está derivada del
 * contrato de `internal/dom.ts` y explicada en el comentario que la acompaña. Si
 * una de estas aserciones falla, lo más probable es que la regresión esté en el
 * componente y no en el número.
 *
 * El motivo es el modo de falla que protegen. Romper el caché de pintado no
 * lanza ninguna excepción: la tabla sigue renderizando, se sigue viendo bien, y
 * solo scrollea peor. No hay ningún otro test —de este repositorio o de
 * cualquier otro— que note esa diferencia. Subir un número hasta que el test
 * vuelva a verde apaga exactamente la alarma que hace falta escuchar.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countMatching, measureDomWrites } from './dom-recorder'
import {
  createPoolFixture,
  DEMO_OPTIONS,
  FIXTURE_ROW_HEIGHT,
  makeRows,
  resolveColumns,
} from './harness'
import type { DemoRow } from './harness'
import type { AnyCellRenderer } from '../internal/renderers'
import {
  avatarRenderer,
  badgeRenderer,
  progressRenderer,
  textRenderer,
} from '../internal/renderers'
import type { CellRenderer, DataTableColumn } from '../types'

/**
 * Columnas de ejemplo para cada uno de los ocho renderers incluidos.
 *
 * Cada una apunta a la propiedad de {@link DemoRow} cuya forma corresponde al
 * renderer: `tags` recibe un array, `avatar` un objeto `{ name }`, `checkbox` un
 * booleano. Es la única manera de que el test ejercite el camino real de cada
 * renderer y no su rama de fallback.
 */
const RENDERER_COLUMNS: readonly DataTableColumn<DemoRow>[] = [
  { key: 'name', renderer: 'text' },
  { key: 'amount', renderer: 'number' },
  { key: 'status', renderer: 'badge', options: DEMO_OPTIONS },
  { key: 'choice', renderer: 'select', options: DEMO_OPTIONS },
  { key: 'progress', renderer: 'progress' },
  { key: 'owner', renderer: 'avatar' },
  { key: 'done', renderer: 'checkbox', editable: true },
  { key: 'tags', renderer: 'tags', options: DEMO_OPTIONS },
]

describe('paint cache — repainting with identical inputs writes nothing', () => {
  for (const column of RENDERER_COLUMNS) {
    it(`renderer "${String(column.renderer)}": a redundant repaint performs zero DOM writes`, () => {
      const fixture = createPoolFixture({ columns: [column], visibleRows: 12 })

      // Dos pintados previos: el primero construye los nodos, el segundo deja el
      // caché de cada renderer ya sincronizado. Recién el tercero es el que
      // puede —y debe— no escribir absolutamente nada.
      fixture.paint()
      fixture.paint()

      const measured = measureDomWrites(fixture.container, () => fixture.paint())

      expect(measured.counts.total, measured.report).toBe(0)
      fixture.destroy()
    })
  }

  it('an unrelated prop change (stripe off -> off) still writes nothing', () => {
    const fixture = createPoolFixture({ columns: [...RENDERER_COLUMNS], visibleRows: 12 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ stripe: false }))

    expect(measured.counts.total, measured.report).toBe(0)
    fixture.destroy()
  })
})

describe('node recycling — scrolling reuses nodes instead of replacing them', () => {
  it('every row and cell element survives a scroll as the same object', () => {
    const fixture = createPoolFixture({
      columns: [{ key: 'name' }, { key: 'amount' }],
      visibleRows: 10,
    })
    fixture.paint()

    const rowsBefore = fixture.rowNodes()
    const cellsBefore = rowsBefore.map((_, slot) => fixture.cellNodes(slot))

    fixture.paint({ start: 37 })

    const rowsAfter = fixture.rowNodes()
    expect(rowsAfter).toHaveLength(rowsBefore.length)
    for (let slot = 0; slot < rowsBefore.length; slot += 1) {
      // Identidad, no igualdad estructural: `toBe` sobre elementos compara
      // referencias, que es justamente lo que distingue reciclar de recrear.
      expect(rowsAfter[slot]).toBe(rowsBefore[slot])
      const cellsAfter = fixture.cellNodes(slot)
      expect(cellsAfter).toHaveLength(cellsBefore[slot]?.length ?? 0)
      for (let index = 0; index < cellsAfter.length; index += 1) {
        expect(cellsAfter[index]).toBe(cellsBefore[slot]?.[index])
      }
    }

    fixture.destroy()
  })

  it('scrolling creates no elements and removes none', () => {
    const fixture = createPoolFixture({
      columns: [{ key: 'name' }, { key: 'amount' }],
      visibleRows: 10,
    })
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => {
      for (let step = 1; step <= 20; step += 1) fixture.paint({ start: step })
    })

    expect(measured.counts.createNode, measured.report).toBe(0)
    expect(measured.counts.removeNode, measured.report).toBe(0)
    expect(measured.counts.insertNode, measured.report).toBe(0)
    fixture.destroy()
  })
})

/**
 * Presupuesto exacto de un frame de scroll vertical.
 *
 * ## El invariante que protege este bloque
 *
 * El pool ROTA: la fila `i` se pinta en el slot `i % poolSize`, así que una fila
 * que sigue visible después de un scroll conserva su nodo Y su índice, y el
 * caché de `internal/dom.ts` la deja pasar sin escribir nada. En consecuencia:
 *
 * **el costo de un frame es proporcional a la cantidad de filas que ENTRARON a
 * la ventana, no al tamaño de la ventana.**
 *
 * El tamaño de la ventana sigue existiendo como COTA SUPERIOR: un salto largo no
 * puede costar más que repintarla entera, porque no hay más nodos que repintar.
 * Esa cota es lo que mantiene acotado el peor caso; lo que cambió es que el caso
 * COMÚN —el scroll de una rueda, una tecla de flecha, un arrastre— ya no lo paga.
 *
 * Una fila que entra cuesta, con tres columnas de texto:
 *
 * - 1 `style.transform`: se reposiciona dentro del canvas. Es inevitable, las
 *   filas están en coordenadas absolutas del contenido.
 * - 2 atributos: `data-row-key` y `aria-rowindex`, la identidad de la fila. Van
 *   en la FILA y no en cada celda (ver el bloque de ARIA más abajo).
 * - 3 `textContent`: una por celda, porque las tres columnas tienen valores
 *   distintos en cada fila.
 *
 * Total: 6 por fila entrante. Las otras nueve filas de la ventana atraviesan el
 * pintado sin tocar el DOM ni una vez.
 *
 * Si estos números fallan hacia arriba, lo más probable es que alguien haya roto
 * la rotación —volviendo al mapeo `rowRange.start + slot`— y el costo haya vuelto
 * a ser proporcional a la ventana. Si fallan hacia abajo puede ser una mejora
 * real: verificá que el contenido siga siendo correcto antes de bajar la
 * constante.
 */
const ENTERING_ROW_WRITES = 6

/** Cota superior de un frame: repintar las diez filas de la ventana. */
const FULL_WINDOW_WRITES = ENTERING_ROW_WRITES * 10

describe('scroll cost — writes per frame track the rows that entered, not the window', () => {
  const columns: readonly DataTableColumn<DemoRow>[] = [
    { key: 'name' },
    { key: 'id' },
    { key: 'amount' },
  ]

  it('one scroll step over a 10x3 window writes only the entering row: exactly 6', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 10 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 1 }))

    expect(measured.counts.total, measured.report).toBe(ENTERING_ROW_WRITES)
    // Tres textos: los de la única fila que entró. Las nueve filas que siguen
    // en pantalla conservan su nodo y su índice, así que no escriben nada.
    expect(measured.counts.textContent, measured.report).toBe(3)
    expect(measured.counts.style, measured.report).toBe(1)
    expect(measured.counts.attribute, measured.report).toBe(2)
    // Rotar no oculta ni muestra nada mientras el pool y la ventana miden igual:
    // el slot que libera la fila que sale lo ocupa la fila que entra.
    expect(measured.counts.hidden, measured.report).toBe(0)
    fixture.destroy()
  })

  it('scrolling half a window repaints exactly that half', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 10 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 5 }))

    // Entran cinco filas (10..14) y se quedan cinco (5..9). El costo es
    // exactamente la mitad de repintar la ventana, no la ventana entera.
    expect(measured.counts.total, measured.report).toBe(ENTERING_ROW_WRITES * 5)
    expect(measured.counts.textContent, measured.report).toBe(15)
    fixture.destroy()
  })

  it('a jump larger than the window is bounded by the window, never more', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 10 })
    fixture.paint()
    fixture.paint()

    // Saltar 25 filas no deja ninguna fila en común, así que entran las diez.
    const near = measureDomWrites(fixture.container, () => fixture.paint({ start: 25 }))
    expect(near.counts.total, near.report).toBe(FULL_WINDOW_WRITES)

    // Y saltar 150 más tampoco puede costar más: no hay más nodos que repintar.
    // Esta es la cota que la virtualización garantiza y que la rotación conserva.
    const far = measureDomWrites(fixture.container, () => fixture.paint({ start: 175 }))
    expect(far.counts.total, far.report).toBe(FULL_WINDOW_WRITES)
    fixture.destroy()
  })

  it('100k rows cost the same per frame as 200 rows', () => {
    const fixture = createPoolFixture({ rows: makeRows(100_000), columns, visibleRows: 10 })
    fixture.paint({ start: 90_000 })
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 90_001 }))

    expect(measured.counts.total, measured.report).toBe(ENTERING_ROW_WRITES)
    fixture.destroy()
  })

  it('a wider window costs the SAME per step, because only the entering row writes', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 20 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 1 }))

    // El doble de filas visibles y el mismo costo. Antes de rotar, este número
    // era 120: el doble de la ventana de diez. Ahora la ventana ya no aparece en
    // el costo de un paso, solo en la cota de un salto.
    expect(measured.counts.total, measured.report).toBe(ENTERING_ROW_WRITES)
    fixture.destroy()
  })

  it('a wider window raises only the JUMP bound, proportionally', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 20 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 50 }))

    // Veinte filas entrantes por 6 escrituras cada una. La cota sigue siendo
    // proporcional a la ventana, que es lo que la mantiene acotada.
    expect(measured.counts.total, measured.report).toBe(ENTERING_ROW_WRITES * 20)
    fixture.destroy()
  })

  it('a row that stayed visible keeps the very same DOM node', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 10 })
    fixture.paint()

    // Identidad, no igualdad: es la referencia al nodo lo que tiene que
    // sobrevivir. Si cambiara, el caché de pintado viajaría con el nodo viejo y
    // la fila se repintaría entera aunque muestre lo mismo.
    const before = fixture.pool.getCellElement(5, 'name')
    expect(before).not.toBeNull()

    fixture.paint({ start: 1 })

    expect(fixture.pool.getCellElement(5, 'name')).toBe(before)
    // Y el nodo sigue diciendo lo que decía: rotar no mueve el contenido de una
    // fila a otra.
    expect(before?.textContent).toBe('Row 5')
    // La fila que salió de la ventana ya no se resuelve, aunque su nodo siga en
    // el pool reciclado para otra fila.
    expect(fixture.pool.getCellElement(0, 'name')).toBeNull()
    fixture.destroy()
  })

  it('rotation survives a pool that grows: no stale rows, no duplicates', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 5 })
    // Se arranca lejos del origen para que la base del módulo importe: con
    // start 0 los primeros slots coinciden con cualquier base y el rehash no se
    // vería.
    fixture.paint({ start: 10 })
    fixture.paint({ start: 10 })

    // La ventana se ensancha de 5 a 8: el pool crece y, con él, la base del
    // módulo. TODOS los slots cambian de fila a la vez. Es el caso que rompería
    // una implementación que solo repintara "lo que entró" sin revisitar los
    // slots que ya estaban.
    const measured = measureDomWrites(fixture.container, () =>
      fixture.paint({ start: 10, end: 18 }),
    )

    // Los tres nodos nuevos se crean; ninguno se elimina.
    expect(measured.counts.removeNode, measured.report).toBe(0)

    const painted = fixture
      .rowNodes()
      .filter((node) => !node.hidden)
      .map((node) => node.dataset.rowKey)

    // Ocho filas pintadas, las ocho de la ventana, sin repetidos y sin ninguna
    // sobreviviente de la ventana anterior.
    expect(painted).toHaveLength(8)
    expect([...painted].sort()).toEqual(['10', '11', '12', '13', '14', '15', '16', '17'].sort())
    expect(new Set(painted).size).toBe(8)

    // Y la resolución por índice sigue encontrando cada fila en su slot nuevo.
    for (let rowIndex = 10; rowIndex < 18; rowIndex += 1) {
      expect(fixture.pool.getCellElement(rowIndex, 'name')?.textContent).toBe(`Row ${rowIndex}`)
    }
    fixture.destroy()
  })

  it('rotation survives a pool that shrinks through trim()', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 20 })
    fixture.paint({ start: 30 })

    // `trim` es el único camino por el que el pool se achica, y achicarlo mueve
    // la base del módulo igual que agrandarlo.
    fixture.pool.trim(6)
    fixture.paint({ start: 30, end: 36 })

    const painted = fixture
      .rowNodes()
      .filter((node) => !node.hidden)
      .map((node) => node.dataset.rowKey)

    expect(painted).toHaveLength(6)
    expect([...painted].sort()).toEqual(['30', '31', '32', '33', '34', '35'].sort())
    for (let rowIndex = 30; rowIndex < 36; rowIndex += 1) {
      expect(fixture.pool.getCellElement(rowIndex, 'name')?.textContent).toBe(`Row ${rowIndex}`)
    }
    fixture.destroy()
  })
})

/**
 * El eje horizontal rota con el mismo módulo, y la decisión se tomó midiendo.
 *
 * La duda era legítima: las columnas tienen ancho VARIABLE, así que cuántas
 * entran en el viewport depende de dónde se esté parado, y la base del módulo se
 * mueve mientras se scrollea. Cada vez que crece hay que rehashear las celdas de
 * todas las filas visibles, que es mucho más caro que rehashear filas.
 *
 * La medición dice que igual conviene por un margen grande: ver la tabla
 * completa en la cabecera de `useRowPool.ts`. El rehash es un evento acotado
 * porque `growCells` solo crece, así que la base se estabiliza en la cantidad
 * máxima de columnas que llegaron a entrar y deja de moverse.
 *
 * Estos tests recortan un tramo de un array de columnas ya resuelto UNA vez, que
 * es lo que hace el componente con `resolvedColumns.slice(...)`. Importa: el
 * módulo se aplica sobre `ResolvedColumn.index`, la posición absoluta entre las
 * columnas visibles, y no sobre la posición dentro del tramo recortado. Resolver
 * el tramo de cero en cada frame daría índices que arrancan en 0 siempre y la
 * rotación no tendría contra qué rotar.
 */
describe('horizontal rotation — a column step writes only the entering column', () => {
  // Anchos deliberadamente distintos: son los que vuelven interesante el eje
  // horizontal. Con todas las columnas del mismo ancho, `setCellBox` solo
  // reescribiría el `transform` y el test mediría la mitad del trabajo real.
  const WIDE_COLUMNS = resolveColumns([
    { key: 'name', width: 80 },
    { key: 'id', width: 200 },
    { key: 'amount', width: 120 },
    { key: 'status', width: 60 },
    { key: 'progress', width: 240 },
    { key: 'choice', width: 90 },
    { key: 'done', width: 150 },
    { key: 'name', label: 'name again', width: 110 },
  ])

  it('scrolling one column over a 10x5 window writes only that column', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), visibleRows: 10 })
    fixture.paint({ columns: WIDE_COLUMNS.slice(0, 5) })
    fixture.paint({ columns: WIDE_COLUMNS.slice(0, 5) })

    const measured = measureDomWrites(fixture.container, () =>
      fixture.paint({ columns: WIDE_COLUMNS.slice(1, 6) }),
    )

    // Una columna entrante por diez filas visibles: diez celdas. Cada una
    // escribe su texto, su caja (`transform` y `width`, porque la columna nueva
    // está en otro offset y puede tener otro ancho) y su `aria-colindex`.
    expect(measured.counts.textContent, measured.report).toBe(10)
    expect(measured.counts.style, measured.report).toBe(20)
    expect(measured.counts.attribute, measured.report).toBe(10)
    // Las otras cuarenta celdas conservan su slot y no escriben nada. Sin rotar,
    // este mismo paso costaba 199 escrituras.
    expect(measured.counts.total, measured.report).toBe(40)
    fixture.destroy()
  })

  it('a column that stayed visible keeps its DOM node and its content', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), visibleRows: 4 })
    fixture.paint({ columns: WIDE_COLUMNS.slice(0, 5) })

    const before = fixture.pool.getCellElement(2, 'status')
    expect(before?.textContent).toBe(String(makeRows(3)[2]?.status))

    fixture.paint({ columns: WIDE_COLUMNS.slice(1, 6) })

    expect(fixture.pool.getCellElement(2, 'status')).toBe(before)
    // La columna que salió del tramo ya no se resuelve.
    expect(fixture.pool.getCellElement(2, 'name')).toBeNull()
    fixture.destroy()
  })

  it('both axes rotate at once without interfering', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), visibleRows: 10 })
    fixture.paint({ columns: WIDE_COLUMNS.slice(0, 5) })
    fixture.paint({ columns: WIDE_COLUMNS.slice(0, 5) })

    fixture.paint({ columns: WIDE_COLUMNS.slice(1, 6), start: 1 })

    // Una celda cualquiera del cruce: la fila y la columna se resolvieron cada
    // una por su módulo, sobre bases distintas, y el contenido es el correcto.
    expect(fixture.pool.getCellElement(10, 'id')?.textContent).toBe('10')
    expect(fixture.pool.getCellElement(5, 'amount')?.textContent).toBe('500')
    // La fila y la columna que salieron ya no se resuelven.
    expect(fixture.pool.getCellElement(0, 'id')).toBeNull()
    expect(fixture.pool.getCellElement(5, 'name')).toBeNull()
    fixture.destroy()
  })
})

describe('selection — moving the active cell repaints two cells, not the window', () => {
  it('a horizontal move flips exactly two classes', () => {
    const fixture = createPoolFixture({
      rows: makeRows(200),
      columns: [{ key: 'name' }, { key: 'id' }, { key: 'amount' }],
      visibleRows: 10,
    })
    fixture.paint({ active: { rowIndex: 3, columnKey: 'name' } })
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () =>
      fixture.paint({ active: { rowIndex: 3, columnKey: 'id' } }),
    )

    // Exactamente dos: la celda que pierde la marca y la que la gana. La fila no
    // cambia, así que `dt-row--active` no se toca. Las otras 28 celdas visibles
    // atraviesan el pintado sin escribir nada.
    expect(measured.counts.classList, measured.report).toBe(2)
    // `aria-selected` acompaña a la clase, también sobre esas dos celdas.
    expect(measured.counts.attribute, measured.report).toBe(2)
    expect(measured.counts.textContent, measured.report).toBe(0)
    expect(measured.counts.style, measured.report).toBe(0)
    fixture.destroy()
  })

  it('a vertical move flips four classes: two cells plus two rows', () => {
    const fixture = createPoolFixture({
      rows: makeRows(200),
      columns: [{ key: 'name' }, { key: 'id' }],
      visibleRows: 10,
    })
    fixture.paint({ active: { rowIndex: 3, columnKey: 'name' } })
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () =>
      fixture.paint({ active: { rowIndex: 4, columnKey: 'name' } }),
    )

    // Dos celdas (`dt-cell--active`) más dos filas (`dt-row--active`). Sigue
    // siendo proporcional al movimiento y no a la ventana.
    expect(measured.counts.classList, measured.report).toBe(4)
    expect(measured.counts.textContent, measured.report).toBe(0)
    fixture.destroy()
  })
})

describe('pool sizing — surplus nodes are hidden, never removed', () => {
  it('shrinking the window hides the extra rows and removes nothing', () => {
    const fixture = createPoolFixture({ visibleRows: 10 })
    fixture.paint()
    const nodesBefore = fixture.rowNodes()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 0, end: 4 }))

    expect(measured.counts.removeNode, measured.report).toBe(0)
    // Seis filas sobrantes ocultas, una escritura de `hidden` cada una.
    expect(measured.counts.hidden, measured.report).toBe(6)
    expect(fixture.rowNodes()).toHaveLength(nodesBefore.length)
    fixture.destroy()
  })

  it('re-expanding the window reuses the hidden nodes instead of creating new ones', () => {
    const fixture = createPoolFixture({ visibleRows: 10 })
    fixture.paint()
    const nodesBefore = fixture.rowNodes()
    fixture.paint({ start: 0, end: 4 })

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 0, end: 10 }))

    expect(measured.counts.createNode, measured.report).toBe(0)
    const nodesAfter = fixture.rowNodes()
    for (let slot = 0; slot < nodesBefore.length; slot += 1) {
      expect(nodesAfter[slot]).toBe(nodesBefore[slot])
    }
    fixture.destroy()
  })

  it('only trim() shrinks the pool, and it keeps a slack margin', () => {
    const fixture = createPoolFixture({ visibleRows: 20 })
    fixture.paint()
    expect(fixture.rowNodes()).toHaveLength(20)

    fixture.pool.trim(10)

    // `ROW_POOL_SLACK` es 4: recortar a 10 filas visibles conserva 14 nodos.
    // Ese margen absorbe un resize de unos pocos px sin generar churn de DOM.
    expect(fixture.rowNodes()).toHaveLength(14)
    fixture.destroy()
  })
})

describe('number renderer — the Intl formatter is built once, not per cell', () => {
  it('constructs Intl.NumberFormat exactly once no matter how many cells paint', async () => {
    const OriginalNumberFormat = Intl.NumberFormat
    let constructions = 0

    /**
     * Subclase contadora.
     *
     * Es la única forma de observar cuántas veces se construye el formateador:
     * `Intl.NumberFormat` no expone estadísticas y el renderer guarda su
     * instancia en una constante de módulo, fuera de todo alcance público.
     */
    class CountingNumberFormat extends OriginalNumberFormat {
      constructor(...args: ConstructorParameters<typeof Intl.NumberFormat>) {
        super(...args)
        constructions += 1
      }
    }

    Object.defineProperty(Intl, 'NumberFormat', {
      configurable: true,
      writable: true,
      value: CountingNumberFormat,
    })

    try {
      // El módulo del renderer construye su formateador al evaluarse, así que
      // hay que forzar una reevaluación con el contador ya instalado.
      vi.resetModules()
      const fresh = await import('../internal/renderers/number')
      expect(constructions).toBe(1)

      const fixture = createPoolFixture({
        rows: makeRows(500),
        columns: [{ key: 'amount', renderer: fresh.numberRenderer }],
        visibleRows: 25,
      })

      // 25 celdas por 20 frames de scroll: 500 llamadas a `update`. Un
      // formateador por celda y por frame daría 500 construcciones.
      for (let step = 0; step < 20; step += 1) fixture.paint({ start: step })

      expect(constructions).toBe(1)
      fixture.destroy()
    } finally {
      Object.defineProperty(Intl, 'NumberFormat', {
        configurable: true,
        writable: true,
        value: OriginalNumberFormat,
      })
      vi.resetModules()
    }
  })
})

describe('allocation-free update — avatar and tags mutate, never rebuild', () => {
  it('avatar reuses its inner nodes across every distinct value it paints', () => {
    const fixture = createPoolFixture({
      rows: makeRows(200),
      columns: [{ key: 'owner', renderer: 'avatar' }],
      visibleRows: 6,
    })
    fixture.paint()

    const initialsBefore = fixture.container.querySelectorAll('.dt-avatar-initials')[0]
    expect(initialsBefore).toBeDefined()

    const measured = measureDomWrites(fixture.container, () => {
      for (let step = 1; step <= 30; step += 1) fixture.paint({ start: step })
    })

    // Treinta frames con nombres distintos en cada celda: si `update` asignara
    // un objeto por celda —el bug que se corrigió introduciendo el buffer
    // `scratch` de módulo— se vería como creación de nodos o como reemplazo de
    // la estructura interna. El testigo observable es que no se crea ni un nodo.
    expect(measured.counts.createNode, measured.report).toBe(0)
    expect(measured.counts.removeNode, measured.report).toBe(0)
    expect(fixture.container.querySelectorAll('.dt-avatar-initials')[0]).toBe(initialsBefore)
    fixture.destroy()
  })

  it('tags reuses its pill elements when the list shrinks', () => {
    const rows: DemoRow[] = makeRows(20).map((row, index) => ({
      ...row,
      tags: index === 0 ? ['a', 'b', 'c'] : ['a'],
    }))
    const fixture = createPoolFixture({
      rows,
      columns: [{ key: 'tags', renderer: 'tags' }],
      visibleRows: 1,
    })
    fixture.paint()

    const pillsBefore = [...fixture.container.querySelectorAll('.dt-tag')]
    expect(pillsBefore).toHaveLength(3)

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 1 }))

    // La lista pasa de tres etiquetas a una. Las dos píldoras sobrantes se
    // ocultan; no se destruyen, porque el próximo valor puede volver a
    // necesitarlas.
    expect(measured.counts.createNode, measured.report).toBe(0)
    expect(measured.counts.removeNode, measured.report).toBe(0)
    expect(measured.counts.hidden, measured.report).toBe(2)

    const pillsAfter = [...fixture.container.querySelectorAll('.dt-tag')]
    expect(pillsAfter).toHaveLength(3)
    for (let index = 0; index < pillsBefore.length; index += 1) {
      expect(pillsAfter[index]).toBe(pillsBefore[index])
    }
    fixture.destroy()
  })

  it('tags grows its pill list once and keeps the new pills afterwards', () => {
    const rows: DemoRow[] = makeRows(20).map((row, index) => ({
      ...row,
      tags: index === 0 ? ['a'] : ['a', 'b'],
    }))
    const fixture = createPoolFixture({
      rows,
      columns: [{ key: 'tags', renderer: 'tags' }],
      visibleRows: 1,
    })
    fixture.paint()
    fixture.paint({ start: 1 })

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 2 }))

    // La segunda píldora ya existe desde el frame anterior: pintar otra fila con
    // dos etiquetas no vuelve a crearla.
    expect(measured.counts.createNode, measured.report).toBe(0)
    fixture.destroy()
  })
})

/**
 * Envuelve un renderer para contar sus llamadas de ciclo de vida.
 *
 * Se envuelve en lugar de espiar el singleton del registro porque los renderers
 * incluidos son instancias compartidas por todo el proceso: mutarlas dejaría el
 * espía instalado para los tests que corran después en el mismo archivo.
 */
function trackRenderer(base: AnyCellRenderer): {
  renderer: CellRenderer<DemoRow>
  stats: { created: number; destroyed: number }
} {
  const stats = { created: 0, destroyed: 0 }
  const renderer: CellRenderer<DemoRow> = {
    type: base.type,
    defaultAlign: base.defaultAlign,
    create(cell) {
      stats.created += 1
      return base.create(cell)
    },
    update(handle, ctx) {
      base.update(handle, ctx)
    },
    destroy(handle) {
      stats.destroyed += 1
      base.destroy?.(handle)
    },
  }
  return { renderer, stats }
}

describe('renderer swap — a recycled slot rebuilds when the column type changes', () => {
  it('badge -> progress -> text destroys the old handle and clears the structure', () => {
    const badge = trackRenderer(badgeRenderer)
    const progress = trackRenderer(progressRenderer)
    const text = trackRenderer(textRenderer)

    const fixture = createPoolFixture({ rows: makeRows(10), visibleRows: 1 })

    const asBadge = resolveColumns([
      { key: 'status', renderer: badge.renderer, options: DEMO_OPTIONS },
    ])
    const asProgress = resolveColumns([{ key: 'progress', renderer: progress.renderer }])
    const asText = resolveColumns([{ key: 'name', renderer: text.renderer }])

    fixture.paint({ columns: asBadge })
    const cell = fixture.cellNodes(0)[0]
    expect(cell).toBeDefined()
    expect(cell?.querySelector('.dt-badge')).not.toBeNull()
    expect(badge.stats.created).toBe(1)

    fixture.paint({ columns: asProgress })
    expect(badge.stats.destroyed).toBe(1)
    expect(progress.stats.created).toBe(1)
    // La estructura anterior se vació: no queda rastro de la píldora del badge.
    expect(cell?.querySelector('.dt-badge')).toBeNull()
    expect(cell?.querySelector('.dt-progress')).not.toBeNull()

    fixture.paint({ columns: asText })
    expect(progress.stats.destroyed).toBe(1)
    expect(text.stats.created).toBe(1)
    expect(cell?.querySelector('.dt-progress')).toBeNull()
    // El renderer de texto no arma estructura: escribe directo sobre la celda.
    expect(cell?.children).toHaveLength(0)
    expect(cell?.textContent).toBe('Row 0')

    fixture.destroy()
  })

  it('a slot that keeps its renderer type is never rebuilt', () => {
    const badge = trackRenderer(badgeRenderer)
    const fixture = createPoolFixture({ rows: makeRows(50), visibleRows: 5 })
    const columns = resolveColumns([
      { key: 'status', renderer: badge.renderer, options: DEMO_OPTIONS },
    ])

    fixture.paint({ columns })
    expect(badge.stats.created).toBe(5)

    for (let step = 1; step <= 10; step += 1) fixture.paint({ columns, start: step })

    // Diez frames de scroll sobre el mismo tipo de renderer: ni una construcción
    // más, ni una destrucción. Es el caso común del scroll vertical.
    expect(badge.stats.created).toBe(5)
    expect(badge.stats.destroyed).toBe(0)
    fixture.destroy()
  })

  it('unmounting destroys every live renderer handle', () => {
    const avatar = trackRenderer(avatarRenderer)
    const fixture = createPoolFixture({ rows: makeRows(20), visibleRows: 4 })
    fixture.paint({ columns: resolveColumns([{ key: 'owner', renderer: avatar.renderer }]) })
    expect(avatar.stats.created).toBe(4)

    fixture.pool.unmount()

    // Un renderer puede haber tomado recursos que el GC no alcanza por su cuenta;
    // desmontar sin cerrarlos sería una fuga silenciosa.
    expect(avatar.stats.destroyed).toBe(4)
    fixture.container.remove()
  })
})

describe('ARIA — index writes stay per row during vertical scroll', () => {
  let scrollWrites: ReturnType<typeof measureDomWrites>

  beforeEach(() => {
    const fixture = createPoolFixture({
      rows: makeRows(200),
      columns: [{ key: 'name' }, { key: 'id' }, { key: 'amount' }],
      visibleRows: 10,
    })
    fixture.paint()
    fixture.paint()
    scrollWrites = measureDomWrites(fixture.container, () => fixture.paint({ start: 1 }))
    fixture.destroy()
  })

  it('writes aria-rowindex once per ENTERING row', () => {
    // Antes de que el pool rotara eran diez: una por fila visible, porque las
    // diez cambiaban de índice en cada paso. Ahora solo cambia de índice la fila
    // que entró, y `aria-rowindex` acompaña a ese cambio y a ningún otro.
    expect(countMatching(scrollWrites.entries, 'aria-rowindex'), scrollWrites.report).toBe(1)
  })

  it('writes aria-colindex zero times, because columns did not move', () => {
    // `aria-colindex` va sobre la celda y solo cambia cuando el slot pasa a
    // representar otra columna. Ponerlo por celda en cada frame costaría 30
    // escrituras en lugar de 0, para anunciar exactamente la misma información.
    expect(countMatching(scrollWrites.entries, 'aria-colindex'), scrollWrites.report).toBe(0)
  })

  it('writes no aria-selected when there is no active cell', () => {
    expect(countMatching(scrollWrites.entries, 'aria-selected'), scrollWrites.report).toBe(0)
  })

  it('writes aria-colindex when horizontal virtualization moves a column into a slot', () => {
    const fixture = createPoolFixture({ rows: makeRows(50), visibleRows: 3 })
    const first = resolveColumns([{ key: 'name' }, { key: 'id' }])
    fixture.paint({ columns: first })

    // Se simula el desplazamiento horizontal: el tramo visible ahora arranca en
    // otra columna, así que los slots cambian de identidad de columna. Las dos
    // columnas entrantes tienen valores distintos de los que mostraba el slot,
    // para que el texto realmente se reescriba: si coincidieran, el caché de
    // `writeText` los saltearía y el número mediría otra cosa.
    const shifted = resolveColumns([{ key: 'status' }, { key: 'name' }])
    const measured = measureDomWrites(fixture.container, () => fixture.paint({ columns: shifted }))

    // `resolved.index` no cambió (siguen siendo las columnas visibles 0 y 1), así
    // que `aria-colindex` tampoco: lo que cambia es el contenido, no la posición
    // dentro de la grilla accesible.
    expect(countMatching(measured.entries, 'aria-colindex'), measured.report).toBe(0)
    expect(measured.counts.textContent, measured.report).toBe(6)
    fixture.destroy()
  })
})
