/**
 * Andamiaje compartido por la suite.
 *
 * Dos niveles, porque hay dos cosas distintas que verificar:
 *
 * 1. {@link createPoolFixture} instancia `useRowPool` en crudo, sin Vue. El pool
 *    es una factory de TypeScript plano, no un composable: no registra hooks de
 *    ciclo de vida y no necesita un componente montado. Medir escrituras al DOM
 *    contra el pool desnudo deja fuera todo lo que escriba el framework, que es
 *    exactamente lo que hace creíble un número exacto.
 * 2. {@link mountTable} monta el componente completo para lo que solo existe
 *    ahí: teclado, selección, auto-scroll y el cableado del editor.
 */

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import DataTable from '../DataTable.vue'
import { useRowPool } from '../composables/useRowPool'
import type { RowPool, RowPoolCallbacks, RowPoolPaintState } from '../composables/useRowPool'
import type { ResolvedColumn } from '../composables/useColumnLayout'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellPosition,
  ColumnResizeEvent,
  DataTableColumn,
  DataTableProps,
  EditCommitEvent,
  SelectionMode,
} from '../types'
import { defaultAlignFor } from '../internal/renderers'
import { FakeResizeObserver, flushFrames } from './fakes'

/**
 * Fila de prueba con una propiedad por cada renderer incluido.
 *
 * Es un `type` y no una `interface` a propósito: solo los alias de tipo obtienen
 * la firma de índice implícita que exige `TRow extends Record<string, unknown>`.
 */
export type DemoRow = {
  id: number
  name: string
  amount: number
  status: string
  progress: number
  done: boolean
  tags: string[]
  owner: { name: string; src?: string }
  choice: string
}

/** Opciones de estado de celda usadas por `badge`, `select` y `tags`. */
export const DEMO_OPTIONS = [
  { value: 'open', label: 'Open', color: 'var(--dt-color-blue)' },
  { value: 'done', label: 'Done', color: 'var(--dt-color-green)' },
  { value: 'late', label: 'Late', color: 'var(--dt-color-red)' },
] as const

/** Genera `count` filas deterministas. Mismo índice, mismos datos, siempre. */
export function makeRows(count: number): DemoRow[] {
  const rows: DemoRow[] = []
  for (let index = 0; index < count; index += 1) {
    const status = DEMO_OPTIONS[index % DEMO_OPTIONS.length]?.value ?? 'open'
    rows.push({
      id: index,
      name: `Row ${index}`,
      amount: index * 100,
      status,
      progress: index % 101,
      done: index % 2 === 0,
      tags: [status, `tag-${index % 5}`],
      owner: { name: `Owner ${index}` },
      choice: status,
    })
  }
  return rows
}

/** Ancho por defecto de las columnas del andamiaje, en px. */
export const FIXTURE_COLUMN_WIDTH = 120

/**
 * Resuelve columnas declaradas a la forma geométrica que consume el pool.
 *
 * Replica la cadena de `useColumnLayout` —offsets acumulados, alineación
 * heredada del renderer— sin traer reactividad a un test que no la necesita.
 */
export function resolveColumns(
  columns: readonly DataTableColumn<DemoRow>[],
): ResolvedColumn<DemoRow>[] {
  const resolved: ResolvedColumn<DemoRow>[] = []
  let offset = 0
  for (const column of columns) {
    const width = column.width ?? FIXTURE_COLUMN_WIDTH
    resolved.push({
      column,
      key: column.key,
      label: column.label ?? column.key,
      width,
      offset,
      index: resolved.length,
      align: column.align ?? defaultAlignFor(column.renderer) ?? 'left',
      resizable: column.resizable ?? false,
    })
    offset += width
  }
  return resolved
}

/** Qué se le pide pintar al pool. Todo es opcional: se completa con el default. */
export interface PaintOverrides {
  rows?: readonly DemoRow[]
  columns?: readonly ResolvedColumn<DemoRow>[]
  start?: number
  end?: number
  rowHeight?: number
  active?: CellPosition | null
  editing?: CellPosition | null
  selectionMode?: SelectionMode
  stripe?: boolean
}

