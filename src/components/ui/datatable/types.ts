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
 * Cómo se maqueta el contenido de una celda para centrarlo verticalmente.
 *
 * - `text`: el contenido es texto suelto. La celda lo centra con `line-height`
 *   igual a la altura de fila, que es lo único que conserva el recorte con
 *   puntos suspensivos: `text-overflow: ellipsis` no se aplica al texto anónimo
 *   dentro de un contenedor flex.
 * - `box`: el contenido es una caja estructurada —una píldora, un avatar, un
 *   anillo de progreso, una casilla— y la celda lo centra con flex. Hace falta
 *   porque `vertical-align: middle` no apunta al centro geométrico de la línea
 *   sino a la línea base más media altura de x, y con una altura de línea del
 *   tamaño de la fila esos dos puntos no coinciden.
 *
 * Es un eje INDEPENDIENTE de {@link CellAlign}: el modo decide el centrado
 * vertical y la alineación decide el horizontal. Los tres valores de `align`
 * significan exactamente lo mismo en los dos modos.
 */
export type CellLayout = 'text' | 'box'

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
   * Da formato al valor agregado que se muestra en la cabecera de un grupo.
   *
   * Se declara aparte de `format` porque una cabecera de grupo no pertenece a
   * ninguna fila, así que la firma de `format` no se puede aplicar aquí.
   *
   * Solo interviene sobre los agregados. Si falta, la cifra se escribe con la
   * representación por defecto del valor, igual que antes de que esta opción
   * existiera. Corre en el camino de pintado de la cabecera —una vez por columna
   * agregada y por grupo visible—, así que debe ser barata y pura: construir un
   * `Intl.NumberFormat` adentro es el mismo error que cometerlo dentro de
   * `format`.
   */
  formatAggregate?: (value: CellValue, column: DataTableColumn<TRow>) => string
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
  /**
   * Tipo de editor que se abre al editar la celda. Por defecto se infiere del valor.
   *
   * `'slot'` delega el control al slot `#editor` del componente. Si la tabla no
   * declara ese slot, la celda simplemente no abre nada: no hay dónde montar el
   * control, y abrir un editor incluido en su lugar sería peor que no abrir.
   */
  editor?: CellEditorType
  /** Opciones para los renderers y editores de tipo `select`, `badge` y `tags`. */
  options?: readonly CellOption[]
  /** Valor mínimo del editor `number`. Se traslada al atributo `min` del input. */
  min?: number
  /** Valor máximo del editor `number`. Se traslada al atributo `max` del input. */
  max?: number
  /** Paso del editor `number`. Se traslada al atributo `step` del input. */
  step?: number
  /**
   * Si la columna puede usarse para agrupar. Por defecto `true`.
   *
   * Poner `false` no oculta la columna: solo hace que una clave suya dentro de
   * `groupBy` se descarte, igual que se descarta una clave desconocida.
   */
  groupable?: boolean
  /**
   * Agregación que muestra esta columna en las cabeceras de grupo.
   *
   * Sin `aggregate` la columna no aporta nada a la cabecera. El cálculo ocurre al
   * aplanar —una vez por reconstrucción, nunca por frame— y siempre sobre todas
   * las filas descendientes del grupo, también en los niveles intermedios.
   */
  aggregate?: ColumnAggregation<TRow>
}

/**
 * Tipo de control que se abre al editar una celda.
 *
 * Es un eje INDEPENDIENTE del renderer. Cómo se ve una celda y cómo se edita son
 * decisiones separadas: un badge puede ser de solo lectura y una celda de texto
 * plano puede abrir un desplegable. Acoplarlos obligaría a inventar un renderer
 * por cada combinación.
 *
 * `'slot'` es el único que NO se infiere nunca: hay que declararlo. Significa
 * "el control lo pone el consumidor desde el slot `#editor`", y es la vía por la
 * que entra un componente de un design system —un `<USelect>`, un date picker—
 * sin que la tabla monte un componente por celda. Ver
 * {@link CellEditorSlotProps}.
 */
