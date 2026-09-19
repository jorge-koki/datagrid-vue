/**
 * Valores por defecto internos del DataTable.
 *
 * Viven en un único módulo para que el componente, los composables y la hoja de
 * estilos coincidan en los mismos números. La hoja de estilos declara custom
 * properties equivalentes, pero JS es la fuente de verdad para todo lo que el
 * virtualizador necesita para calcular (la altura de fila por sobre todo): ver
 * `datatable.css` para el razonamiento completo.
 *
 * No forma parte de la API pública. Nada de aquí se reexporta desde `index.ts`.
 */

/**
 * Filas por pedido en modo servidor, cuando no se pasa `pageSize`.
 *
 * Cincuenta es el tamaño que cubre de sobra una pantalla llena —veinte filas a
 * 40px en un viewport de 800— sin volver cara la respuesta. Más chico multiplica
 * los viajes de ida y vuelta; más grande hace que el primer pintado espere por
 * filas que nadie va a ver.
 */
export const DEFAULT_PAGE_SIZE = 50

/**
 * Páginas pedidas por adelantado a cada lado de la ventana, sin `prefetchPages`.
 *
 * Una alcanza: a velocidad de scroll normal, la página siguiente llega antes de
 * que su primera fila entre en pantalla, y el usuario nunca ve un marcador.
 */
export const DEFAULT_PREFETCH_PAGES = 1

/** Altura de fila en px cuando no se pasa `rowHeight` y `dense` está apagado. */
export const DEFAULT_ROW_HEIGHT = 40

/** Altura de fila en px cuando no se pasa `rowHeight` y `dense` está encendido. */
export const DENSE_ROW_HEIGHT = 30

/** Altura de header en px cuando no se pasa `headerHeight` y `dense` está apagado. */
export const DEFAULT_HEADER_HEIGHT = 44

/** Altura de header en px cuando no se pasa `headerHeight` y `dense` está encendido. */
export const DENSE_HEADER_HEIGHT = 34

/**
 * Items extra renderizados a cada lado de la ventana visible.
 *
 * El overscan cambia algunas filas pintadas de más por un seguro contra frames
 * en blanco: el navegador puede emitir el evento de scroll después de haber
 * compuesto el frame, y sin ese margen el usuario ve espacio vacío en el borde
 * de avance durante un scroll rápido.
 */
export const DEFAULT_OVERSCAN = 4

/** Ancho en px aplicado a una columna que no declara el suyo. */
export const DEFAULT_COLUMN_WIDTH = 150

/**
 * Piso duro para cualquier ancho de columna resuelto, en px.
 * Garantiza que la columna siga siendo agarrable con el mouse.
 */
export const MIN_COLUMN_WIDTH = 32

/** Techo duro para cualquier ancho de columna resuelto, en px. */
export const MAX_COLUMN_WIDTH = 4000

/**
 * Banda dentro de la que se acota el ancho CUADRADO de la regleta, en px.
 *
 * La regleta busca ser un cuadrado: tan ancha como alta es la fila. Es la forma
 * que tiene una numeración en cualquier hoja de cálculo, y la que hace que se lea como
 * un margen y no como una columna más. Con filas muy bajas o muy altas ese
 * cuadrado dejaría de tener sentido —un borde grueso o una franja enorme—, y por
 * eso el lado se acota a esta banda.
 */
export const ROW_NUMBER_MIN_WIDTH = 28
export const ROW_NUMBER_MAX_WIDTH = 48

/**
 * Cuánto suma cada dígito al ancho de la regleta, en px. Denso entre paréntesis.
 *
 * Solo interviene cuando el número NO entra en el cuadrado: solo ahí la
 * regleta se ensancha, y lo hace lo justo. Es una aproximación del ancho de un
 * dígito en la tipografía de la tabla, deliberadamente en lugar de una medición
 * real: medir texto obliga a escribir en el DOM y leer layout, que es
 * exactamente lo que este componente no hace para calcular geometría.
 */
export const ROW_NUMBER_DIGIT_WIDTH = 7
export const DENSE_ROW_NUMBER_DIGIT_WIDTH = 6

/** Aire a los costados del número, en px. Denso entre paréntesis. */
export const ROW_NUMBER_PADDING = 12
export const DENSE_ROW_NUMBER_PADDING = 8

/**
 * Nodos de fila que se conservan por encima de la cantidad visible al recortar
 * el pool.
 *
 * El pool nunca se achica durante el scroll (ver `useRowPool`); solo se recorta
 * cuando cambia el tamaño del viewport. Este margen absorbe diferencias
 * sub-pixel y de fila fraccionaria para que un resize de unos pocos px no
 * genere churn en el DOM.
 */
export const ROW_POOL_SLACK = 4

/** Prefijo de la clave de almacenamiento. La clave final es `datatable:{tableId}`. */
export const STORAGE_KEY_PREFIX = 'datatable:'

/**
 * Espera en ms antes de escribir el layout en el almacenamiento.
 *
 * Arrastrar el borde de una columna emite un `pointermove` por frame. `setItem`
 * es sincrónico y bloquea el hilo principal, así que escribir a 60Hz durante el
 * arrastre se siente como jank. Este margen colapsa todo el arrastre en una
 * única escritura al soltar.
 */
export const DEFAULT_PERSIST_DEBOUNCE = 300

/** Versión del esquema persistido cuando el consumidor no fija una propia. */
export const DEFAULT_PERSIST_VERSION = 1

/** Centinela escrito en un nodo del pool que todavía no se pintó nunca. */
export const UNPAINTED_GENERATION = -1

/** Índice de fila centinela para un nodo del pool que no muestra nada. */
export const UNPAINTED_ROW_INDEX = -1

/**
 * Tipo de contenido con el que está construida una fila del pool.
 *
 * Es la clave de segmentación VERTICAL del pool, hermana de `__dtRendererType` en
 * el eje horizontal: un mismo nodo de fila puede mostrar datos en un frame y una
 * cabecera de grupo en el siguiente, y las dos estructuras no se parecen en nada.
 * Ver `ensureRowKind` en `useRowPool`.
 */
export const ROW_KIND_DATA = 'data'

/** El otro valor posible de `__dtRowKind`. Ver {@link ROW_KIND_DATA}. */
export const ROW_KIND_GROUP = 'group'

/** Sangría en px que suma cada nivel de anidamiento de grupo. */
export const GROUP_INDENT_STEP = 16
