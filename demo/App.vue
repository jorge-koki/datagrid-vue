<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch, watchEffect } from 'vue'
// Exactamente lo que escribiría una aplicación que instaló el paquete. Dentro de
// este repositorio el alias de Vite resuelve `datatable-vue` a `src/index.ts`, de
// modo que la demo compila contra la API pública y nada más: si algo no está
// exportado desde el `index.ts`, esta pantalla no compila.
import { DataTable } from 'datatable-vue'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellPosition,
  CellSelectEvent,
  CellValue,
  ColumnVisibilityState,
  DataTableInstance,
  DataTableRadius,
  DataTableTheme,
  DataTableVariant,
  EditCommitEvent,
  GroupToggleEvent,
  RangeCopyEvent,
  RangeSelectEvent,
  RowsRequestEvent,
  SelectionMode,
} from 'datatable-vue'
import { createProjects, ROW_COUNTS } from './data'
import type { ProjectRow } from './data'
import { fetchRows } from './server'
import { projectColumns } from './columns'
import { groupByOf, presetIdOf } from './grouping'
import type { GroupingPresetId } from './grouping'
import { useDemoLog } from './log'
import DemoControls from './DemoControls.vue'
import DemoEventLog from './DemoEventLog.vue'
import DemoShortcuts from './DemoShortcuts.vue'
import DemoStats from './DemoStats.vue'
import DemoStatusPicker from './DemoStatusPicker.vue'

/**
 * La pantalla de la demo, en tres partes.
 *
 * El reparto es por rol y no por estética: a la izquierda **lo que se puede
 * cambiar**, en el medio **lo que se está mirando**, a la derecha **lo que está
 * pasando**. Las tres se ven al mismo tiempo, que es la única forma de que un
 * cambio de control y su efecto en la tabla y en los contadores se lean como un
 * mismo gesto.
 *
 * Este archivo se quedó con el cableado —los datos, los eventos y las
 * respuestas— porque es el que alguien abre para copiar. El formulario vive en
 * `DemoControls.vue`: cuarenta controles en el medio enterrarían el ejemplo.
 */

/**
 * Bitácora en pantalla. Se desestructura para que `eventLog` quede como un ref de
 * nivel superior y el template pueda usarlo sin escribir `.value`.
 */
const { entries: eventLog, push: logEvent } = useDemoLog()

/**
 * Documentación del componente.
 *
 * La demo muestra el comportamiento; el porqué —el slot `#editor`, los agregados,
 * qué índice reporta cada evento— vive en el README y no en esta pantalla.
 *
 * ## Por qué apunta a la raíz y no al README del componente
 *
 * Un enlace a un archivo concreto —`/blob/main/src/README.md`— es una ruta
 * INTERNA del repositorio publicada hacia afuera: se rompe en silencio cada vez
 * que algo se mueve de lugar, y nadie se entera hasta que alguien hace clic y se
 * come un 404. Ya pasó una vez, al mudar la librería a `src/`.
 *
 * La raíz con `#readme` es la misma URL que declara `homepage` en
 * `package.json`, así que hay una sola dirección que mantener, y el README de
 * ahí enlaza al del componente en su segunda línea.
 */
const DOCS_URL = 'https://github.com/jorge-koki/datagrid-vue#readme'

/* ------------------------------------------------------------------ Datos */

const rowCount = shallowRef<number>(ROW_COUNTS[0])

/**
 * El dataset.
 *
 * `shallowRef` y no `ref`: un `ref` profundo envolvería cada fila en un Proxy
 * reactivo, y con 50.000 filas eso son 50.000 proxies creados antes de pintar el
 * primer frame. La tabla no necesita reactividad por fila, solo saber que el
 * array cambió.
 */
const rows = shallowRef<readonly ProjectRow[]>(createProjects(rowCount.value))

/* -------------------------------------------------------- Origen de datos */

/**
 * De dónde salen las filas que ve la tabla.
 *
 * Es el control que hace visible la diferencia entre los dos modos, que por
 * dentro es una sola prop: con `servidor` la tabla recibe `rowCount` y un `rows`
 * con huecos; con `memoria` recibe el dataset entero y `rowCount` sin declarar,
 * y se comporta exactamente como se comportaba antes de que este modo existiera.
 */
const dataSource = shallowRef<'memory' | 'server'>('memory')