export type CellEditorType = 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'slot'

/**
 * Lo que recibe el slot `#editor` mientras hay una celda abierta con
 * `editor: 'slot'`.
 *
 * ## Una instancia por SESIÓN de edición, no una por celda
 *
 * El contenido del slot se monta cuando el editor se abre y se desmonta cuando
 * se cierra, y solo puede haber un editor abierto a la vez: el componente del
 * consumidor existe como mucho una vez en toda la tabla, sin importar cuántas
 * filas haya. Es la misma disciplina del editor incluido —un `<input>`
 * reutilizado que se reposiciona sobre la celda en edición— extendida a un
 * componente ajeno.
 *
 * ## El índice es el del DATASET
 *
 * `rowIndex` indexa la prop `rows`, igual que en todos los eventos y a
 * diferencia de {@link CellPosition.rowIndex}. Con grupos activos eso importa:
 * la posición vertical de la celda editada no sirve para escribir en el array
 * del consumidor.
 *
 * @typeParam TRow - Forma de una fila individual dentro de `rows`.
 */
export interface CellEditorSlotProps<TRow> {
  /** La fila que se está editando. No debe mutarse. */
  row: TRow
  /** Índice de `row` dentro de la prop `rows`. */
  rowIndex: number
  /** La definición de columna que se está editando. */
  column: DataTableColumn<TRow>
  /** Alias de conveniencia de `column.key`. */
  columnKey: string
  /** Valor con el que se abrió el editor, leído por el accessor de la columna. */
  value: CellValue
  /**
   * Cierra el editor confirmando `newValue`.
   *
   * Recorre exactamente la misma tubería que el editor incluido: emite
   * `afterEdit` y, solo si el valor cambió de verdad, `editCommit`. El veto de
   * `beforeEdit` ya corrió al abrir, así que no se vuelve a emitir.
   *
   * El valor se entrega TAL CUAL: no hay coacción de tipos, a diferencia del
   * editor incluido, que recibe un string de un control del DOM y tiene que
   * devolverlo al tipo original. Acá el consumidor ya tiene el valor tipado.
   */
  commit(newValue: CellValue): void
  /**
   * Cierra el editor descartando la edición.
   *
   * Emite `afterEdit` con `canceled: true` y ningún `editCommit`, igual que
   * Escape sobre un editor incluido.
   */
  cancel(): void
}

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

/**
 * Claves de columna por las que se agrupa, en orden de anidamiento.
 *
 * `['status', 'priority']` produce un primer nivel por estado y, dentro de cada
 * estado, un segundo nivel por prioridad. Una clave que no corresponde a ninguna
 * columna, o que corresponde a una columna con `groupable: false`, se ignora.
 */
export type GroupByState = readonly string[]

/**
 * Un nivel de un {@link GroupRow.groupId}: la columna por la que se agrupa y el
 * valor que define al grupo dentro de ese nivel.
 *
 * Es una tupla con los elementos NOMBRADOS y no un objeto porque el nombre viaja
 * igual —el editor muestra `[columnKey: string, value: CellValue]` mientras se
 * escribe la llamada— y la forma corta es la que deja una lista de niveles
 * legible en una sola línea. Con un objeto por nivel, un id de dos niveles
 * ocuparía cuatro.
 *
 * @typeParam TKey - Claves de columna admitidas. Por defecto `string`, porque la
 * librería no conoce las claves del consumidor: `DataTableColumn.key` es un
 * `string` y un array de columnas no las conserva como literales. Quien SÍ tenga
 * la unión de sus claves puede pasarla explícitamente, y entonces una clave mal
 * escrita pasa a ser un error de compilación en lugar de un grupo que no abre.
 */
export type GroupIdSegment<TKey extends string = string> = readonly [
  columnKey: TKey,
  value: CellValue,
]

