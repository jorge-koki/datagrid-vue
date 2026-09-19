import { ROW_KIND_DATA, UNPAINTED_GENERATION, UNPAINTED_ROW_INDEX } from './constants'
import {
  BOX_CELL_LAYOUT,
  createElement,
  createSvgElement,
  TEXT_CELL_LAYOUT,
  TEXT_RENDERER_TYPE,
} from './renderers/shared'
import type { CellRendererLifecycle } from './renderers/shared'
import type { CellRendererHandle } from '../types'

/**
 * Creación y mutación de los nodos que recicla `useRowPool`.
 *
 * Toda función de este módulo respeta la misma regla: **no escribir en el DOM si
 * el valor no cambió**. Cada nodo del pool lleva encima el último valor que se
 * le pintó, y comparar dos campos en JS cuesta nanosegundos mientras que tocar
 * `style`, `textContent` o `classList` invalida estilo y, en el peor caso,
 * dispara layout. Con ~450 celdas visibles a 60fps la diferencia entre escribir
 * siempre y escribir solo cuando hace falta es la diferencia entre 16ms y 2ms
 * por frame.
 *
 * El caché vive como propiedades planas sobre el propio nodo (prefijo `__dt`) y
 * no en un `WeakMap` externo: es una sola lectura de slot de objeto en lugar de
 * un hash lookup, y mantiene el dato físicamente al lado del nodo que describe,
 * así reciclar el nodo recicla también su caché.
 *
 * No forma parte de la API pública.
 */

/**
 * Elemento de fila del pool, con su contabilidad de reciclado adosada.
 *
 * Los campos `__dt*` son estado interno del pool. No son reactivos y no deben
 * leerse desde fuera de `useRowPool`.
 */
export interface PooledRowElement extends HTMLDivElement {
  /** Índice de fila actualmente pintado en este nodo, o -1 si está ocioso. */
  __dtRowIndex: number
  /**
   * Índice dentro de la prop `rows` de la fila pintada, o -1.
   *
   * Sin agrupación coincide con `__dtRowIndex` y esta comparación es redundante.
   * Con agrupación NO: un mismo índice visible puede pasar de una fila del
   * dataset a otra sin moverse, porque expandir o colapsar un grupo corre todo lo
   * que está debajo. Sin este segundo testigo, `data-row-key` se quedaría
   * mostrando la clave de la fila anterior.
   */
  __dtSourceRowIndex: number
  /** Última traslación vertical aplicada, en px. Evita reescribir `transform`. */
  __dtTranslateY: number
  /**
   * Último alto aplicado, en px, o `NaN` si la fila no tiene alto propio.
   *
   * `NaN` es el estado NORMAL: significa que el alto lo pone la hoja de estilos
   * y que este nodo no escribió nada. Solo deja de serlo cuando las alturas son
   * variables, que es cuando el alto pasa a ser un dato de la fila. Ver
   * {@link setRowHeight}.
   */
  __dtRowSize: number
  /** Último valor escrito en `data-row-key`. */
  __dtRowKey: string
  /** Última decisión de fila rayada aplicada mediante `classList`. */
  __dtStripe: boolean
  /** Último estado de fila activa aplicado. */
  __dtActiveRow: boolean
  /** Último `aria-rowindex` escrito. */
  __dtAriaRow: number
  /** Último `aria-selected` escrito sobre la fila. */
  __dtAriaSelected: boolean
  /**
   * Último ancho aplicado, en px.
   *
   * La fila necesita ancho REAL, y no por decoración: es el bloque contenedor de
   * los carriles anclados, y `position: sticky` no puede correrse más allí de él.
   * Con la fila de ancho cero —su ancho natural, porque todos sus hijos son
   * absolutos— el carril no tendría hacia dónde moverse y el anclaje no
   * existiría. De paso, es lo que hace que el rayado y el realce de fila se vean
   * a lo ancho de la tabla y no solo debajo de las columnas ancladas.
   */
  __dtRowWidth: number
  /** Carril de las columnas ancladas al inicio, creado al necesitarse. */
  __dtLaneStart: HTMLDivElement | null
  /** Carril de las columnas ancladas al final, creado al necesitarse. */
  __dtLaneEnd: HTMLDivElement | null
  /** Celdas que posee esta fila, alineadas por índice con el tramo visible de columnas. */
  __dtCells: PooledCellElement[]
  /**
   * Celdas de las columnas ANCLADAS, alineadas por índice con ellas.
   *
   * Viven en un array aparte porque no rotan: una columna anclada está siempre
   * en el mismo lugar de la lista y siempre visible, así que no hay ventana que
   * desplazar ni módulo que aplicar. Mezclarlas con las otras rompería la
   * aritmética de la rotación horizontal, que supone un tramo CONTIGUO de
   * índices.
   */
  __dtPinnedCells: PooledCellElement[]
  /**
   * Nodo de la regleta que le corresponde, o `null` si la tabla no numera.
   *
   * Lo referencia la fila —y no un array paralelo— porque el slot del pool es el
   * mismo para los dos: mientras la fila conserve su nodo, conserva su número, y
   * no hay forma de que los índices se desincronicen.
   */
  __dtNumber: PooledRowNumberElement | null
  /**
   * Tipo de contenido con el que está construido el nodo: datos o grupo.
   *
   * Ver `ROW_KIND_DATA` en `constants.ts` y `ensureRowKind` en `useRowPool`.
   */
  __dtRowKind: string
  /** Estructura de cabecera de grupo, construida de forma perezosa la primera vez. */
  __dtGroup: PooledGroupParts | null
  /** Id del grupo actualmente pintado, o cadena vacía. */
  __dtGroupId: string
  /** Última profundidad escrita en `--dt-group-depth`. */
  __dtGroupDepth: number
  /**
   * Último estado de expansión aplicado: -1 sin escribir, 0 plegado, 1 desplegado.
   *
   * Es un número y no un booleano porque el estado del DOM tiene TRES valores:
   * `aria-expanded="true"`, `aria-expanded="false"` y el atributo ausente. Con un
   * booleano inicializado en `false`, una cabecera que nace plegada coincidiría
   * con el caché y no escribiría nunca el atributo, así que el lector de pantalla
   * no tendría forma de saber que esa fila se puede desplegar. Es el mismo
   * problema que NO tienen las clases, donde "ausente" y `false` son lo mismo.
   */
  __dtExpanded: number
  /** Último `aria-level` escrito. */
  __dtAriaLevel: number
  /** Último `aria-posinset` escrito. */
  __dtAriaPosInSet: number
  /** Último `aria-setsize` escrito. */
  __dtAriaSetSize: number
  /** `true` mientras la fila muestra un marcador porque sus datos no llegaron. */
  __dtPlaceholder: boolean
}

