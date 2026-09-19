/**
 * Geometría vertical con alturas de fila distintas.
 *
 * ## Qué protege este archivo
 *
 * Todo lo que la tabla sabe sobre el eje vertical —dónde empieza una fila, qué
 * fila hay en un píxel, cuánto mide el contenido entero, qué tramo pintar— sale
 * de aquí. Con alturas uniformes eran divisiones y cualquier error se veía de
 * inmediato; con alturas mezcladas el error típico es de un píxel acumulado a lo
 * largo de miles de filas, que no se ve hasta el final de la lista.
 *
 * Los dos invariantes que sostienen el resto:
 *
 * 1. **`offsetOf` e `indexAt` son inversas.** Si la fila `i` arranca en `y`,
 *    preguntar qué hay en `y` tiene que devolver `i`. Sin eso, traer una celda a
 *    la vista la deja en otra fila.
 * 2. **Sin función de altura no cambia absolutamente nada.** Es el camino que
 *    usa todo el mundo, y la función nueva no puede costarle nada.
 */

import { describe, expect, it } from 'vitest'
import { ref, shallowRef } from 'vue'
import { useRowMetrics } from '../composables/useRowMetrics'

/** Altura base usada en todo el archivo, en px. */
const BASE = 40

/** Arma el composable con refs, para poder mover una entrada por vez. */
function setup(initial: {
  rowCount: number
  rowHeight?: number
  heightAt?: ((index: number) => number) | null
  viewportSize?: number
  scrollOffset?: number
  overscan?: number
}) {
  const rowCount = ref(initial.rowCount)
  const rowHeight = ref(initial.rowHeight ?? BASE)
  // `shallowRef` y no `ref`: una función envuelta en un proxy reactivo se sigue
  // pudiendo llamar, pero la identidad deja de ser la que se pasó.
  const heightAt = shallowRef(initial.heightAt ?? null)
  const viewportSize = ref(initial.viewportSize ?? 400)
  const scrollOffset = ref(initial.scrollOffset ?? 0)
  const overscan = ref(initial.overscan ?? 0)

  const result = useRowMetrics({
    rowCount,
    rowHeight,
    heightAt,
    viewportSize,
    scrollOffset,
    overscan,
  })
  return { ...result, rowCount, rowHeight, heightAt, viewportSize, scrollOffset, overscan }
}

/** Alturas alternadas: pares bajas, impares altas. */
function alternating(index: number): number {
  return index % 2 === 0 ? 40 : 100
}

describe('useRowMetrics — sin función de altura, nada cambia', () => {
  it('da la misma ventana que el virtualizador uniforme', () => {
    const { window, totalSize, metrics } = setup({ rowCount: 100_000 })

    expect(metrics.value.variable).toBe(false)
    expect(window.value).toEqual({ start: 0, end: 11, offset: 0 })
    expect(totalSize.value).toBe(4_000_000)
  })

  it('resuelve la geometría sin reservar memoria por fila', () => {
    const { metrics } = setup({ rowCount: 1_000_000 })

    // Un millón de filas y ni un array: si esto alguna vez construyera offsets,
    // montar la tabla costaría una pasada de un millón de posiciones.
    expect(metrics.value.offsetOf(999_999)).toBe(999_999 * BASE)
    expect(metrics.value.indexAt(999_999 * BASE)).toBe(999_999)
    expect(metrics.value.sizeOf(12)).toBe(BASE)
  })

  it('vuelve al camino uniforme si la función devuelve el alto base para todas', () => {
    // El caso real: `(row) => row.abierta ? 160 : 40` sin ninguna fila abierta
    // todavía. Declarar la función no puede costar nada mientras no haga nada.
    const { metrics } = setup({ rowCount: 5_000, heightAt: () => BASE })

    expect(metrics.value.variable).toBe(false)
    expect(metrics.value.totalSize).toBe(5_000 * BASE)
  })

  it('NO degrada cuando todas miden igual pero distinto de la base', () => {
    // Una función que devuelve 60 para todas también es uniforme, pero 60 no es
    // lo que dice `--dt-row-height`: degradar aquí dejaría al pool sin escribir
    // alturas y a la hoja de estilos pintando celdas de 40 en filas de 60.
    const { metrics } = setup({ rowCount: 100, heightAt: () => 60 })

    expect(metrics.value.variable).toBe(true)
    expect(metrics.value.totalSize).toBe(6_000)
  })
})

