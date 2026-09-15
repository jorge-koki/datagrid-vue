import { ROW_KIND_DATA, UNPAINTED_GENERATION, UNPAINTED_ROW_INDEX } from './constants'
import { createElement, createSvgElement, TEXT_RENDERER_TYPE } from './renderers/shared'
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
  /** Celdas que posee esta fila, alineadas por índice con el tramo visible de columnas. */
  __dtCells: PooledCellElement[]
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
  /** Caja que contiene chevrón, etiqueta y contador. */
  readonly header: HTMLElement
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
  /** Última traslación horizontal de la cabecera, en px. */
  headerX: number
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
  /** Último `aria-colindex` escrito. */
  __dtAriaCol: number
  /** Último `aria-selected` escrito sobre la celda. */
  __dtAriaSelected: boolean
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
    __dtRowKey: '',
    __dtStripe: false,
    __dtActiveRow: false,
    __dtAriaRow: -1,
    __dtAriaSelected: false,
    __dtCells: [] as PooledCellElement[],
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

  header.appendChild(chevron)
  header.appendChild(label)
  header.appendChild(count)
  row.appendChild(header)

  return {
    header,
    label,
    count,
    aggregates: [],
    labelText: '',
    countText: '',
    countHidden: false,
    headerX: Number.NaN,
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
 * `tabindex="-1"` la vuelve enfocable por programa y por click sin meterla en el
 * orden de tabulación: con 450 celdas visibles, participar del tab order haría
 * imposible atravesar la tabla con el teclado. Es lo que permite que "Enter
 * sobre la celda enfocada" abra el editor.
 *
 * Los `as` sobre los literales `null` y `undefined` son ensanchamientos al tipo
 * declarado del campo, igual que el `[]` de {@link createRowElement}: sin ellos
 * el campo quedaría inferido como `null` o `undefined` y no admitiría ningún
 * valor posterior. Anotan un literal vacío, no afirman nada sobre un valor ya
 * construido, así que no pueden ocultar un tipo incorrecto.
 */
export function createCellElement(): PooledCellElement {
  const element = document.createElement('div')
  element.className = 'dt-cell'
  element.tabIndex = -1
  // Igual que el rol de la fila: estructural, se escribe una sola vez.
  element.setAttribute('role', 'gridcell')
  return Object.assign(element, {
    __dtColumnKey: '',
    __dtColumnDef: null as unknown,
    // Arranca declarando el tipo por defecto pero SIN handle: la primera pasada
    // de pintado detecta el handle nulo y ejecuta `create`.
    __dtRendererType: TEXT_RENDERER_TYPE,
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
    __dtAriaCol: -1,
    __dtAriaSelected: false,
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
 * Aplica la alineación de la columna como clase.
 *
 * `left` es el caso por defecto y no lleva clase, de modo que la mayoría de las
 * celdas nunca tocan `classList`.
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

/** Posiciona y dimensiona la cabecera de un grupo. Misma lógica que `setCellBox`. */
export function setGroupHeaderBox(parts: PooledGroupParts, x: number, width: number): void {
  if (parts.headerX !== x) {
    parts.headerX = x
    parts.header.style.transform = `translate3d(${x}px, 0, 0)`
  }
  if (parts.headerWidth !== width) {
    parts.headerWidth = width
    parts.header.style.width = `${width}px`
  }
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

/** Aplica la alineación de la columna a la celda de agregado. */
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
 */
export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden === hidden) return
  node.hidden = hidden
}
