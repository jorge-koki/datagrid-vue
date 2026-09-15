/**
 * Agrupación multinivel con agregados.
 *
 * ## Los dos modos de falla que protege este archivo
 *
 * El primero es de CORRECCIÓN DE DATOS y es el único de toda la librería que
 * puede corromper el dataset del consumidor: con grupos, la posición vertical de
 * una celda deja de ser su índice en `rows`, y si `editCommit` reportara la
 * posición visible el padre escribiría la edición sobre otra fila. Nada lo
 * delataría —la tabla sigue funcionando, el valor aparece— hasta que alguien
 * mirara los datos. Por eso el índice original se verifica con los grupos
 * expandidos Y con un grupo anterior colapsado, que es el caso donde los dos
 * números difieren de verdad.
 *
 * El segundo es de RENDIMIENTO y tiene la misma forma que el resto de la suite:
 * si el aplanado se recalculara durante el scroll, la tabla se vería igual y
 * scrollearía peor. Se verifica espiando una agregación propia, que es el único
 * testigo observable de una reconstrucción del árbol.
 */

import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import type { ShallowRef } from 'vue'
import { useRowGrouping } from '../composables/useRowGrouping'
import type { UseRowGroupingReturn } from '../composables/useRowGrouping'
import {
  groupId,
  groupIdColumnPath,
  groupSegment,
  reconcileGroupBy,
} from '../internal/aggregations'
import { reconcileCollapsedGroups, reconcilePersistedState } from '../internal/reconcile'
import { createPoolFixture, mountTable, resolveColumns } from './harness'
import type { GridRow, TableHarness, TableProps } from './harness'
import type { DemoRow } from './harness'
import { measureDomWrites } from './dom-recorder'
import type {
  CellValue,
  DataTableColumn,
  DataTableStorageAdapter,
  FlatRow,
  GroupIdSegment,
  PersistedTableState,
} from '../types'

/**
 * Fila de prueba con todo lo que la agrupación necesita ejercitar.
 *
 * Es un `type` y no una `interface` por el mismo motivo que `DemoRow`: solo los
 * alias de tipo reciben la firma de índice implícita que exige
 * `TRow extends Record<string, unknown>`.
 */
type Task = {
  id: number
  status: string | null
  priority: string
  amount: number
  due: Date
  owner: string
}

/**
 * Dataset de referencia de todo el archivo.
 *
 * Los importes están elegidos para que el promedio de los promedios NO sea el
 * promedio: `open` tiene tres filas de 10 y una de 100, así que la versión
 * ingenua de `avg` en el nivel padre daría 55 y la correcta 32,5. Es la
 * diferencia que distingue una implementación que agrega sobre los descendientes
 * de una que agrega sobre los agregados de sus hijos.
 */
const TASKS: readonly Task[] = [
  {
    id: 0,
    status: 'open',
    priority: 'high',
    amount: 10,
    due: new Date('2024-03-01'),
    owner: 'ana',
  },
  {
    id: 1,
    status: 'open',
    priority: 'high',
    amount: 10,
    due: new Date('2024-01-15'),
    owner: 'ana',
  },
  {
    id: 2,
    status: 'open',
    priority: 'high',
    amount: 10,
    due: new Date('2024-05-20'),
    owner: 'bob',
  },
  {
    id: 3,
    status: 'open',
    priority: 'low',
    amount: 100,
    due: new Date('2024-02-10'),
    owner: 'bob',
  },
  { id: 4, status: 'done', priority: 'high', amount: 5, due: new Date('2024-04-01'), owner: 'ana' },
  { id: 5, status: 'done', priority: 'low', amount: 7, due: new Date('2024-06-30'), owner: 'cyd' },
  { id: 6, status: null, priority: 'high', amount: 1, due: new Date('2024-07-04'), owner: 'cyd' },
]

const COLUMNS: readonly DataTableColumn<Task>[] = [
  { key: 'id' },
  { key: 'status' },
  { key: 'priority' },
  { key: 'amount' },
  { key: 'due' },
  { key: 'owner' },
]

/** Andamiaje del composable, con las entradas como refs para poder moverlas. */
interface GroupingFixture {
  grouping: UseRowGroupingReturn<Task>
  rows: ShallowRef<readonly Task[]>
  columns: ShallowRef<readonly DataTableColumn<Task>[]>
  groupBy: ShallowRef<readonly string[]>
  expandedGroups: ShallowRef<readonly string[] | undefined>
  defaultExpanded: ShallowRef<boolean>
  /** Etiqueta del bucket de valores ausentes. `undefined` usa el default. */
  emptyGroupLabel: ShallowRef<string | undefined>
  /** Cada lista completa de expandidos anunciada, en orden. */
  expandedEvents: string[][]
  /** Cada cambio puntual anunciado, en orden. */
  toggleEvents: { groupId: string; expanded: boolean }[]
}

function createGrouping(
  options: {
    rows?: readonly Task[]
    columns?: readonly DataTableColumn<Task>[]
    groupBy?: readonly string[]
    expandedGroups?: readonly string[]
    defaultExpanded?: boolean
    emptyGroupLabel?: string
  } = {},
): GroupingFixture {
  const rows = shallowRef<readonly Task[]>(options.rows ?? TASKS)
  const columns = shallowRef<readonly DataTableColumn<Task>[]>(options.columns ?? COLUMNS)
  const groupBy = shallowRef<readonly string[]>(options.groupBy ?? [])
  const expandedGroups = shallowRef<readonly string[] | undefined>(options.expandedGroups)
  const defaultExpanded = shallowRef(options.defaultExpanded ?? true)
  const emptyGroupLabel = shallowRef<string | undefined>(options.emptyGroupLabel)

  const expandedEvents: string[][] = []
  const toggleEvents: { groupId: string; expanded: boolean }[] = []

  const grouping = useRowGrouping<Task>({
    rows,
    columns,
    groupBy,
    expandedGroups,
    defaultExpanded,
    emptyGroupLabel,
    onExpandedChange: (expanded) => expandedEvents.push(expanded),
    onToggle: (groupId, expanded) => toggleEvents.push({ groupId, expanded }),
  })

  return {
    grouping,
    rows,
    columns,
    groupBy,
    expandedGroups,
    defaultExpanded,
    emptyGroupLabel,
    expandedEvents,
    toggleEvents,
  }
}

/**
 * Resume la secuencia aplanada a una lista de strings legible.
 *
 * Un `toEqual` contra objetos completos convierte cualquier fallo en un muro de
 * JSON. Con esta forma, el diff dice exactamente qué fila sobra o falta.
 */
function describeFlat(flat: readonly FlatRow<Task>[] | null): string[] {
  if (flat === null) return ['<passthrough>']
  return flat.map((entry) =>
    entry.kind === 'group'
      ? `${'  '.repeat(entry.depth)}G ${entry.groupId} n=${entry.count} ${
          entry.expanded ? 'open' : 'shut'
        }`
      : `D #${entry.rowIndex}`,
  )
}

/** Cabecera de grupo por su id, o falla con un mensaje claro. */
function groupById(flat: readonly FlatRow<Task>[] | null, groupId: string) {
  const found = flat?.find((entry) => entry.kind === 'group' && entry.groupId === groupId)
  if (!found || found.kind !== 'group') throw new Error(`[test] no hay grupo "${groupId}"`)
  return found
}

