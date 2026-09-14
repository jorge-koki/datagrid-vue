import type { CellPosition, SelectionMode, VirtualWindow } from '../types'
import type { ResolvedColumn } from './useColumnLayout'
import type { PooledCellElement, PooledRowElement } from '../internal/dom'
import {
  clearCellContent,
  createCellElement,
  createRowElement,
  setCellActive,
  setCellAlign,
  setCellAriaIndex,
  setCellAriaSelected,
  setCellBox,
  setCellCustomClass,
  setCellEditing,
  setHidden,
  setRowActive,
  setRowAriaIndex,
  setRowAriaSelected,
  setRowKey,
  setRowOffset,
  setRowStripe,
} from '../internal/dom'
import { ROW_POOL_SLACK, UNPAINTED_ROW_INDEX } from '../internal/constants'
import { rawValuesEqual, readRawValue, toCellValue } from '../internal/values'
import { resolveRenderer, revertCheckbox } from '../internal/renderers'
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
 * ## Las tres reglas del pool
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
   * El usuario pidió cambiar el valor de una casilla.
   *
   * Es una INTENCIÓN, no un hecho consumado: el pool ya revirtió el estado
   * visual, y quien reciba esto debe pasarlo por la tubería de edición. Si se
   * veta o no se persiste, la casilla queda como estaba.
   */
  onCellToggle?: (position: CellPosition, nextValue: boolean) => void
}

/**
 * Todo lo que el pool necesita para pintar un frame.
 *
 * Es un objeto plano y no reactivo a propósito: lo arma el componente en cada
 * frame leyendo valores ya resueltos, de modo que el pool nunca suscribe nada
 * ni dispara efectos al leerlo.
 */
export interface RowPoolPaintState<TRow> {
  /** El dataset completo. El pool indexa, nunca copia ni recorre entero. */
  rows: readonly TRow[]
  /** Tramo vertical de filas a pintar. */
  rowRange: VirtualWindow
  /** Tramo horizontal de columnas a pintar, ya recortado por el componente. */
  columns: readonly ResolvedColumn<TRow>[]
  /** Altura de fila en px. */
  rowHeight: number
  /** Celda con el editor abierto, o `null`. */
  editing: CellPosition | null
  /** Celda activa, o `null`. */
  active: CellPosition | null
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
}

/** API del pool de filas. */
export interface RowPool<TRow> {
  /** Adopta el contenedor donde se inyectan las filas y registra la delegación. */
  mount(container: HTMLElement): void
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

  /**
   * Nodos de fila indexados por slot de viewport, no por índice de fila.
   *
   * El slot 0 es siempre la fila superior visible. Al scrollear, el slot 0 pasa
   * a representar otra fila del dataset: esa indirección es todo el reciclado.
   */
  const rows: PooledRowElement[] = []

  /** Generación de pintado. `invalidate()` la incrementa para forzar repintado total. */
  let generation = 0

  function mount(target: HTMLElement): void {
    if (container === target) return
    unmount()
    container = target
    // Un listener por tipo de evento para toda la tabla. La resolución de qué
    // celda se tocó se hace al vuelo en el handler, que corre en respuesta a una
    // acción del usuario y no dentro del presupuesto de frame.
    container.addEventListener('dblclick', handleDoubleClick)
    container.addEventListener('click', handleClick)
    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('change', handleChange)
  }

  /**
   * Cierra el renderer de una fila que se va a descartar.
   *
   * Un renderer puede haber tomado recursos que el garbage collector no alcanza
   * por sí solo (un ResizeObserver, un timer, un listener sobre un nodo interno),
   * así que sacar el nodo del DOM no basta.
   */
  function releaseRow(rowNode: PooledRowElement): void {
    for (const cellNode of rowNode.__dtCells) {
      const handle = cellNode.__dtHandle
      if (handle) cellNode.__dtRenderer?.destroy?.(handle)
      cellNode.__dtHandle = null
      cellNode.__dtRenderer = null
    }
    rowNode.remove()
  }

