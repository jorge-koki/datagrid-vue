/**
 * Persistencia del layout entre sesiones.
 *
 * Dos cosas se verifican acá y ninguna es el camino feliz.
 *
 * La primera es el ORDEN: primero se carga, después se empieza a guardar. Si el
 * watcher de guardado estuviera vivo desde el montaje, el estado inicial por
 * defecto se escribiría antes de que el adaptador conteste y pisaría la
 * configuración real del usuario. El síntoma sería "la tabla se olvida de mis
 * columnas", intermitente y dependiente de la latencia del adaptador.
 *
 * La segunda es la DEGRADACIÓN: que no se pueda guardar una preferencia es una
 * molestia; que la tabla no renderice por eso es un bug. SSR, modo privado,
 * cuota agotada y adaptadores de terceros que lanzan tienen que terminar en un
 * no-op, nunca en una excepción que suba.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import { createLocalStorageAdapter, useTablePersistence } from '../composables/useTablePersistence'
import type { UseTablePersistenceReturn } from '../composables/useTablePersistence'
import { STORAGE_KEY_PREFIX } from '../internal/constants'
import type {
  DataTableColumn,
  DataTablePersistOptions,
  DataTableStorageAdapter,
  PersistedTableState,
} from '../types'

type Row = { a: string; b: string }

const COLUMNS: readonly DataTableColumn<Row>[] = [{ key: 'a' }, { key: 'b' }]

/** Estado inicial neutro. Cada test lo reemplaza para disparar un guardado. */
function emptyState(): PersistedTableState {
  return { version: 1, columnVisibility: {}, columnWidths: {}, columnOrder: ['a', 'b'] }
}

/** Adaptador espía con las tres operaciones registradas. */
function createSpyAdapter(load: DataTableStorageAdapter['load'] = () => null) {
  const save = vi.fn()
  const remove = vi.fn()
  return {
    adapter: { load, save, remove } satisfies DataTableStorageAdapter,
    save,
    remove,
  }
}

interface Harness {
  persistence: UseTablePersistenceReturn
  state: ReturnType<typeof shallowRef<PersistedTableState>>
  loaded: PersistedTableState[]
  unmount: () => void
}

/**
 * Monta un componente mínimo que ejecuta el composable.
 *
 * `useTablePersistence` registra `onMounted` y `onBeforeUnmount`: sin una
 * instancia viva nunca cargaría ni volcaría lo pendiente, que es justo lo que
 * hay que verificar.
 */
function mountPersistence(options: {
  persist: boolean | DataTablePersistOptions
  tableId?: string
}): Harness {
  const state = shallowRef<PersistedTableState>(emptyState())
  const loaded: PersistedTableState[] = []
  const holder: { value: UseTablePersistenceReturn | null } = { value: null }

  const wrapper = mount(
    defineComponent({
      setup() {
        holder.value = useTablePersistence<Row>({
          tableId: () => options.tableId,
          persist: () => options.persist,
          columns: () => COLUMNS,
          state,
          onLoad: (next) => loaded.push(next),
        })
        return () => null
      },
    }),
  )

  const persistence = holder.value
  if (!persistence) throw new Error('[test] el composable no se inicializó')

  return { persistence, state, loaded, unmount: () => wrapper.unmount() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('useTablePersistence — load happens before the first save', () => {
  it('applies the reconciled state the adapter returned', () => {
    const saved: PersistedTableState = {
      version: 1,
      columnVisibility: { a: false },
      columnWidths: { a: 5 },
      columnOrder: ['ghost', 'b'],
    }
    const { adapter } = createSpyAdapter(() => saved)
    const harness = mountPersistence({ tableId: 't', persist: { adapter } })

    expect(harness.loaded).toHaveLength(1)
    // Reconciliado, no aplicado tal cual: el ancho se acota y la clave fantasma
    // desaparece.
    expect(harness.loaded[0]?.columnOrder).toEqual(['b', 'a'])
    expect(harness.loaded[0]?.columnWidths).toEqual({ a: 32 })
    harness.unmount()
  })

  it('ignores a saved state whose schema version does not match', () => {
    const saved: PersistedTableState = {
      version: 1,
      columnVisibility: {},
      columnWidths: {},
      columnOrder: [],
    }
    const { adapter } = createSpyAdapter(() => saved)
    const harness = mountPersistence({ tableId: 't', persist: { adapter, version: 2 } })

    expect(harness.loaded).toHaveLength(0)
    harness.unmount()
  })

  it('does not save a state change that happens before an async load resolves', async () => {
    let resolveLoad: (value: PersistedTableState | null) => void = () => {}
    const pending = new Promise<PersistedTableState | null>((resolve) => {
      resolveLoad = resolve
    })
    const { adapter, save } = createSpyAdapter(() => pending)
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 0 } })

    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await vi.advanceTimersByTimeAsync(0)

    // El guardado todavía está bloqueado: escribir ahora pisaría lo que el
    // adaptador está por devolver.
    expect(save).not.toHaveBeenCalled()

    resolveLoad(null)
    await vi.advanceTimersByTimeAsync(0)

    harness.state.value = { ...emptyState(), columnWidths: { a: 300 } }
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(1)
    harness.unmount()
  })

  it('re-enables saving even when the async load rejects', async () => {
    const { adapter, save } = createSpyAdapter(() => Promise.reject(new Error('offline')))
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 0 } })

    await vi.advanceTimersByTimeAsync(0)
    harness.state.value = { ...emptyState(), columnWidths: { a: 300 } }
    await vi.advanceTimersByTimeAsync(0)

    // Una carga fallida no debe dejar la tabla sin poder guardar nunca más.
    expect(save).toHaveBeenCalledTimes(1)
    harness.unmount()
  })

  it('re-enables saving when a third-party adapter throws synchronously on load', async () => {
    const save = vi.fn()
    const adapter: DataTableStorageAdapter = {
      load: () => {
        throw new Error('boom')
      },
      save,
      remove: vi.fn(),
    }
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 0 } })

    harness.state.value = { ...emptyState(), columnWidths: { a: 300 } }
    await nextTick()
    expect(save).toHaveBeenCalledTimes(1)
    harness.unmount()
  })
})

