# datatable-vue

Una tabla de datos para Vue 3 que se maneja como una planilla de cálculo y no se pone lenta cuando
hay muchas filas.

Podés cargarle **cien mil filas** y seguir scrolleando suave, seleccionar un bloque
arrastrando, copiarlo con `Ctrl`+`C` y pegarlo en Excel, editar una celda con doble clic, agrupar por
una columna, y dejar fijas las columnas importantes mientras el resto se corre. Si tus datos están en
una base y traerlos todos no es opción, la tabla los va pidiendo de a cincuenta a medida que
scrolleás.

Sin dependencias: solo Vue.

```sh
npm install datatable-vue
```

> Mientras el paquete no esté publicado en npm, `npm install github:jorge-koki/datagrid-vue` instala
> desde el repositorio y funciona igual.

## Cómo se ve usarla

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DataTable } from 'datatable-vue'
import type { DataTableColumn, EditCommitEvent } from 'datatable-vue'
import 'datatable-vue/style.css'

type Empleado = { id: number; nombre: string; area: string; sueldo: number }

const filas = shallowRef<Empleado[]>(traerEmpleados())

const columnas: DataTableColumn<Empleado>[] = [
  { key: 'nombre', label: 'Nombre', width: 220 },
  { key: 'area', label: 'Área', width: 140, renderer: 'badge' },
  { key: 'sueldo', label: 'Sueldo', width: 130, renderer: 'number', editable: true },
]

/*
 * La tabla NUNCA toca tus datos. Cuando alguien termina de editar una celda te
 * avisa, y vos decidís qué hacer: guardar, mandar al servidor, o ignorarlo.
 */
function guardar(evento: EditCommitEvent<Empleado>) {
  const siguiente = filas.value.slice()
  siguiente[evento.rowIndex] = { ...evento.row, [evento.columnKey]: evento.newValue }
  filas.value = siguiente
}
</script>

<template>
  <!-- La tabla ocupa el alto de su contenedor, así que dáselo. -->
  <div style="height: 600px">
    <DataTable :rows="filas" :columns="columnas" row-key="id" @edit-commit="guardar" />
  </div>
