/**
 * Contador de escrituras al DOM.
 *
 * ## Por qué existe este archivo
 *
 * Toda la propuesta de valor de esta librería es una afirmación de rendimiento:
 * las celdas reciclan nodos y un repintado con entradas idénticas no produce
 * NINGUNA escritura al DOM. Lo peligroso de esa afirmación es su modo de falla.
 * Si alguien rompe el caché de pintado, nada lanza una excepción: la tabla
 * sigue renderizando, se sigue viendo igual, y solo scrollea mal. Una suite que
 * verifique únicamente corrección atraviesa esa regresión en verde.
 *
 * Por eso este módulo es la pieza que sostiene la suite. Parchea los puntos por
 * los que el componente puede tocar el DOM, cuenta cada paso y guarda un
 * registro de qué se escribió, para que un fallo diga *qué* se escribió de más y
 * no solamente que un número no coincide.
 *
 * ## Qué se considera una escritura
 *
 * | Bucket       | Qué intercepta                                              |
 * | ------------ | ----------------------------------------------------------- |
 * | `textContent`| Asignación de `textContent` sobre cualquier elemento         |
 * | `style`      | `style.<prop> = x`, `setProperty`, `removeProperty`          |
 * | `attribute`  | `setAttribute` / `removeAttribute`                           |
 * | `classList`  | `classList.add` / `remove` / `toggle`                        |
 * | `hidden`     | Asignación de `hidden`                                       |
 * | `checked`    | Asignación de `checked`, `indeterminate` o `disabled`        |
 * | `src`        | Asignación de `src` o `alt` sobre una imagen                 |
 * | `createNode` | `document.createElement` / `createElementNS`                 |
 * | `insertNode` | `appendChild` / `insertBefore` / `replaceChild`              |
 * | `removeNode` | `removeChild` / `Element.remove()`                           |
 *
 * `indeterminate` y `disabled` se agrupan con `checked` porque son el mismo tipo
 * de escritura —estado de un control de formulario— y separarlos solo agregaría
 * buckets que ningún test consulta por separado. Lo mismo vale para `alt` dentro
 * de `src`.
 *
 * ## Se cuentan llamadas, no cambios efectivos
 *
 * `classList.toggle('x', false)` sobre un nodo que no tiene la clase no cambia
 * nada, pero igual se cuenta. Es deliberado: el contrato del componente
 * (`internal/dom.ts`) es *no llamar* cuando el valor no cambió, no "llamar y que
 * el DOM decida". Contar llamadas verifica el contrato real; contar cambios
 * efectivos dejaría pasar una regresión que llame 450 veces por frame.
 *
 * ## Se cuenta solo dentro de un subárbol
 *
 * Las escrituras se atribuyen únicamente si el nodo afectado está dentro del
 * `root` que se pasó al empezar a grabar. En los tests de componente eso deja
 * fuera lo que escribe Vue en el header y permite medir exclusivamente el pool.
 * La única excepción es `createNode`: un nodo recién creado todavía no está en
 * ningún árbol, así que se cuentan todas las creaciones mientras se graba.
 */

/** Cantidad de escrituras por categoría. */
export interface DomWriteCounts {
  textContent: number
  style: number
  attribute: number
  classList: number
  hidden: number
  checked: number
  src: number
  createNode: number
  insertNode: number
  removeNode: number
  /** Suma de todas las categorías. */
  total: number
}

/** Nombre de una categoría de escritura. */
export type DomWriteBucket = Exclude<keyof DomWriteCounts, 'total'>

/** Una escritura individual, tal como quedó registrada. */
export interface DomWriteEntry {
  bucket: DomWriteBucket
  detail: string
}

/** Grabadora activa. Se cierra con {@link DomWriteRecorder.stop}. */
export interface DomWriteRecorder {
  /** Conteos acumulados desde el último `reset`. */
  counts(): DomWriteCounts
  /** Escrituras individuales registradas, en orden. */
  entries(): readonly DomWriteEntry[]
  /**
   * Texto legible con el detalle de lo escrito.
   *
   * Se pasa como segundo argumento de `expect` para que un fallo muestre qué se
   * escribió. Un test de rendimiento que solo dice "esperaba 0, recibí 7" obliga
   * al próximo desarrollador a reinstrumentar todo a mano.
   */
  report(): string
  /** Pone los contadores en cero sin desinstalar los parches. */
  reset(): void
  /** Restaura los prototipos originales. Idempotente. */
  stop(): void
}