describe('useTablePersistence — debounce', () => {
  it('collapses a burst of updates into a single write', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 300 } })

    // Simula un arrastre de redimensionado: un cambio por frame.
    for (let width = 100; width < 110; width += 1) {
      harness.state.value = { ...emptyState(), columnWidths: { a: width } }
      await nextTick()
    }
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[1]).toMatchObject({ columnWidths: { a: 109 } })
    harness.unmount()
  })

  it('writes synchronously when the debounce is zero', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 0 } })

    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await nextTick()

    expect(save).toHaveBeenCalledTimes(1)
    harness.unmount()
  })

  it('flush() writes the pending state immediately', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 300 } })

    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await nextTick()
    harness.persistence.flush()

    expect(save).toHaveBeenCalledTimes(1)
    // Y el timer quedó cancelado: avanzar el reloj no produce una segunda
    // escritura con el mismo contenido.
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1)
    harness.unmount()
  })

  it('flush() does nothing when there is no pending write', () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 300 } })

    harness.persistence.flush()

    expect(save).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('unmount flushes a write still inside the debounce window', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 300 } })

    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await nextTick()
    vi.advanceTimersByTime(100)
    harness.unmount()

    // Un cambio hecho justo antes de navegar no se pierde.
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('ignores an async load that resolves after unmount', async () => {
    let resolveLoad: (value: PersistedTableState | null) => void = () => {}
    const pending = new Promise<PersistedTableState | null>((resolve) => {
      resolveLoad = resolve
    })
    const { adapter } = createSpyAdapter(() => pending)
    const harness = mountPersistence({ tableId: 't', persist: { adapter } })

    harness.unmount()
    resolveLoad({ version: 1, columnVisibility: { a: false }, columnWidths: {}, columnOrder: [] })
    await vi.advanceTimersByTimeAsync(0)

    // Aplicar acá escribiría sobre un componente que ya no existe.
    expect(harness.loaded).toHaveLength(0)
  })
})

describe('useTablePersistence — a failing adapter does not disable saving forever', () => {
  it('keeps attempting to save after the adapter throws once', async () => {
    let calls = 0
    const save = vi.fn(() => {
      calls += 1
      if (calls === 1) throw new Error('quota exceeded')
    })
    const adapter: DataTableStorageAdapter = { load: () => null, save, remove: vi.fn() }
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 300 } })

    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await nextTick()
    // El contrato del adaptador es absorber sus fallas; uno que las propaga hace
    // que el error salga por el timer. Lo que importa es lo que pasa después.
    expect(() => vi.advanceTimersByTime(300)).toThrow('quota exceeded')

    harness.state.value = { ...emptyState(), columnWidths: { a: 300 } }
    await nextTick()
    vi.advanceTimersByTime(300)

    expect(save).toHaveBeenCalledTimes(2)
    harness.unmount()
  })
})

