# datagrid-vue

Una grilla de datos virtualizada para Vue 3 que sostiene 60fps con 100.000 filas, más la aplicación
de demostración que lo prueba.

La idea en una frase: **Vue es dueño de la estructura y de la configuración; un pool de nodos DOM
reciclados, escrito en TypeScript plano, es dueño del camino caliente del scroll.** Las celdas del
cuerpo no son vnodes, así que un frame de scroll cuesta un puñado de escrituras de propiedad en lugar
de unos 450 diffs de vnode. Y `rows` nunca se vuelve reactivo en profundidad, así que 100k filas
cuestan cero proxies.

```sh
npm install github:jorge-koki/datagrid-vue
```

**→ [Documentación del componente](./src/components/ui/datatable/README.md)** — props, eventos,
selección, agrupación, renderers, temas, persistencia, rendimiento, limitaciones.

## Qué trae

- **Virtualización en los dos ejes.** Filas y columnas. El cálculo de la ventana es O(1): una
  división por frame, independiente de cuántas filas haya.
- **Pool de nodos DOM reciclados.** Los nodos se reutilizan por slot de viewport y se escriben solo
  donde un valor cambió de verdad. Repintar con entradas idénticas produce cero escrituras en el DOM.
- **Selección por celda y por fila** con navegación completa de teclado: flechas, `Tab`, `Home` /
  `End`, `Ctrl`+`Home` / `End`, `PageUp` / `PageDown`, y auto-scroll mínimo. La marca es una sola: la
  celda activa. El anillo de foco alrededor de la tabla es opcional (`focusRing`, por defecto
  apagado) y se suprime solo cuando ya hay una celda marcada, para que nunca haya dos señales
  apuntando a la misma posición.
- **Edición en línea** con un ciclo cancelable `beforeEdit` → `editCommit` → `afterEdit`. La grilla es
  controlada: nunca muta las filas del consumidor.
- **Agrupación multinivel con agregados.** Cabeceras plegables, cinco agregaciones incluidas
  (`sum`, `avg`, `count`, `min`, `max`) más funciones propias, y un padre que agrega sobre todas sus
  filas descendientes y no sobre los agregados de sus hijos.
- **Ocho renderers de celda incluidos** —text, number, badge, select, progress, avatar, checkbox,
  tags—, más un protocolo documentado y un registro para los propios.
