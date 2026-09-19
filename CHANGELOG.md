# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen
[Versionado Semántico](https://semver.org/lang/es/).

Mientras la versión mayor sea `0`, un cambio incompatible sube la **minor**. La superficie que cuenta
como pública es exactamente la que exporta [`src/index.ts`](./src/index.ts): lo que está bajo
`internal/` y los composables pueden cambiar en cualquier versión sin aviso.

## [0.2.1] — 2026-09-18

### Documentación

- **Toda la documentación y los comentarios pasan a español de México.** Lo que más importaba no era
  el registro sino una palabra: `planilla`, que en México significa nómina o lista de candidatos y no
  hoja de cálculo. Además se fue el voseo, `acá` pasó a `aquí` y `apretar` a `presionar` o `hacer
  clic` —salvo donde de verdad significaba estrujar—.

### Agregado

- **`sortable: 'menu'`**: la columna se ordena **solo desde su menú**. El clic en el encabezado no
  hace nada y el encabezado tampoco cambia el cursor, para no prometer un gesto que no tiene. Sirve en
  una columna ancha de texto, donde el clic se da sin querer al ir a redimensionarla o arrastrarla. La
  flecha del sentido aparece igual: dice cómo está ordenada la tabla, no cómo se la ordenó.
- **`pinnable: 'menu'`**: la columna se ancla, pero sin botón en el encabezado.
- **La fila bajo el puntero se realza, con `selectionMode: 'row'`.** Es el anticipo de lo que va a
  hacer el clic, así que no aparece en `'cell'` —donde lo que se elige es una celda— ni en `'none'`,
  y deja afuera la fila activa, la cabecera de grupo y el esqueleto de carga. Nuevo token
  `--dt-row-tint-hover`, un tinte semitransparente y no un color: la banda cruza el fondo de las
  celdas y el de la regleta, que está un escalón más arriba, y cualquier color fijo que se vea
  contra uno se pierde contra el otro. Va detrás de `@media (hover: hover)` para que en una pantalla
  táctil no se quede pegado después de tocar.

### Cambiado

- **El menú de columna ofrece ahora los DOS bordes para anclar**, no solo el declarado en `pinnable`.
  La asimetría con el botón sale de lo que cada control puede hacer: un botón es un gesto y solo puede
  significar una cosa, así que se le declara cuál; un menú tiene lugar para preguntar. Es además la
  única forma de mover una columna de un borde al otro sin soltarla primero.
- Con `sortable: 'menu'` y `columnSelection` encendida, el clic pelado del encabezado vuelve a
  seleccionar la columna sin pedir `Ctrl`/`Cmd`: solo compite con el clic la columna que ordena AL
  CLIC.

## [0.2.0] — 2026-09-17

### Agregado

- **Alturas de fila distintas.** `rowHeight` acepta ahora una función `(row, index) => number` además
  de un número, y cada fila puede medir lo suyo. La acompañan todas las piezas que se ubican sobre
  las filas: el recuadro de la selección abarca el alto real del bloque, el editor se abre del tamaño
  de su celda, la regleta de numeración sigue cada fila, `Av Pág` avanza las que entren de verdad
  desde donde uno esté, y la barra de scroll mide la suma.

  La función recibe `undefined` en lugar de la fila cuando la posición es una **cabecera de grupo** o
  una fila que el **servidor todavía no mandó**, que es la vía para darle a las cabeceras un alto
  propio. Corre una vez por fila del dataset cuando cambian las filas, las columnas o la función
  misma; **scrollear no la llama ni una vez**. De ahí la única regla: pasarla como `computed` y no
  inline en el template, o cada render del padre cuesta una pasada sobre el dataset entero.

- **Ordenamiento.** `column.sortable` hace que el encabezado responda al clic —ascendente,
  descendente y de vuelta a sin orden— y muestre la flecha del sentido; `Shift`+clic suma un criterio
  en lugar de reemplazarlo, y con más de uno cada flecha lleva su número de prioridad. El estado vive
  en **`v-model:sort`**, se anuncia también por `sortChange` y se persiste.

  **La tabla no ordena `rows`**: administra los criterios y los anuncia. Es lo único que funciona en
  los dos modos —en servidor solo tiene una ventana del dataset, y ordenarla daría un orden falso—.
  Para el caso en memoria se exporta **`sortRows(rows, sort, columns)`**: no muta, es estable,
  devuelve el mismo array cuando no hay nada que ordenar, compara el valor crudo y no el texto, y
  manda los vacíos al final en los dos sentidos. `column.comparator` cubre los órdenes que no son los
  naturales del valor.

  Al cambiar el orden la tabla vuelve al principio del dataset.
- **Menú de columna.** `columnMenu` pone un botón de tres puntos en cada encabezado con lo que la
  columna puede hacer: ordenar, anclar, ocultarse y restablecer el layout. No agrega capacidades —es
  otra vía al mismo estado— y muestra solo lo aplicable. Se cierra con `Escape`, al hacer clic afuera, al
  elegir y al scrollear. Una columna se queda afuera con `column.menu: false`.

  Es además el único lugar donde viven juntas las cuatro operaciones de una columna.

  Su redondeo lo decide `radiusBorder`, igual que el de la tabla, y el de sus opciones se deriva
  restándole el padding para que las dos curvas sean concéntricas. Con el preset `cells` se
  cuadricula: una línea entre todas las opciones, no solo entre los grupos. Cada entrada lleva un
  ícono de línea genérico, y anclar al inicio y al final no comparten dibujo: una flecha que entra
  contra una barra dice a qué borde va, cosa que una chinche no puede decir.
- **`labels`**: los textos de los controles de la librería en un solo objeto parcial, para traducirlos.
- **Anclar y desanclar columnas desde el encabezado.** `column.pinnable` pone un botón de alfiler en
  el encabezado, y su valor dice a qué borde lleva: `true` y `'start'` al izquierdo, `'end'` al
  derecho. **Por defecto no hay ningún botón**, así que una tabla que no use la función no paga ni un
  nodo de más por columna. `pinned` pasa a ser el estado inicial y `pinnable` es el permiso.

  Lo elegido vive en **`columnPinning`**, el cuarto v-model del juego de columnas: se reconcilia
  contra las columnas declaradas y se persiste con el resto del layout. Una clave en `null` significa
  "el usuario la soltó" y no es lo mismo que la clave ausente, que deja mandar a `column.pinned`; sin
  esa distinción, soltar una columna declarada anclada sería imposible.

  `resetLayout()` vacía el mapa, que es volver a lo que declaran las columnas. `labels.pin` y
  `labels.unpin` traducen el botón, y la tabla **avisa una vez** si se ancla una columna con
  `aggregate` y hay grupos activos, porque ese agregado deja de mostrarse.
- **La columna que se arrastra ahora tiene un cuerpo.** Al mover un encabezado, una caja con su
  título se despega de él y sigue al puntero hasta que se suelta. Aparece exactamente encima del
  encabezado y conserva el punto donde se agarró, así que no salta al aparecer. Antes el gesto
  mostraba de dónde salía la columna —el encabezado atenuado— y dónde iba a caer —la línea—, pero
  nada agarrado a la mano.
- **`crosshair`**: una línea bajo el encabezado de la columna activa y otra al costado de su número
  de fila, que se cruzan en la celda donde está el usuario. Sirven cuando la tabla es grande y la
  celda activa se va de la pantalla al scrollear: el encabezado y la regleta son los dos bloques que
  no scrollean. Apagada por defecto. El grosor sale de `--dt-crosshair-width` (`2px`).

### Cambiado

- **Con `columnSelection` encendida, el clic del encabezado pasa a ordenar** y seleccionar la columna
  entera se hace con `Ctrl`/`Cmd`+clic. Antes se la quedaba la selección, y eso dejaba un agujero:
  sin `columnMenu`, una columna con `sortable: true` no hacía nada. Sobre una columna que no ordena
  no cambia nada, y con `columnSelection` apagada —el valor por defecto— tampoco.
- **El encabezado pasa a ser un contenedor flex.** Era un bloque con el título en flujo, y eso dejaba
  a la flecha del orden en una segunda línea que el recorte escondía: existía en el documento y no se
  veía. El recorte con puntos suspensivos del título no cambia —lo hace `.dt-header-label`, que tiene
  el suyo—, y la alineación de las columnas centradas y a la derecha ahora sale de `justify-content`
  además de `text-align`.

- **Sin función de altura no cambia nada.** El camino uniforme sigue siendo la misma división `O(1)`,
  sin reservar un solo byte, y el pool no escribe ninguna propiedad de alto. La tabla vuelve sola a
  ese camino si la función termina devolviendo el alto por defecto para todas.
- `scrollToCell` con un índice de fila fuera de rango pide ahora el final del contenido en lugar de
  una posición inventada más allí. Lo que se ve es lo mismo —el navegador acotaba esa escritura
  igual—, pero el número que la tabla pide cambió.
- La celda toma su alto de `--dt-row-h`, el alto de SU fila, en lugar de `--dt-row-height`. Los
  tamaños decorativos que se derivan de `--dt-row-height` con `calc()` —píldoras, casillas,
  avatares— siguen colgando del alto base y no crecen con una fila alta.
- **Las marcas de selección adelgazaron de 2px a 1px**, que es el grosor de las líneas de la grilla
  de `bordered` y del preset `cells`: con 2px la selección se leía como una capa dibujada encima en
  lugar de como parte de la tabla. Alcanza a las tres —el anillo de la celda activa, el recuadro del
  rango y el destello del copiado—, que ahora salen del token nuevo `--dt-selection-width` y no de
  tres valores sueltos. Subirlo a `2px` recupera el aspecto anterior. El corte del bloque anclado
  sigue siendo de 2px: ahí el grosor es la información.
- **La línea bajo el encabezado de la columna activa ahora es opcional, y viene apagada.** Estaba
  puesta de fábrica y no tenía pareja del lado de la regleta, así que la mitad de la cruz se dibujaba
  y la otra no. Ahora las dos salen de `crosshair`, y sin él no se pinta ninguna. El fondo acentuado
  del encabezado no cambia: sigue marcando la columna activa siempre.
- **El editor de celda dejó de ser redondeado** y su borde acompaña a `--dt-selection-width`. El
  redondeo dejaba las cuatro esquinas de la celda sin tapar —el editor se posiciona con la caja
  exacta de la celda, que es recta— y por esos huecos se veía la grilla de abajo. Se notaba poco con
  el borde grueso y quedó a la vista al adelgazarlo. `--dt-radius` sigue valiendo para las píldoras y
  el panel del selector de columnas.

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
