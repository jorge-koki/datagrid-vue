import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { Ref, ShallowRef } from 'vue'

/**
 * Métricas del viewport en un instante dado.
 *
 * Se publica en dos formas —una viva y otra reactiva— y la distinción es el
 * punto central de este módulo. Ver {@link UseScrollSyncReturn}.
 */
export interface ScrollMetrics {
  /** Desplazamiento vertical del viewport en px. */
  scrollTop: number
  /** Desplazamiento horizontal del viewport en px. */
  scrollLeft: number
  /** Ancho visible del viewport en px, sin contar la barra de scroll. */
  viewportWidth: number
  /** Alto visible del viewport en px, sin contar la barra de scroll. */
  viewportHeight: number
}

/** Opciones de {@link useScrollSync}. */
export interface UseScrollSyncOptions {
  /** El contenedor con `overflow: auto`. */
  viewport: Readonly<ShallowRef<HTMLElement | null>>
  /** Se invoca una vez por frame, después de publicar el espejo reactivo. */
  onFrame: () => void
}

/** Resultado de {@link useScrollSync}. */
export interface UseScrollSyncReturn {
  /**
   * Métricas **vivas y no reactivas**.
   *
   * Se actualizan de forma síncrona dentro del handler de scroll, así que son
   * siempre el valor más fresco posible. Leerlas no registra ninguna dependencia
   * reactiva y escribirlas no dispara ningún efecto: es el objeto que se lee
   * durante el pintado, donde despertar al scheduler de Vue sería exactamente lo
   * que se quiere evitar.
   */
  live: Readonly<ScrollMetrics>
  /**
   * Espejo **reactivo**, publicado como mucho una vez por frame.
   *
   * Es la única puerta por la que el estado de scroll entra al sistema de
   * reactividad de Vue, y de ahí lo consumen los `computed` de ventana. Se
   * publica dentro del rAF y justo antes de `onFrame`, de modo que cualquier
   * `computed` que se lea durante el pintado se recalcula en ese mismo frame:
   * los `computed` son perezosos y se resuelven al leerlos, no al invalidarse.
   */
  state: Readonly<Ref<ScrollMetrics>>
  /** Agenda un frame. Coalesce: varias llamadas en el mismo frame producen un solo pintado. */
  requestFrame(): void
  /** Mueve el scroll del viewport. El evento nativo se encarga del resto. */
  scrollTo(position: { top?: number; left?: number }): void
  /** Vuelve a medir el viewport. Fuerza layout, por eso no se llama por frame. */
  measure(): void
}

/**
 * Coordina scroll, medición del viewport y ritmo de pintado.
 *
 * ## Por qué hay dos copias de las mismas métricas
 *
 * El evento `scroll` puede dispararse varias veces entre dos frames. Si cada uno
 * escribiera en un `ref`, cada escritura despertaría al scheduler de Vue y se
 * pintaría más de una vez por frame, o peor, se pintaría fuera de sincronía con
 * el compositor. La solución es separar responsabilidades:
 *
 * - `live` absorbe todos los eventos, sin costo reactivo.
 * - `state` se publica una vez por frame dentro del `requestAnimationFrame`.
 *
 * El pintado lee `live` si necesita el valor exacto de este instante, y los
 * `computed` de ventana leen `state`, que ya quedó fijo para el frame.
 *
 * ## Por qué rAF y no un throttle por tiempo
 *
 * `requestAnimationFrame` alinea el trabajo con el momento en que el navegador
 * va a componer. Un throttle de 16ms se desfasa y termina pintando entre frames,
 * lo que se ve como micro-tirones aunque el promedio de FPS sea correcto.
 *
 * ## Por qué acá no se mueve nada
 *
 * Este módulo **no escribe una sola propiedad en el DOM**, y es una decisión, no
 * una omisión. Durante un tiempo movió el encabezado y la regleta de numeración
 * con un `transform` que espejaba el `scrollLeft`, y eso no puede funcionar bien:
 * el navegador scrollea en el hilo del compositor y compone el frame con el
 * desplazamiento nuevo ANTES de que el hilo principal llegue a escribir la
 * compensación. Medido frame compuesto por frame compuesto en el navegador, uno
 * de cada dos mostraba lo compensado corrido el delta entero del scroll y el
 * siguiente lo devolvía de un salto: a 70px por paso, eso se ve como temblor.
 *
 * El problema no era qué valor se leía sino QUIÉN aplica la posición. Todo lo que
 * tiene que quedarse quieto —encabezado, regleta, columnas ancladas— vive ahora
 * dentro del scroller con `position: sticky`, sostenido por el compositor. Lo
 * único que queda acá es medir, publicar y marcar el ritmo.
 */
