import { computed, shallowRef, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, ShallowRef } from 'vue'
import type { CellValue, DataRow, DataTableColumn, FlatRow, GroupByState, GroupRow } from '../types'
import {
  accumulate,
  createAccumulator,
  EMPTY_GROUP_LABEL,
  finishAggregate,
  groupSegment,
  groupValueLabel,
  joinGroupId,
  needsRowCollection,
  reconcileGroupBy,
  resolveAggregateColumns,
} from '../internal/aggregations'
import type { AggregateAccumulator, AggregateColumn } from '../internal/aggregations'
import { readCellValue } from '../internal/values'

/**
 * Agrupación multinivel con agregados.
 *
 * ## El problema que resuelve
 *
 * Sin grupos, `rowIndex` indexa directo en `props.rows` y el virtualizador
 * resuelve la fila `i` con un acceso a array. Con grupos eso deja de valer: la
 * secuencia visible intercala cabeceras, y un grupo colapsado esconde a todos sus
 * hijos. La fila que se ve en la posición 7 puede ser la 340 del dataset, o puede
 * no ser una fila de datos en absoluto.
 *
 * La respuesta es una VISTA APLANADA: un array derivado donde cada entrada es una
 * cabecera de grupo o una fila de datos, y donde la posición es de nuevo un
 * índice. El virtualizador vuelve a hacer una división y un acceso a array, y
 * todo lo caro —bucketizar, contar, agregar— ocurre una vez, cuando cambian las
 * entradas, nunca durante el scroll.
 *
 * ## Las dos derivaciones, y por qué son dos
 *
 * 1. **El árbol** depende de `rows`, `groupBy` y las columnas. Es la pasada O(n)
 *    que bucketiza y agrega.
 * 2. **El aplanado** depende del árbol y del estado de expansión. Es una
 *    emisión, O(salida).
 *
 * Separarlas es lo que hace que expandir o colapsar un grupo NO vuelva a
 * recorrer 50k filas ni a recalcular un solo agregado: el árbol ya está y solo
 * cambia qué se emite. Con una única derivación, cada clic en un chevrón costaría
 * la reconstrucción completa.
 *
 * ## Por qué `shallowRef` y no `ref`
 *
 * El array aplanado puede tener decenas de miles de entradas. Un `ref` profundo
 * las envolvería a todas en proxies reactivos, que es precisamente el costo de
 * memoria y de tracking que el resto del componente se toma el trabajo de evitar.
 * Nada de aquí adentro se muta en el lugar: cada reconstrucción REEMPLAZA el
 * array, así que la reactividad superficial alcanza y sobra.
 *
 * Los dos `watch` son síncronos a propósito. Un `flush` diferido dejaría al
 * aplanado un tick por detrás de `groupBy`, y en ese tick el virtualizador
 * calcularía su ventana contra una cantidad de filas que ya no es la real.
 *
 * ## `groupBy` vacío no cuesta nada
 *
 * Con la lista vacía, {@link UseRowGroupingReturn.flatRows} vale `null` y no se
 * construye ni un objeto por fila. `null` no es "todavía no está": es la
 * respuesta, y significa "indexá `rows` directo". El camino sin agrupación no
 * paga ni una asignación por esta función.
 */