/**
 * Celda de agregado de una cabecera de grupo.
 *
 * Es deliberadamente más liviana que {@link PooledCellElement}: no tiene
 * renderer, ni valor crudo, ni estado de edición ni de selección. Un agregado es
 * texto ya calculado en una posición horizontal, y nada más.
 */
export interface PooledAggregateElement extends HTMLDivElement {
  /** Clave de la columna cuyo agregado muestra. */
  __dtAggColumnKey: string
  /** Último texto escrito. */
  __dtAggText: string
  /** Última traslación horizontal aplicada, en px. */
  __dtAggX: number
  /** Último ancho aplicado, en px. */
  __dtAggWidth: number
  /** Última alineación aplicada. */
  __dtAggAlign: string
}

/**
 * Nodos internos de una cabecera de grupo, construidos UNA sola vez.
 *
 * Misma disciplina que un {@link CellRenderer}: `createGroupParts` arma la
 * estructura y el camino de pintado solo muta lo que cambió. El chevrón en
 * particular no se vuelve a tocar nunca: gira por CSS a partir de una clase en la
 * fila, así que expandir un grupo no reescribe ni un atributo del SVG.
 */
export interface PooledGroupParts {
  /**
   * Banda de la cabecera. Cubre la fila ENTERA, de borde a borde.
   *
   * Que cubra todo y no solo el tramo de columnas que scrollean es lo que hace
   * que el bloque anclado no quede como un hueco: una cabecera de grupo es una
   * banda que cruza la fila, no una celda más.
   */
  readonly header: HTMLElement
  /**
   * Chevrón, etiqueta y contador, sostenidos con `position: sticky`.
   *
   * La banda mide lo que la fila y por lo tanto se va con el scroll horizontal;
   * este nodo es el que se queda a la vista. Lo sostiene el compositor y no el
   * JS, por lo mismo que el encabezado, la regleta y las columnas ancladas: una
   * corrección escrita desde un `requestAnimationFrame` se compone un frame
   * tarde y se ve como temblor.
   */
  readonly inner: HTMLElement
  /** Texto del grupo. */
  readonly label: HTMLElement
  /** Cantidad de filas descendientes. */
  readonly count: HTMLElement
  /** Celdas de agregado, en el orden de las columnas agregadas visibles. */
  readonly aggregates: PooledAggregateElement[]
  /** Último texto escrito en la etiqueta. */
  labelText: string
  /** Último texto escrito en el contador. */
  countText: string
  /** Último estado de visibilidad del contador. */
  countHidden: boolean
  /** Último ancho de la cabecera, en px. */
  headerWidth: number
}

/**
 * Elemento de celda del pool, con el caché de lo último que se le pintó.
 *
 * `__dtGeneration`, `__dtRowIndex`, `__dtColumnKey`, `__dtColumnDef` y
 * `__dtValue` forman en conjunto la clave de caché: si los cinco coinciden, el
 * texto y la clase personalizada que produciría el pintado son necesariamente
 * los mismos, así que se puede saltear por completo la llamada a `format` y a
 * `cellClass`.
 */
export interface PooledCellElement extends HTMLDivElement {
  /** Clave de la columna actualmente pintada en este nodo. */
  __dtColumnKey: string
  /**
   * Referencia a la definición de columna con la que se pintó, solo para
   * comparar identidad.
   *
   * La clave de columna no alcanza: un consumidor puede pasar un array de
   * columnas nuevo con la misma `key` pero otro `format` —por ejemplo al cambiar
   * de moneda o de locale— y los datos crudos seguirían siendo idénticos. Sin
   * esta comparación el caché acertaría y la tabla no repintaría nunca.
   *
   * Es `unknown` a propósito: solo se compara con `!==`, nunca se lee, así que
   * tipar el genérico aquí no aportaría nada.
   */
  __dtColumnDef: unknown
  /**
   * Tipo de renderer con el que está construida la estructura interna del nodo.
   *
   * Es la clave de segmentación del pool. Un nodo que fue creado por el renderer
   * `text` tiene por dentro un nodo de texto suelto; uno creado por un renderer
   * de badge tiene otra estructura. Reusar un nodo para un renderer distinto sin
   * reconstruirlo dejaría esa estructura vieja adentro.
   */
  __dtRendererType: string
  /**
   * Modo de maquetado con el que está montada la celda.
   *
   * Es metadato del renderer, así que se mueve EXACTAMENTE con
   * `__dtRendererType`: dos columnas con el mismo tipo de renderer tienen
   * siempre el mismo modo, y una celda que conserva su tipo durante el scroll no
   * puede cambiar de modo. Se guarda aparte igual, porque el valor por defecto
   * del campo tiene que coincidir con el del nodo recién creado para que la
   * primera pasada de una celda de texto no escriba una clase que ya no está.
   */
  __dtLayout: string
  /** Renderer que construyó el nodo, para poder cerrarlo con `destroy`. */
  __dtRenderer: CellRendererLifecycle | null
  /** Handle devuelto por `create`, que se le pasa a `update` en cada frame. */
  __dtHandle: CellRendererHandle | null
  /** Índice de fila actualmente pintado en este nodo. */
  __dtRowIndex: number
  /** Generación de pintado en la que se llenó este nodo. `refresh()` la invalida. */
  __dtGeneration: number
  /** Valor sin normalizar pintado por última vez. Es la clave de caché. */
  __dtValue: unknown
  /** Clase personalizada aplicada por última vez desde `column.cellClass`. */
  __dtCustomClass: string
  /** Última traslación horizontal aplicada, en px. */
  __dtTranslateX: number
  /** Último ancho aplicado, en px. */
  __dtWidth: number
  /** Última alineación aplicada. */
  __dtAlign: string
  /** Último estado de edición aplicado. */
  __dtEditing: boolean
  /** Último estado de celda activa aplicado. */
  __dtActive: boolean
  /** Último estado de celda dentro del rango aplicado. */
  __dtRange: boolean
  /** Último `aria-colindex` escrito. */
  __dtAriaCol: number
  /** Último `aria-selected` escrito sobre la celda. */
  __dtAriaSelected: boolean
  /**
   * Si lleva la línea del corte entre lo anclado y lo que scrollea.
   *
   * La lleva una sola celda por carril: la última del bloque del inicio y la
   * primera del bloque del final. Ver `.dt-cell--pinned-edge`.
   */
  __dtPinnedEdge: boolean
  /**
   * Carril en el que está colgada, si es la celda de una columna anclada.
   *
   * Cadena vacía mientras no cuelgue de ninguno. Existe porque una columna puede
   * pasar de `start` a `end` en caliente, y entonces su celda tiene que cambiar
   * de carril: comparar contra este campo es lo que evita hacer ese `appendChild`
   * en cada frame en vez de solo cuando el lado cambió de verdad.
   */
  __dtPinnedSide: string
  /** `true` mientras la celda muestra un marcador porque su fila no llegó. */
  __dtPlaceholder: boolean
}