describe('useRowMetrics — offsetOf e indexAt son inversas', () => {
  it('ubica cada fila donde termina la anterior', () => {
    const { metrics } = setup({ rowCount: 6, heightAt: alternating })
    const geometry = metrics.value

    // 40, 100, 40, 100, 40, 100 → 0, 40, 140, 180, 280, 320, y 420 de total.
    expect(geometry.offsetOf(0)).toBe(0)
    expect(geometry.offsetOf(1)).toBe(40)
    expect(geometry.offsetOf(2)).toBe(140)
    expect(geometry.offsetOf(3)).toBe(180)
    expect(geometry.offsetOf(4)).toBe(280)
    expect(geometry.offsetOf(5)).toBe(320)
    expect(geometry.totalSize).toBe(420)
  })

  it('devuelve la fila que realmente ocupa cada píxel', () => {
    const { metrics } = setup({ rowCount: 6, heightAt: alternating })
    const geometry = metrics.value

    // El primer píxel de una fila ya es de esa fila; el último de la anterior,
    // de la anterior. Es el borde donde un `<=` mal puesto corre todo uno.
    expect(geometry.indexAt(39)).toBe(0)
    expect(geometry.indexAt(40)).toBe(1)
    expect(geometry.indexAt(139)).toBe(1)
    expect(geometry.indexAt(140)).toBe(2)
    expect(geometry.indexAt(419)).toBe(5)
  })

  it('cierra el ciclo en las mil filas, que es donde un píxel suelto se acumula', () => {
    const { metrics } = setup({ rowCount: 1_000, heightAt: (i) => 30 + (i % 7) * 11 })
    const geometry = metrics.value

    for (let index = 0; index < 1_000; index += 1) {
      const top = geometry.offsetOf(index)
      expect(geometry.indexAt(top)).toBe(index)
      // Y el último píxel de la fila sigue siendo de ella, no de la siguiente.
      expect(geometry.indexAt(top + geometry.sizeOf(index) - 1)).toBe(index)
    }
  })

  it('suma el total igual que sumar las alturas una por una', () => {
    const heightAt = (i: number) => 30 + (i % 7) * 11
    const { metrics } = setup({ rowCount: 1_000, heightAt })

    let esperado = 0
    for (let index = 0; index < 1_000; index += 1) esperado += heightAt(index)
    expect(metrics.value.totalSize).toBe(esperado)
  })
})

describe('useRowMetrics — la ventana variable', () => {
  it('pinta exactamente las filas que asoman en el viewport', () => {
    // 40, 100, 40, 100, ... con 400px de viewport desde el cero: entran la 0 a
    // la 4 (0-40-140-180-280-420), y la 5 arranca en 320, o sea que también.
    const { window } = setup({ rowCount: 100, heightAt: alternating, viewportSize: 400 })

    expect(window.value.start).toBe(0)
    expect(window.value.end).toBe(6)
    expect(window.value.offset).toBe(0)
  })

  it('arranca el tramo en el píxel exacto de su primera fila', () => {
    const { window, metrics, scrollOffset } = setup({
      rowCount: 100,
      heightAt: alternating,
      viewportSize: 400,
    })
    scrollOffset.value = 1_000

    const { start, offset } = window.value
    // Sin esto la primera fila pintada aparece corrida, y con ella todas las de
    // abajo: el pool posiciona cada fila por su offset propio.
    expect(offset).toBe(metrics.value.offsetOf(start))
    expect(offset).toBeLessThanOrEqual(1_000)
    expect(metrics.value.offsetOf(start + 1)).toBeGreaterThan(1_000)
  })

  it('pinta una pantalla, no el dataset, con 100.000 filas mezcladas', () => {
    const { window, scrollOffset } = setup({
      rowCount: 100_000,
      heightAt: alternating,
      viewportSize: 400,
    })
    scrollOffset.value = 3_000_000

    // La promesa entera de la librería: el tramo no crece con el dataset.
    expect(window.value.end - window.value.start).toBeLessThanOrEqual(8)
  })

  it('agrega el overscan a los dos lados', () => {
    const { window, scrollOffset } = setup({
      rowCount: 100,
      heightAt: alternating,
      viewportSize: 400,
      overscan: 3,
    })
    scrollOffset.value = 1_000

    const sin = setup({ rowCount: 100, heightAt: alternating, viewportSize: 400 })
    sin.scrollOffset.value = 1_000

    expect(window.value.start).toBe(sin.window.value.start - 3)
    expect(window.value.end).toBe(sin.window.value.end + 3)
  })

  it('no se pasa de los extremos del dataset', () => {
    const { window, scrollOffset, metrics } = setup({
      rowCount: 20,
      heightAt: alternating,
      viewportSize: 400,
      overscan: 50,
    })
    scrollOffset.value = metrics.value.totalSize

    expect(window.value.start).toBeGreaterThanOrEqual(0)
    expect(window.value.end).toBeLessThanOrEqual(20)
  })
})

