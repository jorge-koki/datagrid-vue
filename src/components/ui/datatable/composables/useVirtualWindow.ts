import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { VirtualWindow } from '../types'

/** Opciones de {@link useVirtualWindow}. */
export interface UseVirtualWindowOptions {
  /** Cantidad total de items del eje. Valores fraccionarios o negativos se sanean. */
  itemCount: MaybeRefOrGetter<number>
  /**
   * Tamaño fijo de cada item en px.
   *
   * Fijo, no variable, y esa restricción es el corazón del composable: con un
   * tamaño uniforme el índice del primer item visible es una división, O(1), y
   * no depende de la cantidad de items. Es exactamente por eso que 100k filas
   * cuestan lo mismo que 100.
   */
  itemSize: MaybeRefOrGetter<number>
  /** Tamaño visible del viewport sobre el mismo eje, en px. */
  viewportSize: MaybeRefOrGetter<number>
  /** Desplazamiento actual del scroll sobre el mismo eje, en px. */
  scrollOffset: MaybeRefOrGetter<number>
  /** Items extra a cada lado de la ventana. Por defecto 0. */
  overscan?: MaybeRefOrGetter<number>
}

/** Resultado de {@link useVirtualWindow}. */
export interface UseVirtualWindowReturn {
  /** Tramo de items a pintar, con el offset en px de su primer item. */
  window: ComputedRef<VirtualWindow>
  /** Tamaño total del contenido en px. Es lo que dimensiona la barra de scroll nativa. */
  totalSize: ComputedRef<number>
}

/**
 * Calcula qué tramo de una lista de tamaño uniforme cae dentro del viewport.
 *
 * Matemática pura: este composable no toca el DOM, no mide nada y no registra
 * listeners. Recibe números y devuelve números, lo que lo vuelve reutilizable
 * para el eje vertical (filas) y también para el horizontal cuando todas las
 * columnas comparten ancho. Para columnas de ancho variable el cálculo vive en
 * `useColumnLayout`, que resuelve el mismo problema con búsqueda binaria sobre
 * un array de offsets acumulados.
 *
 * Todas las entradas se sanean antes de usarse: un `itemCount` de 0, un scroll
 * negativo por rubber-band en iOS o un `viewportSize` de 0 antes de la primera
 * medición son estados normales, no errores, y ninguno debe producir un rango
 * inválido.
 *
 * @example
 * ```ts
 * const { window, totalSize } = useVirtualWindow({
 *   itemCount: () => rows.length,
 *   itemSize: rowHeight,
 *   viewportSize: () => metrics.value.viewportHeight,
 *   scrollOffset: () => metrics.value.scrollTop,
 *   overscan: 4,
 * })
 * ```
 */
export function useVirtualWindow(options: UseVirtualWindowOptions): UseVirtualWindowReturn {
  /** Normaliza `itemCount` a un entero no negativo. */
  const itemCount = computed(() => {
    const raw = toValue(options.itemCount)
    if (!Number.isFinite(raw) || raw <= 0) return 0
    return Math.floor(raw)
  })

  /** Normaliza `itemSize`. Un tamaño no positivo apaga la virtualización. */
  const itemSize = computed(() => {
    const raw = toValue(options.itemSize)
    if (!Number.isFinite(raw) || raw <= 0) return 0
    return raw
  })

  const totalSize = computed(() => itemCount.value * itemSize.value)

  const window = computed<VirtualWindow>(() => {
    const count = itemCount.value
    const size = itemSize.value

    // Sin items o sin tamaño no hay ventana posible. Se devuelve un rango vacío
    // en lugar de propagar NaN o índices negativos al camino de pintado.
    if (count === 0 || size === 0) return { start: 0, end: 0, offset: 0 }

    const rawViewport = toValue(options.viewportSize)
    const viewportSize = Number.isFinite(rawViewport) && rawViewport > 0 ? rawViewport : 0

    // El scroll puede llegar negativo durante el rebote elástico de iOS y macOS,
    // y puede exceder el contenido durante un resize. Se acota a los extremos
    // válidos antes de dividir.
    const rawOffset = toValue(options.scrollOffset)
    const maxOffset = Math.max(0, count * size - viewportSize)
    const scrollOffset = Number.isFinite(rawOffset)
      ? Math.min(Math.max(rawOffset, 0), maxOffset)
      : 0

    const rawOverscan = toValue(options.overscan ?? 0)
    const overscan = Number.isFinite(rawOverscan) && rawOverscan > 0 ? Math.floor(rawOverscan) : 0

    // Índice del primer item que intersecta el viewport. Una sola división: el
    // costo es independiente de `count`, que es lo que hace viable 100k filas.
    const firstVisible = Math.min(Math.floor(scrollOffset / size), count - 1)

    // `ceil` cubre el viewport y el `+ 1` cubre los dos items parcialmente
    // visibles en los bordes cuando el scroll no está alineado a un múltiplo del
    // tamaño de item. Con `viewportSize` en 0 (antes de la primera medición del
    // ResizeObserver) esto rinde 1, de modo que se pinta algo en vez de dejar la
    // tabla en blanco hasta el frame siguiente.
    const visibleCount = Math.ceil(viewportSize / size) + 1

    const start = Math.max(0, firstVisible - overscan)
    const end = Math.min(count, firstVisible + visibleCount + overscan)

    return {
      start,
      // `end` nunca puede quedar por debajo de `start`: si el acotado los cruzó,
      // el tramo correcto es vacío, no invertido.
      end: Math.max(start, end),
      offset: start * size,
    }
  })

  return { window, totalSize }
}