describe('flatten — the visible sequence interleaves group headers and data rows', () => {
  it('groups a single level in first-appearance order, with descendant counts', () => {
    const fixture = createGrouping({ groupBy: ['status'] })

    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=4 open',
      'D #0',
      'D #1',
      'D #2',
      'D #3',
      'G status:done n=2 open',
      'D #4',
      'D #5',
      'G status:~null n=1 open',
      'D #6',
    ])
    expect(fixture.grouping.totalCount.value).toBe(10)
  })

  it('every data row keeps its index inside the ORIGINAL rows array', () => {
    const fixture = createGrouping({ groupBy: ['status'] })
    const flat = fixture.grouping.flatRows.value

    for (const entry of flat ?? []) {
      if (entry.kind !== 'data') continue
      // La identidad, no la igualdad: la entrada tiene que apuntar al MISMO
      // objeto que vive en `rows`, no a una copia.
      expect(entry.row).toBe(TASKS[entry.rowIndex])
    }
  })

  it('nests multiple levels and tracks the depth of each one', () => {
    const fixture = createGrouping({ groupBy: ['status', 'priority'] })

    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=4 open',
      '  G status:open/priority:high n=3 open',
      'D #0',
      'D #1',
      'D #2',
      '  G status:open/priority:low n=1 open',
      'D #3',
      'G status:done n=2 open',
      '  G status:done/priority:high n=1 open',
      'D #4',
      '  G status:done/priority:low n=1 open',
      'D #5',
      'G status:~null n=1 open',
      '  G status:~null/priority:high n=1 open',
      'D #6',
    ])
  })

  it('a collapsed group contributes its header and nothing else', () => {
    const fixture = createGrouping({ groupBy: ['status'] })
    fixture.grouping.toggleGroup('status:open')

    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=4 shut',
      'G status:done n=2 open',
      'D #4',
      'D #5',
      'G status:~null n=1 open',
      'D #6',
    ])
  })

  it('a collapsed group still reports the count of ALL its descendants', () => {
    const fixture = createGrouping({ groupBy: ['status', 'priority'] })
    fixture.grouping.toggleGroup('status:open')

    // Plegar es una decisión de presentación: no puede cambiar lo que el grupo
    // dice de sí mismo.
    expect(groupById(fixture.grouping.flatRows.value, 'status:open').count).toBe(4)
  })

  it('collapsing one branch leaves its siblings untouched', () => {
    const fixture = createGrouping({ groupBy: ['status', 'priority'] })
    fixture.grouping.toggleGroup('status:open/priority:high')

    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=4 open',
      '  G status:open/priority:high n=3 shut',
      '  G status:open/priority:low n=1 open',
      'D #3',
      'G status:done n=2 open',
      '  G status:done/priority:high n=1 open',
      'D #4',
      '  G status:done/priority:low n=1 open',
      'D #5',
      'G status:~null n=1 open',
      '  G status:~null/priority:high n=1 open',
      'D #6',
    ])
  })

  it('null and undefined land in one stable, labelled bucket', () => {
    const rows: Task[] = [
      { ...TASKS[0]!, id: 0, status: null },
      { ...TASKS[0]!, id: 1, status: undefined as unknown as string },
      { ...TASKS[0]!, id: 2, status: 'open' },
    ]
    const fixture = createGrouping({ rows, groupBy: ['status'] })
    const flat = fixture.grouping.flatRows.value

    // `null` y `undefined` son valores DISTINTOS y conservan buckets distintos:
    // juntarlos borraría una diferencia que en muchos dominios significa algo.
    // Lo que comparten es la etiqueta, porque para el usuario los dos son "vacío".
    expect(groupById(flat, 'status:~null').label).toBe('(empty)')
    expect(groupById(flat, 'status:~undefined').label).toBe('(empty)')
    expect(groupById(flat, 'status:open').label).toBe('open')
  })

  it('keeps the original row order inside a group, without sorting anything', () => {
    // Las filas llegan alternadas: si el aplanado ordenara por algo, el orden
    // dentro del grupo no sería 0, 2, 4.
    const rows: Task[] = [0, 1, 2, 3, 4, 5].map((id) => ({
      ...TASKS[0]!,
      id,
      status: id % 2 === 0 ? 'open' : 'done',
    }))
    const fixture = createGrouping({ rows, groupBy: ['status'] })

    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=3 open',
      'D #0',
      'D #2',
      'D #4',
      'G status:done n=3 open',
      'D #1',
      'D #3',
      'D #5',
    ])
  })

  it('drops a groupBy key that names no column', () => {
    const fixture = createGrouping({ groupBy: ['ghost'] })

    expect(fixture.grouping.flatRows.value).toBeNull()
    expect(fixture.grouping.effectiveGroupBy.value).toEqual([])
  })

  it('drops a key whose column declares groupable: false', () => {
    const fixture = createGrouping({
      columns: [{ key: 'status', groupable: false }, { key: 'priority' }],
      groupBy: ['status', 'priority'],
    })

    expect(fixture.grouping.effectiveGroupBy.value).toEqual(['priority'])
  })

  it('drops a duplicated key instead of producing a level of single-child groups', () => {
    const fixture = createGrouping({ groupBy: ['status', 'status'] })

    expect(fixture.grouping.effectiveGroupBy.value).toEqual(['status'])
  })

  it('rebuilds when rows are replaced', () => {
    const fixture = createGrouping({ groupBy: ['status'] })
    expect(fixture.grouping.totalCount.value).toBe(10)

    fixture.rows.value = [TASKS[0]!, TASKS[4]!]

    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=1 open',
      'D #0',
      'G status:done n=1 open',
      'D #1',
    ])
  })
})

describe('no grouping — the empty groupBy path costs nothing', () => {
  it('returns null instead of wrapping every row', () => {
    const fixture = createGrouping()

    // `null` no es "todavía no": es la respuesta. Construir 7 envoltorios acá
    // sería, con 50k filas, 50k asignaciones por una función que nadie pidió.
    expect(fixture.grouping.flatRows.value).toBeNull()
    expect(fixture.grouping.active.value).toBe(false)
    expect(fixture.grouping.depth.value).toBe(0)
  })

  it('reports the row count and maps every index to itself', () => {
    const fixture = createGrouping()

    expect(fixture.grouping.totalCount.value).toBe(TASKS.length)
    for (let index = 0; index < TASKS.length; index += 1) {
      expect(fixture.grouping.toSourceIndex(index)).toBe(index)
      expect(fixture.grouping.rowAt(index)).toBe(TASKS[index])
      expect(fixture.grouping.entryAt(index)).toBeNull()
    }
  })

  it('never calls an aggregation, because there is nothing to aggregate', () => {
    const aggregate = vi.fn(() => 0)
    const fixture = createGrouping({
      columns: [{ key: 'status' }, { key: 'amount', aggregate }],
    })

    expect(fixture.grouping.flatRows.value).toBeNull()
    expect(aggregate).not.toHaveBeenCalled()

    // Y en cuanto se agrupa, sí corre: la ausencia de llamadas es por falta de
    // grupos y no porque la columna se haya ignorado.
    fixture.groupBy.value = ['status']
    expect(aggregate).toHaveBeenCalled()
  })
})

describe('aggregations — every group sees all of its own rows', () => {
  function aggregated(kind: DataTableColumn<Task>['aggregate'], groupBy: readonly string[]) {
    return createGrouping({
      columns: [{ key: 'status' }, { key: 'priority' }, { key: 'amount', aggregate: kind }],
      groupBy,
    })
  }

  it('sum adds the numeric values of the group', () => {
    const fixture = aggregated('sum', ['status'])
    expect(groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.amount).toBe(130)
    expect(groupById(fixture.grouping.flatRows.value, 'status:done').aggregates.amount).toBe(12)
  })

  it('avg divides by the numeric values, not by the row count', () => {
    const fixture = aggregated('avg', ['status'])
    expect(groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.amount).toBe(32.5)
  })

  it('count reports the rows whose value is present', () => {
    const fixture = createGrouping({
      columns: [{ key: 'status' }, { key: 'owner', aggregate: 'count' }],
      groupBy: ['status'],
    })
    expect(groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.owner).toBe(4)
  })

  it('count ignores null and undefined, like COUNT(column) in SQL', () => {
    const rows: Task[] = [
      { ...TASKS[0]!, id: 0, status: 'open', owner: 'ana' },
      { ...TASKS[0]!, id: 1, status: 'open', owner: null as unknown as string },
      { ...TASKS[0]!, id: 2, status: 'open', owner: undefined as unknown as string },
    ]
    const fixture = createGrouping({
      rows,
      columns: [{ key: 'status' }, { key: 'owner', aggregate: 'count' }],
      groupBy: ['status'],
    })

    expect(groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.owner).toBe(1)
    // El contador de la cabecera sigue contando TODAS las filas: son dos
    // preguntas distintas y responden distinto a propósito.
    expect(groupById(fixture.grouping.flatRows.value, 'status:open').count).toBe(3)
  })

  it('min and max bound the numeric values', () => {
    const min = aggregated('min', ['status'])
    const max = aggregated('max', ['status'])

    expect(groupById(min.grouping.flatRows.value, 'status:open').aggregates.amount).toBe(10)
    expect(groupById(max.grouping.flatRows.value, 'status:open').aggregates.amount).toBe(100)
  })

  it('min and max fall back to dates when the column holds no numbers', () => {
    const fixture = createGrouping({
      columns: [{ key: 'status' }, { key: 'due', aggregate: 'min' }],
      groupBy: ['status'],
    })

    const value = groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.due
    expect(value).toBeInstanceOf(Date)
    expect((value as Date).toISOString()).toBe(new Date('2024-01-15').toISOString())
  })

  it('sum returns null for a group with nothing numeric, never a misleading zero', () => {
    const fixture = createGrouping({
      columns: [{ key: 'status' }, { key: 'owner', aggregate: 'sum' }],
      groupBy: ['status'],
    })

    expect(groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.owner).toBeNull()
  })

  it('a custom function receives every descendant row of the group', () => {
    const seen: number[][] = []
    const fixture = createGrouping({
      columns: [
        { key: 'status' },
        {
          key: 'amount',
          aggregate: (rows, columnKey) => {
            seen.push(rows.map((row) => row.id))
            return `${columnKey}:${rows.length}`
          },
        },
      ],
      groupBy: ['status'],
    })

    expect(groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.amount).toBe(
      'amount:4',
    )
    expect(seen[0]).toEqual([0, 1, 2, 3])
  })

  it('a NESTED parent aggregates over all descendants, not over its children aggregates', () => {
    const fixture = aggregated('avg', ['status', 'priority'])
    const flat = fixture.grouping.flatRows.value

    // Los hijos: tres filas de 10 y una de 100.
    expect(groupById(flat, 'status:open/priority:high').aggregates.amount).toBe(10)
    expect(groupById(flat, 'status:open/priority:low').aggregates.amount).toBe(100)

    // El padre tiene que ser (10+10+10+100)/4. La versión ingenua —promediar los
    // promedios de los hijos— daría (10+100)/2 = 55, que es el número que aparece
    // en más de una grilla del mercado y está mal.
    expect(groupById(flat, 'status:open').aggregates.amount).toBe(32.5)
    expect(groupById(flat, 'status:open').aggregates.amount).not.toBe(55)
  })

  it('a custom function on a nested parent also receives all descendants', () => {
    const fixture = createGrouping({
      columns: [
        { key: 'status' },
        { key: 'priority' },
        { key: 'amount', aggregate: (rows) => rows.map((row) => row.id).join(',') },
      ],
      groupBy: ['status', 'priority'],
    })

    expect(groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.amount).toBe(
      '0,1,2,3',
    )
  })

  it('a collapsed group keeps the aggregates of everything it hides', () => {
    const fixture = aggregated('sum', ['status'])
    fixture.grouping.toggleGroup('status:open')

    expect(groupById(fixture.grouping.flatRows.value, 'status:open').aggregates.amount).toBe(130)
  })
})

