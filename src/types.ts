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
 * Preset visual de la tabla.
 *
 * - `default` es el aspecto de siempre: sin grilla propia, gobernado por
 *   `stripe` y `bordered`.
 * - `cells` fuerza una grilla completa de celda a celda, sin importar `stripe`
 *   ni `bordered`.
 */
export type DataTableVariant = 'default' | 'cells'

/**
 * Redondeo de las esquinas de la tabla.
 *
 * Alcanza SOLO a la caja exterior —la que recorta el header y el viewport—, no
 * a los redondeos internos: los controles de edición, las píldoras y el panel
 * del selector de columnas siguen el radio del tema, `--dt-radius`.
 *
 * Por defecto es `'none'`: esquinas rectas. Una grilla se suele embeber dentro
 * de un panel que ya tiene su propio redondeo, y dos radios distintos a pocos
 * píxeles uno del otro se ven como un error de alineación.
 *
 * `md` significa exactamente el radio del tema, así que una aplicación que
 * define `--ui-radius` lo ve respetado; `sm`, `lg` y `xl` son pasos fijos.
 */
export type DataTableRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl'

/**
 * Borde al que se ancla una columna.
 *
 * Una columna anclada sale del scroll horizontal: se queda quieta mientras las
 * demás pasan por debajo. `'start'` es el borde izquierdo —después de la regleta
 * de numeración, que ya estaba fija ahí— y `'end'` el derecho.
 */
export type ColumnPin = 'start' | 'end'

/**
 * Textos de los controles que pone la librería.
 *
 * Existe porque la librería dibuja botones y menús con texto propio, y una
 * aplicación que no está en inglés no puede quedarse sin forma de traducirlos.
 * Es **un objeto y no una prop por cadena**: son nueve, y nueve props sueltas
 * para lo mismo serían nueve cosas que recordar en vez de una.
 *
 * Se pasa parcial y se completa con los valores por defecto, así que traducir
 * solo lo que se usa es una línea.
 *
 * `emptyText` queda afuera a propósito: no es el rótulo de un control sino
 * contenido de la tabla, y se cambia mucho más seguido que estos.
 */
export interface DataTableLabels {
  /** Botón de anclar, con la columna suelta. `'Pin column'`. */
  pin?: string
  /** Botón de anclar, con la columna ya anclada. `'Unpin column'`. */
  unpin?: string
  /** Botón que abre el menú de la columna. `'Column menu'`. */
  menu?: string
  /** `'Sort ascending'`. */
  sortAsc?: string
  /** `'Sort descending'`. */
  sortDesc?: string
  /** `'Clear sort'`. */
  clearSort?: string
  /** `'Pin to start'`. */
  pinStart?: string
  /** `'Pin to end'`. */
  pinEnd?: string
  /** `'Hide column'`. */
  hideColumn?: string
  /** `'Reset columns'`. */
  resetColumns?: string
}

/** Sentido de un criterio de ordenamiento. */
export type SortDirection = 'asc' | 'desc'

/** Un criterio de ordenamiento: una columna y un sentido. */
export interface ColumnSort {
  /** Clave de la columna por la que se ordena. */
  columnKey: string
  /** Sentido. */
  direction: SortDirection
}

/**
 * Los criterios de ordenamiento vigentes, en orden de prioridad.
 *
 * Es una LISTA y no un criterio suelto por lo mismo que `groupBy`: ordenar por
 * estado y después por fecha es un caso normal, y empezar con un solo criterio
 * habría obligado a un cambio incompatible para admitirlo. Una lista vacía
 * significa "sin ordenar".
 *
 * **La tabla no ordena nada con esto.** Es estado que la tabla administra y
 * anuncia —igual que el orden, el ancho o el anclaje de las columnas—, y el
 * array `rows` lo sigue construyendo el consumidor. Ver {@link sortRows} para el
 * caso en memoria, y el README para el de servidor.
 */
export type SortState = readonly ColumnSort[]