- **Un slot `#editor` para el componente del consumidor**, que es la vía para meter un `<USelect>` o
  cualquier control de un design system dentro de una columna. Se monta sobre la celda en edición
  —**una instancia a la vez**, no una por celda— y `commit()` / `cancel()` recorren la misma tubería
  de edición de siempre. El porqué, con la medición de las tres estrategias posibles, está
  [acá](./src/components/ui/datatable/README.md#componentes-de-terceros-dentro-de-una-celda).
- **Columnas redimensionables, ocultables y reordenables**, con persistencia del layout que reconcilia
  el estado guardado contra las columnas que existen hoy.
- **Tematizable con custom properties `--dt-*`**, en claro / oscuro / automático, con un preset
  `dense`. Adopta los tokens de NuxtUI v3 cuando la aplicación anfitriona los define.
- **Estructura ARIA de grilla completa** —`treegrid` cuando hay agrupación activa—, con la fila de
  encabezado adentro de la grilla y sus `columnheader`, más índices de fila y de columna sobre los
  nodos reciclados. Cada valor se anuncia con el nombre de su columna, sin una sola escritura extra
  por frame. Con `focusRing` apagado —el valor por defecto— entrar con `Tab` y todavía sin celda
  activa no deja señal visual del foco: para usuarios que navegan sobre todo por teclado,
  `focus-ring` es la opción accesible y está
  [documentada acá](./src/components/ui/datatable/README.md#el-anillo-de-foco-del-viewport).
- **Sin dependencias de runtime** más allá de `vue`, que queda como peer dependency y nunca se
  empaqueta.

## Correr la demo

```sh
npm install
npm run dev      # http://localhost:5173
```

La demo abre con **100 filas**, para que se lea como un ejemplo de uso. Desde ahí:

- Usar el selector de filas para saltar a 1.000 / 10.000 / 50.000 y mirar los contadores de FPS y de
  nodos en el DOM: el dataset crece 500× y la cantidad de nodos no se mueve.
- Hacer clic en una celda y navegar con las flechas; la celda activa se muestra en el panel de
  estadísticas.
- Doble clic —o `Enter`, o directamente empezar a escribir— para editar. Las filas marcadas como
  **Bloqueado** quedan vetadas desde `beforeEdit`, y la bitácora muestra el ciclo entero a medida que
  ocurre.
- Editar la columna **Estado**: el desplegable que aparece es un componente Vue de la demo montado
  desde el slot `#editor`, no un control de la librería. Mirar el contador de nodos mientras se abre y
  se cierra: sube unos pocos nodos y vuelve a bajar, con 100 filas y con 50.000, porque hay una sola
  instancia viva a la vez.
- Elegir una agrupación en el selector **Agrupar**: por estado, por prioridad, o los dos niveles a la
  vez. Las cabeceras muestran el total de presupuesto, el promedio de progreso y el conteo del grupo,
  y los botones **Expandir todo** y **Colapsar todo** actúan sobre el árbol completo.

## Qué hay acá adentro

| Ruta                           | Qué es                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/components/ui/datatable/` | El componente. Autocontenido: solo imports relativos, y `vue` como única dependencia de runtime.     |
| `src/demo/`                    | El generador de datos sembrado de la demo, las definiciones de columna, los presets de agrupación, el panel de estadísticas y la bitácora de eventos. |
| `src/App.vue`                  | La página de la demo. Conviene leerla primero para ver un ejemplo de uso funcionando.                |

## Scripts

| Script               | Qué hace                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run dev`        | Servidor de desarrollo de la demo.                                                                      |
| `npm run build`      | Verificación de tipos + build de la demo en `dist-demo/`.                                               |
| `npm run preview`    | Sirve la demo ya construida.                                                                            |
| `npm run build:lib`  | Construye la librería distribuible en `dist/`: bundle ESM, `style.css` extraído y archivos `.d.ts`.     |
| `npm run type-check` | `vue-tsc --build`. Tiene que salir con código 0.                                                        |
| `npm run format`     | `oxfmt` sobre `src/`.                                                                                   |

`npm run build` y `npm run build:lib` escriben en **directorios distintos** a propósito, para que el
build de la demo nunca pise el artefacto publicable. `build:lib` además corre automáticamente como
`prepare`, que es lo que hace funcionar a `npm install github:jorge-koki/datagrid-vue` sin necesidad
de versionar `dist/`.

## Usar el componente en otro proyecto

Dos vías, las dos documentadas en detalle en el
[README del componente](./src/components/ui/datatable/README.md#instalación):

- **Copiar el directorio** (estilo shadcn): llevar `src/components/ui/datatable/` al proyecto. No
  hace falta importar la hoja de estilos; el SFC importa su propio CSS.
- **Instalar el paquete**: `npm install github:jorge-koki/datagrid-vue`, y después:

  ```ts
  import { DataTable, DataTableColumnToggle } from 'datagrid-vue'
  import 'datagrid-vue/style.css'
  ```

## Antes de publicar en npm

Instalar desde GitHub ya funciona, y el nombre, la licencia, el autor y el repositorio están todos
definidos. Lo que falta está en el
[checklist previo a publicar](./src/components/ui/datatable/README.md#checklist-previo-a-publicar).

## Configuración del editor

[VS Code](https://code.visualstudio.com/) +
[Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar), con Vetur
deshabilitado. TypeScript no puede tipar los imports de `.vue` por su cuenta, y esa es la razón de
que `vue-tsc` reemplace a `tsc` para verificar tipos y de que el editor necesite la extensión de Vue
para que el language service conozca los tipos de los `.vue`.

Herramientas del navegador: la extensión [Vue DevTools](https://devtools.vuejs.org/), y los
[Custom Object Formatters](http://bit.ly/object-formatters) de Chrome, para que los refs se impriman
de forma legible.

## Licencia

MIT © jorge-koki — ver [LICENSE](./LICENSE).