describe('expansion state — controlled and uncontrolled, like the column trio', () => {
  it('toggleGroup flips the group and announces both the change and the whole set', () => {
    const fixture = createGrouping({ groupBy: ['status'] })

    fixture.grouping.toggleGroup('status:done')

    expect(fixture.grouping.isExpanded('status:done')).toBe(false)
    expect(fixture.toggleEvents).toEqual([{ groupId: 'status:done', expanded: false }])
    expect(fixture.expandedEvents).toEqual([['status:open', 'status:~null']])
  })

  it('collapseAll and expandAll cover every group of the current tree', () => {
    const fixture = createGrouping({ groupBy: ['status', 'priority'] })

    fixture.grouping.collapseAll()
    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=4 shut',
      'G status:done n=2 shut',
      'G status:~null n=1 shut',
    ])

    fixture.grouping.expandAll()
    expect(fixture.grouping.totalCount.value).toBe(15)
    expect(fixture.expandedEvents[0]).toEqual([])
    expect(fixture.expandedEvents[1]).toHaveLength(8)
  })

  it('groupsDefaultExpanded false starts everything collapsed', () => {
    const fixture = createGrouping({ groupBy: ['status'], defaultExpanded: false })

    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=4 shut',
      'G status:done n=2 shut',
      'G status:~null n=1 shut',
    ])

    fixture.grouping.toggleGroup('status:done')
    expect(fixture.grouping.isExpanded('status:done')).toBe(true)
  })

  it('a provided expandedGroups prop wins and the composable only announces', () => {
    const fixture = createGrouping({ groupBy: ['status'], expandedGroups: ['status:done'] })

    expect(describeFlat(fixture.grouping.flatRows.value)).toEqual([
      'G status:open n=4 shut',
      'G status:done n=2 open',
      'D #4',
      'D #5',
      'G status:~null n=1 shut',
    ])

    fixture.grouping.toggleGroup('status:open')

    // Controlado: el estado NO cambió por su cuenta, solo se anunció lo que el
    // padre debería adoptar. Es la misma semántica que `update:columnVisibility`.
    expect(fixture.grouping.isExpanded('status:open')).toBe(false)
    expect(fixture.expandedEvents).toEqual([['status:open', 'status:done']])

    // Y en cuanto el padre escribe la prop, la vista lo refleja.
    fixture.expandedGroups.value = ['status:open', 'status:done']
    expect(fixture.grouping.isExpanded('status:open')).toBe(true)
  })

  it('collapsedGroups reports exactly what persistence needs to store', () => {
    const fixture = createGrouping({ groupBy: ['status'] })
    expect(fixture.grouping.collapsedGroups.value).toEqual([])

    fixture.grouping.toggleGroup('status:done')
    expect(fixture.grouping.collapsedGroups.value).toEqual(['status:done'])
  })

  it('setCollapsedGroups restores a saved set in both default modes', () => {
    const expanded = createGrouping({ groupBy: ['status'] })
    expanded.grouping.setCollapsedGroups(['status:open', 'status:done'])
    expect(expanded.grouping.isExpanded('status:open')).toBe(false)
    expect(expanded.grouping.isExpanded('status:~null')).toBe(true)

    const collapsed = createGrouping({ groupBy: ['status'], defaultExpanded: false })
    collapsed.grouping.setCollapsedGroups(['status:open'])
    expect(collapsed.grouping.isExpanded('status:open')).toBe(false)
    expect(collapsed.grouping.isExpanded('status:done')).toBe(true)
  })
})

describe('group ids — stable paths, and a reconciliation that can read them', () => {
  it('tags non-string values so two types never share a bucket', () => {
    expect(groupSegment('a', 'x')).toBe('a:x')
    expect(groupSegment('a', 1)).toBe('a:#1')
    expect(groupSegment('a', true)).toBe('a:?true')
    expect(groupSegment('a', null)).toBe('a:~null')
    expect(groupSegment('a', undefined)).toBe('a:~undefined')
    // El `1` numérico y el `'1'` de texto no pueden colapsar en el mismo grupo.
    expect(groupSegment('a', 1)).not.toBe(groupSegment('a', '1'))
  })

  it('reads back the column path of an id', () => {
    expect(groupIdColumnPath('status:open/priority:high')).toEqual(['status', 'priority'])
    expect(groupIdColumnPath('malformed')).toEqual([])
  })

  it('reconcileGroupBy drops unknown keys, non-groupable columns and duplicates', () => {
    const columns: readonly DataTableColumn<Task>[] = [
      { key: 'status' },
      { key: 'owner', groupable: false },
    ]
    expect(reconcileGroupBy(['ghost', 'status', 'owner', 'status'], columns)).toEqual(['status'])
  })

  it('reconcileCollapsedGroups keeps only ids whose path prefixes the grouping', () => {
    const ids = [
      'status:open',
      'status:open/priority:high',
      'owner:ana',
      'status:open/owner:ana',
      'status:open/priority:high/owner:ana',
    ]

    expect(reconcileCollapsedGroups(ids, ['status', 'priority'])).toEqual([
      'status:open',
      'status:open/priority:high',
    ])
  })

  it('reconcileCollapsedGroups drops everything when the grouping is gone', () => {
    expect(reconcileCollapsedGroups(['status:open'], [])).toEqual([])
  })

  it('reconcilePersistedState leaves the grouping keys out of a payload that had none', () => {
    const saved: PersistedTableState = {
      version: 1,
      columnVisibility: {},
      columnWidths: {},
      columnOrder: ['status'],
    }

    // Un payload viejo tiene que reconciliar a algo IDÉNTICO a lo de siempre: si
    // le inventáramos las claves, se escribirían de vuelta al almacenamiento y
    // cambiaría el estado guardado de una tabla que nunca usó la función.
    expect('groupBy' in reconcilePersistedState(saved, COLUMNS)).toBe(false)
  })

  it('reconcilePersistedState sanitizes the grouping keys when the payload has them', () => {
    const saved: PersistedTableState = {
      version: 1,
      columnVisibility: {},
      columnWidths: {},
      columnOrder: [],
      groupBy: ['ghost', 'status'],
      collapsedGroups: ['status:open', 'owner:ana'],
    }

    const reconciled = reconcilePersistedState(saved, COLUMNS)
    expect(reconciled.groupBy).toEqual(['status'])
    expect(reconciled.collapsedGroups).toEqual(['status:open'])
  })
})

/* ----------------------------------------------------------------- El pool */

/** Aplana filas del andamiaje del pool con el mismo código que usa el componente. */
function flattenDemo(options: {
  rows: readonly DemoRow[]
  groupBy: readonly string[]
  columns?: readonly DataTableColumn<DemoRow>[]
  collapsed?: readonly string[]
}): readonly FlatRow<DemoRow>[] {
  const grouping = useRowGrouping<DemoRow>({
    rows: () => options.rows,
    columns: () =>
      options.columns ?? [
        { key: 'name' },
        { key: 'status' },
        { key: 'amount' },
        // `choice` participa del segundo nivel de los tests anidados: una clave
        // que no nombra ninguna columna se descarta, y el test mediría un solo
        // nivel sin darse cuenta.
        { key: 'choice' },
      ],
    groupBy: () => options.groupBy,
    expandedGroups: () => undefined,
    defaultExpanded: () => true,
  })
  for (const groupId of options.collapsed ?? []) grouping.toggleGroup(groupId)

  const flat = grouping.flatRows.value
  if (flat === null) throw new Error('[test] se esperaba una vista agrupada')
  return flat
}

/** Filas de andamiaje con un `status` conocido y estable. */
function demoRows(count: number): DemoRow[] {
  const rows: DemoRow[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({
      id: index,
      name: `Row ${index}`,
      amount: index * 100,
      status: index < count / 2 ? 'open' : 'done',
      progress: index,
      done: false,
      tags: [],
      owner: { name: `Owner ${index}` },
      choice: 'open',
    })
  }
  return rows
}

/** Nodos de fila visibles que son cabeceras de grupo. */
function groupNodes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll('.dt-group-row')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && !node.hidden,
  )
}

