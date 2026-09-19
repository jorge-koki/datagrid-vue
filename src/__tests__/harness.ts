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
import type { VNode } from 'vue'
import DataTable from '../DataTable.vue'
import { useRowPool } from '../composables/useRowPool'
import type { RowPool, RowPoolCallbacks, RowPoolPaintState } from '../composables/useRowPool'
import type { ResolvedColumn } from '../composables/useColumnLayout'
import { useRowMetrics } from '../composables/useRowMetrics'
import type { RowMetrics } from '../composables/useRowMetrics'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellEditorSlotProps,
  CellPosition,
  ColumnResizeEvent,
  DataTableColumn,
  DataTableInstance,
  DataTableProps,
  EditCommitEvent,
  FlatRow,
  RangeCopyEvent,
  RangeSelectEvent,
  SelectionMode,
} from '../types'
import { defaultAlignFor } from '../internal/renderers'
import { DEFAULT_HEADER_HEIGHT, DENSE_HEADER_HEIGHT } from '../internal/constants'
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
      reorderable: column.reorderable ?? true,
      pinned: column.pinned ?? null,
      pinnable: false,
      pinSide: null,
      sortable: column.sortable !== undefined && column.sortable !== false,
      sortOnHeaderClick: column.sortable === true,
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
  /** Alto por fila. Null o ausente = todas iguales a `rowHeight`. */
  heightAt?: ((index: number) => number) | null
  active?: CellPosition | null
  editing?: CellPosition | null
  selectionMode?: SelectionMode
  stripe?: boolean
  /** Secuencia aplanada, o `null` para volver al camino sin agrupación. */
  flatRows?: readonly FlatRow<DemoRow>[] | null
  groupDepth?: number
  showGroupCount?: boolean
  /** Columnas ancladas, que se pintan fuera de la ventana virtual. */
  pinnedColumns?: readonly ResolvedColumn<DemoRow>[]
  /** Ancho total de la tabla: el de la fila, y el origen del carril del final. */
  totalWidth?: number
}

/** Pool instanciado sobre un contenedor real, listo para pintar. */
export interface PoolFixture {
  /** Contenedor adoptado por el pool. Es el `root` que observa la grabadora. */
  container: HTMLElement
  /**
   * Carril de numeración, o `null` si el fixture se creó sin él.
   *
   * Es un contenedor SEPARADO del canvas, igual que en el componente, así que la
   * grabadora que observa `container` no ve sus escrituras: para medirlas hay que
   * observar este nodo.
   */
  gutter: HTMLElement | null
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

/**
 * Arma la geometría vertical que el pool espera recibir.
 *
 * Llama al composable REAL en lugar de fabricar un objeto a mano: si la
 * aritmética de offsets cambiara, los tests del pool tienen que moverse con
 * ella. Un doble escrito acá seguiría dando verde mientras la tabla se rompe.
 *
 * La cantidad de filas se toma por lo alto —el dataset, la secuencia aplanada y
 * el final del tramo pedido— porque `offsetOf` acota fuera de rango: con un
 * conteo corto, pintar una cabecera de grupo más allá del largo de `rows`
 * devolvería el offset del último y apilaría las filas una sobre otra.
 */
function metricsFor(
  rowHeight: number,
  heightAt: ((index: number) => number) | null,
  // `(DemoRow | undefined)[]` y no `DemoRow[]`: en modo servidor el dataset
  // tiene huecos, y acá solo se mira el largo.
  rows: readonly (DemoRow | undefined)[],
  flatRows: readonly FlatRow<DemoRow>[] | null,
  end: number,
): RowMetrics {
  const rowCount = Math.max(rows.length, flatRows?.length ?? 0, end, 0)
  return useRowMetrics({ rowCount, rowHeight, heightAt, viewportSize: 0, scrollOffset: 0 }).metrics
    .value
}

/** Opciones de {@link createPoolFixture}. */
export interface PoolFixtureOptions {
  rows?: readonly DemoRow[]
  columns?: readonly DataTableColumn<DemoRow>[]
  rowHeight?: number
  /** Alto por fila. Null o ausente = todas iguales a `rowHeight`. */
  heightAt?: ((index: number) => number) | null
  visibleRows?: number
  callbacks?: RowPoolCallbacks
  /** Secuencia aplanada inicial. `null` o ausente pinta sin agrupación. */
  flatRows?: readonly FlatRow<DemoRow>[] | null
  groupDepth?: number
  showGroupCount?: boolean
  /** Monta además el carril de numeración. Por defecto no. */
  rowNumbers?: boolean
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

