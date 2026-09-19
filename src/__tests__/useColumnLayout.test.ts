/**
 * Layout de columnas: orden, visibilidad, anchos y búsqueda binaria horizontal.
 *
 * El test más importante del archivo es el de fuerza bruta sobre
 * `findColumnRange`: una búsqueda binaria con un `<=` mal puesto sigue
 * devolviendo rangos plausibles y solo se manifiesta como una columna que
 * parpadea en el borde durante el scroll horizontal. Barrer todas las posiciones
 * de scroll y verificar la invariante —ninguna columna que intersecte el
 * viewport queda fuera del rango— es lo único que atrapa ese error.
 */

import { describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { useColumnLayout } from '../composables/useColumnLayout'
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../internal/constants'
import type { ColumnVisibilityState, ColumnWidthState, DataTableColumn } from '../types'

type Row = { a: string; b: string; c: string; d: string; e: string; f: string }

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { key: 'a', width: 100 },
  { key: 'b', width: 50 },
  { key: 'c', width: 200 },
  { key: 'd', width: 75 },
  { key: 'e', width: 120 },
  { key: 'f', width: 300 },
]

/** Suma de los anchos declarados arriba. */
const TOTAL_WIDTH = 845

interface SetupOptions {
  columns?: readonly DataTableColumn<Row>[]
  defaultColumnWidth?: number
  visibility?: ColumnVisibilityState
  order?: readonly string[]
  widths?: ColumnWidthState
  onWidthChange?: (key: string, width: number) => void
}

function setup(options: SetupOptions = {}) {
  const columns = shallowRef<readonly DataTableColumn<Row>[]>(options.columns ?? COLUMNS)
  const defaultColumnWidth = ref(options.defaultColumnWidth ?? 150)
  const visibility = shallowRef<ColumnVisibilityState>(options.visibility ?? {})
  const order = shallowRef<readonly string[]>(options.order ?? [])
  const widths = shallowRef<ColumnWidthState>(options.widths ?? {})

  const layout = useColumnLayout<Row>({
    columns,
    defaultColumnWidth,
    visibility,
    order,
    widths,
    onWidthChange: options.onWidthChange,
  })

  return { layout, columns, defaultColumnWidth, visibility, order, widths }
}

describe('useColumnLayout — cumulative offsets', () => {
  it('places every column immediately after the previous one', () => {
    const { layout } = setup()

    expect(layout.resolvedColumns.value.map((entry) => entry.offset)).toEqual([
      0, 100, 150, 350, 425, 545,
    ])
    expect(layout.totalWidth.value).toBe(TOTAL_WIDTH)
  })

  it('exposes the offsets array aligned by index with the resolved columns', () => {
    const { layout } = setup()

    expect(layout.offsets.value).toEqual(layout.resolvedColumns.value.map((entry) => entry.offset))
  })

  it('reports a total width of zero when every column is hidden', () => {
    const { layout } = setup({
      visibility: { a: false, b: false, c: false, d: false, e: false, f: false },
    })

    expect(layout.resolvedColumns.value).toHaveLength(0)
    expect(layout.totalWidth.value).toBe(0)
    expect(layout.visibleCount.value).toBe(0)
  })
})

describe('useColumnLayout — hidden columns leave no gap', () => {
  it('shifts the following columns left instead of leaving a hole', () => {
    const { layout } = setup({ visibility: { b: false } })

    // Sin `b` (50px), `c` pasa a arrancar en 100 y todo lo demás se corre.
    expect(layout.resolvedColumns.value.map((entry) => entry.key)).toEqual([
      'a',
      'c',
      'd',
      'e',
      'f',
    ])
    expect(layout.resolvedColumns.value.map((entry) => entry.offset)).toEqual([
      0, 100, 300, 375, 495,
    ])
  })

  it('shrinks the total width by exactly the hidden column width', () => {
    const { layout, visibility } = setup()
    const before = layout.totalWidth.value

    visibility.value = { c: false }

    expect(layout.totalWidth.value).toBe(before - 200)
  })

  it('renumbers the visible index so aria-colindex stays contiguous', () => {
    const { layout } = setup({ visibility: { a: false, c: false } })

    expect(layout.resolvedColumns.value.map((entry) => entry.index)).toEqual([0, 1, 2, 3])
  })

  it('honours defaultVisible when the visibility map says nothing', () => {
    const { layout } = setup({
      columns: [
        { key: 'a', width: 100 },
        { key: 'b', width: 50, defaultVisible: false },
      ],
    })

    // Estar visible ES tener geometría resuelta: no hay un segundo predicado
    // aparte que pueda desincronizarse del que usa el pintado.
    expect(layout.getResolvedColumn('a')).not.toBeNull()
    expect(layout.getResolvedColumn('b')).toBeNull()
  })

  it('lets an explicit visibility entry override defaultVisible', () => {
    const { layout } = setup({
      columns: [{ key: 'a', width: 100, defaultVisible: false }],
      visibility: { a: true },
    })

    expect(layout.getResolvedColumn('a')).not.toBeNull()
  })
})

