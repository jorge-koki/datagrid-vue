<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { CellPosition } from 'vue-tablekit'

/**
 * Medidor de FPS y de nodos realmente presentes en el DOM.
 *
 * Es la instrumentación que hace visible la tesis del componente: al scrollear,
 * la cantidad de filas y celdas pintadas se queda quieta, sin importar cuántas
 * filas tenga el dataset. Un `v-for` sobre las mismas filas haría crecer esos
 * números de forma lineal.
 *
 * ## Por qué el conteo no va por frame
 *
 * `querySelectorAll` recorre el subárbol. Hacerlo en cada frame convertiría al
 * medidor en parte del costo que pretende medir. El contador de FPS sí suma un
 * entero por frame —eso es gratis— y el conteo de nodos se rehace cuatro veces
 * por segundo, que para un número que cambia poco alcanza de sobra.
 */
const props = defineProps<{
  /** Contenedor que envuelve a la tabla. Se cuentan los nodos que hay adentro. */
  host: HTMLElement | null
  /** Cantidad de filas del dataset, para contrastarla con las pintadas. */
  rowCount: number
  /**
   * Celda activa, para que la selección se vea sin abrir las devtools.
   *
   * Su `rowIndex` es una posición de la SECUENCIA VISIBLE. Con agrupación activa
   * cuenta también las cabeceras, así que no coincide con el índice del dataset
   * que reportan `cellSelect` o `editCommit`. Por eso la etiqueta dice
   * "posición" y no "fila".
   */
  activeCell: CellPosition | null
  /**
   * Tamaño del rango seleccionado, o `null` si hay una sola celda.
   *
   * Llega ya reducido a dos números y no como el rango entero: durante un
   * arrastre esto cambia decenas de veces por segundo, y lo único que la
   * pantalla muestra es cuántas celdas abarca.
   */
  rangeSize: { rows: number; columns: number } | null
  /**
   * Páginas que la tabla le pidió al servidor, o `null` en modo memoria.
   *
   * Es el número que hace visible la tesis del modo servidor: con 50.000 filas
   * en el dataset, recorrer la tabla pide una decena de páginas y no cincuenta
   * mil filas.
   */
  requestedPages: number | null
}>()

/** Cada cuántos ms se recalculan FPS y conteos. */
const SAMPLE_INTERVAL = 250

const fps = shallowRef(0)
const paintedRows = shallowRef(0)
const paintedCells = shallowRef(0)
const totalNodes = shallowRef(0)

let frameHandle = 0
let frameCount = 0
let lastSample = 0

function countNodes(): void {
  const host = props.host
  if (!host) return
  paintedRows.value = host.querySelectorAll('.dt-row:not([hidden])').length
  paintedCells.value = host.querySelectorAll('.dt-cell:not([hidden])').length
  totalNodes.value = host.getElementsByTagName('*').length
}

function tick(timestamp: number): void {
  frameHandle = requestAnimationFrame(tick)

  frameCount += 1
  const elapsed = timestamp - lastSample
  if (elapsed < SAMPLE_INTERVAL) return

  fps.value = Math.round((frameCount * 1000) / elapsed)
  frameCount = 0
  lastSample = timestamp
  countNodes()
}

onMounted(() => {
  lastSample = performance.now()
  frameHandle = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (frameHandle !== 0) cancelAnimationFrame(frameHandle)
  frameHandle = 0
})

/** Separador de miles, construido una vez. */
const formatter = new Intl.NumberFormat('en-US')

/** Descripción legible de la celda activa. */
const activeLabel = computed(() => {
  const cell = props.activeCell
  if (!cell) return 'ninguna'
  return `${formatter.format(cell.rowIndex)} · ${cell.columnKey}`
})

/** Descripción legible del rango, con el total de celdas que abarca. */
const rangeLabel = computed(() => {
  const size = props.rangeSize
  if (!size) return 'una celda'
  const cells = size.rows * size.columns
  return `${formatter.format(size.rows)} × ${size.columns} = ${formatter.format(cells)} celdas`
})
</script>

<template>
  <div class="demo-stats">
    <div class="demo-stat">
      <span class="demo-stat-value">{{ fps }}</span>
      <span class="demo-stat-label">fps</span>
    </div>
    <div class="demo-stat">
      <span class="demo-stat-value">{{ formatter.format(props.rowCount) }}</span>
      <span class="demo-stat-label">filas en los datos</span>
    </div>
    <div class="demo-stat">
      <span class="demo-stat-value">{{ paintedRows }}</span>
      <span class="demo-stat-label">filas en el DOM</span>
    </div>
    <div class="demo-stat">
      <span class="demo-stat-value">{{ paintedCells }}</span>
      <span class="demo-stat-label">celdas en el DOM</span>
    </div>
    <div class="demo-stat">
      <span class="demo-stat-value">{{ formatter.format(totalNodes) }}</span>
      <span class="demo-stat-label">nodos totales</span>
    </div>
    <div v-if="props.requestedPages !== null" class="demo-stat">
      <span class="demo-stat-value">{{ props.requestedPages }}</span>
      <span class="demo-stat-label">páginas pedidas</span>
    </div>
    <div class="demo-stat demo-stat--wide">
      <span class="demo-stat-value demo-stat-value--text">{{ activeLabel }}</span>
      <span class="demo-stat-label">celda activa (posición · columna)</span>
    </div>
    <div class="demo-stat demo-stat--wide">
      <span class="demo-stat-value demo-stat-value--text">{{ rangeLabel }}</span>
      <span class="demo-stat-label">selección (arrastrar, o Shift + flechas)</span>
    </div>
  </div>
</template>