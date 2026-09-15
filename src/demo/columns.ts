import type { CellValue, DataTableColumn } from '@/components/ui/datatable'
import { PRIORITY_OPTIONS, STATUS_OPTIONS, TAG_OPTIONS } from './data'
import type { ProjectRow } from './data'

/**
 * Definición de columnas de la demo.
 *
 * Cubre los ocho renderers incluidos y las tres formas de resolver el editor:
 * inferido a partir del tipo del valor, declarado de forma explícita, y delegado
 * al slot `#editor` con `editor: 'slot'`.
 *
 * ## Los formateadores viven en el módulo, no dentro de `format`
 *
 * `column.format` corre por celda visible y por frame. Construir un
 * `Intl.NumberFormat` ahí adentro significaría unas 450 instancias por frame, y
 * cada una negocia locale y arma tablas de símbolos: es una de las formas más
 * rápidas de perder el presupuesto de 16ms. Construidos una vez a nivel de
 * módulo, `format` queda en una sola llamada barata.
 *
 * ## Los agregados tienen su propio formateador
 *
 * Tres columnas declaran `aggregate`, así que las cabeceras de grupo muestran
 * cifras reales. El formato de esas cifras no sale de `format` —su firma pide
 * una fila y un índice, y una cabecera de grupo no pertenece a ninguna fila—
 * sino de `formatAggregate`, que recibe el valor y la columna. Es lo que
 * convierte el `1234.5` pelado del total en moneda y el
 * `47.31818181818182` del promedio en un porcentaje legible.
 *
 * Vale la misma regla que para `format`: los formateadores viven en el módulo.
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/**
 * Porcentaje del promedio de progreso.
 *
 * `style: 'percent'` multiplica por 100, y el valor de la columna ya viene en la
 * escala 0-100, así que se divide antes de formatear. Un decimal alcanza: el
 * promedio de un grupo no es una medición exacta y arrastrar quince dígitos solo
 * agrega ruido.
 */
const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
})

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** Presupuesto a partir del cual la celda se resalta. */
const HIGH_BUDGET = 600_000

export const projectColumns: readonly DataTableColumn<ProjectRow>[] = [
  {
    key: 'id',
    label: 'ID',
    width: 110,
    resizable: true,
    // Nace oculta: demuestra `defaultVisible` y deja algo para descubrir en el
    // selector de columnas.
    defaultVisible: false,
  },
  {
    key: 'name',
    label: 'Proyecto',
    width: 190,
    minWidth: 120,
    resizable: true,
    editable: true,
    // Sin `editor`: el valor es un string y no hay `options`, así que se infiere `text`.
    // Tampoco declara `aggregate`: un agregado se pinta en el offset de SU columna,
    // y en la primera taparía el chevrón, la etiqueta y el contador del grupo.
  },
  {
    key: 'owner',
    label: 'Responsable',
    width: 70,
    resizable: true,
    align: 'center',
    // El renderer `avatar` lee `ctx.raw`, que conserva el objeto `{ name, src }`
    // tal como está en la fila. Por eso esta columna NO declara `accessor`:
    // un accessor devuelve `CellValue`, que no puede expresar un objeto.
    renderer: 'avatar',
  },
  {
    key: 'description',
    label: 'Descripción',
    width: 280,
    minWidth: 140,
    resizable: true,
    editable: true,
    // Texto libre: agrupar por esta columna produciría un grupo por fila. La
    // bandera lo impide aunque alguien meta la clave en `groupBy` a mano.
    groupable: false,
  },
  {
    key: 'status',
    label: 'Estado',
    width: 130,
    resizable: true,
    editable: true,
    // Renderer `select`: píldora con chevron. El editor, en cambio, lo pone el
    // consumidor desde el slot `#editor` de la tabla: `DemoStatusPicker.vue`
    // ocupa el lugar que en una aplicación real ocuparía el desplegable de un
    // design system. Es la única vía por la que entra un componente Vue, y se
    // monta sobre la celda en edición —una instancia a la vez— en lugar de una
    // por celda visible.
    renderer: 'select',
    editor: 'slot',
    options: STATUS_OPTIONS,
    // `count` es el `COUNT(columna)` de SQL: cuenta las filas descendientes cuyo
    // valor está presente, no las filas del grupo. Con este dataset las dos
    // cuentas coinciden porque ninguna fila tiene el estado vacío, y ese es
    // justamente el punto: son preguntas distintas que acá dan lo mismo.
    aggregate: 'count',
  },
  {
    key: 'priority',
    label: 'Prioridad',
    width: 110,
    resizable: true,
    editable: true,
    // Renderer y editor son ejes independientes: se ve como un badge liso, sin
    // chevron, y aun así abre un desplegable al editar.
    renderer: 'badge',
    editor: 'select',
    options: PRIORITY_OPTIONS,
  },
  {
    key: 'progress',
    label: 'Progreso',
    width: 120,
    resizable: true,
    editable: true,
    renderer: 'progress',
    // El valor es numérico, así que el editor inferido es `number`. Las cotas
    // viajan a los atributos `min` / `max` / `step` del input.
    min: 0,
    max: 100,
    step: 5,
    // Con dos niveles de agrupación, este es el agregado donde se ve que un
    // grupo padre promedia sobre TODAS sus filas y no sobre los promedios de sus
    // subgrupos: las dos cuentas dan números distintos en cuanto los subgrupos
    // tienen tamaños distintos.
    aggregate: 'avg',
    // Un promedio de enteros casi nunca es entero: sin esto la cabecera mostraría
    // `47.31818181818182`.
    formatAggregate: (value: CellValue): string =>
      typeof value === 'number' ? percentFormatter.format(value / 100) : '',
  },
  {
    key: 'budget',
    label: 'Presupuesto',
    width: 130,
    resizable: true,
    editable: true,
    renderer: 'number',
    format: (value: CellValue): string =>
      typeof value === 'number' ? currencyFormatter.format(value) : '',
    // `cellClass` también corre en el camino caliente: una comparación y nada más.
    cellClass: (value: CellValue): string | undefined =>
      typeof value === 'number' && value >= HIGH_BUDGET ? 'demo-cell-high-budget' : undefined,
    // El total del grupo, en la misma moneda que las celdas. El formateador es
    // el mismo; lo que cambia es la firma, porque acá no hay fila que pasar.
    aggregate: 'sum',
    formatAggregate: (value: CellValue): string =>
      typeof value === 'number' ? currencyFormatter.format(value) : '',
  },
  {
    key: 'tags',
    label: 'Etiquetas',
    width: 220,
    resizable: true,
    // El renderer `tags` lee el array desde `ctx.raw`. No es editable: no existe
    // un editor de selección múltiple incluido.
    renderer: 'tags',
    options: TAG_OPTIONS,
  },
  {
    key: 'dueDate',
    label: 'Vencimiento',
    width: 130,
    resizable: true,
    editable: true,
    // Valor `Date`, así que el editor inferido es `date`. Sin `format` se vería
    // el ISO completo, que no es una fecha para personas.
    format: (value: CellValue): string =>
      value instanceof Date && !Number.isNaN(value.getTime()) ? dateFormatter.format(value) : '',
  },
  {
    key: 'active',
    label: 'Activo',
    width: 90,
    resizable: true,
    editable: true,
    renderer: 'checkbox',
  },
  {
    key: 'locked',
    label: 'Bloqueado',
    width: 90,
    resizable: true,
    // Sin `editable`, la casilla se pinta deshabilitada. Es el indicador de qué
    // filas rechaza el handler de `beforeEdit`.
    renderer: 'checkbox',
    hideable: false,
  },
]