/** Opciones de {@link useRowGrouping}. */
export interface UseRowGroupingOptions<TRow extends Record<string, unknown>> {
  /**
   * El dataset. Se indexa y se lee, nunca se copia ni se ordena.
   *
   * Acepta huecos porque la prop `rows` de la tabla los acepta en modo servidor.
   * Una fila que no llegó no se puede agrupar y se saltea, aunque en la práctica
   * no llega hasta aquí: agrupar y modo servidor son excluyentes.
   */
  rows: MaybeRefOrGetter<readonly (TRow | undefined)[]>
  /** Definiciones de columna, de donde salen accessors, opciones y agregados. */
  columns: MaybeRefOrGetter<readonly DataTableColumn<TRow>[]>
  /** Claves por las que agrupar, en orden de anidamiento. */
  groupBy: MaybeRefOrGetter<GroupByState>
  /** Conjunto de grupos expandidos si el consumidor lo controla, o `undefined`. */
  expandedGroups: MaybeRefOrGetter<readonly string[] | undefined>
  /** Estado de un grupo del que todavía no se sabe nada. */
  defaultExpanded: MaybeRefOrGetter<boolean>
  /**
   * Etiqueta de los valores ausentes. Si falta, se usa {@link EMPTY_GROUP_LABEL}.
   *
   * Entra al árbol y no al pintado porque la etiqueta se resuelve una sola vez
   * por grupo, al construirlo: escribirla por frame sería recalcular un texto
   * que no depende del scroll.
   */
  emptyGroupLabel?: MaybeRefOrGetter<string | undefined>
  /** Se invoca con la lista COMPLETA de expandidos después de cada cambio. */
  onExpandedChange?: (expanded: string[]) => void
  /** Se invoca con el grupo puntual que cambió y su estado resultante. */
  onToggle?: (groupId: string, expanded: boolean) => void
}

/** Resultado de {@link useRowGrouping}. */
export interface UseRowGroupingReturn<TRow extends Record<string, unknown>> {
  /** Si hay al menos una clave de agrupación utilizable. */
  active: ComputedRef<boolean>
  /** Claves de agrupación efectivas, ya saneadas contra las columnas actuales. */
  effectiveGroupBy: ComputedRef<readonly string[]>
  /** La secuencia visible, o `null` cuando no hay agrupación. */
  flatRows: Readonly<ShallowRef<readonly FlatRow<TRow>[] | null>>
  /** Cantidad de entradas visibles. Es lo que dimensiona el virtualizador. */
  totalCount: ComputedRef<number>
  /** Niveles de anidamiento. 0 sin agrupación. */
  depth: ComputedRef<number>
  /** Entrada de la secuencia visible en esa posición, o `null`. */
  entryAt(viewIndex: number): FlatRow<TRow> | null
  /** Fila de datos en esa posición visible, o `undefined` si es una cabecera. */
  rowAt(viewIndex: number): TRow | undefined
  /**
   * Traduce una posición visible al índice dentro de la prop `rows`.
   *
   * Devuelve `-1` para una cabecera de grupo, que no corresponde a ninguna fila.
   * Sin agrupación devuelve el mismo número que recibió, sin tocar nada.
   */
  toSourceIndex(viewIndex: number): number
  /** Si un grupo está expandido según el estado vigente. */
  isExpanded(groupId: string): boolean
  /** Invierte el estado de un grupo. */
  toggleGroup(groupId: string): void
  /** Expande todos los grupos del árbol actual. */
  expandAll(): void
  /** Colapsa todos los grupos del árbol actual. */
  collapseAll(): void
  /** Ids colapsados, en el formato que se persiste. */
  collapsedGroups: ComputedRef<readonly string[]>
  /** Aplica un conjunto colapsado, típicamente recién leído del almacenamiento. */
  setCollapsedGroups(groupIds: readonly string[]): void
  /**
   * Rehace el árbol y el aplanado aunque las entradas parezcan las mismas.
   *
   * Las reconstrucciones automáticas se disparan por IDENTIDAD: `rows`, las
   * columnas y `groupBy`. Mutar un objeto de fila en el lugar no mueve ninguna de
   * las tres, así que los contadores y los agregados seguirían describiendo los
   * valores anteriores. Es la misma situación —y la misma salida— que el caché de
   * celdas del pool resuelve con `invalidate()`, un nivel más arriba.
   */
  rebuild(): void
}

/**
 * Un nodo del árbol de grupos.
 *
 * Existe solo durante la vida del árbol y nunca sale del composable: lo que se
 * expone es {@link GroupRow}, que es plano, inmutable y no arrastra ni los
 * acumuladores ni las referencias a las filas.
 */