describe('useTablePersistence — configuration', () => {
  it('reports disabled when persist is false', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: false })

    expect(harness.persistence.enabled.value).toBe(false)
    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()
    void adapter
    harness.unmount()
  })

  it('reports disabled when enabled is explicitly false', () => {
    const { adapter } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: { adapter, enabled: false } })

    expect(harness.persistence.enabled.value).toBe(false)
    harness.unmount()
  })

  it('disables persistence and warns exactly once when tableId is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ persist: { adapter, debounce: 0 } })

    expect(harness.persistence.enabled.value).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('tableId')

    // Varios cambios de estado después: sigue siendo un único aviso, porque el
    // ruido repetido en consola es lo que hace que se deje de leer.
    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await nextTick()
    harness.state.value = { ...emptyState(), columnWidths: { a: 300 } }
    await nextTick()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('honours include by writing only the selected slices', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({
      tableId: 't',
      persist: { adapter, debounce: 0, include: { widths: true, visibility: false, order: false } },
    })

    harness.state.value = {
      version: 1,
      columnVisibility: { a: false },
      columnWidths: { a: 200 },
      columnOrder: ['b', 'a'],
    }
    await nextTick()

    expect(save.mock.calls[0]?.[1]).toEqual({
      version: 1,
      columnVisibility: {},
      columnWidths: { a: 200 },
      columnOrder: [],
    })
    harness.unmount()
  })

  it('copies the payload instead of handing the live component state to the adapter', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 0 } })

    const next: PersistedTableState = { ...emptyState(), columnWidths: { a: 200 } }
    harness.state.value = next
    await nextTick()

    const written = save.mock.calls[0]?.[1]
    expect(written).not.toBe(next)
    expect(written?.columnWidths).not.toBe(next.columnWidths)
    harness.unmount()
  })

  it('clear() removes the stored layout and cancels any pending write', async () => {
    const { adapter, save, remove } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 't', persist: { adapter, debounce: 300 } })

    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await nextTick()
    harness.persistence.clear()
    vi.advanceTimersByTime(1000)

    expect(remove).toHaveBeenCalledExactlyOnceWith(`${STORAGE_KEY_PREFIX}t`)
    expect(save).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('namespaces the storage key per table', async () => {
    const { adapter, save } = createSpyAdapter()
    const harness = mountPersistence({ tableId: 'invoices', persist: { adapter, debounce: 0 } })

    harness.state.value = { ...emptyState(), columnWidths: { a: 200 } }
    await nextTick()

    expect(save.mock.calls[0]?.[0]).toBe(`${STORAGE_KEY_PREFIX}invoices`)
    harness.unmount()
  })
})

describe('createLocalStorageAdapter — degrades instead of throwing', () => {
  it('round-trips a valid state', () => {
    const adapter = createLocalStorageAdapter()
    const state: PersistedTableState = {
      version: 1,
      columnVisibility: { a: true },
      columnWidths: { a: 120 },
      columnOrder: ['a'],
    }

    adapter.save('k', state)

    expect(adapter.load('k')).toEqual(state)
  })

  it('returns null for a key that was never written', () => {
    expect(createLocalStorageAdapter().load('missing')).toBeNull()
  })

  it('returns null for corrupted JSON instead of throwing', () => {
    localStorage.setItem('k', '{not json')

    expect(() => createLocalStorageAdapter().load('k')).not.toThrow()
    expect(createLocalStorageAdapter().load('k')).toBeNull()
  })

  it('returns null for JSON with the wrong shape', () => {
    localStorage.setItem('k', JSON.stringify({ version: 1, columnVisibility: 'nope' }))

    expect(createLocalStorageAdapter().load('k')).toBeNull()
  })

  it('removes a stored key', () => {
    const adapter = createLocalStorageAdapter()
    adapter.save('k', { version: 1, columnVisibility: {}, columnWidths: {}, columnOrder: [] })
    adapter.remove('k')

    expect(adapter.load('k')).toBeNull()
  })

  it('no-ops when localStorage does not exist (server-side rendering)', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
    try {
      const adapter = createLocalStorageAdapter()

      expect(adapter.load('k')).toBeNull()
      expect(() => adapter.save('k', emptyState())).not.toThrow()
      expect(() => adapter.remove('k')).not.toThrow()
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })

  it('no-ops when touching localStorage throws (private mode, cookie policy)', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('access denied')
      },
    })
    try {
      const adapter = createLocalStorageAdapter()

      // El `typeof` cubre "no está"; el `try` cubre "está pero tocarla lanza".
      // Hacen falta los dos y este test es el que lo demuestra.
      expect(adapter.load('k')).toBeNull()
      expect(() => adapter.save('k', emptyState())).not.toThrow()
      expect(() => adapter.remove('k')).not.toThrow()
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })

  it('no-ops when setItem throws because the quota is exhausted', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      expect(() => createLocalStorageAdapter().save('k', emptyState())).not.toThrow()
      expect(setItem).toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
    }
  })
})