  let gutter: HTMLElement | null = null
  if (options.rowNumbers) {
    gutter = document.createElement('div')
    gutter.className = 'dt-gutter'
    document.body.appendChild(gutter)
  }

  const pool = useRowPool<DemoRow>(options.callbacks ?? {})
  pool.mount(container, gutter)

  const rows = options.rows ?? makeRows(200)
  const columns = resolveColumns(options.columns ?? [{ key: 'name' }, { key: 'amount' }])
  const visibleRows = options.visibleRows ?? 10

  // El alto base y el resolutor viven fuera del estado porque el estado ya no
  // los guarda: guarda la geometría YA RESUELTA. Un `paint` que cambie uno de
  // los dos tiene que poder reconstruirla, y para eso necesita el otro.
  let baseHeight = options.rowHeight ?? FIXTURE_ROW_HEIGHT
  let heightAt = options.heightAt ?? null

  let state: RowPoolPaintState<DemoRow> = {
    rows,
    flatRows: options.flatRows ?? null,
    groupDepth: options.groupDepth ?? 0,
    showGroupCount: options.showGroupCount ?? true,
    rowRange: { start: 0, end: visibleRows, offset: 0 },
    columns,
    // El andamiaje no virtualiza columnas: las que pinta son todas las que hay,
    // así que su ancho total es la suma de las que se le pasaron.
    totalWidth: columns.reduce((sum, column) => sum + column.width, 0),
    rowMetrics: metricsFor(baseHeight, heightAt, rows, options.flatRows ?? null, visibleRows),
    editing: null,
    active: null,
    selectionMode: 'cell',
    stripe: false,
    resolveRowKey: (row) => String(row.id),
  }