</template>
```

Eso ya es una tabla funcionando, con scroll, selección, navegación por teclado y edición.

**→ [Documentación completa](./src/README.md)** — todas las props, los eventos, los renderers, los
temas y las limitaciones.

**→ [Dos ejemplos listos para copiar](./src/README.md#uso)** — uno básico y uno con agrupación.

**→ [Changelog](./CHANGELOG.md)**

## Qué sabe hacer

**Se maneja con el teclado, como una planilla.** Clic en una celda y de ahí en más flechas, `Tab`,
`Inicio` / `Fin`, `RePág` / `AvPág`. Para editar: doble clic, `Enter`, `F2`, o directamente empezar a
escribir. `Esc` descarta.

**Seleccionás bloques y los copiás.** Arrastrás desde una celda, o `Shift`+clic, o `Shift`+flechas;
`Ctrl`+`A` selecciona todo. Con `Ctrl`+`C` el bloque va al portapapeles **con el texto que se ve** —la
etiqueta de un estado, el importe con separadores de miles— y se pega derecho en Excel.

**Editás en línea, y vos tenés la última palabra.** La tabla no escribe en tus datos: te avisa antes
de abrir el editor (y podés cancelarlo), te avisa del valor nuevo, y te avisa cuando se cierra. Una
fila bloqueada, un permiso, una validación: todo eso se resuelve del lado tuyo.

**Agrupás por una o varias columnas.** Las cabeceras se pliegan y muestran totales, promedios,
conteos, mínimos y máximos —o la función que vos escribas—. Con varios niveles, cada grupo suma sobre
todas sus filas y no sobre los subtotales de sus hijos, que es lo que hace que un promedio dé bien.

**Dejás columnas fijas a los costados.** Las anclás a la izquierda o a la derecha y se quedan a la
vista mientras el resto se corre por debajo. Siguen siendo columnas normales: se seleccionan, se
copian y se editan igual.

**Acomodás las columnas y se queda como la dejaste.** Se redimensionan tirando del borde, se mueven
arrastrando el encabezado, se ocultan desde un selector incluido. Y el acomodo se guarda, de modo que
al volver está como lo dejaste. Si mañana agregás o sacás una columna del código, lo guardado se
reconcilia solo en lugar de romperse.

**Ocho tipos de celda listos** —texto, número, etiqueta de color, desplegable, barra de progreso,
avatar, casilla y lista de etiquetas—, y si necesitás otro, escribís el tuyo. Y si querés meter un
componente de tu design system dentro de una celda que se está editando, hay un slot para eso.

**Trae datos del servidor mientras scrolleás.** Le decís cuántas filas hay en total y la tabla te va
pidiendo los tramos que le faltan, de a cincuenta, a medida que el usuario se mueve. Lo que todavía
no llegó se muestra como una barra gris en lugar de un vacío. Nunca hace un pedido por su cuenta: te
avisa qué necesita y vos lo traés como quieras. **Y si tus datos ya están en memoria, nada de esto se
activa.**

**Se adapta a tu tema, y el color lo ponés vos.** Claro, oscuro o automático. Todos los colores son
custom properties, así que cambiar el principal es una línea de CSS:

```css
.mi-tabla {
  --dt-primary: #8b5cf6;
}
```

Eso tiñe la selección, el foco, las casillas y el borde del editor de una sola vez. Lo mismo vale para
fondos, bordes, textos y el radio de las esquinas. Y si tu aplicación ya usa los tokens de NuxtUI v3,
la tabla toma sus colores sola, sin configurar nada. En la demo hay un selector de color para verlo
en vivo.

**Se puede usar con lector de pantalla.** Estructura de grilla completa, con encabezados, índices de
fila y de columna, y cada valor anunciado con el nombre de su columna.

## Por qué no se pone lenta

Una tabla común crea un elemento por cada celda. Con 100.000 filas y 8 columnas eso es casi un millón
de elementos: el navegador no llega.

Acá pasan dos cosas distintas.

**Primero, solo existe lo que se ve.** Si en pantalla entran veinte filas, hay veinte filas en el
documento. Las demás no existen todavía. Al scrollear no se crean ni se destruyen: **se reutilizan
las mismas**, cambiándoles el contenido. Por eso el contador de elementos se queda quieto tanto con
100 filas como con 50.000 — y eso se puede ver en vivo en la demo.

**Segundo, al scrollear casi no se escribe nada.** Cada celda recuerda lo último que mostró, así que
si el valor nuevo es el mismo, no se toca. Y lo que tiene que quedarse quieto —el encabezado, la
numeración, las columnas ancladas— lo sostiene el navegador con CSS, no JavaScript corriendo en cada
cuadro. Eso último no es un detalle de rendimiento sino de calidad: cuando el JavaScript intenta
corregir la posición cuadro a cuadro siempre llega un poco tarde, y eso se ve como un temblor.

El precio de todo esto es que las celdas del cuerpo no las dibuja Vue, sino código propio. Por eso
hay ocho tipos de celda incluidos y un protocolo para escribir el tuyo, en lugar de poder meter
cualquier componente en cualquier celda. [Está explicado con
mediciones](./src/README.md#componentes-de-terceros-dentro-de-una-celda), incluido cuándo esa
decisión NO es la correcta.

## Probarla

```sh
npm install
npm run dev      # http://localhost:5173
```

La pantalla está repartida en tres: a la izquierda **lo que se puede cambiar**, en el medio **lo que
se está mirando** y a la derecha **lo que está pasando**. Las tres se ven al mismo tiempo, así que
tocás un control y ves el efecto de inmediato.

Abre con 100 filas. Desde ahí vale la pena:

- Subir a 1.000 / 10.000 / 50.000 y mirar los contadores: el dataset crece 500 veces y la cantidad de
  elementos en el documento no se mueve.
- Poner **Origen: servidor** y scrollear rápido: se ven las barras de carga y, en la bitácora, los
  tramos que la tabla va pidiendo.
- Editar la columna **Estado**: el desplegable que aparece es un componente Vue de la demo, montado
  desde el slot del editor. Hay una sola instancia viva a la vez, con 100 filas y con 50.000.
- Elegir una agrupación y mirar los totales de cada cabecera.
- Editar una fila marcada como **Bloqueado**: la edición se rechaza, y la bitácora muestra el ciclo
  entero a medida que ocurre.

## Qué hay acá adentro

**`src/` es la librería y nada más que la librería** —exactamente lo que se publica— y `demo/` es la
aplicación que la ejercita. La separación no es cosmética: la demo importa `datatable-vue`, igual que
lo haría cualquier proyecto que instale el paquete, así que si algo no sale del `index.ts`, la demo
no compila.

| Ruta               | Qué es                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `src/`             | La librería. Autocontenida: solo imports relativos, y `vue` como única dependencia.                        |
| `src/composables/` | La ventana visible, el reciclado de elementos, el layout de columnas, la edición, la agrupación y el guardado. |
| `src/internal/`    | Lo que no es API pública: tipos de celda, agregaciones, escrituras al documento y portapapeles.            |
| `src/styles/`      | `datatable.css`: la hoja única, con todos los tokens `--dt-*`.                                             |
| `src/__tests__/`   | Los tests. Viven al lado de lo que verifican y quedan fuera del paquete publicado.                         |
| `demo/`            | La aplicación de ejemplo y los tres paneles de su pantalla.                                                |
| `dist/`            | Lo que se publica. Lo produce `npm run build:lib` y no se versiona.                                        |

## Scripts

| Script                 | Qué hace                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo de la demo.                                                                  |
| `npm run build`        | Verificación de tipos + build de la demo en `dist-demo/`.                                           |
| `npm run preview`      | Sirve la demo ya construida.                                                                        |
| `npm run build:lib`    | Construye la librería distribuible en `dist/`: bundle ESM, `style.css` extraído y archivos `.d.ts`. |
| `npm run type-check`   | `vue-tsc --build` sobre la librería, la demo y los tests. Tiene que salir con código 0.             |
| `npm test`             | La suite completa con Vitest.                                                                       |
| `npm run format`       | `oxfmt` sobre `src/` y `demo/`.                                                                     |
| `npm run format:check` | Lo mismo, sin escribir: falla si algo está sin formatear.                                           |
| `npm run verify`       | Tipos + tests + formato + build de la librería. Es lo mismo que corre CI, en un solo comando.       |

`npm run build` y `npm run build:lib` escriben en **directorios distintos** a propósito, para que el
build de la demo nunca pise lo que se publica. `build:lib` además corre solo al instalar desde
GitHub, que es lo que hace innecesario versionar `dist/`.

## Usar el componente en otro proyecto

Dos vías, las dos documentadas en detalle en la
[documentación del componente](./src/README.md#instalación):

- **Instalar el paquete** (recomendado): `npm install datatable-vue`, y después:

  ```ts
  import { DataTable, DataTableColumnToggle } from 'datatable-vue'
  import 'datatable-vue/style.css'
  ```

- **Copiar el directorio** (estilo shadcn): llevar `src/` al proyecto, con el nombre que se quiera. No
  hace falta importar la hoja de estilos; el componente importa su propio CSS.

## Publicar una versión

1. Actualizar `version` en `package.json` y mover la sección **No publicado** del
   [changelog](./CHANGELOG.md) al número nuevo.
2. `npm run verify` — tipos, tests, formato y build de la librería.
3. `npm pack --dry-run` para leer el contenido exacto del paquete antes de mandarlo.
4. Etiquetar y empujar: `git tag v0.1.0 && git push --tags`.

El workflow [`release.yml`](./.github/workflows/release.yml) se dispara con el tag, verifica que el
tag y `package.json` digan lo mismo, vuelve a correr todo y publica. Necesita un secreto `NPM_TOKEN`
en el repositorio. Publicar a mano con `npm publish` también funciona: los tipos y los tests corren
antes de que nada salga.

Lo que queda por decidir antes de la primera publicación está en el
[checklist previo a publicar](./src/README.md#checklist-previo-a-publicar).

## Configuración del editor

[VS Code](https://code.visualstudio.com/) +
[Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar), con Vetur
deshabilitado. TypeScript no puede tipar los imports de `.vue` por su cuenta, y esa es la razón de
que `vue-tsc` reemplace a `tsc` para verificar tipos.

## Licencia

MIT © jorge-koki — ver [LICENSE](./LICENSE).
