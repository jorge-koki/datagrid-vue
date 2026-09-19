/**
 * Presets de agrupación de la demo.
 *
 * La tabla habla de claves de columna —`groupBy` es un `readonly string[]`— y el
 * `<select>` de la barra habla de una opción por vez. Este módulo es la
 * traducción entre las dos formas, y vive aquí y no en `App.vue` porque hace
 * falta en las DOS direcciones:
 *
 * 1. Al elegir una opción, para escribir `groupBy`.
 * 2. Al montar, para que el desplegable muestre la agrupación que la
 *    persistencia acaba de restaurar desde `localStorage`. Sin esta vuelta, la
 *    tabla arrancaría agrupada y el control diría "Sin agrupar".
 */

/** Identificador de un preset. Es el `value` del `<option>`. */
export type GroupingPresetId = 'none' | 'status' | 'priority' | 'status-priority'

/** Una opción del selector de agrupación. */
export interface GroupingPreset {
  /** Identificador estable, independiente de la etiqueta mostrada. */
  id: GroupingPresetId
  /** Texto del `<option>`. */
  label: string
  /** Claves de columna, en orden de anidamiento. */
  groupBy: readonly string[]
}

/**
 * Los presets ofrecidos, en orden de aparición.
 *
 * El último tiene dos niveles a propósito: es donde se ve que un grupo padre
 * agrega sobre TODAS sus filas descendientes y no sobre los agregados ya
 * cerrados de sus hijos. Con `avg` en la columna de progreso, las dos cuentas
 * dan números distintos.
 */
export const GROUPING_PRESETS: readonly GroupingPreset[] = [
  { id: 'none', label: 'Sin agrupar', groupBy: [] },
  { id: 'status', label: 'Por estado', groupBy: ['status'] },
  { id: 'priority', label: 'Por prioridad', groupBy: ['priority'] },
  { id: 'status-priority', label: 'Por estado y prioridad', groupBy: ['status', 'priority'] },
]

/** Claves de agrupación de un preset. Devuelve una lista vacía si el id no existe. */
export function groupByOf(id: GroupingPresetId): readonly string[] {
  return GROUPING_PRESETS.find((preset) => preset.id === id)?.groupBy ?? []
}

/**
 * Preset que corresponde a una lista de claves de agrupación.
 *
 * Compara la lista completa y en orden: `['status', 'priority']` y
 * `['priority', 'status']` son agrupaciones distintas y no pueden resolver al
 * mismo preset. Una lista que no coincide con ninguno cae en `'none'`, que es la
 * degradación correcta para un `groupBy` restaurado de una versión anterior de
 * la demo con otras columnas.
 */
export function presetIdOf(groupBy: readonly string[]): GroupingPresetId {
  const match = GROUPING_PRESETS.find(
    (preset) =>
      preset.groupBy.length === groupBy.length &&
      preset.groupBy.every((key, level) => key === groupBy[level]),
  )
  return match?.id ?? 'none'
}
