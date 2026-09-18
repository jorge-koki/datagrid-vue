<script setup lang="ts">
import { DataTableColumnToggle } from 'vue-tablekit'
import type {
  ColumnVisibilityState,
  DataTableColumn,
  DataTableRadius,
  DataTableTheme,
  DataTableVariant,
  SelectionMode,
} from 'vue-tablekit'
import { ROW_COUNTS } from './data'
import type { ProjectRow } from './data'
import { SERVER_LATENCY } from './server'
import { GROUPING_PRESETS } from './grouping'
import type { GroupingPresetId } from './grouping'

/**
 * Panel de controles: la primera de las tres columnas de la demo.
 *
 * Son las props de la tabla convertidas en formulario. Está separado de
 * `App.vue` por una razón concreta y no por prolijidad: `App.vue` es el ejemplo
 * que alguien copia: cómo se declaran los datos, cómo se cablean los eventos y
 * cómo se responde a `editCommit`. Cuarenta `<select>` en el medio de eso
 * entierran lo que se vino a mirar.
 *
 * ## Por qué un `defineModel` por control y no un objeto de configuración
 *
 * Un solo `v-model` sobre un objeto `settings` sería menos código acá y peor
 * ejemplo allá: cada campo necesitaría un computed escribible para que
 * `v-model` funcione sobre él, y el tipo de lo que viaja quedaría escondido
 * adentro de una interfaz. Con un modelo por control, el nombre y el tipo de
 * cada prop de la tabla se leen en una línea, que es exactamente lo que alguien
 * evaluando la librería viene a averiguar.
 *
 * ## Los grupos son `<fieldset>` de verdad
 *
 * No son `<div>` con un título: un lector de pantalla anuncia la leyenda al
 * entrar en cualquier control del grupo, así que "Compacta" se escucha como
 * "Apariencia, Compacta". Un `<div>` con un `<h3>` al lado no produce eso.
 */
defineProps<{
  /** Columnas ofrecidas al selector de visibilidad. */
  columns: readonly DataTableColumn<ProjectRow>[]
  /** Si hay una agrupación activa. Sin ella, plegar y desplegar no significan nada. */
  grouped: boolean
}>()

const emit = defineEmits<{
  expandAll: []
  collapseAll: []
  resetLayout: []
}>()

/* ------------------------------------------------------------------ Datos */

const rowCount = defineModel<number>('rowCount', { required: true })

/**
 * En memoria o contra un servidor simulado.
 *
 * Es el control que hace visible el modo servidor, que por dentro es una sola
 * prop: declarar `rowCount`. Con él encendido la tabla recibe un `rows` con
 * huecos y pide las páginas que le faltan a medida que se scrollea.
 */
const dataSource = defineModel<'memory' | 'server'>('dataSource', { required: true })

/* ------------------------------------------------------------- Apariencia */

const theme = defineModel<DataTableTheme>('theme', { required: true })

/**
 * Color principal. Por dentro es una sola custom property, `--ui-primary`.
 *
 * Se ofrece además una fila de colores armados porque un `<input type="color">`
 * solo, sin nada al lado, no comunica que ESTO se puede cambiar: hay que abrir
 * el selector del sistema para descubrirlo. Las muestras lo dicen de un vistazo,
 * y el selector queda para el que quiera el suyo exacto.
 */
const primaryColor = defineModel<string>('primaryColor', { required: true })

/** Colores de arranque. El último es el de la librería. */
const PRIMARY_PRESETS = [
  { value: '#00c16a', label: 'Verde (el de la librería)' },
  { value: '#3b82f6', label: 'Azul' },
  { value: '#8b5cf6', label: 'Violeta' },
  { value: '#f43f5e', label: 'Rosa' },
  { value: '#f59e0b', label: 'Ámbar' },
] as const
const variant = defineModel<DataTableVariant>('variant', { required: true })
const radiusBorder = defineModel<DataTableRadius>('radiusBorder', { required: true })
const dense = defineModel<boolean>('dense', { required: true })