/** Payload de `sortChange`. */
export interface SortChangeEvent {
  /** Los criterios que quedaron vigentes. Vacío significa "sin ordenar". */
  sort: SortState
  /** La columna que el usuario acaba de tocar. */
  columnKey: string
}

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
  /**
   * Si la columna se puede ordenar. Por defecto `false`.
   *
   * - `true`: el encabezado responde al clic —ascendente, descendente y de
   *   vuelta a sin orden— y el menú trae las mismas opciones.
   * - `'menu'`: **el clic no ordena**. La columna se ordena solo desde el menú,
   *   y el encabezado no cambia el cursor ni promete un gesto que no tiene.
   *
   * La flecha del sentido vigente aparece en los dos casos: dice cómo está
   * ordenada la tabla, no cómo se la ordenó.
   *
   * `'menu'` sirve cuando el clic del encabezado ya significa otra cosa en esa
   * aplicación, o en una columna donde ordenar es una acción rara y un clic
   * accidental reordenando cien mil filas es una molestia.
   *
   * **La tabla no ordena `rows`** en ningún caso: escribe el estado en `sort` y
   * lo anuncia; quién reordena el array —o consulta al servidor— sigue siendo el
   * consumidor.
   *
   * Con `columnSelection` encendida el clic pelado sigue siendo para ordenar, y
   * seleccionar la columna entera pasa a `Ctrl`/`Cmd`+clic. Ver
   * {@link DataTableProps.columnSelection}.
   */
  sortable?: boolean | 'menu'
  /**
   * Comparador propio para esta columna, en sentido ASCENDENTE.
   *
   * Solo lo usa {@link sortRows}: la tabla nunca compara nada por su cuenta. El
   * sentido descendente lo resuelve el helper invirtiendo el resultado, así que
   * aquí alcanza con describir el ascendente.
   *
   * Hace falta cuando el orden natural del valor no es el que el usuario espera:
   * una prioridad que va `baja < media < alta` y no alfabéticamente, un texto
   * que tiene que ordenarse ignorando acentos, un objeto del que se compara un
   * campo interno.
   */
  comparator?: (a: TRow, b: TRow) => number
  /**
   * Ancla la columna a un borde de la tabla. Por defecto ninguno.
   *
   * Una columna anclada no scrollea: se queda a la vista mientras el resto pasa
   * por debajo. `'start'` la lleva al borde izquierdo —después de la regleta de
   * numeración, si la hay— y `'end'` al derecho.
   *
   * El anclaje manda sobre el orden: todas las de `'start'` van primero y todas
   * las de `'end'` al final, conservando entre ellas el orden vigente. Una
   * columna anclada además no se puede mover arrastrando, porque moverla
   * significaría desanclarla.
   */
  pinned?: ColumnPin
  /**
   * Si el usuario puede anclar y desanclar la columna desde su encabezado.
   * Por defecto `false`: **sin esto no aparece ningún botón**.
   *
   * El valor dice a qué BORDE la lleva el BOTÓN del encabezado, no si empieza
   * anclada —eso sigue siendo {@link DataTableColumn.pinned}—:
   *
   * - `true` y `'start'` son lo mismo: el botón la ancla al borde izquierdo.
   * - `'end'`: el botón la ancla al derecho.
   * - `'menu'`: **sin botón**. Solo se ancla desde el menú de la columna.
   *
   * El botón alterna: si la columna está suelta la ancla a ese borde, y si está
   * anclada —a cualquiera de los dos— la suelta.
   *
   * ## El menú ofrece SIEMPRE los dos lados
   *
   * Sea cual sea el valor, el menú de la columna muestra "anclar al inicio" y
   * "anclar al final". La asimetría es deliberada y sale de lo que cada control
   * puede hacer: un botón es un gesto y solo puede significar una cosa, así que
   * se le declara cuál; un menú tiene lugar para preguntar, así que pregunta.
   *
   * Por eso `'menu'` es la forma de decir "que el usuario elija el lado".
   */
  pinnable?: boolean | ColumnPin | 'menu'
  /**
   * Si esta columna muestra el menú de tres puntos. Por defecto `true`, pero
   * solo cuenta con {@link DataTableProps.columnMenu} encendido.
   *
   * En `false` la columna queda sin menú aunque la tabla lo tenga: sirve para
   * una columna de acciones o un indicador donde ordenar, anclar y ocultar no
   * significan nada.
   */
  menu?: boolean
  /**
   * Si la columna se puede mover arrastrando su encabezado. Por defecto `true`.
   *
   * En `false` la columna queda anclada: no se la puede agarrar, y ninguna otra
   * puede soltarse en su lugar, así que sigue donde está por más que el resto se
   * reordene alrededor. Es lo que hace falta para una primera columna de
   * identificación. Solo interviene con la prop `columnReorder` encendida.
   */
  reorderable?: boolean
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
   * devolverlo al tipo original. Aquí el consumidor ya tiene el valor tipado.
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