describe('pool — a group header is a row node built once and mutated after', () => {
  it('paints the chevron, the label and the count', () => {
    const rows = demoRows(6)
    const flatRows = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })
    fixture.paint()

    const headers = groupNodes(fixture.container)
    expect(headers).toHaveLength(2)

    const first = headers[0]
    expect(first?.dataset.rowKey).toBe('status:open')
    expect(first?.querySelector('.dt-group-chevron')).not.toBeNull()
    expect(first?.querySelector('.dt-group-label')?.textContent).toBe('open')
    expect(first?.querySelector('.dt-group-count')?.textContent).toBe('3')

    fixture.destroy()
  })

  it('hides the count when showGroupCount is off', () => {
    const rows = demoRows(4)
    const flatRows = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({
      rows,
      flatRows,
      groupDepth: 1,
      showGroupCount: false,
      visibleRows: 6,
    })
    fixture.paint()

    const count = groupNodes(fixture.container)[0]?.querySelector('.dt-group-count')
    expect(count instanceof HTMLElement && count.hidden).toBe(true)
    fixture.destroy()
  })

  it('places each aggregate at its own column offset, so the figures line up', () => {
    const rows = demoRows(6)
    const columns: readonly DataTableColumn<DemoRow>[] = [
      { key: 'name', width: 100 },
      { key: 'status', width: 80 },
      { key: 'amount', width: 120, aggregate: 'sum' },
    ]
    const flatRows = flattenDemo({ rows, groupBy: ['status'], columns })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })
    fixture.paint({ columns: resolveColumns(columns) })

    const aggregate = groupNodes(fixture.container)[0]?.querySelector('.dt-group-aggregate')
    expect(aggregate).not.toBeNull()
    // `amount` arranca en 100 + 80 = 180, que es el offset acumulado de su
    // columna: el agregado cae exactamente debajo del encabezado al que pertenece.
    expect(aggregate instanceof HTMLElement && aggregate.style.transform).toBe(
      'translate3d(180px, 0, 0)',
    )
    // 0 + 100 + 200: la suma de las tres primeras filas, que son las de `open`.
    expect(aggregate?.textContent).toBe('300')
    fixture.destroy()
  })

  it('indents by depth with a single custom property, not with nested wrappers', () => {
    const rows = demoRows(4)
    const flatRows = flattenDemo({ rows, groupBy: ['status', 'choice'] })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 2, visibleRows: 10 })
    fixture.paint()

    const headers = groupNodes(fixture.container)
    expect(headers[0]?.style.getPropertyValue('--dt-group-depth')).toBe('0')
    expect(headers[1]?.style.getPropertyValue('--dt-group-depth')).toBe('1')
    // La sangría no agrega nodos: la cabecera sigue teniendo chevrón, etiqueta y
    // contador, y nada más.
    expect(headers[1]?.querySelector('.dt-group-header')?.children).toHaveLength(3)
    fixture.destroy()
  })

  it('exposes no cells, so editing and cell selection cannot reach a group', () => {
    const rows = demoRows(6)
    const flatRows = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })
    fixture.paint()

    // La posición 0 es la cabecera de `open`; la 1 es la primera fila de datos.
    expect(fixture.pool.getCellElement(0, 'name')).toBeNull()
    expect(fixture.pool.getCellElement(1, 'name')?.textContent).toBe('Row 0')
    fixture.destroy()
  })

  it('toggles through the delegated listener, without registering one per row', () => {
    const toggled: string[] = []
    const rows = demoRows(6)
    const flatRows = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({
      rows,
      flatRows,
      groupDepth: 1,
      visibleRows: 8,
      callbacks: { onGroupToggle: (groupId) => toggled.push(groupId) },
    })

    const addListener = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    fixture.paint()
    // Ni un listener sobre los nodos del pool: el click viaja por el único
    // listener que el contenedor registró al montarse.
    expect(addListener).not.toHaveBeenCalled()
    addListener.mockRestore()

    const chevron = groupNodes(fixture.container)[0]?.querySelector('.dt-group-chevron')
    chevron?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(toggled).toEqual(['status:open'])

    // Y cualquier punto de la cabecera vale, no solo el chevrón.
    groupNodes(fixture.container)[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(toggled).toEqual(['status:open', 'status:open'])

    fixture.destroy()
  })

  it('does not report a group click as a row click', () => {
    const rowClicks: number[] = []
    const rows = demoRows(6)
    const flatRows = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({
      rows,
      flatRows,
      groupDepth: 1,
      visibleRows: 8,
      callbacks: { onRowClick: (rowIndex) => rowClicks.push(rowIndex) },
    })
    fixture.paint()

    groupNodes(fixture.container)[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rowClicks).toEqual([])

    fixture.container
      .querySelector('.dt-row:not(.dt-group-row) .dt-cell')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rowClicks).toEqual([1])

    fixture.destroy()
  })

  it('follows the resolved columns when the horizontal window moves', () => {
    const rows = demoRows(6)
    const columns: readonly DataTableColumn<DemoRow>[] = [
      { key: 'name', width: 100 },
      { key: 'status', width: 80 },
      { key: 'amount', width: 120, aggregate: 'sum' },
      { key: 'progress', width: 60, aggregate: 'max' },
    ]
    const resolved = resolveColumns(columns)
    const flatRows = flattenDemo({ rows, groupBy: ['status'], columns })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })

    fixture.paint({ columns: resolved.slice(0, 3) })
    let aggregates = [
      ...(groupNodes(fixture.container)[0]?.querySelectorAll('.dt-group-aggregate') ?? []),
    ].filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hidden)
    expect(aggregates).toHaveLength(1)

    // El tramo visible se corre: entra `progress`, que también agrega, y la
    // cabecera se reajusta al nuevo tramo. Los offsets salen de las columnas ya
    // resueltas, así que resize, reorden y ocultamiento los arrastran solos.
    fixture.paint({ columns: resolved.slice(1, 4) })
    aggregates = [
      ...(groupNodes(fixture.container)[0]?.querySelectorAll('.dt-group-aggregate') ?? []),
    ].filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hidden)

    expect(aggregates.map((node) => node.style.transform)).toEqual([
      'translate3d(180px, 0, 0)',
      'translate3d(300px, 0, 0)',
    ])
    const header = groupNodes(fixture.container)[0]?.querySelector('.dt-group-header')
    expect(header instanceof HTMLElement && header.style.transform).toBe('translate3d(100px, 0, 0)')
    expect(header instanceof HTMLElement && header.style.width).toBe('260px')

    fixture.destroy()
  })

  it('announces the tree structure through ARIA', () => {
    const rows = demoRows(4)
    const flatRows = flattenDemo({ rows, groupBy: ['status', 'choice'] })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 2, visibleRows: 10 })
    fixture.paint()

    const headers = groupNodes(fixture.container)
    expect(headers[0]?.getAttribute('aria-expanded')).toBe('true')
    expect(headers[0]?.getAttribute('aria-level')).toBe('1')
    expect(headers[0]?.getAttribute('aria-posinset')).toBe('1')
    expect(headers[0]?.getAttribute('aria-setsize')).toBe('2')
    expect(headers[1]?.getAttribute('aria-level')).toBe('2')

    // Las filas de datos anuncian el nivel que les toca, uno por debajo del
    // último grupo. No llevan `posinset` ni `setsize`: cambiarían con cada fila
    // que entra a la ventana, y `aria-rowindex` ya dice dónde están.
    const dataRow = fixture.container.querySelector('.dt-row:not(.dt-group-row)')
    expect(dataRow?.getAttribute('aria-level')).toBe('3')
    expect(dataRow?.hasAttribute('aria-posinset')).toBe(false)

    fixture.destroy()
  })

  it('drops the tree attributes when the same node goes back to being a data row', () => {
    const rows = demoRows(6)
    const flatRows = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })
    fixture.paint()
    expect(groupNodes(fixture.container)).toHaveLength(2)

    fixture.paint({ flatRows: null, groupDepth: 0, start: 0, end: 6 })

    // Ni una cabecera visible, y el nodo que la mostraba ya no anuncia que se
    // puede plegar: un `aria-expanded` olvidado sobre una fila de datos le diría
    // al lector de pantalla que hay contenido que desplegar donde no lo hay.
    //
    // Se miran solo los nodos VISIBLES, que son los que existen para el árbol de
    // accesibilidad: un nodo con `hidden` está fuera de él, y limpiarle los
    // atributos sería trabajo por un anuncio que nadie puede escuchar. El nodo
    // se limpia cuando vuelve a pintarse, que es cuando vuelve a importar.
    expect(groupNodes(fixture.container)).toHaveLength(0)
    for (const node of fixture.rowNodes()) {
      if (node.hidden) continue
      expect(node.hasAttribute('aria-expanded')).toBe(false)
      expect(node.hasAttribute('aria-level')).toBe(false)
    }
    expect(fixture.pool.getCellElement(0, 'name')?.textContent).toBe('Row 0')

    fixture.destroy()
  })

  it('rewrites data-row-key when a toggle moves another row into the same slot', () => {
    const rows = demoRows(6)
    const expandedFlat = flattenDemo({ rows, groupBy: ['status'] })
    const collapsedFlat = flattenDemo({ rows, groupBy: ['status'], collapsed: ['status:open'] })

    const fixture = createPoolFixture({
      rows,
      flatRows: expandedFlat,
      groupDepth: 1,
      visibleRows: 8,
    })
    fixture.paint()
    // Posición 1: la primera fila de `open`.
    expect(fixture.pool.getCellElement(1, 'name')?.textContent).toBe('Row 0')

    fixture.paint({ flatRows: collapsedFlat })

    // Con `open` plegado, la posición 1 pasa a ser la cabecera de `done` sin
    // haberse movido. Comparar solo el índice visible dejaría el nodo mostrando
    // la fila anterior.
    const second = fixture.rowNodes().find((node) => node.dataset.rowKey === 'status:done')
    expect(second).toBeDefined()
    expect(fixture.pool.getCellElement(1, 'name')).toBeNull()

    fixture.destroy()
  })
})

/* ------------------------------------------------------- El componente entero */

const GRID_COLUMNS: readonly DataTableColumn<GridRow>[] = [
  { key: 'id', width: 120 },
  { key: 'status', width: 120 },
  { key: 'amount', width: 120, editable: true, aggregate: 'sum' },
]

/** Filas del componente: el `id` coincide con el índice ORIGINAL a propósito. */
function gridRows(): GridRow[] {
  return [
    { id: 0, status: 'open', amount: 10 },
    { id: 1, status: 'open', amount: 20 },
    { id: 2, status: 'done', amount: 30 },
    { id: 3, status: 'done', amount: 40 },
    { id: 4, status: 'late', amount: 50 },
  ]
}