/**
 * Alto de fila: el mismo para todas, o uno por fila según la prioridad.
 *
 * Es el control de las alturas variables. Por dentro es la misma prop de
 * siempre, `rowHeight`, con una función en lugar de un número: la tabla no tiene
 * un modo aparte para esto.
 */
const rowHeightMode = defineModel<'fija' | 'prioridad'>('rowHeightMode', { required: true })

/* -------------------------------------------------------------- Agrupación */

const groupingPreset = defineModel<GroupingPresetId>('groupingPreset', { required: true })

/* --------------------------------------------------------------- Selección */

const selectionMode = defineModel<SelectionMode>('selectionMode', { required: true })
const columnSelection = defineModel<boolean>('columnSelection', { required: true })
const rowSelection = defineModel<boolean>('rowSelection', { required: true })
const focusRing = defineModel<boolean>('focusRing', { required: true })

/**
 * La cruz de la celda activa, apagada igual que en el componente.
 *
 * Se expone como control porque lo que aporta solo se entiende con la tabla
 * scrolleada: encendida, marcá una celda y andá hasta el otro extremo: el
 * encabezado y la regleta siguen diciendo en qué columna y en qué fila estabas.
 */
const crosshair = defineModel<boolean>('crosshair', { required: true })

/* ---------------------------------------------------------------- Columnas */

const showRowNumbers = defineModel<boolean>('showRowNumbers', { required: true })
const columnReorder = defineModel<boolean>('columnReorder', { required: true })
const columnVisibility = defineModel<ColumnVisibilityState>('columnVisibility', { required: true })
</script>