/**
 * Nodo de la regleta de numeración, uno por slot del pool de filas.
 *
 * Vive FUERA de la fila y fuera del canvas, en un carril propio que se queda
 * quieto con `position: sticky`. Si fuera hijo de la fila haría falta un carril
 * por fila visible en lugar de uno solo para todas.
 *
 * Se recicla por el mismo slot que su fila —de hecho lo referencia el nodo de
 * fila—, así que no hay un segundo pool que mantener sincronizado: la fila que
 * conserva su slot conserva también su número.
 */
export interface PooledRowNumberElement extends HTMLElement {
  /** Última traslación vertical aplicada, en px. */
  __dtTranslateY: number
  /** Último texto escrito. */
  __dtLabel: string
  /** Último estado de rayado aplicado. */
  __dtNumberStripe: boolean
  /** Último estado de fila activa aplicado. */
  __dtNumberActive: boolean
  /** Último estado de fila dentro del rango aplicado. */
  __dtNumberRange: boolean
}

/**
 * Crea un nodo de fila vacío.
 *
 * Usa `Object.assign` en lugar de una aserción de tipo sobre el elemento: el
 * tipo de retorno de `Object.assign` es la intersección del elemento con el
 * objeto de contabilidad, que es estructuralmente {@link PooledRowElement}. Así
 * el nodo queda tipado sin afirmar nada que el compilador no pueda verificar.
 *
 * El único `as` que queda es sobre el literal `[]`, que sin anotación inferiría
 * `never[]` y rechazaría cualquier `push`. Es un ensanchamiento de un literal
 * vacío, no una aserción sobre un valor: no puede ocultar un tipo incorrecto.
 */
export function createRowElement(): PooledRowElement {
  const element = document.createElement('div')
  element.className = 'dt-row'
  // El rol se fija UNA vez y no se vuelve a tocar: es estructural, no depende
  // del dato, y reescribirlo por frame sería puro trabajo sin cambio.
  element.setAttribute('role', 'row')
  return Object.assign(element, {
    __dtRowIndex: UNPAINTED_ROW_INDEX,
    __dtSourceRowIndex: UNPAINTED_ROW_INDEX,
    __dtTranslateY: Number.NaN,
    __dtRowSize: Number.NaN,
    __dtRowKey: '',
    __dtStripe: false,
    __dtActiveRow: false,
    __dtAriaRow: -1,
    __dtAriaSelected: false,
    __dtRowWidth: Number.NaN,
    __dtLaneStart: null as HTMLDivElement | null,
    __dtLaneEnd: null as HTMLDivElement | null,
    __dtCells: [] as PooledCellElement[],
    __dtPinnedCells: [] as PooledCellElement[],
    __dtNumber: null as PooledRowNumberElement | null,
    // Una fila nace siendo de datos: es el caso abrumadoramente mayoritario y
    // así una tabla sin agrupación jamás ejecuta el camino de cambio de tipo.
    __dtRowKind: ROW_KIND_DATA,
    __dtGroup: null as PooledGroupParts | null,
    __dtGroupId: '',
    __dtGroupDepth: -1,
    __dtExpanded: -1,
    __dtAriaLevel: -1,
    __dtAriaPosInSet: -1,
    __dtAriaSetSize: -1,
    __dtPlaceholder: false,
  })
}

/**
 * Construye la estructura de una cabecera de grupo dentro de un nodo de fila.
 *
 * Se llama UNA vez por nodo de fila, la primera vez que a ese nodo le toca
 * mostrar un grupo, y nunca más: a partir de ahí el nodo conserva la estructura
 * aunque vuelva a mostrar datos, escondida detrás de `hidden`. Reconstruirla en
 * cada ida y vuelta costaría crear y destruir cinco nodos —incluido un SVG— en
 * mitad del scroll.
 *
 * El chevrón es geometría fija: se dibuja una vez y la rotación la resuelve CSS a
 * partir de la clase de la fila.
 */
export function createGroupParts(row: PooledRowElement): PooledGroupParts {
  const header = createElement('div', 'dt-group-header')
  // La banda cruza la fila entera; este nodo es el que se queda a la vista con
  // `position: sticky`. Son dos cajas y no una porque una sola no puede a la vez
  // medir lo que la fila y quedarse quieta cuando la fila se corre.
  const inner = createElement('div', 'dt-group-header-inner')

  const chevron = createSvgElement('svg', 'dt-group-chevron')
  chevron.setAttribute('viewBox', '0 0 16 16')
  chevron.setAttribute('aria-hidden', 'true')
  chevron.setAttribute('focusable', 'false')

  const path = createSvgElement('path', 'dt-group-chevron-path')
  path.setAttribute('d', 'M6 4 10 8 6 12')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.75')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  chevron.appendChild(path)

  const label = createElement('span', 'dt-group-label')
  const count = createElement('span', 'dt-group-count')

  inner.appendChild(chevron)
  inner.appendChild(label)
  inner.appendChild(count)
  header.appendChild(inner)
  row.appendChild(header)

  return {
    header,
    inner,
    label,
    count,
    aggregates: [],
    labelText: '',
    countText: '',
    countHidden: false,
    headerWidth: Number.NaN,
  }
}

