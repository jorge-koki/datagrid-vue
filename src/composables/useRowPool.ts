import type { CellPosition, FlatRow, GroupRow, SelectionMode, VirtualWindow } from '../types'
import type { ResolvedColumn } from './useColumnLayout'
import type { RangeRect } from './useCellRange'
import type {
  PooledAggregateElement,
  PooledCellElement,
  PooledGroupParts,
  PooledRowElement,
  PooledRowNumberElement,
} from '../internal/dom'
import {
  clearCellContent,
  clearRowAriaLevel,
  clearRowAriaSet,
  clearRowExpanded,
  createAggregateElement,
  createCellElement,
  createGroupParts,
  createPinnedCellElement,
  createRowElement,
  createRowNumberElement,
  ensurePinnedLane,
  setAggregateAlign,
  setAggregateBox,
  setAggregateText,
  setCellActive,
  setCellAlign,
  setCellAriaIndex,
  setCellAriaSelected,
  setCellBox,
  setCellPlaceholder,
  setCellCustomClass,
  setCellEditing,
  setCellLayout,
  setCellPinnedEdge,
  setCellRange,
  setGroupCount,
  setGroupHeaderWidth,
  setGroupLabel,
  setHidden,
  setRowActive,
  setRowAriaIndex,
  setRowAriaLevel,
  setRowAriaSelected,
  setRowPlaceholder,
  setRowAriaSet,
  setRowExpanded,
  setRowGroupClass,
  setRowGroupDepth,
  setRowKey,
  setRowNumberActive,
  setRowNumberLabel,
  setRowNumberOffset,
  setRowNumberRange,
  setRowNumberStripe,
  setRowOffset,
  setRowStripe,
  setRowWidth,
} from '../internal/dom'
import {
  ROW_KIND_DATA,
  ROW_KIND_GROUP,
  ROW_POOL_SLACK,
  UNPAINTED_ROW_INDEX,
} from '../internal/constants'
import { formatCellValue, rawValuesEqual, readRawValue, toCellValue } from '../internal/values'
import { resolveRenderer, revertCheckbox, TEXT_CELL_LAYOUT } from '../internal/renderers'
import type { CellRenderer } from '../types'

/**
 * Motor imperativo de pintado: pool de nodos DOM reciclados.
 *
 * ## Por qué esto no es un `v-for`
 *
 * Con 30 filas visibles por 15 columnas hay ~450 celdas en pantalla. Si esas
 * celdas fueran nodos del VDOM, cada frame de scroll implicaría ~450 diffs de
 * vnode más la reconciliación de sus 30 padres, y todo eso dentro del
 * presupuesto de 16ms. No entra. Peor aún: una `ref()` profunda sobre 10k filas
 * crea 10k Proxies, y el costo de memoria y de tracking aparece incluso cuando
 * nadie scrollea.
 *
 * La salida es partir el problema: Vue conserva la estructura y la configuración
 * —que cambian rara vez y se benefician de ser declarativas— y este módulo
 * conserva el camino caliente, donde la reactividad no aporta nada porque ya
 * sabemos exactamente qué cambió.
 *
 * ## Las cuatro reglas del pool
 *
 * 1. **Los nodos se reciclan, no se crean.** El pool crece cuando crece la
 *    cantidad visible y nunca se achica durante el scroll. Crear y destruir
 *    nodos en cada frame anularía todo el beneficio.
 * 2. **Escribir solo lo que cambió.** Cada nodo recuerda lo último que se le
 *    pintó (ver `internal/dom.ts`). Un repintado con las mismas entradas es un
 *    no-op real, sin una sola escritura al DOM.
 * 3. **Un solo listener.** Los eventos se delegan en el contenedor. 450
 *    listeners por frame serían 450 registros y 450 bajas.
 * 4. **El pool se segmenta por tipo de renderer.** El contenido de una celda no
 *    es necesariamente texto: lo construye un {@link CellRenderer}. Como los
 *    nodos se reciclan por slot horizontal, un mismo nodo puede pasar de una
 *    columna a otra con renderer distinto, y ahí hay que reconstruirlo. Ver
 *    `ensureRenderer`, que es el punto más sutil de este archivo.
 * 5. **Y se segmenta también por tipo de FILA.** Con agrupación activa, la
 *    secuencia visible intercala cabeceras de grupo entre las filas de datos, y
 *    las dos estructuras no se parecen en nada. Es el mismo peligro que resuelve
 *    `ensureRenderer`, un eje más arriba. Ver `ensureRowKind`.
 *
 * ## El pool ROTA: por qué un paso de scroll no repinta la ventana
 *
 * El mapeo fila -> slot es `rowIndex % poolSize`, no `rowIndex - rowRange.start`.
 * La diferencia es toda la tesis de este archivo.
 *
 * Con el mapeo por resta, el slot 0 es siempre la fila superior visible: al
 * scrollear una sola fila, las N filas visibles cambian de índice y las N
 * repintan, aunque N-1 de ellas sigan en pantalla mostrando exactamente el mismo
 * dato. Con el mapeo por módulo, una fila que sigue visible conserva su slot, y
 * conservar el slot significa conservar el mismo nodo del DOM con el mismo
 * `__dtRowIndex`: el caché de `internal/dom.ts` corta antes de tocar el DOM y esa
 * fila no escribe absolutamente nada. Solo repintan las filas que ENTRARON.
 *
 * Esto es posible porque las filas se posicionan con `translate3d`, así que el
 * orden del DOM ya es irrelevante para el orden visual. Rotar reordena qué nodo
 * muestra qué fila, nunca dónde se ve cada fila: la rotación es invisible.
 *
 * El costo por frame pasa de ser proporcional al TAMAÑO DE LA VENTANA a ser
 * proporcional a la CANTIDAD DE FILAS QUE ENTRARON, con el tamaño de la ventana
 * como cota superior para un salto largo. Un paso de scroll sobre una ventana de
 * 10x3 pasa de 60 escrituras a 6.
 *
 * ### Los dos ejes rotan, y el horizontal se decidió midiendo
 *
 * La duda razonable era el eje horizontal. A diferencia de las filas, las
 * columnas tienen ancho VARIABLE, así que cuántas entran en el viewport depende
 * de dónde se esté parado: la base del módulo —la cantidad de celdas del pool de
 * una fila— se mueve mientras se scrollea, y cada vez que crece hay que rehashear
 * todas las celdas de todas las filas visibles. Además, con la base por encima de
 * la cantidad de columnas visibles quedan celdas sobrantes que se ocultan y se
 * muestran al rotar, y eso cuesta escrituras de `hidden` por FILA, no por frame.
 * Con las columnas siendo un orden de magnitud menos que las filas, era
 * perfectamente plausible que la rotación horizontal no se pagara sola.
 *
 * Se midió en lugar de suponer, sobre una ventana de 10 filas x 5 columnas de
 * ancho variable, contando escrituras reales al DOM con la grabadora de la suite:
 *
 * | Escenario                              | Sin rotar | Rotando | Factor |
 * | -------------------------------------- | --------- | ------- | ------ |
 * | Un paso horizontal, 5 columnas fijas   |       199 |      40 |  5,0x  |
 * | Paso que ensancha la ventana (5 -> 6)  |       289 |     130 |  2,2x  |
 * | Paso que angosta la ventana (6 -> 5)   |       209 |      10 | 20,9x  |
 * | 12 pasos con la ventana oscilando 5<->6|      1598 |     390 |  4,1x  |
 * | 12 pasos con la ventana estable        |      2293 |     420 |  5,5x  |
 *
 * El costo del rehash es real y se ve en la fila del ensanchamiento, que es la de
 * peor factor; lo que la hipótesis subestimaba es que ese rehash es un evento
 * ACOTADO. `growCells` solo crece, así que la base se estabiliza en la cantidad
 * máxima de columnas que llegaron a entrar, exactamente igual que el pool de
 * filas. La oscilación posterior de la ventana ya no mueve la base: angostar sale
 * casi gratis porque las columnas que se quedan conservan su slot. Incluso en el
 * barrido con la ventana oscilando en cada paso —el caso construido para que la
 * rotación se vea lo peor posible— rotar cuesta cuatro veces menos.
 *
 * Con anchos de columna uniformes el escenario "ventana estable" es el único que
 * ocurre, y ahí el factor es 5,5x.
 *
 * Los dos ejes son seguros de rotar por el mismo motivo: `.dt-row` y `.dt-cell`
 * son `position: absolute` y se posicionan con `transform`, así que el orden del
 * DOM no interviene en el orden visual de ninguno de los dos. Y la posición que
 * anuncia un lector de pantalla viaja por `aria-rowindex` y `aria-colindex`, que
 * es justamente para lo que estaban desde el principio.
 *
 * ## Qué indexa `rowIndex` cuando hay grupos
 *
 * La SECUENCIA VISIBLE, no la prop `rows`. Con `flatRows` en `null` —sin
 * agrupación— las dos coinciden y el pool recorre exactamente el camino de
 * siempre: se indexa `state.rows` y no se asigna ni se compara nada de más. Con
 * agrupación, `flatRows` dice qué hay en cada posición visible, y cada fila de
 * datos trae adosado su índice ORIGINAL para que `data-row-key` y los eventos de
 * edición sigan hablando del dataset del consumidor.
 *
 * ## Por qué es TypeScript plano
 *
 * No hay `ref`, `computed` ni `watch` en este archivo. Conserva el nombre
 * `useRowPool` por convención del proyecto, pero es una factory: no depende del
 * ciclo de vida de Vue, no registra hooks y se puede instanciar y testear sin
 * montar un componente.
 */

