/**
 * Superficie de tipos pública del DataTable.
 *
 * Todo lo que un consumidor necesita para tipar una columna, una prop o un
 * handler de evento vive aquí y se reexporta desde `index.ts`. Las formas
 * internas (nodos del pool, entradas de layout resueltas, métricas de scroll)
 * quedan deliberadamente en sus propios módulos para que este archivo se lea
 * como el contrato y nada más.
 */

/**
 * Todos los valores que la tabla sabe renderizar sin ayuda.
 *
 * Cualquier cosa fuera de esta unión (objetos, arrays, instancias de clase)
 * debe mapearse con {@link DataTableColumn.accessor} o
 * {@link DataTableColumn.format}, porque el camino de pintado escribe el valor
 * directo en `textContent` y no tiene opinión sobre cómo deberían verse tus
 * objetos de dominio.
 */
export type CellValue = string | number | boolean | null | undefined | Date

/**
 * Alineación horizontal del texto de una celda.
 *
 * Se aplica como una clase estática sobre el nodo de celda en lugar de un
 * estilo inline, así el camino de pintado alterna una clase en vez de tocar
 * `style`.
 */
export type CellAlign = 'left' | 'center' | 'right'

/**
 * Selección del esquema de color.
 *
 * - `light` / `dark` fuerzan la paleta sin importar el entorno anfitrión.
 * - `auto` sigue a `prefers-color-scheme` y a una clase `.dark` / `.light` en
 *   el elemento raíz del documento, para que la tabla acompañe un toggle de
 *   tema a nivel aplicación.
 */
export type DataTableTheme = 'light' | 'dark' | 'auto'

/**
 * Descripción declarativa de una columna.
 *
 * Una columna es configuración, no estado: se lee en cada pintado, así que los
 * dos hooks de función (`format`, `cellClass`) quedan directamente sobre el
 * camino caliente del scroll. Deben mantenerse puras y libres de
 * asignaciones para sostener 60fps.
 *
 * @typeParam TRow - Forma de una fila individual dentro de `rows`.
 */
export interface DataTableColumn<TRow> {
  /** Id único de la columna. También es la clave de datos por defecto. */
  key: string
  /** Etiqueta del header. Por defecto usa `key`. */
  label?: string
  /** Ancho fijo en px. Si falta, cae en `defaultColumnWidth`. */
  width?: number
  /** Cota inferior aplicada al resolver el ancho y al redimensionar, en px. */
  minWidth?: number
  /** Cota superior aplicada al resolver el ancho y al redimensionar, en px. */
  maxWidth?: number
  /** Si la columna se puede redimensionar arrastrando el borde de su header. */
  resizable?: boolean
  /** Alineación del texto dentro de la celda. */
  align?: CellAlign
  /** Si las celdas de esta columna se pueden editar. */
  editable?: boolean
  /**
   * Formatea el valor crudo al string que se escribe en el `textContent` de la
   * celda. DEBE ser pura y barata: corre en cada pintado, sobre el camino
   * caliente del scroll.
   */
  format?: (value: CellValue, row: TRow, rowIndex: number) => string
  /**
   * Clase CSS extra aplicada al elemento de celda. Corre en el camino caliente:
   * debe mantenerse barata.
   */
  cellClass?: (value: CellValue, row: TRow, rowIndex: number) => string | undefined
  /** Lee el valor desde la fila. Por defecto usa `row[key]`. */
  accessor?: (row: TRow) => CellValue
  /**
   * Renderer de celda. Por defecto `'text'`.
   * Acepta el nombre de un renderer registrado o una implementación propia.
   */
  renderer?: string | CellRenderer<TRow>
  /** Si la columna puede ocultarse desde la UI. Por defecto `true`. */
  hideable?: boolean
  /** Visibilidad inicial. La persistencia y el v-model tienen prioridad sobre esto. */
  defaultVisible?: boolean
  /** Tipo de editor que se abre al editar la celda. Por defecto se infiere del valor. */
  editor?: CellEditorType
  /** Opciones para los renderers y editores de tipo `select`, `badge` y `tags`. */
  options?: readonly CellOption[]
  /** Valor mínimo del editor `number`. Se traslada al atributo `min` del input. */
  min?: number
  /** Valor máximo del editor `number`. Se traslada al atributo `max` del input. */
  max?: number
  /** Paso del editor `number`. Se traslada al atributo `step` del input. */
  step?: number
}