/**
 * Crea una celda de agregado y la agrega a la fila.
 *
 * No lleva `role` ni `tabindex`: no es una celda de la grilla, es el resumen de
 * una columna dentro de una cabecera de fila. Anunciarla como `gridcell` la
 * metería en la navegación por celdas de un lector de pantalla, donde no hay nada
 * que editar ni seleccionar.
 */
export function createAggregateElement(row: PooledRowElement): PooledAggregateElement {
  const element = document.createElement('div')
  element.className = 'dt-group-aggregate'
  row.appendChild(element)
  return Object.assign(element, {
    __dtAggColumnKey: '',
    __dtAggText: '',
    __dtAggX: Number.NaN,
    __dtAggWidth: Number.NaN,
    __dtAggAlign: '',
  })
}

/**
 * Crea un nodo de celda vacío.
 *
 * ## La celda NO lleva `tabindex`, y es una consecuencia del reciclado
 *
 * Dónde está parado el usuario es estado del componente —la posición
 * `activeCell`— y no el foco del DOM. La razón es justamente que estos nodos se
 * reciclan: el nodo que muestra la fila 12 puede quedar reasignado a la fila 42
 * en mitad de un scroll, sin moverse ni un píxel. Si el foco fuera el registro
 * de la posición activa, esa reasignación lo dejaría señalando una celda que el
 * usuario nunca eligió, y el nodo seguiría recibiendo sus teclas mientras
 * muestra datos distintos. Un dato que sobrevive al repintado no puede vivir en
 * un nodo que se recicla.
 *
 * De ahí se sigue el resto del diseño: la marca visual es la clase
 * `dt-cell--active`, que se pinta a partir de esa posición, y el único elemento
 * enfocable de la tabla es `.dt-viewport`, que es también el que lleva el
 * manejador de teclado. Con las celdas fuera del foco hay un solo anillo
 * posible y un solo lugar donde se escriben las teclas.
 *
 * Los `as` sobre los literales `null` y `undefined` son ensanchamientos al tipo
 * declarado del campo, igual que el `[]` de {@link createRowElement}: sin ellos
 * el campo quedaría inferido como `null` o `undefined` y no admitiría ningún
 * valor posterior. Anotan un literal vacío, no afirman nada sobre un valor ya
 * construido, así que no pueden ocultar un tipo incorrecto.
 */
/**
 * Crea un nodo de celda para una columna ANCLADA.
 *
 * Es el mismo nodo con una clase más, no otra clase de nodo: todo lo que el pool
 * sabe hacer con una celda —renderers, edición, selección, eventos— sigue
 * valiendo igual. La clase solo le da un fondo opaco, que es lo que la deja tapar
 * a las que pasan por debajo; quedarse quieta es trabajo del carril del que
 * cuelga. Ver {@link ensurePinnedLane}.
 *
 * Nace SUELTA, sin padre: quién la adopta depende de si su columna está anclada
 * al inicio o al final, y eso lo sabe el pintado, no la construcción.
 */
export function createPinnedCellElement(): PooledCellElement {
  const element = createCellElement()
  element.classList.add('dt-cell--pinned')
  return element
}

export function createCellElement(): PooledCellElement {
  const element = document.createElement('div')
  element.className = 'dt-cell'
  // Igual que el rol de la fila: estructural, se escribe una sola vez.
  element.setAttribute('role', 'gridcell')
  return Object.assign(element, {
    __dtColumnKey: '',
    __dtColumnDef: null as unknown,
    // Arranca declarando el tipo por defecto pero SIN handle: la primera pasada
    // de pintado detecta el handle nulo y ejecuta `create`.
    __dtRendererType: TEXT_RENDERER_TYPE,
    // Y arranca con el modo que le corresponde a ese tipo por defecto, que es
    // además el de la clase con la que nace el nodo: sin clase de maquetado. Así
    // una celda de texto atraviesa su primer pintado sin tocar `classList`.
    __dtLayout: TEXT_CELL_LAYOUT,
    __dtRenderer: null as CellRendererLifecycle | null,
    __dtHandle: null as CellRendererHandle | null,
    __dtRowIndex: UNPAINTED_ROW_INDEX,
    __dtGeneration: UNPAINTED_GENERATION,
    __dtValue: undefined as unknown,
    __dtCustomClass: '',
    __dtTranslateX: Number.NaN,
    __dtWidth: Number.NaN,
    __dtAlign: '',
    __dtEditing: false,
    __dtActive: false,
    __dtRange: false,
    __dtAriaCol: -1,
    __dtAriaSelected: false,
    __dtPinnedEdge: false,
    __dtPinnedSide: '',
    __dtPlaceholder: false,
  })
}

/**
 * Posiciona una fila verticalmente.
 *
 * Se usa `transform` y no `top` porque `transform` se resuelve en el hilo de
 * composición: no invalida layout del documento y el navegador puede reusar la
 * capa ya rasterizada. Escribir `top` en cada frame sobre 30 filas provoca 30
 * reflows por frame, que es exactamente lo que se busca evitar.
 *
 * El eje Z explícito (`translate3d` en vez de `translateY`) promueve la fila a
 * su propia capa de composición.
 */
export function setRowOffset(node: PooledRowElement, y: number): void {
  if (node.__dtTranslateY === y) return
  node.__dtTranslateY = y
  node.style.transform = `translate3d(0, ${y}px, 0)`
}

/**
 * Le da a la fila su alto propio, cuando no es el de todas las demás.
 *
 * ## Una sola escritura, y la hoja de estilos hace el resto
 *
 * Escribe la custom property `--dt-row-h` y nada más. No escribe `height` sobre
 * la fila, ni sobre sus celdas, ni sobre su número: todos esos altos ya salen de
 * `--dt-row-h` en la hoja de estilos, y las celdas la HEREDAN de la fila. Un
 * `setProperty` reemplaza lo que de otro modo sería una escritura por celda en
 * cada fila de cada frame.
 *
 * Es la única pieza del pintado que usa la herencia de custom properties en
 * lugar de escribir el valor final, y la razón es esa: el alto lo necesitan
 * cinco reglas distintas —la fila, la celda, su altura de línea, la cabecera de
 * grupo, el agregado— y todas cuelgan del mismo nodo.
 *
 * ## `variable` en `false` BORRA la propiedad
 *
 * No la escribe con el alto base: la borra. Sin eso, una tabla que deja de tener
 * alturas variables —se apagó la fila expandida, cambió el dataset— se quedaría
 * con el último alto escrito inline, y ese valor le gana a la hoja de estilos
 * para siempre. La fila vuelve a no tener alto propio, que es su estado normal.
 *
 * El nodo del número va aparte porque no es hijo de la fila: vive en la regleta,
 * que es un contenedor `sticky` propio, así que no puede heredar nada de ella.
 */
