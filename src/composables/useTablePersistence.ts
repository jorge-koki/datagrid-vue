import { computed, onBeforeUnmount, onMounted, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type {
  DataTableColumn,
  DataTablePersistOptions,
  DataTableStorageAdapter,
  PersistedTableState,
} from '../types'
import { isPersistedTableState, reconcilePersistedState } from '../internal/reconcile'
import {
  DEFAULT_PERSIST_DEBOUNCE,
  DEFAULT_PERSIST_VERSION,
  STORAGE_KEY_PREFIX,
} from '../internal/constants'

/**
 * Lee `localStorage` sin poder explotar.
 *
 * Hay dos escenarios donde el simple acceso a la variable lanza, no solo su uso:
 * el renderizado en servidor, donde no existe, y los modos privados o las
 * políticas de cookies que la declaran pero niegan el acceso. Por eso el
 * `typeof` y el `try` son ambos necesarios: uno cubre "no está", el otro cubre
 * "está pero tocarla tira".
 */
function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/**
 * Adaptador por defecto: guarda el layout en `localStorage`.
 *
 * Degrada a no-op en lugar de fallar. Que no se pueda guardar la preferencia de
 * un usuario es una molestia; que la tabla no renderice por eso es un bug.
 */
export function createLocalStorageAdapter(): DataTableStorageAdapter {
  return {
    load(key: string): PersistedTableState | null {
      const storage = getLocalStorage()
      if (!storage) return null
      try {
        const raw = storage.getItem(key)
        if (raw === null) return null
        // `JSON.parse` está tipado como `any`; se ancla a `unknown` para que el
        // contenido tenga que pasar sí o sí por la validación de forma.
        const parsed: unknown = JSON.parse(raw)
        return isPersistedTableState(parsed) ? parsed : null
      } catch {
        // JSON inválido o acceso denegado: se arranca de cero.
        return null
      }
    },

    save(key: string, state: PersistedTableState): void {
      const storage = getLocalStorage()
      if (!storage) return
      try {
        storage.setItem(key, JSON.stringify(state))
      } catch {
        // Cuota agotada o almacenamiento de solo lectura. No hay nada que hacer
        // ni nada que romper.
      }
    },

    remove(key: string): void {
      const storage = getLocalStorage()
      if (!storage) return
      try {
        storage.removeItem(key)
      } catch {
        // Igual que en `save`.
      }
    },
  }
}

/** Opciones de {@link useTablePersistence}. */
export interface UseTablePersistenceOptions<TRow> {
  /** Identificador único de esta tabla. Obligatorio para poder persistir. */
  tableId: MaybeRefOrGetter<string | undefined>
  /** Configuración de persistencia, tal como llega por props. */
  persist: MaybeRefOrGetter<boolean | DataTablePersistOptions | undefined>
  /** Columnas actuales, contra las que se reconcilia lo guardado. */
  columns: MaybeRefOrGetter<readonly DataTableColumn<TRow>[]>
  /** Estado vigente de la tabla, que se guardará cuando cambie. */
  state: MaybeRefOrGetter<PersistedTableState>
  /** Aplica al componente el estado ya reconciliado que se leyó del almacenamiento. */
  onLoad: (state: PersistedTableState) => void
}

/** Resultado de {@link useTablePersistence}. */
export interface UseTablePersistenceReturn {
  /** `true` cuando la persistencia está activa y correctamente configurada. */
  enabled: ComputedRef<boolean>
  /** Escribe de inmediato lo que esté pendiente por el debounce. */
  flush(): void
  /** Borra el estado guardado de esta tabla. */
  clear(): void
}

/** Opciones ya normalizadas a valores concretos. */
interface ResolvedPersistOptions {
  adapter: DataTableStorageAdapter
  debounce: number
  version: number
  includeVisibility: boolean
  includeWidths: boolean
  includeOrder: boolean
  includeGrouping: boolean
  includePinning: boolean
  includeSort: boolean
  storageKey: string
}

/**
 * Carga y guarda el layout de la tabla entre sesiones.
 *
 * ## El orden de las operaciones importa
 *
 * Primero se carga, después se empieza a guardar. Si el watcher de guardado
 * estuviera activo desde el montaje, el estado inicial por defecto se escribiría
 * antes de que llegue la respuesta del adaptador y pisaría la configuración real
 * del usuario. Por eso existe la bandera `ready`.
 *
 * ## Por qué el guardado va con debounce
 *
 * Arrastrar el borde de una columna emite un `pointermove` por frame. Serializar
 * y escribir en `localStorage` a 60Hz es una fuente real de jank, porque
 * `setItem` es sincrónico y bloquea el hilo principal. Se acumulan los cambios y
 * se escribe una sola vez cuando el usuario suelta. Lo pendiente se vuelca al
 * desmontar para que un cambio hecho justo antes de navegar no se pierda.
 */
export function useTablePersistence<TRow>(
  options: UseTablePersistenceOptions<TRow>,
): UseTablePersistenceReturn {
  /** Se apaga al desmontar para descartar respuestas asíncronas tardías. */
  let alive = true
  /** Solo en `true` después de cargar: antes, guardar pisaría lo guardado. */
  let ready = false
  /** Handle del timer de debounce. 0 significa que no hay escritura pendiente. */
  let timer = 0
  /** Garantiza que el aviso por `tableId` faltante se emita una sola vez. */
  let warnedMissingId = false

  const resolved = computed<ResolvedPersistOptions | null>(() => {
    const persist = toValue(options.persist)
    if (!persist) return null

    const config: DataTablePersistOptions = typeof persist === 'object' ? persist : {}
    if (config.enabled === false) return null

    const tableId = toValue(options.tableId)
    // Sin id no se puede persistir: dos tablas compartirían la misma clave.
    if (!tableId) return null

    const include = config.include
    return {
      adapter: config.adapter ?? createLocalStorageAdapter(),
      debounce: config.debounce ?? DEFAULT_PERSIST_DEBOUNCE,
      version: config.version ?? DEFAULT_PERSIST_VERSION,
      includeVisibility: include?.visibility ?? true,
      includeWidths: include?.widths ?? true,
      includeOrder: include?.order ?? true,
      includeGrouping: include?.grouping ?? true,
      includePinning: include?.pinning ?? true,
      includeSort: include?.sort ?? true,
      storageKey: `${STORAGE_KEY_PREFIX}${tableId}`,
    }
  })

  const enabled = computed(() => resolved.value !== null)

  /**
   * Avisa una única vez que falta `tableId`.
   *
   * No se lanza una excepción: una preferencia de layout que no se guarda no
   * justifica tumbar la aplicación. Pero sí hay que decirlo fuerte, porque el
   * síntoma sin el aviso —dos tablas pisándose la configuración— es de los más
   * confusos de diagnosticar.
   */
  function warnMissingTableId(): void {
    if (warnedMissingId) return
    warnedMissingId = true
    console.warn(
      '[DataTable] `persist` está activo pero no se pasó `tableId`. ' +
        'Sin un id, dos tablas de la misma aplicación compartirían la clave de ' +
        'almacenamiento y se sobrescribirían la configuración entre sí. ' +
        'La persistencia queda desactivada para esta tabla.',
    )
  }

  watch(
    [() => toValue(options.persist), () => toValue(options.tableId)],
    ([persist, tableId]) => {
      if (persist && !tableId) warnMissingTableId()
    },
    { immediate: true },
  )

  /**
   * Arma el payload a guardar, respetando `include`.
   *
   * El corte de agrupación se comporta distinto de los otros tres: en vez de
   * escribirse vacío cuando está apagado, directamente NO aparece. Es lo que hace
   * que una tabla que no agrupa produzca exactamente el mismo payload que antes
   * de que la función existiera, sin ensuciar el almacenamiento con dos arrays
   * vacíos y sin obligar a subir la versión del esquema.
   */
  function buildPayload(config: ResolvedPersistOptions): PersistedTableState {
    const current = toValue(options.state)
    const payload: PersistedTableState = {
      version: config.version,
      // Se copian los objetos: lo que va al almacenamiento no debe ser una
      // referencia viva al estado del componente.
      columnVisibility: config.includeVisibility ? { ...current.columnVisibility } : {},
      columnWidths: config.includeWidths ? { ...current.columnWidths } : {},
      columnOrder: config.includeOrder ? [...current.columnOrder] : [],
    }

    if (config.includeGrouping && current.groupBy !== undefined) {
      payload.groupBy = [...current.groupBy]
      payload.collapsedGroups = [...(current.collapsedGroups ?? [])]
    }

    // Igual que la agrupación: la clave solo viaja si el estado la trae, y el
    // estado solo la trae si el usuario tocó algún ancla.
    if (config.includePinning && current.columnPinning !== undefined) {
      payload.columnPinning = { ...current.columnPinning }
    }

    if (config.includeSort && current.sort !== undefined) {
      payload.sort = current.sort.map((entry) => ({ ...entry }))
    }

    return payload
  }

  function cancelPending(): void {
    if (timer === 0) return
    clearTimeout(timer)
    timer = 0
  }

  /**
   * Ejecuta una escritura del adaptador sin dejar que una falla suya escape.
   *
   * El contrato de {@link DataTableStorageAdapter} dice que un adaptador absorbe
   * sus propias fallas, así que uno que las propaga está violando su lado del
   * trato. Igual se defiende, por dónde caería el error: `writeNow` corre dentro
   * del callback del timer del debounce, y una excepción ahí no tiene a nadie
   * arriba que la pueda atrapar. No sube por la pila de quien redimensionó la
   * columna, no la ve un `try` del consumidor y no la ve un error boundary:
   * termina como un error global. Que no se pueda guardar una preferencia de
   * layout es una molestia; que se lleve puesta la aplicación es un bug nuestro,
   * no del adaptador.
   *
   * Se cubren los dos modos de falla, igual que en la carga: el `try` para el
   * adaptador que lanza de forma sincrónica y el `catch` de la promesa para el
   * que rechaza. Descartar la promesa con `void` dejaba el rechazo sin manejar,
   * que es la misma clase de error global por otro camino.
   *
   * Se falla en silencio, como en `load` y como en el adaptador de
   * `localStorage`: no hay nada que hacer ni nada que romper, y el lugar para
   * reportar el problema es el adaptador, que es quien sabe por qué falló.
   */
  function runAdapterWrite(write: () => void | Promise<void>): void {
    let result: void | Promise<void>
    try {
      result = write()
    } catch {
      return
    }
    if (result instanceof Promise) result.catch(() => {})
  }

  function writeNow(): void {
    const config = resolved.value
    if (!config) return
    runAdapterWrite(() => config.adapter.save(config.storageKey, buildPayload(config)))
  }

  function schedule(): void {
    const config = resolved.value
    if (!config) return

    cancelPending()
    if (config.debounce <= 0) {
      writeNow()
      return
    }
    // `setTimeout` en el navegador devuelve un número; el tipo del entorno DOM
    // es el que corresponde aquí y evita depender de los tipos de Node.
    timer = setTimeout(() => {
      timer = 0
      writeNow()
    }, config.debounce)
  }

  function flush(): void {
    if (timer === 0) return
    cancelPending()
    writeNow()
  }

  function clear(): void {
    const config = resolved.value
    if (!config) return
    cancelPending()
    // Misma defensa que en `writeNow`: `remove` es la otra escritura del
    // adaptador y tenía el mismo `void` que descartaba un rechazo sin manejar.
    // Aquí el error sí subiría por la pila de quien llamó a `resetLayout()`, que
    // es menos grave que salir por un timer, pero tumbar la aplicación por no
    // poder borrar una preferencia sigue siendo desproporcionado.
    runAdapterWrite(() => config.adapter.remove(config.storageKey))
  }

  /** Aplica lo cargado si sigue siendo pertinente, y habilita el guardado. */
  function applyLoaded(loaded: PersistedTableState | null, config: ResolvedPersistOptions): void {
    // El componente pudo desmontarse mientras el adaptador resolvía. Aplicar aquí
    // escribiría sobre un componente que ya no existe.
    if (!alive) return

    if (loaded && loaded.version === config.version) {
      const columns = toValue(options.columns)
      const reconciled = reconcilePersistedState(loaded, columns)
      const applied: PersistedTableState = {
        version: config.version,
        columnVisibility: config.includeVisibility ? reconciled.columnVisibility : {},
        columnWidths: config.includeWidths ? reconciled.columnWidths : {},
        columnOrder: config.includeOrder ? reconciled.columnOrder : [],
      }
      // Las claves de agrupación siguen siendo opcionales también aquí: ausentes
      // significan "no había nada que restaurar", y el componente distingue eso
      // de "había, y era vacío".
      if (config.includeGrouping && reconciled.groupBy !== undefined) {
        applied.groupBy = reconciled.groupBy
        applied.collapsedGroups = reconciled.collapsedGroups ?? []
      }
      if (config.includePinning && reconciled.columnPinning !== undefined) {
        applied.columnPinning = reconciled.columnPinning
      }
      if (config.includeSort && reconciled.sort !== undefined) {
        applied.sort = reconciled.sort
      }
      options.onLoad(applied)
    }

    // Se marca listo incluso cuando no había nada o la versión no coincidía: a
    // partir de aquí los cambios del usuario sí deben guardarse.
    ready = true
  }

  onMounted(() => {
    const config = resolved.value
    if (!config) {
      // Sin persistencia no hay carga, pero tampoco hay razón para bloquear nada.
      ready = true
      return
    }

    let result: PersistedTableState | null | Promise<PersistedTableState | null>
    try {
      result = config.adapter.load(config.storageKey)
    } catch {
      // Un adaptador de terceros puede lanzar de forma sincrónica.
      ready = true
      return
    }

    if (result instanceof Promise) {
      result
        .then((loaded) => applyLoaded(loaded, config))
        .catch(() => {
          // Una carga fallida no debe dejar la tabla sin poder guardar después.
          if (alive) ready = true
        })
      return
    }

    applyLoaded(result, config)
  })

  watch(
    () => toValue(options.state),
    () => {
      if (!ready) return
      schedule()
    },
  )

  onBeforeUnmount(() => {
    alive = false
    // Se vuelca antes de apagar: un cambio hecho dentro de la ventana del
    // debounce justo antes de navegar se perdería.
    flush()
    cancelPending()
  })

  return { enabled, flush, clear }
}