/**
 * El dataset disperso: solo lo que el "servidor" ya mandó.
 *
 * Su largo es el total, y sus lugares se llenan a medida que llegan las páginas.
 * Es exactamente lo que haría una aplicación real con la respuesta de su API.
 */
const serverRows = shallowRef<(ProjectRow | undefined)[]>([])

/** Páginas que se pidieron, para mostrar el conteo en el panel de estado. */
const requestedPages = shallowRef(0)

/** Lo que se le pasa a la tabla como `rows`. */
const tableRows = computed<readonly (ProjectRow | undefined)[]>(() =>
  dataSource.value === 'server' ? serverRows.value : rows.value,
)

/**
 * Lo que se le pasa como `rowCount`. `undefined` apaga el modo servidor entero,
 * y esa es toda la diferencia entre los dos caminos.
 */
const tableRowCount = computed<number | undefined>(() =>
  dataSource.value === 'server' ? rows.value.length : undefined,
)

/** Vacía lo cargado. Es el gesto de invalidar: la tabla lo detecta sola. */
function resetServerRows(): void {
  serverRows.value = []
  requestedPages.value = 0
}

// Cambiar de origen o de tamaño del dataset invalida todo lo que se había
// traído: son filas de otra consulta.
watch([dataSource, rows], resetServerRows)

/**
 * La tabla necesita un tramo que `rows` no tiene.
 *
 * Esto es lo único que hay que escribir del lado del consumidor. La tabla ya se
 * encargó de alinear el pedido a la página y de no repetirlo mientras esté en
 * vuelo; acá solo queda traerlo y escribirlo en su lugar.
 *
 * El array se reemplaza en lugar de mutarse: es lo que la tabla observa para
 * repintar, igual que con `editCommit`.
 */
async function onRowsRequest(event: RowsRequestEvent): Promise<void> {
  requestedPages.value += 1
  logEvent('info', `Pidiendo filas ${event.start}–${event.end - 1} al servidor`)

  const page = await fetchRows(rows.value, event.start, event.end)

  // El origen pudo cambiar mientras la respuesta viajaba. Escribir igual
  // metería filas de una consulta vieja en un dataset nuevo.
  if (dataSource.value !== 'server') return

  const next = serverRows.value.slice()
  next.length = rows.value.length
  for (let index = 0; index < page.length; index += 1) {
    next[event.start + index] = page[index]
  }
  serverRows.value = next
}

/* --------------------------------------------------------------- Controles */

const theme = shallowRef<DataTableTheme>('auto')

/**
 * El color principal de la tabla, en vivo.
 *
 * Se escribe como `--ui-primary` y NO como `--dt-primary`, y ahí está lo que la
 * demo quiere mostrar: la librería declara `--dt-primary: var(--ui-primary,
 * #00c16a)`, o sea que su color propio es una indirección sobre el token de la
 * aplicación anfitriona. Definir `--ui-primary` una sola vez, en cualquier
 * ancestro, tiñe la tabla, el selector de columnas y esta pantalla de una sola
 * vez — que es exactamente lo que pasa solo cuando la aplicación ya usa los
 * tokens de NuxtUI v3.
 *
 * Los mismos catorce tokens `--dt-*` se pueden redefinir igual: fondos, bordes,
 * textos, radio. Este control existe porque el color principal es el que se ve
 * en más lugares —selección, foco, casillas, bordes del editor— y por lo tanto
 * el que hace evidente de un vistazo que la tabla es tematizable.
 */
const primaryColor = shallowRef('#00c16a')

const variant = shallowRef<DataTableVariant>('default')
const radiusBorder = shallowRef<DataTableRadius>('none')
const showRowNumbers = shallowRef(true)

/**
 * Los dos gestos de selección en bloque, apagados igual que en el componente.
 *
 * Se exponen juntos porque son la misma idea sobre ejes distintos: apretar el
 * encabezado selecciona la columna entera, apretar el número selecciona la fila
 * entera, y las dos cosas producen un rango normal que se copia con Ctrl+C.
 */
const columnSelection = shallowRef(false)
const rowSelection = shallowRef(false)

/** Mover columnas arrastrando el encabezado. Encendido, igual que el componente. */
const columnReorder = shallowRef(true)
const dense = shallowRef(false)