export function setRowHeight(node: PooledRowElement, height: number, variable: boolean): void {
  const target = variable ? height : Number.NaN
  // Comparación de `NaN` consigo mismo: `NaN !== NaN`, así que la guarda de
  // abajo no puede memoizar el estado "sin alto propio". Se chequea aparte.
  if (Number.isNaN(target) && Number.isNaN(node.__dtRowSize)) return
  if (node.__dtRowSize === target) return

  node.__dtRowSize = target
  if (Number.isNaN(target)) {
    node.style.removeProperty('--dt-row-h')
    node.__dtNumber?.style.removeProperty('--dt-row-h')
    return
  }

  const value = `${target}px`
  node.style.setProperty('--dt-row-h', value)
  node.__dtNumber?.style.setProperty('--dt-row-h', value)
}

/**
 * Le da a la fila el ancho de la tabla.
 *
 * No cambia con el scroll: solo al redimensionar el viewport, ocultar una
 * columna o cambiar un ancho, que son gestos del usuario y no frames. Ver
 * {@link PooledRowElement.__dtRowWidth} por qué la fila necesita ancho real.
 */
export function setRowWidth(node: PooledRowElement, width: number): void {
  if (node.__dtRowWidth === width) return
  node.__dtRowWidth = width
  node.style.width = `${width}px`
}

/**
 * Devuelve el carril anclado de una fila, creándolo la primera vez.
 *
 * ## Qué es un carril
 *
 * Una caja de tamaño CERO cuya única propiedad es `position: sticky`. No dibuja
 * nada, no ocupa lugar y no se pinta: es un ancla de la que cuelgan las celdas
 * ancladas, que siguen siendo celdas absolutas normales dentro de ella.
 *
 * ## Por qué un carril y no la celda directamente
 *
 * Porque `sticky` necesita estar en el flujo, y una celda del pool es absoluta y
 * se posiciona con `transform`. El carril separa las dos responsabilidades: él
 * se queda quieto —lo resuelve el compositor, sin una sola línea de JS por
 * frame— y las celdas se ubican dentro con la misma aritmética de siempre.
 *
 * ## Por qué uno por fila
 *
 * Porque así la celda anclada sigue siendo hija de SU fila, y hereda de ella el
 * fondo —normal, rayado, activo— con un `background: inherit`. Un único carril
 * para toda la tabla obligaría a recalcular ese fondo celda por celda, y a
 * reposicionar cada celda anclada en cada frame de scroll VERTICAL, que hoy sale
 * gratis porque las arrastra el `transform` de su fila.
 *
 * Se crea al necesitarse: una tabla sin columnas ancladas no paga ni un nodo.
 */
export function ensurePinnedLane(row: PooledRowElement, side: 'start' | 'end'): HTMLDivElement {
  const existing = side === 'end' ? row.__dtLaneEnd : row.__dtLaneStart
  if (existing) return existing

  const lane = document.createElement('div')
  lane.className =
    side === 'end' ? 'dt-pinned-lane dt-pinned-lane--end' : 'dt-pinned-lane dt-pinned-lane--start'
  // El carril no es una celda ni una fila: es andamiaje de maquetado, y
  // anunciarlo metería un nodo sin semántica en medio de una fila de la grilla.
  lane.setAttribute('role', 'none')
  row.appendChild(lane)

  if (side === 'end') row.__dtLaneEnd = lane
  else row.__dtLaneStart = lane
  return lane
}

/**
 * Crea el nodo que muestra el número de una fila.
 *
 * `aria-hidden` no es un descuido: la posición de la fila ya viaja por
 * `aria-rowindex`, que es el canal que un lector de pantalla entiende como tal.
 * Dejarlo visible sumaría un "1", un "2" sueltos antes de cada fila, repitiendo
 * en voz alta algo que la grilla ya anuncia mejor.
 */
export function createRowNumberElement(): PooledRowNumberElement {
  const element = document.createElement('div')
  element.className = 'dt-row-number'
  element.setAttribute('aria-hidden', 'true')
  return Object.assign(element, {
    __dtTranslateY: Number.NaN,
    __dtLabel: '',
    __dtNumberStripe: false,
    __dtNumberActive: false,
    __dtNumberRange: false,
  })
}

/** Posiciona verticalmente un número de fila. Misma disciplina que la fila. */
export function setRowNumberOffset(node: PooledRowNumberElement, y: number): void {
  if (node.__dtTranslateY === y) return
  node.__dtTranslateY = y
  node.style.transform = `translate3d(0, ${y}px, 0)`
}

/** Escribe el número, o vacío para una cabecera de grupo. */
export function setRowNumberLabel(node: PooledRowNumberElement, label: string): void {
  if (node.__dtLabel === label) return
  node.__dtLabel = label
  node.textContent = label
}

/** Acompaña el rayado de la fila, para que la regleta no corte la banda. */
export function setRowNumberStripe(node: PooledRowNumberElement, stripe: boolean): void {
  if (node.__dtNumberStripe === stripe) return
  node.__dtNumberStripe = stripe
  node.classList.toggle('dt-row-number--stripe', stripe)
}

/** Marca el número de la fila que contiene la celda activa. */
export function setRowNumberActive(node: PooledRowNumberElement, active: boolean): void {
  if (node.__dtNumberActive === active) return
  node.__dtNumberActive = active
  node.classList.toggle('dt-row-number--active', active)
}

/**
 * Marca el número de una fila alcanzada por el rango.
 *
 * Es lo que hace legible una selección de varias filas cuando la tabla está
 * corrida en horizontal: ahí la regleta puede ser lo único visible de lo que
 * está seleccionado.
 */
export function setRowNumberRange(node: PooledRowNumberElement, inRange: boolean): void {
  if (node.__dtNumberRange === inRange) return
  node.__dtNumberRange = inRange
  node.classList.toggle('dt-row-number--range', inRange)
}

