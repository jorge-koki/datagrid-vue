<script setup lang="ts">
import type { DemoLogEntry } from './log'

/**
 * Bitácora de eventos de edición.
 *
 * Existe para que el orden del ciclo sea visible y no haya que creerlo:
 * `beforeEdit` primero (y su veto, cuando la fila está bloqueada), después
 * `editCommit` solo si el valor cambió de verdad, y `afterEdit` siempre al final.
 */
defineProps<{
  entries: readonly DemoLogEntry[]
}>()
</script>

<template>
  <div class="demo-log">
    <p v-if="entries.length === 0" class="demo-log-empty">
      Double-click a cell to edit it. Rows marked <strong>Locked</strong> reject the edit from
      <code>beforeEdit</code>.
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