describe('useColumnLayout — width resolution and clamping', () => {
  it('prefers the runtime width over the declared one', () => {
    const { layout } = setup({ widths: { a: 260 } })

    expect(layout.getResolvedColumn('a')?.width).toBe(260)
  })

  it('falls back to defaultColumnWidth when the column declares none', () => {
    const { layout } = setup({ columns: [{ key: 'a' }], defaultColumnWidth: 180 })

    expect(layout.getResolvedColumn('a')?.width).toBe(180)
  })

  it('clamps below the global minimum so the column stays grabbable', () => {
    const { layout } = setup({ columns: [{ key: 'a', width: 4 }] })

    expect(layout.getResolvedColumn('a')?.width).toBe(MIN_COLUMN_WIDTH)
  })

  it('clamps above the global maximum so the canvas cannot overflow', () => {
    const { layout } = setup({ columns: [{ key: 'a', width: 1e9 }] })

    expect(layout.getResolvedColumn('a')?.width).toBe(MAX_COLUMN_WIDTH)
  })

  it('applies the column minWidth when it is stricter than the global one', () => {
    const { layout } = setup({ columns: [{ key: 'a', width: 50, minWidth: 200 }] })

    expect(layout.getResolvedColumn('a')?.width).toBe(200)
  })

  it('applies the column maxWidth when it is stricter than the global one', () => {
    const { layout } = setup({ columns: [{ key: 'a', width: 900, maxWidth: 300 }] })

    expect(layout.getResolvedColumn('a')?.width).toBe(300)
  })

  it('resolves a contradictory min/max pair in favour of the minimum', () => {
    const { layout } = setup({ columns: [{ key: 'a', width: 500, minWidth: 300, maxWidth: 100 }] })

    // Una columna no puede ser más angosta que su propio mínimo: entre dos
    // límites imposibles gana el que garantiza que se pueda agarrar.
    expect(layout.getResolvedColumn('a')?.width).toBe(300)
  })

  it('ignores a non-finite runtime width and falls back to the declared one', () => {
    const { layout } = setup({ widths: { a: Number.NaN } })

    expect(layout.getResolvedColumn('a')?.width).toBe(100)
  })

  it('ignores a non-positive defaultColumnWidth', () => {
    const { layout } = setup({ columns: [{ key: 'a' }], defaultColumnWidth: 0 })

    // Cae al valor por defecto del módulo de constantes, 150.
    expect(layout.getResolvedColumn('a')?.width).toBe(150)
  })
})

describe('useColumnLayout — runtime resize', () => {
  it('reports the clamped width back to the owner instead of storing it', () => {
    const onWidthChange = vi.fn()
    const { layout } = setup({ columns: [{ key: 'a', width: 100, minWidth: 80 }], onWidthChange })

    const applied = layout.setColumnWidth('a', 10)

    expect(applied).toBe(80)
    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith('a', 80)
    // El layout no guarda nada: sin que el dueño devuelva el ancho por `widths`,
    // la columna sigue midiendo lo de antes.
    expect(layout.getResolvedColumn('a')?.width).toBe(100)
  })

  it('reflects the new width once the owner feeds it back', () => {
    const { layout, widths } = setup()
    const applied = layout.setColumnWidth('c', 400)
    widths.value = { c: applied }

    expect(layout.getResolvedColumn('c')?.width).toBe(400)
    // Las columnas siguientes se recolocan: `c` medía 200 y ahora mide 400.
    expect(layout.getResolvedColumn('d')?.offset).toBe(550)
  })

  it('returns zero and notifies nobody for an unknown column key', () => {
    const onWidthChange = vi.fn()
    const { layout } = setup({ onWidthChange })

    expect(layout.setColumnWidth('nope', 200)).toBe(0)
    expect(onWidthChange).not.toHaveBeenCalled()
  })

  it('can resize a hidden column, because visibility is not a lock', () => {
    const onWidthChange = vi.fn()
    const { layout } = setup({ visibility: { b: false }, onWidthChange })

    expect(layout.setColumnWidth('b', 220)).toBe(220)
    // Pero sigue sin tener geometría resuelta mientras esté oculta.
    expect(layout.getResolvedColumn('b')).toBeNull()
  })
})

