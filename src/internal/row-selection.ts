/**
 * El conjunto de filas marcadas, y por qué es un conjunto INVERTIBLE.
 *
 * ## El problema que resuelve la forma del estado
 *
 * Una lista de filas marcadas parece obvia hasta que la tabla tiene 9000 filas
 * y el usuario presiona la casilla del encabezado. Ahí hay dos caminos, y uno no
 * existe: enumerar 9000 claves —de las cuales la tabla solo conoce las 50 que
 * alcanzó a cargar del servidor—, o decir "todas" y llevar aparte las que el
 * usuario fue desmarcando.
 *
 * Por eso el estado tiene dos modos y una sola lista:
 *
 * - `'some'`: `keys` son las marcadas. Es el caso de siempre.
 * - `'all'`: `keys` son las EXCLUIDAS. Todo lo demás está marcado, incluso lo que
 *   todavía no se descargó.
 *
 * Una sola lista y no dos porque nunca hacen falta a la vez: en `'all'` no tiene
 * sentido una lista de incluidas, y en `'some'` no tiene sentido una de
 * excluidas. Dos campos obligarían a decidir qué pasa cuando los dos traen algo.
 *
 * ## Por qué claves y no índices
 *
 * Porque el índice no es identidad. Si el usuario filtra, la fila que estaba en
 * la posición 1 ya no es la misma; si quita el filtro, la selección que se
 * guardó por posición quedó apuntando a registros que nunca eligió. Con claves,
 * filtrar y desfiltrar no le hace nada al conjunto: las que vuelven a aparecer
 * vuelven marcadas, y las que no están simplemente no se ven.
 *
 * Esto vale para cualquier reordenamiento, no solo para un filtro: ordenar por
 * otra columna, agrupar, o que el servidor devuelva otra página.
 */

import type { RowKey, RowSelectionState } from '../types'

/** Nada marcado. Es el punto de partida y el destino de "limpiar". */
export const EMPTY_ROW_SELECTION: RowSelectionState = { mode: 'some', keys: [] }

/**
 * ¿Está marcada esta fila?
 *
 * En `'all'` la pregunta se invierte: lo está salvo que figure entre las
 * excluidas. Es la línea que hace que "todas" funcione sobre filas que la tabla
 * nunca vio.
 */
export function isRowSelected(state: RowSelectionState, key: RowKey): boolean {
  const listada = state.keys.includes(key)
  return state.mode === 'all' ? !listada : listada
}

/**
 * Cuántas filas hay marcadas, dado el total.
 *
 * El total hace falta solo en `'all'`, y es el del dataset COMPLETO —`rowCount`
 * en modo servidor—, no el de lo que está cargado. Si se pasara el de la ventana
 * visible, el contador diría "50 seleccionadas" sobre una tabla de 9000 donde el
 * usuario acaba de marcar todo.
 */
export function countSelectedRows(state: RowSelectionState, total: number): number {
  if (state.mode === 'some') return state.keys.length
  return Math.max(0, total - state.keys.length)
}

/** Alterna una fila, en el modo que sea. La lista significa lo que toque. */
export function toggleRowSelection(state: RowSelectionState, key: RowKey): RowSelectionState {
  const listada = state.keys.includes(key)
  const keys = listada ? state.keys.filter((otra) => otra !== key) : [...state.keys, key]
  return { mode: state.mode, keys }
}

/**
 * Marca o limpia TODO.
 *
 * Marcar todo entra en modo `'all'` con la lista vacía, que es lo que permite
 * responder por filas que no se descargaron. Limpiar vuelve a `'some'` vacío y
 * no a `'all'` con todo excluido: son el mismo conjunto, pero el segundo crece
 * con el dataset y el primero no.
 */
export function setAllRowsSelected(selected: boolean): RowSelectionState {
  return selected ? { mode: 'all', keys: [] } : EMPTY_ROW_SELECTION
}

/**
 * En qué estado va la casilla del encabezado: vacía, cuadrito o palomita.
 *
 * `total` es el del dataset completo, por lo mismo que en
 * {@link countSelectedRows}. Con `total` en 0 no hay nada que marcar y la
 * respuesta es `'none'` aunque el modo sea `'all'`: una tabla vacía con la
 * casilla en palomita se lee como un error.
 */
export function rowSelectionHeaderState(
  state: RowSelectionState,
  total: number,
): 'none' | 'some' | 'all' {
  if (total <= 0) return 'none'
  const marcadas = countSelectedRows(state, total)
  if (marcadas <= 0) return 'none'
  return marcadas >= total ? 'all' : 'some'
}

/**
 * El conjunto de claves listadas, para preguntar en el bucle de pintado.
 *
 * `Array.includes` es lineal, y el pintado pregunta una vez POR FILA VISIBLE: en
 * una selección de varios miles, eso es recorrer la lista treinta veces por
 * frame. El `Set` se arma una vez cuando la selección cambia y el frame solo
 * pregunta.
 *
 * Devuelve las claves LISTADAS y no las marcadas, a propósito: en modo `'all'`
 * las listadas son las excluidas, y un conjunto de "todas las marcadas" no se
 * puede construir sin enumerar un dataset que ni siquiera está cargado.
 */
export function listedKeySet(state: RowSelectionState): ReadonlySet<RowKey> {
  return new Set(state.keys)
}

/** Igual que {@link isRowSelected}, pero contra un `Set` ya armado. */
export function isRowSelectedIn(
  state: RowSelectionState,
  listadas: ReadonlySet<RowKey>,
  key: RowKey,
): boolean {
  const listada = listadas.has(key)
  return state.mode === 'all' ? !listada : listada
}

/** ¿Los dos estados dicen exactamente lo mismo? Evita emitir sin cambio. */
export function sameRowSelection(a: RowSelectionState, b: RowSelectionState): boolean {
  if (a === b) return true
  if (a.mode !== b.mode || a.keys.length !== b.keys.length) return false
  const listadas = new Set(a.keys)
  return b.keys.every((key) => listadas.has(key))
}
