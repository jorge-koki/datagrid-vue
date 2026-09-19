/**
 * Ventana virtual: matemática pura sobre el eje vertical.
 *
 * Los casos que importan no son los felices sino los estados que el navegador
 * produce de forma normal y que un cálculo ingenuo convierte en índices
 * inválidos: el rebote elástico de iOS manda scroll negativo, un resize puede
 * dejar el scroll más allí del contenido, y el primer frame ocurre antes de que
 * el `ResizeObserver` haya medido nada.
 */

import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useVirtualWindow } from '../composables/useVirtualWindow'

/** Altura de fila usada en todo el archivo, en px. */
const ROW = 40

/** Arma el composable con refs, para poder mover una entrada por vez. */
function setup(initial: {
  itemCount: number
  itemSize?: number
  viewportSize?: number
  scrollOffset?: number
  overscan?: number
}) {
  const itemCount = ref(initial.itemCount)
  const itemSize = ref(initial.itemSize ?? ROW)
  const viewportSize = ref(initial.viewportSize ?? 400)
  const scrollOffset = ref(initial.scrollOffset ?? 0)
  const overscan = ref(initial.overscan ?? 0)

  const result = useVirtualWindow({ itemCount, itemSize, viewportSize, scrollOffset, overscan })
  return { ...result, itemCount, itemSize, viewportSize, scrollOffset, overscan }
}

describe('useVirtualWindow — window size is independent of the dataset', () => {
  it('paints only a screenful out of 100.000 rows', () => {
    const { window, totalSize } = setup({ itemCount: 100_000 })

    // ceil(400 / 40) = 10 filas completas, mas 1 que cubre el borde parcial.
    expect(window.value).toEqual({ start: 0, end: 11, offset: 0 })
    expect(totalSize.value).toBe(4_000_000)
  })

  it('costs the same window at row 99.000 as at row 0', () => {
    const { window, scrollOffset } = setup({ itemCount: 100_000 })
    scrollOffset.value = 99_000 * ROW

    const painted = window.value.end - window.value.start
    expect(painted).toBe(11)
    expect(window.value.start).toBe(99_000)
    expect(window.value.offset).toBe(99_000 * ROW)
  })
})

describe('useVirtualWindow — scroll positions the browser really produces', () => {
  it('treats a negative scroll (iOS rubber-band) as the top of the list', () => {
    const { window, scrollOffset } = setup({ itemCount: 500 })
    scrollOffset.value = -320

    // Sin el acotado, la division daria un indice negativo y el pintado pediria
    // `rows[-8]`.
    expect(window.value).toEqual({ start: 0, end: 11, offset: 0 })
  })

  it('clamps an overscroll past the end to the last full screen', () => {
    const { window, scrollOffset } = setup({ itemCount: 500 })
    scrollOffset.value = 10_000_000

    // maxOffset = 500 * 40 - 400 = 19.600 -> primera fila visible 490.
    expect(window.value.start).toBe(490)
    expect(window.value.end).toBe(500)
    expect(window.value.offset).toBe(490 * ROW)
  })

  it('never returns an inverted range when clamping crosses the bounds', () => {
    const { window, scrollOffset, viewportSize } = setup({ itemCount: 3 })
    viewportSize.value = 5_000
    scrollOffset.value = 4_000

    expect(window.value.end).toBeGreaterThanOrEqual(window.value.start)
    expect(window.value).toEqual({ start: 0, end: 3, offset: 0 })
  })

  it('ignores a non-finite scroll offset instead of producing NaN indices', () => {
    const { window, scrollOffset } = setup({ itemCount: 500 })
    scrollOffset.value = Number.NaN

    expect(window.value).toEqual({ start: 0, end: 11, offset: 0 })
  })
})