/** Pool instanciado sobre un contenedor real, listo para pintar. */
export interface PoolFixture {
  /** Contenedor adoptado por el pool. Es el `root` que observa la grabadora. */
  container: HTMLElement
  pool: RowPool<DemoRow>
  /** Pinta un frame. Lo que no se pasa conserva el valor del frame anterior. */
  paint(overrides?: PaintOverrides): void
  /** Nodos de fila actualmente en el contenedor, en orden de slot. */
  rowNodes(): HTMLElement[]
  /** Celdas visibles de un slot de fila. */
  cellNodes(slot: number): HTMLElement[]
  /** Libera el pool y saca el contenedor del documento. */
  destroy(): void
}

/** Opciones de {@link createPoolFixture}. */
export interface PoolFixtureOptions {
  rows?: readonly DemoRow[]
  columns?: readonly DataTableColumn<DemoRow>[]
  rowHeight?: number
  visibleRows?: number
  callbacks?: RowPoolCallbacks
}

/** Altura de fila usada por el andamiaje, en px. */
export const FIXTURE_ROW_HEIGHT = 40

/**
 * Crea un pool montado sobre un contenedor propio.
 *
 * El contenedor se agrega al documento porque el pool consulta
 * `document.activeElement` y resuelve eventos con `closest`: un árbol suelto
 * respondería distinto a un árbol conectado.
 */
export function createPoolFixture(options: PoolFixtureOptions = {}): PoolFixture {
  const container = document.createElement('div')
  container.className = 'dt-canvas'
  document.body.appendChild(container)

  const pool = useRowPool<DemoRow>(options.callbacks ?? {})
  pool.mount(container)

  const rows = options.rows ?? makeRows(200)
  const columns = resolveColumns(options.columns ?? [{ key: 'name' }, { key: 'amount' }])
  const visibleRows = options.visibleRows ?? 10

  let state: RowPoolPaintState<DemoRow> = {
    rows,
    rowRange: { start: 0, end: visibleRows, offset: 0 },
    columns,
    rowHeight: options.rowHeight ?? FIXTURE_ROW_HEIGHT,
    editing: null,
    active: null,
    selectionMode: 'cell',
    stripe: false,
    resolveRowKey: (row) => String(row.id),
  }

  return {
    container,
    pool,

    paint(overrides: PaintOverrides = {}): void {
      const start = overrides.start ?? state.rowRange.start
      const end =
        overrides.end ??
        (overrides.start === undefined
          ? state.rowRange.end
          : overrides.start + (state.rowRange.end - state.rowRange.start))

      state = {
        rows: overrides.rows ?? state.rows,
        rowRange: { start, end, offset: start * (overrides.rowHeight ?? state.rowHeight) },
        columns: overrides.columns ?? state.columns,
        rowHeight: overrides.rowHeight ?? state.rowHeight,
        editing: overrides.editing === undefined ? state.editing : overrides.editing,
        active: overrides.active === undefined ? state.active : overrides.active,
        selectionMode: overrides.selectionMode ?? state.selectionMode,
        stripe: overrides.stripe ?? state.stripe,
        resolveRowKey: state.resolveRowKey,
      }
      pool.paint(state)
    },

    rowNodes(): HTMLElement[] {
      return [...container.children].filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      )
    },

    cellNodes(slot: number): HTMLElement[] {
      const row = this.rowNodes()[slot]
      if (!row) return []
      return [...row.children].filter((node): node is HTMLElement => node instanceof HTMLElement)
    },

    destroy(): void {
      pool.unmount()
      container.remove()
    },
  }
}

/** Tamaño del viewport simulado en los tests de componente. */
export interface ViewportSize {
  width: number
  height: number
}