/**
 * Tipo de control que se abre al editar una celda.
 *
 * Es un eje INDEPENDIENTE del renderer. Cómo se ve una celda y cómo se edita son
 * decisiones separadas: un badge puede ser de solo lectura y una celda de texto
 * plano puede abrir un desplegable. Acoplarlos obligaría a inventar un renderer
 * por cada combinación.
 */
export type CellEditorType = 'text' | 'number' | 'select' | 'checkbox' | 'date'

/**
 * Una opción de un conjunto cerrado de valores.
 *
 * La consumen tanto los renderers (`badge`, `select`, `tags`) para traducir un
 * valor crudo a etiqueta y color, como el editor `select` para armar su lista.
 * Es la misma fuente de verdad para presentación y edición.
 */
export interface CellOption {
  /** Valor tal como vive en los datos. */
  value: string | number | boolean
  /** Texto mostrado al usuario. */
  label: string
  /** Color del badge. Acepta cualquier color CSS o un token `--dt-*`. */
  color?: string
}

/** Mapa de visibilidad por columna. Una clave ausente se interpreta como visible. */
export type ColumnVisibilityState = Readonly<Record<string, boolean>>

/** Anchos definidos por el usuario, en px, por clave de columna. */
export type ColumnWidthState = Readonly<Record<string, number>>

/**
 * Estado de la tabla que se persiste entre sesiones.
 *
 * Se guarda plano y sin referencias a los objetos de columna: lo que sobrevive a
 * un reload son claves, no definiciones. Las definiciones cambian con cada
 * deploy, y por eso este estado siempre se reconcilia contra las columnas
 * actuales antes de aplicarse.
 */
export interface PersistedTableState {
  /** Versión del esquema persistido. Permite invalidar formatos viejos. */
  version: number
  /** Visibilidad por clave de columna. */
  columnVisibility: Record<string, boolean>
  /** Anchos en px por clave de columna. */
  columnWidths: Record<string, number>
  /** Claves de columna en el orden elegido por el usuario. */
  columnOrder: string[]
}

/**
 * Adaptador de almacenamiento. Por defecto se usa `localStorage`, pero el
 * consumidor puede inyectar el suyo para guardar la configuración por usuario
 * en un backend. Los métodos pueden ser síncronos o asíncronos.
 */
export interface DataTableStorageAdapter {
  /** Lee el estado guardado. Devuelve `null` si no hay nada o si está corrupto. */
  load(key: string): PersistedTableState | null | Promise<PersistedTableState | null>
  /** Guarda el estado. Las fallas deben absorberse, nunca propagarse. */
  save(key: string, state: PersistedTableState): void | Promise<void>
  /** Borra el estado guardado. */
  remove(key: string): void | Promise<void>
}

/** Configuración de la persistencia del layout de la tabla. */
export interface DataTablePersistOptions {
  /** Permite apagar la persistencia sin desarmar la configuración. Por defecto `true`. */
  enabled?: boolean
  /** Dónde se guarda. Por defecto, un adaptador sobre `localStorage`. */
  adapter?: DataTableStorageAdapter
  /** Qué partes del estado se persisten. Por defecto, todas. */
  include?: { visibility?: boolean; widths?: boolean; order?: boolean }
  /** Ms de espera antes de escribir. Evita escribir en cada frame del drag de resize. */
  debounce?: number
  /**
   * Versión del esquema. Si no coincide con la guardada, el estado se descarta.
   * Subirla es la forma de invalidar layouts viejos tras un cambio incompatible.
   */
  version?: number
}

/**
 * Handle opaco que devuelve {@link CellRenderer.create}.
 *
 * Guarda las referencias a los nodos que `update` va a mutar en cada repintado,
 * más el caché que cada renderer necesite para saltear escrituras redundantes.
 * El pool lo almacena sobre el nodo de celda y se lo devuelve tal cual: nunca
 * lee su contenido ni asume nada sobre él más allá de `root`.
 */
