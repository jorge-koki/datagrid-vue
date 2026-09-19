# vue-tablekit

Una tabla de datos para Vue 3 que se maneja como una planilla de cálculo y aguanta cien mil filas sin
ponerse lenta. Sin dependencias: solo Vue.

**→ [Probala en vivo](https://jorge-koki.github.io/vue-tablekit/)**

```sh
npm install vue-tablekit
```

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DataTable } from 'vue-tablekit'
import type { DataTableColumn } from 'vue-tablekit'
import 'vue-tablekit/style.css'

type Empleado = { id: number; nombre: string; area: string }

const filas = shallowRef<Empleado[]>(traerEmpleados())

const columnas: DataTableColumn<Empleado>[] = [
  { key: 'nombre', label: 'Nombre', width: 220 },
  { key: 'area', label: 'Área', width: 140, renderer: 'badge' },
]
</script>

<template>
  <!-- La tabla ocupa el alto de su contenedor, así que dáselo. -->
  <div style="height: 600px">
    <DataTable :rows="filas" :columns="columnas" row-key="id" />
  </div>
</template>
```

## Qué sabe hacer

- Navegación por teclado completa y **selección de bloques** que se copian con `Ctrl`+`C` y se pegan
  en Excel.
- **Edición en línea** cancelable. La tabla nunca escribe en tus datos.
- **Ordenamiento** por una o varias columnas. La tabla lleva el estado y vos ordenás —o le preguntás
  al servidor—, que es lo que hace que funcione igual con mil filas que con un millón.
- **Agrupación multinivel** con totales, promedios, conteos, mínimos y máximos.
- **Columnas anclables, redimensionables, ocultables y reordenables**, con el layout guardado y un
  menú propio en cada encabezado si lo querés.
- **Alturas de fila distintas**, decididas por vos fila por fila.
- **Datos del servidor**: pide los tramos que le faltan mientras scrolleás.
- **Ocho tipos de celda**, temas claro / oscuro, y el color principal en una línea:
  `.dt-root { --dt-primary: #8b5cf6 }`.

## Documentación

**→ [Documentación completa](./src/README.md)** — props, eventos, renderers, agrupación, temas,
persistencia, datos del servidor y limitaciones.

[Changelog](./CHANGELOG.md) · [Cómo contribuir](./CONTRIBUTING.md)

## Licencia

MIT © jorge-koki — ver [LICENSE](./LICENSE).
