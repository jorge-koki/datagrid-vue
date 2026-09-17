# Contribuir

## Correr la demo

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
- Editar una fila marcada como **Bloqueado**: la edición se rechaza, y la bitácora muestra el ciclo
  entero a medida que ocurre.

## Qué hay acá adentro

**`src/` es la librería y nada más que la librería** —exactamente lo que se publica— y `demo/` es la
aplicación que la ejercita. La separación no es cosmética: la demo importa `vue-tablekit`, igual que
lo haría cualquier proyecto que instale el paquete, así que si algo no sale del `index.ts`, la demo
no compila.

| Ruta               | Qué es                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `src/`             | La librería. Autocontenida: solo imports relativos, y `vue` como única dependencia.                            |
| `src/composables/` | La ventana visible, el reciclado de elementos, el layout de columnas, la edición, la agrupación y el guardado. |
| `src/internal/`    | Lo que no es API pública: tipos de celda, agregaciones, escrituras al documento y portapapeles.                |
| `src/styles/`      | `datatable.css`: la hoja única, con todos los tokens `--dt-*`.                                                 |
| `src/__tests__/`   | Los tests. Viven al lado de lo que verifican y quedan fuera del paquete publicado.                             |
| `demo/`            | La aplicación de ejemplo y los tres paneles de su pantalla.                                                    |
| `dist/`            | Lo que se publica. Lo produce `npm run build:lib` y no se versiona.                                            |

## Scripts

| Script                     | Qué hace                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Servidor de desarrollo de la demo.                                                                  |
| `npm run build`            | Verificación de tipos + build de la demo en `dist-demo/`.                                           |
| `npm run build:demo:pages` | La demo con la ruta base de GitHub Pages. Es lo que corre el workflow de despliegue.                 |
| `npm run preview`          | Sirve la demo ya construida.                                                                        |
| `npm run build:lib`        | Construye la librería distribuible en `dist/`: bundle ESM, `style.css` extraído y archivos `.d.ts`. |
| `npm run type-check`       | `vue-tsc --build` sobre la librería, la demo y los tests. Tiene que salir con código 0.             |
| `npm test`                 | La suite completa con Vitest.                                                                       |
| `npm run format`           | `oxfmt` sobre `src/` y `demo/`.                                                                     |
| `npm run format:check`     | Lo mismo, sin escribir: falla si algo está sin formatear.                                           |
| `npm run verify`           | Tipos + tests + formato + build de la librería. Es lo mismo que corre CI, en un solo comando.       |

`npm run build` y `npm run build:lib` escriben en **directorios distintos** a propósito, para que el
build de la demo nunca pise lo que se publica. `build:lib` además corre solo al instalar desde
GitHub, que es lo que hace innecesario versionar `dist/`.

## Publicar una versión

1. Actualizar `version` en `package.json` y mover la sección **No publicado** del
   [changelog](./CHANGELOG.md) al número nuevo.
2. `npm run verify` — tipos, tests, formato y build de la librería.
3. `npm pack --dry-run` para leer el contenido exacto del paquete antes de mandarlo.
4. Etiquetar y empujar: `git tag v0.2.0 && git push --tags`.

El workflow [`release.yml`](./.github/workflows/release.yml) se dispara con el tag, verifica que el
tag y `package.json` digan lo mismo, vuelve a correr todo y publica. Necesita un secreto `NPM_TOKEN`
en el repositorio; sin él, el paso de publicación falla y hay que hacerlo a mano con `npm publish`.

**El README que se ve en npm es una foto del momento de publicar**, no se actualiza solo: corregir un
texto de la portada solo llega al registro con la versión siguiente. En GitHub, en cambio, se
actualiza con cada push.

**Despublicar no es una opción.** npm no reasigna un nombre despublicado ni siquiera a su dueño; es
exactamente lo que dejó inservible al nombre `datagrid-vue` desde 2019. Está contado en el
[checklist previo a publicar](./src/README.md#checklist-previo-a-publicar), junto con la otra regla
con la que nos chocamos: npm rechaza nombres que, sin guiones, coincidan con uno que ya existe.

## Configuración del editor

[VS Code](https://code.visualstudio.com/) +
[Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar), con Vetur
deshabilitado. TypeScript no puede tipar los imports de `.vue` por su cuenta, y esa es la razón de
que `vue-tsc` reemplace a `tsc` para verificar tipos.
