# datagrid-vue

A virtualized Vue 3 data grid that holds 60fps at 100,000 rows, plus the demo application that proves
it.

The idea in one sentence: **Vue owns structure and configuration, a plain-TypeScript pool of recycled
DOM nodes owns the scroll hot path.** Body cells are not vnodes, so a scroll frame costs a handful of
property writes instead of ~450 vnode diffs — and `rows` is never made deeply reactive, so 100k rows
cost zero proxies.

```sh
npm install github:jorge-koki/datagrid-vue
```

**→ [Component documentation](./src/components/ui/datatable/README.md)** — props, events, selection,
renderers, theming, persistence, performance, limitations.

## Features

- **Virtualized on both axes.** Rows and columns. Window math is O(1) — one division per frame,
  independent of how many rows you have.
- **Recycled DOM node pool.** Nodes are reused by viewport slot and written only where a value
  actually changed. A repaint with identical inputs performs zero DOM writes.
- **Cell and row selection** with full keyboard navigation: arrows, `Tab`, `Home` / `End`,
  `Ctrl`+`Home` / `End`, `PageUp` / `PageDown`, and minimal auto-scroll.
- **Inline editing** with a cancelable `beforeEdit` → `editCommit` → `afterEdit` lifecycle. The grid
  is controlled: it never mutates your rows.
- **Eight built-in cell renderers** — text, number, badge, select, progress, avatar, checkbox, tags —
  plus a documented protocol and a registry for your own.
- **Resizable, hideable, reorderable columns**, with layout persistence that reconciles saved state
  against the columns that exist today.
- **Themeable through `--dt-*` custom properties**, light / dark / auto, with a `dense` preset. Picks
  up NuxtUI v3 tokens automatically when the host app defines them.
- **ARIA grid roles** and row / column indices on the recycled nodes.
- **No runtime dependencies** beyond `vue`, which stays a peer dependency and is never bundled.

## Run the demo

```sh
npm install
npm run dev      # http://localhost:5173
```

The demo opens with **100 rows** so it reads as a usage example. From there:

- Use the row-count selector to jump to 1,000 / 10,000 / 50,000 and watch the FPS and "nodes in DOM"
  counters — the dataset grows by 500×, the node count does not move.
- Click a cell and navigate with the arrow keys; the active cell is shown in the stats panel.
- Double-click (or press `Enter`, or just start typing) to edit. Rows marked **Locked** are vetoed
  from `beforeEdit`, and the event log shows the whole lifecycle as it happens.

## What's in here

| Path                           | What it is                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/components/ui/datatable/` | The component. Self-contained — relative imports only, `vue` is its sole runtime dependency. |
| `src/demo/`                    | The demo's seeded data generator, column definitions, stats and event log.                   |
| `src/App.vue`                  | The demo page. Read this first if you want a working usage example.                          |

## Scripts

| Script               | What it does                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run dev`        | Dev server for the demo.                                                                            |
| `npm run build`      | Type-check + build the demo into `dist-demo/`.                                                      |
| `npm run preview`    | Serve the built demo.                                                                               |
| `npm run build:lib`  | Build the distributable library into `dist/` — ESM bundle, extracted `style.css`, and `.d.ts` files. |
| `npm run type-check` | `vue-tsc --build`. Must exit 0.                                                                     |
| `npm run format`     | `oxfmt` over `src/`.                                                                                |

`npm run build` and `npm run build:lib` write to **different directories** on purpose, so the demo
build never clobbers the published artifact. `build:lib` also runs automatically as `prepare`, which
is what makes `npm install github:jorge-koki/datagrid-vue` work without committing `dist/`.

## Using the component in another project

Two paths, both documented in full in the
[component README](./src/components/ui/datatable/README.md#install):

- **Copy the directory** (shadcn style) — drop `src/components/ui/datatable/` into your project. No
  stylesheet import needed; the SFC imports its own CSS.
- **Install the package** — `npm install github:jorge-koki/datagrid-vue`, then:

  ```ts
  import { DataTable, DataTableColumnToggle } from 'datagrid-vue'
  import 'datagrid-vue/style.css'
  ```

## Before publishing to npm

Installing from GitHub already works, and name, license, author and repository are all set. What is
left is in the [pre-publish checklist](./src/components/ui/datatable/README.md#pre-publish-checklist).

## IDE setup

[VS Code](https://code.visualstudio.com/) +
[Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar), with Vetur disabled.
TypeScript cannot type `.vue` imports on its own, which is why `vue-tsc` replaces `tsc` for type
checking and the editor needs the Vue extension to make the language service aware of `.vue` types.

Browser devtools: the [Vue DevTools](https://devtools.vuejs.org/) extension, and Chrome's
[Custom Object Formatters](http://bit.ly/object-formatters) so refs print readably.

## License

MIT © jorge-koki — see [LICENSE](./LICENSE).