<template>
  <div class="demo-controls">
    <fieldset class="demo-group">
      <legend class="demo-group-title">Datos</legend>

      <label class="demo-field">
        <span>Filas</span>
        <select v-model.number="rowCount">
          <option v-for="count in ROW_COUNTS" :key="count" :value="count">
            {{ count.toLocaleString('es-AR') }}
          </option>
        </select>
      </label>

      <label class="demo-field">
        <span>Origen</span>
        <select v-model="dataSource">
          <option value="memory">En memoria</option>
          <option value="server">Servidor (simulado)</option>
        </select>
      </label>

      <!--
        La demora es lo que hace visible el marcador de carga. Sin ella la página
        llegaría en el mismo tick del pedido y no habría nada que mirar.
      -->
      <p v-if="dataSource === 'server'" class="demo-field-note">
        Se piden <strong>50 filas</strong> por vez, con {{ SERVER_LATENCY }}ms de demora. Scrolleá
        rápido para ver los marcadores, y mirá la bitácora.
      </p>
    </fieldset>

    <fieldset class="demo-group">
      <legend class="demo-group-title">Apariencia</legend>

      <label class="demo-field">
        <span>Tema</span>
        <select v-model="theme">
          <option value="light">Claro</option>
          <option value="dark">Oscuro</option>
          <option value="auto">Automático</option>
        </select>
      </label>

      <div class="demo-field demo-field--stacked">
        <span>Color principal</span>
        <div class="demo-swatches">
          <button
            v-for="preset in PRIMARY_PRESETS"
            :key="preset.value"
            type="button"
            class="demo-swatch"
            :class="{ 'demo-swatch--on': primaryColor === preset.value }"
            :style="{ background: preset.value }"
            :title="preset.label"
            :aria-label="preset.label"
            :aria-pressed="primaryColor === preset.value"
            @click="primaryColor = preset.value"
          />
          <!--
            El nativo, para cualquier otro color. Va al final porque es la
            salida de escape, no la opción principal.
          -->
          <input
            v-model="primaryColor"
            type="color"
            class="demo-swatch demo-swatch--picker"
            aria-label="Elegir otro color"
            title="Elegir otro color"
          />
        </div>
      </div>

      <label class="demo-field">
        <span>Estilo</span>
        <select v-model="variant">
          <option value="default">Predeterminado</option>
          <option value="cells">Celdas</option>
        </select>
      </label>

      <label class="demo-field">
        <span>Redondeo</span>
        <select v-model="radiusBorder">
          <option value="none">Sin redondeo</option>
          <option value="sm">sm</option>
          <option value="md">md (tema)</option>
          <option value="lg">lg</option>
          <option value="xl">xl</option>
        </select>
      </label>

      <label class="demo-field demo-field--inline">
        <input v-model="dense" type="checkbox" />
        <span>Compacta</span>
      </label>

      <label class="demo-field">
        <span>Alto de fila</span>
        <select v-model="rowHeightMode">
          <option value="fija">Igual para todas</option>
          <option value="prioridad">Según la prioridad</option>
        </select>
      </label>

      <p v-if="rowHeightMode === 'prioridad'" class="demo-field-note">
        Crítica <strong>88px</strong>, alta <strong>64px</strong>, el resto el alto normal. Mirá que
        la selección, el editor y la regleta acompañan cada alto.
      </p>
    </fieldset>

    <fieldset class="demo-group">
      <legend class="demo-group-title">Agrupación</legend>

      <label class="demo-field">
        <span>Agrupar</span>
        <select v-model="groupingPreset">
          <option v-for="preset in GROUPING_PRESETS" :key="preset.id" :value="preset.id">
            {{ preset.label }}
          </option>
        </select>
      </label>

      <div class="demo-actions">
        <button type="button" class="demo-button" :disabled="!grouped" @click="emit('expandAll')">
          Expandir todo
        </button>
        <button type="button" class="demo-button" :disabled="!grouped" @click="emit('collapseAll')">
          Colapsar todo
        </button>
      </div>
    </fieldset>

    <fieldset class="demo-group">
      <legend class="demo-group-title">Selección</legend>

      <label class="demo-field">
        <span>Modo</span>
        <select v-model="selectionMode">
          <option value="cell">Celda</option>
          <option value="row">Fila</option>
          <option value="none">Ninguna</option>
        </select>
      </label>

      <label class="demo-field demo-field--inline">
        <input v-model="columnSelection" type="checkbox" />
        <span>Seleccionar columna</span>
      </label>

      <!--
        Seleccionar una fila entera se hace apretando su número, así que sin
        regleta el gesto no tiene dónde ocurrir. El control se deshabilita en
        lugar de ocultarse: comunica la dependencia en vez de desaparecer.
      -->
      <label class="demo-field demo-field--inline">
        <input v-model="rowSelection" type="checkbox" :disabled="!showRowNumbers" />
        <span>Seleccionar fila</span>
      </label>

      <label class="demo-field demo-field--inline">
        <input v-model="focusRing" type="checkbox" />
        <span>Anillo de foco</span>
      </label>

      <label class="demo-field demo-field--inline">
        <input v-model="crosshair" type="checkbox" />
        <span>Cruz de la celda activa</span>
      </label>

      <p v-if="crosshair" class="demo-field-note">
        Una línea bajo el encabezado de la columna y otra al costado del número de fila. Marcá una
        celda y scrolleá lejos: las dos siguen a la vista.
      </p>
    </fieldset>

    <fieldset class="demo-group">
      <legend class="demo-group-title">Columnas</legend>

      <label class="demo-field demo-field--inline">
        <input v-model="showRowNumbers" type="checkbox" />
        <span>Numeración</span>
      </label>

      <label class="demo-field demo-field--inline">
        <input v-model="columnReorder" type="checkbox" />
        <span>Mover columnas</span>
      </label>

      <div class="demo-actions">
        <DataTableColumnToggle v-model="columnVisibility" :columns="columns" label="Columnas" />
        <button type="button" class="demo-button" @click="emit('resetLayout')">
          Restablecer layout
        </button>
      </div>
    </fieldset>
  </div>
</template>
