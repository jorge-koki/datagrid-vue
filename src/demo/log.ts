import { shallowRef } from 'vue'
import type { ShallowRef } from 'vue'

/**
 * Bitácora acotada de eventos, para que el ciclo de vida de la edición sea
 * observable en pantalla.
 *
 * Se guarda en un `shallowRef` reemplazando el array completo en vez de mutarlo:
 * la lista se renderiza con Vue y un reemplazo es una sola invalidación.
 */

/** Etapa del ciclo de edición o de selección que produjo la entrada. */
export type DemoLogKind = 'select' | 'before' | 'veto' | 'commit' | 'after' | 'cancel' | 'info'

/** Una línea de la bitácora. */
export type DemoLogEntry = {
  /** Identificador incremental. Es la clave del `v-for`. */
  id: number
  /** Etapa, usada para colorear la píldora. */
  kind: DemoLogKind
  /** Texto ya formateado. */
  message: string
  /** Hora local en formato `HH:MM:SS`. */
  time: string
}

/** Cuántas entradas se conservan. Más que esto y la lista deja de ser legible. */
const MAX_ENTRIES = 12

export type DemoLog = {
  /** Entradas, de la más reciente a la más antigua. */
  entries: Readonly<ShallowRef<readonly DemoLogEntry[]>>
  /** Agrega una entrada y descarta la más vieja si se pasó del límite. */
  push(kind: DemoLogKind, message: string): void
  /** Vacía la bitácora. */
  clear(): void
}

export function useDemoLog(): DemoLog {
  const entries = shallowRef<readonly DemoLogEntry[]>([])
  let nextId = 0

  function push(kind: DemoLogKind, message: string): void {
    nextId += 1
    const entry: DemoLogEntry = {
      id: nextId,
      kind,
      message,
      time: new Date().toLocaleTimeString(),
    }
    entries.value = [entry, ...entries.value].slice(0, MAX_ENTRIES)
  }

  function clear(): void {
    entries.value = []
  }

  return { entries, push, clear }
}