const BUCKETS: readonly DomWriteBucket[] = [
  'textContent',
  'style',
  'attribute',
  'classList',
  'hidden',
  'checked',
  'src',
  'createNode',
  'insertNode',
  'removeNode',
]

/** Impide dos grabadoras simultáneas: los parches se pisarían entre sí. */
let active = false

/** Ubica el objeto del prototipo que realmente define una propiedad. */
function locate(start: object, key: string): { owner: object; descriptor: PropertyDescriptor } {
  let current: object | null = start
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor) return { owner: current, descriptor }
    current = Object.getPrototypeOf(current) as object | null
  }
  throw new Error(`[dom-recorder] no se encontró la propiedad "${key}" en la cadena de prototipos`)
}

/** Descripción corta de un nodo, suficiente para identificarlo en el reporte. */
function describe(node: unknown): string {
  if (!(node instanceof Element)) return String(node)
  const className = node.getAttribute('class')
  const rowKey = node instanceof HTMLElement ? node.dataset.rowKey : undefined
  return `<${node.tagName.toLowerCase()}${className ? `.${className.split(/\s+/).join('.')}` : ''}${
    rowKey === undefined ? '' : `[row=${rowKey}]`
  }>`
}

/** Recorta un valor largo para que el reporte siga siendo legible. */
function short(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value)
  return text.length > 40 ? `${text.slice(0, 37)}...` : text
}

/**
 * Empieza a contar escrituras dentro de `root`.
 *
 * @param root - Subárbol que se observa. Las escrituras fuera de él se ignoran.
 */