/** Escribe `data-row-key` solo cuando la identidad de la fila cambió. */
export function setRowKey(node: PooledRowElement, key: string): void {
  if (node.__dtRowKey === key) return
  node.__dtRowKey = key
  node.dataset.rowKey = key
}

/** Alterna la clase de fila rayada solo cuando la paridad efectiva cambió. */
export function setRowStripe(node: PooledRowElement, stripe: boolean): void {
  if (node.__dtStripe === stripe) return
  node.__dtStripe = stripe
  node.classList.toggle('dt-row--stripe', stripe)
}

/**
 * Posiciona y dimensiona una celda dentro de su fila.
 *
 * Igual que en las filas, la posición horizontal viaja por `transform`. El ancho
 * sí tiene que ir por `style.width` porque no hay forma de expresarlo como
 * transformación sin escalar el texto, pero se escribe únicamente cuando cambia,
 * que durante un scroll vertical puro es nunca.
 */
export function setCellBox(node: PooledCellElement, x: number, width: number): void {
  if (node.__dtTranslateX !== x) {
    node.__dtTranslateX = x
    node.style.transform = `translate3d(${x}px, 0, 0)`
  }
  if (node.__dtWidth !== width) {
    node.__dtWidth = width
    node.style.width = `${width}px`
  }
}

/**
 * Vacía la estructura interna de una celda antes de que otro renderer la use.
 *
 * `textContent = ''` es la forma más barata de sacar todos los hijos de un nodo:
 * una sola operación del motor en lugar de N `removeChild`. Solo se invoca
 * cuando cambia el tipo de renderer, nunca durante el scroll.
 *
 * Nunca se usa `innerHTML`: obligaría a parsear HTML y abriría una vía de
 * inyección con datos que vienen del consumidor.
 */
export function clearCellContent(node: PooledCellElement): void {
  node.textContent = ''
}

/**
 * Aplica el modo de maquetado de la celda.
 *
 * ## Por qué esto NO se escribe por frame
 *
 * El modo es metadato del renderer, no del dato: todas las celdas de una columna
 * de badges están en modo caja y ninguna deja de estarlo por scrollear. La única
 * forma de que un nodo cambie de modo es que el slot pase a representar una
 * columna con OTRO tipo de renderer, que es exactamente la condición que
 * `ensureRenderer` ya detecta y donde esta función se invoca. Durante un scroll
 * —vertical u horizontal entre columnas del mismo tipo— no se llama nunca, y si
 * se llamara, la comparación de abajo cortaría igual antes de tocar el DOM.
 *
 * `text` es el caso por defecto y no lleva clase, así que una tabla de puras
 * columnas de texto no escribe esta clase ni una sola vez en toda su vida.
 */
export function setCellLayout(node: PooledCellElement, layout: string): void {
  if (node.__dtLayout === layout) return
  node.__dtLayout = layout
  node.classList.toggle('dt-cell--box', layout === BOX_CELL_LAYOUT)
}

/**
 * Aplica la alineación de la columna como clase.
 *
 * `left` es el caso por defecto y no lleva clase, de modo que la mayoría de las
 * celdas nunca tocan `classList`.
 *
 * Las mismas dos clases sirven a los DOS modos de maquetado: en modo texto la
 * hoja de estilos las resuelve con `text-align` y en modo caja con
 * `justify-content`, porque `text-align` no posiciona ítems flex. Que la fuente
 * de verdad sea una sola —el valor de `align`, escrito aquí— es lo que garantiza
 * que los tres estados no puedan significar cosas distintas según el modo.
 */
export function setCellAlign(node: PooledCellElement, align: string): void {
  if (node.__dtAlign === align) return
  node.__dtAlign = align
  node.classList.toggle('dt-cell--center', align === 'center')
  node.classList.toggle('dt-cell--right', align === 'right')
}

/** Marca la celda que tiene el editor encima. */
export function setCellEditing(node: PooledCellElement, editing: boolean): void {
  if (node.__dtEditing === editing) return
  node.__dtEditing = editing
  node.classList.toggle('dt-cell--editing', editing)
}

/**
 * Marca la celda activa.
 *
 * Al moverse la selección solo cambian dos celdas: la que la pierde y la que la
 * gana. Como esta comparación corta antes de tocar el DOM, el resto de las ~450
 * celdas visibles atraviesan el pintado sin escribir nada.
 */
export function setCellActive(node: PooledCellElement, active: boolean): void {
  if (node.__dtActive === active) return
  node.__dtActive = active
  node.classList.toggle('dt-cell--active', active)
}

/**
 * Marca una celda que cae dentro del rango seleccionado.
 *
 * Es el tinte, no el borde: el borde del rango lo dibuja un solo nodo por
 * encima del canvas, porque son cuatro líneas y no una por celda. Aquí solo se
 * pinta el fondo, que sí es por celda y tiene que quedar DEBAJO del contenido
 * para no velar el texto.
 *
 * Al extender el rango una fila, las celdas que ya estaban adentro comparan
 * `true` contra `true` y atraviesan el pintado sin escribir nada: solo escriben
 * las que entraron o salieron, igual que con la celda activa.
 */
export function setCellRange(node: PooledCellElement, inRange: boolean): void {
  if (node.__dtRange === inRange) return
  node.__dtRange = inRange
  node.classList.toggle('dt-cell--range', inRange)
}

/**
 * Marca la celda anclada que lleva la línea del corte.
 *
 * Es una clase y no una regla `:last-child` porque el orden de los nodos dentro
 * de un carril es el de aparición, y una columna que cambia de borde en caliente
 * se recuelga al final: la clase sale del índice, que siempre dice la verdad.
 */
export function setCellPinnedEdge(node: PooledCellElement, edge: boolean): void {
  if (node.__dtPinnedEdge === edge) return
  node.__dtPinnedEdge = edge
  node.classList.toggle('dt-cell--pinned-edge', edge)
}

/**
 * Pone o saca a una celda el estado de marcador: su fila todavía no llegó.
 *
 * ## Por qué se vacía el contenido en vez de solo taparlo
 *
 * La barra del marcador la dibuja el CSS con un pseudoelemento, así que ocultar
 * lo que había alcanzaría para que no se vea. Pero una celda no tiene
 * `aria-label`: su nombre accesible ES su texto. Una celda tapada seguiría
 * anunciando el valor de la fila anterior, que es peor que no anunciar nada
 * —dice un dato concreto y equivocado sobre una fila que ni siquiera cargó—.
 *
 * Se cierra el handle del renderer y se anula, de modo que `ensureRenderer` lo
 * reconstruya cuando los datos lleguen. Es exactamente una reconstrucción por
 * celda al entrar en la zona sin cargar y otra al salir, y ninguna mientras se
 * scrollea por encima de ella.
 */
