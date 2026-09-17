/**
 * Un backend simulado, para que el modo servidor se pueda ver funcionando.
 *
 * No hay red ni base de datos: se corta el mismo dataset sembrado que usa el
 * modo en memoria y se devuelve después de una demora. Lo que importa de esta
 * simulación no es de dónde salen las filas sino que **tarden**: sin latencia, la
 * página llegaría en el mismo tick que el pedido y nunca se vería un marcador,
 * que es justamente lo que hay que mostrar.
 *
 * Del otro lado, una aplicación de verdad reemplaza esta función por su `fetch`
 * y no cambia nada más: la tabla pide un tramo y espera a que `rows` lo tenga.
 */

/**
 * Cuánto tarda una respuesta, en ms.
 *
 * Suficiente para ver el marcador al scrollear rápido, y no tanto como para que
 * la demo se sienta rota. Una consulta paginada contra una base real anda en este
 * orden.
 */
export const SERVER_LATENCY = 400

/**
 * Devuelve el tramo `[start, end)` después de la demora.
 *
 * El `slice` sale del dataset completo, que en una aplicación real sería el
 * `LIMIT`/`OFFSET` de la consulta. `end` ya viene acotado por `rowCount`, así que
 * la última página sale más corta sin que haya que hacer nada.
 */
export function fetchRows<TRow>(all: readonly TRow[], start: number, end: number): Promise<TRow[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(all.slice(start, end)), SERVER_LATENCY)
  })
}