  function unmount(): void {
    if (container) {
      container.removeEventListener('dblclick', handleDoubleClick)
      container.removeEventListener('click', handleClick)
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('change', handleChange)
      for (const row of rows) releaseRow(row)
    }
    rows.length = 0
    container = null
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
    while (rows.length < count) {
      const node = createRowElement()
      rows.push(node)
      fragment.appendChild(node)
    }
    container.appendChild(fragment)
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

  function trim(visibleRowCount: number): void {
    const keep = Math.max(0, Math.floor(visibleRowCount)) + ROW_POOL_SLACK
    while (rows.length > keep) {
      const node = rows.pop()
      if (node) releaseRow(node)
    }
  }

  function paint(state: RowPoolPaintState<TRow>): void {
    if (!container) return

    const { rowRange, columns, rowHeight, editing, active, selectionMode, stripe } = state
    const visibleRowCount = Math.max(0, rowRange.end - rowRange.start)
    const visibleColumnCount = columns.length

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
    }

    for (let slot = 0; slot < rows.length; slot += 1) {
      const rowNode = rows[slot]
      if (!rowNode) continue

      // Los slots sobrantes se ocultan, no se eliminan: el próximo scroll hacia
      // abajo o un resize los va a volver a pedir.
      if (slot >= visibleRowCount) {
        if (rowNode.__dtRowIndex !== UNPAINTED_ROW_INDEX) {
          rowNode.__dtRowIndex = UNPAINTED_ROW_INDEX
        }
        setHidden(rowNode, true)
        continue
      }

      const rowIndex = rowRange.start + slot
      const row = state.rows[rowIndex]
      // Guarda de `noUncheckedIndexedAccess`. Además cubre el caso real de que
      // `rows` se haya acortado entre el cálculo de la ventana y este pintado.
      if (row === undefined) {
        rowNode.__dtRowIndex = UNPAINTED_ROW_INDEX
        setHidden(rowNode, true)
        continue
      }

      setHidden(rowNode, false)
      setRowOffset(rowNode, rowIndex * rowHeight)
      setRowStripe(rowNode, stripe && rowIndex % 2 === 1)
      if (rowNode.__dtRowIndex !== rowIndex) {
        rowNode.__dtRowIndex = rowIndex
        setRowKey(rowNode, state.resolveRowKey(row, rowIndex))
        setRowAriaIndex(rowNode, rowIndex)
      }

      const rowIsActive = rowIndex === activeRowIndex
      setRowActive(rowNode, rowIsActive)
      // En modo `row` la fila es la unidad seleccionada y lo anuncia; en modo
      // `cell` lo anuncia la celda, y marcar además la fila duplicaría el
      // anuncio del lector de pantalla.
      setRowAriaSelected(rowNode, selectionMode === 'row' && rowIsActive)

      growCells(rowNode, visibleColumnCount)
      const cells = rowNode.__dtCells

      for (let slotIndex = 0; slotIndex < cells.length; slotIndex += 1) {
        const cellNode = cells[slotIndex]
        if (!cellNode) continue

        if (slotIndex >= visibleColumnCount) {
          setHidden(cellNode, true)
          continue
        }

        const resolved = columns[slotIndex]
        const renderer = renderers[slotIndex]
        if (!resolved || !renderer) {
          setHidden(cellNode, true)
          continue
        }

        paintCell(cellNode, resolved, renderer, row, rowIndex, frame)
      }
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
   * Por eso cada nodo recuerda con qué tipo de renderer fue construido. Si el
   * tipo entrante coincide, que es el caso común y el único que ocurre durante
   * el scroll vertical, no se hace absolutamente nada: el nodo ya tiene la forma
   * correcta y basta con `update`. Si difiere, se cierra el handle viejo con
   * `destroy`, se vacía el nodo y se vuelve a construir.
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
    return true
  }

  function paintCell(
    cellNode: PooledCellElement,
    resolved: ResolvedColumn<TRow>,
    renderer: CellRenderer<TRow>,
    row: TRow,
    rowIndex: number,
    frame: PaintFrame,
  ): void {
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
    setCellBox(cellNode, resolved.offset, resolved.width)
    setCellAlign(cellNode, resolved.align)
    setCellEditing(cellNode, isEditing)
    setCellActive(cellNode, isActive)
    setCellAriaSelected(cellNode, isActive)
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

  function getCellElement(rowIndex: number, columnKey: string): HTMLElement | null {
    for (const rowNode of rows) {
      if (rowNode.__dtRowIndex !== rowIndex || rowNode.hidden) continue
      for (const cellNode of rowNode.__dtCells) {
        if (cellNode.__dtColumnKey === columnKey && !cellNode.hidden) return cellNode
      }
      return null
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
      for (const cellNode of rowNode.__dtCells) {
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

  function handleClick(event: MouseEvent): void {
    const handler = callbacks.onRowClick
    if (!handler) return
    const rowNode = resolveEventRow(event.target)
    if (!rowNode || rowNode.__dtRowIndex === UNPAINTED_ROW_INDEX) return
    handler(rowNode.__dtRowIndex)
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
   * Selección con un solo clic.
   *
   * El teclado NO se maneja acá. La navegación opera sobre la celda activa, que
   * es estado del componente, no sobre el nodo que tenga el foco: los nodos se
   * reciclan y el foco del DOM no sobrevive a un scroll. El manejador de teclas
   * vive en el viewport y lee esa posición.
   */
  function handlePointerDown(event: Event): void {
    const handler = callbacks.onCellPointerDown
    if (!handler) return
    const hit = resolveEventCell(event.target)
    if (!hit || hit.row.__dtRowIndex === UNPAINTED_ROW_INDEX) return
    handler({ rowIndex: hit.row.__dtRowIndex, columnKey: hit.cell.__dtColumnKey })
  }

  return { mount, unmount, paint, trim, invalidate, getCellElement }
}