/**
 * Anillo de foco del viewport, apagado igual que en el componente.
 *
 * Se expone como control porque la diferencia es puramente visual y solo se
 * entiende viéndola: encendido y sin nada seleccionado, entrar con Tab dibuja el
 * anillo alrededor de la tabla; en cuanto se selecciona una celda, el anillo
 * desaparece y la marca queda únicamente en la celda.
 */
const focusRing = shallowRef(false)

/**
 * Visibilidad de columnas, controlada por el padre.
 *
 * Es lo que permite que `DataTableColumnToggle` y la tabla compartan el mismo
 * estado. El orden y los anchos quedan sin controlar: viven dentro del
 * componente y la persistencia los administra sola.
 */
const columnVisibility = shallowRef<ColumnVisibilityState>({})

const table = useTemplateRef<DataTableInstance>('table')
const tableHost = useTemplateRef<HTMLElement>('tableHost')

/* -------------------------------------------------------------- Agrupación */

/**
 * Claves por las que se agrupa, controladas por el padre.
 *
 * Se controla por dos motivos, y ninguno es que la tabla lo necesite: para poder
 * deshabilitar los botones de expandir y colapsar cuando no hay grupos, y para
 * que el desplegable refleje la agrupación que la persistencia restaura al
 * montar. Sin controlar, la tabla agruparía igual.
 */
const groupBy = shallowRef<readonly string[]>([])

/**
 * Puente entre el `<select>`, que maneja un preset, y la tabla, que maneja
 * claves de columna.
 *
 * El `get` recorre el camino inverso a propósito: `groupBy` puede cambiar sin
 * que nadie toque el desplegable —lo escribe la persistencia al montar y lo
 * vacía `resetLayout()`—, así que derivar la opción seleccionada del estado, y
 * no al revés, es lo que mantiene el control sincronizado.
 */
const groupingPreset = computed<GroupingPresetId>({
  get: () => presetIdOf(groupBy.value),
  set: (id) => {
    groupBy.value = groupByOf(id)
  },
})

const grouped = computed(() => groupBy.value.length > 0)

/** Registra cada pliegue. El evento llega tanto desde el clic como desde el teclado. */
function onGroupToggle(event: GroupToggleEvent): void {
  logEvent('group', `${event.groupId} · ${event.expanded ? 'expandido' : 'colapsado'}`)
}

/* --------------------------------------------------------------- Selección */

const selectionMode = shallowRef<SelectionMode>('cell')

/**
 * Celda activa, controlada por el padre.
 *
 * Con `v-model:active-cell` el estado vive acá y se puede mostrar en pantalla.
 * Sin controlar, la tabla lo mantendría internamente y funcionaría igual: se
 * controla solamente para poder exhibirlo.
 */
const activeCell = shallowRef<CellPosition | null>(null)

/**
 * `selectionMode: 'none'` apaga las vías de entrada del usuario, pero no borra
 * una selección ya existente. Se limpia desde acá para que el control haga lo
 * que su etiqueta promete.
 */
watch(selectionMode, (mode) => {
  if (mode === 'none') activeCell.value = null
})

watch(rowCount, (count) => {
  rows.value = createProjects(count)
  // La celda activa apunta a un índice del dataset anterior: al regenerarlo
  // podría quedar fuera de rango. Como acá la selección está controlada, basta
  // con limpiarla.
  activeCell.value = null
  logEvent('info', `Dataset regenerado con ${count.toLocaleString('es-AR')} filas`)
})

/** Un clic simple selecciona; el editor lo abren el doble clic, Enter y F2. */
function onCellSelect(event: CellSelectEvent<ProjectRow>): void {
  logEvent('select', `${event.row.id} · ${event.columnKey} = ${describe(event.value)}`)
}

/**
 * Rango seleccionado, para mostrar su tamaño en el panel de estadísticas.
 *
 * Se guarda el conteo y no el rango: es lo único que la pantalla muestra, y con
 * un arrastre sobre 50.000 filas el evento llega decenas de veces por segundo.
 */
const rangeSize = shallowRef<{ rows: number; columns: number } | null>(null)

/**
 * Cambió el rectángulo seleccionado.
 *
 * `event.range` en `null` significa "quedó una sola celda", que es lo que ya
 * cuenta `cellSelect`: no se registra en la bitácora para no duplicar cada clic.
 */
function onRangeSelect(event: RangeSelectEvent<ProjectRow>): void {
  if (!event.range) {
    rangeSize.value = null
    return
  }
  rangeSize.value = {
    rows: event.rowEnd - event.rowStart + 1,
    columns: event.columns.length,
  }
}