describe('useRowMetrics — estados degenerados que el navegador produce', () => {
  it('trata un scroll negativo (rebote de iOS) como el principio de la lista', () => {
    const { window, scrollOffset } = setup({ rowCount: 500, heightAt: alternating })
    scrollOffset.value = -320

    expect(window.value.start).toBe(0)
    expect(window.value.offset).toBe(0)
  })

  it('pinta una fila con el viewport todavía sin medir', () => {
    // Antes del primer `ResizeObserver` el alto es cero. Pintar una fila en vez
    // de ninguna es lo que evita el parpadeo en blanco del primer frame.
    const { window } = setup({ rowCount: 500, heightAt: alternating, viewportSize: 0 })

    expect(window.value.end - window.value.start).toBe(1)
  })

  it('devuelve un tramo vacío sin filas, en vez de un rango inválido', () => {
    const { window, totalSize } = setup({ rowCount: 0, heightAt: alternating })

    expect(window.value).toEqual({ start: 0, end: 0, offset: 0 })
    expect(totalSize.value).toBe(0)
  })

  it('descarta una altura que no sirve y usa la base', () => {
    // Una función del consumidor puede devolver `NaN` —una resta con un campo
    // que no llegó— o un negativo. Ninguno puede romper la geometría.
    const { metrics } = setup({
      rowCount: 4,
      heightAt: (i) => [Number.NaN, -10, 0, 80][i]!,
    })

    expect(metrics.value.sizeOf(0)).toBe(BASE)
    expect(metrics.value.sizeOf(1)).toBe(BASE)
    expect(metrics.value.sizeOf(2)).toBe(BASE)
    expect(metrics.value.sizeOf(3)).toBe(80)
    expect(metrics.value.totalSize).toBe(BASE * 3 + 80)
  })

  it('acota un índice fuera de rango en vez de devolver basura', () => {
    const { metrics } = setup({ rowCount: 6, heightAt: alternating })
    const geometry = metrics.value

    expect(geometry.offsetOf(-5)).toBe(0)
    expect(geometry.offsetOf(999)).toBe(geometry.totalSize)
    expect(geometry.sizeOf(-1)).toBe(BASE)
    expect(geometry.sizeOf(999)).toBe(BASE)
    expect(geometry.indexAt(-100)).toBe(0)
    expect(geometry.indexAt(999_999)).toBe(5)
  })
})

describe('useRowMetrics — qué obliga a rehacer la geometría y qué no', () => {
  it('scrollear no reconstruye los offsets', () => {
    let pasadas = 0
    const { window, scrollOffset } = setup({
      rowCount: 1_000,
      heightAt: (index) => {
        pasadas += 1
        return alternating(index)
      },
      viewportSize: 400,
    })

    void window.value
    const primeraConstruccion = pasadas
    expect(primeraConstruccion).toBe(1_000)

    for (let frame = 0; frame < 50; frame += 1) {
      scrollOffset.value = frame * 37
      void window.value
    }

    // Cincuenta frames de scroll y ni una llamada más: es la razón de que la
    // geometría y la ventana sean dos `computed` distintos.
    expect(pasadas).toBe(primeraConstruccion)
  })

  it('cambiar la función sí la reconstruye', () => {
    const { metrics, heightAt } = setup({ rowCount: 10, heightAt: alternating })
    expect(metrics.value.totalSize).toBe(5 * 40 + 5 * 100)

    heightAt.value = () => 200
    expect(metrics.value.totalSize).toBe(2_000)
  })

  it('el mínimo es el de la fila más baja, que es lo que acota el pool', () => {
    // Con el alto base como cota, un tramo de puras filas bajas dejaría el pool
    // corto y habría que crear nodos en mitad del scroll.
    const { metrics } = setup({ rowCount: 100, heightAt: (i) => (i === 7 ? 12 : 100) })

    expect(metrics.value.minSize).toBe(12)
  })
})