/**
 * Se emite cuando el scroll necesita filas que `rows` todavía no tiene.
 *
 * Solo existe en modo servidor, o sea con `rowCount` declarado. El tramo viene
 * SIEMPRE alineado a `pageSize`: aunque la ventana visible arranque en la fila
 * 137, lo que se pide es `[100, 150)`. Eso hace que `page` —o `start / pageSize`,
 * que es lo mismo— sirva directo como clave de caché.
 *
 * La tabla emite una vez por página y espera. No vuelve a emitir esa página
 * hasta que sus filas aparezcan en `rows`, hasta que `rows` se acorte por debajo
 * de `start`, o hasta que alguien llame a `refreshRows()`.
 *
 * @example
 * ```ts
 * async function onRowsRequest({ start, end }: RowsRequestEvent) {
 *   const page = await api.rows({ skip: start, take: end - start })
 *   const next = rows.value.slice()
 *   next.length = total.value
 *   for (let i = 0; i < page.length; i += 1) next[start + i] = page[i]
 *   rows.value = next
 * }
 * ```
 */
export interface RowsRequestEvent {
  /** Primer índice del tramo, inclusive. Múltiplo de `pageSize`. */
  start: number
  /** Índice siguiente al último, exclusivo. Acotado por `rowCount`. */
  end: number
  /** Número de página, `start / pageSize`. Sirve como clave de caché. */
  page: number
}

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
 * Anclaje elegido por el usuario, por clave de columna.
 *
 * Pisa a {@link DataTableColumn.pinned}, que pasa a ser el valor inicial. `null`
 * es un valor con significado —"el usuario la soltó"— y por eso se distingue de
 * la clave ausente, que significa "el usuario no la tocó" y deja mandar a la
 * declaración.
 */
export type ColumnPinState = Readonly<Record<string, ColumnPin | null>>

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
   * Anclaje elegido por el usuario, por clave de columna.
   *
   * Opcional por la misma razón que {@link PersistedTableState.groupBy}: un
   * payload escrito antes de que el anclaje desde la UI existiera no trae la
   * clave, y eso no tiene por qué invalidar un layout guardado. Ausente
   * significa "sin anclaje persistido", y manda lo que declaren las columnas.
   */
  columnPinning?: Record<string, ColumnPin | null>
  /**
   * Criterios de ordenamiento vigentes.
   *
   * Opcional por lo mismo que el anclaje y la agrupación: un payload escrito
   * antes de que el ordenamiento existiera no la trae, y eso no tiene por qué
   * invalidar un layout guardado.
   */
  sort?: ColumnSort[]
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
  include?: {
    visibility?: boolean
    widths?: boolean
    order?: boolean
    grouping?: boolean
    pinning?: boolean
    sort?: boolean
  }
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
 * lee su contenido ni asume nada sobre él más allí de `root`.
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
   * `{ name, src }`— y la leen de aquí, estrechándola por su cuenta.
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
  /**
   * Texto plano de la celda, para copiar al portapapeles.
   *
   * ## Por qué no alcanza con leer el DOM
   *
   * Porque la tabla está virtualizada: de un rango de 5.000 filas hay treinta
   * pintadas. Las otras 4.970 no tienen nodo del que leer, así que el texto a
   * copiar hay que CALCULARLO, y el único que sabe cómo se ve una celda es el
   * renderer que la pinta. Un badge muestra la etiqueta de su opción, no el
   * valor crudo; `number` muestra separadores de miles; `tags` muestra varias
   * etiquetas. Copiar el valor crudo daría un texto que nadie vio nunca.
   *
   * Es una función PURA sobre el contexto —sin handle, sin DOM, sin estado—, y
   * por eso sirve igual para una celda pintada que para una que no lo está.
   *
   * Es opcional: un renderer que no la declare hace que sus celdas se copien con
   * la representación por defecto del valor. Al implementarla conviene derivarla
   * del mismo helper que usa `update`, para que el texto copiado no pueda
   * separarse del pintado.
   */
  text?(ctx: CellRenderContext<TRow>): string
  /** Libera recursos del handle. Se llama al desmontar o al cambiar el tipo de renderer. */
  destroy?(handle: CellRendererHandle): void
}

