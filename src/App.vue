<script setup lang="ts">
import { shallowRef, useTemplateRef, watch, watchEffect } from 'vue'
// En una aplicación consumidora esta línea sería
// `import { DataTable, DataTableColumnToggle } from 'datagrid-vue'`
// más `import 'datagrid-vue/style.css'`. Dentro de este repositorio el
// componente se importa por ruta y la hoja de estilos viaja con el SFC.
import { DataTable, DataTableColumnToggle } from '@/components/ui/datatable'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellValue,
  ColumnVisibilityState,
  DataTableInstance,
  DataTableTheme,
  EditCommitEvent,
} from '@/components/ui/datatable'
import { createProjects } from './demo/data'
import type { ProjectRow } from './demo/data'
import { projectColumns } from './demo/columns'
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

watch(rowCount, (count) => {
  rows.value = createProjects(count)
  logEvent('info', `Regenerated dataset with ${count.toLocaleString('en-US')} rows`)
})

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

function resetLayout(): void {
  table.value?.resetLayout()
  logEvent('info', 'Layout reset: visibility, order and widths back to defaults')
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
    logEvent('veto', `${event.row.id} is locked · ${event.columnKey} not editable`)
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
    logEvent('cancel', `${event.row.id} · ${event.columnKey} discarded with Escape`)
    return
  }
  logEvent('after', `${event.row.id} · ${event.columnKey} closed`)
}
</script>

<template>
  <main class="demo" :data-theme="theme">
    <header class="demo-header">
      <h1>DataTable</h1>
      <p>
        A virtualized Vue 3 table. Vue owns the structure and the config; a recycled DOM node pool
        owns the scroll hot path. Change the row count and watch the node counters stay flat.
      </p>
    </header>

    <section class="demo-toolbar" aria-label="Demo controls">
      <label class="demo-field">
        <span>Rows</span>
        <select v-model.number="rowCount">
          <option v-for="count in ROW_COUNTS" :key="count" :value="count">
            {{ count.toLocaleString('en-US') }}
          </option>
        </select>
      </label>

      <label class="demo-field">
        <span>Theme</span>
        <select v-model="theme">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="auto">Auto</option>
        </select>
      </label>

      <label class="demo-field demo-field--inline">
        <input v-model="dense" type="checkbox" />
        <span>Dense</span>
      </label>

      <DataTableColumnToggle v-model="columnVisibility" :columns="projectColumns" />

      <button type="button" class="demo-button" @click="resetLayout">Reset layout</button>
    </section>

    <div ref="tableHost" class="demo-table">
      <DataTable
        ref="table"
        v-model:column-visibility="columnVisibility"
        :rows="rows"
        :columns="projectColumns"
        row-key="id"
        :theme="theme"
        :dense="dense"
        table-id="demo-projects"
        persist
        stripe
        bordered
        empty-text="No projects"
        @before-edit="onBeforeEdit"
        @edit-commit="onEditCommit"
        @after-edit="onAfterEdit"
      />
    </div>

    <section class="demo-panels">
      <DemoStats :host="tableHost" :row-count="rows.length" />
      <DemoEventLog :entries="eventLog" />
    </section>
  </main>
</template>
