# datagrid-vue

A virtualized Vue 3 DataTable that holds 60fps at 100,000 rows, plus the demo application that proves
it.

The idea in one sentence: **Vue owns structure and configuration, a plain-TypeScript pool of recycled
DOM nodes owns the scroll hot path.** Body cells are not vnodes, so a scroll frame costs a handful of
property writes instead of ~450 vnode diffs — and `rows` is never made deeply reactive, so 100k rows
cost zero proxies.

**→ [Component documentation](./src/components/ui/datatable/README.md)** — props, events, renderers,
theming, persistence, performance, limitations.

## Quick path

```sh
npm install
npm run dev      # demo at http://localhost:5173
```

The demo opens with **100 rows** so it reads as a usage example. Use the row-count selector to jump to
1,000 / 10,000 / 50,000 and watch the FPS and "nodes in DOM" counters: the dataset grows by 500×, the
node count does not move.

## What's in here

| Path                            | What it is                                                                |
| ------------------------------- | ------------------------------------------------------------------------- |
| `src/components/ui/datatable/`  | The component. Self-contained — relative imports only, `vue` is its sole runtime dependency. |
| `src/demo/`                     | The demo's seeded data generator, column definitions, stats and event log. |
| `src/App.vue`                   | The demo page. Read this first if you want a working usage example.        |

## Scripts

| Script                | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------- |
| `npm run dev`         | Dev server for the demo.                                                  |
| `npm run build`       | Type-check + build the demo into `dist-demo/`.                            |
| `npm run preview`     | Serve the built demo.                                                     |
| `npm run build:lib`   | Build the distributable library into `dist/` — ESM bundle, extracted `style.css`, and `.d.ts` files. |
| `npm run type-check`  | `vue-tsc --build`. Must exit 0.                                           |
| `npm run format`      | `oxfmt` over `src/`.                                                      |

`npm run build` and `npm run build:lib` write to **different directories** on purpose, so the demo
build never clobbers the published artifact.

## Using the component in another project

Two paths, both documented in full in the
[component README](./src/components/ui/datatable/README.md#install):

- **Copy the directory** (shadcn style) — drop `src/components/ui/datatable/` into your project. No
  stylesheet import needed; the SFC imports its own CSS.
- **Install the package from GitHub** — `npm install github:<your-user>/<your-repo>`, then
  `import 'datagrid-vue/style.css'` alongside the component. Vue stays a peer dependency and is
  never bundled.

## Before you publish this

The package metadata is still generic. See the
[pre-publish checklist](./src/components/ui/datatable/README.md#pre-publish-checklist): package name,
repository, author, description, version, **license (there is no LICENSE file yet)**, and how `dist/`
should reach consumers on a GitHub install.

## IDE setup

[VS Code](https://code.visualstudio.com/) +
[Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar), with Vetur disabled.
TypeScript cannot type `.vue` imports on its own, which is why `vue-tsc` replaces `tsc` for type
checking and the editor needs the Vue extension to make the language service aware of `.vue` types.

Browser devtools: the [Vue DevTools](https://devtools.vuejs.org/) extension, and Chrome's
[Custom Object Formatters](http://bit.ly/object-formatters) so refs print readably.