interface GroupNode<TRow extends Record<string, unknown>> {
  /** Id por camino, ya construido. */
  readonly id: string
  /** Clave de la columna de este nivel. */
  readonly columnKey: string
  /** Valor común del grupo. */
  readonly value: CellValue
  /** Etiqueta mostrada. */
  readonly label: string
  /** Nivel de anidamiento, 0 para el primero. */
  readonly depth: number
  /** Filas de datos descendientes. Se incrementa en cada nivel del camino. */
  count: number
  /** Hijos en orden de aparición, o `null` en el último nivel. */
  readonly children: GroupNode<TRow>[] | null
  /** Índice de los hijos por segmento, para encontrarlos en O(1). */
  readonly index: Map<string, GroupNode<TRow>> | null
  /** Índices ORIGINALES de las filas del grupo, solo en el último nivel. */
  readonly dataIndices: number[] | null
  /** Acumuladores alineados por índice con las columnas agregadas. */
  readonly accumulators: AggregateAccumulator<TRow>[]
  /** Agregados ya cerrados. Se llena en la pasada final. */
  aggregates: Readonly<Record<string, CellValue>>
}

/** El árbol completo más lo que hace falta para recorrerlo sin volver a bajar. */
interface GroupTree<TRow extends Record<string, unknown>> {
  /** Grupos del primer nivel, en orden de aparición. */
  readonly roots: GroupNode<TRow>[]
  /** Todos los ids del árbol, en orden de recorrido en profundidad. */
  readonly allIds: string[]
}

/** Agregados de un grupo sin ninguna columna agregada. Se comparte, nunca se muta. */
const EMPTY_AGGREGATES: Readonly<Record<string, CellValue>> = Object.freeze({})

/**
 * Deriva la secuencia visible a partir de `rows`, `groupBy` y el estado de
 * expansión.
 *
 * @typeParam TRow - Forma de una fila. Debe ser indexable por string para que
 * funcione la lectura por defecto `row[column.key]`.
 */