/**
 * Resuelve el alto en px de una fila.
 *
 * ## Qué recibe
 *
 * `row` es `undefined` en dos situaciones, y las dos son normales:
 *
 * - La posición es una **cabecera de grupo**, que no corresponde a ninguna fila
 *   del dataset.
 * - La tabla está en **modo servidor** y esa fila todavía no llegó.
 *
 * Devolver el alto que quieras para ese caso es la forma de darle a las
 * cabeceras de grupo un alto propio.
 *
 * `index` es la posición **visible**: la que se ve en la regleta de numeración
 * menos uno. Sin agrupación coincide con el índice dentro de `rows`; con
 * agrupación no, porque las cabeceras ocupan lugar. Es el único índice que
 * existe siempre, que es la razón de que sea el que se pasa.
 *
 * ## Qué tiene que devolver
 *
 * Un número finito y positivo de píxeles. Cualquier otra cosa —`NaN` por una
 * cuenta con un campo que no llegó, un cero, un negativo— se descarta en
 * silencio y se usa el alto por defecto, porque una geometría rota se
 * manifestaría como filas superpuestas y no como un error.
 *
 * ## Qué cuesta
 *
 * Se la llama **una vez por fila del dataset entero** cada vez que cambian las
 * filas, las columnas o la función misma. No en cada frame: scrollear no la
 * llama ni una sola vez. Aun así tiene que ser barata y no puede leer el DOM:
 * con 100.000 filas, es una pasada de 100.000 llamadas.
 *
 * Tiene que ser **pura y estable**: la tabla la usa para calcular dónde empieza
 * cada fila, y dos respuestas distintas para la misma fila dejarían la
 * geometría y lo pintado en desacuerdo. Si el alto depende de algo que cambia
 * —una fila expandida, por ejemplo—, ese algo tiene que estar en los datos, y
 * cambiarlo tiene que producir una función nueva o un `rows` nuevo.
 *
 * @example
 * ```ts
 * // Una fila abierta muestra el detalle; una cabecera de grupo va más baja.
 * const rowHeight = (row: Persona | undefined) => {
 *   if (row === undefined) return 32
 *   return abiertas.has(row.id) ? 160 : 40
 * }
 * ```
 */