  return {
    container,
    gutter,
    pool,

    paint(overrides: PaintOverrides = {}): void {
      const start = overrides.start ?? state.rowRange.start
      const end =
        overrides.end ??
        (overrides.start === undefined
          ? state.rowRange.end
          : overrides.start + (state.rowRange.end - state.rowRange.start))

      if (overrides.rowHeight !== undefined) baseHeight = overrides.rowHeight
      if (overrides.heightAt !== undefined) heightAt = overrides.heightAt

      const nextRows = overrides.rows ?? state.rows
      const nextFlat = overrides.flatRows === undefined ? state.flatRows : overrides.flatRows
      const metrics = metricsFor(baseHeight, heightAt, nextRows, nextFlat ?? null, end)

      state = {
        rows: overrides.rows ?? state.rows,
        // `null` es un valor con significado —"sin agrupación"—, así que la
        // distinción entre "no lo pasaron" y "lo pasaron nulo" tiene que ser
        // contra `undefined`, igual que con `editing` y `active`.
        flatRows: overrides.flatRows === undefined ? state.flatRows : overrides.flatRows,
        groupDepth: overrides.groupDepth ?? state.groupDepth,
        showGroupCount: overrides.showGroupCount ?? state.showGroupCount,
        rowRange: { start, end, offset: metrics.offsetOf(start) },
        columns: overrides.columns ?? state.columns,
        rowMetrics: metrics,
        editing: overrides.editing === undefined ? state.editing : overrides.editing,
        active: overrides.active === undefined ? state.active : overrides.active,
        selectionMode: overrides.selectionMode ?? state.selectionMode,
        stripe: overrides.stripe ?? state.stripe,
        pinnedColumns: overrides.pinnedColumns ?? state.pinnedColumns,
        totalWidth: overrides.totalWidth ?? state.totalWidth,
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
      return [...row.children].filter(
        // Los carriles anclados son andamiaje de maquetado, no celdas: miden cero
        // y no muestran nada. Quien pregunta por las celdas de una fila no los
        // está pidiendo.
        (node): node is HTMLElement =>
          node instanceof HTMLElement && !node.classList.contains('dt-pinned-lane'),
      )
    },

    destroy(): void {
      pool.unmount()
      container.remove()
      gutter?.remove()
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
  /**
   * API imperativa del componente, tipada como {@link DataTableInstance}.
   *
   * `DataTable` es un SFC genérico y `wrapper.vm` no lleva el tipo de lo que
   * expuso `defineExpose`, así que sin esto cada test tendría que rebuscar el
   * método a mano. Ver {@link imperativeApi} para cómo se construye sin
   * aserciones de tipo.
   */
  api: DataTableInstance
  /**
   * Elemento que lleva el rol de grilla.
   *
   * Es `.dt-root`, o sea la raíz del componente, porque es el único nodo que
   * contiene a la vez la fila de encabezado y el cuerpo. No es el viewport: ese
   * scrollea y recibe el teclado, pero queda por debajo de la grilla.
   */
  grid: HTMLElement
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
  /** Simula `Shift`+clic, que extiende el rango en vez de mover la selección. */
  shiftClickCell(rowIndex: number, columnKey: string): Promise<void>
  /**
   * Simula un arrastre de selección: apretar sobre una celda, pasar por las
   * intermedias y soltar sobre la última.
   *
   * Los movimientos se despachan sobre las celdas mismas y burbujean hasta el
   * documento, que es donde el pool escucha mientras dura el arrastre. Es el
   * mismo camino que recorre un mouse de verdad.
   */
  dragCells(path: readonly [rowIndex: number, columnKey: string][]): Promise<void>
  /** Simula el doble clic que abre el editor. */
  doubleClickCell(rowIndex: number, columnKey: string): Promise<void>
  /**
   * Dispara un `copy` sobre el viewport y devuelve lo que la tabla escribió.
   *
   * `null` significa que la tabla dejó pasar el evento sin escribir nada, que es
   * lo que debe ocurrir cuando no hay nada que copiar o cuando hay un editor
   * abierto y el copiado es del `<input>`.
   */
  copy(): Promise<string | null>
  /** Control de edición visible, o `null`. */
  editor(): HTMLInputElement | HTMLSelectElement | null
  /**
   * Caja del editor por slot mientras está abierta, o `null`.
   *
   * Devuelve `null` tanto cuando la tabla no declara el slot —el nodo ni siquiera
   * se renderiza— como cuando está oculto por no haber ninguna celda de slot en
   * edición. Las dos cosas significan lo mismo para quien la consulta.
   */
  slotEditor(): HTMLElement | null
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

/** El alto de encabezado que va a resolver el componente con estas props. */
function headerHeightOf(props: TableProps | undefined): number {
  const declared = props?.headerHeight
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) return declared
  return props?.dense ? DENSE_HEADER_HEIGHT : DEFAULT_HEADER_HEIGHT
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
  onRangeSelect?: (event: RangeSelectEvent<GridRow>) => void
  onRangeCopy?: (event: RangeCopyEvent) => void
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

/**
 * Slots que acepta {@link mountTable}.
 *
 * Se declara como función de render y no como plantilla en string porque el
 * entorno de tests resuelve `vue` a su build sin compilador: una plantilla en
 * string no se compilaría en tiempo de ejecución.
 */
export interface TableSlots {
  editor?: (props: CellEditorSlotProps<GridRow>) => VNode
}

/** Opciones de {@link mountTable}. */
export interface MountTableOptions {
  props: TableProps
  viewport?: ViewportSize
  /** Slots del componente. Ausente monta la tabla sin ningún slot declarado. */
  slots?: TableSlots
}

/**
 * Envuelve lo que expuso `defineExpose` en la forma tipada del contrato público.
 *
 * El componente es un SFC genérico: `wrapper.vm` no arrastra el tipo de la API
 * imperativa, y afirmarlo sería exactamente el tipo de mentira que después tapa
 * un método que dejó de exponerse. Acá cada miembro se busca en tiempo de
 * ejecución y falla con un mensaje que nombra al método, mientras que el tipo de
 * retorno —{@link DataTableInstance}, el mismo que ve el consumidor— obliga a que
 * el envoltorio siga cubriendo la API entera: si mañana aparece un método nuevo,
 * este archivo deja de compilar hasta que se lo agregue.
 */
function imperativeApi(wrapper: VueWrapper): DataTableInstance {
  const instance: unknown = wrapper.vm
  if (typeof instance !== 'object' || instance === null) {
    throw new Error('[harness] la tabla montada no expuso su instancia')
  }

  // Arrow function en un `const` y no una declaración `function`: una
  // declaración se iza al tope del bloque, y para TypeScript eso significa que
  // se creó ANTES del `typeof` de arriba, con lo cual `instance` volvería a ser
  // `unknown` dentro del cuerpo. Declarándola después, el estrechamiento a
  // `object` sobrevive y `Reflect.get` resuelve su firma sin aserciones.
  const call = (name: keyof DataTableInstance, ...args: unknown[]): void => {
    const method: unknown = Reflect.get(instance, name)
    if (typeof method !== 'function') {
      throw new Error(`[harness] el componente no expuso "${name}"`)
    }
    method.call(instance, ...args)
  }

  return {
    scrollToRow: (index) => call('scrollToRow', index),
    scrollToColumn: (key) => call('scrollToColumn', key),
    scrollToCell: (position) => call('scrollToCell', position),
    selectCell: (position) => call('selectCell', position),
    selectRange: (range) => call('selectRange', range),
    refresh: () => call('refresh'),
    refreshRows: () => call('refreshRows'),
    resetLayout: () => call('resetLayout'),
    flushPersistence: () => call('flushPersistence'),
    toggleGroup: (groupId) => call('toggleGroup', groupId),
    expandAllGroups: () => call('expandAllGroups'),
    collapseAllGroups: () => call('collapseAllGroups'),
  }
}

/**
 * Monta `DataTable` con un viewport de tamaño conocido y el primer frame ya
 * pintado.
 */
export async function mountTable(options: MountTableOptions): Promise<TableHarness> {
  const rowsArea = options.viewport ?? { width: 600, height: 400 }
  /*
   * `viewport.height` es el alto disponible para FILAS, no el del scroller.
   *
   * El encabezado vive dentro del viewport y se queda pegado arriba con
   * `position: sticky`: ocupa alto real y tapa esa franja, así que el scroller
   * mide el alto de las filas MÁS el del encabezado. Se suma acá, en un solo
   * lugar, para que cada test pueda seguir diciendo "en 400px entran diez filas"
   * sin arrastrar una constante que no es lo que está protegiendo.
   */
  const size = {
    width: rowsArea.width,
    height: rowsArea.height + headerHeightOf(options.props),
  }

  const host = document.createElement('div')
  document.body.appendChild(host)

  const wrapper = mount(DataTable, {
    attachTo: host,
    props: {
      /*
       * El andamiaje monta SIN regleta de numeración, salvo que el test la pida.
       *
       * La regleta reserva espacio a la izquierda de la primera columna, así que
       * con ella encendida cada aserción de píxeles de esta suite —auto-scroll,
       * geometría del editor, recuadro del rango— llevaría sumado un ancho que
       * no tiene nada que ver con lo que ese test protege, y la cuenta dejaría de
       * poder leerse de un vistazo. Lo mismo con los presupuestos de escrituras
       * por frame, que compararían una tabla numerada contra un pool desnudo.
       *
       * Que el valor por defecto del COMPONENTE es `true` lo verifica
       * `row-numbers.test.ts`, que monta sin pasar la prop y cuenta los números.
       */
      showRowNumbers: false,
      ...options.props,
    },
    slots: options.slots,
  })

  const grid = wrapper.find('.dt-root').element
  const viewport = wrapper.find('.dt-viewport').element
  const canvas = wrapper.find('.dt-canvas').element
  if (
    !(grid instanceof HTMLElement) ||
    !(viewport instanceof HTMLElement) ||
    !(canvas instanceof HTMLElement)
  ) {
    throw new Error('[harness] la tabla montada no expuso raíz, viewport o canvas')
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
    api: imperativeApi(wrapper),
    grid,
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

    async shiftClickCell(rowIndex: number, columnKey: string): Promise<void> {
      const target = cellByPosition(canvas, rowIndex, columnKey)
      // Un `MouseEvent` de verdad y no un `Event` pelado: el pool lee `button` y
      // `shiftKey`, que solo existen en el primero.
      target.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, shiftKey: true }),
      )
      await harness.flush()
    },

    async dragCells(path: readonly [rowIndex: number, columnKey: string][]): Promise<void> {
      const [first, ...rest] = path
      if (!first) return

      const start = cellByPosition(canvas, first[0], first[1])
      start.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      await harness.flush()

      let last = start
      for (const [rowIndex, columnKey] of rest) {
        last = cellByPosition(canvas, rowIndex, columnKey)
        // `buttons: 1` dice que el botón sigue apretado. Con cero, el pool da el
        // arrastre por terminado, que es justamente lo que tiene que hacer.
        last.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1 }))
        await harness.flush()
      }

      last.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      await harness.flush()
    },

    async doubleClickCell(rowIndex: number, columnKey: string): Promise<void> {
      const target = cellByPosition(canvas, rowIndex, columnKey)
      target.dispatchEvent(new Event('dblclick', { bubbles: true }))
      await harness.flush()
    },

    async copy(): Promise<string | null> {
      let written: string | null = null
      const event = new Event('copy', { bubbles: true, cancelable: true })
      // `happy-dom` no construye `ClipboardEvent` con un `DataTransfer` usable,
      // así que se le injerta uno mínimo: el componente solo llama `setData`.
      Object.defineProperty(event, 'clipboardData', {
        value: {
          setData(format: string, data: string): void {
            if (format === 'text/plain') written = data
          },
        },
      })

      viewport.dispatchEvent(event)
      await harness.flush()
      return written
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

    slotEditor(): HTMLElement | null {
      const node = wrapper.element.querySelector('.dt-editor-slot')
      if (!(node instanceof HTMLElement) || node.hidden) return null
      return node
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