/** Tabla montada, con los accesos que necesitan los tests de interacción. */
export interface TableHarness {
  wrapper: VueWrapper
  viewport: HTMLElement
  canvas: HTMLElement
  /** Ejecuta los frames pendientes y espera a que Vue vacíe su cola. */
  flush(): Promise<void>
  /** Cambia el scroll del viewport y emite el evento nativo. */
  scrollTo(position: { top?: number; left?: number }): Promise<void>
  /** Lee el scroll actual del viewport. */
  scrollPosition(): { top: number; left: number }
  /** Manda una tecla al viewport, que es quien maneja la navegación. */
  press(key: string, modifiers?: KeyModifiers): Promise<void>
  /** Nodo de celda pintado, o `null` si no está en la ventana. */
  cell(rowIndex: number, columnKey: string): HTMLElement | null
  /** Simula el clic simple que selecciona una celda. */
  clickCell(rowIndex: number, columnKey: string): Promise<void>
  /** Simula el doble clic que abre el editor. */
  doubleClickCell(rowIndex: number, columnKey: string): Promise<void>
  /** Control de edición visible, o `null`. */
  editor(): HTMLInputElement | HTMLSelectElement | null
  unmount(): void
}

/** Modificadores aceptados por {@link TableHarness.press}. */
export interface KeyModifiers {
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

/**
 * Fuerza las medidas de un elemento.
 *
 * `happy-dom` no calcula layout, así que `clientWidth` y `clientHeight` valen 0
 * y la tabla creería que no hay viewport. Se definen como propiedades propias
 * sobre la instancia, que tapan el getter del prototipo sin modificarlo para el
 * resto del documento.
 */
function forceClientSize(element: HTMLElement, size: ViewportSize): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: size.width })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: size.height })
}

/**
 * Hace que `scrollTop` / `scrollLeft` se comporten como en un navegador.
 *
 * Además de ser escribibles, emiten `scroll` cuando cambian. Sin eso, un
 * desplazamiento programático —el que hace el auto-scroll del teclado— movería
 * el elemento pero nunca actualizaría las métricas que el componente lee, y el
 * siguiente movimiento se calcularía sobre una posición desactualizada.
 */
function forceScrollable(element: HTMLElement): void {
  let top = 0
  let left = 0
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      if (top === value) return
      top = value
      element.dispatchEvent(new Event('scroll'))
    },
  })
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      if (left === value) return
      left = value
      element.dispatchEvent(new Event('scroll'))
    },
  })
}

/**
 * Forma de fila usada en los tests de componente.
 *
 * `DataTable` es un SFC genérico: al montarlo con filas indexables por string,
 * `TRow` se infiere como este tipo. Fijarlo acá evita que cada test tenga que
 * repetir la instanciación del genérico.
 */
export type GridRow = Record<string, unknown>

/** Listeners de los eventos del componente, como props `onX`. */
export interface TableListeners {
  onBeforeEdit?: (event: BeforeEditEvent<GridRow>) => void
  onAfterEdit?: (event: AfterEditEvent<GridRow>) => void
  onEditCommit?: (event: EditCommitEvent<GridRow>) => void
  onColumnResize?: (event: ColumnResizeEvent) => void
}

/**
 * Aplana una intersección a un único tipo de objeto anónimo.
 *
 * `DataTableProps` es una `interface`, y una interface no recibe la firma de
 * índice implícita que `mount` exige para las props de un componente genérico.
 * Mapear sus claves produce un tipo de objeto anónimo equivalente que sí la
 * tiene, sin aserciones ni `any`.
 */
type Simplify<T> = { [K in keyof T]: T[K] }

/** Props que acepta {@link mountTable}: las del componente más sus listeners. */
export type TableProps = Simplify<DataTableProps<GridRow> & TableListeners>

/** Opciones de {@link mountTable}. */
export interface MountTableOptions {
  props: TableProps
  viewport?: ViewportSize
}

/**
 * Monta `DataTable` con un viewport de tamaño conocido y el primer frame ya
 * pintado.
 */