async function mountGrouped(overrides: Partial<TableProps> = {}): Promise<TableHarness> {
  return mountTable({
    viewport: { width: 600, height: 400 },
    props: {
      rows: gridRows(),
      columns: GRID_COLUMNS,
      rowKey: 'id',
      rowHeight: 40,
      groupBy: ['status'],
      ...overrides,
    },
  })
}

/**
 * Invoca un método de la API imperativa que expone `defineExpose`.
 *
 * Se estrecha en runtime en lugar de afirmar el tipo: si el componente dejara de
 * exponer el método, el test falla con un mensaje que lo dice, y no con un
 * `undefined is not a function` diez líneas más abajo.
 */
function callImperative(harness: TableHarness, method: string): void {
  const instance: unknown = harness.wrapper.vm
  if (typeof instance !== 'object' || instance === null || !(method in instance)) {
    throw new Error(`[test] el componente no expuso "${method}"`)
  }
  const fn: unknown = Reflect.get(instance, method)
  if (typeof fn !== 'function') throw new Error(`[test] "${method}" no es una función`)
  fn.call(instance)
}

/** Confirma una edición abierta escribiendo un valor y apretando Enter. */
async function commitEdit(harness: TableHarness, value: string): Promise<void> {
  const control = harness.editor()
  if (!control) throw new Error('[test] no se abrió el editor')
  control.value = value
  control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await harness.flush()
}

describe('component — grouping plugged into everything that already existed', () => {
  it('becomes a treegrid while grouping is active and a grid when it is not', async () => {
    const grouped = await mountGrouped()
    // El rol viaja con la grilla, que es la raíz: el `treegrid` tiene que
    // contener también a la fila de encabezado, porque un árbol tabular con la
    // cabecera afuera es exactamente el defecto que se corrigió.
    expect(grouped.grid.getAttribute('role')).toBe('treegrid')
    expect(grouped.grid.querySelector('.dt-header-inner')?.getAttribute('role')).toBe('row')
    // Tres cabeceras más cinco filas, más la de encabezado que ahora existe de
    // verdad dentro de la grilla.
    expect(grouped.grid.getAttribute('aria-rowcount')).toBe('9')
    grouped.unmount()

    const flat = await mountGrouped({ groupBy: [] })
    expect(flat.grid.getAttribute('role')).toBe('grid')
    expect(flat.grid.getAttribute('aria-rowcount')).toBe('6')
    flat.unmount()
  })

  it('editCommit reports the ORIGINAL row index with the groups expanded', async () => {
    const harness = await mountGrouped()

    // `id` 3 vive en la posición visible 6: dos cabeceras y dos filas por delante.
    await harness.doubleClickCell(3, 'amount')
    await commitEdit(harness, '999')

    const committed = harness.wrapper.emitted('editCommit')
    expect(committed).toHaveLength(1)
    expect(committed?.[0]?.[0]).toMatchObject({ rowIndex: 3, columnKey: 'amount', newValue: 999 })
    harness.unmount()
  })

  it('editCommit still reports the original index with an earlier group collapsed', async () => {
    const harness = await mountGrouped()

    // Se pliega el primer grupo, que es el caso donde la posición visible y el
    // índice original se separan de verdad: `id` 3 pasa de la posición 6 a la 4.
    const firstGroup = harness.canvas.querySelector('.dt-group-row')
    firstGroup?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await harness.flush()

    await harness.doubleClickCell(3, 'amount')
    await commitEdit(harness, '777')

    const committed = harness.wrapper.emitted('editCommit')
    expect(committed?.[0]?.[0]).toMatchObject({ rowIndex: 3, newValue: 777 })
    // Y la fila que viaja en el evento es la del dataset, no una vecina.
    const payload = committed?.[0]?.[0] as { row: GridRow }
    expect(payload.row.id).toBe(3)
    harness.unmount()
  })

  it('beforeEdit and afterEdit report the original index too', async () => {
    const harness = await mountGrouped()

    await harness.doubleClickCell(4, 'amount')
    await commitEdit(harness, '123')

    expect(harness.wrapper.emitted('beforeEdit')?.[0]?.[0]).toMatchObject({ rowIndex: 4 })
    expect(harness.wrapper.emitted('afterEdit')?.[0]?.[0]).toMatchObject({ rowIndex: 4 })
    harness.unmount()
  })

  it('beforeEdit can still veto the edit after the row index was rewritten', async () => {
    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: {
        rows: gridRows(),
        columns: GRID_COLUMNS,
        rowKey: 'id',
        rowHeight: 40,
        groupBy: ['status'],
        onBeforeEdit: (event) => {
          event.cancel()
          // El veto se lee de vuelta sobre el MISMO objeto que recibió el
          // listener. Reescribir el índice copiando el evento rompería esto en
          // silencio: `cancel()` marcaría el original y el listener vería su
          // copia intacta.
          expect(event.canceled).toBe(true)
          expect(event.rowIndex).toBe(1)
        },
      },
    })

    await harness.doubleClickCell(1, 'amount')

    expect(harness.editor()).toBeNull()
    expect(harness.wrapper.emitted('beforeEdit')).toHaveLength(1)
    expect(harness.wrapper.emitted('afterEdit')).toBeUndefined()
    harness.unmount()
  })

  it('rowClick and cellSelect report the original index', async () => {
    const harness = await mountGrouped()

    await harness.clickCell(2, 'status')

    expect(harness.wrapper.emitted('cellSelect')?.[0]?.[0]).toMatchObject({ rowIndex: 2 })
    harness.unmount()
  })

  it('clicking a group header toggles it and emits groupToggle', async () => {
    const harness = await mountGrouped()

    harness.canvas
      .querySelector('.dt-group-row')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await harness.flush()

    expect(harness.wrapper.emitted('groupToggle')?.[0]?.[0]).toEqual({
      groupId: 'status:open',
      expanded: false,
    })
    expect(harness.wrapper.emitted('update:expandedGroups')?.[0]?.[0]).toEqual([
      'status:done',
      'status:late',
    ])
    // Dos filas menos: el grupo plegado ya no aporta sus hijos.
    expect(harness.grid.getAttribute('aria-rowcount')).toBe('7')
    harness.unmount()
  })

  it('clicking a group header leaves no selection ring and no focused cell', async () => {
    const harness = await mountGrouped()

    // Se manda `pointerdown` además del `click`, que es lo que hace un puntero
    // real: `pointerdown` es el camino por el que se selecciona y por el que la
    // tabla pide el foco, así que es el único que podría dejar una marca.
    const header = harness.canvas.querySelector('.dt-group-row')
    header?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    header?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await harness.flush()

    expect(harness.wrapper.emitted('groupToggle')).toHaveLength(1)
    // Una cabecera se pliega, no se selecciona: sus celdas están escondidas y no
    // representan ninguna columna. No emite selección, no deja ninguna celda
    // marcada y no se queda con el foco del DOM.
    expect(harness.wrapper.emitted('update:activeCell')).toBeUndefined()
    expect(harness.grid.querySelectorAll('.dt-cell--active')).toHaveLength(0)
    expect(document.activeElement?.classList.contains('dt-cell')).not.toBe(true)
    harness.unmount()
  })

  it('does not emit cellSelect when the active row is a group header', async () => {
    const harness = await mountGrouped()

    // La primera flecha SIEMBRA la posición 0, que es una cabecera.
    await harness.press('ArrowDown')

    expect(harness.wrapper.emitted('update:activeCell')?.[0]?.[0]).toMatchObject({ rowIndex: 0 })
    expect(harness.wrapper.emitted('cellSelect')).toBeUndefined()
    harness.unmount()
  })

  it('keyboard: Enter toggles a group instead of opening an editor', async () => {
    const harness = await mountGrouped()
    await harness.press('ArrowDown')

    await harness.press('Enter')

    expect(harness.editor()).toBeNull()
    expect(harness.wrapper.emitted('groupToggle')?.[0]?.[0]).toEqual({
      groupId: 'status:open',
      expanded: false,
    })
    harness.unmount()
  })

  it('keyboard: Space toggles a group and does not seed an editor', async () => {
    const harness = await mountGrouped()
    await harness.press('ArrowDown')

    await harness.press(' ')

    expect(harness.editor()).toBeNull()
    expect(harness.wrapper.emitted('groupToggle')).toHaveLength(1)
    harness.unmount()
  })

  it('keyboard: ArrowRight expands a collapsed group, ArrowLeft collapses it back', async () => {
    const harness = await mountGrouped()
    await harness.press('ArrowDown')
    await harness.press('Enter')

    await harness.press('ArrowRight')
    expect(harness.wrapper.emitted('groupToggle')?.[1]?.[0]).toEqual({
      groupId: 'status:open',
      expanded: true,
    })

    await harness.press('ArrowLeft')
    expect(harness.wrapper.emitted('groupToggle')?.[2]?.[0]).toEqual({
      groupId: 'status:open',
      expanded: false,
    })
    harness.unmount()
  })

  it('keyboard: on an already expanded group the arrows keep moving between columns', async () => {
    const harness = await mountGrouped()
    await harness.press('ArrowDown')

    // El grupo ya está abierto, así que la flecha derecha no tiene nada que abrir
    // y vuelve a significar lo de siempre.
    await harness.press('ArrowRight')

    expect(harness.wrapper.emitted('groupToggle')).toBeUndefined()
    const events = harness.wrapper.emitted('update:activeCell')
    expect(events?.[events.length - 1]?.[0]).toMatchObject({ columnKey: 'status' })
    harness.unmount()
  })

  it('keyboard: on a data row Enter still opens the editor', async () => {
    const harness = await mountGrouped()
    await harness.clickCell(0, 'amount')

    await harness.press('Enter')

    expect(harness.editor()).not.toBeNull()
    harness.unmount()
  })

  it('renders the aggregate of each group in the amount column', async () => {
    const harness = await mountGrouped()

    const totals = [...harness.canvas.querySelectorAll('.dt-group-aggregate')]
      .filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hidden)
      .map((node) => node.textContent)

    expect(totals).toEqual(['30', '70', '50'])
    harness.unmount()
  })

  it('ArrowDown from a group header lands on its first data row and selects it', async () => {
    const harness = await mountGrouped()
    await harness.press('ArrowDown')

    await harness.press('ArrowDown')

    const events = harness.wrapper.emitted('update:activeCell')
    expect(events?.[events.length - 1]?.[0]).toMatchObject({ rowIndex: 1 })
    // Ahora sí hay una fila detrás de la posición activa, y se anuncia con su
    // índice ORIGINAL.
    expect(harness.wrapper.emitted('cellSelect')?.[0]?.[0]).toMatchObject({ rowIndex: 0 })
    harness.unmount()
  })

  it('keeps working with virtualizeColumns off', async () => {
    const harness = await mountGrouped({ virtualizeColumns: false })

    expect(harness.canvas.querySelectorAll('.dt-group-row')).toHaveLength(3)
    const totals = [...harness.canvas.querySelectorAll('.dt-group-aggregate')]
      .filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hidden)
      .map((node) => node.textContent)
    expect(totals).toEqual(['30', '70', '50'])
    harness.unmount()
  })

  it('keeps working with column visibility, order and dense at the same time', async () => {
    const harness = await mountGrouped({
      dense: true,
      stripe: true,
      bordered: true,
      columnOrder: ['amount', 'status', 'id'],
      columnVisibility: { id: false },
    })

    // El agregado sigue la posición RESUELTA de su columna: `amount` quedó
    // primera, así que su offset es 0.
    const aggregate = harness.canvas.querySelector('.dt-group-aggregate')
    expect(aggregate instanceof HTMLElement && aggregate.style.transform).toBe(
      'translate3d(0px, 0, 0)',
    )
    expect(harness.canvas.querySelectorAll('.dt-group-row')).toHaveLength(3)
    harness.unmount()
  })

  it('refresh() recomputes the aggregates after an in-place mutation', async () => {
    const rows = gridRows()
    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: { rows, columns: GRID_COLUMNS, rowKey: 'id', rowHeight: 40, groupBy: ['status'] },
    })

    const firstTotal = () => harness.canvas.querySelector('.dt-group-aggregate')?.textContent
    expect(firstTotal()).toBe('30')

    // Mutación en el lugar: no cambia la identidad de `rows`, así que nada se
    // entera por su cuenta. Es exactamente el caso que `refresh()` existe para
    // cubrir, y con grupos hay que rehacer el árbol además del caché de celdas.
    const first = rows[0]
    if (!first) throw new Error('[test] falta la fila 0')
    first.amount = 1000

    callImperative(harness, 'refresh')
    await harness.flush()

    expect(firstTotal()).toBe('1020')
    harness.unmount()
  })

  it('does not rebuild the flattened view while scrolling', async () => {
    let rebuilds = 0
    const columns: readonly DataTableColumn<GridRow>[] = [
      { key: 'id', width: 120 },
      { key: 'status', width: 120 },
      {
        key: 'amount',
        width: 120,
        aggregate: (groupRows) => {
          rebuilds += 1
          return groupRows.length
        },
      },
    ]

    const rows: GridRow[] = []
    for (let index = 0; index < 400; index += 1) {
      rows.push({ id: index, status: index % 2 === 0 ? 'open' : 'done', amount: index })
    }

    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: { rows, columns, rowKey: 'id', rowHeight: 40, groupBy: ['status'] },
    })

    const afterMount = rebuilds
    expect(afterMount).toBeGreaterThan(0)

    for (let step = 1; step <= 12; step += 1) {
      await harness.scrollTo({ top: step * 40 })
    }

    // La agregación es el único testigo observable de una reconstrucción del
    // árbol. Doce frames de scroll y ni una sola: aplanar depende de los datos y
    // de la expansión, y el scroll no toca ninguno de los dos.
    expect(rebuilds).toBe(afterMount)
    harness.unmount()
  })
})