/**
 * Agregación incluida, por nombre.
 *
 * - `count`: cantidad de filas descendientes cuyo valor en la columna no es
 *   `null` ni `undefined`. Es el `COUNT(columna)` de SQL, no el `COUNT(*)`: para
 *   la cantidad total de filas del grupo está el contador de la cabecera.
 * - `sum` y `avg`: operan solo sobre números finitos. Devuelven `null` si el
 *   grupo no tiene ninguno, en lugar de un `0` que se confundiría con un total
 *   real.
 * - `min` y `max`: operan sobre números finitos y, si el grupo no tiene ninguno,
 *   sobre fechas válidas. Devuelven `null` si no hay nada comparable.
 */
export type BuiltInAggregation = 'sum' | 'avg' | 'count' | 'min' | 'max'

/**
 * Función de agregación sobre los valores de una columna dentro de un grupo.
 *
 * Recibe TODAS las filas descendientes del grupo, no las de sus subgrupos ya
 * agregadas: un promedio de promedios no es el promedio, y el único modo de que
 * una agregación propia sea correcta en niveles anidados es darle las filas
 * originales.
 *
 * Corre una vez por grupo y por reconstrucción del aplanado, nunca por frame.
 */
export type AggregationFn<TRow> = (rows: readonly TRow[], columnKey: string) => CellValue

/** Agregación declarada en una columna: una incluida o una función propia. */
export type ColumnAggregation<TRow> = BuiltInAggregation | AggregationFn<TRow>

/**
 * Una cabecera de grupo dentro de la secuencia aplanada.
 *
 * `kind` es un literal y no una marca calculada: distinguir una cabecera de una
 * fila de datos tiene que costar una comparación de string, porque el pool lo
 * pregunta una vez por fila visible y por frame.
 */
export interface GroupRow {
  /** Discriminante de la unión {@link FlatRow}. */
  readonly kind: 'group'
  /**
   * Identidad estable del grupo, construida por camino.
   *
   * Tiene la forma `columna:valor` por nivel, unidos con `/`:
   * `status:active/priority:high`. Es estable entre sesiones mientras no cambien
   * ni las columnas de agrupación ni los valores, que es exactamente lo que
   * hace falta para persistir qué grupos quedaron colapsados.
   */
  readonly groupId: string
  /** Clave de la columna por la que agrupa este nivel. */
  readonly columnKey: string
  /** Valor común a todas las filas del grupo. */
  readonly value: CellValue
  /** Texto mostrado en la cabecera, ya resuelto contra `column.options`. */
  readonly label: string
  /** Nivel de anidamiento, 0 para el primero. Gobierna la sangría. */
  readonly depth: number
  /** Cantidad de filas de datos descendientes, incluidas las de sus subgrupos. */
  readonly count: number
  /** Si el grupo muestra su contenido. Un grupo colapsado aporta solo su cabecera. */
  readonly expanded: boolean
  /** Cantidad de hermanos en este nivel. Alimenta `aria-setsize`. */
  readonly setSize: number
  /** Posición entre sus hermanos, 1-based. Alimenta `aria-posinset`. */
  readonly posInSet: number
  /** Agregados por clave de columna, calculados sobre TODOS los descendientes. */
  readonly aggregates: Readonly<Record<string, CellValue>>
}

/**
 * Una fila de datos dentro de la secuencia aplanada.
 *
 * `rowIndex` es el índice dentro de la prop `rows` ORIGINAL, no la posición en la
 * secuencia aplanada. Esa distinción es la que sostiene la corrección de la
 * edición: `editCommit` reporta este índice, y reportar el aplanado escribiría la
 * edición sobre otra fila del dataset del consumidor.
 */
export interface DataRow<TRow> {
  /** Discriminante de la unión {@link FlatRow}. */
  readonly kind: 'data'
  /** La fila tal como vive en `rows`. */
  readonly row: TRow
  /** Índice de `row` dentro de la prop `rows`. */
  readonly rowIndex: number
}