/** El usuario copió. El texto ya está en el portapapeles cuando esto llega. */
function onRangeCopy(event: RangeCopyEvent): void {
  logEvent(
    'info',
    `Copiadas ${event.rowCount} × ${event.columnCount} celdas al portapapeles ` +
      `(${event.text.length} caracteres)`,
  )
}

/**
 * El tema `auto` del componente sigue a una clase del documento y, si no la hay,
 * a `prefers-color-scheme`. Se replica la elección en `<html>` para que la
 * página, el selector de columnas y la tabla queden en el mismo esquema.
 */
watchEffect(() => {
  const classes = document.documentElement.classList
  classes.toggle('dark', theme.value === 'dark')
  classes.toggle('light', theme.value === 'light')
})

/**
 * Restablece el layout guardado.
 *
 * Además de visibilidad, orden y anchos, el componente vacía la agrupación y el
 * conjunto de grupos colapsados. Como acá `groupBy` está controlado, ese vaciado
 * llega por `update:groupBy` y el desplegable vuelve solo a "Sin agrupar".
 */
function resetLayout(): void {
  table.value?.resetLayout()
  logEvent('info', 'Layout restablecido: visibilidad, orden, anchos y agrupación por defecto')
}

function expandAllGroups(): void {
  table.value?.expandAllGroups()
  logEvent('group', 'Todos los grupos expandidos')
}

function collapseAllGroups(): void {
  table.value?.collapseAllGroups()
  logEvent('group', 'Todos los grupos colapsados')
}

/* ------------------------------------------------------ Ciclo de edición */