describe('component — persistence round trip for grouping', () => {
  /** Adaptador en memoria, para ver el payload exacto que se escribe. */
  function createMemoryAdapter(initial?: PersistedTableState) {
    let stored: PersistedTableState | null = initial ?? null
    const adapter: DataTableStorageAdapter = {
      load: () => stored,
      save: (_key, state) => {
        stored = state
      },
      remove: () => {
        stored = null
      },
    }
    return { adapter, read: () => stored }
  }

  it('writes groupBy and the collapsed set, and restores them on the next mount', async () => {
    const storage = createMemoryAdapter()

    const first = await mountGrouped({
      tableId: 'grouped',
      persist: { adapter: storage.adapter, debounce: 0 },
    })
    first.canvas
      .querySelector('.dt-group-row')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await first.flush()

    expect(storage.read()?.groupBy).toEqual(['status'])
    expect(storage.read()?.collapsedGroups).toEqual(['status:open'])
    first.unmount()

    // Segunda sesión: la tabla arranca sin `groupBy` propio y lo recupera de lo
    // guardado, con el mismo grupo plegado.
    const second = await mountTable({
      viewport: { width: 600, height: 400 },
      props: {
        rows: gridRows(),
        columns: GRID_COLUMNS,
        rowKey: 'id',
        rowHeight: 40,
        tableId: 'grouped',
        persist: { adapter: storage.adapter, debounce: 0 },
      },
    })

    expect(second.grid.getAttribute('role')).toBe('treegrid')
    const restored = [...second.canvas.querySelectorAll('.dt-group-row')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && !node.hidden,
    )
    expect(restored.map((node) => node.dataset.rowKey)).toEqual([
      'status:open',
      'status:done',
      'status:late',
    ])
    expect(restored[0]?.getAttribute('aria-expanded')).toBe('false')
    second.unmount()
  })

  it('drops a saved grouping whose column no longer exists', async () => {
    const storage = createMemoryAdapter({
      version: 1,
      columnVisibility: {},
      columnWidths: {},
      columnOrder: [],
      groupBy: ['ghost'],
      collapsedGroups: ['ghost:x'],
    })

    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: {
        rows: gridRows(),
        columns: GRID_COLUMNS,
        rowKey: 'id',
        rowHeight: 40,
        tableId: 'grouped',
        persist: { adapter: storage.adapter, debounce: 0 },
      },
    })

    expect(harness.grid.getAttribute('role')).toBe('grid')
    expect(harness.canvas.querySelectorAll('.dt-group-row')).toHaveLength(0)
    harness.unmount()
  })

  it('include.grouping off keeps the grouping out of the payload', async () => {
    const storage = createMemoryAdapter()

    const harness = await mountGrouped({
      tableId: 'grouped',
      persist: {
        adapter: storage.adapter,
        debounce: 0,
        include: { visibility: true, widths: true, order: true, grouping: false },
      },
    })
    harness.canvas
      .querySelector('.dt-group-row')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await harness.flush()

    const written = storage.read()
    expect(written).not.toBeNull()
    expect(written && 'groupBy' in written).toBe(false)
    harness.unmount()
  })

  it('a table that never groups writes exactly the payload it always wrote', async () => {
    const storage = createMemoryAdapter()

    const harness = await mountGrouped({
      groupBy: [],
      tableId: 'plain',
      persist: { adapter: storage.adapter, debounce: 0 },
    })
    // Hace falta un cambio real para que se escriba: la persistencia guarda
    // cuando el estado se mueve, no al montarse.
    await harness.wrapper.setProps({ columnVisibility: { id: false } })
    await harness.flush()

    const written = storage.read()
    expect(written && Object.keys(written).sort()).toEqual([
      'columnOrder',
      'columnVisibility',
      'columnWidths',
      'version',
    ])
    harness.unmount()
  })
})

