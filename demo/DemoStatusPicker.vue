<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import type { CellOption, CellValue } from 'datatable-vue'

/**
 * Desplegable propio, montado desde el slot `#editor` de la tabla.
 *
 * Existe para ocupar el lugar que en una aplicación real ocuparía el componente
 * de un design system —un `<USelect>` de NuxtUI, por ejemplo—. Esta demo no
 * declara ninguna dependencia de UI, así que el sustituto se escribe a mano: lo
 * que importa no es este control sino DÓNDE vive.
 *
 * ## Una instancia, no una por celda
 *
 * La tabla monta el contenido del slot cuando se abre el editor y lo desmonta
 * cuando se cierra, y solo puede haber una celda abierta a la vez. Con 50.000
 * filas cargadas, este componente existe como mucho una vez: el contador de
 * nodos del panel de estadísticas no se mueve al abrirlo.
 *
 * ## Lo que NO hace
 *
 * No escribe sobre la fila. Emite `commit` con el valor elegido y la tabla lo
 * publica por su tubería de siempre —`afterEdit` y, si el valor cambió,
 * `editCommit`—, que es donde la demo actualiza su dataset. Tampoco maneja
 * Escape: el editor ya lo cancela desde la caja que envuelve a este componente.
 */
const props = defineProps<{
  /** Valor con el que se abrió el editor. */
  value: CellValue
  /** Conjunto cerrado de valores posibles, tal como lo declara la columna. */
  options: readonly CellOption[]
}>()

const emit = defineEmits<{
  /** El usuario eligió una opción. */
  commit: [CellValue]
}>()

/**
 * Posición resaltada por el teclado.
 *
 * Arranca sobre la opción vigente para que la primera flecha se mueva desde
 * donde está el dato y no desde el principio de la lista. Si el valor no
 * corresponde a ninguna opción —un estado que la UI todavía no conoce— se
 * empieza por la primera en lugar de dejar la lista sin referencia.
 */
function indexOfValue(): number {
  const found = props.options.findIndex((option) => option.value === props.value)
  return found < 0 ? 0 : found
}

const highlighted = shallowRef(indexOfValue())

// El editor se reutiliza entre celdas sin desmontarse mientras el slot siga
// abierto sobre la misma columna, así que el resaltado tiene que seguir al valor.
watch(
  () => props.value,
  () => {
    highlighted.value = indexOfValue()
  },
)

/** Mueve el resaltado sin dar la vuelta, igual que las flechas de la grilla. */
function move(delta: number): void {
  const last = props.options.length - 1
  if (last < 0) return
  highlighted.value = Math.min(Math.max(highlighted.value + delta, 0), last)
}

function choose(index: number): void {
  const option = props.options[index]
  if (!option) return
  emit('commit', option.value)
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    choose(highlighted.value)
  }
}
</script>

<template>
  <div
    class="demo-picker"
    role="listbox"
    tabindex="0"
    aria-label="Elegir estado"
    @keydown="onKeyDown"
  >
    <div
      v-for="(option, index) in props.options"
      :key="String(option.value)"
      class="demo-picker-option"
      :class="{ 'demo-picker-option--highlighted': index === highlighted }"
      role="option"
      :aria-selected="option.value === props.value"
      @pointerdown.prevent="choose(index)"
    >
      <span class="demo-picker-dot" :style="{ background: option.color ?? 'currentColor' }" />
      <span class="demo-picker-label">{{ option.label }}</span>
    </div>
  </div>
</template>
