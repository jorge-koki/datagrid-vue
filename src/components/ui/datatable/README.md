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

1. Conseguir el código: copiar `src/components/ui/datatable/` dentro del proyecto, o instalar el
   paquete (las dos vías están en [Instalación](#instalación)).
2. Importar el componente y, si se instaló el paquete, la hoja de estilos.
3. Pasar `rows`, `columns` y `rowKey`. Darle una altura al contenedor.

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DataTable } from 'datagrid-vue'
import type { DataTableColumn } from 'datagrid-vue'
import 'datagrid-vue/style.css'

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

### Opción A — copiar el directorio (estilo shadcn)

Copiar `src/components/ui/datatable/` a cualquier lugar del proyecto. El directorio es
autocontenido: todo lo que importa adentro lo hace por rutas relativas y su única dependencia de
runtime es `vue`. Sin alias de build, sin utilidades compartidas de este repositorio.

```ts
import { DataTable, DataTableColumnToggle } from '@/components/ui/datatable'
import type { DataTableColumn } from '@/components/ui/datatable'
```

Por esta vía no hace falta importar la hoja de estilos: `DataTable.vue` importa
`./styles/datatable.css` por su cuenta y el bundler la deduplica.

### Opción B — instalar el paquete desde GitHub

```sh
npm install github:jorge-koki/datagrid-vue
```

```ts
import { DataTable, DataTableColumnToggle } from 'datagrid-vue'
import type { DataTableColumn } from 'datagrid-vue'
import 'datagrid-vue/style.css' // obligatorio por esta vía
```

Por esta vía el CSS se **extrae a un archivo aparte**, nunca se inyecta dentro del JS. El CSS
inyectado rompe el SSR —el bundle tocaría `document` al importarse— y además quita la posibilidad de
redefinir los tokens `--dt-*` antes de montar. Esa es la razón de que la importación explícita
exista.

El paquete se publica solo como ESM, con `vue` como peer dependency: nunca se empaqueta. Dos copias
de Vue en una misma aplicación rompen la reactividad de una forma casi imposible de depurar, porque
los efectos se registran en un runtime y se disparan desde el otro.

`dist/` no está versionado, así que el paquete se construye a sí mismo al instalarse, mediante el
script `prepare` que npm ejecuta para las dependencias de git. No hay nada extra que hacer del lado
del consumidor; solo significa que la instalación tarda un par de segundos más que una desde el
registro.

**Si el proyecto no declara todavía los módulos `*.css` para TypeScript**, hay que agregar un
`declare module '*.css';` a algún `.d.ts`. El `DataTable.vue.d.ts` emitido arrastra la importación
con efecto secundario del CSS del SFC. Los proyectos Vite ya lo tienen a través de `vite/client`, y
también Nuxt y la mayoría de las configuraciones de webpack con TS.

---

## Ejemplo completo

Un ejemplo ejecutable, con la edición conectada de punta a punta:

```vue
<script setup lang="ts">
import { shallowRef, useTemplateRef } from 'vue'
import { COLOR_TOKENS, DataTable, DataTableColumnToggle } from 'datagrid-vue'
import type {
  BeforeEditEvent,
  ColumnVisibilityState,
  DataTableColumn,
  DataTableInstance,
  EditCommitEvent,
} from 'datagrid-vue'
import 'datagrid-vue/style.css'

type Invoice = {
  id: number
  customer: string
  total: number
  status: 'draft' | 'sent' | 'paid'
}

const rows = shallowRef<readonly Invoice[]>([
  { id: 1, customer: 'Acme', total: 1200, status: 'paid' },
  { id: 2, customer: 'Globex', total: 380, status: 'draft' },
])

const columns: readonly DataTableColumn<Invoice>[] = [
  { key: 'customer', label: 'Customer', width: 220, resizable: true, editable: true },
  { key: 'total', label: 'Total', width: 120, renderer: 'number', editable: true },
  {
    key: 'status',
    label: 'Status',
    width: 120,
    renderer: 'select',
    editable: true,
    options: [
      { value: 'draft', label: 'Draft', color: COLOR_TOKENS.neutral },
      { value: 'sent', label: 'Sent', color: COLOR_TOKENS.blue },
      { value: 'paid', label: 'Paid', color: COLOR_TOKENS.green },
    ],
  },
]

const columnVisibility = shallowRef<ColumnVisibilityState>({})
const table = useTemplateRef<DataTableInstance>('table')

// Veto: una factura paga es de solo lectura.
function onBeforeEdit(event: BeforeEditEvent<Invoice>): void {
  if (event.row.status === 'paid') event.cancel()
}

// La tabla es controlada: nunca escribe sobre `rows`. La escritura es de este handler.
function onEditCommit(event: EditCommitEvent<Invoice>): void {
  const next = rows.value.slice()
  next[event.rowIndex] = { ...event.row, [event.columnKey]: event.newValue }
  rows.value = next
}
</script>

<template>
  <DataTableColumnToggle v-model="columnVisibility" :columns="columns" />
  <button type="button" @click="table?.resetLayout()">Reset layout</button>

  <div style="height: 60vh">
    <DataTable
      ref="table"
      v-model:column-visibility="columnVisibility"
      :rows="rows"
      :columns="columns"
      row-key="id"
      table-id="invoices"
      persist
      stripe
      bordered
      @before-edit="onBeforeEdit"
      @edit-commit="onEditCommit"
    />
  </div>
</template>
```

> **`TRow` tiene que ser un `type`, no una `interface`.** El componente se declara como
> `generic="TRow extends Record<string, unknown>"`, y en TypeScript solo los alias de tipo reciben
> una firma de índice implícita. `interface Invoice { … }` no satisface la restricción.

---

## Props

`rows`, `columns` y `rowKey` son obligatorias. Todo lo demás tiene valor por defecto.

| Prop                    | Tipo                                                             | Por defecto                   | Descripción                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rows`                  | `readonly TRow[]`                                                | —                             | El dataset completo. Nunca se corta, ni se copia, ni se vuelve reactivo en profundidad. La tabla solo indexa dentro de la ventana visible.                                     |
| `columns`               | `readonly DataTableColumn<TRow>[]`                               | —                             | Definiciones de columna, en orden de declaración. Ver [Columnas](#columnas).                                                                                                   |
| `rowKey`                | `keyof TRow \| ((row: TRow, index: number) => string \| number)` | —                             | Identidad de una fila. Se estampa como `data-row-key` para que el DOM siga siendo inspeccionable y testeable. Nunca afecta al reciclado: el pool recicla por slot de viewport. |
| `rowHeight`             | `number`                                                         | `40` / `30` con `dense`       | Altura de fila en px. Es un número y no un valor CSS porque el virtualizador divide por él en cada frame. Se replica en `--dt-row-height`.                                     |
| `headerHeight`          | `number`                                                         | `44` / `34` con `dense`       | Altura del header en px. Se replica en `--dt-header-height`.                                                                                                                   |
| `dense`                 | `boolean`                                                        | `false`                       | Preset compacto: filas más bajas, tipografía menor, padding más ajustado.                                                                                                      |
| `overscan`              | `number`                                                         | `4`                           | Filas y columnas extra pintadas fuera de la ventana visible. Más alto cuesta tiempo de pintado y oculta bordes en blanco durante el scroll rápido.                             |
| `defaultColumnWidth`    | `number`                                                         | `150`                         | Ancho en px para las columnas que no declaran el suyo.                                                                                                                         |
| `virtualizeColumns`     | `boolean`                                                        | `true`                        | Pinta solo las columnas visibles en horizontal. Conviene apagarlo en tablas angostas donde la fila entera entra: ahí el cálculo de ventana es overhead puro.                   |
| `theme`                 | `'light' \| 'dark' \| 'auto'`                                    | `'auto'`                      | Esquema de color. Ver [Temas](#temas).                                                                                                                                         |
| `emptyText`             | `string`                                                         | `'No data'`                   | Mensaje que se muestra cuando `rows` está vacío.                                                                                                                               |
| `stripe`                | `boolean`                                                        | `false`                       | Fondo alternado en las filas impares.                                                                                                                                          |
| `bordered`              | `boolean`                                                        | `false`                       | Dibuja separadores de celda.                                                                                                                                                   |
| `columnVisibility`      | `Readonly<Record<string, boolean>>`                              | _no controlado_               | `v-model:column-visibility`. Una clave ausente se resuelve con `column.defaultVisible ?? true`.                                                                                |
| `columnOrder`           | `readonly string[]`                                              | _no controlado_               | `v-model:column-order`. Se reconcilia contra las columnas actuales antes de aplicarse.                                                                                         |
| `columnWidths`          | `Readonly<Record<string, number>>`                               | _no controlado_               | `v-model:column-widths`. Pisa a `column.width` y siempre se acota por `minWidth` / `maxWidth`.                                                                                 |
| `tableId`               | `string`                                                         | —                             | Identificador único de esta tabla dentro de la aplicación. Obligatorio para persistir: es lo que separa el layout de una tabla del de otra.                                    |
| `persist`               | `boolean \| DataTablePersistOptions`                             | `false`                       | Persiste el layout entre sesiones. `true` significa `localStorage` con los valores por defecto. Ver [Persistencia](#visibilidad-orden-y-persistencia-de-columnas).             |
| `selectionMode`         | `'none' \| 'cell' \| 'row'`                                      | `'cell'`                      | Qué seleccionan el clic y el teclado. Ver [Selección](#selección-y-navegación-con-el-teclado).                                                                                 |
| `activeCell`            | `CellPosition \| null`                                           | _no controlado_               | `v-model:active-cell`. La celda seleccionada. `null` significa "controlado y sin selección".                                                                                   |
| `groupBy`               | `readonly string[]`                                              | _no controlado_ (lista vacía) | `v-model:group-by`. Claves de columna por las que agrupar, en orden de anidamiento. Ver [Agrupación](#agrupación).                                                             |
| `expandedGroups`        | `readonly string[]`                                              | _no controlado_               | `v-model:expanded-groups`. `groupId` de los grupos expandidos. Una lista vacía significa "controlado y todo colapsado".                                                        |
| `groupsDefaultExpanded` | `boolean`                                                        | `true`                        | Estado inicial de un grupo del que todavía no se sabe nada. Deja de intervenir cuando `expandedGroups` está controlado.                                                        |
| `showGroupCount`        | `boolean`                                                        | `true`                        | Si la cabecera de grupo muestra la insignia con cuántas filas contiene.                                                                                                        |
| `emptyGroupLabel`       | `string`                                                         | `'(empty)'`                   | Etiqueta del grupo que junta los valores ausentes. Ver [Agrupación](#groupid-una-identidad-por-camino).                                                                        |

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

| Evento                    | Payload                             | Cuándo                                                                                               |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `beforeEdit`              | `BeforeEditEvent<TRow>`             | Antes de que se abra el editor de una celda. **Cancelable.**                                         |
| `editCommit`              | `EditCommitEvent<TRow>`             | Una edición produjo un valor que el padre debería persistir. Solo cuando el valor cambió de verdad.  |
| `afterEdit`               | `AfterEditEvent<TRow>`              | Terminó una sesión de edición, haya commiteado o no. Exactamente una vez por editor abierto.         |
| `columnResize`            | `ColumnResizeEvent`                 | Un arrastre de redimensionado terminó con un ancho distinto. Un clic sin arrastre no es un resize.   |
| `rowClick`                | `{ row: TRow; rowIndex: number }`   | Clic en cualquier punto de una fila de datos pintada. Una cabecera de grupo no lo dispara.           |
| `cellSelect`              | `CellSelectEvent<TRow>`             | La celda activa se movió a una celda real. Lleva la fila, la columna y el valor ya resuelto.         |
| `groupToggle`             | `GroupToggleEvent`                  | Se plegó o se desplegó un grupo puntual, por clic o por teclado. Ver [Agrupación](#agrupación).      |
| `update:activeCell`       | `CellPosition \| null`              | Cambió la celda activa, incluso a `null`. Se emite antes de `cellSelect`.                            |
| `update:columnVisibility` | `Readonly<Record<string, boolean>>` | Cambió la visibilidad (por la UI, por la carga de la persistencia o por `resetLayout`).              |
| `update:columnOrder`      | `string[]`                          | Cambió el orden.                                                                                     |
| `update:columnWidths`     | `Readonly<Record<string, number>>`  | Cambiaron los anchos, también durante el arrastre.                                                   |
| `update:groupBy`          | `string[]`                          | Cambiaron las claves de agrupación (por la UI, por la carga de la persistencia o por `resetLayout`). |
| `update:expandedGroups`   | `string[]`                          | Cambió el estado de expansión. Lleva la lista COMPLETA de expandidos, no el grupo que cambió.        |

### El ciclo de edición

```
doble clic / Enter / F2 / clic en una casilla
        │
        ▼
   beforeEdit  ──── event.cancel() ────► no pasa nada más. Ni editor, ni afterEdit.
        │
        ▼
   se abre el editor (o se aplica directamente el valor de la casilla)
        │
        ├── Enter / blur / cambio del select / la fila sale de la ventana ──► commit
        └── Escape ──────────────────────────────────────────────────────► se descarta
        │
        ▼
   editCommit   (solo si newValue difiere de oldValue)
        │
        ▼
   afterEdit    (siempre; `canceled: true` cuando se descartó con Escape)
```

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
| Doble clic en una celda                            | Abre el editor                                                                  |
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

El modelo es el de una planilla de cálculo: **un clic selecciona, dos clics editan.** Seleccionar
para leer un valor o para empezar a navegar es mucho más frecuente que editar, y exigir doble clic
para eso costaría un gesto de más en el caso común.

La selección es una `CellPosition` (`{ rowIndex, columnKey }`) que guarda el componente, no el foco
del DOM. Acá eso importa más que en una tabla común: los nodos del pool se reciclan al scrollear, así
que el elemento enfocado no es un lugar confiable donde guardar "dónde está parado el usuario". La
posición activa sobrevive a cualquier repintado.

> **Con grupos activos, `rowIndex` indexa la secuencia VISIBLE**, no la prop `rows`. Los eventos
> hacen el camino inverso. La distinción está desarrollada en
> [Dos números distintos: posición visible e índice original](#dos-números-distintos-posición-visible-e-índice-original).

### `selectionMode`

| Valor    | Comportamiento                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'cell'` | Por defecto. La **celda** activa recibe `.dt-cell--active` y `aria-selected`; su fila recibe además `.dt-row--active`.                                                                                            |
| `'row'`  | La **fila** activa es la unidad seleccionada: recibe el anillo y `aria-selected`, y la celda no recibe ninguno de los dos. La celda activa se sigue registrando, para que las flechas sepan en qué columna están. |
| `'none'` | Sin selección por puntero, sin ningún manejador de teclado registrado, y el viewport deja de ser enfocable (`tabindex="-1"`).                                                                                     |

`'none'` no es un early return dentro de un manejador: el objeto de listeners viene vacío y Vue no
registra nada. El `selectCell()` expuesto sigue escribiendo el estado si se lo llama, así que una
selección por código sigue siendo posible; lo que desaparece son las vías de entrada del usuario.

### Teclas

Todas actúan sobre la celda activa y requieren que el viewport tenga el foco.

| Tecla                         | Efecto                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `↑` `↓` `←` `→`               | Mueve una celda. **Se acota en los bordes: no da la vuelta.**                                          |
| `Tab` / `Shift`+`Tab`         | Mueve una celda en orden de lectura. **Pasa a la fila siguiente o anterior** al llegar al borde.       |
| `Home`                        | Primera columna de la fila actual                                                                      |
| `End`                         | Última columna de la fila actual                                                                       |
| `Ctrl`/`Cmd`+`Home`           | Primera celda de la tabla                                                                              |
| `Ctrl`/`Cmd`+`End`            | Última celda de la tabla                                                                               |
| `PageUp` / `PageDown`         | Sube o baja un viewport completo de filas enteras (mínimo 1)                                           |
| `Enter` / `F2`                | Edita la celda activa (la alterna, en una columna de casillas); sobre una cabecera de grupo, la pliega |
| `Espacio`                     | Sobre una cabecera de grupo, la pliega; sobre una fila de datos es un carácter imprimible más          |
| Cualquier carácter imprimible | Edita la celda activa, sembrada con ese carácter                                                       |
| `Escape`                      | Con un editor abierto: descarta. Sin editor abierto: **nada**, la selección se conserva.               |

Dos asimetrías deliberadas:

- **Las flechas se acotan, `Tab` da la vuelta.** Las flechas son espaciales: pasarse del borde
  derecho y reaparecer en la fila siguiente desorienta. `Tab` es secuencial, que es lo que significa
  en un formulario y en una planilla, y es lo que permite recorrer la grilla entera sin soltar el
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

### Cómo se conecta

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import type { CellPosition, CellSelectEvent, SelectionMode } from 'datagrid-vue'

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
- `Enter` dentro del editor commitea **y baja la selección una fila**, como en una planilla. El
  movimiento ocurre persista o no el padre el valor: es navegación, no edición.
- Sacar la fila editada de la ventana virtual commitea y cierra el editor; la selección se queda en
  esa celda.

### Accesibilidad

**La grilla es `.dt-root`**, la raíz del componente, porque es el único elemento que contiene a la vez
la fila de encabezado y el cuerpo. No es el viewport: ese scrollea y recibe el teclado, pero queda por
debajo de la grilla. ARIA no exige que la grilla sea el contenedor con scroll, y esa es exactamente la
libertad que hace falta acá, porque el header se dibuja arriba del contenedor que scrollea.

La estructura completa, de afuera hacia adentro:

```
.dt-root                  role="grid" | "treegrid"   aria-rowcount, aria-colcount
├── .dt-header            role="rowgroup"
│   └── .dt-header-inner  role="row"                 aria-rowindex="1"
│       └── .dt-header-cell  role="columnheader"     aria-colindex
└── .dt-viewport          — sin rol: scrollea y recibe el teclado
    └── .dt-canvas        role="rowgroup"
        └── .dt-row       role="row"                 aria-rowindex
            └── .dt-cell  role="gridcell"            aria-colindex
```

| Elemento               | Atributos                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dt-root`             | `role="grid"` —o `role="treegrid"` con agrupación activa—, `aria-rowcount` (entradas visibles **+ 1** por la fila de encabezado), `aria-colcount` (columnas visibles)            |
| `.dt-header`           | `role="rowgroup"`                                                                                                                                                                |
| `.dt-header-inner`     | `role="row"`, `aria-rowindex="1"`: es LA fila de encabezado, y es la que da sentido al corrimiento del resto                                                                     |
| `.dt-header-cell`      | `role="columnheader"`, `aria-colindex` (base 1 sobre las columnas **visibles**)                                                                                                  |
| `.dt-viewport`         | Sin rol propio. `tabindex="0"` salvo con `selectionMode` en `'none'`, y el manejador de teclado                                                                                  |
| `.dt-canvas`           | `role="rowgroup"`                                                                                                                                                                |
| `.dt-row`              | `role="row"`, `aria-rowindex` (base 1, corrido por la fila de encabezado: la fila de datos `0` reporta `2`), `aria-selected` en modo `'row'`, `aria-level` con agrupación activa |
| `.dt-row.dt-group-row` | Además: `aria-expanded`, `aria-level` (base 1, igual a `depth + 1`), `aria-posinset` y `aria-setsize` entre sus hermanos de nivel                                                |
| `.dt-cell`             | `role="gridcell"`, `aria-colindex` (base 1 sobre las columnas **visibles**, así que una columna oculta no ocupa slot), `aria-selected` en modo `'cell'`, `tabindex="-1"`         |

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

Las celdas llevan `tabindex="-1"` para poder recibir el foco por código y por clic sin entrar en el
orden de tabulación: con unas 450 celdas visibles, entrar en ese orden haría imposible tabular más
allá de la tabla.

**El foco y el teclado no se movieron con el rol.** Siguen en `.dt-viewport`, que es la caja que
scrollea: es donde tiene sentido que aparezca el anillo de foco, y es el elemento al que el usuario le
está mandando las teclas de desplazamiento. El manejador escucha ahí y la posición activa sigue siendo
estado del componente, no el nodo enfocado.

> **Lo único que queda afuera del contrato.** El mensaje de `emptyText` se renderiza como un `div`
> dentro de `.dt-root`, o sea dentro de la grilla, y no es una fila. Solo aparece con `rows` vacío,
> cuando la grilla no tiene ninguna fila de datos que pueda entrar en conflicto con él.

---

## Métodos expuestos

Se llegan a través de un template ref cuando las props declarativas no alcanzan.

```ts
const table = useTemplateRef<DataTableInstance>('table')
```

| Método                 | Descripción                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `scrollToRow(index)`   | Desplaza hasta que `index` sea la primera fila completamente visible. Se acota. Con grupos, `index` recorre la secuencia visible.     |
| `scrollToColumn(key)`  | Desplaza hasta que esa columna quede en el borde izquierdo. No hace nada con una clave desconocida.                                   |
| `scrollToCell(pos)`    | Desplaza lo mínimo necesario para traer esa celda a la vista. No centra y no mueve la selección.                                      |
| `selectCell(pos)`      | Fija la celda activa, o la limpia con `null`. **Además la trae a la vista**, a diferencia de una selección interna.                   |
| `refresh()`            | Invalida todos los valores de celda cacheados, rehace el árbol de grupos **y agenda un repintado en el próximo frame**.               |
| `resetLayout()`        | Descarta el layout guardado y vuelve visibilidad, orden, anchos y agrupación a sus valores por defecto. Es el "restablecer columnas". |
| `flushPersistence()`   | Escribe de inmediato el layout pendiente por el debounce. El desmontaje ya vuelca lo pendiente por su cuenta.                         |
| `toggleGroup(groupId)` | Invierte el estado de un grupo por su `groupId`. Ver [Agrupación](#agrupación).                                                       |
| `expandAllGroups()`    | Expande todos los grupos del árbol actual.                                                                                            |
| `collapseAllGroups()`  | Colapsa todos los grupos del árbol actual.                                                                                            |

`selectCell` desplaza y el camino interno de clic y teclado no lo necesita, porque el código que la
llama —un resultado de búsqueda, un enlace profundo— no tiene forma de saber si esa celda estaba
dentro de la ventana. Emite `update:activeCell` y `cellSelect` exactamente igual que un clic.

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
  editor?: 'text' | 'number' | 'select' | 'checkbox' | 'date'
  options?: readonly CellOption[]
  min?: number
  max?: number
  step?: number
  groupable?: boolean
  aggregate?: ColumnAggregation<TRow>
}
```

| Campo                   | Por defecto                                    | Notas                                                                                                                                          |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                   | —                                              | Id único, y también la clave de datos por defecto (`row[key]`).                                                                                |
| `label`                 | `key`                                          | Texto del header.                                                                                                                              |
| `width`                 | `defaultColumnWidth` (150)                     | Siempre acotado a `[max(32, minWidth), min(4000, maxWidth)]`.                                                                                  |
| `minWidth` / `maxWidth` | `32` / `4000`                                  | Se aplican al resolver el ancho y durante el redimensionado.                                                                                   |
| `resizable`             | `false`                                        | Muestra un handle de arrastre en el borde del header.                                                                                          |
| `align`                 | el `defaultAlign` del renderer, si no `'left'` | Un `align` explícito siempre gana. Se aplica como clase, no como estilo inline.                                                                |
| `editable`              | `false`                                        | Tiene que ser exactamente `true` para que la celda se pueda editar.                                                                            |
| `format`                | —                                              | Valor crudo → el string que se escribe en la celda. **Debe ser puro y barato.** No se aplica a los agregados: para eso está `formatAggregate`. |
| `formatAggregate`       | —                                              | Valor agregado → el string que se escribe en la cabecera de grupo. Ver [Formato de los agregados](#formato-de-los-agregados).                  |
| `cellClass`             | —                                              | Clase CSS extra sobre el elemento de celda. También está en el camino caliente.                                                                |
| `accessor`              | `row[key]`                                     | Lee el valor desde la fila. Devuelve `CellValue`: no puede devolver un objeto ni un array.                                                     |
| `renderer`              | `'text'`                                       | Nombre de un renderer registrado, o una implementación. Un nombre desconocido cae en `'text'` en lugar de lanzar.                              |
| `hideable`              | `true`                                         | `false` deja la columna fuera de `DataTableColumnToggle`.                                                                                      |
| `defaultVisible`        | `true`                                         | Visibilidad inicial. La persistencia y el v-model tienen prioridad sobre esto.                                                                 |
| `editor`                | inferido (ver más abajo)                       | El control que se abre al editar.                                                                                                              |
| `options`               | —                                              | Alimenta los renderers `badge` / `select` / `tags`, **el** editor `select` y la etiqueta de las cabeceras de grupo. Una sola fuente de verdad. |
| `min`/`max`/`step`      | —                                              | Se trasladan a los atributos del input del editor `number`.                                                                                    |
| `groupable`             | `true`                                         | `false` hace que una clave suya dentro de `groupBy` se descarte. No oculta la columna. Ver [Agrupación](#agrupación).                          |
| `aggregate`             | —                                              | Agregación que esta columna muestra en las cabeceras de grupo: una incluida o una función propia.                                              |

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

**Por columna (lo más simple: `TRow` es concreto):**

```ts
import type { CellRenderContext, CellRenderer, CellRendererHandle } from 'datagrid-vue'

type BarState = { bar: HTMLElement; width: string }
const barStates = new WeakMap<CellRendererHandle, BarState>()

const barRenderer: CellRenderer<Invoice> = {
  type: 'bar',
  defaultAlign: 'right',

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

  destroy(handle: CellRendererHandle): void {
    barStates.delete(handle)
  },
}

const column: DataTableColumn<Invoice> = { key: 'total', renderer: barRenderer }
```

**Registrado globalmente (usable por nombre desde cualquier tabla):**

```ts
import { registerRenderer } from 'datagrid-vue'
import type { CellRenderContext, CellRendererHandle } from 'datagrid-vue'

registerRenderer('bar', () => ({
  type: 'bar',
  defaultAlign: 'right',
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

---

## Agrupación

Agrupar convierte la lista plana de filas en un árbol: una cabecera por grupo, sus filas debajo, y la
posibilidad de plegarlas. Por dentro, lo que el virtualizador recorre deja de ser `rows` y pasa a ser
una **vista aplanada**: un array derivado donde cada entrada es una cabecera de grupo o una fila de
datos. Eso es lo que permite que la posición vertical siga siendo un índice y que el costo por frame
siga siendo constante.

Con `groupBy` vacío —el valor por defecto— la tabla no paga absolutamente nada por esta función: no
se construye ningún árbol, no se aplana nada y el pool recorre el mismo camino de siempre sobre
`rows`.

### El ejemplo mínimo

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DataTable } from 'datagrid-vue'
import type { DataTableColumn, GroupToggleEvent } from 'datagrid-vue'

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
| `expandedGroups`        | `readonly string[]` | _no controlado_ | `v-model:expanded-groups`. `groupId` de los grupos expandidos.                                                                                                       |
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
import type { AggregationFn, DataTableColumn } from 'datagrid-vue'

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
esa versión ingenua es la que aparece en más de una grilla del mercado. Acá cada fila alimenta a los
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

// Controlado: la tabla no cambia esto sola, solo emite lo que el padre debería adoptar.
const expandedGroups = shallowRef<readonly string[]>(['region:LATAM'])
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
| `.dt-group-header`        | El contenedor del chevron, la etiqueta y la insignia. Se extiende por todo el tramo visible.                  |
| `.dt-group-chevron`       | El SVG del chevron. Gira con una transición de 120ms, resuelta por el compositor.                             |
| `.dt-group-label`         | El texto del grupo, ya resuelto contra `column.options`.                                                      |
| `.dt-group-count`         | La insignia con la cantidad de filas descendientes. Se oculta con `showGroupCount: false`.                    |
| `.dt-group-aggregate`     | Una cifra de agregado, posicionada en el offset de su columna y por encima de la cabecera.                    |
| `--dt-group-indent`       | Sangría por nivel de anidamiento. `16px`, o `12px` con `dense`.                                               |
| `--dt-group-depth`        | Nivel de anidamiento de esa fila. Lo escribe el pool, una sola propiedad por fila.                            |

La sangría es un `padding-left` calculado a partir de esas dos custom properties, y no divs
anidados: es una escritura de propiedad contra crear y destruir nodos cada vez que un slot pasa de un
nivel a otro.

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

### Tokens

| Token                  | Por defecto en claro | Por defecto en oscuro | Adopta                                 |
| ---------------------- | -------------------- | --------------------- | -------------------------------------- |
| `--dt-bg`              | `#ffffff`            | `#111827`             | `--ui-bg`                              |
| `--dt-bg-muted`        | `#f9fafb`            | `#1f2937`             | `--ui-bg-muted`                        |
| `--dt-bg-elevated`     | `#f3f4f6`            | `#1f2937`             | `--ui-bg-elevated`                     |
| `--dt-bg-accented`     | `#e5e7eb`            | `#374151`             | `--ui-bg-accented`                     |
| `--dt-border`          | `#e5e7eb`            | `#374151`             | `--ui-border`                          |
| `--dt-border-accented` | `#d1d5db`            | `#4b5563`             | `--ui-border-accented`                 |
| `--dt-text`            | `#111827`            | `#f9fafb`             | `--ui-text`                            |
| `--dt-text-muted`      | `#6b7280`            | `#9ca3af`             | `--ui-text-muted`                      |
| `--dt-text-dimmed`     | `#9ca3af`            | `#6b7280`             | `--ui-text-dimmed`                     |
| `--dt-primary`         | `#00c16a`            | igual                 | `--ui-primary`                         |
| `--dt-radius`          | `0.375rem`           | igual                 | `--ui-radius`                          |
| `--dt-color-blue`      | `#1d4ed8`            | `#60a5fa`             | —                                      |
| `--dt-color-red`       | `#b91c1c`            | `#f87171`             | —                                      |
| `--dt-color-amber`     | `#b45309`            | `#fbbf24`             | —                                      |
| `--dt-color-green`     | `#15803d`            | `#4ade80`             | —                                      |
| `--dt-color-purple`    | `#7e22ce`            | `#c084fc`             | —                                      |
| `--dt-color-neutral`   | `#4b5563`            | `#9ca3af`             | —                                      |
| `--dt-tint-strength`   | `14%`                | `20%`                 | —                                      |
| `--dt-row-height`      | `40px`               | igual                 | se escribe inline desde `rowHeight`    |
| `--dt-header-height`   | `44px`               | igual                 | se escribe inline desde `headerHeight` |
| `--dt-font-size`       | `0.875rem`           | igual                 | —                                      |
| `--dt-cell-px`         | `0.75rem`            | igual                 | —                                      |
| `--dt-group-indent`    | `16px`               | igual                 | — (`12px` con `dense`)                 |

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

### Estilos de la selección

La selección no introduce ningún token nuevo: se dibuja enteramente con `--dt-primary` y
`--dt-bg-accented`, así que re-estilar el acento re-estila la selección.

| Enganche                         | Qué hace                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dt-cell--active`               | La celda activa. `box-shadow: inset 0 0 0 2px var(--dt-primary)` más `z-index: 1`.                                                                         |
| `.dt-row--active`                | La fila que contiene la celda activa. Fondo `--dt-bg-accented`, en **los dos** modos, `'cell'` y `'row'`. También aplica a una cabecera de grupo.          |
| `.dt-header-cell--active`        | El header de la columna activa. Fondo acentuado más un subrayado de 2px en `--dt-primary`.                                                                 |
| `[data-selection]` en `.dt-root` | Replica `selectionMode` (`none` / `cell` / `row`). La hoja de estilos lo usa para mover el anillo: en modo `'row'` lo recibe la fila y la celda lo pierde. |

El anillo es un `box-shadow: inset`, y no un `border` ni un `outline`. La elección sostiene algo:

- Un `border` cambiaría la caja de la celda y correría su contenido 2px cada vez que la selección se
  mueve.
- Un `outline` se dibuja por fuera de la caja, así que la celda vecina —que está posicionada en
  absoluto justo al lado— pintaría encima de la mitad.

El `box-shadow: inset` se dibuja dentro de la caja existente, no cuesta layout y compone. El
`z-index: 1` levanta la celda activa por encima de sus vecinas para que el anillo no quede recortado
por el fondo de la siguiente.

Como `.dt-row--active` y `.dt-row--stripe` tienen la misma especificidad y una fila puede ser las
dos, la regla de activa se declara **después** de la de stripe y gana por orden de aparición. Al
sobrescribir cualquiera de las dos, conviene conservar ese orden.

### Estilar celdas desde el CSS propio

`column.cellClass` devuelve un nombre de clase que aterriza en el elemento `.dt-cell`. **Esa regla
tiene que ser global.** Las filas y las celdas del cuerpo las crea el pool con
`document.createElement`, fuera del render de Vue, así que nunca llevan el atributo `data-v-*` en el
que se apoya `<style scoped>`: una regla con alcance que las apunte simplemente no se aplica nunca.
Lo mismo vale para las cabeceras de grupo y sus agregados.

---

## Visibilidad, orden y persistencia de columnas

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
  include: { visibility: true, widths: true, order: true, grouping: true },
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
import type { DataTableStorageAdapter, PersistedTableState } from 'datagrid-vue'

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

## Notas de rendimiento

### Qué la hace rápida

| Mecanismo                                   | Efecto                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Las celdas del cuerpo no son vnodes         | Sin diff de vnodes por frame. El pool escribe solo las propiedades que cambiaron.                                                                                           |
| Reciclado de nodos por slot de viewport     | El pool crece con la cantidad visible y nunca encoge durante el scroll.                                                                                                     |
| Escribir solo si cambió, en todas partes    | Cada nodo cachea lo último que se pintó sobre él. Repintar con las mismas entradas no escribe nada.                                                                         |
| Caché de pintado por valor crudo            | Si una celda ya muestra ese valor, para esa fila y esa columna, se saltean `format`, `cellClass` y `update`.                                                                |
| `transform`, no `top` / `left`              | El posicionamiento se resuelve en el compositor y no invalida el layout del documento.                                                                                      |
| Un listener delegado por evento             | No 450 registros de listener por frame.                                                                                                                                     |
| `shallowRef` y props superficiales          | 100k filas cuestan cero proxies. La matemática de la ventana es O(1): una división por frame, independiente de la cantidad de filas.                                        |
| El scroll del header es un único transform  | El header lo renderiza Vue, pero no se vuelve a diferenciar mientras se scrollea.                                                                                           |
| La selección se resuelve por comparación    | La posición activa se desestructura una vez por frame; cada celda compara dos valores que ya tiene. Mover la selección escribe exactamente en las dos celdas que cambiaron. |
| El árbol de grupos vive aparte del aplanado | Agrupar y agregar cuestan una pasada cuando cambian los datos; plegar solo vuelve a emitir la vista, y el scroll no toca ninguna de las dos cosas.                          |

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

   Lo mismo vale para `cellClass`: comparaciones y nada más, sin asignar y sin armar strings más allá
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

7. **Alturas de fila no uniformes.** No están soportadas: la matemática O(1) de la ventana depende de
   una única altura fija. No conviene falsearlas con CSS, porque la geometría del virtualizador
   dejaría de coincidir con el DOM.

8. **Una agregación propia cara.** Corre una vez por grupo y por reconstrucción del árbol, no por
   frame, pero un árbol con miles de grupos multiplica ese costo por miles. Y si además recorre las
   filas del grupo, el total es O(filas × niveles) por reconstrucción. Con las agregaciones incluidas
   alcanza casi siempre, y no juntan las filas.

---

## Tests

La suite vive en `src/components/ui/datatable/__tests__/` y corre con [Vitest](https://vitest.dev)
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
| `Intl.NumberFormat` se construye **una sola vez**                               | Un formateador por celda y por frame domina el presupuesto de pintado           |
| `avatar` y `tags` mutan sin asignar dentro de `update`                          | La basura del camino caliente la cobra el recolector con un frame perdido       |
| Cambiar el tipo de renderer en un slot reciclado **reconstruye** la estructura  | Un slot puede pasar de `badge` a `progress` durante el scroll horizontal        |
| Los índices ARIA se escriben **por fila**, no por celda                         | Misma información para el lector de pantalla, quince veces menos escrituras     |
| La estructura accesible del header cuesta **cero** escrituras por frame         | Los roles son estáticos; asociar por `columnheader` evita un atributo por celda |
| Un slot que pasa de fila de datos a cabecera de grupo **recicla** su nodo       | Plegar un grupo mueve de tipo a varios slots a la vez, en mitad del scroll      |

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

| Archivo                       | Qué cubre                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useVirtualWindow.test.ts`    | Matemática de la ventana: 100k filas, scroll negativo, overscroll, overscan                                                                                                           |
| `useColumnLayout.test.ts`     | Offsets acumulados, acotado de anchos, orden, y la búsqueda binaria por fuerza bruta                                                                                                  |
| `reconcile.test.ts`           | Estado guardado contra columnas que cambiaron; payloads corruptos                                                                                                                     |
| `useTablePersistence.test.ts` | Orden carga/guardado, debounce, volcado al desmontar, degradación en SSR y modo privado                                                                                               |
| `useCellEditor.test.ts`       | Veto de `beforeEdit`, coacción de tipos, y que `rows` nunca se muta                                                                                                                   |
| `selection.test.ts`           | Teclado completo, auto-scroll en píxeles exactos, columnas ocultas, y la estructura accesible: roles, `aria-rowindex` del encabezado y `aria-colindex` alineado entre header y cuerpo |
| `renderers.test.ts`           | Valores inesperados en cada renderer incluido                                                                                                                                         |
| `grouping.test.ts`            | Aplanado, agregados anidados, expansión controlada, `formatAggregate`, `emptyGroupLabel`, y que `editCommit` reporta el índice ORIGINAL                                               |

---

## Limitaciones

Dicho sin vueltas. Nada de esto está implementado:

| Sin implementar                                   | Notas                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ordenamiento**                                  | Sin estado de orden, sin indicadores y sin clic para ordenar. Hay que ordenar `rows` por fuera y pasar el array ya ordenado.                                                                                                                                                                                     |
| **Filtrado y búsqueda**                           | Lo mismo: filtrar aguas arriba y pasar el array ya filtrado.                                                                                                                                                                                                                                                     |
| **Selección de rangos**                           | La selección es exactamente una celda (o una fila). Sin `Shift`+clic, sin rango con `Shift`+flechas, sin multiselección con `Ctrl`+clic, sin copiar un bloque.                                                                                                                                                   |
| **Selección de varias filas con casillas**        | No hay modelo `selectedRows` ni columna de casillas incluida. El modo `'row'` marca una fila por vez; `rowClick` y `cellSelect` son los enganches para construir la propia.                                                                                                                                      |
| **Pivoteo**                                       | La agrupación **sí** está implementada (ver [Agrupación](#agrupación)); pivotear no, y queda **deliberadamente fuera de alcance**: exige una matriz de columnas derivadas de los datos, lo que rompe el supuesto de que las columnas son configuración estática sobre el que se apoya todo el camino de pintado. |
| **Reordenar columnas arrastrando**                | El v-model `columnOrder` existe y está completamente reconciliado, pero no viene ninguna UI de arrastre. El redimensionado sí tiene su handle.                                                                                                                                                                   |
| **Virtualización de filas con alturas variables** | `rowHeight` es fijo por tabla. Las alturas variables reemplazarían la división O(1) por un índice de offsets medidos.                                                                                                                                                                                            |
| **Columnas fijas o congeladas**                   | Todas las columnas scrollean.                                                                                                                                                                                                                                                                                    |
| **Editor de selección múltiple**                  | El renderer `tags` muestra listas; no hay ningún editor que edite una.                                                                                                                                                                                                                                           |
| **SSR del cuerpo**                                | El header y el armazón renderizan bien; el cuerpo se pinta al montar, solo del lado del cliente.                                                                                                                                                                                                                 |

### Componentes Vue por celda — deliberadamente no soportado

No se puede poner un componente Vue dentro de una celda del cuerpo, y eso es la arquitectura entera,
no un descuido. Una celda respaldada por un vnode significa que Vue vuelve a ser dueño del camino
caliente del scroll: montar y desmontar instancias de componente a medida que las filas se reciclan,
correr el scheduler dentro del presupuesto del frame, y pagar el diff de vnodes por unas 450 celdas
por frame. Es exactamente el costo que este componente existe para evitar.

El reemplazo es el protocolo de renderers: `create` una vez, `update` por frame, mutando DOM plano.
Cubre el mismo terreno —badges, anillos, avatares, inputs— a una fracción del costo, y está exportado
y documentado para que nadie quede bloqueado. El header **sí** lo renderiza Vue, porque son un puñado
de nodos que se vuelven a diferenciar solo cuando cambia la configuración de columnas.

---

## Checklist previo a publicar

Instalar desde GitHub ya funciona. Todo lo que sigue es lo que falta antes de empujar a **npm**.

Ya hecho, nada que tocar:

- [x] **Nombre** `datagrid-vue`, **versión** `0.1.0`, **descripción** y **keywords**.
- [x] **Licencia** MIT, declarada en `package.json` y presente como archivo `LICENSE`.
- [x] **Autor** `jorge-koki`; **`repository`**, **`homepage`** y **`bugs`** apuntan todos a
      `jorge-koki/datagrid-vue`.
- [x] **`private`** eliminado, así `npm publish` va a funcionar.
- [x] Script **`prepare`**, para que `npm install github:jorge-koki/datagrid-vue` construya `dist/` al
      instalar, sin versionar la salida del build.

Todavía pendiente:

- [ ] **Verificar que el nombre esté libre en npm** — `npm view datagrid-vue`. Si está tomado, hay que
      publicar bajo un scope (`@jorge-koki/datagrid-vue`) y actualizar cada import de este README.
- [ ] **Decidir el rango de Vue.** `peerDependencies.vue` es `^3.5.0 || >=3.6.0-0`, que admite las
      release candidates de 3.6 porque es contra lo que este repositorio desarrolla. Conviene
      angostarlo a `^3.5.0` si no se quiere prometer soporte para prereleases.
- [ ] **Saber qué cuesta `prepare`.** También corre en cada `npm install` local de este repositorio, y
      una falla del build hace fallar la instalación. La alternativa es versionar `dist/` y sacar el
      script.
- [ ] **Agregar un CHANGELOG** si se planea publicar más de una versión.

Publicar a npm no necesita ningún paso extra: `npm publish` corre `prepare`, que construye `dist/`, y
`files: ["dist"]` deja todo lo demás afuera del tarball.

---

## Referencia: qué exporta el paquete

| Export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Tipo                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `DataTable` (también el export por defecto), `DataTableColumnToggle`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Componentes                                                      |
| `COLOR_TOKENS`, `ColorTokenName`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Mapa de la paleta de estados y el tipo de su clave               |
| `registerRenderer`, `resolveRenderer`, `createTextRenderer`, `TEXT_RENDERER_TYPE`                                                                                                                                                                                                                                                                                                                                                                                                                                     | Registro de renderers                                            |
| `textRenderer`, `numberRenderer`, `badgeRenderer`, `selectRenderer`, `progressRenderer`, `avatarRenderer`, `checkboxRenderer`, `tagsRenderer`                                                                                                                                                                                                                                                                                                                                                                         | Instancias de los renderers incluidos, para componer sobre ellas |
| `createLocalStorageAdapter`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | El adapter de almacenamiento por defecto                         |
| `DataTableProps`, `DataTableColumn`, `DataTableInstance`, `DataTableTheme`, `CellValue`, `CellAlign`, `CellOption`, `CellEditorType`, `CellPosition`, `CellRenderer`, `CellRenderContext`, `CellRendererHandle`, `AnyCellRenderer`, `CellRendererFactory`, `SelectionMode`, `CellSelectEvent`, `BeforeEditEvent`, `AfterEditEvent`, `EditCommitEvent`, `ColumnResizeEvent`, `ColumnVisibilityState`, `ColumnWidthState`, `DataTablePersistOptions`, `DataTableStorageAdapter`, `PersistedTableState`, `VirtualWindow` | Tipos                                                            |
| `GroupByState`, `GroupRow`, `DataRow`, `FlatRow`, `GroupToggleEvent`, `BuiltInAggregation`, `AggregationFn`, `ColumnAggregation`                                                                                                                                                                                                                                                                                                                                                                                      | Tipos de la agrupación                                           |

Los composables y el pool de nodos **no** se exportan. Son detalles de implementación, y exportarlos
los convertiría en API que después habría que sostener para siempre.