export function useRowGrouping<TRow extends Record<string, unknown>>(
  options: UseRowGroupingOptions<TRow>,
): UseRowGroupingReturn<TRow> {
  /**
   * Claves de agrupación utilizables.
   *
   * Se sanean aquí y no en cada lugar que las lea: una clave desconocida o de una
   * columna no agrupable produciría un nivel entero de grupos vacíos, y el
   * síntoma —una tabla que de golpe tiene el doble de filas— es mucho más difícil
   * de rastrear que el descarte.
   */
  const effectiveGroupBy = computed<readonly string[]>(() =>
    reconcileGroupBy(toValue(options.groupBy), toValue(options.columns)),
  )

  const active = computed(() => effectiveGroupBy.value.length > 0)

  const depth = computed(() => effectiveGroupBy.value.length)

  /**
   * Conjunto expandido cuando el consumidor lo controla, o `null`.
   *
   * La comparación es contra `undefined` y no contra un valor falsy: una lista
   * vacía es un estado legítimo del modo controlado y significa "todo colapsado".
   */
  const controlledExpanded = computed<ReadonlySet<string> | null>(() => {
    const value = toValue(options.expandedGroups)
    if (value === undefined) return null
    return new Set(value)
  })

  /**
   * Ids cuyo estado se APARTA del valor por defecto, en modo no controlado.
   *
   * Guardar las excepciones y no los expandidos es lo que mantiene el estado
   * chico: con `groupsDefaultExpanded` en `true` y diez mil grupos, este conjunto
   * tiene tantas entradas como grupos haya colapsado el usuario, que son unos
   * pocos. La lista completa de expandidos sí se calcula, pero solo cuando hay
   * que emitirla, que ocurre por interacción y no por frame.
   */
  const overrides = shallowRef<ReadonlySet<string>>(new Set())

  function isExpanded(groupId: string): boolean {
    const controlled = controlledExpanded.value
    if (controlled !== null) return controlled.has(groupId)
    const fallback = toValue(options.defaultExpanded)
    return overrides.value.has(groupId) ? !fallback : fallback
  }

  const tree = shallowRef<GroupTree<TRow> | null>(null)

  const flatRows = shallowRef<readonly FlatRow<TRow>[] | null>(null)

  /**
   * Construye el árbol de grupos en una sola pasada sobre las filas.
   *
   * ## Complejidad
   *
   * O(filas x niveles), con `niveles` igual a `groupBy.length`. NO es O(filas x
   * grupos): encontrar el grupo de una fila en su nivel es una búsqueda en un
   * `Map` por el segmento del id, no un barrido de los hermanos. Con la cantidad
   * de niveles siendo 1, 2 o 3 en cualquier uso real, el costo es lineal en las
   * filas con una constante chica.
   *
   * No hay ordenamiento. El orden de los grupos es el de su primera aparición y
   * el de las filas dentro de un grupo es el original, así que agrupar nunca
   * reordena los datos por su cuenta: quien quiera un orden lo aplica sobre
   * `rows`, que es donde ya lo tenía.
   */
  function buildTree(): GroupTree<TRow> | null {
    const groupBy = effectiveGroupBy.value
    if (groupBy.length === 0) return null

    const rows = toValue(options.rows)
    const columns = toValue(options.columns)
    const emptyLabel = toValue(options.emptyGroupLabel) ?? EMPTY_GROUP_LABEL

    const columnByKey = new Map<string, DataTableColumn<TRow>>()
    for (const column of columns) columnByKey.set(column.key, column)

    const aggregateColumns = resolveAggregateColumns(columns)
    const collectRows = needsRowCollection(aggregateColumns)
    const lastLevel = groupBy.length - 1

    const roots: GroupNode<TRow>[] = []
    const rootIndex = new Map<string, GroupNode<TRow>>()

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      // Guarda de `noUncheckedIndexedAccess`. Un array ralo también aterriza aquí.
      if (row === undefined) continue

      let siblings = roots
      let index = rootIndex
      let parentId = ''

      for (let level = 0; level <= lastLevel; level += 1) {
        const columnKey = groupBy[level]
        if (columnKey === undefined) break

        const column = columnByKey.get(columnKey)
        // `effectiveGroupBy` ya garantiza que la columna existe; la lectura por
        // clave es el respaldo que exige el tipo, no un caso esperado.
        const value = column ? readCellValue(column, row) : null
        const segment = groupSegment(columnKey, value)
        // El id sale de las MISMAS dos funciones que usa el helper público
        // `groupId`. Repetir la interpolación aquí sería una segunda escritura del
        // formato, y una segunda escritura se desincroniza.
        const id = joinGroupId(parentId, segment)

        let node = index.get(segment)
        if (node === undefined) {
          const isLeaf = level === lastLevel
          node = {
            id,
            columnKey,
            value,
            label: groupValueLabel(column, value, emptyLabel),
            depth: level,
            count: 0,
            children: isLeaf ? null : [],
            index: isLeaf ? null : new Map<string, GroupNode<TRow>>(),
            dataIndices: isLeaf ? [] : null,
            accumulators: aggregateColumns.map(() => createAccumulator<TRow>(collectRows)),
            aggregates: EMPTY_AGGREGATES,
          }
          index.set(segment, node)
          siblings.push(node)
        }

        // Cada nivel del camino recibe la fila: es lo que hace que el agregado de
        // un grupo intermedio se calcule sobre TODOS sus descendientes y no sobre
        // los agregados ya cerrados de sus hijos. Para `avg` los dos números son
        // distintos, y el segundo está mal.
        node.count += 1
        for (let slot = 0; slot < aggregateColumns.length; slot += 1) {
          const entry = aggregateColumns[slot]
          const accumulator = node.accumulators[slot]
          if (entry === undefined || accumulator === undefined) continue
          accumulate(accumulator, entry, row)
        }

        if (node.dataIndices !== null) {
          node.dataIndices.push(rowIndex)
          break
        }

        // `children` e `index` son no nulos siempre que `dataIndices` lo sea, por
        // construcción; las guardas son formalidad del compilador.
        if (node.children === null || node.index === null) break
        siblings = node.children
        index = node.index
        parentId = id
      }
    }

    const allIds: string[] = []
    closeTree(roots, aggregateColumns, allIds)
    return { roots, allIds }
  }

  /** Cierra los acumuladores y recolecta los ids, en un único recorrido. */
  function closeTree(
    nodes: readonly GroupNode<TRow>[],
    aggregateColumns: readonly AggregateColumn<TRow>[],
    allIds: string[],
  ): void {
    for (const node of nodes) {
      allIds.push(node.id)

      if (aggregateColumns.length > 0) {
        const aggregates: Record<string, CellValue> = {}
        for (let slot = 0; slot < aggregateColumns.length; slot += 1) {
          const entry = aggregateColumns[slot]
          const accumulator = node.accumulators[slot]
          if (entry === undefined || accumulator === undefined) continue
          aggregates[entry.key] = finishAggregate(accumulator, entry)
        }
        node.aggregates = aggregates
      }

      // Los acumuladores sueltan las filas que juntaron para una agregación
      // propia: sin esto, el árbol conservaría una referencia por fila y por
      // nivel durante toda la vida de la vista.
      for (const accumulator of node.accumulators) accumulator.rows = null

      if (node.children !== null) closeTree(node.children, aggregateColumns, allIds)
    }
  }

  /**
   * Emite la secuencia visible a partir del árbol.
   *
   * Un grupo colapsado aporta su cabecera y nada más, pero su `count` y sus
   * agregados siguen describiendo a todos sus hijos: colapsar es una decisión de
   * presentación y no puede cambiar lo que el grupo dice de sí mismo.
   *
   * La recursión baja tantos niveles como tenga `groupBy`, o sea uno o dos en la
   * práctica: no hay riesgo de desbordar la pila con datos grandes, porque lo que
   * crece con los datos es el ancho del árbol y no su altura.
   */
  function flatten(treeValue: GroupTree<TRow>): readonly FlatRow<TRow>[] {
    const rows = toValue(options.rows)
    const output: FlatRow<TRow>[] = []
    emitLevel(treeValue.roots)
    return output

    function emitLevel(nodes: readonly GroupNode<TRow>[]): void {
      const setSize = nodes.length
      for (let position = 0; position < setSize; position += 1) {
        const node = nodes[position]
        if (node === undefined) continue

        const expanded = isExpanded(node.id)
        const groupRow: GroupRow = {
          kind: 'group',
          groupId: node.id,
          columnKey: node.columnKey,
          value: node.value,
          label: node.label,
          depth: node.depth,
          count: node.count,
          expanded,
          setSize,
          posInSet: position + 1,
          aggregates: node.aggregates,
        }
        output.push(groupRow)

        if (!expanded) continue

        if (node.children !== null) {
          emitLevel(node.children)
          continue
        }

        if (node.dataIndices === null) continue
        for (const rowIndex of node.dataIndices) {
          const row = rows[rowIndex]
          if (row === undefined) continue
          const dataRow: DataRow<TRow> = { kind: 'data', row, rowIndex }
          output.push(dataRow)
        }
      }
    }
  }

  function rebuild(): void {
    tree.value = buildTree()
  }

  // El árbol se reconstruye solo ante un cambio de datos, de agrupación, de
  // columnas o de la etiqueta de los vacíos —que forma parte del árbol porque la
  // etiqueta se resuelve al construirlo—. `flush: 'sync'` porque el virtualizador
  // lee la cantidad de filas en el mismo tick en que el consumidor cambia
  // `groupBy`: diferirlo dejaría un frame calculando su ventana contra un total
  // que ya no existe.
  watch(
    [
      () => toValue(options.rows),
      () => toValue(options.columns),
      effectiveGroupBy,
      () => toValue(options.emptyGroupLabel),
    ],
    rebuild,
    { flush: 'sync', immediate: true },
  )

  // El aplanado depende del árbol y de la expansión, y de nada más. Scrollear no
  // toca ninguno de los dos, así que este watcher no se ejecuta ni una vez por
  // frame de scroll: esa es toda la tesis del archivo.
  watch(
    [tree, controlledExpanded, overrides, () => toValue(options.defaultExpanded)],
    () => {
      const current = tree.value
      flatRows.value = current === null ? null : flatten(current)
    },
    { flush: 'sync', immediate: true },
  )

  const totalCount = computed(() => flatRows.value?.length ?? toValue(options.rows).length)

  function entryAt(viewIndex: number): FlatRow<TRow> | null {
    const flat = flatRows.value
    if (flat === null) return null
    return flat[viewIndex] ?? null
  }

  function rowAt(viewIndex: number): TRow | undefined {
    const flat = flatRows.value
    if (flat === null) return toValue(options.rows)[viewIndex]
    const entry = flat[viewIndex]
    if (entry === undefined || entry.kind !== 'data') return undefined
    return entry.row
  }

  function toSourceIndex(viewIndex: number): number {
    const flat = flatRows.value
    if (flat === null) return viewIndex
    const entry = flat[viewIndex]
    if (entry === undefined || entry.kind !== 'data') return -1
    return entry.rowIndex
  }

  /** Ids de todos los grupos del árbol, expandidos o no. */
  function allGroupIds(): readonly string[] {
    return tree.value?.allIds ?? []
  }

  /**
   * Anuncia el estado de expansión resultante.
   *
   * `pending` permite anunciar un cambio que en modo controlado todavía no se
   * aplicó: la prop es del padre y no cambia hasta que él la escriba, pero el
   * evento tiene que describir el estado que el padre va a adoptar si lo acepta.
   */
  function publishExpanded(pending?: { groupId: string; expanded: boolean }): void {
    const notify = options.onExpandedChange
    if (!notify) return

    const result: string[] = []
    for (const groupId of allGroupIds()) {
      const expanded =
        pending && pending.groupId === groupId ? pending.expanded : isExpanded(groupId)
      if (expanded) result.push(groupId)
    }
    notify(result)
  }

  /** Reemplaza las excepciones al valor por defecto, en modo no controlado. */
  function applyOverrides(next: ReadonlySet<string>): void {
    if (controlledExpanded.value !== null) return
    overrides.value = next
  }

  function toggleGroup(groupId: string): void {
    const next = !isExpanded(groupId)

    if (controlledExpanded.value === null) {
      const fallback = toValue(options.defaultExpanded)
      const updated = new Set(overrides.value)
      if (next === fallback) updated.delete(groupId)
      else updated.add(groupId)
      applyOverrides(updated)
    }

    publishExpanded({ groupId, expanded: next })
    options.onToggle?.(groupId, next)
  }

  function expandAll(): void {
    const fallback = toValue(options.defaultExpanded)
    applyOverrides(fallback ? new Set() : new Set(allGroupIds()))
    options.onExpandedChange?.([...allGroupIds()])
  }

  function collapseAll(): void {
    const fallback = toValue(options.defaultExpanded)
    applyOverrides(fallback ? new Set(allGroupIds()) : new Set())
    options.onExpandedChange?.([])
  }

  /**
   * Ids colapsados, que es lo que se persiste.
   *
   * En la configuración habitual —no controlado y expandido por defecto— las
   * excepciones YA son los colapsados, así que devolverlos no cuesta recorrer el
   * árbol ni depende de él. Solo las otras combinaciones pagan el barrido, y
   * ninguna de ellas ocurre por frame.
   */
  const collapsedGroups = computed<readonly string[]>(() => {
    if (controlledExpanded.value === null && toValue(options.defaultExpanded)) {
      return [...overrides.value]
    }
    const result: string[] = []
    for (const groupId of allGroupIds()) {
      if (!isExpanded(groupId)) result.push(groupId)
    }
    return result
  })

  function setCollapsedGroups(groupIds: readonly string[]): void {
    const collapsed = new Set(groupIds)

    if (toValue(options.defaultExpanded)) {
      applyOverrides(collapsed)
    } else {
      // Con el valor por defecto en colapsado, las excepciones son los
      // expandidos: hay que invertir el conjunto contra los grupos que existen.
      const expanded = new Set<string>()
      for (const groupId of allGroupIds()) {
        if (!collapsed.has(groupId)) expanded.add(groupId)
      }
      applyOverrides(expanded)
    }

    publishExpanded()
  }

  return {
    active,
    effectiveGroupBy,
    flatRows,
    totalCount,
    depth,
    entryAt,
    rowAt,
    toSourceIndex,
    isExpanded,
    toggleGroup,
    expandAll,
    collapseAll,
    collapsedGroups,
    setCollapsedGroups,
    rebuild,
  }
}