export async function mountTable(options: MountTableOptions): Promise<TableHarness> {
  const size = options.viewport ?? { width: 600, height: 400 }

  const host = document.createElement('div')
  document.body.appendChild(host)

  const wrapper = mount(DataTable, {
    attachTo: host,
    props: options.props,
  })

  const viewport = wrapper.find('.dt-viewport').element
  const canvas = wrapper.find('.dt-canvas').element
  if (!(viewport instanceof HTMLElement) || !(canvas instanceof HTMLElement)) {
    throw new Error('[harness] la tabla montada no expuso viewport o canvas')
  }

  forceClientSize(viewport, size)
  forceScrollable(viewport)

  // El componente ya pidió un frame al montarse, pero midió un viewport de 0px.
  // El observer falso entrega las medidas reales y dispara el repintado.
  FakeResizeObserver.latest()?.emit(size)
  flushFrames(2)
  await nextTick()
  flushFrames(2)

  const harness: TableHarness = {
    wrapper,
    viewport,
    canvas,

    async flush(): Promise<void> {
      await nextTick()
      flushFrames(2)
      await nextTick()
    },

    async scrollTo(position: { top?: number; left?: number }): Promise<void> {
      if (position.top !== undefined) viewport.scrollTop = position.top
      if (position.left !== undefined) viewport.scrollLeft = position.left
      viewport.dispatchEvent(new Event('scroll'))
      await harness.flush()
    },

    scrollPosition(): { top: number; left: number } {
      return { top: viewport.scrollTop, left: viewport.scrollLeft }
    },

    async press(key: string, modifiers: KeyModifiers = {}): Promise<void> {
      viewport.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
      )
      await harness.flush()
    },

    cell(rowIndex: number, columnKey: string): HTMLElement | null {
      return findCell(canvas, rowIndex, columnKey)
    },

    async clickCell(rowIndex: number, columnKey: string): Promise<void> {
      const target = cellByPosition(canvas, rowIndex, columnKey)
      target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await harness.flush()
    },

    async doubleClickCell(rowIndex: number, columnKey: string): Promise<void> {
      const target = cellByPosition(canvas, rowIndex, columnKey)
      target.dispatchEvent(new Event('dblclick', { bubbles: true }))
      await harness.flush()
    },

    editor(): HTMLInputElement | HTMLSelectElement | null {
      for (const node of wrapper.element.querySelectorAll('.dt-editor')) {
        if (
          (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) &&
          !node.hidden
        ) {
          return node
        }
      }
      return null
    },

    unmount(): void {
      wrapper.unmount()
      host.remove()
    },
  }

  return harness
}

/**
 * Encuentra el nodo de celda de una posición lógica, o `null`.
 *
 * El pool identifica la fila con `data-row-key` y no estampa la clave de columna
 * en el DOM: la columna se resuelve por `aria-colindex`, que sí escribe y que es
 * 1-based sobre las columnas VISIBLES. El andamiaje usa el índice de fila como
 * `rowKey`, así que la búsqueda vertical es directa.
 */
export function findCell(
  canvas: HTMLElement,
  rowIndex: number,
  columnKey: string,
): HTMLElement | null {
  const columnIndex = visibleColumnKeys(canvas).indexOf(columnKey)
  if (columnIndex < 0) return null

  for (const node of canvas.querySelectorAll('.dt-row')) {
    if (!(node instanceof HTMLElement) || node.hidden) continue
    if (node.dataset.rowKey !== String(rowIndex)) continue
    for (const cellNode of node.querySelectorAll('.dt-cell')) {
      if (!(cellNode instanceof HTMLElement) || cellNode.hidden) continue
      if (cellNode.getAttribute('aria-colindex') === String(columnIndex + 1)) return cellNode
    }
  }
  return null
}

/** Igual que {@link findCell}, pero falla con un mensaje claro si la celda no está. */
export function cellByPosition(
  canvas: HTMLElement,
  rowIndex: number,
  columnKey: string,
): HTMLElement {
  const found = findCell(canvas, rowIndex, columnKey)
  if (!found) throw new Error(`[harness] la celda (${rowIndex}, ${columnKey}) no está pintada`)
  return found
}

/** Claves de columna visibles, leídas del header que renderiza Vue. */
export function visibleColumnKeys(canvas: HTMLElement): string[] {
  const root = canvas.closest('.dt-root')
  if (!root) return []
  const keys: string[] = []
  for (const node of root.querySelectorAll('.dt-header-cell .dt-header-label')) {
    keys.push(node.textContent ?? '')
  }
  return keys
}