export function useScrollSync(options: UseScrollSyncOptions): UseScrollSyncReturn {
  /**
   * Objeto mutable y deliberadamente NO reactivo.
   *
   * Es una sola instancia durante toda la vida del composable: se muta en el
   * lugar en cada evento de scroll en vez de reasignarse, para no generar basura
   * en un handler que puede correr decenas de veces por segundo.
   */
  const live: ScrollMetrics = {
    scrollTop: 0,
    scrollLeft: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  }

  /**
   * Espejo reactivo. `shallowRef` y reemplazo completo: lo que importa es que el
   * objeto cambió, no observar sus campos uno por uno.
   */
  const state = shallowRef<ScrollMetrics>({ ...live })

  /** Handle del frame pendiente. 0 significa ocioso: `requestAnimationFrame` nunca devuelve 0. */
  let frameHandle = 0

  let resizeObserver: ResizeObserver | null = null
  let observedViewport: HTMLElement | null = null

  function requestFrame(): void {
    if (frameHandle !== 0) return
    frameHandle = requestAnimationFrame(runFrame)
  }

  function runFrame(): void {
    frameHandle = 0

    // 1. Publicar el espejo reactivo. A partir de acá los `computed` de ventana
    //    devuelven valores de este frame en cuanto alguien los lea.
    state.value = { ...live }

    // 2. Pintar. Y eso es todo: este módulo NO escribe una sola propiedad en el
    //    DOM. Ver la nota "Por qué acá no se mueve nada" en la cabecera.
    options.onFrame()
  }

  function handleScroll(): void {
    const element = options.viewport.value
    if (!element) return
    // Leer `scrollTop` / `scrollLeft` dentro del handler de scroll no fuerza
    // layout: el navegador ya resolvió la posición antes de emitir el evento.
    live.scrollTop = element.scrollTop
    live.scrollLeft = element.scrollLeft
    requestFrame()
  }

  function measure(): void {
    const element = options.viewport.value
    if (!element) return
    // `clientWidth` / `clientHeight` sí fuerzan layout. Por eso esta función se
    // llama solo al montar; después las medidas llegan por ResizeObserver, que
    // las entrega ya calculadas.
    live.viewportWidth = element.clientWidth
    live.viewportHeight = element.clientHeight
  }

  function scrollTo(position: { top?: number; left?: number }): void {
    const element = options.viewport.value
    if (!element) return
    if (position.top !== undefined) element.scrollTop = position.top
    if (position.left !== undefined) element.scrollLeft = position.left
    // No hace falta actualizar `live` a mano: asignar el scroll dispara el
    // evento nativo y `handleScroll` se encarga.
  }

  function handleResize(entries: readonly ResizeObserverEntry[]): void {
    const entry = entries[0]
    if (!entry) return
    // `contentRect` ya viene calculado por el navegador: usarlo en lugar de
    // releer `clientWidth` evita forzar un layout sincrónico justo después de
    // que el layout acaba de correr.
    live.viewportWidth = entry.contentRect.width
    live.viewportHeight = entry.contentRect.height
    requestFrame()
  }

  onMounted(() => {
    const element = options.viewport.value
    if (!element) return

    // `passive: true` le promete al navegador que el handler no va a llamar a
    // `preventDefault`, lo que le permite componer el scroll sin esperar a que
    // termine el JS. Sin esto, el scroll queda bloqueado por el handler.
    element.addEventListener('scroll', handleScroll, { passive: true })

    observedViewport = element
    resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(element)

    measure()
    requestFrame()
  })

  onBeforeUnmount(() => {
    if (frameHandle !== 0) {
      cancelAnimationFrame(frameHandle)
      frameHandle = 0
    }
    if (observedViewport) {
      observedViewport.removeEventListener('scroll', handleScroll)
      observedViewport = null
    }
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
  })

  return { live, state, requestFrame, scrollTo, measure }
}