export function setCellPlaceholder(node: PooledCellElement, on: boolean): void {
  if (node.__dtPlaceholder === on) return
  node.__dtPlaceholder = on
  node.classList.toggle('dt-cell--placeholder', on)
  if (!on) return

  // El `destroy` vive en el renderer, no en el handle: el handle es estado
  // privado del renderer y el pool nunca lo interpreta. Mismo par que usa
  // `ensureRenderer` al cambiar de renderer un slot.
  const handle = node.__dtHandle
  if (handle) node.__dtRenderer?.destroy?.(handle)
  node.__dtHandle = null
  node.textContent = ''
}

/**
 * Marca una fila como marcador y lo anuncia con `aria-busy`.
 *
 * `aria-busy` es el atributo exacto para esto: le dice al lector de pantalla que
 * la región se está actualizando y que todavía no vale la pena leerla, en lugar
 * de hacerle anunciar una fila vacía como si fuera un dato.
 */
export function setRowPlaceholder(node: PooledRowElement, on: boolean): void {
  if (node.__dtPlaceholder === on) return
  node.__dtPlaceholder = on
  node.classList.toggle('dt-row--placeholder', on)
  if (on) node.setAttribute('aria-busy', 'true')
  else node.removeAttribute('aria-busy')
}

/** Marca la fila que contiene la celda activa. */
export function setRowActive(node: PooledRowElement, active: boolean): void {
  if (node.__dtActiveRow === active) return
  node.__dtActiveRow = active
  node.classList.toggle('dt-row--active', active)
}

/**
 * Escribe `aria-rowindex` sobre la fila.
 *
 * Va en la FILA y no en cada celda a propósito. El índice cambia cada vez que un
 * nodo se recicla, o sea en cada paso de scroll vertical; ponerlo por celda
 * costaría una escritura por celda visible por frame, mientras que ponerlo por
 * fila cuesta una por fila. Es la misma información y el mismo significado para
 * un lector de pantalla, con quince veces menos escrituras.
 *
 * Es 1-based porque así lo define ARIA, y cuenta la fila de encabezado.
 */
export function setRowAriaIndex(node: PooledRowElement, rowIndex: number): void {
  if (node.__dtAriaRow === rowIndex) return
  node.__dtAriaRow = rowIndex
  node.setAttribute('aria-rowindex', String(rowIndex + 2))
}

/** Escribe `aria-selected` sobre la fila, solo cuando cambia. */
export function setRowAriaSelected(node: PooledRowElement, selected: boolean): void {
  if (node.__dtAriaSelected === selected) return
  node.__dtAriaSelected = selected
  node.setAttribute('aria-selected', selected ? 'true' : 'false')
}

/**
 * Escribe `aria-colindex` sobre la celda.
 *
 * Solo cambia cuando el slot pasa a representar otra columna, es decir durante
 * el scroll horizontal o al ocultar y reordenar columnas. En un scroll vertical
 * puro no se escribe nunca.
 */
export function setCellAriaIndex(node: PooledCellElement, columnIndex: number): void {
  if (node.__dtAriaCol === columnIndex) return
  node.__dtAriaCol = columnIndex
  node.setAttribute('aria-colindex', String(columnIndex + 1))
}

/** Escribe `aria-selected` sobre la celda, solo cuando cambia. */
export function setCellAriaSelected(node: PooledCellElement, selected: boolean): void {
  if (node.__dtAriaSelected === selected) return
  node.__dtAriaSelected = selected
  node.setAttribute('aria-selected', selected ? 'true' : 'false')
}

/**
 * Reemplaza la clase personalizada que devolvió `column.cellClass`.
 *
 * Se opera con `classList.remove` / `classList.add` sobre los tokens que
 * realmente cambiaron en lugar de reconstruir `className`: reescribir el
 * atributo completo obligaría al motor a reparsear todas las clases del nodo,
 * incluidas las estructurales (`dt-cell`, alineación, edición), y además las
 * borraría.
 */
export function setCellCustomClass(node: PooledCellElement, next: string): void {
  const previous = node.__dtCustomClass
  if (previous === next) return
  node.__dtCustomClass = next
  if (previous !== '') {
    for (const token of previous.split(/\s+/)) {
      if (token !== '') node.classList.remove(token)
    }
  }
  if (next !== '') {
    for (const token of next.split(/\s+/)) {
      if (token !== '') node.classList.add(token)
    }
  }
}

/* ------------------------------------------------- Cabeceras de grupo */

/**
 * Alterna la clase que distingue una cabecera de grupo de una fila de datos.
 *
 * Solo se escribe cuando el nodo CAMBIA de tipo, que durante un scroll con la
 * misma mezcla de filas y grupos en pantalla es prácticamente nunca: la rotación
 * conserva el slot de cada fila visible, y con él su tipo.
 */
export function setRowGroupClass(node: PooledRowElement, isGroup: boolean): void {
  node.classList.toggle('dt-group-row', isGroup)
}

/**
 * Escribe la profundidad del grupo como custom property.
 *
 * Una sola escritura y ningún nodo intermedio: la sangría la calcula CSS con
 * `calc()` sobre este número. Envolver la etiqueta en N divs anidados, que es la
 * otra forma de sangrar, significaría crear y destruir nodos cada vez que un slot
 * pasa de un nivel a otro.
 */
export function setRowGroupDepth(node: PooledRowElement, depth: number): void {
  if (node.__dtGroupDepth === depth) return
  node.__dtGroupDepth = depth
  node.style.setProperty('--dt-group-depth', String(depth))
}

/**
 * Marca un grupo como expandido, para el chevrón y para el lector de pantalla.
 *
 * La clase y el atributo se escriben juntos porque describen lo mismo: uno gira
 * la punta de flecha por CSS y el otro es lo que anuncia un lector de pantalla en
 * un `treegrid`.
 */
export function setRowExpanded(node: PooledRowElement, expanded: boolean): void {
  const next = expanded ? 1 : 0
  if (node.__dtExpanded === next) return
  node.__dtExpanded = next
  node.classList.toggle('dt-group-row--expanded', expanded)
  node.setAttribute('aria-expanded', expanded ? 'true' : 'false')
}

