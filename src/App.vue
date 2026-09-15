<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch, watchEffect } from 'vue'
// En una aplicación consumidora esta línea sería
// `import { DataTable, DataTableColumnToggle } from 'datagrid-vue'`
// más `import 'datagrid-vue/style.css'`. Dentro de este repositorio el
// componente se importa por ruta y la hoja de estilos viaja con el SFC.
import { DataTable, DataTableColumnToggle } from '@/components/ui/datatable'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellPosition,
  CellSelectEvent,
  CellValue,
  ColumnVisibilityState,
  DataTableInstance,
  DataTableTheme,
  EditCommitEvent,
  GroupToggleEvent,
  SelectionMode,
} from '@/components/ui/datatable'
import { createProjects } from './demo/data'
import type { ProjectRow } from './demo/data'
import { projectColumns } from './demo/columns'
import { GROUPING_PRESETS, groupByOf, presetIdOf } from './demo/grouping'
import type { GroupingPresetId } from './demo/grouping'
import { useDemoLog } from './demo/log'
import DemoEventLog from './demo/DemoEventLog.vue'
import DemoStats from './demo/DemoStats.vue'
import './demo/demo.css'

/**
 * Bitácora en pantalla. Se desestructura para que `eventLog` quede como un ref de
 * nivel superior y el template pueda usarlo sin escribir `.value`.
 */
const { entries: eventLog, push: logEvent } = useDemoLog()

/* ------------------------------------------------------------------ Datos */

/** Tamaños ofrecidos. El primero es el que se carga al abrir la página. */
const ROW_COUNTS = [100, 1_000, 10_000, 50_000] as const

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

/* --------------------------------------------------------------- Controles */

const theme = shallowRef<DataTableTheme>('auto')
const dense = shallowRef(false)

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
  const next = rows.value.slice()
  next[event.rowIndex] = { ...event.row, [event.columnKey]: event.newValue }
  rows.value = next

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
  <main class="demo" :data-theme="theme">
    <header class="demo-header">
      <h1>DataTable</h1>
      <p>
        Una grilla virtualizada para Vue 3. Vue es dueño de la estructura y de la configuración; un
        pool de nodos DOM reciclados es dueño del camino caliente del scroll. Al cambiar la cantidad
        de filas, los contadores de nodos se quedan quietos mientras el dataset crece 500×.
      </p>
    </header>

    <section class="demo-toolbar" aria-label="Controles de la demo">
      <label class="demo-field">
        <span>Filas</span>
        <select v-model.number="rowCount">
          <option v-for="count in ROW_COUNTS" :key="count" :value="count">
            {{ count.toLocaleString('es-AR') }}
          </option>
        </select>
      </label>

      <label class="demo-field">
        <span>Tema</span>
        <select v-model="theme">
          <option value="light">Claro</option>
          <option value="dark">Oscuro</option>
          <option value="auto">Automático</option>
        </select>
      </label>

      <label class="demo-field">
        <span>Selección</span>
        <select v-model="selectionMode">
          <option value="cell">Celda</option>
          <option value="row">Fila</option>
          <option value="none">Ninguna</option>
        </select>
      </label>

      <label class="demo-field">
        <span>Agrupar</span>
        <select v-model="groupingPreset">
          <option v-for="preset in GROUPING_PRESETS" :key="preset.id" :value="preset.id">
            {{ preset.label }}
          </option>
        </select>
      </label>

      <button type="button" class="demo-button" :disabled="!grouped" @click="expandAllGroups">
        Expandir todo
      </button>

      <button type="button" class="demo-button" :disabled="!grouped" @click="collapseAllGroups">
        Colapsar todo
      </button>

      <label class="demo-field demo-field--inline">
        <input v-model="dense" type="checkbox" />
        <span>Compacta</span>
      </label>

      <DataTableColumnToggle
        v-model="columnVisibility"
        :columns="projectColumns"
        label="Columnas"
      />

      <button type="button" class="demo-button" @click="resetLayout">Restablecer layout</button>
    </section>

    <p class="demo-hint">
      Un clic selecciona una celda; desde ahí se navega con <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd>
      <kbd>→</kbd>, <kbd>Tab</kbd>, <kbd>Inicio</kbd> / <kbd>Fin</kbd>, <kbd>Ctrl</kbd>+<kbd
        >Inicio</kbd
      >
      / <kbd>Fin</kbd> y <kbd>RePág</kbd> / <kbd>AvPág</kbd>. Para editar: doble clic,
      <kbd>Enter</kbd> o <kbd>F2</kbd>, o directamente empezar a escribir. <kbd>Esc</kbd> descarta
      la edición y conserva la selección. Sobre una cabecera de grupo, <kbd>Enter</kbd> y
      <kbd>Espacio</kbd> la pliegan, <kbd>→</kbd> la abre y <kbd>←</kbd> la cierra.
    </p>

    <p v-if="grouped" class="demo-note">
      Con agrupación activa, el contador de filas en el DOM y la posición de la celda activa cuentan
      entradas de la <strong>vista aplanada</strong>: cada cabecera de grupo ocupa una fila propia y
      un grupo colapsado esconde a las suyas. El contador de filas en los datos sigue siendo el
      tamaño del dataset, que es lo que no cambia al plegar nada.
    </p>

    <div ref="tableHost" class="demo-table">
      <DataTable
        ref="table"
        v-model:column-visibility="columnVisibility"
        v-model:active-cell="activeCell"
        v-model:group-by="groupBy"
        :rows="rows"
        :columns="projectColumns"
        row-key="id"
        :theme="theme"
        :dense="dense"
        :selection-mode="selectionMode"
        table-id="demo-projects"
        persist
        stripe
        bordered
        empty-text="Sin proyectos"
        @cell-select="onCellSelect"
        @before-edit="onBeforeEdit"
        @edit-commit="onEditCommit"
        @after-edit="onAfterEdit"
        @group-toggle="onGroupToggle"
      />
    </div>

    <section class="demo-panels">
      <DemoStats :host="tableHost" :row-count="rows.length" :active-cell="activeCell" />
      <DemoEventLog :entries="eventLog" />
    </section>
  </main>
</template>
