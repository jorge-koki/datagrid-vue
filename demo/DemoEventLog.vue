<script setup lang="ts">
import type { DemoLogEntry } from './log'

/**
 * Bitácora de eventos de selección, edición y agrupación.
 *
 * Existe para que el orden del ciclo sea visible y no haya que creerlo:
 * `cellSelect` al mover la selección, `beforeEdit` primero al editar (y su veto,
 * cuando la fila está bloqueada), después `editCommit` solo si el valor cambió de
 * verdad, y `afterEdit` siempre al final. `groupToggle` se suma a la misma lista
 * al plegar o desplegar un grupo.
 */
defineProps<{
  entries: readonly DemoLogEntry[]
}>()
</script>

<template>
  <div class="demo-log">
    <p v-if="entries.length === 0" class="demo-log-empty">
      Un clic selecciona una celda; un doble clic la edita. Las filas marcadas como
      <strong>Bloqueado</strong> rechazan la edición desde <code>beforeEdit</code>. Plegar un grupo
      también deja su rastro aquí.
    </p>
    <ul v-else class="demo-log-list">
      <li v-for="entry in entries" :key="entry.id" class="demo-log-item">
        <span class="demo-log-kind" :data-kind="entry.kind">{{ entry.kind }}</span>
        <span class="demo-log-message">{{ entry.message }}</span>
        <span class="demo-log-time">{{ entry.time }}</span>
      </li>
    </ul>
  </div>
</template>
