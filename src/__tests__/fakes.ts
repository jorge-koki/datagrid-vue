/**
 * Dobles de prueba para las dos APIs de las que depende el camino caliente y que
 * `happy-dom` no provee de forma utilizable.
 *
 * ## Por qué se reemplaza `requestAnimationFrame`
 *
 * `happy-dom` sí define `requestAnimationFrame`, pero lo resuelve con un timer
 * real. Un test que espere a que ese timer dispare depende del planificador del
 * sistema operativo, y eso produce exactamente la clase de test intermitente que
 * el siguiente desarrollador termina borrando. Acá la cola de frames se vacía a
 * mano: `flushFrames()` ejecuta lo pendiente de forma sincrónica y el test sabe
 * con precisión cuántos frames ocurrieron.
 *
 * ## Por qué se reemplaza `ResizeObserver`
 *
 * El `ResizeObserver` de `happy-dom` existe pero nunca emite: sin layout real no
 * hay cambio de tamaño que observar. `useScrollSync` mide el viewport ahí, así
 * que sin un doble controlable la tabla se quedaría con un viewport de 0px y no
 * pintaría nada. {@link FakeResizeObserver.emit} es lo que le permite al test
 * decidir cuándo y con qué medidas "cambia de tamaño" el viewport.
 */

/** Callbacks de frame encolados, indexados por el handle que devolvió `rAF`. */
const frameQueue = new Map<number, FrameRequestCallback>()

/** Próximo handle a entregar. Arranca en 1: `useScrollSync` usa 0 como centinela. */
let nextFrameHandle = 1

/** Marca de tiempo simulada que reciben los callbacks, en ms. */
let frameTimestamp = 0

/**
 * Instala la cola de frames manual sobre los globales.
 *
 * Devuelve una función que restaura las implementaciones originales, para que un
 * test que necesite el comportamiento nativo pueda recuperarlo.
 */
export function installFakeRaf(): () => void {
  const originalRequest = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const handle = nextFrameHandle
    nextFrameHandle += 1
    frameQueue.set(handle, callback)
    return handle
  }

  globalThis.cancelAnimationFrame = (handle: number): void => {
    frameQueue.delete(handle)
  }

  return () => {
    globalThis.requestAnimationFrame = originalRequest
    globalThis.cancelAnimationFrame = originalCancel
    resetFrames()
  }
}

/** Vacía la cola y reinicia los contadores. Se llama entre tests. */
export function resetFrames(): void {
  frameQueue.clear()
  nextFrameHandle = 1
  frameTimestamp = 0
}

/** Cantidad de callbacks de frame pendientes de ejecución. */
export function pendingFrames(): number {
  return frameQueue.size
}

/**
 * Ejecuta los frames encolados.
 *
 * Se toma una foto de la cola antes de ejecutar: un callback puede volver a
 * pedir un frame —`useScrollSync` lo hace cuando el pintado dispara otro
 * cambio— y ejecutarlo dentro de la misma pasada convertiría esto en un bucle
 * potencialmente infinito. Cada llamada a `flushFrames` avanza exactamente
 * `passes` frames, ni uno más.
 *
 * @param passes - Cuántos frames consecutivos ejecutar. Por defecto 1.
 * @returns Cantidad total de callbacks ejecutados.
 */
export function flushFrames(passes = 1): number {
  let executed = 0
  for (let pass = 0; pass < passes; pass += 1) {
    const snapshot = [...frameQueue.values()]
    frameQueue.clear()
    frameTimestamp += 16
    for (const callback of snapshot) {
      callback(frameTimestamp)
      executed += 1
    }
  }
  return executed
}

/** Tamaño reportado por {@link FakeResizeObserver.emit}. */
export interface FakeSize {
  width: number
  height: number
}

/**
 * `ResizeObserver` gobernado por el test.
 *
 * Registra cada instancia creada para que un test pueda alcanzar el observer que
 * montó el componente sin que este tenga que exponerlo.
 */
export class FakeResizeObserver implements ResizeObserver {
  /** Todas las instancias creadas desde el último {@link FakeResizeObserver.reset}. */
  static instances: FakeResizeObserver[] = []

  /** Elementos actualmente observados por esta instancia. */
  readonly targets = new Set<Element>()

  /** `true` una vez que se llamó a `disconnect`. */
  disconnected = false

  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.add(target)
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
    this.disconnected = true
  }

  /**
   * Simula un cambio de tamaño sobre el primer elemento observado.
   *
   * Se arma una entrada completa —no solo `contentRect`— para que el doble
   * satisfaga el tipo `ResizeObserverEntry` sin aserciones: si mañana el
   * componente empieza a leer `contentBoxSize`, el test sigue siendo válido.
   */
  emit(size: FakeSize): void {
    const target = [...this.targets][0]
    if (!target) return

    const box: ResizeObserverSize = { blockSize: size.height, inlineSize: size.width }
    const rect: DOMRectReadOnly = {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      top: 0,
      right: size.width,
      bottom: size.height,
      left: 0,
      toJSON: () => ({ width: size.width, height: size.height }),
    }

    const entry: ResizeObserverEntry = {
      target,
      contentRect: rect,
      borderBoxSize: [box],
      contentBoxSize: [box],
      devicePixelContentBoxSize: [box],
    }

    this.callback([entry], this)
  }

  /** Olvida las instancias registradas. Se llama entre tests. */
  static reset(): void {
    FakeResizeObserver.instances = []
  }

  /** Última instancia creada, que es la del componente recién montado. */
  static latest(): FakeResizeObserver | null {
    return FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1] ?? null
  }
}

/** Instala el doble de `ResizeObserver`. Devuelve la función que restaura el original. */
export function installFakeResizeObserver(): () => void {
  const original = globalThis.ResizeObserver
  globalThis.ResizeObserver = FakeResizeObserver
  return () => {
    globalThis.ResizeObserver = original
    FakeResizeObserver.reset()
  }
}
