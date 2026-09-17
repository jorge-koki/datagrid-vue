# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen
[Versionado Semántico](https://semver.org/lang/es/).

Mientras la versión mayor sea `0`, un cambio incompatible sube la **minor**. La superficie que cuenta
como pública es exactamente la que exporta [`src/index.ts`](./src/index.ts): lo que está bajo
`internal/` y los composables pueden cambiar en cualquier versión sin aviso.

## [0.1.2] — 2026-09-17

### Arreglado

- **La tabla avisa cuando el contenedor no le da altura.** `.dt-root` la toma del contenedor, y sin
  ella no fallaba de forma visible: pintaba el encabezado, dejaba la barra de scroll y mostraba una
  sola fila. Peor, el síntoma dependía de `showRowNumbers`: con la regleta encendida, su alto inline
  le daba alto de contenido al viewport y la tabla "andaba" de casualidad; apagarla la vaciaba. Ahora
  avisa una vez por consola, y no avisa cuando la tabla solo está oculta.

### Documentación

- **Dónde se declaran los tokens del tema.** El ejemplo anterior —`--dt-primary` sobre un contenedor
  cualquiera— **no funciona**: `.dt-root` se declara esos tokens a sí misma y una declaración en el
  elemento le gana a un valor heredado. Van sobre `.dt-root`, o como `--ui-*` en cualquier ancestro.
- Sección propia sobre la altura del contenedor, con las dos formas de dársela.

## [0.1.1] — 2026-09-17

### Cambiado

- La portada del repositorio se queda con lo indispensable: qué es, cómo se ve usarlo y dónde está la
  documentación. Lo de contribuir —correr la demo, la estructura, los scripts, cómo publicar— se
  muda a `CONTRIBUTING.md`.

Nada de código cambia respecto de la `0.1.0`. La versión existe porque **el README que muestra npm es
una foto del momento de publicar**: no se actualiza solo, y corregir la portada del registro solo
llega con una versión nueva.

## [0.1.0] — 2026-09-17

Primera versión publicada.

### Agregado

- **Grilla virtualizada en los dos ejes**, con un pool de nodos DOM reciclados fuera del render de
  Vue. El cálculo de la ventana es O(1) y repintar con entradas idénticas produce cero escrituras en
  el DOM.
- **Selección por celda y por fila** con navegación completa de teclado, y **selección de un rango**
  con arrastre, `Shift`+clic y `Shift`+flechas. `Ctrl`+`C` copia el rango como TSV con el texto que
  se ve.
- **Selección en bloque** de una columna entera (`columnSelection`) y de una fila entera
  (`rowSelection`).
- **Edición en línea** con el ciclo cancelable `beforeEdit` → `editCommit` → `afterEdit`, y un slot
  `#editor` con una sola instancia viva a la vez.
- **Agrupación multinivel con agregados** plegables, cinco agregaciones incluidas y funciones
  propias. `groupId` se exporta como constructor del identificador de un grupo.
- **Modo servidor con scroll infinito.** `rowCount` declara cuántas filas tiene el dataset entero y
  deja que `rows` tenga huecos; la tabla emite `rowsRequest` con el tramo que necesita, alineado a
  `pageSize` (50 por defecto) y con `prefetchPages` de adelanto. Una página se pide una sola vez, y
  `refreshRows()` es la vía para reintentar. Las filas que no llegaron se pintan como marcador.
- **Ocho renderers de celda** incluidos, más un registro para los propios que avisa una sola vez ante
  un nombre desconocido.
- **Columnas anclables** a los bordes con `pinned: 'start' | 'end'`, **redimensionables**,
  **ocultables** y **reordenables** arrastrando el encabezado.
- **Persistencia del layout** —visibilidad, orden, anchos, agrupación— con reconciliación contra las
  columnas que existen hoy, y adaptador de almacenamiento reemplazable.
- **Regleta de numeración de filas** (`showRowNumbers`) y **`DataTableColumnToggle`**, el selector de
  columnas visibles.
- **Temas claro / oscuro / automático** mediante custom properties `--dt-*`, con preset `dense` y
  adopción de los tokens de NuxtUI v3.
- **Estructura ARIA de grilla completa**, `treegrid` cuando hay agrupación activa.

### Notas de diseño que conviene conocer antes de usarlo

- El encabezado, la regleta y las columnas ancladas se sostienen con `position: sticky` dentro del
  contenedor que scrollea, no con una compensación escrita desde `requestAnimationFrame`. Esa
  compensación se compone un frame tarde y se ve como temblor; el módulo de scroll no escribe una
  sola propiedad en el DOM.
- Una línea de **2px** marca el corte entre el bloque anclado y el que scrollea, contra el 1px de
  cualquier otra separación de celda.
- La librería **no pinta filas alternas**. `stripe` aplica la clase `.dt-row--stripe` y el color
  queda para la hoja de estilos del consumidor: en una tabla con columnas ancladas, una banda que
  cruza el corte y una que se interrumpe en él se leen mal las dos.
- La tabla es **controlada**: nunca muta `props.rows`. Responder a `editCommit` es obligatorio para
  que una edición persista. En modo servidor vale lo mismo: la tabla avisa qué tramo necesita y
  espera; no hace un `fetch` ni guarda una caché propia.
- **Agrupar y modo servidor son excluyentes.** No se puede armar un árbol de grupos sobre un dataset
  que no está cargado entero: con las dos cosas a la vez, `groupBy` se ignora y se avisa una vez.
