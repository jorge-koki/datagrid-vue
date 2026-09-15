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
 * Con una ventana de 10 filas x 3 columnas de texto, un paso de scroll escribe:
 *
 * - 10 `style.transform`: cada fila visible pasa a representar otra fila del
 *   dataset y se reposiciona dentro del canvas. Es inevitable: las filas están
 *   posicionadas en coordenadas absolutas del contenido.
 * - 10 `data-row-key` + 10 `aria-rowindex` = 20 atributos: identidad de fila,
 *   una escritura por fila y no por celda (ver el bloque de ARIA más abajo).
 * - 30 `textContent`: una por celda visible, porque las tres columnas tienen
 *   valores distintos en cada fila.
 *
 * Total: 60. Lo que este número protege NO es su magnitud sino su
 * INDEPENDENCIA: es idéntico si se scrollea una fila o ciento cincuenta, y es
 * idéntico con 200 filas que con 100.000. El costo por frame depende del
 * tamaño de la ventana, nunca del tamaño del dataset ni de la distancia
 * recorrida. Esa es toda la tesis de la virtualización, expresada como un
 * número.
 *
 * Si este test falla hacia arriba, alguien agregó una escritura por celda al
 * camino caliente. Si falla hacia abajo, puede ser una mejora real: verificá que
 * el contenido siga siendo correcto antes de bajar la constante.
 */
const SCROLL_FRAME_WRITES = 60

describe('scroll cost — writes per frame are bounded by the window, not the dataset', () => {
  const columns: readonly DataTableColumn<DemoRow>[] = [
    { key: 'name' },
    { key: 'id' },
    { key: 'amount' },
  ]

  it('one scroll step over a 10x3 window writes exactly 60 times', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 10 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 1 }))

    expect(measured.counts.total, measured.report).toBe(SCROLL_FRAME_WRITES)
    expect(measured.counts.textContent, measured.report).toBe(30)
    expect(measured.counts.style, measured.report).toBe(10)
    expect(measured.counts.attribute, measured.report).toBe(20)
    fixture.destroy()
  })

  it('jumping 150 rows costs the same as scrolling one', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 10 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 150 }))

    expect(measured.counts.total, measured.report).toBe(SCROLL_FRAME_WRITES)
    fixture.destroy()
  })

  it('100k rows cost the same per frame as 200 rows', () => {
    const fixture = createPoolFixture({ rows: makeRows(100_000), columns, visibleRows: 10 })
    fixture.paint({ start: 90_000 })
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 90_001 }))

    expect(measured.counts.total, measured.report).toBe(SCROLL_FRAME_WRITES)
    fixture.destroy()
  })

  it('a wider window costs proportionally more, confirming the window is the only factor', () => {
    const fixture = createPoolFixture({ rows: makeRows(200), columns, visibleRows: 20 })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ start: 1 }))

    // El doble de filas visibles con las mismas tres columnas: 20 transforms,
    // 40 atributos de identidad y 60 textos.
    expect(measured.counts.total, measured.report).toBe(120)
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

  it('writes aria-rowindex once per visible row', () => {
    expect(countMatching(scrollWrites.entries, 'aria-rowindex'), scrollWrites.report).toBe(10)
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