export function recordDomWrites(root: Element): DomWriteRecorder {
  if (active) {
    throw new Error(
      '[dom-recorder] ya hay una grabadora activa; llamá a stop() antes de abrir otra',
    )
  }
  active = true

  const counts: Record<DomWriteBucket, number> = {
    textContent: 0,
    style: 0,
    attribute: 0,
    classList: 0,
    hidden: 0,
    checked: 0,
    src: 0,
    createNode: 0,
    insertNode: 0,
    removeNode: 0,
  }
  const log: DomWriteEntry[] = []
  const restores: (() => void)[] = []

  /**
   * Profundidad de anidamiento dentro de una operación ya contabilizada.
   *
   * `happy-dom` implementa unas primitivas del DOM en términos de otras:
   * asignar `textContent` hace por dentro `removeChild` + `appendChild` de un
   * nodo de texto, `classList.toggle` reescribe el atributo `class`, y
   * `style.transform = x` reescribe el atributo `style`. Contar esas llamadas
   * internas mediría el motor del entorno de test y no el componente, e
   * inflaría los números con eliminaciones de nodo que en un navegador real no
   * existen.
   *
   * Solo se registra la operación MÁS EXTERNA: la que efectivamente inició el
   * código bajo prueba. Todo lo que ocurra por debajo es implementación del DOM.
   */
  let depth = 0

  /** `true` si el nodo cae dentro del subárbol observado. */
  function inScope(node: unknown): boolean {
    if (!(node instanceof Node)) return false
    return node === root || root.contains(node)
  }

  function record(bucket: DomWriteBucket, detail: string): void {
    counts[bucket] += 1
    log.push({ bucket, detail })
  }

  /**
   * Contabiliza una escritura y ejecuta la operación real marcando el
   * anidamiento, para que las llamadas internas del entorno no se cuenten.
   */
  function track<T>(
    shouldRecord: boolean,
    bucket: DomWriteBucket,
    detail: () => string,
    call: () => T,
  ): T {
    if (depth === 0 && shouldRecord) record(bucket, detail())
    depth += 1
    try {
      return call()
    } finally {
      depth -= 1
    }
  }

  /** Parchea un setter de propiedad (`textContent`, `hidden`, `checked`, ...). */
  function patchSetter(start: object, key: string, bucket: DomWriteBucket): void {
    const { owner, descriptor } = locate(start, key)
    const setter = descriptor.set
    if (!setter || descriptor.configurable !== true) {
      throw new Error(`[dom-recorder] "${key}" no es un accessor reconfigurable`)
    }

    Object.defineProperty(owner, key, {
      ...descriptor,
      set(this: unknown, value: unknown): void {
        const self: unknown = this
        track(
          inScope(self),
          bucket,
          () => `${describe(self)}.${key} = ${short(value)}`,
          () => {
            setter.call(self, value)
          },
        )
      },
    })
    restores.push(() => {
      Object.defineProperty(owner, key, descriptor)
    })
  }

  /** Parchea un método (`setAttribute`, `appendChild`, ...). */
  function patchMethod(
    start: object,
    key: string,
    shouldCount: (self: unknown, args: readonly unknown[]) => boolean,
    bucket: DomWriteBucket,
    detail: (self: unknown, args: readonly unknown[]) => string,
  ): void {
    const { owner, descriptor } = locate(start, key)
    const original = descriptor.value
    if (typeof original !== 'function' || descriptor.configurable !== true) {
      throw new Error(`[dom-recorder] "${key}" no es un método reconfigurable`)
    }

    Object.defineProperty(owner, key, {
      ...descriptor,
      value(this: unknown, ...args: readonly unknown[]): unknown {
        const self: unknown = this
        return track(
          shouldCount(self, args),
          bucket,
          () => detail(self, args),
          () => original.apply(self, args),
        )
      },
    })
    restores.push(() => {
      Object.defineProperty(owner, key, descriptor)
    })
  }

  /**
   * Parchea un getter que devuelve un objeto auxiliar (`style`, `classList`) para
   * que devuelva un proxy que contabiliza las mutaciones.
   *
   * Hace falta envolver el objeto y no sus métodos sueltos porque `style.width =
   * '10px'` es una asignación de propiedad, no una llamada, y porque un
   * `DOMTokenList` no expone el elemento al que pertenece: interceptando desde el
   * getter, el elemento queda capturado en el closure y la escritura se puede
   * atribuir al subárbol correcto.
   */
  function patchCompanionGetter(
    start: object,
    key: string,
    wrap: (real: object, element: Element) => object,
  ): void {
    const { owner, descriptor } = locate(start, key)
    const getter = descriptor.get
    if (!getter || descriptor.configurable !== true) {
      throw new Error(`[dom-recorder] "${key}" no es un accessor reconfigurable`)
    }

    const cache = new WeakMap<object, object>()
    Object.defineProperty(owner, key, {
      ...descriptor,
      get(this: unknown): unknown {
        const real: unknown = getter.call(this)
        if (typeof real !== 'object' || real === null || !(this instanceof Element)) return real
        const existing = cache.get(real)
        if (existing) return existing
        const proxy = wrap(real, this)
        cache.set(real, proxy)
        return proxy
      },
    })
    restores.push(() => {
      Object.defineProperty(owner, key, descriptor)
    })
  }

  // --- textContent, atributos y propiedades de estado -----------------------

  patchSetter(Element.prototype, 'textContent', 'textContent')
  patchSetter(HTMLElement.prototype, 'hidden', 'hidden')
  patchSetter(HTMLInputElement.prototype, 'checked', 'checked')
  patchSetter(HTMLInputElement.prototype, 'indeterminate', 'checked')
  patchSetter(HTMLInputElement.prototype, 'disabled', 'checked')
  patchSetter(HTMLImageElement.prototype, 'src', 'src')
  patchSetter(HTMLImageElement.prototype, 'alt', 'src')

  for (const method of ['setAttribute', 'removeAttribute'] as const) {
    patchMethod(
      Element.prototype,
      method,
      (self) => inScope(self),
      'attribute',
      (self, args) => `${describe(self)}.${method}(${short(args[0])}, ${short(args[1])})`,
    )
  }

  // --- style y classList ----------------------------------------------------

  patchCompanionGetter(HTMLElement.prototype, 'style', (real, element) => {
    return new Proxy(real, {
      get(target, property, _receiver) {
        const value: unknown = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        return (...args: readonly unknown[]): unknown =>
          track(
            (property === 'setProperty' || property === 'removeProperty') && inScope(element),
            'style',
            () => `${describe(element)}.style.${String(property)}(${short(args[0])})`,
            () => value.apply(target, args),
          )
      },
      set(target, property, value) {
        return track(
          inScope(element),
          'style',
          () => `${describe(element)}.style.${String(property)} = ${short(value)}`,
          () => Reflect.set(target, property, value, target),
        )
      },
    })
  })

  patchCompanionGetter(Element.prototype, 'classList', (real, element) => {
    return new Proxy(real, {
      get(target, property, _receiver) {
        const value: unknown = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        const mutating = property === 'add' || property === 'remove' || property === 'toggle'
        return (...args: readonly unknown[]): unknown =>
          track(
            mutating && inScope(element),
            'classList',
            () =>
              `${describe(element)}.classList.${String(property)}(${args.map(short).join(', ')})`,
            () => value.apply(target, args),
          )
      },
    })
  })

  // --- creación, inserción y eliminación de nodos ---------------------------

  for (const method of ['createElement', 'createElementNS'] as const) {
    patchMethod(
      document,
      method,
      () => true,
      'createNode',
      (_self, args) => `${method}(${args.map(short).join(', ')})`,
    )
  }

  for (const method of ['appendChild', 'insertBefore', 'replaceChild'] as const) {
    patchMethod(
      Node.prototype,
      method,
      (self) => inScope(self),
      'insertNode',
      (self, args) => `${describe(self)}.${method}(${describe(args[0])})`,
    )
  }

  patchMethod(
    Node.prototype,
    'removeChild',
    (self) => inScope(self),
    'removeNode',
    (self, args) => `${describe(self)}.removeChild(${describe(args[0])})`,
  )

  patchMethod(
    Element.prototype,
    'remove',
    (self) => inScope(self),
    'removeNode',
    (self) => `${describe(self)}.remove()`,
  )

  return {
    counts(): DomWriteCounts {
      let total = 0
      for (const bucket of BUCKETS) total += counts[bucket]
      return { ...counts, total }
    },

    entries(): readonly DomWriteEntry[] {
      return log
    },

    report(): string {
      if (log.length === 0) return 'sin escrituras al DOM'
      const lines = log.map((entry, index) => `  ${index + 1}. [${entry.bucket}] ${entry.detail}`)
      return `${log.length} escrituras al DOM:\n${lines.join('\n')}`
    },

    reset(): void {
      for (const bucket of BUCKETS) counts[bucket] = 0
      log.length = 0
    },

    stop(): void {
      if (!active) return
      // Se restaura en orden inverso al de instalación: `style` y `classList`
      // envuelven getters que otros parches podrían haber leído.
      for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
      restores.length = 0
      active = false
    },
  }
}

/** Resultado de {@link measureDomWrites}. */
export interface DomWriteMeasurement {
  counts: DomWriteCounts
  entries: readonly DomWriteEntry[]
  /** Detalle legible, pensado para pasarse como mensaje de `expect`. */
  report: string
}

/**
 * Corre `work` con la grabadora encendida y devuelve lo que se escribió.
 *
 * Garantiza el `stop()` incluso si `work` lanza: dejar los prototipos parcheados
 * rompería todos los tests posteriores del archivo con fallos que no tienen nada
 * que ver con la causa real.
 */
export function measureDomWrites(root: Element, work: () => void): DomWriteMeasurement {
  const recorder = recordDomWrites(root)
  try {
    work()
    return {
      counts: recorder.counts(),
      entries: [...recorder.entries()],
      report: recorder.report(),
    }
  } finally {
    recorder.stop()
  }
}

/** Cuenta las escrituras registradas cuyo detalle contiene `needle`. */
export function countMatching(entries: readonly DomWriteEntry[], needle: string): number {
  let total = 0
  for (const entry of entries) {
    if (entry.detail.includes(needle)) total += 1
  }
  return total
}
