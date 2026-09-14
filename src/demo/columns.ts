import type { CellValue, DataTableColumn } from '@/components/ui/datatable'
import { PRIORITY_OPTIONS, STATUS_OPTIONS, TAG_OPTIONS } from './data'
import type { ProjectRow } from './data'

/**
 * Definición de columnas de la demo.
 *
 * Cubre los ocho renderers incluidos y las dos formas de resolver el editor:
 * inferido a partir del tipo del valor y declarado de forma explícita.
 *
 * ## Los formateadores viven en el módulo, no dentro de `format`
 *
 * `column.format` corre por celda visible y por frame. Construir un
 * `Intl.NumberFormat` ahí adentro significaría unas 450 instancias por frame, y
 * cada una negocia locale y arma tablas de símbolos: es una de las formas más
 * rápidas de perder el presupuesto de 16ms. Construidos una vez a nivel de
 * módulo, `format` queda en una sola llamada barata.
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
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
    label: 'Project',
    width: 190,
    minWidth: 120,
    resizable: true,
    editable: true,
    // Sin `editor`: el valor es un string y no hay `options`, así que se infiere `text`.
  },
  {
    key: 'owner',
    label: 'Owner',
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
    label: 'Description',
    width: 280,
    minWidth: 140,
    resizable: true,
    editable: true,
  },
  {
    key: 'status',
    label: 'Status',
    width: 130,
    resizable: true,
    editable: true,
    // Renderer `select`: píldora con chevron. El editor se infiere como `select`
    // porque la columna declara `options`.
    renderer: 'select',
    options: STATUS_OPTIONS,
  },
  {
    key: 'priority',
    label: 'Priority',
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
    label: 'Progress',
    width: 120,
    resizable: true,
    editable: true,
    renderer: 'progress',
    // El valor es numérico, así que el editor inferido es `number`. Las cotas
    // viajan a los atributos `min` / `max` / `step` del input.
    min: 0,
    max: 100,
    step: 5,
  },
  {
    key: 'budget',
    label: 'Budget',
    width: 130,
    resizable: true,
    editable: true,
    renderer: 'number',
    format: (value: CellValue): string =>
      typeof value === 'number' ? currencyFormatter.format(value) : '',
    // `cellClass` también corre en el camino caliente: una comparación y nada más.
    cellClass: (value: CellValue): string | undefined =>
      typeof value === 'number' && value >= HIGH_BUDGET ? 'demo-cell-high-budget' : undefined,
  },
  {
    key: 'tags',
    label: 'Tags',
    width: 220,
    resizable: true,
    // El renderer `tags` lee el array desde `ctx.raw`. No es editable: no existe
    // un editor de selección múltiple incluido.
    renderer: 'tags',
    options: TAG_OPTIONS,
  },
  {
    key: 'dueDate',
    label: 'Due date',
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
    label: 'Active',
    width: 90,
    resizable: true,
    editable: true,
    renderer: 'checkbox',
  },
  {
    key: 'locked',
    label: 'Locked',
    width: 90,
    resizable: true,
    // Sin `editable`, la casilla se pinta deshabilitada. Es el indicador de qué
    // filas rechaza el handler de `beforeEdit`.
    renderer: 'checkbox',
    hideable: false,
  },
]