export type RowHeightResolver<TRow> = (row: TRow | undefined, index: number) => number

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
   * El dataset. No se corta, no se copia y no se vuelve reactivo en
   * profundidad: el componente guarda una referencia superficial, que es
   * justamente lo que le permite sostener 100k filas sin asignar 100k proxies
   * reactivos.
   *
   * Con {@link DataTableProps.rowCount} declarado puede tener HUECOS: se indexa
   * por índice absoluto del dataset, así que `rows[137]` es la fila 137 aunque
   * las primeras cien todavía no hayan llegado del servidor. Ver `rowCount`.
   */
  rows: readonly (TRow | undefined)[]
  /**
   * Cuántas filas tiene el dataset entero, cuando `rows` no las tiene todas.
   *
   * **Sin esta prop no cambia absolutamente nada**: el largo es `rows.length` y
   * la tabla se comporta como siempre. Declararla es lo único que enciende el
   * modo servidor, y es opt-in justamente porque la mayoría de las tablas tienen
   * sus datos en memoria y no deberían pagar ni una línea por un modo que no
   * usan.
   *
   * Con ella, la tabla separa dos cosas que hasta aquí eran la misma:
   *
   * - **Cuántas filas hay** lo dice `rowCount`, y es lo que dimensiona la barra
   *   de scroll. La tabla deja scrollear hasta ahí aunque `rows` esté casi vacío.
   * - **Qué hay en el índice `i`** lo dice `rows[i]`. Un `undefined` no es un
   *   error: es una fila que todavía no llegó, y se pinta como marcador.
   *
   * Cuando el scroll entra en una zona sin cargar, la tabla emite `rowsRequest`
   * con el tramo que necesita y espera. **Nunca pide datos por su cuenta**: el
   * transporte, la caché, los reintentos y la cancelación son del consumidor,
   * por la misma razón por la que `rows` es controlada para editar.
   *
   * Si no conoces el total —el caso del scroll infinito clásico—, `rowCount` es
   * "hasta dónde puede scrollear": `cargadas + pageSize` mientras el servidor
   * diga que hay más, y `cargadas` cuando diga que se acabó. No hay un segundo
   * modo ni una segunda API.
   *
   * Agrupar y modo servidor son **excluyentes**: no se puede armar un árbol de
   * grupos sobre filas que no llegaron. Con las dos cosas a la vez, `groupBy` se
   * ignora y se avisa una vez por consola.
   */
  rowCount?: number
  /**
   * Tamaño de página de los pedidos, en filas. Por defecto 50.
   *
   * Los pedidos se ALINEAN a este número: una ventana `[137, 162)` pide
   * `[100, 150)` y `[150, 200)`, no `[137, 162)`. Alineado, la clave de caché
   * del otro lado es `start / pageSize` y dos posiciones de scroll sobre la
   * misma página producen el mismo pedido en vez de dos distintos que se pisan.
   *
   * Solo tiene efecto con {@link DataTableProps.rowCount} declarado.
   */
  pageSize?: number
  /**
   * Páginas que se piden por adelantado a cada lado de la ventana visible. Por
   * defecto 1.
   *
   * Es lo que hace que un scroll normal no muestre marcadores: para cuando la
   * fila entra en pantalla, su página ya se pidió. En 0 se pide solo lo que se
   * ve, y cada tramo nuevo aparece primero como marcador.
   *
   * Solo tiene efecto con {@link DataTableProps.rowCount} declarado.
   */
  prefetchPages?: number
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
   * Altura de fila en px, fija para todas o resuelta fila por fila.
   *
   * Por defecto 40, o 30 con `dense` encendido.
   *
   * Es un número y no un valor CSS porque el virtualizador hace cuentas con él
   * en cada frame. El componente replica el valor fijo —o el de respaldo, si es
   * una función— en la custom property `--dt-row-height`, para que CSS y JS
   * nunca puedan discrepar.
   *
   * Con una {@link RowHeightResolver} cada fila puede medir distinto. Ver ahí
   * qué recibe, qué tiene que devolver y qué cuesta.
   */
  rowHeight?: number | RowHeightResolver<TRow>
  /** Altura del header en px. Por defecto 44, o 34 con `dense` encendido. */
  headerHeight?: number
  /** Preset compacto: filas más bajas, tipografía menor, padding más ajustado. */
  dense?: boolean
  /**
   * La cruz de la celda activa: una línea bajo el encabezado de su columna y
   * otra al costado de su número de fila. Por defecto `false`.
   *
   * Las dos son la misma marca vista desde los dos bordes que NO scrollean, y
   * por eso se encienden juntas: sirven para saber dónde está uno cuando la
   * celda activa se fue de la pantalla, que es lo que pasa en una tabla grande.
   * En una tabla que entra entera son dos señales de más para una posición que
   * ya tiene la suya, y de ahí que vengan apagadas.
   *
   * No afecta al fondo acentuado del encabezado ni al del número, que van
   * siempre: esto enciende y apaga **las líneas de color**, nada más.
   *
   * El grosor sale de `--dt-crosshair-width` (`2px`).
   */
  crosshair?: boolean
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
  /**
   * Preset visual. Por defecto `'default'`.
   *
   * `'cells'` dibuja una grilla completa de celda a celda, sin importar
   * `stripe` ni `bordered`.
   */
  variant?: DataTableVariant
  /**
   * Redondeo de las esquinas de la tabla. Por defecto `'none'`.
   *
   * Alcanza solo a la caja exterior. Ver {@link DataTableRadius}.
   */
  radiusBorder?: DataTableRadius
  /**
   * Columna de numeración a la izquierda. Por defecto `true`.
   *
   * No es una columna: no se selecciona, no se copia, no se reordena ni se
   * oculta desde el selector de columnas, y queda fija mientras el resto
   * scrollea en horizontal. Ver la sección de numeración del README.
   */
  showRowNumbers?: boolean
  /**
   * Mover columnas arrastrando su encabezado. Por defecto `true`.
   *
   * El arrastre escribe `columnOrder`, que es el mismo estado que ya existía y
   * que la persistencia ya guardaba: la UI no trae un modelo propio, solo una
   * forma de moverlo con el mouse. Una columna puntual se puede anclar con
   * `column.reorderable: false`.
   *
   * Convive con el clic que selecciona la columna: presionar y soltar sin mover
   * selecciona, presionar y arrastrar mueve. Lo que decide cuál de las dos cosas
   * fue es un umbral de unos pocos píxeles, no el orden de los eventos.
   */
  columnReorder?: boolean
  /**
   * Clic en el encabezado de una columna para seleccionarla entera. Por defecto
   * `false`.
   *
   * La selección resultante es un RANGO —de la primera fila a la última, sobre
   * esa columna—, no un estado aparte: se copia con `Ctrl`+`C`, se extiende con
   * `Shift`+flechas y se deshace con un clic en cualquier celda, igual que
   * cualquier otra selección. Por eso necesita `rangeSelection` encendido y
   * `selectionMode: 'cell'`; sin eso el clic en el encabezado no hace nada.
   */
  columnSelection?: boolean
  /**
   * Clic en el número de una fila para seleccionarla entera. Por defecto
   * `false`.
   *
   * No confundir con `selectionMode: 'row'`, que es otra cosa: aquel cambia cuál
   * es la UNIDAD que marca un clic en una celda cualquiera; este agrega un gesto
   * sobre la regleta, y lo que produce es un rango que abarca todas las columnas
   * de esa fila. Requiere entonces `showRowNumbers` —si no, no hay dónde hacer
   * clic—, `rangeSelection` y `selectionMode: 'cell'`.
   */
  rowSelection?: boolean
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
   * Anclaje por clave de columna. `v-model:column-pinning`.
   *
   * Pisa a `column.pinned`, que pasa a ser el valor inicial. Es lo que escribe
   * el botón de anclar del encabezado, que a su vez solo aparece en las columnas
   * con {@link DataTableColumn.pinnable}.
   *
   * Una clave en `null` significa "el usuario la soltó" y NO es lo mismo que la
   * clave ausente, que significa "el usuario no la tocó" y deja mandar a la
   * declaración. Sin esa distinción, soltar una columna declarada como anclada
   * sería imposible: volvería a anclarse sola.
   */
  columnPinning?: ColumnPinState
  /**
   * Criterios de ordenamiento vigentes. `v-model:sort`.
   *
   * La tabla los administra —los escribe el clic en el encabezado y el menú de
   * columna— y los **anuncia**, pero no toca `rows`: ordenar es del consumidor.
   * Es la misma disciplina que con la edición, y por el mismo motivo: la tabla
   * no puede ordenar un dataset que vive en el servidor ni uno del que solo
   * tiene una ventana.
   */
  sort?: SortState
  /**
   * Textos de los controles que pone la librería. Ver {@link DataTableLabels}.
   *
   * Se pasa parcial: lo que no se declare usa el valor en inglés por defecto.
   */
  labels?: DataTableLabels
  /**
   * Menú de tres puntos en cada encabezado. Por defecto `false`.
   *
   * Reúne en un solo lugar lo que ya existía suelto: ordenar, anclar, ocultar la
   * columna y restablecer el layout. **No agrega ninguna capacidad nueva**; es
   * otra forma de llegar al mismo estado, pensada para quien no quiere poner
   * controles propios alrededor de la tabla.
   *
   * Una columna puede quedarse afuera con `column.menu: false`.
   *
   * Es también la única vía para ordenar cuando `columnSelection` está
   * encendida, porque ahí el clic del encabezado ya está tomado.
   */
  columnMenu?: boolean
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
   * Selección de un RANGO de celdas, como en una hoja de cálculo. Por defecto `true`.
   *
   * Arrastrar con el botón primario desde una celda, `Shift`+clic y
   * `Shift`+flechas extienden la selección a un rectángulo, `Ctrl`+`C` lo copia
   * como TSV y `Ctrl`+`A` selecciona la grilla entera.
   *
   * Solo rige en `selectionMode: 'cell'`: en `'row'` la unidad seleccionada es
   * la fila entera y un rectángulo de celdas no significaría nada; en `'none'`
   * no hay selección de ninguna clase.
   *
   * Apagarlo deja el comportamiento en una celda por vez, pero NO devuelve la
   * selección de texto del navegador sobre el cuerpo de la tabla: esa se apaga
   * siempre. Ver la sección de selección del README.
   */
  rangeSelection?: boolean
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
   * Identificadores de grupo expandidos. `v-model:expanded-groups`.
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
 * - `cell`: se marca la celda activa. Es el modelo de una hoja de cálculo.
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
 * Se emite cuando cambia el rango seleccionado.
 *
 * ## Por qué no trae las filas abarcadas
 *
 * Porque se emite en cada paso del arrastre, y un rango puede abarcar 50.000
 * filas. Materializar esa lista por evento asignaría 50.000 objetos varias veces
 * por segundo mientras el usuario mueve el mouse. Las columnas sí vienen
 * resueltas: son decenas como mucho, y sin ellas el consumidor no podría saber
 * qué abarca un rango cuyas puntas son dos claves sueltas.
 *
 * Las filas se recorren con {@link RangeSelectEvent.rowStart} y
 * {@link RangeSelectEvent.rowEnd}, que —como toda {@link CellPosition}— indexan
 * la secuencia VISIBLE. Es la excepción a la regla de que los eventos reportan
 * índices de `rows`, y es forzosa: un rango puede abarcar cabeceras de grupo,
 * que no tienen ningún índice en el dataset.
 */