describe('pool — the data row / group row slot hazard', () => {
  it('rebuilds a slot once when its kind changes, and never when it matches', () => {
    const rows = demoRows(6)
    const grouped = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({ rows, flatRows: null, visibleRows: 8 })

    // Primer pintado sin grupos: los nodos nacen como filas de datos.
    fixture.paint({ start: 0, end: 6 })
    fixture.paint({ start: 0, end: 6 })

    // Entra la agrupación: algunos slots pasan a ser cabeceras y construyen su
    // estructura por primera y única vez.
    const firstFlip = measureDomWrites(fixture.container, () =>
      fixture.paint({ flatRows: grouped, groupDepth: 1, start: 0, end: 8 }),
    )
    expect(firstFlip.counts.createNode, firstFlip.report).toBeGreaterThan(0)

    // Vuelta a datos y otra vez a grupos: la estructura ya existe y se turna con
    // `hidden`. Reconstruirla acá significaría crear y destruir cinco nodos —uno
    // de ellos un SVG— por cada ida y vuelta, en mitad del scroll.
    fixture.paint({ flatRows: null, groupDepth: 0, start: 0, end: 6 })
    const secondFlip = measureDomWrites(fixture.container, () =>
      fixture.paint({ flatRows: grouped, groupDepth: 1, start: 0, end: 8 }),
    )
    expect(secondFlip.counts.createNode, secondFlip.report).toBe(0)
    expect(secondFlip.counts.removeNode, secondFlip.report).toBe(0)

    fixture.destroy()
  })

  it('a slot whose kind matches writes nothing at all on a redundant repaint', () => {
    const rows = demoRows(6)
    const grouped = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({
      rows,
      flatRows: grouped,
      groupDepth: 1,
      visibleRows: 8,
    })
    fixture.paint()
    fixture.paint()

    const measured = measureDomWrites(fixture.container, () => fixture.paint())

    // Es el mismo contrato que ya cumplían las filas de datos, extendido a las
    // cabeceras: repintar con las mismas entradas no toca el DOM ni una vez.
    expect(measured.counts.total, measured.report).toBe(0)
    fixture.destroy()
  })

  it('keeps the very same DOM node across a kind flip', () => {
    const rows = demoRows(6)
    const grouped = flattenDemo({ rows, groupBy: ['status'] })
    const fixture = createPoolFixture({ rows, flatRows: null, visibleRows: 8 })
    fixture.paint({ start: 0, end: 6 })

    const before = fixture.rowNodes()
    fixture.paint({ flatRows: grouped, groupDepth: 1, start: 0, end: 8 })
    const after = fixture.rowNodes()

    // Identidad, no igualdad: cambiar de tipo RECICLA el nodo, no lo reemplaza.
    for (let slot = 0; slot < before.length; slot += 1) {
      expect(after[slot]).toBe(before[slot])
    }
    fixture.destroy()
  })
})

/* ---------------------------------------------------- column.formatAggregate */

/**
 * El formateador propio de los agregados.
 *
 * `column.format` no se puede aplicar acá y no es un descuido: su firma pide una
 * fila y un índice, y una cabecera de grupo no pertenece a ninguna fila. El
 * resultado era que una columna de moneda mostraba `1234.5` pelado en la cabecera
 * y un `avg` mostraba `47.31818181818182`.
 *
 * `formatAggregate` es la firma que sí corresponde: valor y columna, nada más.
 */
describe('formatAggregate — group aggregates get a formatter of their own', () => {
  /** Columnas del andamiaje, con un `formatAggregate` opcional sobre `amount`. */
  function aggregateColumns(
    formatAggregate?: DataTableColumn<DemoRow>['formatAggregate'],
  ): readonly DataTableColumn<DemoRow>[] {
    return [
      { key: 'name', width: 100 },
      { key: 'status', width: 80 },
      { key: 'amount', width: 120, aggregate: 'sum', formatAggregate },
    ]
  }

  /** Textos de los agregados visibles de la primera cabecera pintada. */
  function firstAggregateText(container: HTMLElement): string | null | undefined {
    return groupNodes(container)[0]?.querySelector('.dt-group-aggregate')?.textContent
  }

  it('applies formatAggregate to the figure painted in the group header', () => {
    const rows = demoRows(6)
    const columns = aggregateColumns((value) => (typeof value === 'number' ? `$${value}` : ''))
    const flatRows = flattenDemo({ rows, groupBy: ['status'], columns })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })
    fixture.paint({ columns: resolveColumns(columns) })

    // 0 + 100 + 200, ya con el formato de la columna.
    expect(firstAggregateText(fixture.container)).toBe('$300')
    fixture.destroy()
  })

  it('falls back to the default representation when the column declares none', () => {
    const rows = demoRows(6)
    const columns = aggregateColumns()
    const flatRows = flattenDemo({ rows, groupBy: ['status'], columns })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })
    fixture.paint({ columns: resolveColumns(columns) })

    // Exactamente lo que escribía antes de que la opción existiera: sumar una
    // opción no puede cambiarle la salida a quien no la declara.
    expect(firstAggregateText(fixture.container)).toBe('300')
    fixture.destroy()
  })

  it('receives the aggregate value and the column definition, and nothing else', () => {
    const seen: { value: CellValue; columnKey: string }[] = []
    const rows = demoRows(6)
    const columns = aggregateColumns((value, column) => {
      seen.push({ value, columnKey: column.key })
      return 'x'
    })
    const flatRows = flattenDemo({ rows, groupBy: ['status'], columns })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })
    fixture.paint({ columns: resolveColumns(columns) })

    expect(seen[0]).toEqual({ value: 300, columnKey: 'amount' })
    // Las dos cabeceras visibles, cada una con SU total: 0+100+200 y 300+400+500.
    expect(seen.map((entry) => entry.value)).toEqual([300, 1200])
    fixture.destroy()
  })

  it('is never called without grouping, because there is no header to paint', () => {
    const formatAggregate = vi.fn(() => 'never')
    const rows = demoRows(6)
    const columns = aggregateColumns(formatAggregate)
    const fixture = createPoolFixture({ rows, flatRows: null, visibleRows: 8 })
    fixture.paint({ columns: resolveColumns(columns) })

    // Sin agrupación no hay cabeceras, así que no hay agregados que formatear.
    // Declarar `formatAggregate` en una columna no le cuesta nada a una tabla
    // que nunca agrupa.
    expect(formatAggregate).not.toHaveBeenCalled()
    fixture.destroy()
  })

  it('keeps the skip-identical-writes discipline: a redundant repaint writes nothing', () => {
    const rows = demoRows(6)
    const columns = aggregateColumns((value) => (typeof value === 'number' ? `$${value}` : ''))
    const flatRows = flattenDemo({ rows, groupBy: ['status'], columns })
    const fixture = createPoolFixture({ rows, flatRows, groupDepth: 1, visibleRows: 8 })
    const resolved = resolveColumns(columns)
    fixture.paint({ columns: resolved })
    fixture.paint({ columns: resolved })

    const measured = measureDomWrites(fixture.container, () => fixture.paint({ columns: resolved }))

    // El formateador vuelve a correr, pero produce el mismo texto y
    // `setAggregateText` corta antes de tocar el DOM. Formatear no puede
    // convertir un repintado redundante en escrituras.
    expect(measured.counts.total, measured.report).toBe(0)
    fixture.destroy()
  })

  it('component: formats every group total end to end', async () => {
    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: {
        rows: gridRows(),
        columns: [
          { key: 'id', width: 120 },
          { key: 'status', width: 120 },
          {
            key: 'amount',
            width: 120,
            aggregate: 'sum',
            formatAggregate: (value) => (typeof value === 'number' ? `$${value.toFixed(2)}` : ''),
          },
        ],
        rowKey: 'id',
        rowHeight: 40,
        groupBy: ['status'],
      },
    })

    const totals = [...harness.canvas.querySelectorAll('.dt-group-aggregate')]
      .filter((node): node is HTMLElement => node instanceof HTMLElement && !node.hidden)
      .map((node) => node.textContent)

    expect(totals).toEqual(['$30.00', '$70.00', '$50.00'])
    harness.unmount()
  })
})

/* --------------------------------------------------------- emptyGroupLabel */

describe('emptyGroupLabel — the empty bucket carries a configurable label', () => {
  it('defaults to (empty), the same literal the constant always held', () => {
    const rows: Task[] = [
      { ...TASKS[0]!, id: 0, status: null },
      { ...TASKS[0]!, id: 1, status: undefined as unknown as string },
    ]
    const fixture = createGrouping({ rows, groupBy: ['status'] })

    expect(groupById(fixture.grouping.flatRows.value, 'status:~null').label).toBe('(empty)')
    expect(groupById(fixture.grouping.flatRows.value, 'status:~undefined').label).toBe('(empty)')
  })

  it('uses the provided label for both null and undefined', () => {
    const rows: Task[] = [
      { ...TASKS[0]!, id: 0, status: null },
      { ...TASKS[0]!, id: 1, status: undefined as unknown as string },
    ]
    const fixture = createGrouping({ rows, groupBy: ['status'], emptyGroupLabel: 'Sin asignar' })

    // Siguen siendo buckets DISTINTOS: lo que comparten es la etiqueta, porque
    // para el usuario los dos son "vacío".
    expect(groupById(fixture.grouping.flatRows.value, 'status:~null').label).toBe('Sin asignar')
    expect(groupById(fixture.grouping.flatRows.value, 'status:~undefined').label).toBe(
      'Sin asignar',
    )
  })

  it('relabels when the label changes, because it lives in the tree', () => {
    const rows: Task[] = [{ ...TASKS[0]!, id: 0, status: null }]
    const fixture = createGrouping({ rows, groupBy: ['status'], emptyGroupLabel: 'Sin asignar' })

    fixture.emptyGroupLabel.value = '(vacío)'

    // La etiqueta se resuelve al construir el árbol, no al pintar, así que
    // cambiarla tiene que reconstruirlo. Sin eso, la prop quedaría inerte hasta
    // que algún otro cambio moviera los datos.
    expect(groupById(fixture.grouping.flatRows.value, 'status:~null').label).toBe('(vacío)')
  })

  it('leaves a present value alone: it only relabels what is empty', () => {
    const fixture = createGrouping({ groupBy: ['status'], emptyGroupLabel: 'Sin asignar' })

    expect(groupById(fixture.grouping.flatRows.value, 'status:open').label).toBe('open')
    expect(groupById(fixture.grouping.flatRows.value, 'status:~null').label).toBe('Sin asignar')
  })

  it('component: paints the default label when the prop is omitted', async () => {
    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: {
        rows: [{ id: 0, status: null, amount: 10 }],
        columns: GRID_COLUMNS,
        rowKey: 'id',
        rowHeight: 40,
        groupBy: ['status'],
      },
    })

    expect(groupNodes(harness.canvas)[0]?.querySelector('.dt-group-label')?.textContent).toBe(
      '(empty)',
    )
    harness.unmount()
  })

  it('component: paints the override in the group header', async () => {
    const harness = await mountTable({
      viewport: { width: 600, height: 400 },
      props: {
        rows: [
          { id: 0, status: null, amount: 10 },
          { id: 1, status: 'open', amount: 20 },
        ],
        columns: GRID_COLUMNS,
        rowKey: 'id',
        rowHeight: 40,
        groupBy: ['status'],
        emptyGroupLabel: 'Sin asignar',
      },
    })

    const labels = groupNodes(harness.canvas).map(
      (node) => node.querySelector('.dt-group-label')?.textContent,
    )
    expect(labels).toEqual(['Sin asignar', 'open'])
    harness.unmount()
  })
})