describe('useVirtualWindow — degenerate inputs are states, not errors', () => {
  it('returns an empty range for an empty dataset', () => {
    const { window, totalSize } = setup({ itemCount: 0 })

    expect(window.value).toEqual({ start: 0, end: 0, offset: 0 })
    expect(totalSize.value).toBe(0)
  })

  it('returns an empty range for a negative item count', () => {
    const { window } = setup({ itemCount: -10 })

    expect(window.value).toEqual({ start: 0, end: 0, offset: 0 })
  })

  it('floors a fractional item count', () => {
    const { window } = setup({ itemCount: 10.9, viewportSize: 10_000 })

    expect(window.value.end).toBe(10)
  })

  it('still paints one row with a viewport of 0, before the first measurement', () => {
    const { window } = setup({ itemCount: 500, viewportSize: 0 })

    // Pintar una fila es lo que evita que la tabla quede en blanco hasta que el
    // ResizeObserver entregue la primera medicion.
    expect(window.value).toEqual({ start: 0, end: 1, offset: 0 })
  })

  it('turns virtualization off when the item size is not positive', () => {
    const { window, totalSize } = setup({ itemCount: 500, itemSize: 0 })

    expect(window.value).toEqual({ start: 0, end: 0, offset: 0 })
    expect(totalSize.value).toBe(0)
  })
})

describe('useVirtualWindow — overscan', () => {
  it('extends the window on both sides', () => {
    const { window, scrollOffset } = setup({ itemCount: 500, overscan: 4, scrollOffset: 0 })
    scrollOffset.value = 100 * ROW

    expect(window.value.start).toBe(96)
    expect(window.value.end).toBe(115)
    // El offset acompaña al `start` ampliado: si no, las filas de overscan se
    // pintarían encima de las visibles.
    expect(window.value.offset).toBe(96 * ROW)
  })

  it('does not push the start below zero at the top of the list', () => {
    const { window } = setup({ itemCount: 500, overscan: 20 })

    expect(window.value.start).toBe(0)
    expect(window.value.offset).toBe(0)
  })

  it('does not push the end past the item count at the bottom', () => {
    const { window, scrollOffset } = setup({ itemCount: 500, overscan: 20 })
    scrollOffset.value = 500 * ROW

    expect(window.value.end).toBe(500)
  })

  it('ignores a negative overscan', () => {
    const { window } = setup({ itemCount: 500, overscan: -8 })

    expect(window.value).toEqual({ start: 0, end: 11, offset: 0 })
  })

  it('floors a fractional overscan', () => {
    const { window, scrollOffset } = setup({ itemCount: 500, overscan: 2.9 })
    scrollOffset.value = 10 * ROW

    expect(window.value.start).toBe(8)
  })
})

describe('useVirtualWindow — boundary alignment', () => {
  it('starts exactly at the row whose top matches the scroll offset', () => {
    const { window, scrollOffset } = setup({ itemCount: 500 })
    scrollOffset.value = 7 * ROW

    expect(window.value.start).toBe(7)
    expect(window.value.offset).toBe(7 * ROW)
  })

  it('keeps the partially visible row at the top inside the window', () => {
    const { window, scrollOffset } = setup({ itemCount: 500 })
    scrollOffset.value = 7 * ROW + 1

    // Un pixel de desplazamiento no debe sacar a la fila 7 de la ventana: sigue
    // ocupando casi toda su altura en pantalla.
    expect(window.value.start).toBe(7)
    expect(window.value.offset).toBe(7 * ROW)
  })

  it('covers the whole viewport for every scroll position of a full sweep', () => {
    const count = 400
    const viewport = 400
    const { window, scrollOffset } = setup({ itemCount: count, viewportSize: viewport })

    const maxOffset = count * ROW - viewport
    for (let offset = 0; offset <= maxOffset; offset += 7) {
      scrollOffset.value = offset
      const { start, end } = window.value

      // Invariante: toda fila que intersecte el viewport tiene que estar dentro
      // del tramo pintado. Un fallo aquí se ve en pantalla como una franja en
      // blanco durante el scroll.
      const firstVisible = Math.floor(offset / ROW)
      const lastVisible = Math.floor((offset + viewport - 1) / ROW)
      expect(start).toBeLessThanOrEqual(firstVisible)
      expect(end).toBeGreaterThan(lastVisible)
      expect(window.value.offset).toBe(start * ROW)
    }
  })
})
