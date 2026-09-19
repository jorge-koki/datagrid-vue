<script setup lang="ts">
 /**
 * Atajos y gestos, al pie del panel de la tabla.
 *
 * ## Por qué un `<details>` y no tres párrafos sueltos
 *
 * La lista entera ocupa más alto que el panel de controles, y en una demo lo que
 * hay que ver es la tabla. Pero cerrarla del todo dejaría a quien llega sin
 * saber que se puede arrastrar para seleccionar un bloque, que es justamente uno
 * de los gestos que conviene mostrar.
 *
 * El `<summary>` resuelve las dos cosas: la línea siempre visible ya enseña los
 * cuatro gestos principales, y el detalle queda a un clic. Es un elemento
 * nativo, así que el plegado funciona con teclado y los lectores de pantalla lo
 * anuncian como lo que es, sin una línea de JavaScript.
 */
</script>

<template>
  <details class="demo-shortcuts">
    <summary class="demo-shortcuts-summary">
      Un clic selecciona · doble clic o <kbd>Enter</kbd> edita · arrastrar marca un bloque ·
      <kbd>Ctrl</kbd>+<kbd>C</kbd> lo copia
      <span class="demo-shortcuts-more">ver todos los atajos</span>
    </summary>

    <div class="demo-shortcuts-body">
      <p>
        <strong>Navegar.</strong> Desde una celda seleccionada: <kbd>↑</kbd> <kbd>↓</kbd>
        <kbd>←</kbd> <kbd>→</kbd>, <kbd>Tab</kbd>, <kbd>Inicio</kbd> / <kbd>Fin</kbd>,
        <kbd>Ctrl</kbd>+<kbd>Inicio</kbd> / <kbd>Fin</kbd> y <kbd>RePág</kbd> / <kbd>AvPág</kbd>.
      </p>

      <p>
        <strong>Editar.</strong> Doble clic, <kbd>Enter</kbd> o <kbd>F2</kbd>, o directamente
        empezar a escribir. <kbd>Esc</kbd> descarta la edición y conserva la selección.
      </p>

      <p>
        <strong>Seleccionar un bloque.</strong> Arrastrar desde una celda, o <kbd>Shift</kbd>+clic,
        o <kbd>Shift</kbd> con las flechas; <kbd>Ctrl</kbd>+<kbd>A</kbd> selecciona todo. Con
        <kbd>Ctrl</kbd>+<kbd>C</kbd> el bloque va al portapapeles con el texto que se ve —la
        etiqueta del estado, el importe con separadores— y se pega derecho en una hoja de cálculo.
      </p>

      <p>
        <strong>Grupos.</strong> Sobre una cabecera de grupo, <kbd>Enter</kbd> y
        <kbd>Espacio</kbd> la pliegan, <kbd>→</kbd> la abre y <kbd>←</kbd> la cierra.
      </p>
    </div>
  </details>
</template>
