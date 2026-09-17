<script setup lang="ts" generic="TRow">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { ColumnVisibilityState, DataTableColumn } from './types'
// Se importa la misma hoja que la tabla: el bundler la deduplica, y así el
// selector se puede usar solo, sin montar un DataTable.
import './styles/datatable.css'

/**
 * Selector de columnas visibles.
 *
 * Componente opcional: la tabla funciona sin él, pero casi toda aplicación que
 * habilita `columnVisibility` necesita alguna UI para manejarlo, y escribirla de
 * cero cada vez es trabajo repetido.
 *
 * ## La última columna visible no se puede ocultar
 *
 * Una tabla sin columnas no es una preferencia del usuario, es un estado roto:
 * queda un rectángulo vacío sin forma de recuperarse salvo limpiando el
 * almacenamiento. El checkbox de la última columna visible se deshabilita, lo
 * que además comunica el límite en vez de rechazar el click en silencio.
 *
 * ## Accesibilidad
 *
 * Los checkboxes son `<input type="checkbox">` reales, así que el soporte de
 * teclado y de lectores de pantalla es el nativo. Encima de eso: Escape cierra,
 * las flechas mueven el foco entre opciones y un click afuera cierra el panel.
 */
const props = withDefaults(
  defineProps<{
    /** Columnas ofrecidas. Solo se listan las que tienen `hideable !== false`. */
    columns: readonly DataTableColumn<TRow>[]
    /** Estado de visibilidad. Se usa con `v-model`. */
    modelValue: ColumnVisibilityState
    /** Texto del botón que abre el panel. */
    label?: string
  }>(),
  {
    label: 'Columns',
  },
)

const emit = defineEmits<{
  'update:modelValue': [ColumnVisibilityState]
}>()

const open = shallowRef(false)
const rootEl = shallowRef<HTMLElement | null>(null)
const panelEl = shallowRef<HTMLElement | null>(null)

/** Resuelve la visibilidad de una columna con la misma regla que la tabla. */
function isVisible(column: DataTableColumn<TRow>): boolean {
  const explicit = props.modelValue[column.key]
  if (typeof explicit === 'boolean') return explicit
  return column.defaultVisible ?? true
}

/** Columnas que el usuario puede alternar. */
const toggleableColumns = computed(() =>
  props.columns.filter((column) => column.hideable !== false),
)

/**
 * Cuántas columnas hay visibles en total.
 *
 * Cuenta sobre TODAS las columnas, no solo las alternables: una columna fijada
 * con `hideable: false` sigue siendo una columna visible y basta para que la
 * tabla no quede vacía.
 */
const visibleCount = computed(() => props.columns.filter((column) => isVisible(column)).length)

/** Cantidad de columnas alternables que están ocultas. */
const hiddenCount = computed(
  () => toggleableColumns.value.filter((column) => !isVisible(column)).length,
)

/** `true` si ocultar esta columna dejaría la tabla sin ninguna. */
function isLastVisible(column: DataTableColumn<TRow>): boolean {
  return isVisible(column) && visibleCount.value <= 1
}

function toggleColumn(column: DataTableColumn<TRow>): void {
  if (isLastVisible(column)) return
  emit('update:modelValue', { ...props.modelValue, [column.key]: !isVisible(column) })
}

function showAll(): void {
  const next: Record<string, boolean> = { ...props.modelValue }
  for (const column of toggleableColumns.value) next[column.key] = true
  emit('update:modelValue', next)
}

function close(): void {
  open.value = false
}

function toggleOpen(): void {
  open.value = !open.value
}

/**
 * Mueve el foco entre opciones con las flechas.
 *
 * Los inputs se buscan en el DOM en lugar de mantenerse en un array de refs: el
 * panel tiene un puñado de nodos, corre solo ante una tecla y así no hay una
 * lista paralela que pueda desincronizarse del render.
 */
function onPanelKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

  const panel = panelEl.value
  if (!panel) return

  const inputs: HTMLInputElement[] = []
  for (const node of panel.querySelectorAll('input[type="checkbox"]')) {
    if (node instanceof HTMLInputElement) inputs.push(node)
  }
  if (inputs.length === 0) return

  const active = document.activeElement
  const currentIndex = inputs.findIndex((input) => input === active)
  const delta = event.key === 'ArrowDown' ? 1 : -1
  // Con nada enfocado, ArrowDown entra por la primera opción y ArrowUp por la
  // última, que es lo que espera quien navega solo con teclado.
  const nextIndex =
    currentIndex === -1
      ? delta === 1
        ? 0
        : inputs.length - 1
      : (currentIndex + delta + inputs.length) % inputs.length

  const next = inputs[nextIndex]
  if (!next) return
  event.preventDefault()
  next.focus()
}

/** Cierra al hacer click fuera del componente. */
function onDocumentPointerDown(event: PointerEvent): void {
  if (!open.value) return
  const root = rootEl.value
  if (!root) return
  const target = event.target
  if (target instanceof Node && root.contains(target)) return
  close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})
</script>

<template>
  <div ref="rootEl" class="dt-toggle">
    <button
      type="button"
      class="dt-toggle-button"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="toggleOpen"
      @keydown.escape="close"
    >
      <span>{{ label }}</span>
      <span v-if="hiddenCount > 0" class="dt-toggle-badge">{{ hiddenCount }}</span>
    </button>

    <div v-if="open" ref="panelEl" class="dt-toggle-panel" @keydown="onPanelKeyDown">
      <ul class="dt-toggle-list">
        <li v-for="column in toggleableColumns" :key="column.key" class="dt-toggle-item">
          <label class="dt-toggle-option" :class="{ 'is-locked': isLastVisible(column) }">
            <input
              type="checkbox"
              class="dt-toggle-checkbox"
              :checked="isVisible(column)"
              :disabled="isLastVisible(column)"
              @change="toggleColumn(column)"
            />
            <span class="dt-toggle-label">{{ column.label ?? column.key }}</span>
          </label>
        </li>
      </ul>

      <div class="dt-toggle-footer">
        <button
          type="button"
          class="dt-toggle-action"
          :disabled="hiddenCount === 0"
          @click="showAll"
        >
          Show all
        </button>
      </div>
    </div>
  </div>
</template>