/** Callbacks de interacción, cableados con un único listener delegado. */
export interface RowPoolCallbacks {
  /** Doble click sobre una celda. Es el disparador principal de edición. */
  onCellDoubleClick?: (position: CellPosition) => void
  /** Click sobre cualquier parte de una fila. */
  onRowClick?: (rowIndex: number) => void
  /**
   * El usuario apuntó a una celda con un clic simple o un toque.
   *
   * Se dispara en `pointerdown` y no en `click` para que la marca aparezca
   * apenas se aprieta, sin esperar a que se suelte. Selecciona; no edita.
   */
  onCellPointerDown?: (position: CellPosition) => void
  /**
   * Igual, pero con `Shift` apretado: EXTIENDE en vez de mover.
   *
   * Es un callback aparte y no un parámetro de {@link RowPoolCallbacks.onCellPointerDown}
   * porque son dos acciones distintas sobre dos estados distintos —una mueve el
   * ancla, la otra mueve el foco—, y meterlas en el mismo camino obligaría a
   * decidir cuál es en dos lugares: acá y del otro lado.
   */
  onCellShiftPointerDown?: (position: CellPosition) => void
  /**
   * El puntero pasó por una celda con el botón primario apretado.
   *
   * Solo llega entre un `pointerdown` sobre una celda y el `pointerup` que lo
   * cierra: fuera del arrastre no hay listener de movimiento registrado, así que
   * mover el mouse sobre la tabla no cuesta absolutamente nada.
   */
  onCellDragOver?: (position: CellPosition) => void
  /**
   * El usuario apretó sobre el número de una fila, en la regleta.
   *
   * Llega con la posición VISIBLE de esa fila. Qué significa el gesto lo decide
   * el componente: el pool no sabe si la tabla permite seleccionar filas enteras.
   */
  onRowNumberPointerDown?: (rowIndex: number) => void
  /**
   * El usuario pidió cambiar el valor de una casilla.
   *
   * Es una INTENCIÓN, no un hecho consumado: el pool ya revirtió el estado
   * visual, y quien reciba esto debe pasarlo por la tubería de edición. Si se
   * veta o no se persiste, la casilla queda como estaba.
   */
  onCellToggle?: (position: CellPosition, nextValue: boolean) => void
  /**
   * Click sobre una cabecera de grupo, en cualquier parte de ella.
   *
   * Viaja por el MISMO listener delegado que el resto: el chevrón no registra
   * nada propio. Un listener por cabecera de grupo visible sería exactamente el
   * costo que la regla 3 existe para evitar, y encima sobre nodos que se reciclan.
   */
  onGroupToggle?: (groupId: string) => void
}

/**
 * Todo lo que el pool necesita para pintar un frame.
 *
 * Es un objeto plano y no reactivo a propósito: lo arma el componente en cada
 * frame leyendo valores ya resueltos, de modo que el pool nunca suscribe nada
 * ni dispara efectos al leerlo.
 */
export interface RowPoolPaintState<TRow> {
  /**
   * El dataset. El pool indexa, nunca copia ni recorre entero.
   *
   * Puede tener huecos: en modo servidor, `rows[i]` es `undefined` mientras esa
   * página no llegó. El pool ya lo trataba como un estado normal —ver la guarda
   * de `noUncheckedIndexedAccess` en el bucle de pintado—, así que esto no es
   * una concesión nueva sino el tipo diciendo lo que el código ya hacía.
   */
  rows: readonly (TRow | undefined)[]
  /**
   * Secuencia visible aplanada, o `null`/ausente cuando no hay agrupación.
   *
   * `null` no significa "todavía no está": significa que `rowRange` indexa
   * directo en `rows`, que es el camino sin agrupación y el que no debe pagar
   * nada por esta función. La rama se decide UNA vez por pintado, no por fila.
   */
  flatRows?: readonly FlatRow<TRow>[] | null
  /** Niveles de agrupación. Alimenta el `aria-level` de las filas de datos. */
  groupDepth?: number
  /** Si la cabecera de grupo muestra su contador de filas. */
  showGroupCount?: boolean
  /**
   * Si un hueco en `rows` significa "todavía no llegó" en lugar de "no existe".
   *
   * Lo enciende el modo servidor. Apagado —el caso normal— un `undefined` retira
   * la fila, que es lo que corresponde cuando `rows` se acortó entre el cálculo
   * de la ventana y el pintado.
   */
  placeholders?: boolean
  /** Tramo vertical de filas a pintar. */
  rowRange: VirtualWindow
  /** Tramo horizontal de columnas a pintar, ya recortado por el componente. */
  columns: readonly ResolvedColumn<TRow>[]
  /**
   * Columnas ancladas a los bordes, que NO entran en la ventana virtual.
   *
   * Se pintan siempre y sobre nodos propios. Que estén fuera de `columns` no es
   * un detalle de implementación: si además cayeran en la ventana se pintarían
   * dos veces, la copia anclada quieta en el borde y la suelta pasando por
   * debajo con el scroll.
   */
  pinnedColumns?: readonly ResolvedColumn<TRow>[]
  /**
   * Ancho total de la tabla en px: la suma de las columnas visibles más la
   * regleta de numeración. Es el ancho del canvas.
   *
   * El pool lo necesita para dos cosas, y ninguna depende del scroll: dárselo a
   * cada fila —que sin ancho propio no puede sostener sus carriles anclados— y
   * ubicar las columnas ancladas al FINAL, cuyo carril cuelga del borde derecho
   * de la fila y por lo tanto las mide desde ahí hacia atrás.
   */
  totalWidth: number
  /** Altura de fila en px. */
  rowHeight: number
  /** Celda con el editor abierto, o `null`. */
  editing: CellPosition | null
  /** Celda activa, o `null`. */
  active: CellPosition | null
  /**
   * Rectángulo seleccionado, o `null`/ausente si la selección es una sola celda.
   *
   * Sus límites horizontales son índices dentro de las columnas VISIBLES, que es
   * lo mismo que indexa `ResolvedColumn.index`: así la comprobación por celda es
   * una comparación de enteros y no una búsqueda de clave.
   */
  range?: RangeRect | null
  /** Modo de selección vigente. Decide dónde se anuncia `aria-selected`. */
  selectionMode: SelectionMode
  /** Si hay que alternar el fondo de las filas impares. */
  stripe: boolean
  /** Resuelve la clave estable de una fila para el atributo `data-row-key`. */
  resolveRowKey: (row: TRow, rowIndex: number) => string
}

/**
 * Datos del frame que son iguales para todas las celdas.
 *
 * Se arma una vez por pintado y se pasa por referencia. Alternativa descartada:
 * seguir sumando parámetros posicionales a `paintCell`, que ya llevaba seis y es
 * donde un argumento fuera de orden pasa más desapercibido.
 */
interface PaintFrame {
  /** `document.activeElement`, leído una sola vez por frame. */
  activeElement: Element | null
  /** Fila con el editor abierto, o el centinela. */
  editingRowIndex: number
  /** Columna con el editor abierto. */
  editingColumnKey: string
  /** Fila activa, o el centinela. */
  activeRowIndex: number
  /** Columna activa. */
  activeColumnKey: string
  /** Si la marca de selección corresponde a la celda y no a la fila. */
  cellSelectionActive: boolean
  /** Rectángulo seleccionado, o `null`. Ver {@link RowPoolPaintState.range}. */
  range: RangeRect | null
  /** Ancho total de la tabla. Ver {@link RowPoolPaintState.totalWidth}. */
  totalWidth: number
  /**
   * Cuántas de las columnas ancladas lo están al INICIO.
   *
   * Las ancladas llegan ordenadas —primero las del inicio, después las del
   * final—, así que este número dice por sí solo cuál celda lleva la línea del
   * corte de cada lado: la de índice `n - 1` y la de índice `n`.
   */
  pinnedStartCount: number
}