export interface CellRendererHandle {
  /** El nodo `.dt-cell` sobre el que trabaja el renderer. */
  readonly root: HTMLElement
  /** Estado privado del renderer. El pool nunca lo interpreta. */
  [key: string]: unknown
}

/**
 * Argumentos que recibe {@link CellRenderer.update} en cada repintado.
 *
 * Todo viene ya resuelto para que `update` no tenga que buscar nada: el valor ya
 * pasó por el `accessor` de la columna y el estado de edición ya está calculado.
 *
 * @typeParam TRow - Forma de una fila individual dentro de `rows`.
 */
export interface CellRenderContext<TRow> {
  /** Valor de la celda, ya leído por el accessor de la columna. */
  readonly value: CellValue
  /**
   * El valor sin normalizar, tal como salió de la fila.
   *
   * `value` está reducido a {@link CellValue}, que no puede expresar un array ni
   * un objeto: `toCellValue` los convierte a texto. Renderers como `tags` o
   * `avatar` necesitan la forma original —una lista de etiquetas, un
   * `{ name, src }`— y la leen de acá, estrechándola por su cuenta.
   *
   * Es `unknown` a propósito: quien lo consume debe validarlo antes de usarlo.
   */
  readonly raw: unknown
  /** La fila completa, por si el renderer necesita más de una columna. */
  readonly row: TRow
  /** Índice de la fila dentro de la prop `rows`. */
  readonly rowIndex: number
  /** La definición de columna, con su `format` y sus opciones. */
  readonly column: DataTableColumn<TRow>
  /** Si esta celda es la que tiene el editor abierto encima. */
  readonly isEditing: boolean
}

/**
 * Contrato de un renderer de celda reciclable.
 *
 * El pool llama `create` UNA sola vez por nodo de celda (al crecer el pool) y
 * luego llama `update` en cada repintado. `update` debe MUTAR los nodos que
 * `create` construyó, nunca recrearlos: ese es el contrato que sostiene el
 * scroll a 60fps.
 *
 * @typeParam TRow - Forma de una fila individual dentro de `rows`.
 */
