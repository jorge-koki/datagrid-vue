import { UNPAINTED_GENERATION, UNPAINTED_ROW_INDEX } from './constants'
import { TEXT_RENDERER_TYPE } from './renderers/shared'
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
    __dtTranslateY: Number.NaN,
    __dtRowKey: '',
    __dtStripe: false,
    __dtActiveRow: false,
    __dtAriaRow: -1,
    __dtAriaSelected: false,
    __dtCells: [] as PooledCellElement[],
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