describe('useColumnLayout — order', () => {
  it('applies the given order', () => {
    const { layout } = setup({ order: ['f', 'a', 'b', 'c', 'd', 'e'] })

    expect(layout.resolvedColumns.value.map((entry) => entry.key)).toEqual([
      'f',
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
    expect(layout.resolvedColumns.value[0]?.offset).toBe(0)
    expect(layout.resolvedColumns.value[1]?.offset).toBe(300)
  })

  it('drops ghost keys and appends missing columns in declaration order', () => {
    const { layout } = setup({ order: ['ghost', 'c', 'a'] })

    expect(layout.orderedColumns.value.map((column) => column.key)).toEqual([
      'c',
      'a',
      'b',
      'd',
      'e',
      'f',
    ])
  })

  it('produces a brand new array on reorder, never a mutation in place', () => {
    const { layout, order } = setup()
    const before = layout.resolvedColumns.value

    order.value = ['b', 'a', 'c', 'd', 'e', 'f']
    const after = layout.resolvedColumns.value

    // Identidad distinta: el camino de pintado compara referencias para decidir
    // si tiene que recalcular, así que mutar en el lugar lo dejaría ciego.
    expect(after).not.toBe(before)
    expect(after.map((entry) => entry.key)).toEqual(['b', 'a', 'c', 'd', 'e', 'f'])
  })

  it('keeps declaration order when the order list is empty', () => {
    const { layout } = setup({ order: [] })

    expect(layout.orderedColumns.value.map((column) => column.key)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ])
  })
})

describe('useColumnLayout — lookups', () => {
  it('returns the same null for a hidden column and for an unknown one', () => {
    const { layout } = setup({ visibility: { b: false } })

    // Los dos casos son indistinguibles desde aquí, y es la decisión de diseño
    // que sostiene todo lo que hay más arriba: para la geometría no hay
    // diferencia entre "está oculta" y "no existe", porque ninguna de las dos
    // tiene ancho ni offset que dar. Quien necesita distinguirlas mira
    // `orderedColumns`, que sí incluye las ocultas.
    expect(layout.getResolvedColumn('b')).toBeNull()
    expect(layout.getResolvedColumn('nope')).toBeNull()
    expect(layout.orderedColumns.value.some((column) => column.key === 'b')).toBe(true)
    expect(layout.orderedColumns.value.some((column) => column.key === 'nope')).toBe(false)
  })

  it('derives alignment from the renderer unless the column overrides it', () => {
    const { layout } = setup({
      columns: [
        { key: 'a', renderer: 'number' },
        { key: 'b', renderer: 'number', align: 'left' },
        { key: 'c' },
      ],
    })

    expect(layout.getResolvedColumn('a')?.align).toBe('right')
    expect(layout.getResolvedColumn('b')?.align).toBe('left')
    expect(layout.getResolvedColumn('c')?.align).toBe('left')
  })
})

describe('useColumnLayout — findColumnRange never drops a visible column', () => {
  /** Verifica la invariante para un barrido completo de posiciones de scroll. */
  function sweep(viewportWidth: number, overscan: number, visibility: ColumnVisibilityState): void {
    const { layout } = setup({ visibility })
    const resolved = layout.resolvedColumns.value
    const total = layout.totalWidth.value

    for (let left = 0; left <= total + 40; left += 1) {
      const range = layout.findColumnRange(left, viewportWidth, overscan)
      const right = left + viewportWidth

      for (let index = 0; index < resolved.length; index += 1) {
        const column = resolved[index]
        if (!column) continue
        const overlaps = column.offset < right && column.offset + column.width > left
        if (!overlaps) continue

        expect(
          index >= range.start && index < range.end,
          `columna ${column.key} (${column.offset}..${column.offset + column.width}) quedó fuera ` +
            `del rango [${range.start}, ${range.end}) con scrollLeft=${left}`,
        ).toBe(true)
      }

      expect(range.start).toBeGreaterThanOrEqual(0)
      expect(range.end).toBeLessThanOrEqual(resolved.length)
      expect(range.end).toBeGreaterThanOrEqual(range.start)
    }
  }

  it('holds for every scroll position with no overscan', () => {
    sweep(300, 0, {})
  })

  it('holds for a viewport narrower than the narrowest column', () => {
    sweep(20, 0, {})
  })

  it('holds for a viewport wider than the whole table', () => {
    sweep(2000, 0, {})
  })

  it('holds with overscan, which may only widen the range', () => {
    sweep(300, 2, {})
  })

  it('holds when columns are hidden and the offsets shift', () => {
    sweep(300, 1, { b: false, d: false })
  })

  it('returns an empty range when there are no visible columns', () => {
    const { layout } = setup({
      visibility: { a: false, b: false, c: false, d: false, e: false, f: false },
    })

    expect(layout.findColumnRange(0, 500, 4)).toEqual({ start: 0, end: 0 })
  })

  it('sanitizes negative and non-finite scroll input', () => {
    const { layout } = setup()

    expect(layout.findColumnRange(-500, 300, 0)).toEqual(layout.findColumnRange(0, 300, 0))
    expect(layout.findColumnRange(Number.NaN, 300, 0)).toEqual(layout.findColumnRange(0, 300, 0))
    expect(layout.findColumnRange(0, Number.NaN, 0)).toEqual(layout.findColumnRange(0, 0, 0))
  })

  it('finds the exact column when the scroll lands on its left edge', () => {
    const { layout } = setup()

    // `c` arranca en 150. Un `<` en lugar de `<=` en la búsqueda binaria haría
    // que este caso devolviera la columna anterior.
    expect(layout.findColumnRange(150, 10, 0).start).toBe(2)
  })
})