/**
 * Una entrada de la secuencia visible cuando hay agrupación activa.
 *
 * El virtualizador indexa sobre este array en lugar de sobre `rows`: con grupos,
 * la posición vertical ya no corresponde a un índice del dataset, porque se
 * intercalan cabeceras y los grupos colapsados esconden a sus hijos.
 */
export type FlatRow<TRow> = GroupRow | DataRow<TRow>

/** Se emite cuando se expande o colapsa un grupo. */
export interface GroupToggleEvent {
  /** {@link GroupRow.groupId} del grupo afectado. */
  groupId: string
  /** Estado resultante. */
  expanded: boolean
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
  /**
   * Claves por las que se agrupa, en orden de anidamiento.
   *
   * Opcional a propósito, y es la razón por la que la agregación de grupos no
   * obligó a subir la versión del esquema: un payload escrito antes de que
   * existiera esta función no trae la clave, y uno de una tabla que nunca agrupó
   * tampoco la escribe. Ausente significa "sin agrupación persistida", que es
   * distinto de "agrupación vacía persistida" solo en que no ensucia el
   * almacenamiento de las tablas que no usan la función.
   */
  groupBy?: string[]
  /**
   * {@link GroupRow.groupId} de los grupos que quedaron colapsados.
   *
   * Se guarda el conjunto COLAPSADO y no el expandido porque el valor por
   * defecto es expandido: con miles de grupos, la lista de excepciones es de unas
   * pocas entradas y la de expandidos sería de miles.
   */
  collapsedGroups?: string[]
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
  /**
   * Qué partes del estado se persisten. Por defecto, todas.
   *
   * `grouping` es una bandera propia y no una ampliación silenciosa de otra: un
   * consumidor que ya tenía `include: { order: true, widths: true }` escrito
   * esperaba que eso fuera una lista cerrada, y colgar la agrupación de `order`
   * —que es lo más parecido— le cambiaría el comportamiento sin que haya tocado
   * nada.
   */
  include?: { visibility?: boolean; widths?: boolean; order?: boolean; grouping?: boolean }
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
   * Modo de maquetado que la celda adopta para este renderer. Por defecto `'text'`.
   *
   * Declararlo `'box'` es lo que hace que un contenido que NO es texto —una
   * píldora, un avatar, un anillo— quede centrado verticalmente de verdad. Ver
   * {@link CellLayout} para el porqué.
   *
   * Es metadato del renderer, no estado de la celda: solo cambia cuando un nodo
   * reciclado pasa a otro tipo de renderer, así que el pool lo aplica en el mismo
   * punto donde reconstruye el nodo y no cuesta ni una escritura por frame.
   */
  readonly layout?: CellLayout
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
  /**
   * Dibuja un anillo de foco alrededor del viewport cuando la tabla recibe el
   * foco por teclado.
   *
   * Por defecto `false`: con una celda activa marcada, el anillo del viewport es
   * redundante y encierra toda la tabla en un borde de color.
   *
   * En `true` el anillo aparece solo mientras NO hay celda activa. Marcar la
   * celda y encerrar además la tabla entera serían dos señales para una sola
   * posición, que es el mismo problema que resolvió quitarle el `tabindex` a las
   * celdas, un nivel más arriba.
   *
   * Conviene encenderlo cuando los usuarios navegan sobre todo con el teclado:
   * con el valor por defecto y sin celda activa, quien llega a la tabla con Tab
   * no recibe ninguna señal de dónde quedó el foco.
   */
  focusRing?: boolean
  /**
   * Claves de columna por las que agrupar. `v-model:group-by`.
   *
   * Con la lista vacía —el valor por defecto— la tabla no paga absolutamente
   * nada por esta función: no se construye ningún árbol, no se aplana nada y el
   * pool recorre el mismo camino de siempre sobre `rows`.
   *
   * Igual que el trío de columnas, si se omite la prop el estado vive adentro y
   * la tabla funciona sola; si se pasa, la prop manda y el componente solo emite
   * `update:groupBy`.
   */
  groupBy?: GroupByState
  /**
   * {@link GroupRow.groupId} de los grupos expandidos. `v-model:expanded-groups`.
   *
   * **Controlado**: si la prop llega con valor, es la verdad literal —un id que
   * no está en la lista está colapsado— y `groupsDefaultExpanded` deja de
   * intervenir, porque el padre ya está diciendo el estado de cada grupo.
   *
   * **No controlado**: si llega `undefined`, la tabla guarda internamente solo
   * las EXCEPCIONES a `groupsDefaultExpanded`, que con el valor por defecto son
   * los grupos colapsados. Igual emite la lista completa de expandidos, para que
   * un consumidor pueda escucharla sin tomar posesión del estado.
   */
  expandedGroups?: readonly string[]
  /** Estado inicial de un grupo del que todavía no se sabe nada. Por defecto `true`. */
  groupsDefaultExpanded?: boolean
  /** Si la cabecera de grupo muestra cuántas filas contiene. Por defecto `true`. */
  showGroupCount?: boolean
  /**
   * Etiqueta del grupo que junta los valores ausentes. Por defecto `'(empty)'`.
   *
   * La usan tanto el bucket de `null` como el de `undefined`, que siguen siendo
   * grupos distintos: comparten la etiqueta porque para el usuario los dos son
   * "vacío". También se aplica cuando el valor existe pero su representación de
   * texto queda vacía.
   *
   * Es una prop y no una constante del módulo porque el texto es de cara al
   * usuario, y una aplicación que no está en inglés necesita poder traducirlo.
   */
  emptyGroupLabel?: string
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

/**
 * Direcciona una celda por índice de fila y clave de columna.
 *
 * ## Qué indexa `rowIndex` cuando hay grupos
 *
 * Indexa la SECUENCIA VISIBLE, no la prop `rows`. Sin agrupación las dos
 * coinciden exactamente y no hay nada que distinguir; con agrupación la
 * secuencia visible intercala cabeceras de grupo y esconde los hijos de los
 * grupos colapsados, así que la posición vertical de una celda ya no es su
 * índice en el dataset.
 *
 * Es deliberado que sea la secuencia visible: todo lo que consume una posición
 * dentro del componente —la geometría del editor, el auto-scroll, el movimiento
 * con flechas— es geométrico, y una posición que no se pueda traducir a píxeles
 * sin una búsqueda no serviría para nada de eso. Una cabecera de grupo, además,
 * no tiene índice en `rows` y aun así se puede seleccionar.
 *
 * Los EVENTOS hacen el camino inverso: `cellSelect`, `rowClick`, `beforeEdit`,
 * `afterEdit` y `editCommit` reportan siempre el índice dentro de `rows`, porque
 * es el único con el que el consumidor puede escribir en su propio dataset.
 */
export interface CellPosition {
  /** Índice dentro de la secuencia visible. No es un slot del viewport. */
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
  /**
   * Índice de `row` dentro de la prop `rows`.
   *
   * Con grupos activos NO es la posición vertical de la celda editada: es el
   * índice en el dataset original, que es el único sobre el que tiene sentido
   * escribir. Ver {@link CellPosition}.
   */
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
  /**
   * Scrollea hasta que `index` sea la primera fila totalmente visible. Se acota.
   *
   * `index` recorre la secuencia visible, igual que {@link CellPosition.rowIndex}:
   * con grupos activos cuenta también las cabeceras y saltea a los hijos de los
   * grupos colapsados.
   */
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
  /** Invierte el estado de un grupo por su {@link GroupRow.groupId}. */
  toggleGroup(groupId: string): void
  /** Expande todos los grupos. */
  expandAllGroups(): void
  /** Colapsa todos los grupos. */
  collapseAllGroups(): void
}