export interface CellRenderer<TRow> {
  /** Identificador del renderer. Usado por el pool para segmentar celdas por tipo. */
  readonly type: string
  /**
   * Alineación que adopta la columna cuando no declara `align`.
   *
   * Permite que `number` alinee a la derecha sin que el consumidor tenga que
   * pedirlo, y que el header de esa columna se alinee igual que sus celdas.
   * Un `column.align` explícito siempre gana.
   */
  readonly defaultAlign?: CellAlign
  /**
   * Construye la estructura interna de la celda una única vez.
   * Devuelve un handle opaco con las referencias a los nodos que `update` va a mutar.
   */
  create(cell: HTMLElement): CellRendererHandle
  /**
   * Actualiza la celda con el valor actual. Se ejecuta en el camino crítico
   * del scroll: debe ser barata y no debe crear nodos ni leer layout.
   */
  update(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void
  /** Libera recursos del handle. Se llama al desmontar o al cambiar el tipo de renderer. */
  destroy?(handle: CellRendererHandle): void
}

/**
 * Props que acepta el componente `DataTable`.
 *
 * `rows` y `columns` son `readonly` a propósito: la tabla es **controlada** y
 * nunca escribe sobre los arrays que recibe. Las ediciones se reportan vía
 * {@link EditCommitEvent} y el padre es dueño de la escritura.
 *
 * @typeParam TRow - Forma de una fila individual dentro de `rows`.
 */
export interface DataTableProps<TRow> {
  /**
   * El dataset completo. No se corta, no se copia y no se vuelve reactivo en
   * profundidad: el componente guarda una referencia superficial, que es
   * justamente lo que le permite sostener 100k filas sin asignar 100k proxies
   * reactivos.
   */
  rows: readonly TRow[]
  /** Definiciones de columna, en orden de presentación. */
  columns: readonly DataTableColumn<TRow>[]
  /**
   * Identidad de una fila: un nombre de propiedad o una función.
   *
   * Se usa para el atributo `data-row-key` estampado en cada fila pintada, de
   * modo que el DOM siga siendo inspeccionable y testeable. El pool recicla
   * nodos por slot de viewport, nunca por clave, así que esto jamás afecta la
   * reconciliación.
   */
  rowKey: keyof TRow | ((row: TRow, index: number) => string | number)
  /**
   * Altura de fila en px. Por defecto 40, o 30 con `dense` encendido.
   *
   * Es un número y no un valor CSS porque el virtualizador divide por él en
   * cada frame. El componente lo replica en la custom property
   * `--dt-row-height` para que CSS y JS nunca puedan discrepar.
   */
  rowHeight?: number
  /** Altura del header en px. Por defecto 44, o 34 con `dense` encendido. */
  headerHeight?: number
  /** Preset compacto: filas más bajas, tipografía menor, padding más ajustado. */
  dense?: boolean
  /**
   * Filas y columnas extra pintadas fuera de la ventana visible.
   *
   * Valores más altos cuestan tiempo de pintado pero ocultan bordes en blanco
   * durante scroll rápido. Por defecto 4.
   */
  overscan?: number
  /** Ancho en px para columnas que no declaran el suyo. Por defecto 150. */
  defaultColumnWidth?: number
  /**
   * Si se pintan únicamente las columnas visibles horizontalmente. Por defecto
   * `true`.
   *
   * Conviene apagarlo en tablas angostas donde la fila entera entra en
   * pantalla: ahí el cálculo de ventana es puro overhead.
   */
  virtualizeColumns?: boolean
  /** Esquema de color. Por defecto `'auto'`. */
  theme?: DataTableTheme
  /** Mensaje mostrado cuando `rows` está vacío. */
  emptyText?: string
  /** Fondo alternado para las filas impares. */
  stripe?: boolean
  /** Dibuja separadores de celda. */
  bordered?: boolean
  /**
   * Visibilidad por clave de columna. `v-model:column-visibility`.
   *
   * Si se omite, la tabla mantiene el estado internamente y funciona sola. Si se
   * pasa, la prop manda y el componente solo emite `update:columnVisibility`.
   * Una clave ausente se resuelve con `defaultVisible ?? true`.
   */
  columnVisibility?: ColumnVisibilityState
  /**
   * Orden de las columnas por clave. `v-model:column-order`.
   *
   * Se reconcilia contra las columnas actuales antes de aplicarse: las claves
   * desconocidas se descartan y las columnas que falten se agregan al final en
   * orden de declaración. Si se omite, rige el orden de declaración.
   */
  columnOrder?: readonly string[]
  /**
   * Anchos en px por clave de columna. `v-model:column-widths`.
   *
   * Pisan a `column.width` y siempre se acotan por `minWidth`/`maxWidth`. Es lo
   * que actualiza el arrastre del handle de redimensionado.
   */
  columnWidths?: ColumnWidthState
  /**
   * Identificador único de esta tabla dentro de la aplicación.
   *
   * Obligatorio para persistir: es lo que separa la configuración de una tabla
   * de la de otra. Sin él, dos tablas compartirían la clave de almacenamiento.
   */
  tableId?: string
  /**
   * Persistencia del layout entre sesiones. Por defecto `false`.
   *
   * `true` usa `localStorage` con los valores por defecto. Un objeto permite
   * elegir adaptador, debounce, versión de esquema y qué partes guardar.
   * Requiere `tableId`; sin él se emite un aviso y la persistencia queda
   * desactivada.
   */
  persist?: boolean | DataTablePersistOptions
  /**
   * Modo de selección. Por defecto `'cell'`.
   *
   * Un clic simple selecciona; el doble clic, Enter o F2 abren el editor. Son
   * dos gestos distintos a propósito: seleccionar para mirar o para navegar con
   * el teclado es mucho más frecuente que editar, y exigir doble clic para lo
   * primero obliga a un gesto de más en el caso común.
   */
  selectionMode?: SelectionMode
  /**
   * Celda activa. `v-model:active-cell`.
   *
   * Si se omite, la tabla mantiene el estado internamente. Si se pasa —incluido
   * `null`, que significa "controlado y sin selección"—, la prop manda y el
   * componente solo emite `update:activeCell`.
   */
  activeCell?: CellPosition | null
}

/**
 * Modo de selección de la tabla.
 *
 * - `cell`: se marca la celda activa. Es el modelo de una planilla de cálculo.
 * - `row`: se marca la fila entera, pero la celda activa igual se registra para
 *   que la navegación con teclado sepa en qué columna está parada.
 * - `none`: sin selección. Ni siquiera se registran los manejadores de teclado.
 */
export type SelectionMode = 'none' | 'cell' | 'row'

/** Se emite cuando cambia la celda activa. */
export interface CellSelectEvent<TRow> {
  /** La fila seleccionada. */
  readonly row: TRow
  /** Índice de `row` dentro de la prop `rows`. */
  readonly rowIndex: number
  /** La definición de columna seleccionada. */
  readonly column: DataTableColumn<TRow>
  /** Alias de conveniencia de `column.key`. */
  readonly columnKey: string
  /** Valor de la celda, ya leído por el accessor de la columna. */
  readonly value: CellValue
}

/** Direcciona una celda por índice de fila y clave de columna. */
export interface CellPosition {
  /** Índice dentro de la prop `rows`. No es un slot del viewport. */
  rowIndex: number
  /** {@link DataTableColumn.key} de la columna. */
  columnKey: string
}

/**
 * Se emite antes de que se abra el editor de una celda. **Cancelable.**
 *
 * Llamar a {@link BeforeEditEvent.cancel} desde un listener veta la edición: el
 * editor no se abre y no hay `afterEdit` posterior. Este es el punto de enganche
 * para chequeos de permisos, bloqueos por fila y "esta columna es de solo
 * lectura en este momento".
 *
 * @typeParam TRow - Forma de una fila individual dentro de `rows`.
 */
export interface BeforeEditEvent<TRow> {
  /** El objeto de fila que se está editando. No debe mutarse. */
  row: TRow
  /** Índice de `row` dentro de la prop `rows`. */
  rowIndex: number
  /** La definición de columna que se está editando. */
  column: DataTableColumn<TRow>
  /** Alias de conveniencia de `column.key`. */
  columnKey: string
  /** Valor actual, leído por el accessor de la columna. */
  value: CellValue
  /** Veta la edición. Es seguro llamarla más de una vez. */
  cancel(): void
  /** `true` una vez que se llamó a {@link BeforeEditEvent.cancel}. */
  canceled: boolean
}

/**
 * Se emite cuando termina una sesión de edición, haya commiteado o no.
 *
 * Siempre dispara exactamente una vez por editor abierto. Consultar `canceled`
 * para distinguir una edición descartada (Escape) de una real.
 *
 * @typeParam TRow - Forma de una fila individual dentro de `rows`.
 */
export interface AfterEditEvent<TRow> {
  /** El objeto de fila que se editó. */
  row: TRow
  /** Índice de `row` dentro de la prop `rows`. */
  rowIndex: number
  /** La definición de columna que se editó. */
  column: DataTableColumn<TRow>
  /** Alias de conveniencia de `column.key`. */
  columnKey: string
  /** Valor previo a la edición. */
  oldValue: CellValue
  /** Valor posterior a la edición. Igual a `oldValue` cuando `canceled` es `true`. */
  newValue: CellValue
  /** `true` cuando el usuario descartó la edición con Escape. */
  canceled: boolean
}

/**
 * Se emite cuando una edición produce un valor que el padre debería persistir.
 *
 * Este es el **único** evento que te pide escribir. La tabla es controlada y
 * nunca muta `rows` por su cuenta, así que si se ignora este evento no cambia
 * nada en pantalla. Dispara solo cuando el valor nuevo difiere realmente del
 * anterior.
 *
 * @typeParam TRow - Forma de una fila individual dentro de `rows`.
 */
export interface EditCommitEvent<TRow> {
  /** El objeto de fila sobre el que hay que escribir. */
  row: TRow
  /** Índice de `row` dentro de la prop `rows`. */
  rowIndex: number
  /** La definición de columna que se editó. */
  column: DataTableColumn<TRow>
  /** Alias de conveniencia de `column.key`. */
  columnKey: string
  /** Valor previo a la edición. */
  oldValue: CellValue
  /**
   * Valor a persistir.
   *
   * Se coacciona al tipo primitivo de `oldValue` donde eso no es ambiguo, así
   * editar una columna numérica te entrega un `number` y no un `string`.
   */
  newValue: CellValue
}

/** Se emite cuando un arrastre de redimensionado termina con un ancho distinto. */
export interface ColumnResizeEvent {
  /** {@link DataTableColumn.key} de la columna redimensionada. */
  columnKey: string
  /** Nuevo ancho en px, ya acotado por min/max. */
  width: number
  /** Ancho en px al momento en que empezó el arrastre. */
  previousWidth: number
}

/**
 * Un tramo contiguo de items a pintar, más el punto en px donde arranca.
 *
 * `end` es **exclusivo**, igual que `Array.prototype.slice`. `offset` es la
 * posición en píxeles del item `start`, precalculada para que quien consume no
 * tenga que volver a multiplicar.
 */
export interface VirtualWindow {
  /** Primer índice de item a pintar, inclusive. */
  start: number
  /** Uno más allá del último índice de item a pintar. */
  end: number
  /** Offset en px del item `start` respecto del tope (o la izquierda) del canvas. */
  offset: number
}

/**
 * API imperativa que el componente expone mediante `defineExpose`.
 *
 * Se accede a través de un template ref cuando las props declarativas no
 * alcanzan: saltar a un resultado de búsqueda, o forzar un repintado después de
 * mutar objetos de fila en el lugar (algo que la tabla no puede observar, por
 * diseño).
 */
export interface DataTableInstance {
  /** Scrollea hasta que `index` sea la primera fila totalmente visible. Se acota. */
  scrollToRow(index: number): void
  /**
   * Scrollea hasta que la columna con esa clave quede en el borde izquierdo.
   * No hace nada si la clave es desconocida.
   */
  scrollToColumn(key: string): void
  /**
   * Invalida todos los valores de celda cacheados y repinta en el próximo frame.
   *
   * Hacen falta DOS cosas para que un cambio se vea: que algo agende un frame, y
   * que el caché de pintado acepte reescribir la celda. `refresh()` provee las
   * dos.
   *
   * La tabla solo repinta ante scroll, cambio de tamaño del viewport, o un
   * cambio en `rows`, `columns`, `rowHeight`, `stripe`, `virtualizeColumns`, las
   * columnas resueltas, la celda activa o la celda en edición. Mutar
   * `row.total` en el lugar no toca ninguna de esas cosas: nadie agenda un
   * frame, y el cambio no se ve hasta que algo más provoque un repintado.
   *
   * Por eso `refresh()` es necesario tanto para una mutación en el lugar como
   * para el caso más sutil de un `format` o un `cellClass` que devuelven algo
   * distinto sin que cambien sus argumentos, porque dependen de estado externo
   * capturado por closure: un locale, una cotización. En ese segundo caso, ni
   * siquiera reemplazar el array de filas alcanzaría, porque el caché se indexa
   * por el valor crudo y lo vería igual.
   */
  refresh(): void
  /**
   * Descarta el layout guardado y vuelve a visibilidad, orden y anchos por
   * defecto. Es el "restablecer columnas" de la UI.
   */
  resetLayout(): void
  /** Fija la celda activa, o la limpia con `null`. Desplaza la vista si hace falta. */
  selectCell(position: CellPosition | null): void
  /** Desplaza lo mínimo necesario para que la celda quede visible. */
  scrollToCell(position: CellPosition): void
  /**
   * Escribe de inmediato el layout que esté pendiente por el debounce.
   *
   * Útil antes de una navegación que el componente no controla. El desmontaje ya
   * vuelca lo pendiente por su cuenta.
   */
  flushPersistence(): void
}