/** API del pool de filas. */
export interface RowPool<TRow> {
  /**
   * Adopta el contenedor donde se inyectan las filas y registra la delegación.
   *
   * El segundo host es el carril de numeración. Es opcional porque una tabla que
   * no numera no lo renderiza, y entonces el pool tampoco crea sus nodos.
   */
  mount(container: HTMLElement, gutter?: HTMLElement | null): void
  /** Libera nodos, listeners y referencias. Idempotente. */
  unmount(): void
  /** Pinta un frame. Con entradas idénticas no escribe nada en el DOM. */
  paint(state: RowPoolPaintState<TRow>): void
  /**
   * Recorta el pool a la cantidad visible más un margen.
   *
   * Solo debe llamarse ante un cambio de tamaño del viewport, jamás durante el
   * scroll: achicar el pool mientras se scrollea destruiría los mismos nodos que
   * el próximo frame va a necesitar.
   *
   * Achicar el pool mueve la base de la rotación, así que invalida el mapeo
   * fila -> slot de todos los nodos que sobreviven. Hasta el próximo `paint`,
   * `getCellElement` devuelve `null` para cualquier fila: es la respuesta
   * correcta, porque en ese intervalo ningún nodo representa con certeza a la
   * fila que dice representar.
   */
  trim(visibleRowCount: number): void
  /**
   * Invalida el caché de valores de todas las celdas.
   *
   * El caché compara valor crudo, fila, columna y definición de columna, y en el
   * próximo pintado detectaría cualquiera de esos cambios. Lo que no hace es
   * provocar ese pintado: invalidar no agenda un frame. Quien mute una fila en
   * el lugar tiene que pedir el repintado además de invalidar, y por eso
   * `refresh()` en el componente hace las dos cosas.
   *
   * Lo que el caché no puede ver de ningún modo es que `format` o `cellClass`
   * produzcan otra salida a partir de estado ajeno a la fila: un locale, una
   * cotización o un conjunto de selección capturados por closure. En esos casos
   * los datos de entrada son idénticos y el texto resultante no, y esta es la
   * única forma de anunciarlo.
   */
  invalidate(): void
  /** Nodo DOM de una celda pintada, o `null` si esa celda no está en la ventana. */
  getCellElement(rowIndex: number, columnKey: string): HTMLElement | null
}

/**
 * Crea un pool de filas.
 *
 * @typeParam TRow - Forma de una fila. Debe ser indexable por string para que
 * funcione la lectura por defecto `row[column.key]`.
 */