export interface RangeSelectEvent<TRow> {
  /** El rango, con sus dos puntas. `null` cuando quedó una sola celda. */
  readonly range: CellRange | null
  /** Primera fila abarcada, en la secuencia visible. */
  readonly rowStart: number
  /** Última fila abarcada, en la secuencia visible. Incluida. */
  readonly rowEnd: number
  /** Columnas abarcadas, en orden visual. */
  readonly columns: readonly DataTableColumn<TRow>[]
}

/**
 * Se emite cuando el usuario copia la selección al portapapeles.
 *
 * Llega DESPUÉS de haberlo escrito: es una notificación, no un punto de veto. El
 * texto es exactamente el que se copió.
 */
export interface RangeCopyEvent {
  /**
   * El rango copiado, o `null` cuando no hubo uno.
   *
   * Es `null` en los dos casos donde el usuario no arrastró nada: una sola celda
   * en modo celda, y la fila entera en modo fila. `rowCount` y `columnCount`
   * dicen cuál de los dos fue.
   */
  readonly range: CellRange | null
  /** El texto escrito en el portapapeles: TSV, una línea por fila. */
  readonly text: string
  /** Cantidad de filas de datos que aportaron una línea. */
  readonly rowCount: number
  /** Cantidad de columnas abarcadas. */
  readonly columnCount: number
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
 * Rectángulo de celdas seleccionado, como lo entiende una hoja de cálculo.
 *
 * ## Por qué dos puntas y no un rectángulo ya normalizado
 *
 * Un rectángulo `{ top, left, bottom, right }` perdería el dato que hace falta
 * para extender la selección: CUÁL de las dos esquinas está fija. Arrastrar
 * hacia arriba desde la fila 10 hasta la 3 y arrastrar hacia abajo desde la 3
 * hasta la 10 producen el mismo rectángulo, pero la próxima `Shift`+flecha mueve
 * puntas opuestas. Con ancla y foco esa diferencia queda expresada en el estado
 * y no en un historial aparte.
 *
 * El {@link CellRange.anchor} es SIEMPRE la celda activa: el rango no es un
 * segundo estado de selección que pueda contradecir al primero, sino el mismo
 * estado con una punta más. Por eso mover la selección —un clic simple, una
 * flecha sin `Shift`— colapsa el rango en lugar de dejarlo flotando.
 *
 * Las dos posiciones indexan la SECUENCIA VISIBLE, igual que
 * {@link CellPosition}, y las columnas se resuelven contra las VISIBLES en el
 * momento de pintar: ocultar una columna de adentro del rango lo angosta, no lo
 * invalida.
 */
export interface CellRange {
  /** Esquina fija: la celda donde empezó la selección. Es la celda activa. */
  anchor: CellPosition
  /** Esquina móvil: hasta dónde llegó el arrastre o la última `Shift`+tecla. */
  focus: CellPosition
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
  /** Uno más allí del último índice de item a pintar. */
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
 *
 * ## Una columna oculta y una desconocida valen lo mismo
 *
 * Todo método que recibe una clave de columna resuelve esa clave contra las
 * columnas VISIBLES. Una columna oculta —por el selector de columnas, por un
 * layout restaurado o por `defaultVisible: false`— no resuelve, igual que una
 * clave que no corresponde a ninguna columna declarada. Ninguno de los dos casos
 * avisa por consola ni lanza: ocultar una columna es una acción normal del
 * usuario, y un método que se queja de ella se quejaría durante el uso
 * corriente. Cada método documenta abajo qué hace exactamente en ese caso.
 */
export interface DataTableInstance {
  /**
   * Scrollea hasta que `index` sea la primera fila totalmente visible. Se ACOTA.
   *
   * `index` recorre la secuencia visible, igual que {@link CellPosition.rowIndex}:
   * con grupos activos cuenta también las cabeceras y saltea a los hijos de los
   * grupos colapsados.
   *
   * Un índice fuera de rango va al borde más cercano y una fracción se trunca.
   * Es la asimetría con {@link DataTableInstance.scrollToCell}, que NO acota su
   * índice de fila; el porqué está documentado ahí.
   */
  scrollToRow(index: number): void
  /**
   * Scrollea hasta que la columna con esa clave quede en el borde izquierdo.
   *
   * No hace nada si la columna está OCULTA ni si la clave es DESCONOCIDA: una
   * columna oculta no tiene borde izquierdo al que llevar la vista, exactamente
   * como una que no existe.
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
   * Olvida qué páginas ya se pidieron y vuelve a pedir lo que falte.
   *
   * Solo hace algo en modo servidor, o sea con `rowCount` declarado. Fuera de
   * ahí es una función vacía y llamarla no cuesta nada.
   *
   * La tabla pide cada página UNA vez y no insiste: si un `fetch` falla y las
   * filas nunca llegan, esa página se queda como marcador para siempre. Es
   * deliberado —reintentar solo produciría una tormenta de pedidos contra la
   * base de datos durante un scroll rápido— y esta es la vía para recuperarse.
   *
   * También sirve para invalidar sin acortar `rows`: al cambiar un orden o un
   * filtro del lado del servidor, lo normal es `rows = []`, que la tabla detecta
   * sola. Si en cambio se reemplaza el array por otro del mismo largo, hay que
   * llamar aquí.
   */
  refreshRows(): void
  /**
   * Descarta el layout guardado y vuelve a visibilidad, orden, anchos,
   * agrupación y grupos colapsados por defecto. Es el "restablecer columnas" de
   * la UI.
   *
   * Borra el almacenamiento Y el estado vivo, en ese orden. Borrar solo el
   * almacenamiento dejaría al usuario mirando la misma configuración que quiso
   * descartar hasta el próximo reload. Cada parte del estado se emite por su
   * `update:*`, así que en modo controlado el padre se entera y decide.
   */
  resetLayout(): void
  /**
   * Fija la celda activa, o la limpia con `null`. Desplaza la vista si hace falta.
   *
   * Con una columna OCULTA o DESCONOCIDA la posición igual se guarda y se
   * anuncia por `update:activeCell`: es la posición que se pidió, y el
   * componente no inventa otra. Lo que no ocurre es el resto. No se emite
   * `cellSelect`, porque no hay columna que reportar; ninguna celda se pinta
   * activa; y `.dt-root` informa `data-active-cell="false"`, de modo que el
   * anillo de foco del viewport queda disponible como única señal visible. El
   * desplazamiento sigue la regla de {@link DataTableInstance.scrollToCell}: se
   * mueve el eje vertical y no el horizontal.
   */
  selectCell(position: CellPosition | null): void
  /**
   * Fija el rango seleccionado, o lo colapsa con `null`.
   *
   * Mueve TAMBIÉN la celda activa: el ancla del rango y la celda activa son la
   * misma posición, así que seleccionar un rango deja la celda activa en su
   * ancla y emite `update:activeCell` como cualquier otra selección. Colapsarlo
   * con `null` conserva la celda activa donde estaba.
   *
   * Desplaza la vista hasta el FOCO —la punta móvil—, que es lo que el usuario
   * acaba de pedir ver. No hace nada si `rangeSelection` está apagado o si
   * `selectionMode` no es `'cell'`.
   */
  selectRange(range: CellRange | null): void
  /**
   * Desplaza lo mínimo necesario para que la celda quede visible.
   *
   * ## Los dos ejes son independientes
   *
   * Si la columna está OCULTA o la clave es DESCONOCIDA, el eje horizontal no se
   * mueve y **el vertical sí**. Es intencional: son dos coordenadas separadas, y
   * `rowIndex` sigue siendo un número de fila válido sin importar qué diga
   * `columnKey`, así que se resuelve el eje sobre el que sí había información.
   * Cortar del todo rompería el caso ordinario de una celda activa cuya columna
   * el usuario acaba de ocultar: la navegación vertical dejaría de traer filas a
   * la vista por un motivo ajeno al eje vertical.
   *
   * ## No acota el índice de fila
   *
   * A diferencia de {@link DataTableInstance.scrollToRow}, que sí lo acota. La
   * razón es de dónde viene cada uno: `scrollToRow` es un salto absoluto que
   * pide el consumidor con un número suelto, mientras que la posición que llega
   * aquí ya viene acotada por el camino de navegación interno. Con un índice
   * fuera de rango, el navegador acota la escritura del scroll contra la altura
   * real del canvas y la vista queda en el extremo.
   */
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