/** Texto corto de un valor de celda, para la bitácora. */
function describe(value: CellValue): string {
  if (value === null || value === undefined) return '—'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

/**
 * Primer eslabón del ciclo. Es cancelable: llamar a `cancel()` impide que el
 * editor se abra, y entonces no hay `editCommit` ni `afterEdit`.
 */
function onBeforeEdit(event: BeforeEditEvent<ProjectRow>): void {
  if (event.row.locked) {
    event.cancel()
    logEvent('veto', `${event.row.id} está bloqueado · ${event.columnKey} no es editable`)
    return
  }
  logEvent('before', `${event.row.id} · ${event.columnKey}`)
}

/**
 * Único evento que pide escribir.
 *
 * La tabla es CONTROLADA: nunca toca `props.rows`. Si este handler no existiera,
 * la celda volvería a mostrar el valor anterior en el próximo pintado. Se
 * reemplaza la fila y el array en lugar de mutarlos, que es lo que el componente
 * observa para repintar.
 *
 * `event.rowIndex` es el índice dentro de `rows`, también con grupos activos: no
 * es la posición vertical de la celda editada. Indexar con la posición visible
 * escribiría la edición sobre otra fila del dataset.
 */
function onEditCommit(event: EditCommitEvent<ProjectRow>): void {
  const updated = { ...event.row, [event.columnKey]: event.newValue }

  // `event.rowIndex` es el índice del DATASET, y en modo servidor eso es un
  // índice dentro del array disperso: el mismo número sirve para los dos lados.
  if (dataSource.value === 'server') {
    const next = serverRows.value.slice()
    next[event.rowIndex] = updated
    serverRows.value = next
  } else {
    const next = rows.value.slice()
    next[event.rowIndex] = updated
    rows.value = next
  }

  logEvent(
    'commit',
    `${event.row.id} · ${event.columnKey}: ${describe(event.oldValue)} → ${describe(event.newValue)}`,
  )
}

/** Cierra el ciclo. Dispara exactamente una vez por editor abierto, haya commiteado o no. */
function onAfterEdit(event: AfterEditEvent<ProjectRow>): void {
  if (event.canceled) {
    logEvent('cancel', `${event.row.id} · ${event.columnKey} descartado con Escape`)
    return
  }
  logEvent('after', `${event.row.id} · ${event.columnKey} cerrado`)
}
</script>

<template>
  <!--
    Un solo token, y de ahí baja a todo: la tabla, el selector de columnas y la
    propia pantalla. Ver la nota de `primaryColor` arriba.
  -->
  <div class="demo" :data-theme="theme" :style="{ '--ui-primary': primaryColor }">
    <header class="demo-topbar">
      <div class="demo-brand">
        <h1 class="demo-title">datatable-vue</h1>
        <p class="demo-tagline">
          Grilla virtualizada para Vue 3. Vue es dueño de la estructura y de la configuración; un
          pool de nodos DOM reciclados es dueño del camino caliente del scroll.
        </p>
      </div>

      <a class="demo-docs" :href="DOCS_URL" target="_blank" rel="noreferrer">
        Documentación completa
      </a>
    </header>

    <!--
      Las tres partes. En pantallas angostas la grilla colapsa a una sola
      columna y el orden del DOM —controles, tabla, estado— pasa a ser el orden
      de lectura, que es el que corresponde: primero se configura, después se
      mira, al final se revisa qué pasó.
    -->
    <div class="demo-layout">
      <section class="demo-panel demo-panel--controls" aria-labelledby="demo-title-controls">
        <h2 id="demo-title-controls" class="demo-panel-title">Controles</h2>

        <div class="demo-panel-body">
          <DemoControls
            v-model:row-count="rowCount"
            v-model:data-source="dataSource"
            v-model:theme="theme"
            v-model:primary-color="primaryColor"
            v-model:variant="variant"
            v-model:radius-border="radiusBorder"
            v-model:dense="dense"
            v-model:grouping-preset="groupingPreset"
            v-model:selection-mode="selectionMode"
            v-model:column-selection="columnSelection"
            v-model:row-selection="rowSelection"
            v-model:focus-ring="focusRing"
            v-model:show-row-numbers="showRowNumbers"
            v-model:column-reorder="columnReorder"
            v-model:column-visibility="columnVisibility"
            :columns="projectColumns"
            :grouped="grouped"
            @expand-all="expandAllGroups"
            @collapse-all="collapseAllGroups"
            @reset-layout="resetLayout"
          />
        </div>
      </section>

      <section class="demo-panel demo-panel--table" aria-labelledby="demo-title-table">
        <h2 id="demo-title-table" class="demo-panel-title">
          Tabla
          <span class="demo-panel-note">
            {{ rows.length.toLocaleString('es-AR') }} filas en los datos
          </span>
        </h2>

        <div ref="tableHost" class="demo-table">
          <DataTable
            ref="table"
            v-model:column-visibility="columnVisibility"
            v-model:active-cell="activeCell"
            v-model:group-by="groupBy"
            :rows="tableRows"
            :row-count="tableRowCount"
            :columns="projectColumns"
            row-key="id"
            :theme="theme"
            :variant="variant"
            :radius-border="radiusBorder"
            :show-row-numbers="showRowNumbers"
            :column-reorder="columnReorder"
            :column-selection="columnSelection"
            :row-selection="rowSelection"
            :dense="dense"
            :selection-mode="selectionMode"
            :focus-ring="focusRing"
            table-id="demo-projects"
            persist
            bordered
            empty-text="Sin proyectos"
            @cell-select="onCellSelect"
            @range-select="onRangeSelect"
            @range-copy="onRangeCopy"
            @before-edit="onBeforeEdit"
            @edit-commit="onEditCommit"
            @after-edit="onAfterEdit"
            @group-toggle="onGroupToggle"
            @rows-request="onRowsRequest"
          >
            <!--
              Editor por slot. El `v-if` por clave de columna es el patrón que
              corresponde cuando hay más de una columna con `editor: 'slot'`: el slot
              es uno solo para toda la tabla y el consumidor decide qué control
              montar en cada una. El resto está en el README del componente.
            -->
            <template #editor="{ column, value, commit }">
              <DemoStatusPicker
                v-if="column.key === 'status'"
                :value="value"
                :options="column.options ?? []"
                @commit="commit"
              />
            </template>
          </DataTable>
        </div>

        <DemoShortcuts />
      </section>

      <section class="demo-panel demo-panel--state" aria-labelledby="demo-title-state">
        <h2 id="demo-title-state" class="demo-panel-title">Estado</h2>

        <div class="demo-panel-body">
          <DemoStats
            :host="tableHost"
            :row-count="rows.length"
            :active-cell="activeCell"
            :range-size="rangeSize"
            :requested-pages="dataSource === 'server' ? requestedPages : null"
          />

          <h3 class="demo-subtitle">Bitácora de eventos</h3>
          <DemoEventLog :entries="eventLog" />
        </div>
      </section>
    </div>
  </div>
</template>