/* ------------------------------------------------- El constructor de ids */

/**
 * Fila con un valor de cada tipo que `CellValue` admite.
 *
 * Cada columna agrupa por una forma distinta —texto, número, booleano, ausente,
 * fecha— para que un árbol real emita las cinco marcas de tipo del formato de id
 * en una sola pasada. `text` incluye la cadena vacía y `when` una fecha
 * inválida, que son los dos bordes donde la etiqueta visible y el id se separan.
 */
type Mixed = {
  id: number
  text: string | null | undefined
  num: number
  flag: boolean
  when: Date
}

const MIXED: readonly Mixed[] = [
  { id: 0, text: 'alpha', num: 1, flag: true, when: new Date('2024-01-01T00:00:00.000Z') },
  { id: 1, text: 'alpha', num: 2, flag: false, when: new Date('2024-02-01T00:00:00.000Z') },
  { id: 2, text: null, num: 1, flag: false, when: new Date('2024-01-01T00:00:00.000Z') },
  { id: 3, text: undefined, num: 2, flag: true, when: new Date('2024-02-01T00:00:00.000Z') },
  { id: 4, text: '', num: -0.5, flag: true, when: new Date('no es una fecha') },
]

const MIXED_COLUMNS: readonly DataTableColumn<Mixed>[] = [
  { key: 'id' },
  { key: 'text' },
  { key: 'num' },
  { key: 'flag' },
  { key: 'when' },
]

/** Secuencia aplanada del dataset mixto, con todo expandido. */
function mixedFlat(groupBy: readonly string[]): readonly FlatRow<Mixed>[] | null {
  return useRowGrouping<Mixed>({
    rows: MIXED,
    columns: MIXED_COLUMNS,
    groupBy,
    expandedGroups: undefined,
    defaultExpanded: true,
  }).flatRows.value
}

/**
 * Recorre un árbol real y, para cada cabecera, rearma su id con {@link groupId}.
 *
 * Devuelve las dos listas en paralelo en lugar de comparar adentro para que un
 * fallo muestre el diff completo y no solo la primera diferencia.
 *
 * El camino se lleva en un array indexado por profundidad: la secuencia aplanada
 * es un recorrido en profundidad, así que cuando aparece una cabecera de nivel
 * `d` sus ancestros ya ocupan las posiciones `0..d-1`. Truncar a `d` es lo que
 * descarta la rama anterior al pasar a un hermano.
 */
function idsFromTreeAndHelper(flat: readonly FlatRow<Mixed>[] | null): {
  fromTree: string[]
  fromHelper: string[]
} {
  const path: GroupIdSegment[] = []
  const fromTree: string[] = []
  const fromHelper: string[] = []

  for (const entry of flat ?? []) {
    if (entry.kind !== 'group') continue
    path.length = entry.depth
    path.push([entry.columnKey, entry.value])

    const [first, ...rest] = path
    if (first === undefined) throw new Error('[test] una cabecera de grupo sin ningún nivel')

    fromTree.push(entry.groupId)
    fromHelper.push(groupId(first, ...rest))
  }

  return { fromTree, fromHelper }
}

describe('groupId — the public builder and the tree build share one implementation', () => {
  it('reproduces the ids of a REAL tree for every value type CellValue covers', () => {
    // Este es el test que importa. No compara contra strings escritos a mano:
    // compara contra los ids que el árbol acaba de emitir, así que solo puede
    // pasar mientras las dos rutas produzcan exactamente el mismo formato.
    for (const columnKey of ['text', 'num', 'flag', 'when']) {
      const { fromTree, fromHelper } = idsFromTreeAndHelper(mixedFlat([columnKey]))
      expect(fromHelper).toEqual(fromTree)
      expect(fromTree.length).toBeGreaterThan(1)
    }
  })

  it('the tree really emits the five type tags, so the comparison is not vacuous', () => {
    // Sin esta aserción, el test de arriba pasaría igual si el árbol nunca
    // hubiera producido un número, un booleano, un ausente o una fecha.
    expect(idsFromTreeAndHelper(mixedFlat(['text'])).fromTree).toEqual([
      'text:alpha',
      'text:~null',
      'text:~undefined',
      'text:',
    ])
    expect(idsFromTreeAndHelper(mixedFlat(['num'])).fromTree).toEqual([
      'num:#1',
      'num:#2',
      'num:#-0.5',
    ])
    expect(idsFromTreeAndHelper(mixedFlat(['flag'])).fromTree).toEqual([
      'flag:?true',
      'flag:?false',
    ])
    expect(idsFromTreeAndHelper(mixedFlat(['when'])).fromTree).toEqual([
      'when:@2024-01-01T00:00:00.000Z',
      'when:@2024-02-01T00:00:00.000Z',
      'when:@invalid',
    ])
  })

  it('matches the tree at every depth of a multi-level grouping', () => {
    const flat = mixedFlat(['flag', 'num', 'text'])
    const { fromTree, fromHelper } = idsFromTreeAndHelper(flat)

    expect(fromHelper).toEqual(fromTree)
    // Los tres niveles existen de verdad: sin esto, el test pasaría con un árbol
    // de un solo nivel y no probaría nada sobre el camino.
    const depths = new Set<number>()
    for (const entry of flat ?? []) {
      if (entry.kind === 'group') depths.add(entry.depth)
    }
    expect(depths).toEqual(new Set([0, 1, 2]))
    expect(fromTree).toContain('flag:?true/num:#1/text:alpha')
  })

  it('a single segment builds a top-level id and the rest nests it', () => {
    expect(groupId(['region', 'LATAM'])).toBe('region:LATAM')
    expect(groupId(['region', 'LATAM'], ['status', 'active'])).toBe('region:LATAM/status:active')
    // Un nivel más, para fijar también el separador ENTRE niveles y no solo el
    // que va entre la columna y el valor.
    expect(groupId(['a', 1], ['b', true], ['c', null])).toBe('a:#1/b:?true/c:~null')
  })

  it('an id built by groupId actually opens that group on a mounted table', async () => {
    const nested = groupId(['status', 'open'], ['amount', 10])

    const harness = await mountGrouped({
      groupBy: ['status', 'amount'],
      expandedGroups: [groupId(['status', 'open']), nested],
    })

    // El grupo anidado quedó abierto y su fila se pintó: es la prueba de punta a
    // punta de que el id construido es el mismo que el árbol le puso al grupo.
    const header = harness.canvas.querySelector(`[data-row-key="${nested}"]`)
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(harness.cell(0, 'amount')?.textContent).toBe('10')

    // Y solo ese: el hermano que no está en la lista sigue plegado.
    const sibling = harness.canvas.querySelector(
      `[data-row-key="${groupId(['status', 'open'], ['amount', 20])}"]`,
    )
    expect(sibling?.getAttribute('aria-expanded')).toBe('false')
    expect(harness.cell(1, 'amount')).toBeNull()
    harness.unmount()
  })

  it('a hand-written id that drops the type tag opens nothing, and stays silent', async () => {
    // La falla que este helper existe para eliminar, fijada como test: el `10`
    // numérico se codifica `#10`, y sin la marca el id no nombra a ningún grupo.
    // La tabla no rompe, no avisa, y el grupo simplemente no abre.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const harness = await mountGrouped({
      groupBy: ['status', 'amount'],
      expandedGroups: ['status:open', 'status:open/amount:10'],
    })

    expect(harness.canvas.querySelector('[data-row-key="status:open/amount:#10"]')).not.toBeNull()
    expect(harness.cell(0, 'amount')).toBeNull()

    // DECISIÓN: no se avisa. Un id que hoy no nombra a ningún grupo es un estado
    // LEGÍTIMO y ya documentado —`reconcileCollapsedGroups` conserva a propósito
    // los ids cuyo valor ya no está en los datos, y `rows` puede llegar vacío
    // mientras carga—, así que un aviso no podría distinguir el error del uso
    // correcto. El chequeo se mueve al momento de CONSTRUIR el id, que es el
    // único punto donde hay información suficiente para hacerlo.
    expect(warn).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('stays silent while rows have not arrived yet, which is the same state', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const harness = await mountGrouped({
      rows: [],
      expandedGroups: [groupId(['status', 'open'])],
    })

    expect(groupNodes(harness.canvas)).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()

    // Y cuando los datos llegan, el id que ya estaba en la lista abre su grupo
    // sin que el consumidor tenga que volver a escribirlo.
    await harness.wrapper.setProps({ rows: gridRows() })
    await harness.flush()

    const header = harness.canvas.querySelector('[data-row-key="status:open"]')
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(warn).not.toHaveBeenCalled()
    harness.unmount()
  })
})
