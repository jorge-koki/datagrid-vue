# DataTable

Una tabla virtualizada para Vue 3 que sostiene 60fps con 100.000 filas, porque el camino caliente del
scroll nunca toca el DOM virtual.

Vue conserva lo que cambia poco y se beneficia de ser declarativo: las props, el header, el editor de
celdas, el ciclo de vida. Un pool de nodos DOM reciclados, escrito en TypeScript plano, conserva lo
que cambia en cada frame: las celdas del cuerpo. Esas celdas **no son vnodes**. Con unas 30 filas
visibles por unas 15 columnas visibles, un cuerpo hecho con `v-for` costaría unos 450 diffs de vnode
por frame de scroll y agotaría el presupuesto de 16ms antes de pintar nada. El pool escribe
únicamente las propiedades que cambiaron, así que repintar con entradas idénticas produce cero
escrituras en el DOM.

La otra mitad de la tesis es la memoria. En Vue, `props` es `shallowReactive`, así que `props.rows`
devuelve el array original: ninguna fila se envuelve nunca en un Proxy. Un `ref()` profundo sobre
100k filas crearía 100k proxies y los cobraría incluso mientras nadie scrollea.

---

## Camino rápido

1. Conseguir el código: instalar el paquete, o copiar `src/` dentro del proyecto (las
   dos vías están en [Instalación](#instalación)).
2. Importar el componente y, si se instaló el paquete, la hoja de estilos.
3. Pasar `rows`, `columns` y `rowKey`. **Darle una altura al contenedor** — ver abajo, es el paso
   que más se olvida y el que peor falla.

### El contenedor tiene que tener altura

`.dt-root` **no declara altura propia**: la toma de su contenedor. Es deliberado —una tabla que se
impone un alto pelea con cualquier layout— pero si nadie se la da, la tabla no protesta: pinta el
encabezado, deja la barra de scroll y muestra una sola fila. Parece un problema de datos y no lo es.

```css
/* Altura fija. */
.mi-contenedor {
  height: 600px;
}

/* O dentro de un flex, que la tabla se quede con lo que sobra. */
.mi-contenedor {
  display: flex;
  flex-direction: column;
}
.mi-contenedor .dt-root {
  flex: 1;
  min-height: 0;
}
```

`min-height: 0` no es opcional en el segundo caso: sin eso, un item de flex no baja de su alto de
contenido y la tabla desborda el contenedor en lugar de scrollear por dentro.

Desde la versión 0.1.2 la tabla **avisa una vez por consola** cuando se queda sin altura, en lugar de
quedarse vacía en silencio. El aviso no sale cuando la tabla simplemente está oculta —un acordeón
cerrado, una pestaña inactiva—, que mide igual de cero y es perfectamente normal.

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DataTable } from 'vue-tablekit'
import type { DataTableColumn } from 'vue-tablekit'
import 'vue-tablekit/style.css'

type Invoice = { id: number; customer: string; total: number }

const rows = shallowRef<readonly Invoice[]>([{ id: 1, customer: 'Acme', total: 1200 }])

const columns: readonly DataTableColumn<Invoice>[] = [
  { key: 'customer', label: 'Customer', width: 220, resizable: true },
  { key: 'total', label: 'Total', width: 120, renderer: 'number' },
]
</script>

<template>
  <div style="height: 480px">
    <DataTable :rows="rows" :columns="columns" row-key="id" />
  </div>
</template>
```

El componente llena su contenedor; no tiene altura propia. Sin un contenedor con altura solo se ve
una caja vacía.

Eso ya es una grilla funcionando: la selección por celda y la navegación completa con el teclado
vienen encendidas (`selectionMode: 'cell'`). Basta con hacer clic en la tabla y usar las flechas. Se
apagan con `selection-mode="none"`.

> **Para `rows` va `shallowRef`, no `ref`.** Un `ref` profundo envuelve cada fila en un Proxy
> reactivo. La tabla nunca necesita reactividad por fila: solo necesita enterarse de que el array fue
> reemplazado.

---

## Instalación

### Opción A — instalar el paquete

```sh
npm install vue-tablekit
```

Mientras el paquete no esté publicado en npm, la misma línea contra el repositorio hace lo mismo:
`npm install github:jorge-koki/vue-tablekit`.

```ts
import { DataTable, DataTableColumnToggle } from 'vue-tablekit'
import type { DataTableColumn } from 'vue-tablekit'
import 'vue-tablekit/style.css' // obligatorio por esta vía
```

Por esta vía el CSS se **extrae a un archivo aparte**, nunca se inyecta dentro del JS. El CSS
inyectado rompe el SSR —el bundle tocaría `document` al importarse— y además quita la posibilidad de
redefinir los tokens `--dt-*` antes de montar. Esa es la razón de que la importación explícita
exista.

El paquete se publica solo como ESM, con `vue` como peer dependency: nunca se empaqueta. Dos copias
de Vue en una misma aplicación rompen la reactividad de una forma casi imposible de depurar, porque
los efectos se registran en un runtime y se disparan desde el otro.

Instalado **desde el registro**, `dist/` viene construido dentro del tarball y no hay nada que
compilar. Instalado **desde git**, `dist/` no está versionado y el paquete se construye a sí mismo
mediante el script `prepare` que npm ejecuta para las dependencias de git: no hay nada extra que
hacer del lado del consumidor, solo que la instalación tarda un par de segundos más.

**Si el proyecto no declara todavía los módulos `*.css` para TypeScript**, hay que agregar un
`declare module '*.css';` a algún `.d.ts`. El `DataTable.vue.d.ts` emitido arrastra la importación
con efecto secundario del CSS del SFC. Los proyectos Vite ya lo tienen a través de `vite/client`, y
también Nuxt y la mayoría de las configuraciones de webpack con TS.

### Opción B — copiar el directorio (estilo shadcn)

Copiar `src/` de este repositorio a cualquier lugar del proyecto, con el nombre que se quiera. El
directorio es autocontenido: todo lo que importa adentro lo hace por rutas relativas y su única
dependencia de runtime es `vue`. Sin alias de build, sin utilidades compartidas de este repositorio.
Lo único que conviene dejar afuera es `__tests__/`, que verifica la librería y no hace falta para
usarla.

```ts
import { DataTable, DataTableColumnToggle } from '@/components/ui/datatable'
import type { DataTableColumn } from '@/components/ui/datatable'
```

Por esta vía no hace falta importar la hoja de estilos: `DataTable.vue` importa
`./styles/datatable.css` por su cuenta y el bundler la deduplica.

---

## Uso

Dos ejemplos completos, sin recortes: se copian, se pegan y funcionan. El primero es una grilla
virtualizada con edición; el segundo agrega agrupación, agregados y persistencia encima del primero.

Los dos importan desde `vue-tablekit`. Si el código se copió al proyecto (la [opción
B](#opción-b--copiar-el-directorio-estilo-shadcn)), el único cambio es el especificador del import
—`@/components/ui/datatable`— y que la línea de la hoja de estilos sobra.

### Ejemplo A — uso básico, sin agrupación

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { COLOR_TOKENS, DataTable } from 'vue-tablekit'
import type { DataTableColumn, EditCommitEvent } from 'vue-tablekit'
import 'vue-tablekit/style.css'

// `type` y no `interface`: ver la nota al final de la sección.
type Invoice = {
  id: number
  customer: string
  total: number
  status: 'draft' | 'sent' | 'paid'
}

// `shallowRef` y no `ref`: un ref profundo envolvería cada fila en un Proxy.
const rows = shallowRef<readonly Invoice[]>([
  { id: 1, customer: 'Acme', total: 1200, status: 'paid' },
  { id: 2, customer: 'Globex', total: 380, status: 'draft' },
  { id: 3, customer: 'Initech', total: 7450, status: 'sent' },
])

const columns: readonly DataTableColumn<Invoice>[] = [
  // Texto plano. Sin `renderer` rige el incluido por defecto, que es `text`.
  { key: 'customer', label: 'Cliente', width: 220, resizable: true, editable: true },
  // El renderer `number` ya alinea a la derecha por su cuenta; `align` se declara
  // igual para dejar visible que la alineación es una decisión de la columna y
  // que un `align` explícito siempre le gana al del renderer.
  { key: 'total', label: 'Total', width: 140, renderer: 'number', align: 'right', editable: true },
  // Una píldora de color. `options` es la fuente de verdad de cómo se llama y de
  // qué color es cada valor: la usa el renderer para pintar y, como la columna es
  // editable y su valor no es numérico ni booleano, también el editor `select`
  // que se infiere de tenerla.
  {
    key: 'status',
    label: 'Estado',
    width: 140,
    renderer: 'badge',
    editable: true,
    options: [
      { value: 'draft', label: 'Borrador', color: COLOR_TOKENS.neutral },
      { value: 'sent', label: 'Enviada', color: COLOR_TOKENS.blue },
      { value: 'paid', label: 'Pagada', color: COLOR_TOKENS.green },
    ],
  },
]

/**
 * El único evento que pide escribir.
 *
 * La tabla es CONTROLADA: nunca toca `props.rows`. Sin este handler la edición se
 * ve mientras el editor está abierto y la celda vuelve al valor anterior en el
 * próximo pintado. Se reemplazan la fila y el array en lugar de mutarlos, porque
 * lo que el componente observa es la identidad del array, no su contenido.
 */
function onEditCommit(event: EditCommitEvent<Invoice>): void {
  const next = rows.value.slice()
  next[event.rowIndex] = { ...event.row, [event.columnKey]: event.newValue }
  rows.value = next
}
</script>

<template>
  <!-- El componente llena su contenedor y no tiene altura propia: sin un
       contenedor con altura solo se ve una caja vacía. -->
  <div style="height: 60vh">
    <DataTable
      :rows="rows"
      :columns="columns"
      row-key="id"
      stripe
      bordered
      empty-text="Sin facturas"
      @edit-commit="onEditCommit"
    />
  </div>
</template>
```

Eso ya es una grilla completa: virtualización en los dos ejes, selección por celda y navegación con
el teclado encendidas, y la edición cerrando el círculo contra el dataset del consumidor.

> **La tabla no muta `props.rows`, y esto es lo que más sorprende al empezar.** `rows` y `columns`
> son `readonly` en la firma justamente para decirlo en el tipo. `editCommit` es el único evento que
> pide escribir, y si se ignora no cambia nada en pantalla: no es un bug del componente, es la
> semántica de un componente controlado. Mutar `rows` en el lugar tampoco alcanza —el componente
> guarda una referencia superficial y no se entera—; para ese caso está
> [`refresh()`](#métodos-expuestos).

### Ejemplo B — con agrupación

El mismo dataset, ahora agrupado por dos niveles, con el total sumado y formateado en cada cabecera,
el plegado bajo control del padre y el layout persistido entre sesiones.

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { COLOR_TOKENS, DataTable, groupId } from 'vue-tablekit'
import type { DataTableColumn, EditCommitEvent, GroupToggleEvent } from 'vue-tablekit'
import 'vue-tablekit/style.css'

type Invoice = {
  id: number
  customer: string
  region: string
  total: number
  status: 'draft' | 'sent' | 'paid'
}

const rows = shallowRef<readonly Invoice[]>([
  { id: 1, customer: 'Acme', region: 'LATAM', total: 1200, status: 'paid' },
  { id: 2, customer: 'Globex', region: 'EMEA', total: 380, status: 'draft' },
  { id: 3, customer: 'Initech', region: 'LATAM', total: 7450, status: 'sent' },
  { id: 4, customer: 'Umbrella', region: 'EMEA', total: 2100, status: 'paid' },
])

// A nivel de módulo, no adentro de `formatAggregate`: construir un
// `Intl.NumberFormat` por llamada se paga en el camino de pintado de la cabecera.
const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const columns: readonly DataTableColumn<Invoice>[] = [
  { key: 'customer', label: 'Cliente', width: 220, resizable: true, editable: true },
  // Las dos columnas por las que se agrupa. Siguen siendo columnas normales: se
  // ven, se pueden ocultar y se pueden editar como cualquier otra.
  { key: 'region', label: 'Región', width: 120 },
  {
    key: 'status',
    label: 'Estado',
    width: 140,
    renderer: 'badge',
    editable: true,
    options: [
      { value: 'draft', label: 'Borrador', color: COLOR_TOKENS.neutral },
      { value: 'sent', label: 'Enviada', color: COLOR_TOKENS.blue },
      { value: 'paid', label: 'Pagada', color: COLOR_TOKENS.green },
    ],
  },
  {
    key: 'total',
    label: 'Total',
    width: 160,
    renderer: 'number',
    align: 'right',
    editable: true,
    // Lo que esta columna aporta a cada cabecera de grupo. Se calcula al aplanar,
    // una vez por reconstrucción, nunca por frame.
    aggregate: 'sum',
    // `format` es el de la celda y pide `(value, row, rowIndex)`. Una cabecera de
    // grupo no pertenece a ninguna fila, así que su formato se declara aparte.
    format: (value) => (typeof value === 'number' ? money.format(value) : ''),
    formatAggregate: (value) => (typeof value === 'number' ? money.format(value) : ''),
  },
]

/**
 * Dos niveles: primero por región y, dentro de cada una, por estado.
 *
 * Se controla con v-model porque la persistencia devuelve la agrupación guardada
 * por esta misma vía, y porque `resetLayout()` la vacía: tener el estado aquí es lo
 * que permite que un `<select>` de la aplicación siga reflejando la verdad.
 */
const groupBy = shallowRef<readonly string[]>(['region', 'status'])

/**
 * Qué grupos están abiertos, por `groupId`.
 *
 * Los ids se construyen con el helper `groupId(...)` y no a mano: el formato es
 * interno y un id mal escrito no produce ningún error, solo un grupo que no abre.
 * Controlado, esta lista es la verdad LITERAL: un id que no está aquí está
 * colapsado y `groupsDefaultExpanded` deja de intervenir, así que los grupos de
 * segundo nivel arrancan cerrados hasta que alguien los abra.
 */
const expandedGroups = shallowRef<readonly string[]>([
  groupId(['region', 'LATAM']),
  groupId(['region', 'EMEA']),
])

/** Un cambio puntual. Expandir o colapsar todo NO emite uno por grupo. */
function onGroupToggle(event: GroupToggleEvent): void {
  console.log(event.groupId, event.expanded ? 'expandido' : 'colapsado')
}

/**
 * Igual que en el ejemplo A, y con grupos activos vale exactamente lo mismo:
 * `event.rowIndex` indexa `rows`, no la posición vertical de la celda editada.
 */
function onEditCommit(event: EditCommitEvent<Invoice>): void {
  const next = rows.value.slice()
  next[event.rowIndex] = { ...event.row, [event.columnKey]: event.newValue }
  rows.value = next
}
</script>

<template>
  <div style="height: 60vh">
    <DataTable
      v-model:group-by="groupBy"
      v-model:expanded-groups="expandedGroups"
      :rows="rows"
      :columns="columns"
      row-key="id"
      table-id="invoices"
      persist
      stripe
      bordered
      empty-group-label="Sin región"
      @edit-commit="onEditCommit"
      @group-toggle="onGroupToggle"
    />
  </div>
</template>
```

Tres cosas de este ejemplo que conviene no pasar por alto:

- **`persist` necesita `table-id`.** Es lo que separa el layout de una tabla del de otra; sin él se
  emite un aviso y la persistencia queda apagada. Guarda visibilidad, orden, anchos **y** agrupación,
  esto último bajo la bandera `include.grouping`, que viene en `true`.
- **Con `persist` encendido, el valor inicial de `expandedGroups` dura hasta que carga lo guardado.**
  La restauración llega por `update:expandedGroups`, el v-model la adopta, y el literal del `script`
  pasa a ser solo el estado de la primera visita. Es lo esperable, pero sorprende si no se sabe.
- **El agregado se pinta en el offset horizontal de su columna.** Declararlo en la **primera** columna
  taparía el chevron, la etiqueta y la insignia del grupo, así que las columnas con `aggregate`
  conviene dejarlas hacia la derecha.

> **Qué índice de fila reporta cada cosa.** Es la única parte de la agrupación que se puede usar mal
> en silencio. **Los eventos** —`editCommit`, `beforeEdit`, `afterEdit`, `cellSelect`, `rowClick`—
> reportan siempre el índice dentro de la prop `rows`. **Las posiciones** —`v-model:active-cell`,
> `selectCell()`, `scrollToCell()`, `scrollToRow()`— indexan la secuencia VISIBLE, donde cada cabecera
> de grupo ocupa una entrada propia y un grupo colapsado esconde a las suyas. Sin agrupación los dos
> números coinciden y no hay nada que distinguir; con agrupación, usar uno donde va el otro escribe la
> edición sobre otra fila del dataset y nada lo delata. La regla corta: **el índice de un evento se
> usa para escribir en `rows`; una `CellPosition` se usa para mover la vista.** Está desarrollado en
> [Dos números distintos](#dos-números-distintos-posición-visible-e-índice-original).

> **`TRow` tiene que ser un `type`, no una `interface`.** El componente se declara como
> `generic="TRow extends Record<string, unknown>"`, y en TypeScript solo los alias de tipo reciben
> una firma de índice implícita. `interface Invoice { … }` no satisface la restricción.

Para el resto —selector de columnas, veto de edición por fila, `resetLayout()`, editores propios
desde el slot `#editor`— cada sección de abajo trae su propio fragmento. Y en `demo/App.vue` de este
repositorio está todo cableado a la vez sobre un dataset de hasta 50.000 filas.

---

## Props

`rows`, `columns` y `rowKey` son obligatorias. Todo lo demás tiene valor por defecto.

| Prop                    | Tipo                                                             | Por defecto                   | Descripción                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rows`                  | `readonly (TRow \| undefined)[]`                                 | —                             | El dataset. Nunca se corta, ni se copia, ni se vuelve reactivo en profundidad. La tabla solo indexa dentro de la ventana visible. Con `rowCount` puede tener huecos: ver [Datos del servidor](#datos-del-servidor-y-scroll-infinito).                    |
| `rowCount`              | `number`                                                         | —                             | Cuántas filas tiene el dataset entero, cuando `rows` no las tiene todas. **Declararla enciende el modo servidor**; sin ella, nada cambia. Ver [Datos del servidor](#datos-del-servidor-y-scroll-infinito).                                               |
| `pageSize`              | `number`                                                         | `50`                          | Filas por pedido en modo servidor. Los tramos pedidos se alinean a este número.                                                                                                                                                                          |
| `prefetchPages`         | `number`                                                         | `1`                           | Páginas pedidas por adelantado a cada lado de la ventana visible, para que un scroll normal no muestre marcadores.                                                                                                                                       |
| `columns`               | `readonly DataTableColumn<TRow>[]`                               | —                             | Definiciones de columna, en orden de declaración. Ver [Columnas](#columnas).                                                                                                                                                                             |
| `rowKey`                | `keyof TRow \| ((row: TRow, index: number) => string \| number)` | —                             | Identidad de una fila. Se estampa como `data-row-key` para que el DOM siga siendo inspeccionable y testeable. Nunca afecta al reciclado: el pool recicla por slot de viewport.                                                                           |
| `rowHeight`             | `number \| RowHeightResolver<TRow>`                              | `40` / `30` con `dense`       | Altura de fila en px, igual para todas o resuelta fila por fila. Es un número y no un valor CSS porque el virtualizador hace cuentas con él. El valor fijo se replica en `--dt-row-height`. Ver [Alturas de fila distintas](#alturas-de-fila-distintas). |
| `headerHeight`          | `number`                                                         | `44` / `34` con `dense`       | Altura del header en px. Se replica en `--dt-header-height`.                                                                                                                                                                                             |
| `dense`                 | `boolean`                                                        | `false`                       | Preset compacto: filas más bajas, tipografía menor, padding más ajustado.                                                                                                                                                                                |
| `crosshair`             | `boolean`                                                        | `false`                       | Una línea bajo el encabezado de la columna activa y otra al costado de su número de fila. En `selectionMode: 'row'` solo la segunda. Ver [La cruz de la celda activa](#la-cruz-de-la-celda-activa).                                                      |
| `overscan`              | `number`                                                         | `4`                           | Filas y columnas extra pintadas fuera de la ventana visible. Más alto cuesta tiempo de pintado y oculta bordes en blanco durante el scroll rápido.                                                                                                       |
| `defaultColumnWidth`    | `number`                                                         | `150`                         | Ancho en px para las columnas que no declaran el suyo.                                                                                                                                                                                                   |
| `virtualizeColumns`     | `boolean`                                                        | `true`                        | Pinta solo las columnas visibles en horizontal. Conviene apagarlo en tablas angostas donde la fila entera entra: ahí el cálculo de ventana es overhead puro.                                                                                             |
| `theme`                 | `'light' \| 'dark' \| 'auto'`                                    | `'auto'`                      | Esquema de color. Ver [Temas](#temas).                                                                                                                                                                                                                   |
| `variant`               | `'default' \| 'cells' \| 'rows'`                                 | `'default'`                   | Preset visual. `'cells'` dibuja una grilla completa de celda a celda; `'rows'` solo separa las filas, sin ninguna vertical. Los dos pisan a `stripe` y a `bordered`.                                                                                     |
| `radiusBorder`          | `'none' \| 'sm' \| 'md' \| 'lg' \| 'xl'`                         | `'none'`                      | Redondeo de las esquinas de la tabla, solo de la caja exterior. Ver [El redondeo de la caja](#el-redondeo-de-la-caja).                                                                                                                                   |
| `showRowNumbers`        | `boolean`                                                        | `true`                        | Regleta de numeración fija a la izquierda. **No es una columna.** Ver [La regleta de numeración](#la-regleta-de-numeración).                                                                                                                             |
| `columnReorder`         | `boolean`                                                        | `true`                        | Mover columnas arrastrando el encabezado. Escribe `columnOrder`. Ver [Mover columnas](#mover-columnas-arrastrando).                                                                                                                                      |
| `columnSelection`       | `boolean`                                                        | `false`                       | Clic en un encabezado para seleccionar la columna entera. Produce un rango. Ver [Seleccionar en bloque](#seleccionar-una-columna-o-una-fila-entera).                                                                                                     |
| `selectionColumn`       | `boolean`                                                        | `false`                       | Columna de casillas al inicio, con tricasilla en el encabezado. Lo marcado vive en `selectedRows`. Ver [Marcar filas con casillas](#marcar-filas-con-casillas).                                                                                          |
| `selectedRows`          | `RowSelectionState`                                              | —                             | Las filas marcadas, por clave. `v-model:selected-rows`. Ver [Marcar filas con casillas](#marcar-filas-con-casillas).                                                                                                                                     |
| `rowSelection`          | `boolean`                                                        | `false`                       | Clic en el número de una fila para seleccionarla entera. No confundir con `selectionMode: 'row'`. Ver [Seleccionar en bloque](#seleccionar-una-columna-o-una-fila-entera).                                                                               |
| `loading`               | `boolean`                                                        | `false`                       | Pinta el esqueleto sobre todas las filas visibles. Para la primera carga o una reconsulta; en modo servidor, una página que no llegó ya se pinta así sola. Ver [El esqueleto de carga](#el-esqueleto-de-carga).                                          |
| `emptyText`             | `string`                                                         | `'No data'`                   | Mensaje que se muestra cuando `rows` está vacío. Con la cadena vacía no se dibuja nada, ni el texto ni su caja.                                                                                                                                          |
| `sort`                  | `SortState`                                                      | _no controlado_               | `v-model:sort`. Criterios de orden vigentes. **La tabla no ordena `rows`**: administra el estado y lo anuncia. Ver [Ordenamiento](#ordenamiento).                                                                                                        |
| `columnMenu`            | `boolean`                                                        | `false`                       | Menú de tres puntos en cada encabezado: ordenar, anclar, ocultar y restablecer. Ver [El menú de la columna](#el-menú-de-la-columna).                                                                                                                     |
| `labels`                | `DataTableLabels`                                                | en inglés                     | Textos de los controles que pone la librería. Se pasa parcial. Ver [Traducir los textos](#traducir-los-textos).                                                                                                                                          |
| `stripe`                | `boolean`                                                        | `false`                       | Marca las filas impares con `.dt-row--stripe`. **La librería no las pinta**: es un enganche para que el consumidor decida. Ver [El color de una fila](#el-color-de-una-fila).                                                                            |
| `bordered`              | `boolean`                                                        | `false`                       | Dibuja separadores de celda.                                                                                                                                                                                                                             |
| `columnVisibility`      | `Readonly<Record<string, boolean>>`                              | _no controlado_               | `v-model:column-visibility`. Una clave ausente se resuelve con `column.defaultVisible ?? true`.                                                                                                                                                          |
| `columnOrder`           | `readonly string[]`                                              | _no controlado_               | `v-model:column-order`. Se reconcilia contra las columnas actuales antes de aplicarse.                                                                                                                                                                   |
| `columnWidths`          | `Readonly<Record<string, number>>`                               | _no controlado_               | `v-model:column-widths`. Pisa a `column.width` y siempre se acota por `minWidth` / `maxWidth`.                                                                                                                                                           |
| `columnPinning`         | `ColumnPinState`                                                 | _no controlado_               | `v-model:column-pinning`. Anclaje por clave de columna; pisa a `column.pinned`. Es lo que escribe el botón del encabezado. Ver [Anclar desde el encabezado](#anclar-desde-el-encabezado).                                                                |
| `tableId`               | `string`                                                         | —                             | Identificador único de esta tabla dentro de la aplicación. Obligatorio para persistir: es lo que separa el layout de una tabla del de otra.                                                                                                              |
| `persist`               | `boolean \| DataTablePersistOptions`                             | `false`                       | Persiste el layout entre sesiones. `true` significa `localStorage` con los valores por defecto. Ver [Persistencia](#visibilidad-orden-y-persistencia-de-columnas).                                                                                       |
| `selectionMode`         | `'none' \| 'cell' \| 'row'`                                      | `'cell'`                      | Qué seleccionan el clic y el teclado. Ver [Selección](#selección-y-navegación-con-el-teclado).                                                                                                                                                           |
| `rangeSelection`        | `boolean`                                                        | `true`                        | Arrastrar, `Shift`+clic y `Shift`+flechas seleccionan un rectángulo de celdas, y `Ctrl`+`C` lo copia. Solo rige con `selectionMode: 'cell'`. Ver [Selección de un rango](#selección-de-un-rango-de-celdas).                                              |
| `activeCell`            | `CellPosition \| null`                                           | _no controlado_               | `v-model:active-cell`. La celda seleccionada. `null` significa "controlado y sin selección".                                                                                                                                                             |
| `focusRing`             | `boolean`                                                        | `false`                       | Dibuja un anillo alrededor del viewport cuando la tabla tiene el foco por teclado. En `true` aparece solo mientras no hay celda activa. Ver [El anillo de foco](#el-anillo-de-foco-del-viewport).                                                        |
| `groupBy`               | `readonly string[]`                                              | _no controlado_ (lista vacía) | `v-model:group-by`. Claves de columna por las que agrupar, en orden de anidamiento. Ver [Agrupación](#agrupación).                                                                                                                                       |
| `expandedGroups`        | `readonly string[]`                                              | _no controlado_               | `v-model:expanded-groups`. `groupId` de los grupos expandidos. Una lista vacía significa "controlado y todo colapsado".                                                                                                                                  |
| `groupsDefaultExpanded` | `boolean`                                                        | `true`                        | Estado inicial de un grupo del que todavía no se sabe nada. Deja de intervenir cuando `expandedGroups` está controlado.                                                                                                                                  |
| `showGroupCount`        | `boolean`                                                        | `true`                        | Si la cabecera de grupo muestra la insignia con cuántas filas contiene.                                                                                                                                                                                  |
| `emptyGroupLabel`       | `string`                                                         | `'(empty)'`                   | Etiqueta del grupo que junta los valores ausentes. Ver [Agrupación](#groupid-una-identidad-por-camino).                                                                                                                                                  |

### Controlado y no controlado

`columnVisibility`, `columnOrder`, `columnWidths`, `activeCell`, `groupBy` y `expandedGroups`
funcionan de dos maneras cada uno, y el componente sirve a las dos sin bifurcar su lógica interna:

- **No controlado** (la prop llega `undefined`): el estado vive en un ref interno y la tabla se
  administra sola. Es el modo que usa la persistencia.
- **Controlado** (la prop llega con valor): la prop es la verdad. El componente **no** escribe el ref
  interno, solo emite `update:*`, y el padre decide. Si el padre ignora el evento, no cambia nada: es
  la semántica normal de un v-model.

El evento `update:*` se emite igual en los dos modos, así que se pueden observar los cambios sin
tomar posesión del estado.

> **`activeCell` distingue `undefined` de `null`.** `undefined` significa no controlado; `null`
> significa controlado y sin nada seleccionado. Si la comparación fuera por valor falsy, un padre que
> limpia la selección le devolvería el control al componente sin querer. Lo mismo vale para
> `expandedGroups`, donde una lista vacía es un estado legítimo del modo controlado.

---

## Eventos

| Evento                    | Payload                             | Cuándo                                                                                                                                                         |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeEdit`              | `BeforeEditEvent<TRow>`             | Antes de que se abra el editor de una celda. **Cancelable.**                                                                                                   |
| `editCommit`              | `EditCommitEvent<TRow>`             | Una edición produjo un valor que el padre debería persistir. Solo cuando el valor cambió de verdad.                                                            |
| `afterEdit`               | `AfterEditEvent<TRow>`              | Terminó una sesión de edición, haya commiteado o no. Exactamente una vez por editor abierto.                                                                   |
| `columnResize`            | `ColumnResizeEvent`                 | Un arrastre de redimensionado terminó con un ancho distinto. Un clic sin arrastre no es un resize.                                                             |
| `rowClick`                | `{ row: TRow; rowIndex: number }`   | Clic en cualquier punto de una fila de datos pintada. Una cabecera de grupo no lo dispara.                                                                     |
| `cellSelect`              | `CellSelectEvent<TRow>`             | La celda activa se movió a una celda real. Lleva la fila, la columna y el valor ya resuelto.                                                                   |
| `rangeSelect`             | `RangeSelectEvent<TRow>`            | Cambió el rectángulo seleccionado. `range` en `null` significa que quedó una sola celda. Ver [Selección de un rango](#selección-de-un-rango-de-celdas).        |
| `rangeCopy`               | `RangeCopyEvent`                    | El usuario copió la selección. Llega **después** de escribir el portapapeles: es un aviso, no un veto.                                                         |
| `groupToggle`             | `GroupToggleEvent`                  | Se plegó o se desplegó un grupo puntual, por clic o por teclado. Ver [Agrupación](#agrupación).                                                                |
| `rowsRequest`             | `RowsRequestEvent`                  | Solo en modo servidor. La tabla necesita el tramo `{ start, end, page }` y lo está esperando. Ver [Datos del servidor](#datos-del-servidor-y-scroll-infinito). |
| `update:activeCell`       | `CellPosition \| null`              | Cambió la celda activa, incluso a `null`. Se emite antes de `cellSelect`.                                                                                      |
| `update:columnVisibility` | `Readonly<Record<string, boolean>>` | Cambió la visibilidad (por la UI, por la carga de la persistencia o por `resetLayout`).                                                                        |
| `update:columnOrder`      | `string[]`                          | Cambió el orden.                                                                                                                                               |
| `update:columnWidths`     | `Readonly<Record<string, number>>`  | Cambiaron los anchos, también durante el arrastre.                                                                                                             |
| `update:groupBy`          | `string[]`                          | Cambiaron las claves de agrupación (por la UI, por la carga de la persistencia o por `resetLayout`).                                                           |
| `update:expandedGroups`   | `string[]`                          | Cambió el estado de expansión. Lleva la lista COMPLETA de expandidos, no el grupo que cambió.                                                                  |

## Slots

Hay uno solo, y es opcional.

| Slot      | Props                       | Cuándo se renderiza                                                                                                                     |
| --------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `#editor` | `CellEditorSlotProps<TRow>` | Sobre la celda en edición, y únicamente si esa columna declara `editor: 'slot'`. Se monta al abrir el editor y se desmonta al cerrarlo. |

Es la única vía por la que entra un componente Vue del consumidor, y entra con una regla: **uno
montado a la vez**, no uno por celda. Está desarrollado, con la medición que lo justifica, en
[Componentes de terceros dentro de una celda](#componentes-de-terceros-dentro-de-una-celda).

Dos consecuencias que conviene tener presentes desde el principio, porque cambian cómo se lee lo que
aparece en pantalla:

- **El control es del consumidor, no de la librería.** Un desplegable que se abre sobre una celda con
  `editor: 'slot'` es el componente que el consumidor puso en el slot. La tabla aporta la caja
  posicionada y la tubería de `commit()` / `cancel()`; el aspecto y el comportamiento del control son
  ajenos.
- **La cantidad de instancias no depende del tamaño del dataset.** Se monta al abrir el editor y se
  desmonta al cerrarlo, y solo puede haber un editor abierto por vez: hay como mucho **una instancia
  en toda la página**, con 100 filas cargadas o con 50.000. Medido desde afuera, abrir el editor suma
  los nodos de ese componente y cerrarlo los devuelve; el conteo de nodos del DOM no crece con la
  cantidad de filas.

### El ciclo de edición

```
doble clic / Enter / F2 / clic en una casilla
        │
        ▼
   beforeEdit  ──── event.cancel() ────► no pasa nada más. Ni editor, ni afterEdit.
        │
        ▼
   se abre el editor (el incluido, el del slot #editor, o se aplica
   directamente el valor de la casilla)
        │
        ├── Enter / blur / cambio del select / la fila sale de la ventana ──► commit
        ├── commit(valor) desde el slot #editor ─────────────────────────► commit
        └── Escape / cancel() desde el slot #editor ─────────────────────► se descarta
        │
        ▼
   afterEdit    (SIEMPRE, y primero; `canceled: true` cuando se descartó)
        │
        ▼
   editCommit   (solo si newValue difiere de oldValue)
```

> **`afterEdit` se emite ANTES que `editCommit`,** y no al revés. Los dos salen de la misma llamada
> síncrona, así que para un listener normal el orden es indistinguible; importa cuando uno de los dos
> handlers lee estado que el otro escribe. El que cierra el ciclo es `afterEdit` y el que pide
> escribir es `editCommit`, pero `editCommit` llega segundo.

**Cómo cancelar.** Hay que llamar a `event.cancel()` de forma síncrona dentro del listener de
`beforeEdit`. Es seguro llamarla más de una vez, y `event.canceled` lo refleja. Este es el punto de
enganche para chequeos de permisos, bloqueos por fila y "esta columna es de solo lectura en este
momento".

```ts
function onBeforeEdit(event: BeforeEditEvent<Invoice>): void {
  if (event.row.locked) {
    event.cancel()
  }
}
```

No hay escape asíncrono: la emisión es síncrona y la decisión tiene que estar tomada antes de que el
listener retorne. Todo lo que necesite una ida y vuelta al servidor debería decidirse con datos que
ya estén en la fila.

**`editCommit` es el único evento que pide escribir.** La tabla es controlada y nunca muta `rows`. Si
se ignora `editCommit`, la celda vuelve a mostrar su valor anterior en el próximo pintado, que es el
comportamiento correcto de un componente controlado y no un bug.

El valor nuevo se coacciona de vuelta al tipo primitivo del anterior donde eso no es ambiguo, así que
editar una columna numérica entrega un `number` y no un `string`. Un `<select>` devuelve el
`option.value` tipado, de modo que un padre que guardaba `1` no recibe `"1"`.

**Qué abre y qué cierra un editor**

Un clic simple **no** abre el editor: selecciona. El mapa de teclas completo está en
[Selección y navegación con el teclado](#selección-y-navegación-con-el-teclado); esta tabla es solo
la parte que toca la edición.

| Entrada                                            | Efecto                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Doble clic en una celda                            | Abre el editor (el incluido, o el del slot `#editor` si la columna lo declara)  |
| `Enter` o `F2` sobre la celda activa               | Abre el editor; en una columna de casillas, alterna el valor                    |
| Escribir un carácter imprimible en la celda activa | Abre el editor sembrado con ese carácter (no en `select` ni en `date`)          |
| `Enter` dentro del editor                          | Commitea y baja la selección una fila                                           |
| `Escape` dentro del editor                         | Descarta (igual emite `afterEdit` con `canceled: true`) y conserva la selección |
| Quitarle el foco al editor                         | Commitea                                                                        |
| Cambiar un editor `<select>`                       | Commitea de inmediato                                                           |
| Sacar la fila editada de la ventana virtual        | Commitea y cierra: el nodo que sostenía esa celda ya se recicló                 |

Mientras hay un editor abierto, el manejador de teclado de la grilla se aparta por completo: las
flechas, `Home`, `PageUp` y las demás son del control. `Enter` y `Escape` detienen su propagación,
así que cerrar el editor no puede reabrirlo en el acto.

---

## Selección y navegación con el teclado

El modelo es el de una hoja de cálculo: **un clic selecciona, dos clics editan.** Seleccionar
para leer un valor o para empezar a navegar es mucho más frecuente que editar, y exigir doble clic
para eso costaría un gesto de más en el caso común.

La selección es una `CellPosition` (`{ rowIndex, columnKey }`) que guarda el componente, no el foco
del DOM. Aquí eso importa más que en una tabla común: los nodos del pool se reciclan al scrollear, así
que el elemento enfocado no es un lugar confiable donde guardar "dónde está parado el usuario". La
posición activa sobrevive a cualquier repintado.

> **Con grupos activos, `rowIndex` indexa la secuencia VISIBLE**, no la prop `rows`. Los eventos
> hacen el camino inverso. La distinción está desarrollada en
> [Dos números distintos: posición visible e índice original](#dos-números-distintos-posición-visible-e-índice-original).

### `selectionMode`

| Valor    | Comportamiento                                                                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'cell'` | Por defecto. La **celda** activa recibe `.dt-cell--active` y `aria-selected`; su fila recibe además `.dt-row--active`.                                                                                                                                                     |
| `'row'`  | La **fila** activa es la unidad seleccionada: recibe el anillo y `aria-selected`, y la celda no recibe ninguno de los dos. Adentro sigue habiendo una celda activa, pero su columna deja de decidir nada visible. Ver [Qué cambia en modo fila](#qué-cambia-en-modo-fila). |
| `'none'` | Sin selección por puntero, sin ningún manejador de teclado registrado, y el viewport deja de ser enfocable (`tabindex="-1"`).                                                                                                                                              |

`'none'` no es un early return dentro de un manejador: el objeto de listeners viene vacío y Vue no
registra nada. El `selectCell()` expuesto sigue escribiendo el estado si se lo llama, así que una
selección por código sigue siendo posible; lo que desaparece son las vías de entrada del usuario.

#### Qué cambia en modo fila

La regla es una sola: **si el usuario no puede ver en qué columna está, nada puede moverlo por ellas
ni decidir según cuál sea.** Adentro sigue existiendo una celda activa —el teclado necesita una
posición y el editor necesita saber qué abre—, pero su columna no se pinta y por lo tanto tampoco
manda.

| Gesto                  | En `'cell'`                        | En `'row'`                                     |
| ---------------------- | ---------------------------------- | ---------------------------------------------- |
| Encabezado de columna  | Marca la columna activa            | No marca ninguna                               |
| `←` `→`                | Mueven de columna                  | No hacen nada                                  |
| `Home` / `End`         | Primera / última **columna**       | Primera / última **fila**                      |
| `Tab`                  | Recorre celdas en orden de lectura | Sale de la tabla, como en cualquier otra parte |
| `Ctrl`+`C`             | La celda o el rango                | La **fila entera**, en TSV                     |
| `Enter`, `F2`, teclear | Abren el editor                    | No abren nada                                  |
| Doble clic             | Abre el editor                     | Abre el editor                                 |

Plegar y desplegar un grupo con `←` y `→` **sigue funcionando** en los dos modos: no es moverse entre
columnas, es actuar sobre la fila donde uno ya está parado.

**Editar sigue estando, y a propósito.** Lo único que se va son las vías ciegas: `Enter` abría el
editor de una celda que el usuario no eligió ni podía ver. El doble clic se queda porque ahí sí se
señala una celda concreta. Quien quiera una tabla de solo lectura tiene `editable: false` por
columna y el veto de `beforeEdit`, que es donde esa decisión pertenece —si el modo la quitara por su
cuenta, no habría forma de recuperarla—.

Para reaccionar a la fila elegida está `rowClick`, que emite `{ row, rowIndex }` con el objeto
completo y el índice dentro de tu propio array. No hace falta modo fila para recibirlo: se emite en
los tres modos.

### El anillo de foco del viewport

`.dt-viewport` es el **único** elemento enfocable de la tabla: es la caja que scrollea y es donde
escucha el manejador de teclado. Un clic sobre una celda le lleva el foco de forma explícita, porque
las celdas no son enfocables.

Que el viewport tenga el foco y que ese foco se **dibuje** son dos cosas distintas, y la segunda la
decide `focusRing`:

| Valor             | Qué se ve                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `false` (defecto) | Ningún anillo alrededor del viewport, nunca. La única marca de posición es la celda activa.                         |
| `true`            | Anillo de 2px en `--dt-primary` cuando la tabla tiene el foco **por teclado**, y solo mientras no hay celda activa. |

**Por qué el valor por defecto es `false`.** Con una celda marcada, el anillo del viewport es una
segunda señal para la misma posición: la celda lleva su propio anillo y la tabla entera queda además
encerrada en un borde de color. Es el mismo problema que tenía la tabla cuando las celdas llevaban
`tabindex="-1"` y el navegador pintaba un anillo de `:focus-visible` sobre una celda distinta de la
activa, solo que un nivel más arriba.

**Por qué en `true` el anillo igual desaparece al seleccionar.** Por lo mismo. `focusRing: true`
resuelve el caso en que no hay nada seleccionado; en cuanto lo hay, la celda activa ya dice dónde
está parado el usuario y el anillo vuelve a sobrar.

> **El costo de accesibilidad del valor por defecto, dicho de frente.** Con `focusRing: false` y sin
> celda activa —el estado en el que arranca la tabla—, quien llega con `Tab` no recibe ninguna señal
> visual de que el foco entró en la grilla. Solo la primera flecha marca una celda y aparece una
> referencia. Si los usuarios de la aplicación navegan sobre todo por teclado, **`focusRing: true` es
> la opción accesible** y alcanza con encenderla:
>
> ```vue
> <DataTable focus-ring :rows="rows" :columns="columns" row-key="id" />
> ```
>
> La otra forma de cubrirlo, sin anillo, es entrar con una celda ya seleccionada:
> `v-model:active-cell` con una posición inicial, o `selectCell()` sobre el template ref.

**No cuesta nada por frame.** El anillo se decide enteramente desde CSS, con dos atributos que Vue
escribe sobre `.dt-root`: `data-focus-ring` replica la prop y `data-active-cell` dice si hay una
celda marcada en pantalla. Este segundo solo cambia al pasar de "sin selección" a "con selección" y
de vuelta, o al ocultar o mostrar la columna de la celda activa —recorrer la tabla entera con las
flechas no lo mueve, porque sigue habiendo selección—, así que el camino caliente del scroll no lo
toca nunca.

### Teclas

Todas actúan sobre la celda activa y requieren que el viewport tenga el foco.

| Tecla                                                  | Efecto                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `↑` `↓` `←` `→`                                        | Mueve una celda. **Se acota en los bordes: no da la vuelta.**                                          |
| `Tab` / `Shift`+`Tab`                                  | Mueve una celda en orden de lectura. **Pasa a la fila siguiente o anterior** al llegar al borde.       |
| `Home`                                                 | Primera columna de la fila actual                                                                      |
| `End`                                                  | Última columna de la fila actual                                                                       |
| `Ctrl`/`Cmd`+`Home`                                    | Primera celda de la tabla                                                                              |
| `Ctrl`/`Cmd`+`End`                                     | Última celda de la tabla                                                                               |
| `PageUp` / `PageDown`                                  | Sube o baja un viewport completo de filas enteras (mínimo 1)                                           |
| `Enter` / `F2`                                         | Edita la celda activa (la alterna, en una columna de casillas); sobre una cabecera de grupo, la pliega |
| `Espacio`                                              | Sobre una cabecera de grupo, la pliega; sobre una fila de datos es un carácter imprimible más          |
| Cualquier carácter imprimible                          | Edita la celda activa, sembrada con ese carácter                                                       |
| `Escape`                                               | Con un editor abierto: descarta. Sin editor abierto: **nada**, la selección se conserva.               |
| `Shift`+ flecha / `Inicio` / `Fin` / `RePág` / `AvPág` | **Extiende** el rango en lugar de mover la selección                                                   |
| `Ctrl`/`Cmd`+`A`                                       | Selecciona la grilla entera                                                                            |
| `Ctrl`/`Cmd`+`C`                                       | Copia la selección al portapapeles como TSV                                                            |

Las cuatro últimas requieren `rangeSelection` encendido —lo está por defecto— y están desarrolladas en
[Selección de un rango de celdas](#selección-de-un-rango-de-celdas).

Dos asimetrías deliberadas:

- **Las flechas se acotan, `Tab` da la vuelta.** Las flechas son espaciales: pasarse del borde
  derecho y reaparecer en la fila siguiente desorienta. `Tab` es secuencial, que es lo que significa
  en un formulario y en una hoja de cálculo, y es lo que permite recorrer la grilla entera sin soltar el
  teclado.
- **`Escape` sin editor abierto conserva la selección.** Perder de vista dónde estaba parado uno es
  más molesto que seguir seleccionado.

**Escribir para editar** ignora las combinaciones con modificadores para no secuestrar los atajos del
navegador: la tecla tiene que medir exactamente un carácter, sin `Ctrl`, `Cmd` ni `Alt`. `Shift` sí
se admite, porque solo cambia qué carácter sale. El carácter sembrado **no** queda seleccionado
dentro del input, así que lo que se escriba después se agrega en lugar de reemplazarlo. Los editores
`select` y `date` ignoran la semilla y se abren con el valor actual: no hay forma sensata de sembrar
un desplegable o un selector de fechas con una sola tecla.

**Las columnas ocultas se saltean.** La navegación recorre las columnas _resueltas_, que ya excluyen
las ocultas y respetan el orden vigente. Una flecha nunca se estaciona en una columna que no se ve.

### Auto-scroll

La navegación con el teclado desplaza **lo mínimo necesario** para traer la celda destino a la vista;
no la centra. Centrar mueve el viewport incluso cuando la celda ya estaba visible, y eso convierte
cada flecha en un salto. Con el ajuste mínimo, moverse dentro de la ventana no desplaza nada y llegar
a un borde avanza exactamente una fila o una columna.

### Selección de un rango de celdas

Arrastrar sobre la tabla selecciona un **rectángulo de celdas**, como en una hoja de cálculo, y `Ctrl`+`C`
lo copia. Está encendido por defecto y se apaga con `:range-selection="false"`. Solo rige con
`selectionMode: 'cell'`: en `'row'` la unidad seleccionada es la fila entera y un rectángulo de
celdas no significaría nada.

| Gesto                                                  | Qué hace                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Arrastrar con el botón primario                        | Selecciona desde la celda donde se presionó hasta la que está debajo del puntero |
| `Shift`+clic                                           | Extiende hasta la celda clickeada, sin mover la celda activa                     |
| `Shift`+ flecha / `Inicio` / `Fin` / `RePág` / `AvPág` | Extiende con el teclado                                                          |
| `Ctrl`/`Cmd`+`A`                                       | Selecciona la grilla entera                                                      |
| `Ctrl`/`Cmd`+`C`                                       | Copia la selección como TSV                                                      |
| Un clic simple, una flecha sin `Shift`, `Tab`          | **Colapsa** el rango: vuelve a una sola celda                                    |

`Shift`+`Tab` queda afuera a propósito: es la única tecla donde `Shift` ya significaba otra cosa —"la
celda anterior"—, y esa otra cosa la espera todo el mundo.

#### El rango no es un segundo estado de selección

**El ancla del rango ES la celda activa.** El rango agrega una sola cosa al estado que ya existía: la
punta que se mueve. Eso elimina de raíz el estado imposible que tendría un `selectedRange`
independiente —un rectángulo que no contiene a la celda activa— y explica todo lo demás sin reglas
extra: arrastrar y extender con `Shift` no mueven la celda activa, y cualquier movimiento que sí la
mueva colapsa el rango, porque el ancla se fue a otro lado.

Por eso el rango se guarda como **dos posiciones** y no como una lista de celdas. El rectángulo se
resuelve contra las columnas visibles en el momento de pintarlo: ocultar una columna de adentro lo
angosta, ocultar una de las puntas lo deja sin dibujar —igual que la celda activa deja de pintarse
cuando ocultan su columna— y volver a mostrarla lo devuelve intacto.

`Ctrl`+`A` es la única diferencia con una hoja de cálculo: lleva la celda activa a la esquina superior
izquierda. El rectángulo se define entre las dos puntas, así que dejar el ancla donde estaba habría
seleccionado solo el cuadrante que le queda por delante.

#### Qué se dibuja

| Enganche                     | Qué es                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `.dt-cell--range`            | Tinte de una celda del rango. La celda **ancla no lo lleva**, igual que en una hoja de cálculo.                                           |
| `.dt-range-box`              | Un solo nodo con las cuatro líneas del contorno y el cuadradito de la esquina inferior derecha.                                           |
| `.dt-copy-flash`             | Confirma un copiado: la línea va del acento a `--dt-copy-flash-color` y vuelve. Existe solo mientras dura. Ver [el copiado](#el-copiado). |
| `[data-range]` en `.dt-root` | `'true'` mientras hay un rectángulo. Es lo que apaga el anillo de la celda activa y el realce de su fila.                                 |

El contorno es **un nodo** y no un borde por celda. Con bordes habría que saber cuál celda es la del
extremo de cada lado, y el pool no lo sabe: recicla sus nodos por slot de viewport, no por posición
visual. Además, un borde correría el contenido de cada celda del rango. El tinte sí es por celda,
porque tiene que quedar debajo del texto.

Con un rango vivo, la celda activa pierde su anillo y su fila el realce: serían dos señales más para
una selección que ya tiene la suya, y un anillo dibujado adentro del rectángulo es justo lo que
confunde sobre dónde empieza y dónde termina lo seleccionado.

El cuadradito de la esquina —el _fill handle_ de una hoja de cálculo— **es una marca de extremo y nada
más**: señala dónde termina el rango cuando el borde inferior queda fuera de pantalla. No arrastra.

#### El copiado

`Ctrl`+`C` copia el rectángulo como **TSV**: tabulación entre columnas, salto de línea entre filas.
Es lo que Excel, Google Sheets, Numbers y LibreOffice interpretan como una tabla al pegar.

Se copia **lo que se ve**, no el valor guardado. Una columna `badge` aporta la etiqueta de su opción
y no su `value`; `number` aporta el texto con separadores de miles; `tags` junta sus etiquetas en una
sola celda. Eso sale de [`CellRenderer.text`](#escribir-un-renderer-propio), que es una función pura
del contexto, y por eso funciona igual para una fila pintada que para una que no lo está: **de un
rango de 5.000 filas hay unas treinta con nodo en el DOM**, así que el texto no puede leerse de la
pantalla, hay que calcularlo.

Tres detalles del formato:

- Un valor que contiene una tabulación, un salto de línea o una comilla se **encierra entre comillas**
  y sus comillas internas se duplican, que es la convención que entienden las planillas. Sin eso, esa
  tabulación partiría la fila y correría todo lo que tuviera a la derecha.
- Las **cabeceras de grupo** que caigan dentro del rango no aportan una línea. No son filas del
  dataset y su etiqueta no pertenece a ninguna de las columnas copiadas.
- Con un **editor abierto**, la tabla no toca el portapapeles: el foco está en el `<input>` y el
  usuario está copiando lo que seleccionó ahí adentro.

La escritura ocurre dentro del evento `copy` del navegador, que es la única vía que no pide permisos
ni depende de un contexto seguro. De regalo, copiar desde el menú contextual o desde la barra de
menús funciona igual que con el atajo.

**Un copiado se confirma cambiando el color de la línea.** El portapapeles no deja ninguna señal
visible, así que sin eso no hay forma de distinguir "se copió" de "el atajo se lo comió otra cosa".
El contorno de lo copiado viaja del color de acento a blanco y vuelve, en medio segundo. Lo que
cambia es el **color** y no la opacidad: un contorno que se apaga y se enciende compite con el fondo
y con el tinte de la selección —que están ahí mismo, con ese mismo color— y se pierde; invertir el
color mantiene la línea presente todo el tiempo y cambia lo único que no se confunde con otra cosa.

Es un nodo propio, `.dt-copy-flash`, montado sobre el área copiada y desmontado al terminar, así que
también confirma el copiado de **una sola celda**, donde no hay recuadro.

El color de destino es el token `--dt-copy-flash-color`, **blanco por defecto en los dos temas**.
Sobre el oscuro es el contraste máximo contra el acento; sobre el claro coincide con el fondo, así
que ahí la línea se apaga medio segundo en vez de encenderse —sigue leyéndose como una confirmación,
más sutil—.

El token vive en `.dt-root`, junto al resto, y el bloque de tema oscuro **no lo redefine**: eso es lo
que deja elegir un color por tema desde afuera, sin pelear con una regla más específica.

```css
/* Un color para cada tema. El selector es el mismo que usa la tabla. */
.dt-root[data-theme='dark'] {
  --dt-copy-flash-color: #ffffff;
}

.dt-root[data-theme='light'] {
  --dt-copy-flash-color: #111827;
}

/* O uno solo que se invierte con el tema, sin repetir nada. */
.dt-root {
  --dt-copy-flash-color: var(--dt-text);
}
```

Con `theme="auto"` el atributo vale `auto` y no `dark`/`light`, así que ahí el camino es la clase del
documento —`:root.dark .dt-root { ... }`— o directamente `var(--dt-text)`, que ya sigue al tema.

No se suprime con `prefers-reduced-motion`: no hay nada que se mueva ni que parpadee —es un cambio de
color de ida y vuelta en medio segundo— y es la única señal de que el copiado ocurrió.

#### La tabla ya no selecciona texto

Arrastrar significa "seleccionar estas celdas", así que la selección de texto del navegador está
**apagada en todo el subárbol** de la tabla (`user-select: none` en `.dt-root`). Los controles de
edición la recuperan, que es donde corresponde tenerla.

Eso arregla de paso un destello que parecía otra cosa: el doble clic que abre el editor seleccionaba
además la palabra bajo el puntero, y la celda pegaba un fogonazo azul justo antes de que el `<input>`
tomara el foco. Ese destello no era del editor.

#### Eventos y API

```vue
<DataTable
  :rows="rows"
  :columns="columns"
  row-key="id"
  @range-select="onRangeSelect"
  @range-copy="onRangeCopy"
/>
```

`rangeSelect` llega en cada paso del arrastre, así que **no trae las filas abarcadas**: un rango puede
cubrir 50.000, y materializarlas varias veces por segundo sería una avalancha de asignaciones. Trae
`rowStart`, `rowEnd` —posiciones de la secuencia visible, la excepción a la regla de que los eventos
reportan índices de `rows`, porque un rango puede abarcar cabeceras de grupo— y las `columns` ya
resueltas, que son decenas como mucho. Con `range` en `null` describe la selección de una sola celda.

`rangeCopy` llega **después** de haber escrito el portapapeles, con el texto exacto que se copió.

Desde el template ref, `selectRange({ anchor, focus })` fija el rango por código y `selectRange(null)`
lo colapsa. Mueve también la celda activa —el ancla y la celda activa son la misma posición— y
desplaza la vista hasta el foco.

#### Seleccionar una columna o una fila entera

Dos gestos más, los dos **apagados por defecto**:

| Prop              | Gesto                                | Qué selecciona                              |
| ----------------- | ------------------------------------ | ------------------------------------------- |
| `columnSelection` | Clic en el encabezado de una columna | Esa columna, de la primera fila a la última |

En una columna **ordenable** ese clic se lo queda el orden, y seleccionarla pasa a
`Ctrl`/`Cmd`+clic. Ver [Cuando conviven con `columnSelection`](#cuando-conviven-con-columnselection).
| `rowSelection` | Clic en el número de una fila | Esa fila, de la primera columna **visible** a la última |

**Lo que producen es un rango normal**, y de ahí sale todo lo demás sin una línea de código propia:
se copia con `Ctrl`+`C`, se extiende con `Shift`+flechas —bajar el foco de una fila entera la
convierte en un bloque de dos filas por todo el ancho, igual que en una hoja de cálculo— y se colapsa con un
clic en cualquier celda. Por eso **necesitan `rangeSelection` encendido y `selectionMode: 'cell'`**:
sin rango no hay forma de expresar "esta columna entera", y el gesto no hace nada en lugar de
seleccionar media cosa. `rowSelection` necesita además `showRowNumbers`, porque si no no hay dónde
hacer clic.

> `rowSelection` **no** es `selectionMode: 'row'`. Aquel cambia cuál es la unidad que marca un clic en
> una celda cualquiera; este agrega un gesto sobre la regleta.

Mientras hay una columna o una fila seleccionada, la marca viaja también por el encabezado
(`.dt-header-cell--range`) y por la regleta (`.dt-row-number--range`). No es decoración: el
rectángulo de una columna de 50.000 filas no entra en ningún viewport, así que sin esas dos marcas
scrollear al medio de la tabla dejaría la selección sin ninguna señal visible.

Un clic sobre el **handle de redimensionado** no selecciona la columna, aunque el handle viva dentro
del encabezado: terminar cada arrastre de ancho con la columna seleccionada sería una sorpresa en
cada resize.

#### Limitaciones

- **Arrastrar no auto-scrollea.** El rango crece hasta la celda que esté debajo del puntero, y si el
  puntero se va del viewport el rango se queda donde estaba. Para seleccionar más de lo que entra en
  pantalla: scrollear y `Shift`+clic, que es el camino corto incluso en una hoja de cálculo.
- **No hay pegado.** La tabla es controlada y nunca escribe sobre `rows`; un pegado tendría que pasar
  por la tubería de edición celda por celda, y eso todavía no existe.
- **El fill handle no arrastra**, como dice más arriba.

### Cómo se conecta

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import type { CellPosition, CellSelectEvent, SelectionMode } from 'vue-tablekit'

const selectionMode = shallowRef<SelectionMode>('cell')
const activeCell = shallowRef<CellPosition | null>(null)

function onCellSelect(event: CellSelectEvent<Invoice>): void {
  console.log(event.rowIndex, event.columnKey, event.value)
}
</script>

<template>
  <DataTable
    v-model:active-cell="activeCell"
    :selection-mode="selectionMode"
    :rows="rows"
    :columns="columns"
    row-key="id"
    @cell-select="onCellSelect"
  />
</template>
```

`update:activeCell` se emite ante cualquier cambio, incluido el paso a `null`. `cellSelect` se emite
solo cuando la posición nueva resuelve a una fila real y a una columna visible, y lleva la fila, la
definición de columna y el valor ya leído por el `accessor` de la columna, así que un panel de
detalle no tiene que buscar nada.

Ninguno de los dos se emite cuando la selección se fija en la celda que ya estaba activa.

### Cómo se relacionan selección y edición

- Seleccionar nunca abre un editor, y abrir un editor nunca mueve la selección.
- El editor sigue pasando por `beforeEdit`, así que un veto lo detiene y deja la celda seleccionada.
- `Enter` dentro del editor commitea **y baja la selección una fila**, como en una hoja de cálculo. El
  movimiento ocurre persista o no el padre el valor: es navegación, no edición.
- Sacar la fila editada de la ventana virtual commitea y cierra el editor; la selección se queda en
  esa celda.

### Accesibilidad

**La grilla es `.dt-root`**, la raíz del componente: es la caja que lleva los recuentos y la que el
consumidor tiene en la mano. El viewport scrollea y recibe el teclado, y queda sin rol.

Desde que el encabezado vive adentro del viewport, el rol también podría vivir ahí —los dos `rowgroup`
son suyos—. Se dejó en la raíz para no cambiar el contrato público ni separar al elemento que anuncia
la grilla del que recibe el foco. ARIA no exige que la grilla sea el contenedor con scroll.

La estructura completa, de afuera hacia adentro:

```
.dt-root                          role="grid" | "treegrid"   aria-rowcount, aria-colcount
└── .dt-viewport                  — sin rol: scrollea y recibe el teclado
    ├── .dt-header                role="rowgroup"            sticky contra el borde de arriba
    │   └── .dt-header-row        role="row"                 aria-rowindex="1"
    │       ├── .dt-corner        aria-hidden                solo con numeración
    │       └── .dt-header-pinned / .dt-header-inner   role="none"
    │           └── .dt-header-cell  role="columnheader"     aria-colindex
    ├── .dt-canvas                role="rowgroup"
    │   └── .dt-row               role="row"                 aria-rowindex
    │       ├── .dt-pinned-lane   role="none"                sticky contra los bordes laterales
    │       │   └── .dt-cell      role="gridcell"            aria-colindex
    │       └── .dt-cell          role="gridcell"            aria-colindex
    └── .dt-gutter                aria-hidden                sticky contra el borde izquierdo
```

| Elemento               | Atributos                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dt-root`             | `role="grid"` —o `role="treegrid"` con agrupación activa—, `aria-rowcount` (entradas visibles **+ 1** por la fila de encabezado), `aria-colcount` (columnas visibles)            |
| `.dt-header`           | `role="rowgroup"`                                                                                                                                                                |
| `.dt-header-row`       | `role="row"`, `aria-rowindex="1"`: es LA fila de encabezado. Sus tiras internas van con `role="none"`, para que los `columnheader` sigan perteneciéndole a ella                  |
| `.dt-header-cell`      | `role="columnheader"`, `aria-colindex` (base 1 sobre las columnas **visibles**)                                                                                                  |
| `.dt-viewport`         | Sin rol propio. `tabindex="0"` salvo con `selectionMode` en `'none'`, y el manejador de teclado                                                                                  |
| `.dt-canvas`           | `role="rowgroup"`                                                                                                                                                                |
| `.dt-row`              | `role="row"`, `aria-rowindex` (base 1, corrido por la fila de encabezado: la fila de datos `0` reporta `2`), `aria-selected` en modo `'row'`, `aria-level` con agrupación activa |
| `.dt-row.dt-group-row` | Además: `aria-expanded`, `aria-level` (base 1, igual a `depth + 1`), `aria-posinset` y `aria-setsize` entre sus hermanos de nivel                                                |
| `.dt-cell`             | `role="gridcell"`, `aria-colindex` (base 1 sobre las columnas **visibles**, así que una columna oculta no ocupa slot), `aria-selected` en modo `'cell'`                          |

`aria-sort` **no** aparece, y no es un olvido: no hay ordenamiento (ver [Limitaciones](#limitaciones)).
Anunciar una columna como ordenable donde no se puede ordenar sería peor que no anunciar nada.

**Cómo se asocia una celda con el nombre de su columna.** Por la estructura, no por un atributo extra.
Un `columnheader` dentro de la misma grilla es lo que hace que la mayoría de los lectores de pantalla
anuncien el nombre de la columna al entrar en una celda; `aria-colindex` es lo que mantiene alineados
los dos lados cuando la virtualización horizontal cambia qué columnas hay pintadas y cuando el usuario
oculta o reordena columnas. Antes solo existía el lado del cuerpo, y una asociación necesita dos.

La alternativa era un `aria-describedby` por celda apuntando al id de su encabezado. Se descartó por
costo, y el costo está medido: es una escritura de atributo **por celda** cada vez que un slot cambia
de columna —diez más por paso de scroll horizontal sobre una ventana de diez filas, y una más por
celda entrante en cada paso vertical—, todo sobre el camino caliente. El `columnheader` cuesta cero:
es un atributo estático que Vue escribe al montar.

El índice es 1..N sobre las columnas **visibles**, así que ocultar o reordenar columnas mueve los dos
lados juntos y una columna oculta no deja un hueco en la numeración.

**Las celdas no son enfocables y no llevan `tabindex`.** La posición activa es estado del componente,
no el foco del DOM, y eso es consecuencia directa del reciclado de nodos: el nodo que muestra una fila
puede quedar reasignado a otra en mitad de un scroll, así que el foco dejaría de señalar la celda que
el usuario eligió. Hubo un `tabindex="-1"` por celda y trajo un problema visible: la celda tomaba foco
real al hacer clic y el navegador le pintaba su propio anillo de `:focus-visible` —del mismo color que
`.dt-cell--active`— en cuanto el usuario tocaba una flecha, con lo que se veían **dos** celdas
seleccionadas a la vez. La marca de selección es `dt-cell--active`, y es la única.

**El foco y el teclado no se movieron con el rol.** Siguen en `.dt-viewport`, que es la caja que
scrollea: es donde tiene sentido que aparezca el anillo de foco, es el **único** elemento enfocable de
la tabla y es el elemento al que el usuario le está mandando las teclas de desplazamiento. El
manejador escucha ahí y la posición activa sigue siendo estado del componente, no el nodo enfocado.
Un clic sobre una celda lleva el foco al viewport de forma explícita —salvo con `selectionMode` en
`'none'`, donde la tabla no le quita el foco a nadie—, y cerrar el editor se lo devuelve, para que la
tecla siguiente a un Escape siga llegando.

**Ese anillo de foco está apagado por defecto, y eso tiene un costo.** Sin celda activa y con
`focusRing: false`, entrar con `Tab` no produce ninguna señal visual. El valor por defecto evita que
cada selección encierre la tabla entera en un borde de color, que es lo que pasaba con el anillo
incondicional; la contrapartida está descrita, con las dos formas de cubrirla, en
[El anillo de foco del viewport](#el-anillo-de-foco-del-viewport).

> **Lo único que queda afuera del contrato.** El mensaje de `emptyText` se renderiza como un `div`
> dentro de `.dt-root`, o sea dentro de la grilla, y no es una fila. Solo aparece con `rows` vacío,
> cuando la grilla no tiene ninguna fila de datos que pueda entrar en conflicto con él.

---

## Métodos expuestos

Se llegan a través de un template ref cuando las props declarativas no alcanzan.

```ts
const table = useTemplateRef<DataTableInstance>('table')
```

| Método                 | Descripción                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scrollToRow(index)`   | Desplaza hasta que `index` sea la primera fila completamente visible. **Acota** el índice. Con grupos recorre la secuencia visible.                                          |
| `scrollToColumn(key)`  | Desplaza hasta que esa columna quede en el borde izquierdo. No hace nada si está oculta ni con una clave desconocida.                                                        |
| `scrollToCell(pos)`    | Desplaza lo mínimo necesario para traer esa celda a la vista. No centra y no mueve la selección. **No acota** el índice de fila.                                             |
| `selectCell(pos)`      | Fija la celda activa, o la limpia con `null`. **Además la trae a la vista**, a diferencia de una selección interna.                                                          |
| `selectRange(range)`   | Fija el rango, o lo colapsa con `null`. Mueve también la celda activa —es el ancla— y desplaza hasta el foco. Ver [Selección de un rango](#selección-de-un-rango-de-celdas). |
| `refresh()`            | Invalida todos los valores de celda cacheados, rehace el árbol de grupos **y agenda un repintado en el próximo frame**.                                                      |
| `refreshRows()`        | Solo en modo servidor. Olvida qué páginas se pidieron y vuelve a pedir lo que falte. Es la vía para reintentar después de un error de red. Fuera del modo, no hace nada.     |
| `resetLayout()`        | Descarta el layout guardado y vuelve visibilidad, orden, anchos y agrupación a sus valores por defecto. Es el "restablecer columnas".                                        |
| `flushPersistence()`   | Escribe de inmediato el layout pendiente por el debounce. El desmontaje ya vuelca lo pendiente por su cuenta.                                                                |
| `toggleGroup(groupId)` | Invierte el estado de un grupo por su `groupId`, que se construye con [`groupId(...)`](#groupid-cómo-se-escribe-un-id).                                                      |
| `expandAllGroups()`    | Expande todos los grupos del árbol actual.                                                                                                                                   |
| `collapseAllGroups()`  | Colapsa todos los grupos del árbol actual.                                                                                                                                   |

`selectCell` desplaza y el camino interno de clic y teclado no lo necesita, porque el código que la
llama —un resultado de búsqueda, un enlace profundo— no tiene forma de saber si esa celda estaba
dentro de la ventana. Emite `update:activeCell` y `cellSelect` exactamente igual que un clic.

### Qué pasa con una columna oculta y con una desconocida

Los cuatro métodos que reciben una clave de columna la resuelven contra las columnas **visibles**.
Una columna oculta —por el selector de columnas, por un layout restaurado o por
`defaultVisible: false`— no resuelve, exactamente igual que una clave que no corresponde a ninguna
columna declarada. **Los dos casos se comportan idénticamente** y ninguno avisa por consola ni lanza:
ocultar una columna es una acción normal del usuario, y un método que se quejara de eso se quejaría
durante el uso corriente.

| Método                 | Columna oculta                                                                                                                                                                   | Clave desconocida |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `scrollToColumn(key)`  | No hace nada.                                                                                                                                                                    | Igual.            |
| `scrollToCell(pos)`    | **Mueve el eje vertical, no el horizontal.**                                                                                                                                     | Igual.            |
| `selectCell(pos)`      | Guarda la posición y emite `update:activeCell`, pero no emite `cellSelect`, no pinta ninguna celda y deja `data-active-cell="false"`. Desplaza según la regla de `scrollToCell`. | Igual.            |
| `toggleGroup(groupId)` | No aplica: recibe un id de grupo, no una clave de columna.                                                                                                                       | —                 |

**Por qué `scrollToCell` mueve un solo eje.** Porque son dos coordenadas independientes. `rowIndex`
es un número de fila válido sin importar qué diga `columnKey`, así que se resuelve el eje sobre el
que sí había información y se deja quieto el otro. Cortar del todo sería peor, y no en un caso
rebuscado: cuando el usuario oculta la columna donde está parado, la navegación vertical dejaría de
traer filas a la vista por un motivo que no tiene nada que ver con el eje vertical.

**Por qué `scrollToRow` acota y `scrollToCell` no.** La asimetría es real y responde a de dónde viene
cada índice. `scrollToRow` es un salto absoluto que pide el consumidor con un número suelto, y
acotarlo convierte un índice fuera de rango en el borde más cercano en vez de en una posición vacía.
La posición que llega a `scrollToCell` ya viene acotada por el camino de navegación interno, así que
volver a acotarla sería trabajo repetido en cada flecha. Con un índice fuera de rango, el navegador
acota la escritura del scroll contra la altura real del canvas y la vista queda en el extremo.

**Cuándo hace falta `refresh()` de verdad.** El caché de pintado se indexa por el valor crudo de la
celda, así que un valor que cambió se repinta solo, _en el próximo frame que alguien agende_. Los
frames los agendan el scroll, el cambio de tamaño y los cambios en `rows`, `columns`, `stripe`,
`virtualizeColumns`, la altura de fila, las columnas resueltas, el modo de selección, la celda activa,
la celda en edición y la vista aplanada. De ahí salen dos consecuencias:

- Si se muta un objeto de fila **en el lugar** y nada más cambia, no se agenda ningún frame y la
  pantalla no se actualiza. Hay que llamar a `refresh()`, o reemplazar el array (el patrón
  controlado).
- Si `format` o `cellClass` empiezan a devolver algo distinto **sin que cambien sus argumentos**
  —porque cierran sobre un locale, una cotización, un conjunto de selección—, el caché tiene razón
  sobre sus entradas y se equivoca sobre su salida. `refresh()` es la forma de avisarle.

Con agrupación activa hay una tercera: los contadores y los agregados salen del árbol de grupos, que
se reconstruye por IDENTIDAD de `rows`. Una mutación en el lugar tampoco la mueve, así que sin
`refresh()` las cabeceras seguirían anunciando los totales anteriores mientras las celdas ya muestran
los nuevos. `refresh()` cubre las tres cosas de una vez.

---

## Columnas

Una columna es configuración, no estado. Se lee en cada pintado, lo que deja a `format` y a
`cellClass` directamente sobre el camino caliente del scroll.

```ts
interface DataTableColumn<TRow> {
  key: string
  label?: string
  width?: number
  minWidth?: number
  maxWidth?: number
  resizable?: boolean
  align?: 'left' | 'center' | 'right'
  editable?: boolean
  format?: (value: CellValue, row: TRow, rowIndex: number) => string
  formatAggregate?: (value: CellValue, column: DataTableColumn<TRow>) => string
  cellClass?: (value: CellValue, row: TRow, rowIndex: number) => string | undefined
  accessor?: (row: TRow) => CellValue
  renderer?: string | CellRenderer<TRow>
  hideable?: boolean
  defaultVisible?: boolean
  editor?: 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'slot'
  options?: readonly CellOption[]
  min?: number
  max?: number
  step?: number
  groupable?: boolean
  aggregate?: ColumnAggregation<TRow>
}
```

| Campo                   | Por defecto                                    | Notas                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                   | —                                              | Id único, y también la clave de datos por defecto (`row[key]`).                                                                                                                                                           |
| `label`                 | `key`                                          | Texto del header.                                                                                                                                                                                                         |
| `width`                 | `defaultColumnWidth` (150)                     | Siempre acotado a `[max(32, minWidth), min(4000, maxWidth)]`.                                                                                                                                                             |
| `minWidth` / `maxWidth` | `32` / `4000`                                  | Se aplican al resolver el ancho y durante el redimensionado.                                                                                                                                                              |
| `resizable`             | `false`                                        | Muestra un handle de arrastre en el borde del header.                                                                                                                                                                     |
| `sortable`              | `false`                                        | `true`: el clic en el encabezado ordena, y el menú también. `'menu'`: **solo desde el menú**, el clic no hace nada. Ver [Ordenamiento](#ordenamiento).                                                                    |
| `comparator`            | —                                              | Comparador propio en sentido ascendente, `(a, b) => number`. Solo lo usa `sortRows`. Hace falta cuando el orden natural del valor no es el que el usuario espera.                                                         |
| `menu`                  | `true`                                         | En `false`, la columna no muestra el menú de tres puntos aunque la tabla lo tenga encendido.                                                                                                                              |
| `pinned`                | —                                              | `'start'` o `'end'` anclan la columna a un borde: se queda a la vista mientras el resto scrollea. Manda sobre el orden y desactiva el arrastre de esa columna. Ver [Columnas ancladas](#columnas-ancladas).               |
| `pinnable`              | `false`                                        | A qué borde lleva el **botón**: `true` y `'start'` al izquierdo, `'end'` al derecho, `'menu'` sin botón. El **menú ofrece siempre los dos**. Ver [Anclar desde el encabezado](#anclar-desde-el-encabezado).               |
| `reorderable`           | `true`                                         | `false` ancla la columna: no se la puede agarrar para moverla y ninguna otra puede cruzarla, así que se queda donde está. Solo interviene con `columnReorder` encendido.                                                  |
| `align`                 | el `defaultAlign` del renderer, si no `'left'` | Un `align` explícito siempre gana. Se aplica como clase, no como estilo inline.                                                                                                                                           |
| `editable`              | `false`                                        | Tiene que ser exactamente `true` para que la celda se pueda editar.                                                                                                                                                       |
| `format`                | —                                              | Valor crudo → el string que se escribe en la celda. **Debe ser puro y barato.** No se aplica a los agregados: para eso está `formatAggregate`.                                                                            |
| `formatAggregate`       | —                                              | Valor agregado → el string que se escribe en la cabecera de grupo. Ver [Formato de los agregados](#formato-de-los-agregados).                                                                                             |
| `cellClass`             | —                                              | Clase CSS extra sobre el elemento de celda. También está en el camino caliente.                                                                                                                                           |
| `accessor`              | `row[key]`                                     | Lee el valor desde la fila. Devuelve `CellValue`: no puede devolver un objeto ni un array.                                                                                                                                |
| `renderer`              | `'text'`                                       | Nombre de un renderer registrado, o una implementación. Un nombre desconocido cae en `'text'` en lugar de lanzar, y **avisa por consola en desarrollo**. Ver [Un nombre desconocido avisa](#un-nombre-desconocido-avisa). |
| `hideable`              | `true`                                         | `false` deja la columna fuera de `DataTableColumnToggle`.                                                                                                                                                                 |
| `defaultVisible`        | `true`                                         | Visibilidad inicial. La persistencia y el v-model tienen prioridad sobre esto.                                                                                                                                            |
| `editor`                | inferido (ver más abajo)                       | El control que se abre al editar. `'slot'` lo delega al slot `#editor`. Ver [Componentes de terceros](#componentes-de-terceros-dentro-de-una-celda).                                                                      |
| `options`               | —                                              | Alimenta los renderers `badge` / `select` / `tags`, **el** editor `select` y la etiqueta de las cabeceras de grupo. Una sola fuente de verdad.                                                                            |
| `min`/`max`/`step`      | —                                              | Se trasladan a los atributos del input del editor `number`.                                                                                                                                                               |
| `groupable`             | `true`                                         | `false` hace que una clave suya dentro de `groupBy` se descarte. No oculta la columna. Ver [Agrupación](#agrupación).                                                                                                     |
| `aggregate`             | —                                              | Agregación que esta columna muestra en las cabeceras de grupo: una incluida o una función propia.                                                                                                                         |

### `renderer` y `editor` son dos ejes independientes

Cómo se **ve** una celda y cómo se **edita** son decisiones separadas. Un badge puede ser de solo
lectura y una celda de texto plano puede abrir un desplegable. Acoplarlos obligaría a inventar un
renderer por cada combinación.

```ts
// Se ve como un badge liso (sin chevron), pero se edita con un desplegable.
{ key: 'priority', renderer: 'badge', editor: 'select', editable: true, options: PRIORITIES }

// Se ve como un desplegable (badge + chevron) y no es editable en absoluto.
{ key: 'status', renderer: 'select', options: STATUSES }
```

### Inferencia del editor

Cuando falta `column.editor`, el tipo se infiere a partir del **valor actual de la celda**, en este
orden:

| #   | Condición                      | Editor     |
| --- | ------------------------------ | ---------- |
| 1   | `column.editor` está definido  | ese        |
| 2   | el valor es `boolean`          | `checkbox` |
| 3   | el valor es `number`           | `number`   |
| 4   | el valor es `Date`             | `date`     |
| 5   | `column.options` no está vacío | `select`   |
| 6   | en cualquier otro caso         | `text`     |

El tipo del valor le gana a `options` a propósito: una columna booleana con dos opciones sigue siendo
una casilla y no un desplegable de dos ítems. Y `options` le gana al fallback de texto porque una
lista declarada es una intención explícita de acotar los valores posibles.

`'slot'` es el único valor que **nunca** sale de la inferencia: no hay ninguna forma de un dato que
signifique "el control lo pone el consumidor", así que declararlo es la única manera de pedirlo. Ver
[Componentes de terceros dentro de una celda](#componentes-de-terceros-dentro-de-una-celda).

El editor `checkbox` no tiene control flotante: la casilla vive dentro de la celda. Hacerle clic es
una _intención_: el pool revierte el estado visual de inmediato y manda el cambio por la misma
tubería `beforeEdit` → `editCommit` → `afterEdit`, así que un veto no se puede esquivar por ahí.

El editor `date` va y vuelve en UTC de los dos lados. Mezclar hora local y UTC es el origen clásico
del bug de "la fecha se corrió un día".

---

## Renderers

Un renderer es una **estrategia sin estado**: `create` construye la estructura interna de una celda
una vez, y `update` la muta en cada repintado. Una única instancia compartida por nombre atiende a
todas las celdas.

Vienen ocho registrados. Se elige uno con `renderer: '<nombre>'`.

### Dos modos de maquetado: texto y caja

Un renderer declara con `layout` cómo quiere que su celda **centre verticalmente** el contenido. Es un
eje independiente de `align`, que decide el centrado horizontal y significa exactamente lo mismo en
los dos modos.

| `layout`           | Quiénes                                                     | Cómo centra la celda                                                  |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `'text'` (default) | `text`, `number`                                            | `line-height` igual a la altura de fila                               |
| `'box'`            | `badge`, `select`, `progress`, `avatar`, `checkbox`, `tags` | `display: flex` + `align-items: center`, con la clase `.dt-cell--box` |

La razón de que haya dos y no uno: la celda de texto **necesita** el centrado por `line-height`,
porque `text-overflow: ellipsis` no se aplica al texto anónimo dentro de un contenedor flex y el
recorte con puntos suspensivos es justo lo que hace falta en una celda de ancho fijo. Pero ese
centrado solo funciona para texto. Una caja en línea se ubica con `vertical-align: middle`, que no
apunta al centro geométrico de la línea sino a la línea base más media altura de x: con la altura de
línea puesta en la altura de fila, esos dos puntos no coinciden y toda caja quedaba uno o dos píxeles
más abajo de lo que debía, mientras el texto plano se veía perfecto.

El modo es metadato del renderer, no estado de la celda, así que **solo puede cambiar cuando un slot
reciclado pasa a otro tipo de renderer**: es la misma condición que ya obliga a reconstruir el nodo, y
por eso la clase no cuesta ni una escritura por frame de scroll.

Un renderer que no declara `layout` se comporta como `'text'`, igual que antes de que este eje
existiera.

### `text` — el que viene por defecto

Escribe el valor como texto plano. Usa `column.format` cuando existe y, si no, la representación
incluida: `Date` → string ISO, y todo lo demás → `String(value)`.

Los objetos y los arrays llegan ya convertidos a string (el camino del valor se estrecha a
`CellValue`), así que se muestran como `[object Object]`. Es deliberado: una celda en blanco
escondería el problema, y esta señala una columna que necesita un `accessor` o un `format`.

### `number` — alineado a la derecha, con separador de miles

Acepta un `number`; un string numérico se parsea. `null`, `undefined` y `NaN` se renderizan como
**string vacío**, no como `"NaN"`: en una columna de dinero, `NaN` se lee como dato corrupto.
`defaultAlign: 'right'`, así que el header se alinea con las celdas sin que nadie lo pida.

El `Intl.NumberFormat` se construye una sola vez, a nivel de módulo. Construirlo dentro de `update`
significaría una instancia por celda y por frame.

### `badge` — una píldora de color

Resuelve el valor contra `column.options`, primero por identidad y después por su forma de texto (un
backend puede devolver `"1"` donde las opciones declaran `1`). Los valores desconocidos se renderizan
con **el valor crudo y el color neutro**, nunca con una celda en blanco: un estado que la UI no
conoce sigue siendo un dato que el usuario necesita. Sin `options` se comporta como un badge neutro
que muestra el valor.

El color se escribe como una única custom property, `--dt-badge-color`; la hoja de estilos deriva de
ahí el fondo teñido.

### `select` — badge más un chevron

El mismo manejo de valores que `badge`, más un chevron que señala "esto abre". Por sí solo **no**
abre nada: el desplegable es el _editor_ `select`. El SVG del chevron se construye una vez en
`create` y no se vuelve a tocar.

### `progress` — un anillo SVG con un porcentaje

Acepta de `0` a `100`; un string numérico se parsea. Los valores fuera de rango se acotan. `null`,
`undefined` y `NaN` se tratan como `0`: un anillo vacío se lee como "sin progreso" y una celda en
blanco se lee como algo roto.

La etiqueta es `column.format` cuando existe y, si no, `` `${Math.round(percent)}%` ``. El color del
anillo sale de umbrales: `≥100` verde, `≥60` azul, `≥30` ámbar, y por debajo rojo.

### `avatar` — iniciales o una foto

Acepta un `string` con el nombre, o un objeto `{ name, src }` leído desde `ctx.raw`. Con `src`
muestra la imagen; sin él, hasta dos iniciales (la primera letra de la primera y de la última
palabra). Cualquier otra cosa se convierte a string y se usa como nombre. Un nombre vacío deja un
círculo neutro sin iniciales, que se lee como "sin asignar".

Como necesita la forma de objeto, **a esta columna no hay que darle un `accessor`**: un accessor
devuelve `CellValue`, que no puede expresar un objeto. El `{ name, src }` va en la fila, bajo
`column.key`.

El color es un hash djb2 estable del nombre contra una paleta fija, no un contador ni un índice de
fila. Es la única manera de que la misma persona conserve el mismo color entre sesiones y, sobre
todo, después de que el pool recicle el nodo: un color derivado de la posición haría parpadear los
avatares durante el scroll.

### `checkbox` — un `<input type="checkbox">` de verdad

Acepta un `boolean`; cualquier otra cosa se lee por verdad lógica. `null` y `undefined` producen el
estado **indeterminado**, que es visualmente distinto de "sin marcar": "todavía sin responder" no es
lo mismo que "respondido que no". El input está `disabled` salvo que la columna sea `editable`.

Se usa un input nativo para que el soporte de teclado, el rol de accesibilidad, el estado
indeterminado y los anuncios del lector de pantalla salgan correctos por defecto.

### `tags` — varias píldoras a partir de un valor de lista

Lee un array desde `ctx.raw`; cada entrada se resuelve contra `column.options` para obtener su
etiqueta y su color. Un valor que no es un array se trata como una lista de un solo elemento, así que
una columna puede pasar de simple a múltiple sin cambiar de renderer. Vacío, `null` y `''` no dibujan
nada: una lista vacía es un estado legítimo. Las entradas desconocidas muestran su texto crudo con el
color neutro.

Es el único renderer incluido que puede crear nodos dentro de `update`, porque la cantidad de
píldoras depende de los datos. Aplica la misma disciplina un nivel más abajo: las píldoras se poolean
por celda, crecen solo cuando se supera la marca máxima histórica, y las sobrantes se ocultan en
lugar de eliminarse.

### Escribir un renderer propio

**La regla dura: `create` corre una vez por nodo de celda, `update` corre en cada repintado y solo
debe mutar lo que `create` construyó.** Dentro de `update` no se debe:

- crear nodos,
- leer layout (`getBoundingClientRect`, `offsetWidth`, `getComputedStyle`),
- escribir nada que no haya cambiado.

Las tres cosas tienen la misma raíz: `update` corre por cada celda visible y por cada frame. Crear
nodos genera basura que el recolector cobra más tarde como un frame perdido; leer layout fuerza un
reflow síncrono en mitad del pintado; escribir de más invalida estilos para nada.

El estado por celda conviene guardarlo en un `WeakMap` indexado por el handle, y cachear el último
valor escrito para que una escritura redundante sea de verdad un no-op.

Si el renderer construye una **caja** —cualquier cosa que no sea texto suelto: una píldora, un
círculo, una barra, un control— conviene declararle `layout: 'box'`. Sin eso la celda lo centra por
altura de línea y queda un par de píxeles bajo. Ver
[Dos modos de maquetado](#dos-modos-de-maquetado-texto-y-caja).

Y si la celda muestra algo distinto del valor crudo, conviene declarar también **`text(ctx)`**: es el
texto plano que se copia al portapapeles desde una celda de esa columna. Es opcional y una función
**pura** —sin handle, sin DOM—, y tiene que serlo: la tabla está virtualizada, así que de un rango de
5.000 filas hay unas treinta con nodo, y el texto de las otras 4.970 hay que calcularlo. Sin ella,
esas celdas se copian con la representación por defecto del valor. Los ocho renderers incluidos la
derivan del mismo helper que usa su `update`, para que lo copiado no pueda separarse de lo pintado.
Ver [el copiado](#el-copiado).

**Por columna (lo más simple: `TRow` es concreto):**

```ts
import type { CellRenderContext, CellRenderer, CellRendererHandle } from 'vue-tablekit'

type BarState = { bar: HTMLElement; width: string }
const barStates = new WeakMap<CellRendererHandle, BarState>()

const barRenderer: CellRenderer<Invoice> = {
  type: 'bar',
  defaultAlign: 'right',
  // La barra es una caja, no texto: la celda la centra con flex.
  layout: 'box',

  create(cell: HTMLElement): CellRendererHandle {
    const bar = document.createElement('span')
    bar.className = 'bar'
    cell.appendChild(bar)
    const handle: CellRendererHandle = { root: cell }
    barStates.set(handle, { bar, width: '' })
    return handle
  },

  update(handle: CellRendererHandle, ctx: CellRenderContext<Invoice>): void {
    const state = barStates.get(handle)
    if (!state) return
    const percent = typeof ctx.value === 'number' ? Math.min(100, Math.max(0, ctx.value)) : 0
    const width = `${percent}%`
    if (state.width === width) return // se saltea la escritura redundante
    state.width = width
    state.bar.style.width = width
  },

  // Opcional: qué texto se copia al portapapeles desde una celda de esta columna.
  text(ctx: CellRenderContext<Invoice>): string {
    return typeof ctx.value === 'number' ? `${ctx.value}%` : ''
  },

  destroy(handle: CellRendererHandle): void {
    barStates.delete(handle)
  },
}

const column: DataTableColumn<Invoice> = { key: 'total', renderer: barRenderer }
```

**Registrado globalmente (usable por nombre desde cualquier tabla):**

```ts
import { registerRenderer } from 'vue-tablekit'
import type { CellRenderContext, CellRendererHandle } from 'vue-tablekit'

registerRenderer('bar', () => ({
  type: 'bar',
  defaultAlign: 'right',
  layout: 'box',
  create(cell: HTMLElement): CellRendererHandle {
    /* igual que arriba */
  },
  // Notar el `update` genérico: un renderer registrado atiende cualquier forma de fila.
  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    /* igual que arriba */
  },
  destroy(handle: CellRendererHandle): void {
    /* igual que arriba */
  },
}))

const column: DataTableColumn<Invoice> = { key: 'total', renderer: 'bar' }
```

Un renderer registrado **no puede** depender de la forma de la fila, y está bien que sea así. Si
necesita conocer `TRow`, su lugar es una columna concreta y no el registro global. Volver a registrar
un nombre reemplaza la fábrica y descarta la instancia memoizada; los nodos existentes se
reconstruyen apenas cambia el tipo.

Lo que recibe `update`:

| Campo       | Tipo                    | Notas                                                                             |
| ----------- | ----------------------- | --------------------------------------------------------------------------------- |
| `value`     | `CellValue`             | Ya leído por `column.accessor`, estrechado a un primitivo o a `Date`.             |
| `raw`       | `unknown`               | El valor sin normalizar. Es donde sobreviven los arrays y los objetos. Validarlo. |
| `row`       | `TRow`                  | La fila completa, para los renderers que necesitan más de una columna.            |
| `rowIndex`  | `number`                | Índice dentro de la prop `rows`.                                                  |
| `column`    | `DataTableColumn<TRow>` | Con su `format` y sus `options`.                                                  |
| `isEditing` | `boolean`               | Si esta celda tiene el editor abierto encima.                                     |

También se puede componer sobre los incluidos: todos se exportan como instancias (`badgeRenderer`,
`avatarRenderer`, …) junto con `createTextRenderer()` y `resolveRenderer()`.

### Un nombre desconocido avisa

Una columna que declara `renderer: '<nombre>'` con un nombre que nadie registró **cae en `text`**: la
celda muestra el valor como texto plano y la tabla sigue funcionando. Eso es deliberado —resolver el
renderer ocurre dentro del pintado, y lanzar ahí dejaría la tabla en blanco en lugar de mostrar el
dato—, pero degradar en silencio esconde el error: lo único visible es una columna que se ve distinta
de lo esperado.

Por eso, **en desarrollo**, el primer renderer desconocido emite un `console.warn` con el nombre que
falló, la lista completa de nombres registrados y cómo registrar uno propio:

```
[DataTable] `column.renderer: 'badeg'` no corresponde a ningún renderer registrado. La celda se
pintó con `text`, así que el valor se ve como texto plano.
Renderers registrados: avatar, badge, checkbox, number, progress, select, tags, text.
Si es un error de tipeo, corregir el nombre comparándolo con esa lista. Si es un renderer propio,
registrarlo antes de montar la tabla con `registerRenderer('badeg', () => miRenderer)`, o pasar la
instancia directamente en `column.renderer`. Ver "Escribir un renderer propio" en el README.
```

Dos detalles del aviso, y los dos importan:

- **Se emite una sola vez por nombre**, durante toda la vida de la aplicación. Resolver el renderer
  de una columna ocurre una vez por columna visible y por frame: sin esa memoria, un único typo
  emitiría cientos de mensajes por segundo y dejaría la consola de las devtools inutilizable.
- **No viaja al bundle de producción.** La comprobación está detrás de `import.meta.env.DEV`, que el
  empaquetado de la librería reemplaza por un literal; el mensaje, la función que lo emite y la
  memoria de nombres ya avisados desaparecen del artefacto publicado. El consumidor no paga ni un
  byte ni una comprobación por frame.

Un nombre desconocido es SIEMPRE un error: no hay ninguna regla de reconciliación que preserve uno ni
ninguna ventana de carga que lo produzca. Es la diferencia con las claves de columna ausentes en el
estado guardado, que se descartan en silencio a propósito porque un layout de hace dos deploys
mencionando una columna que ya no existe es un estado perfectamente legítimo. Ver
[Reconciliación](#reconciliación--esta-conviene-leerla).

---

## Componentes de terceros dentro de una celda

La pregunta llega tarde o temprano, casi siempre con el mismo ejemplo: _"uso NuxtUI y quiero un
`<USelect>` o un `<UButton>` dentro de una columna, ¿se puede?"_. Se puede, por dos caminos, y
ninguno de los dos es montar un componente por celda.

Antes de los caminos van los números, porque esta decisión no debería tomarse por confianza en una
recomendación ajena.

### Los tres caminos, medidos

Se midieron tres estrategias para poner un control interactivo en una columna, bajo el **mismo**
scroll:

| Estrategia                      | Qué hace                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — renderer nativo**         | El pool construye un `<button>` dentro de cada nodo de celda **una vez**, y por frame solo muta lo que cambió. Cero instancias de Vue.                 |
| **B — un componente por celda** | Una instancia de Vue por celda visible, montada y desmontada a medida que las filas se reciclan. Es lo que hacen las celdas de componente de RevoGrid. |
| **C — un pool de componentes**  | Una instancia por **slot del pool**, montada una sola vez; al reciclar solo cambian sus props. Es el caso FUERTE de B, no su versión de paja.          |

**El banco.** 50.000 filas, altura de fila 40px, viewport de 800px, pool de 29 nodos, cuatro columnas
—tres de texto más la que está bajo prueba— y **exactamente 150 pasos de 40px, uno por
`requestAnimationFrame`**, de modo que entra una fila por frame y se recicla una celda de acción por
frame, idéntico en las tres. Chrome 153 en `--headless=new` con la rotación de frames verificada a
60Hz (mediana de 16,6 ms entre frames, sin throttling), build de **producción** de Vue, página
aislada con COOP/COEP para que `performance.now()` no quedara limitado a 100 µs —resolución medida:
5 µs—. Nueve repeticiones por estrategia, intercaladas; se reporta la mediana. Se verificó además que
las tres producen el mismo HTML y la misma geometría de botón, para que la comparación sea entre
costos y no entre resultados distintos.

| Métrica — 150 frames de scroll                      |     A — nativo | B — uno por celda |       C — pool | B/A           | C/A           |
| --------------------------------------------------- | -------------: | ----------------: | -------------: | ------------- | ------------- |
| Tiempo de scripting total                           |       10,53 ms |          31,08 ms |       11,53 ms | **2,95×**     | **1,09×**     |
| Por frame (mediana)                                 |          70 µs |            207 µs |          77 µs | 2,95×         | 1,09×         |
| Sobre el presupuesto de 16,7 ms                     |         0,42 % |            1,24 % |         0,46 % | —             | —             |
| p95 por frame                                       |       0,105 ms |          0,365 ms |       0,105 ms | 3,48×         | 1,00×         |
| Peor frame                                          |       0,180 ms |          0,740 ms |       0,205 ms | 4,11×         | 1,14×         |
| **Frames por encima de 16,7 ms**                    |          **0** |             **0** |          **0** | —             | —             |
| **Long tasks (`PerformanceObserver`)**              |          **0** |             **0** |          **0** | —             | —             |
| Instancias de componente montadas durante el scroll |          **0** |           **150** |          **0** | ∞             | —             |
| Instancias desmontadas durante el scroll            |              0 |               145 |              0 | ∞             | —             |
| `document.createElement` durante el scroll          |              0 |               150 |              0 | ∞             | —             |
| Listeners registrados durante el scroll             |              0 |               150 |              0 | ∞             | —             |
| Nodos del DOM, delta (`Memory.getDOMCounters`)      |            552 |               724 |            552 | 1,31×         | 1,00×         |
| `ScriptDuration` (CDP `Performance.getMetrics`)     |       13,07 ms |          33,80 ms |       14,25 ms | 2,59×         | 1,09×         |
| `RecalcStyleDuration` / `LayoutDuration`            | 13,1 / 18,1 ms |    14,3 / 19,0 ms | 13,3 / 17,7 ms | 1,09× / 1,05× | 1,01× / 0,98× |
| **Heap asignado en la corrida**                     |     **131 KB** |        **941 KB** |     **359 KB** | **7,19×**     | 2,75×         |
| Heap retenido tras un GC mayor forzado              |          11 KB |             94 KB |          46 KB | 8,38×         | 4,08×         |
| Costo de arranque, por única vez                    |        0,67 ms |           0,56 ms |    **4,85 ms** | 0,84×         | 7,24×         |

**El peor frame posible**, medido aparte: saltos de 500 filas, donde las 28 celdas visibles se
reciclan de una sola vez.

| Frame de reemplazo total (28 celdas a la vez) | A — nativo | B — uno por celda | C — pool |
| --------------------------------------------- | ---------: | ----------------: | -------: |
| Mediana                                       |   0,215 ms |          0,795 ms | 0,195 ms |
| Máximo                                        |   0,270 ms |          1,030 ms | 0,335 ms |
| Montajes en ese frame                         |          0 |            **28** |        0 |

### Lo que dicen estos números, sin maquillar

**1. Ninguna de las tres perdió un solo frame.** Cero long tasks y cero frames por encima de 16,7 ms
en las tres estrategias, en todas las repeticiones. La frase "meter componentes Vue en las celdas te
tira el FPS al piso" **no se sostiene a esta escala**, y sostenerla igual sería vender esta
arquitectura con un argumento que la medición no respalda. B cuesta 137 µs más por frame que A: el
0,8 % del presupuesto de un frame. Para agotar 16,7 ms con este componente harían falta unos 590
ciclos de montaje y desmontaje en un mismo frame; un paso de scroll produce uno.

**2. C es indistinguible de A, y esa es la conclusión más importante de todas.** Un pool de
instancias bien construido —una por slot, montada una vez, reciclada escribiendo en un objeto de
props reactivo— cuesta **+6,7 µs por frame** sobre mutar el DOM a mano, por debajo del ruido entre
corridas: la prueba de Welch da t = 0,52 y p ≈ 0,6 para C contra A, y p < 0,0001 para B contra A. En
el frame de reemplazo total, la mediana de C fue incluso más baja que la de A, lo que es ruido y no
una victoria, pero dice cuán chica es la diferencia. **Lo caro de B nunca fue "Vue": fue el churn de
montar y desmontar.** Sacado el churn, el costo de Vue prácticamente desaparece del camino caliente.
Lo que C sí paga es el arranque: 4,85 ms para montar 29 instancias, 7,2 veces lo que tarda A, una
sola vez y amortizado a cero en cualquier sesión de scroll real.

**3. Donde B sí pierde de verdad es en basura, no en tiempo de frame.** 941 KB asignados en una
corrida contra los 131 KB de A (7,2×), 94 KB retenidos después de un GC mayor forzado contra 11 KB
(8,4×), más 150 registros de listener y 150 `createElement` que A y C no hacen —unos 6,3 KB por ciclo
de montaje—. Eso se cobra como una **pausa del recolector** en una sesión larga de scroll, no como un
pintado lento, y un banco de 150 frames es demasiado corto para atraparla. Ese es el argumento
honesto contra B, y es distinto del que se suele hacer.

**4. Estilo y layout son idénticos en las tres.** `RecalcStyle` dentro del 9 %, `Layout` dentro del
7 %, exactamente 150 recálculos de layout en cada una. Las tres divergen solo en JavaScript.

**Las salvedades importan tanto como los números.** El componente del banco es trivial: un botón, dos
props, un emit, sin slots, sin `computed` y sin store inyectado. Los 137 µs de B son un **piso**. Una
celda de acción realista —un menú desplegable, un chequeo de permisos, un ícono, un tooltip, i18n—
puede pesar entre tres y diez veces más por montaje, y **B paga ese peso por fila entrante mientras C
lo paga una vez al arrancar**: la relación B/A escala con el peso del componente y la relación C/A
prácticamente no. Lo mismo multiplica la cantidad de columnas interactivas, y aquí se midió una. Todo
esto es además con el build de **producción** de Vue: en modo desarrollo B se ve bastante peor, y ese
número no se puede citar como un número de producción. Por último, la dispersión entre corridas es
grande frente a la diferencia entre A y C —A osciló entre 9,80 y 15,52 ms sobre un escritorio Windows
ocupado—, así que cualquier afirmación por debajo de unos 13 µs por frame no es resoluble con este
banco. B contra A queda muy afuera de ese margen; C contra A queda adentro.

### Camino 1 — un renderer nativo

Es el camino para lo que la celda tiene que **mostrar siempre**: un botón de acción, un estado, un
indicador. Un renderer es DOM plano, sin Vue de por medio, y respeta un contrato de dos tiempos:

> **`create` corre UNA vez por nodo de celda; `update` corre en cada repintado y solo puede mutar lo
> que `create` construyó.** Dentro de `update` no se crean nodos, no se lee layout y no se escribe
> nada que no haya cambiado.

No es un consejo: es la regla de la que depende la columna A de la tabla de arriba. Crear nodos en
`update` genera basura que el recolector cobra más tarde como un frame perdido; leer layout
(`offsetWidth`, `getBoundingClientRect`, `getComputedStyle`) fuerza un reflow síncrono en mitad del
pintado; escribir de más invalida estilos para nada. Las tres cosas tienen la misma raíz: `update`
corre por celda visible y por frame.

Un botón con el aspecto de un design system —sus clases, sin su componente—:

```ts
import type { CellRenderContext, CellRenderer, CellRendererHandle } from 'vue-tablekit'

/**
 * Las clases del design system se escriben UNA vez, en `create`.
 *
 * No se puede montar `<UButton>`, pero sí se pueden reusar sus clases y quedarse
 * con el mismo aspecto. La clase `inv-action` no es cosmética: es el anzuelo que
 * el listener delegado del consumidor busca más abajo.
 */
const BUTTON_CLASS =
  'inv-action inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ' +
  'text-white bg-primary-500 hover:bg-primary-600 disabled:opacity-50'

/** Estado por celda, indexado por el handle. Nunca por índice de fila: los nodos se reciclan. */
type ActionState = { button: HTMLButtonElement; label: string; disabled: boolean }
const states = new WeakMap<CellRendererHandle, ActionState>()

export const actionRenderer: CellRenderer<Invoice> = {
  type: 'action',
  // Es una caja y no texto suelto: la celda la centra con flex.
  layout: 'box',

  create(cell: HTMLElement): CellRendererHandle {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = BUTTON_CLASS
    cell.appendChild(button)

    const handle: CellRendererHandle = { root: cell }
    // Sin listener propio: el click viaja por delegación, ver más abajo.
    states.set(handle, { button, label: '', disabled: false })
    return handle
  },

  update(handle: CellRendererHandle, ctx: CellRenderContext<Invoice>): void {
    const state = states.get(handle)
    if (!state) return

    const label = ctx.row.status === 'paid' ? 'Ver recibo' : 'Cobrar'
    // La regla entera, en dos líneas: comparar contra lo último escrito y salir.
    if (state.label !== label) {
      state.label = label
      state.button.textContent = label
    }

    const disabled = ctx.row.locked
    if (state.disabled !== disabled) {
      state.disabled = disabled
      state.button.disabled = disabled
    }
  },

  destroy(handle: CellRendererHandle): void {
    states.delete(handle)
  },
}
```

**Cómo vuelve el click al consumidor.** Con **un solo listener** para toda la tabla, colgado del
contenedor que la envuelve. La fila pintada ya lleva su identidad en `data-row-key`, así que el
handler no necesita que el renderer escriba nada extra por frame:

```vue
<script setup lang="ts">
import { shallowRef, useTemplateRef } from 'vue'
import { DataTable } from 'vue-tablekit'
import { actionRenderer } from './actionRenderer'

const rows = shallowRef<readonly Invoice[]>([])
const host = useTemplateRef<HTMLElement>('host')

const columns: readonly DataTableColumn<Invoice>[] = [
  { key: 'customer', label: 'Cliente', width: 220 },
  // Sin `editable`: es un botón, no una celda que se edite. Un doble clic aquí no
  // abre ningún editor.
  { key: 'id', label: '', width: 120, renderer: actionRenderer, align: 'center' },
]

/**
 * UN listener para toda la tabla, sin importar cuántas filas haya.
 *
 * Es la misma delegación que usa el pool por dentro: se sube por el DOM desde el
 * blanco del evento en lugar de registrar un handler por botón. Un listener por
 * celda visible sería trabajo de más sobre nodos que además se reciclan.
 */
function onHostClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  if (!target.closest('.inv-action')) return

  const rowElement = target.closest('[data-row-key]')
  if (!(rowElement instanceof HTMLElement)) return

  const key = rowElement.dataset.rowKey
  if (key !== undefined) charge(key)
}
</script>

<template>
  <div ref="host" style="height: 60vh" @click="onHostClick">
    <DataTable :rows="rows" :columns="columns" row-key="id" />
  </div>
</template>
```

`data-row-key` sale de la prop `rowKey`, así que lo que llega al handler es la identidad del dominio y
no una posición del viewport. Si hace falta el objeto de fila completo y la clave no alcanza,
conviene un `Map` por clave construido en un `computed` sobre `rows`: se rehace una vez por cambio de
datos, nunca por frame. Y si la columna no importa —cualquier click en la fila sirve— está el evento
`rowClick`, que ya entrega la fila y su índice sin escribir un solo listener.

**Dos alternativas al listener propio, por si el renderer necesita el evento adentro.** Registrar un
`addEventListener` dentro de `create` tampoco es una catástrofe: `create` corre una vez por nodo de
celda del pool, o sea unas pocas decenas de registros para cualquier tamaño de dataset, y no por
frame. Pero la delegación cuesta exactamente cero y no hay que acordarse de desregistrar nada en
`destroy`, así que es la que conviene por defecto.

### Camino 2 — el slot `#editor`

Es el camino para lo que solo hace falta **mientras se edita**: el desplegable de un design system,
un selector de fecha con calendario, un buscador con autocompletado. Aquí sí entra un componente Vue
del consumidor, y entra con una regla: **uno montado a la vez, sobre la celda en edición**, no uno
por celda.

Es exactamente la disciplina que ya usaban los editores incluidos —un `<input>` reutilizado que se
reposiciona sobre la celda abierta— extendida a un componente ajeno. Con 50.000 filas cargadas, el
componente del consumidor existe como mucho una vez en toda la página.

Se pide declarando `editor: 'slot'` en la columna y llenando el slot:

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DataTable } from 'vue-tablekit'
import type { CellOption, CellValue, DataTableColumn, EditCommitEvent } from 'vue-tablekit'
import 'vue-tablekit/style.css'

type Invoice = { id: number; customer: string; status: 'draft' | 'sent' | 'paid' }

const STATUSES: readonly CellOption[] = [
  { value: 'draft', label: 'Borrador' },
  { value: 'sent', label: 'Enviada' },
  { value: 'paid', label: 'Pagada' },
]

const rows = shallowRef<readonly Invoice[]>([])

const columns: readonly DataTableColumn<Invoice>[] = [
  { key: 'customer', label: 'Cliente', width: 220, editable: true },
  {
    key: 'status',
    label: 'Estado',
    width: 160,
    editable: true,
    // `renderer` y `editor` siguen siendo ejes independientes: la celda se VE
    // como una píldora y se EDITA con el desplegable del design system.
    renderer: 'badge',
    editor: 'slot',
    options: STATUSES,
  },
]

// La tabla es controlada: la escritura sigue siendo de este handler, igual que
// con cualquier editor incluido.
function onEditCommit(event: EditCommitEvent<Invoice>): void {
  const next = rows.value.slice()
  next[event.rowIndex] = { ...event.row, [event.columnKey]: event.newValue }
  rows.value = next
}
</script>

<template>
  <div style="height: 60vh">
    <DataTable :rows="rows" :columns="columns" row-key="id" @edit-commit="onEditCommit">
      <!--
        El slot es UNO para toda la tabla. Con más de una columna de slot, el
        consumidor despacha por `column.key`, que es para lo que viaja la
        definición de columna completa.
      -->
      <template #editor="{ column, value, commit, cancel }">
        <USelect
          v-if="column.key === 'status'"
          :model-value="value"
          :items="column.options"
          value-key="value"
          label-key="label"
          open
          class="w-full"
          @update:model-value="(next: CellValue) => commit(next)"
          @update:open="
            (open: boolean) => {
              if (!open) cancel()
            }
          "
        />
      </template>
    </DataTable>
  </div>
</template>
```

> **NuxtUI no es una dependencia de esta librería.** `<USelect>` aparece aquí porque es el ejemplo con
> el que llega la pregunta; el slot no sabe ni le importa de dónde sale el componente. Los nombres
> exactos de sus props cambian entre versiones de cualquier design system: lo que no cambia es que el
> control avisa con `commit(valor)` y se retira con `cancel()`. En `demo/DemoStatusPicker.vue` de
> este repositorio hay el mismo ejemplo resuelto con un componente escrito a mano y sin ninguna
> dependencia.

**Lo que recibe el slot**

| Prop               | Tipo                     | Notas                                                                                                                           |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `row`              | `TRow`                   | La fila que se está editando. No debe mutarse: la tabla es controlada.                                                          |
| `rowIndex`         | `number`                 | Índice dentro de la prop `rows`, igual que en todos los eventos. Con grupos activos **no** es la posición vertical de la celda. |
| `column`           | `DataTableColumn<TRow>`  | La definición completa, con sus `options`. Es lo que permite despachar por `column.key`.                                        |
| `columnKey`        | `string`                 | Alias de conveniencia de `column.key`.                                                                                          |
| `value`            | `CellValue`              | El valor con el que se abrió el editor, ya leído por el `accessor` de la columna.                                               |
| `commit(newValue)` | `(v: CellValue) => void` | Cierra confirmando. Emite `afterEdit` y, solo si el valor cambió de verdad, `editCommit`.                                       |
| `cancel()`         | `() => void`             | Cierra descartando. Emite `afterEdit` con `canceled: true` y ningún `editCommit`.                                               |

**Qué abre y qué cierra el editor de slot**

| Entrada                                         | Efecto                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Doble clic, `Enter`, `F2`, escribir un carácter | Abre, después de pasar por el veto de `beforeEdit`. La semilla del carácter se ignora, igual que en `select`. |
| `commit(valor)` desde el slot                   | Cierra confirmando.                                                                                           |
| `cancel()` desde el slot                        | Cierra descartando.                                                                                           |
| `Escape` dentro del contenido del slot          | Igual que `cancel()`. Lo maneja la caja del editor, así que funciona sin que el componente haga nada.         |
| La fila sale de la ventana virtual              | Cierra **confirmando el valor original** (ver más abajo).                                                     |
| Un clic sobre otra celda                        | Cierra igual que el punto anterior.                                                                           |
| Abrir el editor en otra celda                   | Ídem.                                                                                                         |
| **Perder el foco**                              | **Nada.** Es la única asimetría con los editores incluidos, y es deliberada.                                  |

**Por qué el `blur` no cierra.** Un desplegable de un design system abre su lista en un portal colgado
del `body`, así que el foco sale de la caja del editor en mitad de la interacción. Confirmar ahí
cerraría el editor justo cuando el usuario despliega las opciones. El precio de esa decisión es que
apuntar a otra celda —y no perder el foco— es lo que cierra la sesión.

**Qué significa "confirmar el valor original".** La tabla no sabe qué tiene adentro el control del
consumidor: no hay ningún `control.value` que leer. Cuando el cierre no viene de `commit()`, se emite
`afterEdit` con `newValue === oldValue` y, por la regla de siempre, ningún `editCommit`. La sesión se
cierra limpia y no se escribe nada.

**Lo demás que conviene saber antes de usarlo**

- **Hace falta `editable: true` igual que en cualquier otra columna.** `editor: 'slot'` dice CÓMO se
  edita, no SI se edita.
- **Sin el slot declarado, la columna no abre nada.** Ni el slot ni un editor incluido de reemplazo:
  quien pidió su propio control lo pidió justamente porque el incluido no servía para esa columna. Y
  una tabla que no declara `#editor` no renderiza ni siquiera la caja que lo contendría, así que
  produce exactamente el mismo DOM que antes de que esta función existiera.
- **El valor viaja sin coacción.** El editor incluido recibe un string de un control del DOM y tiene
  que devolverlo al tipo original; aquí el consumidor ya tiene el valor tipado y tocarlo sería
  corromperlo.
- **`CellValue` no puede expresar una lista ni un objeto.** Un editor de selección múltiple sigue sin
  poder commitear su array por esta vía, igual que con los editores incluidos: lo que se puede es
  leer la forma original desde `row[columnKey]` y commitear una representación primitiva.
- **El contenido del slot vive en la capa del editor, nunca dentro de `.dt-canvas`.** El canvas es
  territorio del pool, que recicla sus nodos por slot de viewport y no puede convivir con un árbol que
  administre Vue. Por eso el slot no rompe el reciclado.
- **El foco entra y vuelve.** Al abrir, el primer elemento enfocable del contenido recibe el foco; si
  el componente ya se lo tomó por su cuenta, no se le disputa. Al cerrar, el foco vuelve al viewport,
  que es donde escucha el manejador de teclado de la grilla.
- **Se puede estilar.** La caja es `.dt-editor-slot`: posición, tamaño exacto de la celda y un fondo
  que la tapa. No trae borde ni tipografía propia, porque el aspecto es del componente del consumidor.

### Cuándo un componente por celda SÍ es la decisión correcta

La respuesta no siempre es "no". Los casos donde conviene pagar el costo, con el costo a la vista:

- **La celda tiene que ser interactiva sin entrar en modo edición.** Varios controles vivos a la vez
  en la misma fila: una botonera con menús, un widget de puntuación con estado de hover, un
  mini-gráfico con tooltip. Un editor por vez no cubre eso, y un renderer nativo lo cubre a costa de
  reimplementar a mano el manejo de foco, teclado y accesibilidad.
- **La grilla es chica.** Unos cientos de filas que entran sin presión de virtualización. Ahí una
  tabla con `v-for` y componentes de verdad es más simple, más mantenible y suficientemente rápida.
  Usar esta librería para eso es traer una solución a un problema que no se tiene.
- **La velocidad del equipo pesa más que el presupuesto de frame.** Los componentes de un design
  system traen resueltos la accesibilidad, el i18n, el tema y los tests. Reimplementar un combobox
  como renderer son semanas y el resultado es peor. Los números de arriba dicen que esa elección
  cuesta 137 µs por frame con un componente liviano, no un frame perdido.
- **El contenido por celda es genuinamente complejo y con estado propio**: un editor anidado, un
  campo de texto enriquecido, un árbol plegable dentro de la celda.

**Lo que cuesta, dicho de frente.** Con un componente liviano, B midió 2,95× el tiempo de scripting
de A y aun así no perdió un frame. Lo que escala mal no es el tiempo por frame sino **el peso del
componente multiplicado por la cantidad de columnas interactivas**, y sobre todo la basura: 7,2 veces
más memoria asignada por corrida, que en una sesión larga se cobra como una pausa del recolector. Si
el caso cae en esta lista, la recomendación no es "no lo hagas": es **hacerlo con un pool** (la
estrategia C), que en esta medición resultó indistinguible del DOM a mano y conserva todas las
ventajas de trabajar con componentes.

### Por qué esta librería no monta componentes por celda

No por el tiempo de frame. La medición es clara: a esta escala, ninguna de las tres estrategias
pierde un frame, y un pool de componentes bien hecho empata con el DOM a mano. Las razones son otras
tres, y conviene decirlas en este orden:

1. **El presupuesto que se defiende no es el del banco, es el del peor caso real.** Los 137 µs de B
   son con un botón de dos props. Ese número es un piso y escala con el peso del componente y con la
   cantidad de columnas interactivas; el de C prácticamente no. Una librería no puede acotar el peso
   del componente que le van a pasar, así que la única garantía que puede dar es la que no depende de
   él.
2. **La basura es el costo que no se ve hasta que es tarde.** B asigna 7,2 veces más memoria por
   corrida y retiene 8,4 veces más después de un GC mayor. Ese costo aparece como una pausa del
   recolector en la sesión número cuarenta del día, no en el banco de 150 frames, y por eso es
   exactamente el tipo de regresión que la suite de este repositorio existe para prevenir: **romper el
   caché de pintado no lanza ninguna excepción, la tabla se sigue viendo bien y solo scrollea peor.**
3. **Un pool de componentes es, en esencia, este componente otra vez.** C funciona porque no monta ni
   desmonta durante el scroll, recicla por slot y solo escribe lo que cambió: las mismas tres reglas
   que sostienen el pool de nodos. Construir un segundo pool —de instancias de Vue esta vez— adentro
   del primero duplicaría toda esa maquinaria, con el reciclado, la invalidación y el ciclo de vida
   que ya hay que sostener una vez. La alternativa que se eligió es abrir exactamente una puerta —el
   slot `#editor`, un componente montado a la vez— y dejar el resto en el protocolo de renderers.

La medición completa está arriba, con sus salvedades. Si el caso de uso no se parece al banco
—componentes pesados, muchas columnas interactivas, sesiones largas— los números propios van a ser
distintos, y conviene medirlos antes de elegir.

---

## Agrupación

Agrupar convierte la lista plana de filas en un árbol: una cabecera por grupo, sus filas debajo, y la
posibilidad de plegarlas. Por dentro, lo que el virtualizador recorre deja de ser `rows` y pasa a ser
una **vista aplanada**: un array derivado donde cada entrada es una cabecera de grupo o una fila de
datos. Eso es lo que permite que la posición vertical siga siendo un índice y que el costo por frame
siga siendo constante.

De ahí salen dos formas de contar filas que no son intercambiables, y conviene fijarlas antes de
seguir:

- **La vista aplanada** es lo que se ve y lo que el virtualizador recorre. Cada cabecera de grupo
  ocupa una entrada propia, y un grupo colapsado aporta su cabecera y esconde a todos sus
  descendientes. Es lo que cuenta cualquier medición hecha sobre el DOM, y lo que indexa una
  `CellPosition`.
- **El dataset** es la prop `rows`, y no cambia nunca por agrupar ni por plegar. Es lo que indexan
  los eventos.

Plegar un grupo achica la primera y deja la segunda intacta. Si las dos se mezclan, el resultado es
el error que está descrito en
[Dos números distintos](#dos-números-distintos-posición-visible-e-índice-original).

Con `groupBy` vacío —el valor por defecto— la tabla no paga absolutamente nada por esta función: no
se construye ningún árbol, no se aplana nada y el pool recorre el mismo camino de siempre sobre
`rows`.

### El ejemplo mínimo

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DataTable } from 'vue-tablekit'
import type { DataTableColumn, GroupToggleEvent } from 'vue-tablekit'

type Invoice = { id: number; customer: string; region: string; total: number }

const rows = shallowRef<readonly Invoice[]>([
  { id: 1, customer: 'Acme', region: 'LATAM', total: 1200 },
  { id: 2, customer: 'Globex', region: 'EMEA', total: 380 },
])

const columns: readonly DataTableColumn<Invoice>[] = [
  { key: 'customer', label: 'Customer', width: 220 },
  { key: 'region', label: 'Region', width: 140 },
  { key: 'total', label: 'Total', width: 140, renderer: 'number', aggregate: 'sum' },
]

// Se agrupa por región. La cabecera de cada grupo muestra el total de la columna.
const groupBy = shallowRef<readonly string[]>(['region'])

function onGroupToggle(event: GroupToggleEvent): void {
  console.log(event.groupId, event.expanded)
}
</script>

<template>
  <div style="height: 480px">
    <DataTable
      v-model:group-by="groupBy"
      :rows="rows"
      :columns="columns"
      row-key="id"
      @group-toggle="onGroupToggle"
    />
  </div>
</template>
```

### Las props de agrupación

| Prop                    | Tipo                | Por defecto     | Qué hace                                                                                                                                                             |
| ----------------------- | ------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groupBy`               | `readonly string[]` | lista vacía     | `v-model:group-by`. Claves de columna en orden de anidamiento. `['status', 'priority']` produce un primer nivel por estado y, dentro de cada uno, uno por prioridad. |
| `expandedGroups`        | `readonly string[]` | _no controlado_ | `v-model:expanded-groups`. `groupId` de los grupos expandidos. Los ids se construyen con [`groupId(...)`](#groupid-cómo-se-escribe-un-id), no a mano.                |
| `groupsDefaultExpanded` | `boolean`           | `true`          | Estado inicial de un grupo del que todavía no se sabe nada.                                                                                                          |
| `showGroupCount`        | `boolean`           | `true`          | Si la cabecera muestra la insignia con la cantidad de filas descendientes.                                                                                           |
| `emptyGroupLabel`       | `string`            | `'(empty)'`     | Etiqueta del grupo que junta los valores ausentes, tanto `null` como `undefined`.                                                                                    |

`groupBy` se sanea antes de usarse: se descartan las claves que no nombran ninguna columna, las de
columnas con `groupable: false` y los duplicados. Un duplicado no es teórico: crearía un nivel entero
de grupos de un solo hijo. Si después del saneo no queda ninguna clave, la tabla vuelve al camino sin
agrupación y `role` vuelve a ser `grid`.

El orden de los grupos es el de su **primera aparición**, y dentro de un grupo las filas conservan su
orden original. Agrupar no reordena nada por su cuenta: quien quiera un orden lo aplica sobre `rows`,
que es donde ya lo tenía.

### `groupId`: una identidad por camino

Cada grupo tiene un `groupId` construido como un camino de `columna:valor`, con los niveles unidos
por `/`:

```
status:open
status:open/priority:high
```

Los valores que no son strings llevan una marca de tipo delante, para que el `1` numérico y el `'1'`
de texto nunca caigan en el mismo grupo:

| Valor              | Segmento            |
| ------------------ | ------------------- |
| `'open'`           | `status:open`       |
| `1`                | `status:#1`         |
| `true`             | `status:?true`      |
| `null`             | `status:~null`      |
| `undefined`        | `status:~undefined` |
| una fecha          | `status:@<ISO>`     |
| una fecha inválida | `status:@invalid`   |

Que el id sea un camino y no un contador es lo que lo vuelve estable entre sesiones: un contador se
desplazaría en cuanto llegara una fila nueva. Esa estabilidad es la que hace posible persistir qué
grupos quedaron colapsados.

`null` y `undefined` conservan **buckets distintos**, porque son valores distintos y en muchos
dominios esa diferencia significa algo. Lo que comparten es la etiqueta: los dos se muestran como
`(empty)`.

Ese texto es configurable con la prop **`emptyGroupLabel`**, porque es de cara al usuario y una
aplicación que no está en inglés tiene que poder traducirlo:

```vue
<DataTable v-model:group-by="groupBy" empty-group-label="Sin asignar" … />
```

También se aplica cuando el valor existe pero su representación de texto queda vacía —una cadena
vacía, por ejemplo—, de modo que una cabecera nunca aparece sin nombre. El `groupId` **no** cambia:
sigue siendo `status:~null`, así que traducir la etiqueta no invalida ningún estado colapsado que se
haya persistido.

La etiqueta de la cabecera se resuelve primero contra `column.options`, así una columna de estados
agrupa bajo `Open` y no bajo `open`. La lista de opciones ya es la fuente de verdad de cómo se llama
cada valor de cara al usuario.

### `groupId(...)`: cómo se escribe un id

Todo lo que recibe un id —`expandedGroups`, `toggleGroup()`, un conjunto colapsado que se restaura a
mano— lo recibe como string. Escribir ese string a mano tiene un modo de falla desagradable: **un id
equivocado no produce ningún error ni ningún aviso**. El grupo se queda cerrado, la tabla sigue
funcionando y no hay nada que mirar. Por eso el paquete exporta el constructor:

```ts
import { groupId } from 'vue-tablekit'

groupId(['region', 'LATAM']) // 'region:LATAM'
groupId(['region', 'LATAM'], ['status', 'active']) // 'region:LATAM/status:active'

// Las marcas de tipo las pone el helper. Escribir `'amount:10'` sería un id que
// no nombra a ningún grupo; el correcto es `'amount:#10'`.
groupId(['amount', 10]) // 'amount:#10'
groupId(['done', true]) // 'done:?true'
groupId(['assignee', null]) // 'assignee:~null'
groupId(['due', new Date('2024-01-01T00:00:00.000Z')]) // 'due:@2024-01-01T00:00:00.000Z'
```

Cada argumento es un nivel, en orden de anidamiento, y cada nivel es la tupla `[columnKey, value]`.
El `value` acepta cualquier `CellValue` —string, número, booleano, `null`, `undefined` o `Date`— y es
el mismo valor que está en los datos, no su etiqueta: se agrupa por `'open'` aunque la cabecera diga
`Open`.

| Firma                                | Qué construye                                                         |
| ------------------------------------ | --------------------------------------------------------------------- |
| `groupId(segmento)`                  | El id de un grupo de primer nivel.                                    |
| `groupId(segmento, ...másSegmentos)` | El camino completo de un grupo anidado, un nivel por tupla.           |
| `GroupIdSegment<TKey = string>`      | El tipo de una tupla: `readonly [columnKey: TKey, value: CellValue]`. |

El primer nivel es obligatorio en la firma a propósito: `groupId()` sin argumentos devolvería la
cadena vacía, que no nombra a ningún grupo y se comportaría exactamente igual que un id mal escrito.
Exigirlo convierte ese caso en un error de compilación.

El parámetro de tipo es el otro filo, para quien tenga la unión literal de sus claves de columna. La
librería no la conoce —`DataTableColumn.key` es un `string`—, pero si se la pasa, una clave mal
escrita deja de ser un grupo que no abre y pasa a ser un error del compilador:

```ts
type InvoiceKey = 'customer' | 'region' | 'status' | 'total'

groupId<InvoiceKey>(['regio', 'LATAM'])
// TS2820: Type '"regio"' is not assignable to type 'InvoiceKey'.
//         Did you mean '"region"'?
```

Es opcional: sin el parámetro explícito, `TKey` se infiere del argumento y no verifica nada, que es
el comportamiento correcto cuando el consumidor no tiene una unión que ofrecer.

**Es la misma función que construye los ids del árbol.** No es una reimplementación del formato para
el consumidor: `groupId` y la construcción de la vista aplanada pasan por las mismas dos primitivas
internas, así que un id construido aquí es el string que la tabla le puso a ese grupo por definición y
no por coincidencia. Dos implementaciones del mismo formato terminan desincronizándose, y el síntoma
de esa desincronización sería otra vez un grupo que no abre y no avisa.

> **Escribir el id a mano funciona, pero no está garantizado.** El formato está documentado más
> arriba porque aparece en el almacenamiento y en los tests, y hoy nada impide construir el string
> por cuenta propia. Lo que no hay es una promesa: los separadores y las marcas de tipo son detalle
> interno y pueden cambiar sin que eso sea un cambio incompatible de la API. Lo que se sostiene es
> `groupId(...)`. Un id escrito a mano que deje de coincidir no rompe la tabla ni lanza nada: el
> grupo queda cerrado, en silencio.

**Un id que hoy no nombra a ningún grupo NO produce un aviso**, y es deliberado. Es un estado
legítimo con demasiada frecuencia como para poder distinguirlo de un error: mientras `rows` todavía
está cargando no existe ningún grupo, un conjunto colapsado restaurado del almacenamiento se
[conserva a propósito](#persistencia) aunque su valor ya no esté en los datos, y un consumidor
puede guardar el estado de expansión de una agrupación que en este momento no está activa. Un aviso
dispararía en los tres casos. La verificación se corre entonces al momento de CONSTRUIR el id, que es
el único punto donde hay información suficiente para hacerla.

### Agregados por columna

Una columna declara qué muestra en las cabeceras de grupo con `column.aggregate`. Sin `aggregate`, la
columna no aporta nada a la cabecera.

| Agregación | Qué devuelve                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `'sum'`    | Suma de los números finitos. `null` si el grupo no tiene ninguno, en lugar de un `0` que se confundiría con un total real.    |
| `'avg'`    | Promedio de los números finitos. Divide por la cantidad de NÚMEROS, no por la cantidad de filas. `null` si no hay ninguno.    |
| `'count'`  | Cantidad de filas descendientes cuyo valor no es `null` ni `undefined`. Es el `COUNT(columna)` de SQL, no el `COUNT(*)`.      |
| `'min'`    | Mínimo entre los números finitos y, si el grupo no tiene ninguno, entre las fechas válidas. `null` si no hay nada comparable. |
| `'max'`    | Máximo, con la misma regla que `'min'`.                                                                                       |

Para la cantidad total de filas del grupo —el `COUNT(*)`— ya está la insignia de la cabecera, que
`showGroupCount` controla. Son dos preguntas distintas y responden distinto a propósito.

Los booleanos y los strings cuentan como presentes pero no entran en `sum` ni en `min` / `max`: sumar
booleanos es una decisión de dominio que le corresponde a una función propia, no a un valor por
defecto que después nadie recuerda.

**Una agregación propia** es una función que recibe todas las filas descendientes del grupo y la
clave de la columna:

```ts
import type { AggregationFn, DataTableColumn } from 'vue-tablekit'

type Invoice = { id: number; region: string; total: number; status: 'draft' | 'sent' | 'paid' }

// Cuántas facturas del grupo están pagas, sobre el total. Corre una vez por grupo
// y por reconstrucción del aplanado, nunca por frame.
const paidRatio: AggregationFn<Invoice> = (rows) => {
  if (rows.length === 0) return null
  const paid = rows.filter((row) => row.status === 'paid').length
  return `${paid}/${rows.length}`
}

const columns: readonly DataTableColumn<Invoice>[] = [
  { key: 'region', label: 'Region', width: 140 },
  { key: 'total', label: 'Total', width: 140, renderer: 'number', aggregate: 'sum' },
  { key: 'status', label: 'Status', width: 140, aggregate: paidRatio },
]
```

La firma es `(rows: readonly TRow[], columnKey: string) => CellValue`. Recibe las filas **originales**
y no los agregados ya cerrados de los subgrupos, que es la única forma de que una agregación propia
sea correcta en niveles anidados.

Las filas solo se juntan cuando al menos una columna declara una función; con agregaciones incluidas
únicamente, el árbol no guarda ni una referencia de más. Y apenas termina el cálculo, los
acumuladores sueltan las filas que habían juntado: sin eso, el árbol conservaría una referencia por
fila y por nivel durante toda la vida de la vista.

> **Un agregado se pinta en el offset horizontal de SU columna**, encima de la cabecera y con fondo
> propio, para que la cifra caiga justo debajo del encabezado al que pertenece. Como consecuencia, un
> agregado declarado en la **primera** columna taparía el chevron, la etiqueta y la insignia del
> grupo. Las columnas de agregado conviene dejarlas hacia la derecha.

### Varios niveles: un padre agrega sobre TODOS sus descendientes

Con más de una clave en `groupBy`, cada nivel intermedio también muestra sus agregados, y los calcula
sobre todas sus filas descendientes, **no** sobre los agregados ya cerrados de sus hijos.

Para `sum`, `min` y `max` daría lo mismo, porque son asociativas. Para `avg` no, y ahí es donde se ve
la diferencia. Con un grupo `open` que tiene tres filas de `10` en `priority: high` y una de `100` en
`priority: low`:

| Grupo                       | `avg` correcto            | El error habitual |
| --------------------------- | ------------------------- | ----------------- |
| `status:open/priority:high` | `10`                      | `10`              |
| `status:open/priority:low`  | `100`                     | `100`             |
| `status:open`               | `(10+10+10+100)/4 = 32,5` | `(10+100)/2 = 55` |

El promedio de los promedios de dos subgrupos de tamaños distintos no es el promedio del conjunto, y
esa versión ingenua es la que aparece en más de una grilla del mercado. Aquí cada fila alimenta a los
acumuladores de todos los grupos de su camino, uno por nivel de anidamiento, así que cada grupo ve
todas sus filas de primera mano. El costo total es O(filas × niveles) —niveles es 1, 2 o 3 en la
práctica—, nunca O(filas × grupos).

Lo mismo vale para una agregación propia: en un nivel intermedio recibe todas las filas
descendientes, no las de sus subgrupos ya agregadas.

Un grupo colapsado **conserva su contador y sus agregados intactos**: plegar es una decisión de
presentación y no puede cambiar lo que el grupo dice de sí mismo.

### Estado expandido y colapsado

Igual que el trío de columnas, la expansión funciona de dos maneras, y la diferencia entre las dos no
es cosmética.

**No controlado** (`expandedGroups` llega `undefined`). La tabla guarda internamente solo las
EXCEPCIONES a `groupsDefaultExpanded`. Con el valor por defecto en `true` y diez mil grupos, ese
conjunto tiene tantas entradas como grupos haya colapsado el usuario, que son unos pocos. Igual se
emite la lista completa de expandidos en `update:expandedGroups`, para poder escucharla sin tomar
posesión del estado.

**Controlado** (`expandedGroups` llega con valor, incluida la lista vacía). La prop es la verdad
literal: un id que no está en la lista está colapsado. Y **`groupsDefaultExpanded` deja de
intervenir**, porque el padre ya está diciendo el estado de cada grupo, uno por uno. Un grupo nuevo
—que aparece porque llegaron filas con un valor que antes no existía— nace colapsado hasta que el
padre lo agregue a la lista.

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { groupId } from 'vue-tablekit'

// Controlado: la tabla no cambia esto sola, solo emite lo que el padre debería adoptar.
const expandedGroups = shallowRef<readonly string[]>([groupId(['region', 'LATAM'])])
</script>

<template>
  <DataTable
    v-model:group-by="groupBy"
    v-model:expanded-groups="expandedGroups"
    :rows="rows"
    :columns="columns"
    row-key="id"
  />
</template>
```

Los eventos, en orden:

| Acción                             | `update:expandedGroups`                    | `groupToggle`           |
| ---------------------------------- | ------------------------------------------ | ----------------------- |
| Clic o teclado sobre una cabecera  | La lista completa de expandidos resultante | `{ groupId, expanded }` |
| `expandAllGroups()`                | Todos los ids del árbol actual             | —                       |
| `collapseAllGroups()`              | Lista vacía                                | —                       |
| Restauración desde la persistencia | La lista completa de expandidos resultante | —                       |

`groupToggle` describe un cambio **puntual** y por eso solo lo dispara el plegado de un grupo
concreto; expandir o colapsar todo no emite uno por grupo. `update:expandedGroups` se emite antes que
`groupToggle` en el mismo tick.

En modo controlado, un toggle **no** cambia el estado por su cuenta: solo anuncia el estado que el
padre debería adoptar. Si el padre ignora el evento, el grupo se queda como estaba. Es exactamente la
misma semántica que `update:columnVisibility`.

### Teclado

Con la celda activa parada sobre una cabecera de grupo, cuatro teclas cambian de significado:

| Tecla              | Sobre una cabecera de grupo                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `Enter`            | Pliega o despliega el grupo. No abre ningún editor: un grupo no tiene celdas que editar.                                       |
| `Espacio`          | Pliega o despliega el grupo, y no siembra un editor.                                                                           |
| `→` (`ArrowRight`) | Si el grupo está **colapsado**, lo expande. Si ya estaba abierto, no hay nada que abrir y la tecla vuelve a mover una columna. |
| `←` (`ArrowLeft`)  | Si el grupo está **expandido**, lo colapsa. Si ya estaba cerrado, mueve una columna hacia atrás.                               |

Es el comportamiento de un `treegrid`, y por eso el `role` de la grilla pasa a `treegrid` mientras hay
agrupación activa: es lo que hace que un lector de pantalla anuncie `aria-expanded` y `aria-level`,
que con `grid` simplemente ignoraría. Con un árbol tabular la estructura importa todavía más, así que
la fila de encabezado sigue adentro de la grilla y con su `aria-rowindex="1"` intacto.

El resto de las teclas no cambia. `↓` desde una cabecera aterriza en la entrada visible siguiente,
que suele ser su primera fila de datos. Una cabecera de grupo **se puede seleccionar**, así que
`update:activeCell` se emite con su posición, pero `cellSelect` **no**: no hay ninguna fila detrás de
ella de la que informar.

Lo mismo con el clic: un clic sobre una cabecera la pliega y no emite `rowClick`.

### Persistencia

La agrupación se guarda junto con el resto del layout, bajo la bandera `include.grouping`, que viene
en `true`:

```ts
const persist: DataTablePersistOptions = {
  include: { visibility: true, widths: true, order: true, grouping: false },
}
```

Es una bandera propia y no una ampliación silenciosa de otra: un consumidor que ya tenía escrito
`include: { order: true, widths: true }` esperaba que eso fuera una lista cerrada, y colgar la
agrupación de `order` —que es lo más parecido— le cambiaría el comportamiento sin que haya tocado
nada.

Se persisten dos claves, las dos opcionales dentro de `PersistedTableState`:

| Clave             | Qué guarda                                                    |
| ----------------- | ------------------------------------------------------------- |
| `groupBy`         | Las claves de agrupación, en orden.                           |
| `collapsedGroups` | Los `groupId` que quedaron **colapsados**, no los expandidos. |

Se guarda el conjunto colapsado porque el valor por defecto es expandido: con miles de grupos, la
lista de excepciones tiene unas pocas entradas y la de expandidos tendría miles.

Que las dos claves sean opcionales es lo que permitió sumar esta función **sin subir la versión del
esquema**. Un payload escrito antes de que la agrupación existiera no las trae, y una tabla que nunca
agrupó tampoco las escribe: su payload sigue siendo byte por byte el de siempre, así que nadie pierde
su layout guardado al actualizar la librería.

**Cómo se reconcilia lo guardado.** El estado leído del almacenamiento está desactualizado por
definición, así que nunca se aplica tal cual:

| Situación                                                                                 | Qué pasa al cargar                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groupBy` nombra una columna que ya no existe                                             | La clave se descarta. Si no queda ninguna, la tabla arranca sin agrupar.                                                                                                |
| `groupBy` nombra una columna que hoy tiene `groupable: false`                             | La clave se descarta.                                                                                                                                                   |
| Un `groupId` colapsado cuyo camino de columnas **no es prefijo** de la agrupación vigente | Se descarta. Un `status:open/priority:high` no puede corresponder a ningún grupo si hoy se agrupa solo por `['status']`.                                                |
| Un `groupId` colapsado cuyo **valor** ya no existe en los datos                           | Se conserva. Los datos cambian entre sesiones, y descartar el estado de un grupo porque hoy no hay filas con ese valor lo haría reaparecer expandido en cuanto vuelvan. |
| Un `groupId` malformado                                                                   | Se descarta. La falla es segura: el grupo simplemente vuelve a aparecer expandido.                                                                                      |

El orden de aplicación importa y está fijado: primero `groupBy`, después el conjunto colapsado. El
árbol de grupos se reconstruye de forma síncrona al cambiar `groupBy`, y el conjunto colapsado se
resuelve contra los grupos que ese árbol tiene. Aplicarlo al revés lo resolvería contra el árbol
viejo.

`resetLayout()` limpia también la agrupación y el conjunto colapsado, además de visibilidad, orden y
anchos.

### Dos números distintos: posición visible e índice original

Esta es la única parte de la agrupación que se puede usar mal en silencio, y conviene leerla entera.

**`CellPosition.rowIndex` indexa la SECUENCIA VISIBLE.** Todo lo que consume una posición dentro del
componente la interpreta así:

- `v-model:active-cell`
- `selectCell(pos)` y `scrollToCell(pos)`
- `scrollToRow(index)`

**Los EVENTOS reportan el índice dentro de la prop `rows`.** Todos, sin excepción:

- `cellSelect`
- `rowClick`
- `beforeEdit`, `afterEdit` y `editCommit`

**Sin agrupación los dos números son idénticos** y no hay nada que distinguir. Con agrupación no:
la secuencia visible intercala cabeceras y esconde a los hijos de los grupos colapsados, así que la
posición vertical de una celda deja de ser su índice en el dataset. Una fila que se ve en la posición
7 puede ser la 340 de `rows`, o puede no ser una fila de datos en absoluto.

> **Este es el error que corrompe datos.** Si se usa el `rowIndex` de un evento como si fuera una
> posición visible, o al revés, la escritura cae sobre otra fila del dataset. Nada lo delata: la
> tabla sigue funcionando, el valor aparece, y el problema no se ve hasta que alguien mira los datos.

La regla práctica es corta: **el índice de un evento se usa para escribir en `rows`; una
`CellPosition` se usa para mover la vista.** Nunca al revés.

```ts
// ✓ Correcto: `event.rowIndex` es un índice de `rows`, también con grupos activos.
function onEditCommit(event: EditCommitEvent<Invoice>): void {
  const next = rows.value.slice()
  next[event.rowIndex] = { ...event.row, [event.columnKey]: event.newValue }
  rows.value = next
}

// ✗ Incorrecto: `activeCell.rowIndex` es una posición de la vista aplanada.
// Con grupos, esta lectura devuelve la fila equivocada, o `undefined` sobre una cabecera.
const selectedRow = rows.value[activeCell.value?.rowIndex ?? 0]
```

Que la posición interna sea la visible es deliberado y no un descuido: todo lo que la consume dentro
del componente —la geometría del editor, el auto-scroll, el movimiento con flechas— es geométrico, y
una posición que no se pueda traducir a píxeles sin una búsqueda no serviría para nada de eso. Una
cabecera de grupo, además, no tiene índice en `rows` y aun así se puede seleccionar y recorrer con el
teclado.

### Formato de los agregados

`column.format` **no** se aplica a las cifras de las cabeceras, y la razón es la firma: pide
`(value, row, rowIndex)`, y una cabecera de grupo no pertenece a ninguna fila en particular. Por eso el
formato de un agregado se declara aparte, con `column.formatAggregate`, cuya firma solo pide lo que
una cabecera sí tiene:

```ts
formatAggregate?: (value: CellValue, column: DataTableColumn<TRow>) => string
```

```ts
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const columns: readonly DataTableColumn<Invoice>[] = [
  { key: 'region', label: 'Region', width: 140 },
  {
    key: 'total',
    label: 'Total',
    width: 140,
    renderer: 'number',
    aggregate: 'sum',
    // La celda sigue usando `format`; la cabecera usa este.
    format: (value) => (typeof value === 'number' ? money.format(value) : ''),
    formatAggregate: (value) => (typeof value === 'number' ? money.format(value) : ''),
  },
]
```

Sin `formatAggregate`, la cifra se escribe con la representación por defecto del valor: una columna de
moneda muestra `1200` pelado, un `avg` sobre porcentajes muestra `47.31818181818182` y un `min` sobre
fechas muestra el string ISO completo. Es exactamente el comportamiento anterior, así que agregar la
opción no le cambió la salida a nadie.

**Corre en el camino de pintado de la cabecera**, una vez por columna agregada y por grupo visible en
cada frame. Vale la misma regla que para `format`: el formateador se construye a nivel de módulo y la
función es una sola llamada barata. El caché de escrituras sigue vigente aguas abajo —si el texto
producido es idéntico al que la cabecera ya muestra, no se toca el DOM—, pero la función igual se
ejecuta, así que un `formatAggregate` caro sí se paga por frame.

La alternativa sigue disponible y a veces es la correcta: una **agregación propia que devuelva el
string ya armado**, porque `AggregationFn` puede devolver cualquier `CellValue`, texto incluido. La
diferencia es dónde queda el valor: con `formatAggregate` el agregado sigue siendo un número y solo su
presentación cambia; con una agregación que formatea, el dato mismo pasa a ser texto.

### Clases CSS de un grupo

Las cabeceras las pinta el pool, fuera del render de Vue, así que **las reglas que las apunten tienen
que ser globales**: un `<style scoped>` nunca se les aplica.

| Clase o token             | Qué es                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.dt-group-row`           | La fila que hace de cabecera. Ocupa la misma caja que una fila de datos: mismo alto, misma posición absoluta. |
| `.dt-group-row--expanded` | Presente mientras el grupo muestra su contenido. Es lo que gira el chevron por CSS.                           |
| `.dt-group-header`        | La banda. Cruza la fila entera, de borde a borde, incluido el tramo de las columnas ancladas.                 |
| `.dt-group-header-inner`  | Chevron, etiqueta e insignia. Se planta con `position: sticky` a la derecha de la regleta.                    |
| `.dt-group-chevron`       | El SVG del chevron. Gira con una transición de 120ms, resuelta por el compositor.                             |
| `.dt-group-label`         | El texto del grupo, ya resuelto contra `column.options`.                                                      |
| `.dt-group-count`         | La insignia con la cantidad de filas descendientes. Se oculta con `showGroupCount: false`.                    |
| `.dt-group-aggregate`     | Una cifra de agregado, posicionada en el offset de su columna y por encima de la cabecera.                    |
| `--dt-group-indent`       | Sangría por nivel de anidamiento. `16px`, o `12px` con `dense`.                                               |
| `--dt-group-depth`        | Nivel de anidamiento de esa fila. Lo escribe el pool, una sola propiedad por fila.                            |

La sangría es un `padding-left` calculado a partir de esas dos custom properties, y no divs
anidados: es una escritura de propiedad contra crear y destruir nodos cada vez que un slot pasa de un
nivel a otro.

**Una cabecera de grupo son dos cajas, y hacen falta las dos.** La de afuera es la banda y mide lo
que la fila entera; la de adentro lleva el contenido y se queda quieta con `position: sticky`
mientras la fila se corre por debajo. Una sola caja no puede hacer las dos cosas: o mide lo que la
fila y entonces la etiqueta se va con el scroll, o se queda quieta y entonces la banda no cubre la
fila. Es la misma decisión que sostiene el encabezado, la regleta y las columnas ancladas: lo que
tiene que quedarse quieto lo sostiene el compositor, nunca una corrección escrita por JavaScript.

**Una columna anclada no pinta su agregado.** `aggregate` sobre una columna con `pinned` se ignora
en silencio. Es una limitación conocida, y tiene un motivo además del técnico: un agregado se dibuja
en el offset de SU columna, así que en una columna anclada al inicio caería justo encima del chevron,
la etiqueta y el contador del grupo. Si necesitas la cifra de esa columna, la vía es no anclarla.

### Qué cuesta agrupar

| Operación                          | Cuándo ocurre                                              | Costo                                                              |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Construir el árbol y los agregados | Cambia la identidad de `rows`, de `columns` o de `groupBy` | O(filas × niveles), una vez                                        |
| Emitir la vista aplanada           | Cambia el árbol o el estado de expansión                   | O(entradas visibles)                                               |
| Plegar un grupo                    | Un clic o una tecla                                        | Solo la emisión: el árbol ya está y no se recalcula ni un agregado |
| Scrollear                          | Cada frame                                                 | Nada: aplanar no depende del scroll                                |

Las dos derivaciones están separadas justamente para esto. Con una sola, cada clic en un chevron
costaría la reconstrucción completa del árbol.

---

## Temas

Todos los colores se declaran como `var(--ui-*, <fallback>)`. Si la aplicación anfitriona define los
tokens de **NuxtUI v3**, la tabla los adopta sin ninguna configuración; si no, el fallback la deja
presentable por su cuenta. La indirección extra `--dt-*` permite además sobrescribir el token de una
sola tabla sin tocar el tema global.

```css
/* Sobrescribir un token para una tabla, desde cualquier punto del CSS. */
.invoices .dt-root {
  --dt-primary: #6366f1;
  --dt-row-height: 36px; /* solo presentación — ver el aviso de más abajo */
}
```

### Dónde se declaran los tokens

**Sobre `.dt-root`, o como `--ui-*` en cualquier ancestro.** Declarar un `--dt-*` en un contenedor
que envuelve a la tabla **no hace nada**, y es la trampa más fácil de esta hoja de estilos porque
falla en silencio: no hay error, simplemente el color no cambia.

```css
/* ✗ No hace nada: la tabla se lo pisa. */
.mi-contenedor {
  --dt-primary: #8b5cf6;
}

/* ✓ Sobre la raíz de la tabla. */
.mi-contenedor .dt-root {
  --dt-primary: #8b5cf6;
}

/* ✓ O el token de la aplicación anfitriona, en cualquier ancestro. */
.mi-app {
  --ui-primary: #8b5cf6;
}
```

El motivo es la cascada de custom properties: `.dt-root` declara `--dt-primary: var(--ui-primary,
#00c16a)` **sobre sí mismo**, y una declaración en el elemento siempre le gana a un valor heredado de
un ancestro. Medido sobre la tabla montada, con el token puesto en el contenedor padre:

| Dónde se declara                      | `--dt-primary` resultante |
| ------------------------------------- | ------------------------- |
| `--dt-primary` en un contenedor padre | `#00c16a` — sin efecto    |
| `--dt-primary` sobre `.dt-root`       | el valor puesto           |
| `--ui-primary` en un contenedor padre | el valor puesto           |

Por eso la columna **Adopta** de la tabla de abajo es la que importa cuando el estilo se define lejos
de la tabla: esos son los tokens que sí se heredan.

### Tokens

| Token                   | Por defecto en claro | Por defecto en oscuro | Adopta                                 |
| ----------------------- | -------------------- | --------------------- | -------------------------------------- |
| `--dt-bg`               | `#ffffff`            | `#111827`             | `--ui-bg`                              |
| `--dt-bg-muted`         | `#f9fafb`            | `#1f2937`             | `--ui-bg-muted`                        |
| `--dt-bg-elevated`      | `#f3f4f6`            | `#1f2937`             | `--ui-bg-elevated`                     |
| `--dt-bg-accented`      | `#e5e7eb`            | `#374151`             | `--ui-bg-accented`                     |
| `--dt-border`           | `#e5e7eb`            | `#374151`             | `--ui-border`                          |
| `--dt-border-accented`  | `#d1d5db`            | `#4b5563`             | `--ui-border-accented`                 |
| `--dt-text`             | `#111827`            | `#f9fafb`             | `--ui-text`                            |
| `--dt-text-muted`       | `#6b7280`            | `#9ca3af`             | `--ui-text-muted`                      |
| `--dt-text-dimmed`      | `#9ca3af`            | `#6b7280`             | `--ui-text-dimmed`                     |
| `--dt-primary`          | `#00c16a`            | igual                 | `--ui-primary`                         |
| `--dt-radius`           | `0.375rem`           | igual                 | `--ui-radius`                          |
| `--dt-copy-flash-color` | `#ffffff`            | igual                 | — (ver [el copiado](#el-copiado))      |
| `--dt-root-radius`      | `0`                  | igual                 | — (lo escribe `radiusBorder`)          |
| `--dt-row-number-width` | según los dígitos    | igual                 | — (lo escribe el componente inline)    |
| `--dt-color-blue`       | `#1d4ed8`            | `#60a5fa`             | —                                      |
| `--dt-color-red`        | `#b91c1c`            | `#f87171`             | —                                      |
| `--dt-color-amber`      | `#b45309`            | `#fbbf24`             | —                                      |
| `--dt-color-green`      | `#15803d`            | `#4ade80`             | —                                      |
| `--dt-color-purple`     | `#7e22ce`            | `#c084fc`             | —                                      |
| `--dt-color-neutral`    | `#4b5563`            | `#9ca3af`             | —                                      |
| `--dt-tint-strength`    | `14%`                | `20%`                 | —                                      |
| `--dt-row-height`       | `40px`               | igual                 | se escribe inline desde `rowHeight`    |
| `--dt-header-height`    | `44px`               | igual                 | se escribe inline desde `headerHeight` |
| `--dt-font-size`        | `0.875rem`           | igual                 | —                                      |
| `--dt-cell-px`          | `0.75rem`            | igual                 | —                                      |
| `--dt-group-indent`     | `16px`               | igual                 | — (`12px` con `dense`)                 |
| `--dt-selection-width`  | `1px`                | igual                 | —                                      |
| `--dt-crosshair-width`  | `2px`                | igual                 | —                                      |
| `--dt-row-tint-hover`   | 8% de `--dt-text`    | igual                 | — (sale de `--dt-text`)                |

`--dt-selection-width` es el grosor de las **tres** marcas de selección a la vez: el anillo de la
celda activa, el recuadro del rango y el destello del copiado. Es un solo token porque las tres
tienen que medir lo mismo —el destello se dibuja exactamente encima del recuadro— y vale `1px` para
que la línea coincida con las de la grilla de `bordered` y del preset `cells`. Subirlo a `2px`
devuelve el contorno más marcado que tenía antes. La única línea que NO sale de aquí es el corte del
bloque anclado, que son 2px a propósito.

`--dt-row-tint-hover` es el realce de la fila bajo el puntero, y solo aparece con
`selectionMode: 'row'` —ver [El realce de la fila](#el-realce-de-la-fila)—. Es un **tinte
semitransparente** y no un color: la banda cruza dos fondos distintos, el de las celdas y el de la
regleta, que está un escalón más arriba. Cualquier color fijo que se vea contra uno se pierde
contra el otro. Sale de `--dt-text` para seguir al tema solo: aclara en oscuro y oscurece en claro.

La paleta de estados existe para que `CellOption.color` pueda ser un token del tema en lugar de un
hexadecimal fijo. Conviene usar el mapa exportado `COLOR_TOKENS` (`COLOR_TOKENS.red` →
`'var(--dt-color-red)'`), así un renombre en la hoja de estilos se propaga desde un solo lugar.
`CellOption.color` también acepta cualquier color CSS.

Los badges usan **fondo teñido con texto saturado** y no un relleno sólido con texto blanco, a
propósito: un relleno sólido obligaría a garantizar el contraste del texto contra seis colores más lo
que traiga el consumidor, lo que en la práctica significa calcular luminancia. Con el tinte, el texto
conserva el color de acento —ya elegido para ser legible sobre el fondo del tema— y el tinte nunca lo
tapa.

Los renderers escriben tres custom properties más por celda: `--dt-badge-color`,
`--dt-progress-color` y `--dt-avatar-color`. Para re-estilar un renderer, se redefine cómo las
consume la hoja de estilos.

> **`rowHeight` es una prop, no un token CSS.** El virtualizador divide el offset de scroll por la
> altura de fila en cada frame; leer ese número desde CSS exigiría un `getComputedStyle` por frame,
> que fuerza layout. La prop es la fuente de verdad y `--dt-row-height` es su espejo. Definir solo la
> variable CSS desincroniza la geometría de la matemática. Lo mismo vale para `--dt-header-height`.

### Claro y oscuro

Tres caminos hacia el modo oscuro, y ninguno de ellos puede pisar una elección explícita de claro:

1. `theme="dark"` en el componente (`data-theme="dark"` sobre la raíz).
2. Una clase `.dark` en `<html>`, para un toggle a nivel aplicación, con `theme="auto"`.
3. `prefers-color-scheme: dark`, acotado como `:root:not(.light)` para que una aplicación que fuerza
   el modo claro le gane a la preferencia del sistema.

`theme="light"` no coincide con ninguno de los tres, así que siempre gana.

`DataTableColumnToggle` es un componente aparte que se puede montar fuera de `.dt-root`, así que
sigue al **documento** (clase `.dark` / `.light`, o la preferencia del sistema) y no a la prop `theme`
de la tabla. Manejando la clase del documento junto con la prop, los dos quedan sincronizados:

```ts
watchEffect(() => {
  const classes = document.documentElement.classList
  classes.toggle('dark', theme.value === 'dark')
  classes.toggle('light', theme.value === 'light')
})
```

### El preset `dense`

`dense` no es una sola perilla: altura de fila `40 → 30`, header `44 → 34`, tipografía
`0.875 → 0.8125rem`, padding de celda `0.75 → 0.5rem` y sangría de grupo `16 → 12px`. Un `rowHeight`
o un `headerHeight` explícitos siguen ganando.

### La prop `variant`

`variant` es un preset, igual que `dense`: `'default'` es el aspecto de siempre, gobernado por
`stripe` y `bordered`. Los otros dos son los extremos, y **pisan** a esas dos props en lugar de
sumarse a ellas:

| Valor       | Qué dibuja                                                                           |
| ----------- | ------------------------------------------------------------------------------------ |
| `'default'` | Lo que digan `stripe` y `bordered`.                                                  |
| `'cells'`   | Grilla completa, celda por celda. Para que la tabla se lea como una hoja de cálculo. |
| `'rows'`    | Solo una línea entre filas. Ninguna vertical, tampoco en el encabezado.              |

Que pisen y no se sumen es deliberado. Lo que elige un preset no es cuánta decoración poner sino
**qué estructura se lee primero**: la grilla de celdas o la secuencia de filas. Eso no se puede
expresar sumando dos interruptores sueltos, y con `variant: 'rows'` más `bordered` encendido habría
que decidir quién gana en cada cruce.

La única vertical que sobrevive a `'rows'` es el corte del bloque anclado. No es decoración: dice
dónde termina lo que está fijo y empieza lo que scrollea, y sin él las dos partes se verían iguales
hasta que alguien scrollee.

### Marcar filas con casillas

`selectionColumn` enciende una columna de casillas al inicio, con la tricasilla en el encabezado. La
pone la tabla: no se declara en `columns` ni hay que reservarle ancho.

```vue
<DataTable
  :rows="rows"
  :columns="columns"
  row-key="id"
  selection-column
  v-model:selected-rows="seleccionadas"
/>
```

Lo marcado se guarda **por clave de fila y nunca por posición**, y esa es toda la idea. Si se
guardara por índice, filtrar la tabla dejaría la marca sobre otra fila: la que estaba en la posición
1 deja de estarlo en cuanto cambia el conjunto. Con claves, filtrar y desfiltrar no le hace nada a la
selección; lo que vuelve a aparecer vuelve marcado.

#### Los dos modos, y por qué hay dos

| `mode`   | Qué es `keys`     | Cuándo                                       |
| -------- | ----------------- | -------------------------------------------- |
| `'some'` | Las marcadas      | Lo de siempre.                               |
| `'all'`  | Las **excluidas** | Después de marcar la casilla del encabezado. |

El segundo existe por un caso que no se puede resolver de otra forma: 9000 filas en modo servidor, de
las cuales la tabla conoce las 50 que descargó, y el usuario presiona la casilla del encabezado. No
hay 9000 claves que enumerar. Invertido, la respuesta es "todas menos estas", que se traduce a un
`WHERE ... NOT IN` sin traerse el dataset entero —y una fila que todavía no llegó aparece marcada
sola cuando llega—.

Por eso **no se lee con `keys.includes(...)`**: en `'all'` esa pregunta da la respuesta al revés.
Para eso se exportan dos ayudantes que ya saben invertirla:

```ts
import { countSelectedRows, isRowSelected } from 'vue-tablekit'

isRowSelected(seleccionadas, fila.id) // ¿esta fila está marcada?
countSelectedRows(seleccionadas, total) // cuántas hay, contra el dataset entero
```

#### Poner tu propia casilla

Con un objeto en lugar de `true` se cambia cómo se ve, sin poder romper lo que la hace funcionar:

```vue
<DataTable
  :selection-column="{ width: 56, renderer: miCasilla }"
  v-model:selected-rows="seleccionadas"
/>
```

El renderer recibe en `ctx.value` si ESA fila está marcada —`true` o `false`, ya resuelto contra los
dos modos—, así que no tiene que conocer la forma del conjunto. Se puede cambiar `width`, `header`,
`pinned`, `align`, `cellClass` y `renderer`.

Lo que **no** se puede pisar es la clave de la columna ni las banderas que la vuelven una columna
quieta: no se ordena, no se mueve, no se esconde y no lleva menú. Dejarlas abiertas permitiría que el
usuario terminara sin forma de marcar una fila.

#### Si no tienes un identificador

`rowKey` es opcional. Sin declararlo, la tabla le cuelga a cada fila una identidad atada a la
**referencia** de su objeto, y eso alcanza para todo lo que pasa del lado del cliente: `filter` y
`toSorted` devuelven los mismos objetos, así que una selección sobrevive a filtrar y a reordenar sin
que declares nada.

**No alcanza en modo servidor.** Cada página llega como objetos nuevos de un JSON: la referencia de
ayer no existe hoy, y un hash del contenido se rompe en cuanto un campo cambia o hay dos filas
iguales. Si el servidor no distingue dos registros, la tabla tampoco puede. Con `rowCount` declarado
y sin `rowKey` se avisa una vez por consola, en lugar de perder lo marcado en silencio.

> `selectionColumn` **no** es `rowSelection`. Aquel agrega la columna de casillas y un conjunto que
> persiste; este es un gesto sobre la regleta que produce un rango de celdas. Ver
> [Seleccionar en bloque](#seleccionar-una-columna-o-una-fila-entera).

### El esqueleto de carga

Una barra por celda, en la posición exacta de **su** columna, con un latido suave. No es una franja
gris a lo ancho de la fila, y la diferencia no es estética: una franja no se corresponde con nada del
encabezado y se lee como un error de pintado, mientras que las barras alineadas se leen como lo que
son, las mismas columnas esperando su contenido.

Aparece por dos caminos:

**Solo, en modo servidor.** Una fila cuya página todavía no llegó se pinta así sin que haya que
pedirlo. Es el caso del scroll rápido, y no necesita ninguna prop.

**A mano, con `loading`.** Enciende el esqueleto sobre **todas** las filas visibles, haya datos o no.
Cubre los dos momentos que el automático no alcanza:

```vue
<DataTable :rows="rows" :columns="columns" :loading="cargando" />
```

| Momento       | Qué pasa sin `loading`                                                                  |
| ------------- | --------------------------------------------------------------------------------------- |
| Primera carga | `rows` vacío → se muestra `emptyText`, que afirma algo que nadie sabe todavía.          |
| Reconsulta    | `rows` trae el resultado ANTERIOR → se muestran datos viejos como si fueran los nuevos. |

Por eso `loading` **gana sobre el dato** en lugar de rellenar solo los huecos: en una reconsulta las
filas sí están, y mostrarlas sería mentir sobre lo que se ve.

Mientras está encendido no aparece `emptyText`: "no hay datos" y "todavía no sé" no son lo mismo. Y
con `rows` vacío se dibujan las filas que entren en la pantalla y ni una más: el esqueleto es una
señal de espera, no una promesa de cuántos resultados van a llegar.

El latido es una animación de `opacity`, que resuelve el compositor sin repintar: decenas de barras a
la vez no le cuestan un frame al scroll. Con `prefers-reduced-motion` se apaga y las barras quedan
quietas.

### La regleta de numeración

`showRowNumbers` —encendida por defecto— dibuja una franja con el número de cada fila, pegada al
borde izquierdo y **fija mientras el resto scrollea en horizontal**.

**No es una columna, y esa es toda la idea.** Si lo fuera habría que excluirla a mano de la selección,
del copiado, del reordenamiento, del selector de columnas, de la navegación con flechas y del
`aria-colcount`, y cada una de esas exclusiones sería una oportunidad de olvidarse de una. Como
carril aparte no participa de nada de eso por construcción: no hay nada que excluir.

| Qué                       | Cómo                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| El número que muestra     | La **posición visible**, en base 1. Es lo que uno cuenta con el dedo, no el índice dentro de `rows`.                    |
| Con una cabecera de grupo | Casilla vacía. Una cabecera ocupa una posición visible pero no es una fila del dataset.                                 |
| Ancho                     | Un **cuadrado**: el lado de la fila. Solo se ensancha si el número no entra ahí. Se publica en `--dt-row-number-width`. |
| Accesibilidad             | `aria-hidden`. La posición ya viaja por `aria-rowindex`, que es el canal que un lector entiende como tal.               |
| Enganches CSS             | `.dt-gutter` (el carril), `.dt-row-number` (cada número), `.dt-corner` (la esquina sobre el header).                    |

**Cómo queda fija sin costar por fila.** El carril vive _dentro_ del viewport que scrollea —así el
scroll vertical lo mueve solo, que es lo que se quiere— y _fuera_ del canvas, en el **flujo**, que es
lo que le permite quedarse quieto en horizontal con `position: sticky`. Cero escrituras por frame, y
lo más importante: quien lo sostiene es el compositor.

Compensarlo desde JS —un `transform` de signo contrario dentro del `requestAnimationFrame`, que es lo
que hacía antes— **no puede funcionar bien**, y no por estar mal escrito. El navegador scrollea en el
hilo del compositor y compone el frame con el desplazamiento nuevo _antes_ de que el hilo principal
alcance a escribir la compensación. Medido frame compuesto por frame compuesto en el navegador, uno de
cada dos mostraba la regleta corrida el delta entero del scroll y el siguiente la devolvía de un
salto: a 70px por paso, eso se ve como temblor. El mismo razonamiento vale para las
[columnas ancladas](#columnas-ancladas), que se resuelven igual.

**El ancho es un cuadrado.** Tan ancha como alta es la fila: es la forma que tiene la numeración en
cualquier hoja de cálculo, y la que hace que se lea como un margen y no como una columna más. Solo cuando el
número no entra en ese cuadrado —cinco dígitos o más— la regleta se ensancha, y lo justo. El lado se
acota además a una banda, porque con filas muy bajas o muy altas el cuadrado dejaría de tener sentido:
un borde grueso en un caso, una franja enorme en el otro.

El espacio que ocupa entra **una sola vez**, en el layout de columnas, como offset previo a la
primera columna. De ahí se propaga a todo lo que usa coordenadas horizontales —header, celdas,
editor, recuadro del rango, ventana visible, auto-scroll— sin que ninguna de esas piezas sepa que la
regleta existe. Apagarla devuelve el offset a cero y no hay nada más que deshacer.

Encenderla o apagarla en caliente **reconstruye el pool**: el nodo del número nace junto a su fila y
comparte su slot, así que agregarlo o sacarlo a mitad de vuelo costaría recorrer el pool igual. Es
una prop de configuración, no algo que cambie durante el uso.

### El redondeo de la caja

`radiusBorder` redondea **solo las esquinas de la tabla**, no los redondeos internos: las píldoras y
el panel del selector de columnas siguen el radio del tema, `--dt-radius`.

El editor de celda no sigue ninguno de los dos: es **recto siempre**, y a propósito. Se posiciona con
la caja exacta de la celda que está editando, que es un rectángulo recto; cualquier radio dejaría las
cuatro esquinas sin tapar y por ahí se vería la grilla de abajo.

| Valor              | Radio                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| `'none'` (defecto) | `0`. Esquinas rectas.                                                                   |
| `'sm'`             | `0.25rem`                                                                               |
| `'md'`             | **El radio del tema**, `var(--dt-radius)`, que a su vez adopta `--ui-radius` si existe. |
| `'lg'`             | `0.5rem`                                                                                |
| `'xl'`             | `0.75rem`                                                                               |

**Por qué el defecto es recto.** Una grilla casi siempre se embebe en un panel que ya tiene su propio
redondeo, y dos radios distintos a pocos píxeles uno del otro se leen como un error de alineación.
`md` existe justamente para el caso contrario: acompañar el radio que la aplicación ya definió, sin
repetir el número.

La prop escribe `data-radius` en `.dt-root` y el CSS traduce ese atributo a `--dt-root-radius`, que
es el token que se puede pisar desde afuera.

### Estilos de la selección

La selección no introduce ningún token nuevo: se dibuja enteramente con `--dt-primary` y
`--dt-bg-accented`, así que re-estilar el acento re-estila la selección.

| Enganche                           | Qué hace                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dt-cell--active`                 | La celda activa. `box-shadow: inset 0 0 0 var(--dt-selection-width) var(--dt-primary)` más `z-index: 1`.                                                                                          |
| `.dt-row--active`                  | La fila que contiene la celda activa, en **los dos** modos. Pone `--dt-row-bg` en `--dt-bg-accented`; quien lo pinta es la regleta y las celdas ancladas. También aplica a una cabecera de grupo. |
| `.dt-header-cell--active`          | El header de la columna activa. Fondo acentuado. La línea de color la agrega `crosshair`. **No se aplica en modo fila**, donde la columna no es parte de lo elegido.                              |
| `.dt-row-number--active`           | El número de la fila activa. Fondo acentuado y negrita. La línea de color la agrega `crosshair`.                                                                                                  |
| `[data-crosshair]` en `.dt-root`   | Replica `crosshair` (`'true'` / `'false'`). Es de lo único que cuelgan las dos líneas.                                                                                                            |
| `[data-selection]` en `.dt-root`   | Replica `selectionMode` (`none` / `cell` / `row`). En modo `'row'` ninguna celda se marca: quien señala la fila activa es su número en la regleta.                                                |
| `[data-focus-ring]` en `.dt-root`  | Replica `focusRing` (`'true'` / `'false'`). Es la primera de las dos condiciones del anillo del viewport.                                                                                         |
| `[data-active-cell]` en `.dt-root` | `'true'` mientras hay una celda marcada **en pantalla**. Es la segunda condición: con una celda marcada, el anillo del viewport se suprime.                                                       |
| `.dt-row-number--hover`            | El número de la fila bajo el puntero. Lo pone el pool, no el CSS: ver [El realce de la fila](#el-realce-de-la-fila).                                                                              |

#### El realce de la fila

Con `selectionMode: 'row'` la fila bajo el puntero se tiñe y el cursor pasa a `pointer`. No es
decoración: es el anticipo de lo que va a hacer el clic, y por eso **no** aparece en `'cell'` —donde
lo que se elige es una celda— ni en `'none'`. Queda fuera la cabecera de grupo y el
esqueleto de carga.

Va detrás de `@media (hover: hover)`: en una pantalla táctil `:hover` se queda pegado después de
tocar, y el realce sobreviviría al toque leído como una selección que no es.

La fila activa **sí** se realza. El tinte se suma al color que ella ya tiene, así que se lee como
elegida Y apuntada; un color que la reemplazara la habría hecho ver soltarse, que es lo que hacía
falta evitar. Excluirla dejaba la fila que uno acababa de tocar como la única que no responde al
puntero, y eso se lee como una fila trabada.

Dos detalles que importan si vas a re-estilarlo:

- **El tinte va en `background-image`, no en `background-color`.** Una celda anclada necesita su
  color de fondo opaco para tapar lo que scrollea por debajo; un tinte semitransparente ahí la
  volvería una ventana. Es la misma disciplina que `.dt-cell--range`.
- **La regleta no la alcanza ningún selector.** El número no es hijo de su fila —vive en un carril
  que no scrollea en horizontal—, así que el pool le pasa `.dt-row-number--hover` a mano y el CSS
  decide si lo pinta. Sin ese puente la banda queda cortada justo en el borde de la regleta.

El anillo del viewport sale de una sola regla, y las dos condiciones son literales del selector:

```css
.dt-root[data-focus-ring='true'][data-active-cell='false'] .dt-viewport:focus-visible {
  outline: 2px solid var(--dt-primary);
  outline-offset: -2px;
}
```

**`data-active-cell` dice "hay una marca visible", no "hay una posición guardada".** La diferencia se
nota cuando la columna de la celda activa no resuelve a ninguna columna pintada: porque el usuario la
ocultó con el selector de columnas, o porque `selectCell()` recibió por código una clave que no
existe. En ese estado ninguna celda se pinta activa, así que el atributo vuelve a `'false'` y el
anillo del viewport reaparece. Es deliberado: con la marca de celda ausente, el anillo es la **única**
señal que le queda a quien navega por teclado, y suprimirlo dejaría la tabla enfocada sin ninguna
indicación de dónde está parado el usuario.

La selección en sí no cambia por esto. La posición sigue guardada, se sigue anunciando por
`update:activeCell`, y volver a mostrar la columna vuelve a pintar la celda y a suprimir el anillo.

El anillo es un `box-shadow: inset`, y no un `border` ni un `outline`. La elección sostiene algo:

- Un `border` cambiaría la caja de la celda y correría su contenido cada vez que la selección se
  mueve.
- Un `outline` se dibuja por fuera de la caja, así que la celda vecina —que está posicionada en
  absoluto justo al lado— pintaría encima de la mitad.

El `box-shadow: inset` se dibuja dentro de la caja existente, no cuesta layout y compone. El
`z-index: 1` levanta la celda activa por encima de sus vecinas para que el anillo no quede recortado
por el fondo de la siguiente.

#### La cruz de la celda activa

`crosshair` enciende dos líneas de color: una **bajo el encabezado** de la columna activa y otra **al
costado del número** de su fila. Se cruzan en la celda donde está el usuario.

```vue
<DataTable :rows="rows" :columns="columns" row-key="id" crosshair />
```

Van juntas o no van: son la misma marca leída desde los dos bloques que **no scrollean**. Para qué
sirven se ve solo cuando la tabla es grande: se marca una celda, se scrollea lejos, la celda se va
de la pantalla —y el encabezado y la regleta siguen diciendo en qué columna y en qué fila estaba uno.
En una tabla que entra entera no agregan nada sobre el anillo de la celda, y de ahí que vengan
**apagadas**.

`crosshair: false` no deja ninguna de las dos. Lo que no toca es el **fondo acentuado** del
encabezado y del número, que va siempre: apagar la cruz apaga las líneas, no la referencia.

**En `selectionMode: 'row'` la cruz se reduce a su línea horizontal**, la del número de fila. No es
una limitación: ahí lo elegido es la fila entera y no hay ninguna columna que marcar —ver
[Qué cambia en modo fila](#qué-cambia-en-modo-fila)—. Una línea bajo un encabezado apuntaría a una
columna que el usuario no eligió, no puede mover y no ve marcada en ningún otro lado. El fondo
acentuado del encabezado se va por la misma razón; el del número de fila se queda.

El grosor sale de `--dt-crosshair-width`, que son `2px` y **no** comparte token con
`--dt-selection-width`. No es un descuido: el contorno de la selección tiene que confundirse con las
líneas de la grilla, y la cruz tiene que saltar a la vista desde el otro extremo de la tabla. Que hoy
uno mida el doble que el otro es una consecuencia, no la regla.

Las dos líneas son `box-shadow: inset`, por lo mismo que el anillo de la celda: un borde correría el
contenido del encabezado y del número cada vez que la selección se mueve. Y las dos cuelgan de
`[data-crosshair]` sobre `.dt-root`, un atributo que Vue escribe una vez —no el pool, y no por
frame—, así que encenderlas no le cuesta al camino caliente ni una escritura.

#### El color de una fila

Una fila **no pinta**: declara de qué color es en `--dt-row-bg` y nada más. Lo leen las piezas que sí
necesitan tapar lo que pasa por debajo —la celda de una columna anclada, el agregado de una cabecera
de grupo— y la regleta de numeración lleva su propio juego de clases.

No es un capricho: la fila mide **el ancho entero de la tabla**, porque es el bloque contenedor de los
carriles anclados y un `sticky` no se corre más allí del suyo. Si además pintara, cualquier fondo,
raya o borde suyo cruzaría la tabla de punta a punta. Separar "de qué color soy" de "yo pinto" deja el
ancho donde hace falta sin arrastrar decoración.

**La librería no dibuja cebra.** `stripe` pone la clase `.dt-row--stripe` y nada más: alternar el color
de las filas de una tabla con columnas ancladas se lee mal —la banda se corta donde termina lo anclado
o, si se pinta la fila entera, cruza por encima de todo—, así que la decisión queda del lado del
consumidor. Una regla como `.dt-row--stripe .dt-cell { background: … }` lo resuelve, y tiene que ser
global: las celdas del cuerpo las crea el pool fuera del render de Vue.

### Estilar celdas desde el CSS propio

`column.cellClass` devuelve un nombre de clase que aterriza en el elemento `.dt-cell`. **Esa regla
tiene que ser global.** Las filas y las celdas del cuerpo las crea el pool con
`document.createElement`, fuera del render de Vue, así que nunca llevan el atributo `data-v-*` en el
que se apoya `<style scoped>`: una regla con alcance que las apunte simplemente no se aplica nunca.
Lo mismo vale para las cabeceras de grupo y sus agregados.

Un detalle que conviene tener presente al escribir esas reglas: una celda cuyo renderer declara
`layout: 'box'` lleva además la clase `.dt-cell--box` y **es un contenedor flex**. Ahí `text-align` no
posiciona nada —lo hace `justify-content`, que la hoja ya deriva de la alineación de la columna— y lo
que se agregue adentro se comporta como un ítem flex. Las celdas de texto siguen siendo bloques
normales. Ver [Dos modos de maquetado](#dos-modos-de-maquetado-texto-y-caja).

El otro detalle es que dentro de `.dt-root` rige `[hidden] { display: none !important }`. El pool no
saca nada del DOM: apaga con `hidden` las filas y celdas sobrantes, la cabecera de grupo de un nodo
que pasó a mostrar datos y las celdas de uno que pasó a mostrar una cabecera. Como `[hidden]` vive en
la hoja del navegador, cualquier `display` de autor —de la librería o del consumidor— le ganaría por
origen y dejaría esos nodos pintados encima de los que sí corresponden. La regla restituye ese
significado para todo el subárbol: **un nodo con `hidden` no se pinta, declare lo que declare su
clase**. Para mostrar u ocultar contenido propio conviene no apoyarse en `display` sobre un nodo que
lleve `hidden`.

---

## Visibilidad, orden y persistencia de columnas

### Columnas ancladas

`column.pinned` saca una columna del scroll horizontal: `'start'` la deja pegada al borde izquierdo
—después de la regleta de numeración, si la hay— y `'end'` al derecho.

```ts
const columns = [
  { key: 'name', label: 'Proyecto', pinned: 'start' },
  { key: 'description' },
  { key: 'budget' },
  { key: 'active', label: 'Activo', pinned: 'end' },
]
```

**El anclaje manda sobre el orden.** Todas las de `'start'` van primero y todas las de `'end'` al
final, sin importar dónde estén declaradas ni dónde las haya dejado un arrastre; entre ellas conservan
el orden vigente. Una columna anclada además **no se puede mover arrastrando**: hacerlo significaría
desanclarla.

#### Anclar desde el encabezado

`column.pinnable` pone un botón de alfiler en el encabezado. **Por defecto no hay ninguno**: sin esa
bandera, una tabla no paga ni un nodo de más por columna.

```ts
const columns = [
  // Empieza anclada y el usuario la puede soltar.
  { key: 'name', label: 'Proyecto', pinned: 'start', pinnable: 'start' },
  // Empieza suelta y el usuario la puede anclar al borde izquierdo.
  { key: 'status', label: 'Estado', pinnable: true },
  // Al derecho.
  { key: 'active', label: 'Activo', pinnable: 'end' },
]
```

`pinned` es el estado **inicial**; `pinnable` es el **permiso**, y su valor dice a qué borde lleva el
**botón**: `true` y `'start'` son lo mismo, y `'menu'` significa "se puede anclar, pero sin botón". El
botón **alterna**: ancla si está suelta y suelta si está anclada, a cualquiera de los dos bordes.

**El menú, en cambio, ofrece siempre los dos bordes**, sea cual sea el valor. La asimetría sale de lo
que cada control puede hacer: un botón es un gesto y solo puede significar una cosa, así que se le
declara cuál; un menú tiene lugar para preguntar, así que pregunta. Es también la única forma de
mover una columna de un borde al otro sin soltarla primero.

El botón se ve al pasar el mouse por el encabezado, al recibir el foco, y **siempre que la columna
está anclada** —si desapareciera, una columna anclada quedaría sin nada que explique por qué no
scrollea ni cómo soltarla—. Donde no hay hover, una pantalla táctil, se ve siempre.

El texto del botón sale de `pinLabel` y `unpinLabel` (`'Pin column'` / `'Unpin column'`), que es su
`title` y su nombre accesible.

#### Dónde vive el anclaje elegido

En `columnPinning`, el cuarto v-model del juego de columnas. Se reconcilia contra las columnas
declaradas y **se persiste** junto al resto del layout.

```vue
<DataTable v-model:column-pinning="pinning" … />
```

Una clave en `null` significa "el usuario la soltó" y **no** es lo mismo que la clave ausente, que
significa "el usuario no la tocó" y deja mandar a `column.pinned`. Sin esa distinción, soltar una
columna declarada anclada sería imposible: volvería a anclarse sola.

`resetLayout()` vacía el mapa, que es volver a lo que declaran las columnas —y no dejarlas todas
sueltas—.

> **Ojo con `aggregate`.** Un agregado sobre una columna anclada se ignora: se dibuja en el offset de
> SU columna, y anclado al inicio caería encima de la etiqueta del grupo. Mientras el anclaje era solo
> declarativo eso se descubría al escribir la columna; con un botón lo dispara cualquiera en caliente,
> así que la tabla **avisa una vez por consola** cuando pasa.

#### Cómo se quedan quietas

Cada fila lleva dos **carriles** (`.dt-pinned-lane`): cajas de tamaño cero, invisibles, cuya única
propiedad es `position: sticky`. Las celdas ancladas cuelgan de ellos y no se enteran de que el canvas
se movió. Quien las sostiene es el **compositor**, no el pintado, y de ahí salen las consecuencias que
conviene conocer:

| Consecuencia                | Detalle                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Salen de la ventana virtual | Se pintan siempre, sobre nodos propios. Si además cayeran en la ventana se verían DOS veces: la anclada quieta y la suelta pasando por debajo. |
| No cuestan nada por frame   | Su posición no depende del scroll, así que un frame de scroll no las toca. Ni horizontal ni vertical.                                          |
| La fila necesita ancho      | Es el bloque contenedor del carril, y un `sticky` no se corre más allí del suyo. Lo escribe el pool con el ancho de la tabla.                  |
| Necesitan fondo opaco       | `.dt-cell--pinned` lo toma de `--dt-row-bg`, el color de su fila, así acompaña el realce sin repetirlo.                                        |

**Por qué no se compensa desde JS.** Era la implementación anterior —correr cada celda anclada por el
scroll dentro del `requestAnimationFrame`— y es inalcanzable por construcción: el navegador scrollea en
el hilo del compositor y compone el frame con el desplazamiento nuevo _antes_ de que el hilo principal
llegue a escribir la compensación. Medido frame compuesto por frame compuesto, uno de cada dos mostraba
la columna anclada corrida el delta entero del scroll y el siguiente la devolvía de un salto. El
problema no era qué valor se leía sino **quién aplica la posición**.

**El corte se ve.** Donde termina el bloque anclado del inicio —y donde empieza el del final— va una
línea al **doble** del grosor de una separación de celda. Es lo único que distingue a una columna
anclada de una cualquiera, así que se dibuja aunque `bordered` esté apagado. La lleva la última celda
del bloque del inicio y la primera del bloque del final (`.dt-cell--pinned-edge`), y en el encabezado
la dibuja la tira; las dos caen en la misma coordenada.

El carril del final se ancla al borde derecho de la fila con `margin-left: auto` y se pega al del
viewport con `right: 0`: los dos juntos dan el comportamiento completo sin medir nada. Mientras haya
algo que scrollear queda contra el borde, y cuando la tabla entera entra en pantalla su posición
natural ya está adentro, no se corre, y la columna se queda donde termina el contenido sin dejar un
hueco en el medio.

Todo lo demás sigue valiendo sobre una columna anclada: se selecciona, se copia, se edita —el editor
la acompaña cuando el resto scrollea— y se redimensiona. En el header, las ancladas viven en tiras
propias (`.dt-header-pinned`) que se plantan con `sticky` igual que los carriles del cuerpo; para ARIA
esas tiras son `role="none"`, así que los `columnheader` siguen perteneciendo a la fila de encabezado.

### Mover columnas arrastrando

Con `columnReorder` —encendida por defecto— el encabezado se agarra y se lleva: el cursor cambia a
`move` al pasar por encima, una **caja con el título** se despega del encabezado y sigue al puntero,
una **línea vertical** marca dónde va a caer la columna, y al soltar se escribe el nuevo orden.

Las tres señales dicen cosas distintas y por eso están las tres: el encabezado atenuado es **de
dónde** sale, la caja es **qué** se está moviendo, y la línea es **dónde** va a caer.

**No hay un modelo nuevo.** El arrastre escribe `columnOrder`, el mismo v-model que ya existía, que ya
se reconciliaba contra las columnas declaradas y que la persistencia ya guardaba. En modo controlado
el componente anuncia por `update:columnOrder` y el padre decide, igual que con todo lo demás.

| Detalle                     | Cómo                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Clic contra arrastre        | Un umbral de 4px. Por debajo sigue siendo un clic —y selecciona la columna, si `columnSelection` está—.     |
| Dónde cae                   | En el hueco más cercano, cortando por el MEDIO de cada columna, no por su borde.                            |
| La línea                    | `.dt-drop-indicator`. Aparece solo si soltar ahí cambiaría algo, así que su presencia ya es la respuesta.   |
| La columna en vuelo         | `.dt-header-cell--dragging`, atenuada.                                                                      |
| La caja que sigue al cursor | `.dt-column-ghost`. Nace encima del encabezado, conserva el punto donde se agarró y se recorta a 260px.     |
| Columnas ocultas            | Se quedan pegadas a la misma vecina. La traducción del hueco al orden completo va por CLAVE, no por índice. |
| El handle de redimensionado | No inicia el arrastre: tiene su propio gesto.                                                               |

**Anclar una columna** con `reorderable: false` significa las dos cosas: que no se la puede agarrar y
que **ninguna otra puede cruzarla**. Lo segundo no sale gratis —insertar una columna delante de la
anclada la correría un lugar—, así que el hueco de caída se acota para que las ancladas nunca cambien
de posición. Una columna anclada en el medio parte el encabezado en dos zonas, que es justo lo que se
espera al fijar una.

> **Sin camino de teclado.** Mover una columna hoy requiere un puntero. El estado sigue siendo
> `columnOrder`, así que una aplicación puede exponer su propia UI accesible escribiéndolo; lo que no
> hay es un atajo incluido.

### El trío de v-model

```vue
<DataTable
  v-model:column-visibility="visibility"
  v-model:column-order="order"
  v-model:column-widths="widths"
  …
/>
```

Conviene atar solo lo que se quiera poseer. En la práctica se suele atar `column-visibility` —para
que `DataTableColumnToggle` pueda compartirlo— y dejarle el orden y los anchos al componente.

`DataTableColumnToggle` es UI opcional sobre ese mismo estado:

```vue
<DataTableColumnToggle v-model="visibility" :columns="columns" label="Columns" />
```

| Prop         | Tipo                                | Por defecto |
| ------------ | ----------------------------------- | ----------- |
| `columns`    | `readonly DataTableColumn<TRow>[]`  | —           |
| `modelValue` | `Readonly<Record<string, boolean>>` | —           |
| `label`      | `string`                            | `'Columns'` |

Solo se listan las columnas con `hideable !== false`. **La última columna visible no se puede
ocultar**: su casilla queda deshabilitada en lugar de rechazar el clic en silencio, porque una tabla
con cero columnas no es una preferencia del usuario, es un estado roto sin vuelta atrás salvo
borrando el almacenamiento. Escape cierra el panel, las flechas mueven el foco entre las opciones, y
un clic afuera lo cierra.

### Persistencia

```vue
<!-- localStorage con los valores por defecto -->
<DataTable table-id="invoices" persist … />
```

```ts
// O configurada
const persist: DataTablePersistOptions = {
  enabled: true,
  adapter: myAdapter, // por defecto: localStorage
  debounce: 300, // ms; colapsa un arrastre de resize entero en una sola escritura
  version: 1, // subirla invalida los layouts viejos
  include: { visibility: true, widths: true, order: true, grouping: true, pinning: true },
}
```

| Detalle                   | Comportamiento                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clave de almacenamiento   | `datatable:{tableId}`                                                                                                                                |
| `tableId` ausente         | La persistencia queda **desactivada** y se emite un `console.warn` una sola vez. Nunca lanza.                                                        |
| Momento de la carga       | Al montar, antes de habilitar el guardado: de lo contrario el estado por defecto pisaría al guardado.                                                |
| Momento del guardado      | Con debounce (300ms por defecto). Se vuelca al desmontar, y a pedido con `flushPersistence()`.                                                       |
| Versión que no coincide   | El payload guardado se descarta entero.                                                                                                              |
| Payload corrupto          | Se valida la forma después del `JSON.parse`; cualquier cosa inesperada significa "empezar de cero", nunca una excepción.                             |
| Fallas del almacenamiento | Cuota agotada, modo privado, SSR: todas se absorben. Una preferencia que no se guarda es una molestia; una tabla que no renderiza por eso es un bug. |

### Adapter de almacenamiento propio

Se implementan tres métodos. Pueden ser síncronos o asíncronos.

```ts
import type { DataTableStorageAdapter, PersistedTableState } from 'vue-tablekit'

const remoteAdapter: DataTableStorageAdapter = {
  async load(key: string): Promise<PersistedTableState | null> {
    const response = await fetch(`/api/table-layout/${key}`)
    if (!response.ok) return null
    return (await response.json()) as PersistedTableState | null
  },
  async save(key: string, state: PersistedTableState): Promise<void> {
    await fetch(`/api/table-layout/${key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    })
  },
  async remove(key: string): Promise<void> {
    await fetch(`/api/table-layout/${key}`, { method: 'DELETE' })
  },
}
```

`save` y `remove` deben **absorber sus propias fallas**, nunca propagarlas. Todo lo que devuelva
`load` se valida y se reconcilia antes de llegar a la tabla, así que una respuesta malformada degrada
a los valores por defecto. `createLocalStorageAdapter()` está exportado, por si conviene envolver o
componer el adapter por defecto.

El payload persistido es plano y guarda solo claves, nunca definiciones de columna:

```ts
interface PersistedTableState {
  version: number
  columnVisibility: Record<string, boolean>
  columnWidths: Record<string, number>
  columnOrder: string[]
  // Solo aparecen si hay agrupación que guardar. Ver Agrupación → Persistencia.
  groupBy?: string[]
  collapsedGroups?: string[]
}
```

### Reconciliación — esta conviene leerla

**El estado guardado está desactualizado por definición.** Entre la sesión en que el usuario acomodó
su tabla y la sesión en que vuelve, se agregaron columnas, se borraron otras y se renombró alguna
clave. Aplicar el estado guardado tal cual produce fallas silenciosas y difíciles de rastrear. Por
eso nunca se aplica tal cual: primero se reconcilia contra las columnas de hoy.

| Qué cambió entre deploys                                         | Qué pasa al cargar                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Se agregó una columna**                                        | Aparece **visible** (`defaultVisible ?? true`), ubicada **donde fue declarada** respecto de las demás; nunca oculta solo porque el mapa guardado es anterior a ella, ni tirada en una posición arbitraria. |
| **Se eliminó una columna**                                       | Su clave se descarta del orden, del mapa de visibilidad y del de anchos. Sin slots fantasma.                                                                                                               |
| **Se ajustaron `minWidth` / `maxWidth`**                         | El ancho guardado se **vuelve a acotar a los límites de hoy** (y al global `32 … 4000`), así que un layout viejo no puede reintroducir uno ilegal.                                                         |
| **Un ancho guardado es `NaN` / `Infinity`**                      | Se descarta, no se acota: no hay una posición sensata para un número no finito dentro de un rango.                                                                                                         |
| **El orden guardado tiene claves duplicadas**                    | Se deduplican. Una clave duplicada haría que una misma columna ocupe dos slots del pool.                                                                                                                   |
| **El orden guardado tiene claves desconocidas**                  | Se descartan.                                                                                                                                                                                              |
| **`groupBy` nombra una columna que no existe o no es agrupable** | La clave se descarta; los grupos colapsados que dependían de ella también.                                                                                                                                 |
| **`version` no coincide**                                        | El payload entero se descarta y la tabla arranca desde los valores por defecto.                                                                                                                            |

La invariante: el orden reconciliado contiene **exactamente una vez** cada clave de las columnas
actuales, ni una de más ni una de menos. La misma reconciliación corre sobre una prop `columnOrder`
pasada a mano, porque un v-model puede traer claves viejas con la misma facilidad que el
almacenamiento. Lo mismo vale para `groupBy`.

Cuando se hace un cambio que debería invalidar los layouts guardados por completo —una columna
significa otra cosa ahora, se rebalancearon los anchos—, hay que subir `persist.version`.

---

## Datos del servidor y scroll infinito

Hasta aquí `rows` era el dataset entero, en memoria. Eso funciona perfecto hasta las decenas de miles
de filas, y para la mayoría de las tablas es lo correcto: una sola consulta, cero latencia al
scrollear, y ordenar o filtrar es un `sort` o un `filter` que el consumidor ya sabe escribir.

Cuando el dataset vive en una base de datos y traerlo entero no es una opción, la tabla puede pedir
las filas a medida que se scrollea. **El modo se enciende con una sola prop y no cambia nada para
quien no lo use.**

### La idea, en una frase

La tabla ya tenía separadas las dos cosas que esto necesita separadas: **cuántas filas hay** —que
dimensiona la barra de scroll— y **qué hay en el índice `i`** —que decide qué se pinta—. Hasta aquí
las dos salían de `rows`. Con `rowCount`, la primera la dice esa prop y `rows` queda libre para tener
huecos.

| Prop            | Qué hace                                                                                |
| --------------- | --------------------------------------------------------------------------------------- |
| `rowCount`      | Cuántas filas tiene el dataset entero. **Declararla es lo único que enciende el modo.** |
| `pageSize`      | Filas por pedido. Por defecto `50`.                                                     |
| `prefetchPages` | Páginas pedidas por adelantado a cada lado de la ventana. Por defecto `1`.              |

| Evento / método | Qué hace                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `rowsRequest`   | `{ start, end, page }`. La tabla necesita ese tramo y lo está esperando. |
| `refreshRows()` | Olvida qué páginas se pidieron y vuelve a pedir lo que falte.            |

### Ejemplo completo

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DataTable } from 'vue-tablekit'
import type { RowsRequestEvent } from 'vue-tablekit'
import 'vue-tablekit/style.css'

type Row = { id: number; name: string; total: number }

/**
 * El dataset disperso. Su largo es el total y sus lugares se llenan a medida que
 * llegan las páginas: `rows[137]` es SIEMPRE la fila 137 del dataset, haya
 * llegado o no.
 */
const rows = shallowRef<(Row | undefined)[]>([])
const total = shallowRef(0)

// El total sale de la primera consulta, igual que en cualquier paginado.
const first = await api.rows({ skip: 0, take: 50 })
total.value = first.total
rows.value = Object.assign(new Array<Row | undefined>(first.total), first.items)

async function onRowsRequest({ start, end }: RowsRequestEvent) {
  const page = await api.rows({ skip: start, take: end - start })

  // Se REEMPLAZA el array, no se muta: es lo que la tabla observa para repintar,
  // igual que con `editCommit`.
  const next = rows.value.slice()
  next.length = total.value
  for (let index = 0; index < page.items.length; index += 1) {
    next[start + index] = page.items[index]
  }
  rows.value = next
}
</script>

<template>
  <DataTable
    :rows="rows"
    :row-count="total"
    :columns="columns"
    row-key="id"
    :page-size="50"
    @rows-request="onRowsRequest"
  />
</template>
```

### Las reglas, y por qué son esas

**La tabla nunca pide datos.** No hay `fetch`, ni adapter, ni una sola función asíncrona adentro. La
tabla avisa qué tramo necesita y espera; el transporte, la caché, los reintentos y la cancelación son
tuyos. Es la misma decisión que hace que `rows` sea controlada para editar: la librería no es dueña
de tus datos. El costo es que manejas un array con huecos; lo que ganas es que invalidar al cambiar
un filtro es `rows = []` y nada más, sin una API de caché que aprender.

**Los pedidos se alinean a `pageSize`.** Una ventana visible `[137, 162)` no se pide tal cual: se
piden `[100, 150)` y `[150, 200)`. Alineados, tu clave de caché es `start / pageSize` y dos
posiciones de scroll sobre la misma página producen el mismo pedido. Sin alinear, cada píxel de
scroll generaría un tramo distinto y solapado, y del otro lado habría que reconstruir a mano qué se
pidió ya.

**Una página se pide UNA vez.** La tabla lleva el registro de lo que está en vuelo. Es el punto
entero de que ese registro viva aquí y no en cada consumidor: un scroll rápido atraviesa la misma
página decenas de veces por segundo, y sin el registro cada travesía sería una consulta más contra la
base. La marca se levanta cuando las filas aparecen en `rows`.

**Si un pedido falla, la tabla no insiste.** Esa página se queda como marcador. Es deliberado:
reintentar solo produciría una tormenta de pedidos durante un scroll. Para recuperarse hay dos vías,
y las dos son explícitas:

- `rows = []` —o cualquier array más corto que el inicio de la página—. Es el gesto normal de
  invalidar al cambiar un orden o un filtro, y la tabla lo detecta sola.
- `refreshRows()` sobre la instancia, para reintentar sin tocar `rows`.

**Un hueco se ve como lo que es.** Una fila que todavía no llegó lleva `.dt-row--placeholder`,
`aria-busy="true"` y una barra por celda en la posición de SU columna. Las barras se alinean con el
encabezado porque una franja gris a lo ancho de la fila no se corresponde con nada y se lee como un
error de pintado. El contenido del nodo reciclado se vacía: una celda no tiene `aria-label`, su
nombre accesible es su texto, y dejar el anterior haría que un lector de pantalla anuncie un dato
concreto y equivocado sobre una fila que ni siquiera cargó.

**Un marcador es navegable pero no editable.** La selección puede caer encima —y eso dispara la
carga—, pero `beforeEdit` no dispara nunca sobre una fila que no llegó.

### Si no conoces el total

Es el scroll infinito clásico, y sale de la misma máquina sin una segunda API. `rowCount` es "hasta
dónde puede scrollear":

```ts
// Mientras el servidor diga que hay más, se ofrece una página más de recorrido.
const total = computed(() => (hasMore.value ? loaded.value + 50 : loaded.value))
```

La barra de scroll muestra siempre una página de más, que es exactamente cómo se siente un scroll
infinito. Cuando el servidor dice que se acabó, `rowCount` baja a lo cargado y la barra se ajusta.

### Lo que no se puede combinar

**Agrupar.** Armar el árbol de grupos exige recorrer el dataset entero —hay que leer la clave de cada
fila para saber a qué grupo va, y contar cuántas trae cada uno—, y aquí la mayor parte no está.
Agrupar lo cargado produciría grupos que cambian de tamaño a medida que se scrollea, que es peor que
no agrupar. Con `rowCount` y `groupBy` a la vez, la tabla avisa una vez por consola e ignora
`groupBy`. La vía es agrupar del lado del servidor y mandar las filas ya ordenadas.

**Copiar un rango que incluya filas sin cargar.** `Ctrl`+`C` copia lo que la tabla tiene; las filas
que no llegaron salen como celdas vacías. `Ctrl`+`A` sobre un dataset remoto grande selecciona el
rectángulo entero, pero copia únicamente lo cargado.

### Ordenar y filtrar

La librería no ordena ni filtra —nunca lo hizo, también en memoria—, así que del lado del servidor no
hay nada nuevo que coordinar: cambias la consulta, pones `rows = []` y actualizas `rowCount`. La
tabla vuelve a pedir desde la ventana en la que esté.

---

## Ordenamiento

**La tabla no ordena `rows`.** Administra los criterios, los muestra en el encabezado y los anuncia;
reordenar el array —o volver a consultarle al servidor— sigue siendo del consumidor.

No es una omisión: es lo único que funciona en los dos modos. En modo servidor la tabla solo tiene
una ventana del dataset, así que ordenar lo que tiene a mano daría un orden correcto dentro de las 50
filas cargadas y absurdo respecto de las 100.000 que hay.

```ts
{ key: 'name', label: 'Proyecto', sortable: true }
```

`sortable: true` hace que el encabezado responda al clic —**ascendente → descendente → sin orden**— y
muestre la flecha del sentido.

**`sortable: 'menu'` ordena la columna solo desde su menú**: el clic en el encabezado no hace nada, y
el encabezado tampoco cambia el cursor, para no prometer un gesto que no tiene. Sirve en una columna
ancha de texto —donde el clic se da sin querer al ir a redimensionarla o arrastrarla— o allí donde
reordenar cien mil filas por accidente es una molestia. La flecha del sentido aparece igual: dice cómo
está ordenada la tabla, no cómo se la ordenó. `Shift`+clic **suma** un criterio en lugar de reemplazarlo, que es lo que
permite "por estado, y dentro de cada estado por fecha"; con más de uno, cada flecha lleva su número
de prioridad.

Al cambiar el orden la tabla **vuelve al principio**: con el orden cambiado, la fila 50.000 es otra
fila, y quedarse donde estaba deja al usuario mirando un tramo que no pidió.

### En memoria: dos líneas

```ts
import { sortRows } from 'vue-tablekit'

const sort = ref<SortState>([])
const filas = computed(() => sortRows(datos.value, sort.value, columnas))
```

```vue
<DataTable v-model:sort="sort" :rows="filas" :columns="columnas" row-key="id" />
```

`sortRows` no muta lo que recibe, es **estable** —un empate conserva el orden en que venía, que es lo
que hace que el segundo criterio no deshaga al primero— y devuelve **el mismo array** cuando no hay
nada que ordenar, para no hacerle rehacer a la tabla la geometría y la ventana por nada.

Compara el valor **crudo** y no el texto formateado: ordenar por el texto pondría `$1.000` antes que
`$900`. Los vacíos —`null`, `undefined`, `NaN`, `''`— van al final **en los dos sentidos**: ordenar es
para ver los valores, no para ver primero los huecos.

Cuando el orden natural no es el que la gente espera, va un `comparator`:

```ts
{
  key: 'priority',
  sortable: true,
  // Alfabéticamente "alta" va antes que "baja", justo al revés de lo que significa.
  comparator: (a, b) => ESCALA.indexOf(a.priority) - ESCALA.indexOf(b.priority),
}
```

### Contra el servidor: el mismo evento

No hay un modo aparte ni una API nueva. Cambia qué hace el consumidor al enterarse:

```ts
watch(sort, () => {
  // Un orden nuevo invalida todo lo que ya se trajo: son filas de otra consulta.
  serverRows.value = []
  // La tabla vuelve a pedir sola, desde la ventana donde esté.
})
```

Es el mismo gesto que ya se usa para filtrar, y por el mismo motivo. `sortChange` es la alternativa a
observar el v-model, para quien no quiere tomar posesión del estado: llega con los criterios y con la
columna que el usuario acaba de tocar.

**Restaurar un layout guardado no dispara `sortChange`.** Aplicar el orden persistido no es que el
usuario haya presionado un encabezado, y emitirlo ahí le dispararía una consulta al servidor a cada
montaje. El v-model sí se emite, que es lo que un padre controlado necesita para quedar en sincronía.

### El menú de la columna

`columnMenu` pone un botón de tres puntos en cada encabezado, con lo que la columna puede hacer:
ordenar, anclar, ocultarse y restablecer el layout.

```vue
<DataTable column-menu … />
```

**No agrega ninguna capacidad nueva.** Es otra forma de llegar al mismo estado —`sort`,
`columnPinning`, `columnVisibility`, `resetLayout()`— para quien no quiere poner controles propios
alrededor de la tabla. Una columna se queda afuera con `column.menu: false`.

El menú muestra **solo lo aplicable**: una columna que no ordena no trae las entradas de ordenar, y
la que ya está en ascendente no ofrece "ordenar ascendente". Un menú con la mitad de las opciones
deshabilitadas obliga a leerlo entero para descubrir que no servían.

Para anclar **ofrece los dos bordes**, no el declarado en `pinnable`: un botón es un gesto y solo
puede significar una cosa, y un menú tiene lugar para preguntar. Es también la única forma de mover
una columna de un borde al otro sin soltarla primero.

Con `sortable: 'menu'` y `pinnable: 'menu'` el menú pasa a ser la **única** vía: el encabezado deja
de responder al clic y de mostrar el botón de anclar. Es lo que conviene en una columna ancha de
texto, donde el clic se da sin querer al ir a redimensionarla o arrastrarla.

El panel sigue el aspecto de la tabla: su redondeo sale de `radiusBorder` —no del radio del tema— y
el de sus opciones se deriva restándole el padding, para que las dos curvas queden concéntricas. Con
el preset `cells` se cuadricula, con una línea entre todas las opciones.

Se cierra con `Escape`, al hacer clic afuera, al elegir algo y **al scrollear en horizontal** —su
posición se resuelve una vez, al abrir, y seguir al encabezado frame a frame sería trabajo en el
camino caliente del scroll para algo que dura dos segundos—.

### Cuando conviven con `columnSelection`

Sobre el encabezado hay dos acciones posibles y no caben en el mismo clic. **Se la queda ordenar**, y
seleccionar la columna entera pasa a `Ctrl`/`Cmd`+clic:

| Columna            | Clic       | `Ctrl`/`Cmd`+clic |
| ------------------ | ---------- | ----------------- |
| `sortable: true`   | Ordena     | Selecciona        |
| `sortable: 'menu'` | Selecciona | Selecciona        |
| Sin `sortable`     | Selecciona | Selecciona        |

Solo compite con el clic la columna que ordena **al clic**. Con `'menu'` el gesto está libre, así que
la selección se lo queda sin pedir modificador.

No es una convención nueva: es el mismo modificador de `Ctrl`/`Cmd`+`A`, `Ctrl`/`Cmd`+`C` y
`Ctrl`/`Cmd`+`Home`. `Shift` no servía porque lo usa el orden multinivel.

El reparto es ese y no el contrario por dos motivos. Presionar un encabezado para ordenar es la
interacción más común que existe en una grilla, y seleccionar una columna para copiarla es ocasional:
la acción frecuente tiene que llevarse el gesto frecuente. Y al revés quedaba un agujero —con
`columnSelection` encendida y sin `columnMenu`, una columna con `sortable: true` no hacía
absolutamente nada—.

### Traducir los textos

```ts
const labels: DataTableLabels = {
  sortAsc: 'Ordenar ascendente',
  sortDesc: 'Ordenar descendente',
  clearSort: 'Quitar el orden',
  pin: 'Anclar columna',
  unpin: 'Desanclar columna',
  menu: 'Menú de la columna',
  pinStart: 'Anclar al inicio',
  pinEnd: 'Anclar al final',
  hideColumn: 'Ocultar columna',
  resetColumns: 'Restablecer columnas',
}
```

Se pasa parcial: lo que no se declare queda en inglés. `emptyText` va aparte porque no es el rótulo de
un control sino contenido de la tabla.

---

## Alturas de fila distintas

Por defecto todas las filas miden lo mismo, y eso no es un detalle de estilo: es lo que hace que la
tabla encuentre la fila que va en un píxel con una división, sin importar si hay cien filas o cien
mil.

Cuando hace falta que midan distinto, `rowHeight` acepta una función en lugar de un número:

```vue
<script setup lang="ts">
const abiertas = ref(new Set<string>())

// Como `computed`, NO inline en el template. El porqué está más abajo.
const rowHeight = computed(() => {
  const ids = abiertas.value
  return (row: Proyecto | undefined) => {
    if (row === undefined) return 32
    return ids.has(row.id) ? 160 : 40
  }
})
</script>

<template>
  <DataTable :rows="rows" :columns="columns" row-key="id" :row-height="rowHeight" />
</template>
```

Todo lo demás acompaña solo: el recuadro de la selección abraza el alto real del bloque, el editor se
abre del tamaño de su celda, la regleta de numeración sigue cada fila, `Av Pág` avanza las filas que
entren de verdad desde donde uno esté, y la barra de scroll mide la suma.

### Qué recibe la función

```ts
type RowHeightResolver<TRow> = (row: TRow | undefined, index: number) => number
```

**`row` puede ser `undefined`, y es normal.** Ocurre en dos casos: la posición es una cabecera de
grupo —que no es ninguna fila del dataset— o la tabla está en modo servidor y esa fila todavía no
llegó. Devolver un alto propio ahí es la forma de darle a las cabeceras de grupo el suyo.

**`index` es la posición VISIBLE**, la que se ve en la regleta menos uno. Sin agrupación es el mismo
índice que dentro de `rows`; con agrupación no, porque las cabeceras ocupan lugar. Es el único índice
que existe siempre, y por eso es el que se pasa.

**Lo que devuelva tiene que ser un número finito y positivo.** Cualquier otra cosa —un `NaN` de una
cuenta con un campo que no llegó, un cero, un negativo— se descarta y se usa el alto por defecto. Una
geometría rota no se vería como un error sino como filas superpuestas, que es mucho peor de
diagnosticar.

### Qué cuesta, y la única forma de pasarla mal

La función corre **una vez por fila del dataset entero**, y eso pasa cada vez que cambia `rows`,
cambian las columnas, o **cambia la identidad de la función**. No corre en cada frame: scrollear no
la llama ni una sola vez, y esa es la propiedad que mantiene el scroll gratis con cualquier cantidad
de filas.

De ahí sale la única regla que hay que respetar:

```vue
<!-- MAL: una función nueva en cada render del padre. -->
<DataTable :row-height="(row) => (row?.abierta ? 160 : 40)" />
```

Escrita así, cualquier cosa que haga renderizar al padre —tipear en un input que no tiene nada que
ver— produce una función distinta, y la tabla vuelve a recorrer el dataset entero. Con cien mil filas
eso se siente. Definida como `computed`, la identidad cambia solo cuando cambia algo de lo que el
alto depende, que es exactamente cuando hay que recalcular.

Por lo mismo, la función tiene que ser **pura y estable**: dos respuestas distintas para la misma
fila dejarían la geometría y lo pintado en desacuerdo. Si el alto depende de algo que cambia, ese
algo tiene que estar en los datos o en las dependencias del `computed`.

### Con datos del servidor

Se puede, con una consecuencia que conviene saber de antemano: **las filas que todavía no llegaron
miden el alto por defecto**, y cuando llegan, el contenido de abajo se corre. Es inevitable —la tabla
no puede saber cuánto mide una fila que no tiene— y se nota más cuanto más difieran las alturas.

Además, cada página que llega es un `rows` nuevo, y un `rows` nuevo es una pasada sobre el dataset
entero. Con `rowCount` en el millón, esa pasada se paga una vez por página. Si no hay una razón
fuerte para las alturas variables, en modo servidor conviene un alto fijo.

### Lo que no cambia para quien no la usa

Con `rowHeight` numérico —o sin la prop— no cambia absolutamente nada: la misma aritmética de
siempre, ni un array de offsets reservado, y el pool no escribe una sola propiedad de alto. La tabla
incluso vuelve sola a ese camino si la función termina devolviendo el alto por defecto para todas,
que es el caso de `(row) => row.abierta ? 160 : 40` mientras no haya ninguna abierta.

### Cómo llega el alto al DOM

Cada fila lleva la custom property `--dt-row-h`, y de ella cuelgan el alto de la fila, el de sus
celdas, su altura de línea, la cabecera de grupo y el agregado. Es **una sola escritura por fila**,
que la herencia reparte entre todo lo que está adentro.

`--dt-row-height` NO se pisa, a propósito: de ella cuelgan los tamaños de las cajas decorativas
—píldoras, casillas, avatares— con su `calc()`, y una fila de 200px no tiene por qué llevar una
píldora de 186.

---

## Notas de rendimiento

### Qué la hace rápida

| Mecanismo                                    | Efecto                                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Las celdas del cuerpo no son vnodes          | Sin diff de vnodes por frame. El pool escribe solo las propiedades que cambiaron.                                                                                           |
| Reciclado de nodos por slot de viewport      | El pool crece con la cantidad visible y nunca encoge durante el scroll.                                                                                                     |
| Escribir solo si cambió, en todas partes     | Cada nodo cachea lo último que se pintó sobre él. Repintar con las mismas entradas no escribe nada.                                                                         |
| Caché de pintado por valor crudo             | Si una celda ya muestra ese valor, para esa fila y esa columna, se saltean `format`, `cellClass` y `update`.                                                                |
| `transform`, no `top` / `left`               | El posicionamiento se resuelve en el compositor y no invalida el layout del documento.                                                                                      |
| Un listener delegado por evento              | No 450 registros de listener por frame.                                                                                                                                     |
| `shallowRef` y props superficiales           | 100k filas cuestan cero proxies. La matemática de la ventana es O(1): una división por frame, independiente de la cantidad de filas.                                        |
| El header scrollea solo, dentro del viewport | El header lo renderiza Vue, pero no se vuelve a diferenciar ni se reposiciona mientras se scrollea: lo desplaza el navegador junto con el resto del contenido.              |
| Lo que va quieto lo sostiene el compositor   | Encabezado, regleta y columnas ancladas usan `position: sticky`: cero escrituras por frame, y sin el frame de retraso que tiene cualquier compensación escrita desde JS.    |
| La selección se resuelve por comparación     | La posición activa se desestructura una vez por frame; cada celda compara dos valores que ya tiene. Mover la selección escribe exactamente en las dos celdas que cambiaron. |
| El árbol de grupos vive aparte del aplanado  | Agrupar y agregar cuestan una pasada cuando cambian los datos; plegar solo vuelve a emitir la vista, y el scroll no toca ninguna de las dos cosas.                          |

### Qué la puede volver lenta

Estas son las formas realistas de devolver el rendimiento, más o menos en el orden en que ocurren:

1. **Un `format` caro.** Corre por celda visible y por frame en que el valor de la celda cambió. El
   error clásico es construir un `Intl.NumberFormat` o un `Intl.DateTimeFormat` adentro: eso negocia
   un locale y arma tablas de símbolos, multiplicado por unas 450 celdas. Los formateadores se
   construyen **una vez, a nivel de módulo**, y se llaman desde `format`.

   ```ts
   // ✗ una instancia por celda, por frame
   format: (value) => new Intl.NumberFormat('en-US').format(Number(value))

   // ✓ una instancia, para siempre
   const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
   format: (value) => (typeof value === 'number' ? money.format(value) : '')
   ```

   Lo mismo vale para `cellClass`: comparaciones y nada más, sin asignar y sin armar strings más allí
   de devolver una constante.

2. **Un `ref()` sobre las filas en lugar de un `shallowRef()`.** Un `ref` profundo envuelve cada fila
   en un Proxy. Para 100k filas eso son 100k proxies asignados de entrada, más el tracking de
   dependencias en cada lectura de propiedad que haga el camino de pintado. Corresponde `shallowRef`
   y reemplazar el array para señalar un cambio.

3. **Un renderer propio que asigna.** Crear nodos, armar arrays u objetos, o usar plantillas de
   string dentro de `update` genera basura que el recolector limpia durante un scroll, que es
   exactamente un frame perdido. Conviene cachear el último valor escrito y salir temprano. Nunca
   leer layout dentro de `update` (`offsetWidth`, `getBoundingClientRect`, `getComputedStyle`): eso
   fuerza un reflow síncrono en mitad del pintado.

4. **Una identidad nueva del array `columns` en cada render.** Las definiciones de columna se
   comparan por referencia en el caché de celdas. Reconstruirlas dentro de un `computed` que además
   depende de estado sin relación invalida todas las celdas. Corresponde definirlas a nivel de
   módulo, o en un `computed` que dependa solo de lo que realmente las cambia.

5. **Un `overscan` enorme.** Es un multiplicador directo sobre las celdas pintadas por frame. El `4`
   por defecto tiene su razón; `50` no se va a sentir más suave.

6. **`virtualizeColumns` encendido en una tabla angosta.** Si todas las columnas entran en pantalla,
   el cálculo de ventana y el recorte son overhead puro. Conviene apagarlo.

7. **`rowHeight` como función escrita inline en el template.** Es una función nueva en cada render
   del padre, y cada una cuesta una pasada sobre el dataset entero. Va como `computed`: ver
   [Alturas de fila distintas](#alturas-de-fila-distintas). Lo que sigue sin poder falsearse con CSS
   es el alto: la geometría del virtualizador dejaría de coincidir con el DOM.

8. **Una agregación propia cara.** Corre una vez por grupo y por reconstrucción del árbol, no por
   frame, pero un árbol con miles de grupos multiplica ese costo por miles. Y si además recorre las
   filas del grupo, el total es O(filas × niveles) por reconstrucción. Con las agregaciones incluidas
   alcanza casi siempre, y no juntan las filas.

---

## Tests

La suite vive en `src/__tests__/` y corre con [Vitest](https://vitest.dev)
sobre `happy-dom`.

```bash
npm test           # una corrida
npm run test:watch # modo watch
npm run test:coverage
```

La configuración está en el bloque `test` de `vite.config.ts`, para que los tests resuelvan el mismo
alias `@` y la misma cadena de plugins que la aplicación. Los archivos de test quedan fuera de
`tsconfig.app.json` y de la emisión de tipos de la librería, pero **sí se verifican**:
`tsconfig.test.json` los incluye y está referenciado desde `tsconfig.json`, así que
`npm run type-check` compila la suite con el mismo rigor que el componente,
`noUncheckedIndexedAccess` incluido.

`happy-dom` no provee un `ResizeObserver` que emita ni un `requestAnimationFrame` gobernable.
`__tests__/setup.ts` instala dobles de ambos: los frames se ejecutan a mano con `flushFrames()` y el
tamaño del viewport se anuncia con `FakeResizeObserver.emit()`. Ningún test espera a un timer real,
porque un test de rendimiento intermitente termina borrado por quien lo cruza la próxima vez.

### Qué garantizan los tests de rendimiento

`__tests__/pool.perf.test.ts` es el centro de la suite. Se apoya en `__tests__/dom-recorder.ts`, que
parchea `textContent`, `style`, `setAttribute`, `classList`, `hidden`, `checked`, `src` y la
creación, inserción y eliminación de nodos, y cuenta cada escritura dentro de un subárbol. Con eso
fija estos invariantes:

| Invariante                                                                      | Por qué importa                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Repintar con entradas idénticas produce **cero** escrituras, en los 8 renderers | Es la afirmación central de la librería                                         |
| Los nodos de fila y de celda sobreviven al scroll como los **mismos objetos**   | Reciclar, no recrear                                                            |
| El costo por frame depende de la ventana, **no** del dataset ni de la distancia | 100.000 filas cuestan lo mismo que 200; saltar 150 filas, lo mismo que 1        |
| Mover la celda activa en horizontal alterna **exactamente 2** clases            | La selección no repinta la ventana                                              |
| Los nodos sobrantes se **ocultan**, nunca se eliminan                           | `hidden` conserva la capa de composición; `removeChild` la descarta             |
| Un nodo con `hidden` **no se pinta**, declare lo que declare su clase           | `[hidden]` es del navegador y cualquier `display` de autor le gana por origen   |
| `Intl.NumberFormat` se construye **una sola vez**                               | Un formateador por celda y por frame domina el presupuesto de pintado           |
| `avatar` y `tags` mutan sin asignar dentro de `update`                          | La basura del camino caliente la cobra el recolector con un frame perdido       |
| Cambiar el tipo de renderer en un slot reciclado **reconstruye** la estructura  | Un slot puede pasar de `badge` a `progress` durante el scroll horizontal        |
| La clase de maquetado se escribe **solo** al cambiar el tipo de renderer        | Centrar bien un badge no puede costar una escritura por frame                   |
| Los índices ARIA se escriben **por fila**, no por celda                         | Misma información para el lector de pantalla, quince veces menos escrituras     |
| La estructura accesible del header cuesta **cero** escrituras por frame         | Los roles son estáticos; asociar por `columnheader` evita un atributo por celda |
| Un slot que pasa de fila de datos a cabecera de grupo **recicla** su nodo       | Plegar un grupo mueve de tipo a varios slots a la vez, en mitad del scroll      |
| El slot `#editor` no mueve el presupuesto, **ni con el editor abierto**         | Es la única puerta por la que entra un componente Vue: no puede costar un frame |

### Estas aserciones son estructurales

Los números de `pool.perf.test.ts` no son observaciones: cada uno está derivado del contrato de
`internal/dom.ts` y explicado en el comentario que lo acompaña.

**Si una de esas aserciones falla, lo más probable es que el problema esté en el código y no en el
número.** El modo de falla que protegen no lanza ninguna excepción: romper el caché de pintado deja
la tabla renderizando, con el mismo aspecto, y solo scrollea peor. Ningún otro test lo nota. Subir la
constante hasta que vuelva el verde apaga exactamente la alarma que hay que escuchar.

Si el cambio es una mejora real —menos escrituras que antes— corresponde bajar la constante y
actualizar el comentario con el razonamiento nuevo. Si es un aumento, el comentario tiene que
explicar qué se compró a cambio.

### El resto de la suite

| Archivo                       | Qué cubre                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useVirtualWindow.test.ts`    | Matemática de la ventana: 100k filas, scroll negativo, overscroll, overscan                                                                                                                                                                                                                                                                                                                                          |
| `useColumnLayout.test.ts`     | Offsets acumulados, acotado de anchos, orden, y la búsqueda binaria por fuerza bruta                                                                                                                                                                                                                                                                                                                                 |
| `reconcile.test.ts`           | Estado guardado contra columnas que cambiaron; payloads corruptos                                                                                                                                                                                                                                                                                                                                                    |
| `useTablePersistence.test.ts` | Orden carga/guardado, debounce, volcado al desmontar, degradación en SSR y modo privado                                                                                                                                                                                                                                                                                                                              |
| `useCellEditor.test.ts`       | Veto de `beforeEdit`, coacción de tipos, y que `rows` nunca se muta                                                                                                                                                                                                                                                                                                                                                  |
| `selection.test.ts`           | Teclado completo, auto-scroll en píxeles exactos, columnas ocultas, el anillo único —una sola celda marcada, y el anillo del viewport opcional y suprimido con celda activa— y la estructura accesible: roles, `aria-rowindex` del encabezado y `aria-colindex` alineado entre header y cuerpo                                                                                                                       |
| `renderers.test.ts`           | Valores inesperados en cada renderer incluido, y el aviso por nombre desconocido: una vez por nombre, nunca para un nombre registrado                                                                                                                                                                                                                                                                                |
| `range-selection.test.ts`     | El rectángulo: arrastre, `Shift`+clic, `Shift`+teclas, `Ctrl`+`A`, cuándo colapsa, que el ancla no se mueva ni se tiña, que se re-resuelva al ocultar una columna, y el copiado —TSV con el texto que se ve, comillas, cabeceras de grupo salteadas y filas sin pintar                                                                                                                                               |
| `row-numbers.test.ts`         | La regleta: encendida por defecto, numerando la posición visible, en blanco sobre las cabeceras de grupo, corriendo las columnas sin meterse en la selección ni en el copiado, su costo por frame y que nadie le escriba un `transform` a ninguna altura del scroll; más los cinco pasos de `radiusBorder`                                                                                                           |
| `bulk-selection.test.ts`      | Los dos gestos en bloque: que el encabezado seleccione la columna entera y el número la fila entera, que lo que producen sea un rango —se copia, se extiende, se colapsa—, que el handle de redimensionado no dispare ninguno, y que los dos vengan apagados                                                                                                                                                         |
| `column-reorder.test.ts`      | Mover columnas arrastrando: dónde cae según el medio de cada columna, el umbral que separa el clic del arrastre, la línea que solo aparece si el gesto cambia algo, las columnas ocultas que no se corren de vecina, una columna anclada que ni se agarra ni se deja cruzar, y el ciclo de vida de la caja que sigue al cursor —cuándo nace, que acompaña al puntero y que no sobrevive ni al soltar ni al cancelar— |
| `sorting.test.ts`             | Ordenamiento: que la tabla NO toque `rows`, el ciclo de tres estados del clic, el `Shift` que suma criterios, `aria-sort`, que un arrastre no ordene de paso, `sortRows` —identidad estable, estabilidad, vacíos al final en los dos sentidos, comparador propio— y el menú de columna entero                                                                                                                        |
| `column-pinning.test.ts`      | Anclar y desanclar desde el encabezado: cuándo aparece el botón, a qué borde lleva, que soltar una columna DECLARADA anclada funcione —la distinción entre `null` y la clave ausente—, que anclarla la vuelva inmóvil, que el botón no arrastre ni seleccione, el modo controlado, `resetLayout()`, el aviso del agregado que se pierde y la reconciliación de lo guardado                                           |
| `pinned-columns.test.ts`      | Columnas ancladas: el orden que imponen, que su posición NO dependa del scroll, el carril `sticky` del que cuelgan y el ancho de fila que lo sostiene, que se pinte UNA sola copia de cada una, que ninguna regla deje una fila transparente, que sigan siendo seleccionables, copiables y editables —con el editor acompañándolas— y que no cuesten nada por frame                                                  |
| `host-layout.test.ts`         | Lo que la tabla necesita del contenedor: que avise —una sola vez— cuando se queda sin alto y muestra una fila de cincuenta, que NO avise cuando solo está oculta, y que la hoja de estilos siga respaldando lo que la documentación dice sobre dónde van los tokens                                                                                                                                                  |
| `server-rows.test.ts`         | El modo servidor: que sin `rowCount` no se pida ni una fila, que los tramos se alineen a `pageSize`, que una página no se pida dos veces, que vaciar `rows` y `refreshRows()` vuelvan a pedir, y que un hueco se pinte como marcador —con `aria-busy`, con barra por columna y sin el texto de la fila anterior—                                                                                                     |
| `sticky-layout.test.ts`       | Lo que no acompaña al scroll —encabezado, regleta, carriles anclados—: que nadie les escriba la posición a ninguna altura del scroll, que el encabezado viva dentro del scroller sin dejar de ser la fila 1 de la grilla, que su alto se descuente de una página de filas, y el contrato `sticky` de la hoja de estilos                                                                                              |
| `cell-layout.test.ts`         | Modo de maquetado: qué renderers lo declaran, que la clase se escriba solo al cambiar de renderer, que las tres alineaciones produzcan el mismo estado en los dos modos, y —leyendo el `.css`— que la celda de texto conserve su recorte con puntos suspensivos                                                                                                                                                      |
| `grouping.test.ts`            | Aplanado, agregados anidados, expansión controlada, `formatAggregate`, `emptyGroupLabel`, y que `editCommit` reporta el índice ORIGINAL                                                                                                                                                                                                                                                                              |
| `slot-editor.test.ts`         | El slot `#editor`: dónde abre y dónde no, el veto, `commit()` y `cancel()` sobre la tubería de siempre, el índice ORIGINAL con un grupo plegado, el cierre por scroll y por puntero, el foco de ida y de vuelta, y que el presupuesto por frame no se mueve ni con el editor abierto                                                                                                                                 |

---

## Limitaciones

Dicho sin vueltas. Nada de esto está implementado:

| Sin implementar                            | Notas                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filtrado y búsqueda**                    | Lo mismo: filtrar aguas arriba y pasar el array ya filtrado.                                                                                                                                                                                                                                                                                                                                                               |
| **Selección múltiple con `Ctrl`+clic**     | El rango rectangular **sí** está implementado —arrastre, `Shift`+clic, `Shift`+flechas y copiado; ver [Selección de un rango](#selección-de-un-rango-de-celdas)—, pero es **uno solo y contiguo**: no hay varios rectángulos sueltos ni celdas salteadas.                                                                                                                                                                  |
| **Pegado**                                 | Se copia, no se pega. La tabla es controlada y nunca escribe sobre `rows`; un pegado tendría que pasar por la tubería de edición celda por celda.                                                                                                                                                                                                                                                                          |
| **Auto-scroll al arrastrar un rango**      | El rango crece hasta la celda que esté bajo el puntero; si el puntero sale del viewport, se queda donde estaba. Para abarcar más de una pantalla: scrollear y `Shift`+clic.                                                                                                                                                                                                                                                |
| **Autorrelleno desde el fill handle**      | El cuadradito de la esquina del rango es una marca de extremo. No arrastra.                                                                                                                                                                                                                                                                                                                                                |
| **Selección de varias filas con casillas** | No hay modelo `selectedRows` ni columna de casillas incluida. El modo `'row'` marca una fila por vez; `rowClick` y `cellSelect` son los enganches para construir la propia.                                                                                                                                                                                                                                                |
| **Pivoteo**                                | La agrupación **sí** está implementada (ver [Agrupación](#agrupación)); pivotear no, y queda **deliberadamente fuera de alcance**: exige una matriz de columnas derivadas de los datos, lo que rompe el supuesto de que las columnas son configuración estática sobre el que se apoya todo el camino de pintado.                                                                                                           |
| **Reordenar columnas con el teclado**      | El arrastre con el mouse **sí** está (ver [Mover columnas](#mover-columnas-arrastrando)); un atajo de teclado no. El v-model `columnOrder` queda como el camino para una UI propia.                                                                                                                                                                                                                                        |
| **Alturas de fila MEDIDAS del contenido**  | Las alturas **declaradas** sí están (ver [Alturas de fila distintas](#alturas-de-fila-distintas)): `rowHeight` acepta una función y cada fila puede medir lo suyo. Lo que no hay es que la fila crezca sola con su contenido, que exigiría medir el DOM pintado y rehacer el maquetado de la celda —se centra con `line-height` y recorta con puntos suspensivos, dos cosas que dependen de un alto conocido de antemano—. |
| **Agregado en una columna anclada**        | `aggregate` sobre una columna con `pinned` se ignora en silencio. Un agregado se dibuja en el offset de SU columna, así que anclado al inicio caería encima del chevron, la etiqueta y el contador del grupo. La vía es no anclar esa columna.                                                                                                                                                                             |
| **Editor de selección múltiple**           | El renderer `tags` muestra listas; no hay ningún editor que edite una.                                                                                                                                                                                                                                                                                                                                                     |
| **SSR del cuerpo**                         | El header y el armazón renderizan bien; el cuerpo se pinta al montar, solo del lado del cliente.                                                                                                                                                                                                                                                                                                                           |

### Un componente Vue por celda — deliberadamente no soportado

No se puede montar un componente Vue **por celda del cuerpo**, y eso es la arquitectura entera, no un
descuido. Una celda respaldada por un vnode significa que Vue vuelve a ser dueño del camino caliente
del scroll: montar y desmontar instancias a medida que las filas se reciclan, correr el scheduler
dentro del presupuesto del frame, y pagar el diff de vnodes por unas 450 celdas por frame.

Lo que **sí** se puede está documentado, medido y tiene su propia sección:
[Componentes de terceros dentro de una celda](#componentes-de-terceros-dentro-de-una-celda). Son dos
caminos: un renderer nativo para lo que la celda tiene que mostrar siempre, y el slot `#editor` —una
sola instancia montada sobre la celda en edición— para lo que solo hace falta mientras se edita. El
header también lo renderiza Vue, porque son un puñado de nodos que se vuelven a diferenciar solo
cuando cambia la configuración de columnas.

---

## Referencia: qué exporta el paquete

| Export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tipo                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `DataTable` (también el export por defecto), `DataTableColumnToggle`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Componentes                                                             |
| `COLOR_TOKENS`, `ColorTokenName`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Mapa de la paleta de estados y el tipo de su clave                      |
| `registerRenderer`, `resolveRenderer`, `createTextRenderer`, `TEXT_RENDERER_TYPE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Registro de renderers                                                   |
| `textRenderer`, `numberRenderer`, `badgeRenderer`, `selectRenderer`, `progressRenderer`, `avatarRenderer`, `checkboxRenderer`, `tagsRenderer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Instancias de los renderers incluidos, para componer sobre ellas        |
| `createLocalStorageAdapter`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | El adapter de almacenamiento por defecto                                |
| `groupId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Constructor del id de un grupo, para `expandedGroups` y `toggleGroup()` |
| `DataTableProps`, `DataTableColumn`, `DataTableInstance`, `DataTableTheme`, `CellValue`, `CellAlign`, `CellLayout`, `CellOption`, `CellEditorType`, `CellEditorSlotProps`, `CellPosition`, `CellRenderer`, `CellRenderContext`, `CellRendererHandle`, `AnyCellRenderer`, `CellRendererFactory`, `SelectionMode`, `RowHeightResolver`, `SortState`, `ColumnSort`, `SortDirection`, `SortChangeEvent`, `DataTableLabels`, `CellSelectEvent`, `BeforeEditEvent`, `AfterEditEvent`, `EditCommitEvent`, `ColumnResizeEvent`, `ColumnVisibilityState`, `ColumnWidthState`, `DataTablePersistOptions`, `DataTableStorageAdapter`, `PersistedTableState`, `VirtualWindow` | Tipos                                                                   |
| `GroupByState`, `GroupRow`, `GroupIdSegment`, `DataRow`, `FlatRow`, `GroupToggleEvent`, `BuiltInAggregation`, `AggregationFn`, `ColumnAggregation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Tipos de la agrupación                                                  |

Los composables y el pool de nodos **no** se exportan. Son detalles de implementación, y exportarlos
los convertiría en API que después habría que sostener para siempre.