/** Quita `aria-expanded` de una fila que dejó de ser una cabecera de grupo. */
export function clearRowExpanded(node: PooledRowElement): void {
  if (node.__dtExpanded === -1) return
  node.__dtExpanded = -1
  node.classList.toggle('dt-group-row--expanded', false)
  node.removeAttribute('aria-expanded')
}

/**
 * Escribe `aria-level`, 1-based como exige ARIA.
 *
 * Para una fila de datos el nivel es constante mientras no cambie la agrupación,
 * así que se escribe una vez por nodo y después el caché lo saltea en cada frame.
 */
export function setRowAriaLevel(node: PooledRowElement, level: number): void {
  if (node.__dtAriaLevel === level) return
  node.__dtAriaLevel = level
  node.setAttribute('aria-level', String(level))
}

/** Quita `aria-level` cuando la tabla deja de ser un `treegrid`. */
export function clearRowAriaLevel(node: PooledRowElement): void {
  if (node.__dtAriaLevel === -1) return
  node.__dtAriaLevel = -1
  node.removeAttribute('aria-level')
}

/**
 * Escribe la posición del grupo entre sus hermanos.
 *
 * Va solo en las cabeceras de grupo y no en las filas de datos, y es una decisión
 * de costo: en una cabecera los dos números son baratos —ya los trae el aplanado—
 * y cambian poco, mientras que en las filas de datos cambiarían con CADA fila que
 * entra a la ventana, o sea dos escrituras más por fila y por paso de scroll,
 * para anunciar algo que `aria-rowindex` ya cubre.
 */
export function setRowAriaSet(node: PooledRowElement, posInSet: number, setSize: number): void {
  if (node.__dtAriaPosInSet !== posInSet) {
    node.__dtAriaPosInSet = posInSet
    node.setAttribute('aria-posinset', String(posInSet))
  }
  if (node.__dtAriaSetSize !== setSize) {
    node.__dtAriaSetSize = setSize
    node.setAttribute('aria-setsize', String(setSize))
  }
}

/** Quita la posición de conjunto de una fila que ya no es cabecera de grupo. */
export function clearRowAriaSet(node: PooledRowElement): void {
  if (node.__dtAriaPosInSet !== -1) {
    node.__dtAriaPosInSet = -1
    node.removeAttribute('aria-posinset')
  }
  if (node.__dtAriaSetSize !== -1) {
    node.__dtAriaSetSize = -1
    node.removeAttribute('aria-setsize')
  }
}

/**
 * Dimensiona la banda de una cabecera de grupo.
 *
 * Solo el ancho: la banda arranca siempre en el borde izquierdo de la fila, así
 * que su posición la fija el CSS con `left: 0` y no hay nada que escribir. Y como
 * el ancho es el de la fila, esto escribe una vez y no vuelve a tocar el DOM
 * mientras no cambien las columnas: durante el scroll cuesta cero.
 */
export function setGroupHeaderWidth(parts: PooledGroupParts, width: number): void {
  if (parts.headerWidth === width) return
  parts.headerWidth = width
  parts.header.style.width = `${width}px`
}

/** Escribe el texto del grupo solo cuando cambió. */
export function setGroupLabel(parts: PooledGroupParts, text: string): void {
  if (parts.labelText === text) return
  parts.labelText = text
  parts.label.textContent = text
}

/** Escribe el contador de filas del grupo, o lo esconde. */
export function setGroupCount(parts: PooledGroupParts, text: string, hidden: boolean): void {
  if (parts.countHidden !== hidden) {
    parts.countHidden = hidden
    parts.count.hidden = hidden
  }
  if (hidden || parts.countText === text) return
  parts.countText = text
  parts.count.textContent = text
}

/** Posiciona y dimensiona una celda de agregado. */
export function setAggregateBox(node: PooledAggregateElement, x: number, width: number): void {
  if (node.__dtAggX !== x) {
    node.__dtAggX = x
    node.style.transform = `translate3d(${x}px, 0, 0)`
  }
  if (node.__dtAggWidth !== width) {
    node.__dtAggWidth = width
    node.style.width = `${width}px`
  }
}

/**
 * Aplica la alineación de la columna a la celda de agregado.
 *
 * Reusa las clases de alineación de las celdas, pero nunca el modo caja: un
 * agregado es siempre una cifra ya formateada, o sea texto, aunque la columna
 * que resume se pinte con badges. Por eso se centra por altura de línea como
 * cualquier celda de texto y queda alineado con la columna de la que habla.
 */
export function setAggregateAlign(node: PooledAggregateElement, align: string): void {
  if (node.__dtAggAlign === align) return
  node.__dtAggAlign = align
  node.classList.toggle('dt-cell--center', align === 'center')
  node.classList.toggle('dt-cell--right', align === 'right')
}

/** Escribe el texto de un agregado solo cuando cambió. */
export function setAggregateText(
  node: PooledAggregateElement,
  columnKey: string,
  text: string,
): void {
  if (node.__dtAggColumnKey !== columnKey) node.__dtAggColumnKey = columnKey
  if (node.__dtAggText === text) return
  node.__dtAggText = text
  node.textContent = text
}

/**
 * Muestra u oculta un nodo del pool.
 *
 * Los nodos sobrantes se ocultan con `hidden` en lugar de sacarlos del DOM:
 * `removeChild` + `appendChild` recrean el estado de layout del nodo y tiran a
 * la basura su capa de composición, mientras que `hidden` solo lo saca del flujo
 * y lo deja listo para volver a usarse en el próximo frame. Se compara antes de
 * escribir porque alternar `hidden` sí invalida layout.
 *
 * Que esto APAGUE el nodo no se cumple solo: `[hidden] { display: none }` vive en
 * la hoja del navegador, y cualquier `display` de autor le gana por origen. La
 * hoja de la librería lo restituye para todo su subárbol con una única regla; ver
 * el bloque `.dt-root [hidden]` en `styles/datatable.css`. Sin esa regla, toda
 * clase con `display` propio —`.dt-group-header`, `.dt-cell--box`, `.dt-tag`—
 * seguiría pintando el nodo que aquí se acaba de apagar.
 */
export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden === hidden) return
  node.hidden = hidden
}