export function useRowPool<TRow extends Record<string, unknown>>(
  callbacks: RowPoolCallbacks = {},
): RowPool<TRow> {
  /** Contenedor adoptado en `mount`. Es el `.dt-canvas` del componente. */
  let container: HTMLElement | null = null

  /** Carril de numeración adoptado en `mount`, o `null` si la tabla no numera. */
  let gutterHost: HTMLElement | null = null

  /**
   * Nodos de fila indexados por slot del pool.
   *
   * El slot de una fila es `rowIndex % rows.length`, así que el orden de este
   * array NO coincide con el orden visual: el slot 0 puede estar mostrando la
   * última fila de la ventana. Lo que importa es que una fila que sigue visible
   * después de un scroll conserva su slot, y por lo tanto su nodo. Ver el bloque
   * "El pool ROTA" en la cabecera del archivo.
   */
  const rows: PooledRowElement[] = []

  /** Generación de pintado. `invalidate()` la incrementa para forzar repintado total. */
  let generation = 0

  /** Lista vacía compartida, para no asignar una por frame sin columnas ancladas. */
  const EMPTY_COLUMNS: readonly ResolvedColumn<TRow>[] = []

  function mount(target: HTMLElement, gutter: HTMLElement | null = null): void {
    if (container === target && gutterHost === gutter) return
    unmount()
    container = target
    gutterHost = gutter
    // Un listener por tipo de evento para toda la tabla. La resolución de qué
    // celda se tocó se hace al vuelo en el handler, que corre en respuesta a una
    // acción del usuario y no dentro del presupuesto de frame.
    container.addEventListener('dblclick', handleDoubleClick)
    container.addEventListener('click', handleClick)
    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('change', handleChange)
    // La regleta es otro contenedor, así que necesita su propio listener. Sigue
    // siendo uno solo para todos los números, que es la regla de siempre.
    gutterHost?.addEventListener('pointerdown', handleGutterPointerDown)
  }

  /**
   * Cierra el renderer de una fila que se va a descartar.
   *
   * Un renderer puede haber tomado recursos que el garbage collector no alcanza
   * por sí solo (un ResizeObserver, un timer, un listener sobre un nodo interno),
   * así que sacar el nodo del DOM no basta.
   */
  function releaseRow(rowNode: PooledRowElement): void {
    for (const cellNode of [...rowNode.__dtCells, ...rowNode.__dtPinnedCells]) {
      const handle = cellNode.__dtHandle
      if (handle) cellNode.__dtRenderer?.destroy?.(handle)
      cellNode.__dtHandle = null
      cellNode.__dtRenderer = null
    }
    rowNode.__dtNumber?.remove()
    rowNode.__dtNumber = null
    rowNode.remove()
  }

  function unmount(): void {
    if (container) {
      // Antes de soltar el contenedor: `endDrag` necesita su documento para dar
      // de baja los listeners, y con `container` ya en `null` no tendría dónde.
      endDrag()
      container.removeEventListener('dblclick', handleDoubleClick)
      container.removeEventListener('click', handleClick)
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('change', handleChange)
      gutterHost?.removeEventListener('pointerdown', handleGutterPointerDown)
      for (const row of rows) releaseRow(row)
    }
    rows.length = 0
    container = null
    gutterHost = null
  }

  function invalidate(): void {
    generation += 1
  }

  /**
   * Agranda el pool hasta `count` filas.
   *
   * Los nodos nuevos se insertan de una sola vez con un `DocumentFragment`: N
   * `appendChild` sueltos sobre un elemento ya en el documento provocan N
   * invalidaciones de layout, mientras que el fragmento las colapsa en una.
   */
  function growRows(count: number): void {
    if (!container || rows.length >= count) return

    const fragment = document.createDocumentFragment()
    // El carril de numeración crece con el mismo fragmento y en el mismo paso:
    // un nodo de fila y su número nacen juntos y comparten slot para siempre.
    const numbers = gutterHost ? document.createDocumentFragment() : null

    while (rows.length < count) {
      const node = createRowElement()
      if (numbers) {
        const number = createRowNumberElement()
        node.__dtNumber = number
        numbers.appendChild(number)
      }
      rows.push(node)
      fragment.appendChild(node)
    }

    container.appendChild(fragment)
    if (numbers && gutterHost) gutterHost.appendChild(numbers)
  }

  /** Agranda el pool de celdas de una fila hasta `count`. Misma lógica que las filas. */
  function growCells(row: PooledRowElement, count: number): void {
    const cells = row.__dtCells
    if (cells.length >= count) return

    const fragment = document.createDocumentFragment()
    while (cells.length < count) {
      const cell = createCellElement()
      cells.push(cell)
      fragment.appendChild(cell)
    }
    row.appendChild(fragment)
  }

  /**
   * Lo mismo para las celdas ancladas, que son un puñado y no rotan.
   *
   * A diferencia de las otras, nacen SUELTAS: de qué carril cuelga cada una
   * depende del borde al que esté anclada su columna, y eso lo resuelve
   * `paintPinnedCells`, que es quien ve la columna.
   */
  function growPinnedCells(row: PooledRowElement, count: number): void {
    const cells = row.__dtPinnedCells
    while (cells.length < count) cells.push(createPinnedCellElement())
  }

  function trim(visibleRowCount: number): void {
    const keep = Math.max(0, Math.floor(visibleRowCount)) + ROW_POOL_SLACK
    if (rows.length <= keep) return

    while (rows.length > keep) {
      const node = rows.pop()
      if (node) releaseRow(node)
    }

    // El tamaño del pool es la base del módulo, así que achicarlo corre el slot
    // de TODAS las filas que sobreviven. Se marcan como no pintadas para que
    // `getCellElement` no devuelva un nodo que ya no representa lo que dice
    // representar durante la ventana que va desde acá hasta el próximo pintado.
    // El pintado siguiente recalcula el slot de cada fila y repinta lo que
    // efectivamente cambió; `setRowKey` y `setRowAriaIndex` tienen su propio
    // caché, así que una fila que conserva su índice no vuelve a escribir.
    for (const node of rows) node.__dtRowIndex = UNPAINTED_ROW_INDEX
  }

  /**
   * Slot que le corresponde a un índice dentro de un pool de `poolSize` nodos.
   *
   * Sirve para los dos ejes: un índice de fila contra el pool de filas, o un
   * índice de columna contra el pool de celdas de una fila.
   *
   * El doble módulo cubre el argumento negativo, que aparece al despejar el
   * índice a partir de un slot: `-1 % 10` es `-1` en JavaScript, y un índice
   * negativo saldría del array.
   */
  function slotFor(index: number, poolSize: number): number {
    return ((index % poolSize) + poolSize) % poolSize
  }

  /**
   * Índice que le toca pintar a un slot, o `-1` si al slot no le toca ninguno.
   *
   * Es la inversa de {@link slotFor} acotada a la ventana: el slot
   * `(start + k) % poolSize` corresponde al índice `start + k`, y solo hay índice
   * si ese `k` cae dentro de los `count` elementos visibles. Como `count` nunca
   * supera `poolSize` —`growRows` y `growCells` lo garantizan— el mapeo es
   * inyectivo y ningún slot puede reclamar dos índices.
   *
   * Que esta función se evalúe para TODOS los slots en cada pintado es lo que
   * vuelve intrínsecamente seguro el cambio de tamaño del pool: cuando la base
   * del módulo se mueve, cada slot recibe el índice que le corresponde con la
   * base nueva o se oculta, y no queda nada viejo pintado. No hace falta una
   * pasada de invalidación aparte, y no puede quedar un slot sin visitar.
   */
  function windowIndexForSlot(
    slot: number,
    start: number,
    count: number,
    poolSize: number,
  ): number {
    if (count <= 0) return -1
    const offset = slotFor(slot - start, poolSize)
    return offset < count ? start + offset : -1
  }

  function paint(state: RowPoolPaintState<TRow>): void {
    if (!container) return

    const { rowRange, columns, rowHeight, editing, active, selectionMode, stripe, totalWidth } =
      state
    // Se resuelven una vez por pintado. Con `flatRows` en `null` el bucle de
    // filas ni siquiera mira la agrupación: es una comparación contra `null` por
    // FILA VISIBLE, no por celda, y es lo único que el camino sin grupos paga.
    const flatRows = state.flatRows ?? null
    const groupDepth = state.groupDepth ?? 0
    const showGroupCount = state.showGroupCount ?? true
    // Fuera del modo servidor un hueco en `rows` no es "todavía no llegó" sino
    // "no existe", y la fila se retira. Es una lectura por pintado, no por fila.
    const placeholders = state.placeholders ?? false
    const visibleRowCount = Math.max(0, rowRange.end - rowRange.start)
    const visibleColumnCount = columns.length
    // Índice ABSOLUTO de la primera columna del tramo, que es la base de la
    // rotación horizontal. `columns` llega ya recortado, así que su índice 0 no
    // es la columna 0 de la tabla; `ResolvedColumn.index` sí es la posición real
    // dentro de las columnas visibles y es lo único con lo que el módulo tiene
    // sentido de un frame al siguiente.
    const columnStart = columns[0]?.index ?? 0

    growRows(visibleRowCount)

    // Los renderers se resuelven una vez por COLUMNA, no por celda. Resolver
    // adentro del bucle costaría una búsqueda en el registro por cada una de las
    // ~450 celdas visibles; resolver acá son ~15 búsquedas y un array chico por
    // frame, del mismo orden que el `slice` de columnas visibles.
    // Se empuja una entrada por slot incluso si la columna faltara, para que el
    // array quede alineado por índice con `columns`: un `continue` correría los
    // renderers de todos los slots siguientes.
    const renderers: CellRenderer<TRow>[] = []
    for (let index = 0; index < visibleColumnCount; index += 1) {
      renderers.push(resolveRenderer<TRow>(columns[index]?.column.renderer))
    }

    const pinnedColumns = state.pinnedColumns ?? EMPTY_COLUMNS
    const pinnedRenderers: CellRenderer<TRow>[] = []
    let pinnedStartCount = 0
    for (const column of pinnedColumns) {
      pinnedRenderers.push(resolveRenderer<TRow>(column.column.renderer))
      if (column.pinned === 'start') pinnedStartCount += 1
    }

    // Se lee una sola vez por frame en lugar de una vez por celda: es un getter
    // barato, pero 450 lecturas por frame dejan de serlo.
    const activeElement = document.activeElement
    const editingRowIndex = editing ? editing.rowIndex : UNPAINTED_ROW_INDEX
    const editingColumnKey = editing ? editing.columnKey : ''

    // La celda activa se resuelve por COMPARACIÓN, no por búsqueda: se
    // desarma la posición una vez por frame y cada celda compara dos valores
    // que ya tiene a mano. No hay un barrido extra sobre las celdas visibles
    // preguntando "¿sos vos la activa?", y al moverse la selección solo escriben
    // las dos celdas cuyo estado cambió de verdad.
    const activeRowIndex = active ? active.rowIndex : UNPAINTED_ROW_INDEX
    const activeColumnKey = active ? active.columnKey : ''

    // Contexto del frame: una sola asignación por pintado, no una por celda.
    // Evita arrastrar ocho parámetros posicionales hasta `paintCell`, que es
    // donde un argumento fuera de orden pasa más desapercibido.
    const frame: PaintFrame = {
      activeElement,
      editingRowIndex,
      editingColumnKey,
      activeRowIndex,
      activeColumnKey,
      // En modo `row` la marca la lleva la fila entera, así que la celda no
      // debe anunciarse como seleccionada ni pintar su anillo.
      cellSelectionActive: selectionMode === 'cell',
      range: selectionMode === 'cell' ? (state.range ?? null) : null,
      totalWidth: state.totalWidth,
      pinnedStartCount,
    }

    // Se lee una sola vez: es la base del módulo de toda la rotación y no puede
    // cambiar en medio del recorrido, porque `growRows` ya terminó.
    const poolSize = rows.length

    for (let slot = 0; slot < poolSize; slot += 1) {
      const rowNode = rows[slot]
      if (!rowNode) continue

      const rowIndex = windowIndexForSlot(slot, rowRange.start, visibleRowCount, poolSize)

      // Los slots sobrantes se ocultan, no se eliminan: el próximo scroll hacia
      // abajo o un resize los va a volver a pedir. Con el pool rotando, cuál es
      // el slot sobrante cambia en cada paso, pero la CANTIDAD de sobrantes es
      // siempre `poolSize - visibleRowCount`.
      if (rowIndex < 0) {
        if (rowNode.__dtRowIndex !== UNPAINTED_ROW_INDEX) {
          rowNode.__dtRowIndex = UNPAINTED_ROW_INDEX
        }
        setHidden(rowNode, true)
        hideRowNumber(rowNode)
        continue
      }

      // Antes de bifurcar entre datos y cabecera de grupo: las dos son filas y
      // las dos necesitan el ancho, que es lo que sostiene a los carriles
      // anclados y lo que hace que el rayado llegue hasta el borde de la tabla.
      setRowWidth(rowNode, totalWidth)

      // Sin agrupación, la fila de la posición visible `rowIndex` es
      // `rows[rowIndex]` y su índice original es el mismo número. Con
      // agrupación, las dos cosas las dice el aplanado.
      let row: TRow | undefined
      let sourceRowIndex = rowIndex

      if (flatRows !== null) {
        const entry = flatRows[rowIndex]
        if (entry === undefined) {
          retireRow(rowNode)
          continue
        }
        if (entry.kind === 'group') {
          paintGroupRow(rowNode, entry, rowIndex, columns, rowHeight, frame, showGroupCount)
          // La regleta acompaña a la cabecera con su casilla vacía: una cabecera
          // ocupa una posición visible pero no es una fila del dataset, y
          // numerarla haría que el usuario contara filas que no existen.
          paintRowNumber(
            rowNode,
            rowIndex * rowHeight,
            '',
            false,
            rowIndex === activeRowIndex,
            rowIsInRange(frame.range, rowIndex),
          )
          continue
        }
        row = entry.row
        sourceRowIndex = entry.rowIndex
      } else {
        row = state.rows[rowIndex]
      }

      // Guarda de `noUncheckedIndexedAccess`. Además cubre DOS casos reales, y
      // hay que distinguirlos: que `rows` se haya acortado entre el cálculo de la
      // ventana y este pintado —no hay nada ahí, la fila se retira— o que la
      // tabla esté en modo servidor y esa página todavía no haya llegado, que es
      // un estado normal y tiene que verse como tal.
      if (row === undefined) {
        if (placeholders) {
          paintPlaceholderRow(rowNode, rowIndex, columns, pinnedColumns, rowHeight, frame)
        } else {
          retireRow(rowNode)
        }
        continue
      }

      ensureRowKind(rowNode, ROW_KIND_DATA)
      setRowPlaceholder(rowNode, false)

      const striped = stripe && rowIndex % 2 === 1
      setHidden(rowNode, false)
      setRowOffset(rowNode, rowIndex * rowHeight)
      setRowStripe(rowNode, striped)
      // La identidad de una fila pintada son sus DOS índices. Sin grupos el
      // segundo es redundante; con grupos, expandir o colapsar corre las filas de
      // abajo sin cambiar su posición visible, y comparar solo la posición
      // dejaría `data-row-key` apuntando a la fila anterior.
      if (rowNode.__dtRowIndex !== rowIndex || rowNode.__dtSourceRowIndex !== sourceRowIndex) {
        rowNode.__dtRowIndex = rowIndex
        rowNode.__dtSourceRowIndex = sourceRowIndex
        setRowKey(rowNode, state.resolveRowKey(row, sourceRowIndex))
        setRowAriaIndex(rowNode, rowIndex)
      }

      // Las filas de datos de un `treegrid` cuelgan un nivel por debajo del
      // último grupo. Es un número constante mientras no cambie la agrupación,
      // así que se escribe una vez por nodo y el caché lo saltea después.
      if (groupDepth > 0) setRowAriaLevel(rowNode, groupDepth + 1)
      else clearRowAriaLevel(rowNode)

      const rowIsActive = rowIndex === activeRowIndex
      setRowActive(rowNode, rowIsActive)
      // El número es la POSICIÓN VISIBLE, en base 1: es lo que el usuario cuenta
      // con el dedo en la pantalla. No es el índice dentro de `rows`, que con
      // grupos activos ni siquiera es contiguo.
      paintRowNumber(
        rowNode,
        rowIndex * rowHeight,
        String(rowIndex + 1),
        striped,
        rowIsActive,
        rowIsInRange(frame.range, rowIndex),
      )
      // En modo `row` la fila es la unidad seleccionada y lo anuncia; en modo
      // `cell` lo anuncia la celda, y marcar además la fila duplicaría el
      // anuncio del lector de pantalla.
      setRowAriaSelected(rowNode, selectionMode === 'row' && rowIsActive)

      growCells(rowNode, visibleColumnCount)
      growPinnedCells(rowNode, pinnedColumns.length)
      const cells = rowNode.__dtCells
      const cellPoolSize = cells.length

      for (let slotIndex = 0; slotIndex < cellPoolSize; slotIndex += 1) {
        const cellNode = cells[slotIndex]
        if (!cellNode) continue

        // Mismo módulo que en las filas, con la columna absoluta como índice y el
        // pool de celdas de esta fila como base. `columnStart` se resta después
        // para volver a la posición dentro del tramo recortado que llegó por
        // `columns`, que es lo que indexan `columns` y `renderers`.
        const columnIndex = windowIndexForSlot(
          slotIndex,
          columnStart,
          visibleColumnCount,
          cellPoolSize,
        )
        if (columnIndex < 0) {
          setHidden(cellNode, true)
          continue
        }

        const local = columnIndex - columnStart
        const resolved = columns[local]
        const renderer = renderers[local]
        if (!resolved || !renderer) {
          setHidden(cellNode, true)
          continue
        }

        paintCell(cellNode, resolved, renderer, row, rowIndex, frame, resolved.offset)
      }

      paintPinnedCells(rowNode, pinnedColumns, pinnedRenderers, row, rowIndex, frame)
    }
  }

  /**
   * Pinta una fila cuyos datos todavía no llegaron del servidor.
   *
   * Es una fila de datos en todo salvo en los datos: ocupa su lugar, lleva su
   * número en la regleta —la posición se conoce aunque el contenido no— y sus
   * celdas quedan en la posición exacta de sus columnas. Eso último es lo que
   * hace que las barras del marcador queden alineadas con el encabezado en lugar
   * de ser una franja gris que no se corresponde con nada.
   *
   * No se toca ningún renderer ni ningún `format` del consumidor: no hay fila que
   * pasarles, y fabricar una vacía haría reventar al primer `format` que lea una
   * propiedad. Las celdas se vacían y el dibujo lo hace el CSS.
   */
  function paintPlaceholderRow(
    rowNode: PooledRowElement,
    rowIndex: number,
    columns: readonly ResolvedColumn<TRow>[],
    pinnedColumns: readonly ResolvedColumn<TRow>[],
    rowHeight: number,
    frame: PaintFrame,
  ): void {
    ensureRowKind(rowNode, ROW_KIND_DATA)
    setRowPlaceholder(rowNode, true)

    setHidden(rowNode, false)
    setRowOffset(rowNode, rowIndex * rowHeight)
    setRowWidth(rowNode, frame.totalWidth)
    setRowStripe(rowNode, false)
    setRowActive(rowNode, false)
    setRowAriaSelected(rowNode, false)

    // La clave deja de significar algo mientras no haya fila. Se borra en lugar
    // de dejar la anterior, que apuntaría a una fila que ya no está ahí.
    if (rowNode.__dtRowIndex !== rowIndex || rowNode.__dtSourceRowIndex !== rowIndex) {
      rowNode.__dtRowIndex = rowIndex
      rowNode.__dtSourceRowIndex = rowIndex
      setRowKey(rowNode, '')
      setRowAriaIndex(rowNode, rowIndex)
    }

    // El número SÍ se sabe: es la posición, no el dato.
    paintRowNumber(rowNode, rowIndex * rowHeight, String(rowIndex + 1), false, false, false)

    growCells(rowNode, columns.length)
    const cells = rowNode.__dtCells
    for (let slotIndex = 0; slotIndex < cells.length; slotIndex += 1) {
      const cellNode = cells[slotIndex]
      if (!cellNode) continue

      const columnIndex = windowIndexForSlot(
        slotIndex,
        columns[0]?.index ?? 0,
        columns.length,
        cells.length,
      )
      const resolved = columnIndex < 0 ? undefined : columns[columnIndex - (columns[0]?.index ?? 0)]
      if (!resolved) {
        setHidden(cellNode, true)
        continue
      }

      setHidden(cellNode, false)
      setCellPlaceholder(cellNode, true)
      setCellBox(cellNode, resolved.offset, resolved.width)
    }

    /*
     * Las ancladas también, y con su geometría completa.
     *
     * Marcarlas y nada más no alcanza: una celda anclada vive dentro de su
     * carril, y si nunca pasó por el camino normal no tiene ni lado asignado ni
     * caja. Sin caja, la barra —que se dibuja de borde a borde del padding— sale
     * de ancho negativo y se colapsa en una rayita. Es exactamente la misma
     * cuenta que hace `paintPinnedCells`, sin renderer ni valor porque no hay
     * fila de la cual sacarlos.
     */
    growPinnedCells(rowNode, pinnedColumns.length)
    const pinnedCells = rowNode.__dtPinnedCells
    for (let index = 0; index < pinnedCells.length; index += 1) {
      const cellNode = pinnedCells[index]
      if (!cellNode) continue

      const resolved = pinnedColumns[index]
      if (!resolved) {
        setHidden(cellNode, true)
        continue
      }

      const side = resolved.pinned === 'end' ? 'end' : 'start'
      if (cellNode.__dtPinnedSide !== side) {
        cellNode.__dtPinnedSide = side
        ensurePinnedLane(rowNode, side).appendChild(cellNode)
      }

      const corte = side === 'end' ? frame.pinnedStartCount : frame.pinnedStartCount - 1
      setCellPinnedEdge(cellNode, index === corte)

      setHidden(cellNode, false)
      setCellPlaceholder(cellNode, true)
      setCellBox(
        cellNode,
        side === 'end' ? resolved.offset - frame.totalWidth : resolved.offset,
        resolved.width,
      )
    }
  }

  /**
   * Pinta las celdas de las columnas ancladas.
   *
   * Sin ventana ni rotación: son siempre las mismas, siempre visibles, y cada una
   * tiene su nodo fijo en el array.
   *
   * Su posición NO depende del scroll, y ese es el punto entero del carril: la
   * celda se ubica una vez respecto de un ancla que el compositor mantiene
   * quieta. Las del inicio miden desde el borde izquierdo de la fila, así que su
   * offset ya es su posición; las del final cuelgan del borde derecho, así que se
   * miden desde ahí hacia atrás y su posición es negativa. Las dos solo cambian
   * al cambiar los anchos de columna, nunca al scrollear.
   */
  function paintPinnedCells(
    rowNode: PooledRowElement,
    columns: readonly ResolvedColumn<TRow>[],
    renderers: readonly CellRenderer<TRow>[],
    row: TRow,
    rowIndex: number,
    frame: PaintFrame,
  ): void {
    const cells = rowNode.__dtPinnedCells

    for (let index = 0; index < cells.length; index += 1) {
      const cellNode = cells[index]
      if (!cellNode) continue

      const resolved = columns[index]
      const renderer = renderers[index]
      if (!resolved || !renderer) {
        setHidden(cellNode, true)
        continue
      }

      const side = resolved.pinned === 'end' ? 'end' : 'start'
      if (cellNode.__dtPinnedSide !== side) {
        cellNode.__dtPinnedSide = side
        ensurePinnedLane(rowNode, side).appendChild(cellNode)
      }

      // La línea del corte la lleva UNA sola celda por lado: la última del bloque
      // del inicio y la primera del bloque del final. Con las ancladas ordenadas,
      // las dos salen del mismo número sin buscar nada.
      const corte = side === 'end' ? frame.pinnedStartCount : frame.pinnedStartCount - 1
      setCellPinnedEdge(cellNode, index === corte)

      const x = side === 'end' ? resolved.offset - frame.totalWidth : resolved.offset
      paintCell(cellNode, resolved, renderer, row, rowIndex, frame, x)
    }
  }

  /** Deja un nodo de fila fuera de juego: sin identidad y escondido. */
  function retireRow(rowNode: PooledRowElement): void {
    rowNode.__dtRowIndex = UNPAINTED_ROW_INDEX
    rowNode.__dtSourceRowIndex = UNPAINTED_ROW_INDEX
    setHidden(rowNode, true)
    hideRowNumber(rowNode)
  }

  /**
   * Pinta el número de una fila, si la tabla numera.
   *
   * La etiqueta llega ya resuelta porque qué número corresponde depende del tipo
   * de fila, y eso lo sabe el llamador: una cabecera de grupo no tiene ninguno.
   */
  function paintRowNumber(
    rowNode: PooledRowElement,
    y: number,
    label: string,
    stripe: boolean,
    active: boolean,
    inRange: boolean,
  ): void {
    const node = rowNode.__dtNumber
    if (!node) return

    setHidden(node, false)
    setRowNumberOffset(node, y)
    setRowNumberLabel(node, label)
    setRowNumberStripe(node, stripe)
    setRowNumberActive(node, active)
    setRowNumberRange(node, inRange)
  }

  /** Apaga el número de una fila que no se está mostrando. */
  function hideRowNumber(rowNode: PooledRowElement): void {
    const node = rowNode.__dtNumber
    if (node) setHidden(node, true)
  }

  /** Si una fila cae dentro del rango, mirando solo el eje vertical. */
  function rowIsInRange(range: RangeRect | null, rowIndex: number): boolean {
    return range !== null && rowIndex >= range.rowStart && rowIndex <= range.rowEnd
  }

  /**
   * Garantiza que el nodo de fila esté construido para el tipo que le toca.
   *
   * ## El invariante que agrega la agrupación
   *
   * Es el mismo peligro que resuelve {@link ensureRenderer}, un eje más arriba.
   * Los nodos de fila se reciclan por slot VERTICAL, y con grupos la secuencia
   * visible mezcla cabeceras y filas de datos: el slot 3 puede mostrar una fila
   * de datos en un frame y una cabecera de grupo en el siguiente. Las dos
   * estructuras no se parecen —una tiene celdas con renderers, la otra un
   * chevrón, una etiqueta, un contador y agregados— y pintar una sobre la otra
   * escribiría encima de nodos que pertenecen a la forma anterior.
   *
   * La respuesta es idéntica y por los mismos motivos: cada nodo recuerda con qué
   * tipo está construido, y si el tipo entrante coincide —que es el caso común y
   * el único que ocurre durante el scroll, porque la rotación conserva el slot de
   * cada fila visible— no se hace absolutamente nada.
   *
   * Lo que sí difiere de `ensureRenderer` es que acá NO se destruye nada. Las dos
   * estructuras conviven en el mismo nodo y se turnan con `hidden`: reconstruir
   * la cabecera de grupo en cada ida y vuelta significaría crear y destruir cinco
   * nodos —uno de ellos un SVG— en mitad del scroll, y un slot que oscila entre
   * los dos tipos lo haría en cada paso. Convivir cuesta unos pocos nodos
   * escondidos por fila del pool; recrear cuesta trabajo por frame.
   *
   * Turnarse con `hidden` depende de que `hidden` apague de verdad, y eso lo
   * garantiza la hoja de estilos con una sola regla para todo el subárbol: ver
   * `setHidden` en `internal/dom.ts` y el bloque `.dt-root [hidden]` de
   * `styles/datatable.css`. Sin ella las dos estructuras se pintan superpuestas,
   * con este archivo escribiendo exactamente lo que corresponde.
   *
   * Los índices se invalidan en el cambio porque la identidad se compara contra
   * ellos: sin esto, un slot que vuelve a mostrar datos con el mismo índice
   * visible que ya tenía se saltearía la reescritura de `data-row-key`.
   *
   * @returns `true` si el nodo cambió de tipo.
   */
  function ensureRowKind(rowNode: PooledRowElement, kind: string): boolean {
    if (rowNode.__dtRowKind === kind) return false

    rowNode.__dtRowKind = kind
    rowNode.__dtRowIndex = UNPAINTED_ROW_INDEX
    rowNode.__dtSourceRowIndex = UNPAINTED_ROW_INDEX
    rowNode.__dtGroupId = ''

    const isGroup = kind === ROW_KIND_GROUP
    setRowGroupClass(rowNode, isGroup)

    if (isGroup) {
      // Las celdas se esconden, no se destruyen: sus renderers ya están
      // construidos y el próximo frame que devuelva esta fila a datos los
      // necesita exactamente como están. Las ancladas también: una cabecera de
      // grupo se extiende por todo el ancho, y dejarlas encendidas pondría dos
      // valores de una fila que no existe encima de su etiqueta.
      for (const cellNode of rowNode.__dtCells) setHidden(cellNode, true)
      for (const cellNode of rowNode.__dtPinnedCells) setHidden(cellNode, true)
      return true
    }

    const parts = rowNode.__dtGroup
    if (parts) {
      setHidden(parts.header, true)
      for (const aggregate of parts.aggregates) setHidden(aggregate, true)
    }
    clearRowExpanded(rowNode)
    clearRowAriaSet(rowNode)
    return true
  }

  /** Devuelve la estructura de cabecera del nodo, construyéndola la primera vez. */
  function ensureGroupParts(rowNode: PooledRowElement): PooledGroupParts {
    const existing = rowNode.__dtGroup
    if (existing) return existing
    const parts = createGroupParts(rowNode)
    rowNode.__dtGroup = parts
    return parts
  }

  /** Devuelve la celda de agregado de un slot, creándola la primera vez. */
  function ensureAggregate(
    rowNode: PooledRowElement,
    parts: PooledGroupParts,
    slot: number,
  ): PooledAggregateElement {
    const existing = parts.aggregates[slot]
    if (existing) return existing
    const element = createAggregateElement(rowNode)
    parts.aggregates.push(element)
    return element
  }

  /**
   * Pinta una cabecera de grupo.
   *
   * La banda cruza la fila ENTERA —columnas ancladas incluidas— y las celdas de
   * agregado se dibujan ENCIMA, con fondo propio. Es lo que permite que la
   * etiqueta use todo el ancho libre que tenga a disposición sin necesidad de
   * calcular dónde termina: el recorte lo hace el agregado que se le apoya
   * arriba, no una cuenta que habría que rehacer con cada cambio de columnas.
   *
   * Que la etiqueta no se vaya con el scroll horizontal lo resuelve
   * `position: sticky` sobre `parts.inner`. Acá no se escribe ninguna posición.
   */
  function paintGroupRow(
    rowNode: PooledRowElement,
    entry: GroupRow,
    rowIndex: number,
    columns: readonly ResolvedColumn<TRow>[],
    rowHeight: number,
    frame: PaintFrame,
    showGroupCount: boolean,
  ): void {
    ensureRowKind(rowNode, ROW_KIND_GROUP)
    const parts = ensureGroupParts(rowNode)

    setHidden(rowNode, false)
    setHidden(parts.header, false)
    setRowOffset(rowNode, rowIndex * rowHeight)
    // Una cabecera de grupo nunca se raya: su fondo es el que la separa de las
    // filas de datos, y alternarlo haría que una de cada dos se confundiera.
    setRowStripe(rowNode, false)

    if (rowNode.__dtRowIndex !== rowIndex || rowNode.__dtGroupId !== entry.groupId) {
      rowNode.__dtRowIndex = rowIndex
      rowNode.__dtGroupId = entry.groupId
      setRowKey(rowNode, entry.groupId)
      setRowAriaIndex(rowNode, rowIndex)
    }

    setRowActive(rowNode, rowIndex === frame.activeRowIndex)
    // Una cabecera no es una unidad seleccionable de la grilla: se la puede
    // recorrer con el teclado para plegarla, pero no representa datos.
    setRowAriaSelected(rowNode, false)

    setRowGroupDepth(rowNode, entry.depth)
    setRowExpanded(rowNode, entry.expanded)
    setRowAriaLevel(rowNode, entry.depth + 1)
    setRowAriaSet(rowNode, entry.posInSet, entry.setSize)

    setGroupLabel(parts, entry.label)
    setGroupCount(parts, String(entry.count), !showGroupCount)

    // La banda cruza la fila ENTERA. Antes iba del primer al último elemento de
    // `columns`, que son solo las columnas que scrollean: con columnas ancladas
    // al inicio eso arrancaba después del bloque anclado y dejaba ese tramo como
    // un hueco vacío, que es exactamente lo que no es una cabecera de grupo.
    //
    // Que la etiqueta siga a la vista al scrollear lo resuelve `position: sticky`
    // sobre `parts.inner`, no una cuenta hecha acá. Ver la nota en `dom.ts`.
    setGroupHeaderWidth(parts, frame.totalWidth)

    let used = 0
    for (const resolved of columns) {
      if (resolved.column.aggregate === undefined) continue
      const node = ensureAggregate(rowNode, parts, used)
      used += 1
      setHidden(node, false)
      setAggregateBox(node, resolved.offset, resolved.width)
      setAggregateAlign(node, resolved.align)
      // `column.format` no se aplica: su firma pide una fila y un índice, y un
      // agregado no pertenece a ninguna fila en particular. Para eso está
      // `formatAggregate`, cuya firma solo pide el valor y la columna. Sin ella
      // se escribe la representación por defecto, que es lo que se escribía
      // antes de que existiera.
      const aggregateValue = entry.aggregates[resolved.key]
      const formatAggregate = resolved.column.formatAggregate
      setAggregateText(
        node,
        resolved.key,
        formatAggregate
          ? formatAggregate(aggregateValue, resolved.column)
          : formatCellValue(aggregateValue),
      )
    }
    for (let slot = used; slot < parts.aggregates.length; slot += 1) {
      const node = parts.aggregates[slot]
      if (node) setHidden(node, true)
    }
  }

  /**
   * Garantiza que el nodo esté construido con el renderer que le corresponde.
   *
   * ## El invariante menos obvio de todo el pool
   *
   * Los nodos de celda se reciclan por slot horizontal, no por columna. Con
   * virtualización de columnas, el slot 3 puede representar la columna `status`
   * en un frame y la columna `name` en el siguiente. Si esas dos columnas usan
   * renderers distintos, el nodo trae adentro la estructura que armó el renderer
   * anterior —un badge con su chevron, por ejemplo— y un `update` del renderer
   * de texto escribiría sobre una estructura que no es la suya.
   *
   * La rotación horizontal reduce muchísimo cuántas veces pasa —solo cambia de
   * columna el slot al que le toca la columna entrante, no todos— pero no lo
   * elimina, y ese slot es exactamente el que puede recibir otro renderer.
   *
   * Por eso cada nodo recuerda con qué tipo de renderer fue construido. Si el
   * tipo entrante coincide, que es el caso común y el único que ocurre durante
   * el scroll vertical, no se hace absolutamente nada: el nodo ya tiene la forma
   * correcta y basta con `update`. Si difiere, se cierra el handle viejo con
   * `destroy`, se vacía el nodo y se vuelve a construir.
   *
   * ## El modo de maquetado viaja acá y en ningún otro lado
   *
   * Que una celda se centre por altura de línea o por flex depende del RENDERER
   * y de nada más, así que el único momento en que puede cambiar es este mismo.
   * Aplicarlo desde adentro de esta función —y no en `paintCell`, que corre por
   * celda visible y por frame— no es una comodidad: es lo que hace imposible
   * escribir esa clase durante el scroll, porque no queda ningún otro camino que
   * llegue a ella.
   *
   * @returns `true` si el nodo se reconstruyó y hay que forzar `update`.
   */
  function ensureRenderer(cellNode: PooledCellElement, renderer: CellRenderer<TRow>): boolean {
    if (cellNode.__dtHandle !== null && cellNode.__dtRendererType === renderer.type) return false

    const previousHandle = cellNode.__dtHandle
    if (previousHandle) cellNode.__dtRenderer?.destroy?.(previousHandle)

    clearCellContent(cellNode)

    cellNode.__dtHandle = renderer.create(cellNode)
    cellNode.__dtRenderer = renderer
    cellNode.__dtRendererType = renderer.type
    // Un renderer que no declara `layout` —incluidos todos los propios escritos
    // antes de que este eje existiera— se comporta como hasta ahora.
    setCellLayout(cellNode, renderer.layout ?? TEXT_CELL_LAYOUT)
    return true
  }

  /**
   * @param x - Posición horizontal en el canvas. Para una columna suelta es su
   * offset; para una anclada, ese offset ya corrido por la compensación del
   * frame. Se pasa en lugar de leerlo de la columna porque es lo ÚNICO que
   * distingue a una celda anclada de una normal: todo lo demás —renderer, caché,
   * edición, selección— es idéntico y no debe enterarse.
   */
  function paintCell(
    cellNode: PooledCellElement,
    resolved: ResolvedColumn<TRow>,
    renderer: CellRenderer<TRow>,
    row: TRow,
    rowIndex: number,
    frame: PaintFrame,
    x: number,
  ): void {
    // Saca el estado de marcador si lo tenía. Cuando ENTRÓ en él se cerró su
    // handle, así que `ensureRenderer` lo va a reconstruir acá abajo y va a
    // devolver `true`, que es lo que fuerza el `update` aunque el valor
    // memoizado coincida con el que había antes de vaciar la celda.
    //
    // Cuesta una comparación de campo por celda y por frame, igual que el resto
    // de los memos de este módulo: sin cambio de estado no toca el DOM.
    setCellPlaceholder(cellNode, false)

    const rendererChanged = ensureRenderer(cellNode, renderer)
    const handle = cellNode.__dtHandle
    if (!handle) return

    const isEditing = rowIndex === frame.editingRowIndex && resolved.key === frame.editingColumnKey
    // Se captura antes de `setCellEditing`, que es quien actualiza `__dtEditing`.
    // El renderer recibe `isEditing` en su contexto, así que un cambio de estado
    // de edición tiene que llegar hasta `update` aunque el valor no haya cambiado.
    const editingChanged = cellNode.__dtEditing !== isEditing

    const isActive =
      frame.cellSelectionActive &&
      rowIndex === frame.activeRowIndex &&
      resolved.key === frame.activeColumnKey

    // La celda activa NO se tiñe, aunque caiga adentro del rectángulo. Es la
    // convención de toda planilla: el ancla queda con el fondo normal para que
    // se vea desde dónde se extendió la selección, y es además lo que evita que
    // el tinte y la marca de celda activa se sumen en un color que no es
    // ninguno de los dos.
    const range = frame.range
    const inRange =
      range !== null &&
      !isActive &&
      rowIndex >= range.rowStart &&
      rowIndex <= range.rowEnd &&
      resolved.index >= range.columnStart &&
      resolved.index <= range.columnEnd

    const identityChanged =
      rendererChanged ||
      cellNode.__dtRowIndex !== rowIndex ||
      cellNode.__dtColumnKey !== resolved.key ||
      cellNode.__dtColumnDef !== resolved.column

    // Un nodo enfocado que se recicla para otra celda seguiría recibiendo las
    // teclas del usuario mientras representa datos distintos. Se le saca el foco
    // en el momento exacto en que cambia de identidad.
    if (identityChanged && frame.activeElement === cellNode) cellNode.blur()

    setHidden(cellNode, false)
    setCellBox(cellNode, x, resolved.width)
    setCellAlign(cellNode, resolved.align)
    setCellEditing(cellNode, isEditing)
    setCellActive(cellNode, isActive)
    setCellRange(cellNode, inRange)
    // `aria-selected` anuncia la selección ENTERA, no solo su ancla: un lector
    // de pantalla que recorre un rango de diez celdas tiene que encontrar las
    // diez seleccionadas, igual que en una planilla.
    setCellAriaSelected(cellNode, isActive || inRange)
    // `resolved.index` es la posición dentro de las columnas VISIBLES, que es
    // justo lo que debe anunciar `aria-colindex`: una columna oculta no ocupa
    // lugar en la grilla que percibe el lector de pantalla.
    setCellAriaIndex(cellNode, resolved.index)

    // El valor crudo es la clave de caché, no el normalizado: `toCellValue`
    // convierte arrays y objetos a texto, y dos listas distintas terminarían
    // ambas en `"[object Object]"`. Cachear sobre eso haría que los renderers
    // `tags` y `avatar` no repintaran nunca.
    const raw = readRawValue(resolved.column, row)

    // Camino rápido. Si la celda ya muestra este mismo valor, para esta misma
    // fila y columna, con el mismo renderer y en la misma generación, entonces
    // `update` y `cellClass` —que el contrato declara puros— producirían
    // exactamente lo mismo. Saltear las dos llamadas es lo que vuelve gratis un
    // repintado por resize o por cambio de tema.
    if (
      !identityChanged &&
      !editingChanged &&
      cellNode.__dtGeneration === generation &&
      rawValuesEqual(cellNode.__dtValue, raw)
    ) {
      return
    }

    cellNode.__dtRowIndex = rowIndex
    cellNode.__dtColumnKey = resolved.key
    cellNode.__dtColumnDef = resolved.column
    cellNode.__dtGeneration = generation
    cellNode.__dtValue = raw

    const value = toCellValue(raw)

    renderer.update(handle, {
      value,
      raw,
      row,
      rowIndex,
      column: resolved.column,
      isEditing,
    })

    const cellClass = resolved.column.cellClass
    setCellCustomClass(cellNode, cellClass ? (cellClass(value, row, rowIndex) ?? '') : '')
  }

  /**
   * Nodo de celda de una posición lógica, o `null`.
   *
   * Resuelve la fila POR ROTACIÓN y no barriendo el pool: con el mapeo por
   * módulo, el nodo de una fila está siempre en `rowIndex % poolSize`, así que la
   * búsqueda es O(1) y no O(filas visibles). La comparación posterior contra
   * `__dtRowIndex` no es una formalidad: es la que distingue "el slot de esta
   * fila" de "el slot de esta fila, y además está pintada ahí ahora mismo". Un
   * slot puede corresponder aritméticamente a una fila que quedó fuera de la
   * ventana, y en ese caso la respuesta correcta es `null`.
   *
   * La horizontal sí es un barrido: las celdas también rotan, pero acá se entra
   * con una CLAVE de columna y no con su índice, así que no hay módulo que
   * aplicar. Son ~15 comparaciones y solo ocurren en respuesta a una interacción
   * o una vez por frame mientras hay una celda en edición.
   */
  function getCellElement(rowIndex: number, columnKey: string): HTMLElement | null {
    const poolSize = rows.length
    if (poolSize === 0 || rowIndex < 0) return null

    const rowNode = rows[slotFor(rowIndex, poolSize)]
    if (!rowNode || rowNode.__dtRowIndex !== rowIndex || rowNode.hidden) return null
    // Una cabecera de grupo no tiene celdas visibles: las suyas están escondidas
    // y no representan ninguna columna. Responder `null` acá es lo que mantiene a
    // los grupos fuera de la edición y de la selección de celdas sin que ninguno
    // de esos dos módulos tenga que saber que los grupos existen.
    if (rowNode.__dtRowKind !== ROW_KIND_DATA) return null

    for (const cellNode of rowNode.__dtCells) {
      if (cellNode.__dtColumnKey === columnKey && !cellNode.hidden) return cellNode
    }
    // Las ancladas viven en su propio array: una búsqueda por clave que no las
    // mirara devolvería `null` para una celda que está en pantalla, y el editor
    // —que usa esta respuesta para saber si la celda sigue pintada— cerraría
    // solo cada vez que se editara una columna anclada.
    for (const cellNode of rowNode.__dtPinnedCells) {
      if (cellNode.__dtColumnKey === columnKey && !cellNode.hidden) return cellNode
    }
    return null
  }

  /**
   * Traduce un target de evento a la celda que representa.
   *
   * Sube por el DOM con `closest` y después busca los nodos por identidad dentro
   * del propio pool, en lugar de castear el `Element` a `PooledCellElement`. El
   * barrido es O(filas visibles x columnas visibles), irrelevante en respuesta a
   * un click, y a cambio no hace falta un solo `as` ni confiar en que cualquier
   * `div` con clase `dt-cell` sea realmente nuestro.
   */
  function resolveEventCell(target: EventTarget | null): {
    row: PooledRowElement
    cell: PooledCellElement
  } | null {
    if (!(target instanceof Element)) return null

    const cellElement = target.closest('.dt-cell')
    if (!cellElement) return null

    for (const rowNode of rows) {
      // Una cabecera de grupo conserva sus celdas escondidas; ninguna puede ser
      // el blanco de un evento, pero descartarla acá vuelve explícito que los
      // grupos no participan de la edición ni de la selección de celdas.
      if (rowNode.__dtRowKind !== ROW_KIND_DATA) continue
      for (const cellNode of rowNode.__dtCells) {
        if (cellNode === cellElement) return { row: rowNode, cell: cellNode }
      }
      for (const cellNode of rowNode.__dtPinnedCells) {
        if (cellNode === cellElement) return { row: rowNode, cell: cellNode }
      }
    }
    return null
  }

  /** Igual que {@link resolveEventCell} pero cuando solo interesa la fila. */
  function resolveEventRow(target: EventTarget | null): PooledRowElement | null {
    if (!(target instanceof Element)) return null

    const rowElement = target.closest('.dt-row')
    if (!rowElement) return null

    for (const rowNode of rows) {
      if (rowNode === rowElement) return rowNode
    }
    return null
  }

  function handleDoubleClick(event: MouseEvent): void {
    const handler = callbacks.onCellDoubleClick
    if (!handler) return
    const hit = resolveEventCell(event.target)
    if (!hit || hit.row.__dtRowIndex === UNPAINTED_ROW_INDEX) return
    handler({ rowIndex: hit.row.__dtRowIndex, columnKey: hit.cell.__dtColumnKey })
  }

  /**
   * Click sobre una fila.
   *
   * Sobre una cabecera de grupo el click PLIEGA, no selecciona: es el gesto que
   * todo el mundo espera de una fila con un chevrón, y no compite con nada porque
   * una cabecera no tiene celdas que seleccionar. El chevrón no necesita su propio
   * listener; alcanza con saber qué tipo de fila recibió el evento.
   */
  function handleClick(event: MouseEvent): void {
    const rowNode = resolveEventRow(event.target)
    if (!rowNode || rowNode.__dtRowIndex === UNPAINTED_ROW_INDEX) return

    if (rowNode.__dtRowKind === ROW_KIND_GROUP) {
      if (rowNode.__dtGroupId !== '') callbacks.onGroupToggle?.(rowNode.__dtGroupId)
      return
    }

    callbacks.onRowClick?.(rowNode.__dtRowIndex)
  }

  /**
   * Un control dentro de una celda cambió: hoy, siempre una casilla.
   *
   * El estado visual se revierte ANTES de avisar. El navegador ya cambió
   * `checked` para cuando llega este evento, y dejarlo así rompería el caché del
   * renderer: creería estar sincronizado y no volvería a escribir esa casilla
   * nunca más, de modo que una edición vetada quedaría tildada para siempre.
   * Revirtiendo, el DOM sigue gobernado por el estado y el clic es solo una
   * intención que la tubería de edición puede aceptar o rechazar.
   */
  function handleChange(event: Event): void {
    const handler = callbacks.onCellToggle
    if (!handler) return

    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return

    const hit = resolveEventCell(target)
    if (!hit || hit.row.__dtRowIndex === UNPAINTED_ROW_INDEX) return

    const requested = target.checked
    revertCheckbox(target)

    handler({ rowIndex: hit.row.__dtRowIndex, columnKey: hit.cell.__dtColumnKey }, requested)
  }

  /**
   * Selección con un solo clic, y comienzo de un arrastre.
   *
   * El teclado NO se maneja acá. La navegación opera sobre la celda activa, que
   * es estado del componente, no sobre el nodo que tenga el foco: los nodos se
   * reciclan y el foco del DOM no sobrevive a un scroll. El manejador de teclas
   * vive en el viewport y lee esa posición.
   *
   * ## Las tres formas de apretar sobre una celda
   *
   * 1. Botón primario: mueve la selección y ARMA el arrastre.
   * 2. Botón primario con `Shift`: extiende el rango desde el ancla, sin mover
   *    la celda activa. Tampoco arma arrastre: el gesto ya terminó.
   * 3. Cualquier otro botón: no toca la selección. El secundario abre el menú
   *    contextual del navegador, y mover la selección debajo de un menú que se
   *    está abriendo es exactamente lo que nadie espera.
   */
  function handlePointerDown(event: Event): void {
    const hit = resolveEventCell(event.target)
    if (!hit || hit.row.__dtRowIndex === UNPAINTED_ROW_INDEX) return

    // El evento llega tipado como `Event` porque `addEventListener` sobre un
    // nombre arbitrario no estrecha nada. Un `pointerdown` sintético sin
    // información de botones —los que despacha la suite— cae en el camino
    // primario, que es el que describe.
    const mouse = event instanceof MouseEvent ? event : null
    if (mouse && mouse.button !== 0) return

    const position: CellPosition = {
      rowIndex: hit.row.__dtRowIndex,
      columnKey: hit.cell.__dtColumnKey,
    }

    if (mouse?.shiftKey) {
      callbacks.onCellShiftPointerDown?.(position)
      return
    }

    callbacks.onCellPointerDown?.(position)
    beginDrag()
  }

  /**
   * Clic sobre un número de la regleta.
   *
   * Resuelve qué fila se tocó por identidad de nodo, igual que
   * {@link resolveEventCell}: se recorre el pool comparando contra el número que
   * cada fila tiene adosado, en lugar de castear el target o leerle el texto. El
   * texto sería el peor camino de los tres —es lo que se ve, no lo que la fila
   * es— y quedaría roto en cuanto la numeración empezara en otro lado.
   */
  function handleGutterPointerDown(event: Event): void {
    const handler = callbacks.onRowNumberPointerDown
    if (!handler) return

    const target = event.target
    if (!(target instanceof Element)) return
    const numberElement = target.closest('.dt-row-number')
    if (!numberElement) return

    const mouse = event instanceof MouseEvent ? event : null
    if (mouse && mouse.button !== 0) return

    for (const rowNode of rows) {
      if (rowNode.__dtNumber !== numberElement) continue
      if (rowNode.__dtRowIndex === UNPAINTED_ROW_INDEX) return
      handler(rowNode.__dtRowIndex)
      return
    }
  }

  /* ------------------------------------------------------- Arrastre */

  /**
   * Si hay un arrastre de selección en curso.
   *
   * Los listeners de movimiento se registran al empezar y se dan de baja al
   * terminar, en lugar de vivir siempre y preguntar. Es la regla 3 del pool
   * llevada al caso: mover el mouse sobre la tabla sin arrastrar nada es lo que
   * ocurre todo el tiempo, y no debe costar ni una llamada.
   */
  let dragging = false

  function beginDrag(): void {
    if (dragging || !container || !callbacks.onCellDragOver) return
    dragging = true

    // Sobre el documento y no sobre el contenedor: el puntero se sale de la
    // tabla constantemente mientras se arrastra, y los eventos tienen que
    // seguir llegando. `setPointerCapture` haría lo mismo pero RETARGETEA cada
    // evento al elemento que captura, y entonces `resolveEventCell` vería
    // siempre el canvas en vez de la celda que está debajo del puntero.
    const doc = container.ownerDocument
    doc.addEventListener('pointermove', handleDragMove)
    doc.addEventListener('pointerup', endDrag)
    doc.addEventListener('pointercancel', endDrag)
  }

  function endDrag(): void {
    if (!dragging || !container) return
    dragging = false

    const doc = container.ownerDocument
    doc.removeEventListener('pointermove', handleDragMove)
    doc.removeEventListener('pointerup', endDrag)
    doc.removeEventListener('pointercancel', endDrag)
  }

  function handleDragMove(event: Event): void {
    // Soltar el botón fuera de la ventana no produce `pointerup`, así que el
    // arrastre quedaría armado y la selección seguiría al puntero sin que nadie
    // esté apretando nada. `buttons` en cero dice exactamente eso.
    if (event instanceof MouseEvent && event.buttons === 0) {
      endDrag()
      return
    }

    const hit = resolveEventCell(event.target)
    if (!hit || hit.row.__dtRowIndex === UNPAINTED_ROW_INDEX) return

    callbacks.onCellDragOver?.({
      rowIndex: hit.row.__dtRowIndex,
      columnKey: hit.cell.__dtColumnKey,
    })
  }

  return { mount, unmount, paint, trim, invalidate, getCellElement }
}
