# DataTable

A virtualized Vue 3 table that stays at 60fps with 100,000 rows, because the scroll hot path never
touches the virtual DOM.

Vue owns what changes rarely and benefits from being declarative: props, the header, the cell editor,
the lifecycle. A plain-TypeScript pool of recycled DOM nodes owns what changes every frame: the body
cells. Those cells are **not vnodes**. With ~30 visible rows by ~15 visible columns, a `v-for` body
would cost ~450 vnode diffs per scroll frame and blow the 16ms budget before painting anything. The
pool writes only the properties that actually changed, so a repaint with identical inputs performs
zero DOM writes.

The second half of the thesis is memory. `props` in Vue is `shallowReactive`, so `props.rows` hands
back your original array — no row is ever wrapped in a Proxy. A deep `ref()` over 100k rows would
create 100k proxies and charge you for them even when nobody scrolls.

---

## Quick path

1. Get the code — copy `src/components/ui/datatable/` into your project, or install the package
   (both paths in [Install](#install)).
2. Import the component and, if you installed the package, the stylesheet.
3. Pass `rows`, `columns` and `rowKey`. Give the wrapper a height.

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

The component fills its container; it has no height of its own. Wrap it in something with a height or
you will see an empty box.

That is already a working grid: cell selection and full keyboard navigation are on by default
(`selectionMode: 'cell'`). Click the table and use the arrow keys. Turn it off with
`selection-mode="none"`.

> **Use `shallowRef` for `rows`, not `ref`.** A deep `ref` wraps every row in a reactive Proxy. The
> table never needs per-row reactivity — only to know that the array was replaced.

---

## Install

### Path A — copy the directory (shadcn style)

Copy `src/components/ui/datatable/` anywhere in your project. The directory is self-contained: every
import inside it is relative, and its only runtime dependency is `vue`. No build aliases, no shared
utilities from this repo.

```ts
import { DataTable, DataTableColumnToggle } from '@/components/ui/datatable'
import type { DataTableColumn } from '@/components/ui/datatable'
```

No stylesheet import needed on this path — `DataTable.vue` imports `./styles/datatable.css` itself
and your bundler deduplicates it.

### Path B — install the package from GitHub

```sh
npm install github:jorge-koki/datagrid-vue
```

```ts
import { DataTable, DataTableColumnToggle } from 'datagrid-vue'
import type { DataTableColumn } from 'datagrid-vue'
import 'datagrid-vue/style.css' // required on this path
```

On this path the CSS is **extracted to a separate file**, never injected into the JS. Injected CSS
breaks SSR (the bundle would touch `document` on import) and takes away your ability to redefine the
`--dt-*` tokens before mount. That is why the explicit stylesheet import exists.

The package ships ESM only, with `vue` as a peer dependency — it is never bundled. Two copies of Vue
in one application break reactivity in ways that are close to undebuggable: effects register on one
runtime and fire from the other.

`dist/` is not committed, so the package builds itself at install time through the `prepare` script
that npm runs for git dependencies. Nothing extra to do on your side; it just means the install takes
a couple of seconds longer than a registry install would.

**If your project does not already declare `*.css` modules for TypeScript**, add a
`declare module '*.css';` to a `.d.ts`. The emitted `DataTable.vue.d.ts` carries the SFC's
side-effect CSS import. Vite projects already have this through `vite/client`; so do Nuxt and most
webpack + TS setups.

---

## Quick start

A complete, runnable example with editing wired up:

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

// Veto: a paid invoice is read-only.
function onBeforeEdit(event: BeforeEditEvent<Invoice>): void {
  if (event.row.status === 'paid') event.cancel()
}

// The table is controlled: it never writes to `rows`. This handler owns the write.
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

> **`TRow` must be a `type`, not an `interface`.** The component is declared as
> `generic="TRow extends Record<string, unknown>"`, and in TypeScript only type aliases get an
> implicit index signature. `interface Invoice { … }` will not satisfy the constraint.

---

## Props

`rows`, `columns` and `rowKey` are required. Everything else has a default.

| Prop                 | Type                                                             | Default                  | Description                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rows`               | `readonly TRow[]`                                                | —                        | The full dataset. Never sliced, copied or made deeply reactive. The table only indexes inside the visible window.                                   |
| `columns`            | `readonly DataTableColumn<TRow>[]`                               | —                        | Column definitions, in declaration order. See [Columns](#columns).                                                                                  |
| `rowKey`             | `keyof TRow \| ((row: TRow, index: number) => string \| number)` | —                        | Row identity. Stamped as `data-row-key` so the DOM stays inspectable and testable. It never affects recycling — the pool recycles by viewport slot. |
| `rowHeight`          | `number`                                                         | `40` / `30` when `dense` | Row height in px. A number, not a CSS value: the virtualizer divides by it every frame. Mirrored into `--dt-row-height`.                            |
| `headerHeight`       | `number`                                                         | `44` / `34` when `dense` | Header height in px. Mirrored into `--dt-header-height`.                                                                                            |
| `dense`              | `boolean`                                                        | `false`                  | Compact preset: shorter rows, smaller type, tighter padding.                                                                                        |
| `overscan`           | `number`                                                         | `4`                      | Extra rows and columns painted outside the visible window. Higher costs paint time, hides blank edges during fast scrolling.                        |
| `defaultColumnWidth` | `number`                                                         | `150`                    | Width in px for columns that do not declare their own.                                                                                              |
| `virtualizeColumns`  | `boolean`                                                        | `true`                   | Paint only horizontally visible columns. Turn it off for narrow tables where the whole row fits — there the window math is pure overhead.           |
| `theme`              | `'light' \| 'dark' \| 'auto'`                                    | `'auto'`                 | Color scheme. See [Theming](#theming).                                                                                                              |
| `emptyText`          | `string`                                                         | `'No data'`              | Message shown when `rows` is empty.                                                                                                                 |
| `stripe`             | `boolean`                                                        | `false`                  | Alternate background on odd rows.                                                                                                                   |
| `bordered`           | `boolean`                                                        | `false`                  | Draw cell separators.                                                                                                                               |
| `columnVisibility`   | `Readonly<Record<string, boolean>>`                              | _uncontrolled_           | `v-model:column-visibility`. A missing key resolves to `column.defaultVisible ?? true`.                                                             |
| `columnOrder`        | `readonly string[]`                                              | _uncontrolled_           | `v-model:column-order`. Reconciled against the current columns before it is applied.                                                                |
| `columnWidths`       | `Readonly<Record<string, number>>`                               | _uncontrolled_           | `v-model:column-widths`. Overrides `column.width`, always clamped by `minWidth` / `maxWidth`.                                                       |
| `tableId`            | `string`                                                         | —                        | Unique id for this table in your application. Required for persistence — it is what separates one table's layout from another's.                    |
| `persist`            | `boolean \| DataTablePersistOptions`                             | `false`                  | Persist layout across sessions. `true` means `localStorage` with defaults. See [Persistence](#column-visibility-order-and-persistence).             |
| `selectionMode`      | `'none' \| 'cell' \| 'row'`                                      | `'cell'`                 | What a click and the keyboard select. See [Selection](#selection-and-keyboard-navigation).                                                          |
| `activeCell`         | `CellPosition \| null`                                           | _uncontrolled_           | `v-model:active-cell`. The currently selected cell. `null` means "controlled, nothing selected".                                                    |

### Controlled vs uncontrolled

`columnVisibility`, `columnOrder`, `columnWidths` and `activeCell` each work two ways, and the
component serves both without branching internally:

- **Uncontrolled** (prop is `undefined`): the state lives in an internal ref and the table manages
  itself. This is the mode persistence uses.
- **Controlled** (prop has a value): the prop is the truth. The component does **not** write the
  internal ref, it only emits `update:*`, and you decide. If you ignore the event, nothing changes —
  normal `v-model` semantics.

The `update:*` event fires either way, so you can observe changes without taking ownership.

> **`activeCell` distinguishes `undefined` from `null`.** `undefined` means uncontrolled; `null`
> means controlled with nothing selected. If the check were on falsiness instead, a parent that
> cleared the selection would silently hand control back to the component.

---

## Events

| Event                     | Payload                             | When                                                                                    |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `beforeEdit`              | `BeforeEditEvent<TRow>`             | Before a cell editor opens. **Cancelable.**                                             |
| `editCommit`              | `EditCommitEvent<TRow>`             | An edit produced a value the parent should persist. Only when the value really changed. |
| `afterEdit`               | `AfterEditEvent<TRow>`              | An edit session ended, committed or not. Exactly once per opened editor.                |
| `columnResize`            | `ColumnResizeEvent`                 | A resize drag ended with a different width. A click without a drag is not a resize.     |
| `rowClick`                | `{ row: TRow; rowIndex: number }`   | Click anywhere on a painted row.                                                        |
| `cellSelect`              | `CellSelectEvent<TRow>`             | The active cell moved to a real cell. Carries the row, column and resolved value.       |
| `update:activeCell`       | `CellPosition \| null`              | The active cell changed, including to `null`. Fires before `cellSelect`.                |
| `update:columnVisibility` | `Readonly<Record<string, boolean>>` | Visibility changed (UI, persistence load, or `resetLayout`).                            |
| `update:columnOrder`      | `string[]`                          | Order changed.                                                                          |
| `update:columnWidths`     | `Readonly<Record<string, number>>`  | Widths changed, including during a resize drag.                                         |

### The edit lifecycle

```
double-click / Enter / F2 / checkbox click
        │
        ▼
   beforeEdit  ──── event.cancel() ────► nothing else fires. No editor, no afterEdit.
        │
        ▼
   editor opens (or the checkbox value is applied directly)
        │
        ├── Enter / blur / select change / row scrolled out of view ──► commit
        └── Escape ────────────────────────────────────────────────► discard
        │
        ▼
   editCommit   (only if newValue differs from oldValue)
        │
        ▼
   afterEdit    (always; `canceled: true` when discarded with Escape)
```

**How to cancel.** Call `event.cancel()` synchronously inside your `beforeEdit` listener. It is safe
to call more than once, and `event.canceled` reflects it. This is the hook for permission checks,
per-row locks and "this column is read-only right now".

```ts
function onBeforeEdit(event: BeforeEditEvent<Invoice>): void {
  if (event.row.locked) {
    event.cancel()
  }
}
```

There is no async escape hatch — the emit is synchronous and the decision has to be back before the
listener returns. Anything that needs a round trip should gate on data you already have in the row.

**`editCommit` is the only event that asks you to write.** The table is controlled and never mutates
`rows`. If you ignore `editCommit`, the cell shows its previous value on the next paint — which is
the correct behavior for a controlled component, not a bug.

The new value is coerced back to the primitive type of the old value where that is unambiguous, so
editing a numeric column hands you a `number`, not a `string`. A `<select>` hands back the typed
`option.value`, so a parent that stored `1` does not get `"1"`.

**What opens and closes an editor**

A single click does **not** open the editor — it selects. The full key map lives in
[Selection and keyboard navigation](#selection-and-keyboard-navigation); this table is only the part
that touches editing.

| Input                                           | Effect                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Double-click a cell                             | Open the editor                                                                |
| `Enter` or `F2` on the active cell              | Open the editor; on a checkbox column, toggle the value instead                |
| Type a printable character on the active cell   | Open the editor seeded with that character (not for `select` / `date`)         |
| `Enter` in the editor                           | Commit, then move the selection one row down                                   |
| `Escape` in the editor                          | Discard (still emits `afterEdit` with `canceled: true`) and keep the selection |
| Blur the editor                                 | Commit                                                                         |
| Change a `<select>` editor                      | Commit immediately                                                             |
| Scroll the edited row out of the virtual window | Commit and close — the node backing that cell has been recycled                |

While an editor is open the grid's own key handler stands down completely: arrows, `Home`, `PageUp`
and the rest belong to the control. `Enter` and `Escape` stop propagating, so closing the editor
cannot immediately reopen it.

---

## Selection and keyboard navigation

The model is a spreadsheet's: **one click selects, two clicks edit.** Selecting to read a value or to
start navigating is far more common than editing, and requiring a double-click for it would cost an
extra gesture in the common case.

Selection is a `CellPosition` (`{ rowIndex, columnKey }`) held by the component, not DOM focus. That
matters here more than in an ordinary table: pool nodes are recycled as you scroll, so the focused
element is not a reliable place to store "where the user is standing". The active position survives
any repaint.

### `selectionMode`

| Value    | Behavior                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'cell'` | Default. The active **cell** gets `.dt-cell--active` and `aria-selected`; its row also gets `.dt-row--active`.                                                                            |
| `'row'`  | The active **row** is the selected unit: it gets the ring and `aria-selected`; the cell gets neither. The active cell is still tracked, so arrow keys still know which column you are in. |
| `'none'` | No pointer selection, no key handler registered at all, and the viewport is not focusable (`tabindex="-1"`).                                                                              |

`'none'` is not an early return inside a handler — the listener object is empty, so Vue registers
nothing. The exposed `selectCell()` still writes the state if you call it, so a programmatic
selection remains possible; only the user-facing input paths are gone.

### Keys

All of these act on the active cell and require the viewport to have focus.

| Key                     | Effect                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `↑` `↓` `←` `→`         | Move one cell. **Clamps at the edges — it does not wrap.**                                |
| `Tab` / `Shift`+`Tab`   | Move one cell in reading order. **Wraps to the next / previous row** at the end of a row. |
| `Home`                  | First column of the current row                                                           |
| `End`                   | Last column of the current row                                                            |
| `Ctrl`/`Cmd`+`Home`     | First cell of the table                                                                   |
| `Ctrl`/`Cmd`+`End`      | Last cell of the table                                                                    |
| `PageUp` / `PageDown`   | Up or down by one viewport's worth of whole rows (minimum 1)                              |
| `Enter` / `F2`          | Edit the active cell (toggles it, on a checkbox column)                                   |
| Any printable character | Edit the active cell, seeded with that character                                          |
| `Escape`                | With an editor open: discard. With no editor open: **nothing** — the selection is kept.   |

Two deliberate asymmetries:

- **Arrows clamp, `Tab` wraps.** Arrows are spatial — running off the right edge and reappearing on
  the next row is disorienting. `Tab` is sequential, which is what it means in a form and in a
  spreadsheet, and it is what lets you walk the whole grid without leaving the keyboard.
- **`Escape` with no editor open keeps the selection.** Losing track of where you were standing is
  more annoying than staying selected.

**Typing to edit** ignores modifier combinations so it cannot hijack browser shortcuts: the key must
be exactly one character long, with no `Ctrl`, `Cmd` or `Alt`. `Shift` is allowed, since it only
changes which character you get. The seeded character is **not** selected in the input, so what you
type next appends instead of replacing. `select` and `date` editors ignore the seed and open on the
current value — there is no sensible way to seed a dropdown or a date picker with one keystroke.

**Hidden columns are skipped.** Navigation walks the _resolved_ columns, which already exclude
hidden ones and respect the current order. An arrow key never parks on a column you cannot see.

### Auto-scroll

Keyboard navigation scrolls **the minimum necessary** to bring the target cell into view — it does
not center it. Centering moves the viewport even when the cell was already visible, which turns every
arrow keypress into a jump. With a minimal adjustment, moving inside the window scrolls nothing and
reaching an edge advances exactly one row or one column.

### Wiring it up

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

`update:activeCell` fires on every change, including to `null`. `cellSelect` fires only when the new
position resolves to a real row and a visible column, and it carries the row, the column definition
and the value already read through the column's `accessor` — so a details panel does not have to look
anything up.

Neither event fires when the selection is set to the cell that is already active.

### How selection interacts with editing

- Selecting never opens an editor, and opening an editor never moves the selection.
- The editor still goes through `beforeEdit`, so a veto stops it and leaves the cell selected.
- `Enter` inside the editor commits **and moves the selection one row down**, spreadsheet style. The
  move happens whether or not the parent persists the value — it is navigation, not editing.
- Scrolling the edited row out of the virtual window commits and closes the editor; the selection
  stays on that cell.

### Accessibility

The scrolling viewport is the grid. Roles and indices are written once per node where they are
structural, and only when they change where they are not — `aria-rowindex` lives on the row rather
than on each cell, which is the same information for a screen reader at a fifteenth of the writes.

| Element        | Attributes                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dt-viewport` | `role="grid"`, `aria-rowcount` (data rows **+ 1** for the header), `aria-colcount` (visible columns), `tabindex="0"` unless `selectionMode` is `'none'`        |
| `.dt-row`      | `role="row"`, `aria-rowindex` (1-based, and offset by the header row: data row `0` reports `2`), `aria-selected` in `'row'` mode                               |
| `.dt-cell`     | `role="gridcell"`, `aria-colindex` (1-based over the **visible** columns, so a hidden column takes no slot), `aria-selected` in `'cell'` mode, `tabindex="-1"` |

Cells carry `tabindex="-1"` so they are focusable by script and click without entering the tab order
— with ~450 visible cells, joining the tab order would make the table impossible to tab past.

> **Known gap.** The header is rendered outside the `role="grid"` element and carries no
> `role="row"` / `role="columnheader"`. `aria-rowcount` and `aria-rowindex` both count a header row
> that assistive technology cannot find inside the grid. Column names are therefore not announced
> with the cells. Fixing it means moving the header inside the grid or wiring `aria-describedby` per
> column; until then, treat the header as visual-only.

---

## Exposed methods

Reach for these through a template ref when the declarative props are not enough.

```ts
const table = useTemplateRef<DataTableInstance>('table')
```

| Method                | Description                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `scrollToRow(index)`  | Scroll until `index` is the first fully visible row. Clamped to the dataset.                                    |
| `scrollToColumn(key)` | Scroll until that column sits at the left edge. No-op for an unknown key.                                       |
| `scrollToCell(pos)`   | Scroll the minimum needed to bring that cell into view. Does not center, does not move the selection.           |
| `selectCell(pos)`     | Set the active cell, or clear it with `null`. **Also scrolls it into view**, unlike an internal selection.      |
| `refresh()`           | Invalidate every cached cell value **and schedule a repaint on the next frame**.                                |
| `resetLayout()`       | Drop the stored layout and return visibility, order and widths to their defaults. This is your "reset columns". |
| `flushPersistence()`  | Write the debounced layout immediately. Unmount already flushes on its own.                                     |

`selectCell` scrolls and the internal click/keyboard path does not need to, because code calling it —
a search result, a deep link — has no way of knowing whether that cell was inside the window. It
emits `update:activeCell` and `cellSelect` exactly like a click would.

**When you actually need `refresh()`.** The paint cache is keyed by the raw cell value, so a changed
value repaints itself — _on the next frame that gets scheduled_. Frames are scheduled by scrolling,
resizing, and by changes to `rows`, `columns`, `stripe`, `virtualizeColumns`, row height, the
resolved columns, the selection mode, the active cell, or the editing cell. Two consequences:

- If you mutate a row object **in place** and nothing else changes, no frame is scheduled and the
  screen does not update. Call `refresh()`, or replace the array (the controlled pattern).
- If `format` or `cellClass` start returning something different **without their arguments
  changing** — because they close over a locale, an exchange rate, a selection set — the cache is
  right about its inputs and wrong about its output. `refresh()` is how you tell it.

---

## Columns

A column is configuration, not state. It is read on every paint, which puts `format` and `cellClass`
directly on the scroll hot path.

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
}
```

| Field                   | Default                                      | Notes                                                                                                       |
| ----------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `key`                   | —                                            | Unique id, and the default data key (`row[key]`).                                                           |
| `label`                 | `key`                                        | Header text.                                                                                                |
| `width`                 | `defaultColumnWidth` (150)                   | Always clamped to `[max(32, minWidth), min(4000, maxWidth)]`.                                               |
| `minWidth` / `maxWidth` | `32` / `4000`                                | Applied when resolving the width and while resizing.                                                        |
| `resizable`             | `false`                                      | Shows a drag handle on the header edge.                                                                     |
| `align`                 | the renderer's `defaultAlign`, else `'left'` | An explicit `align` always wins. Applied as a class, not an inline style.                                   |
| `editable`              | `false`                                      | Must be exactly `true` for a cell to be editable.                                                           |
| `format`                | —                                            | Raw value → the string written to the cell. **Must be pure and cheap.**                                     |
| `cellClass`             | —                                            | Extra CSS class on the cell element. Also on the hot path.                                                  |
| `accessor`              | `row[key]`                                   | Reads the value from the row. Returns `CellValue` — it cannot return an object or an array.                 |
| `renderer`              | `'text'`                                     | A registered renderer name, or an implementation. Unknown names fall back to `'text'` rather than throwing. |
| `hideable`              | `true`                                       | `false` pins the column out of `DataTableColumnToggle`.                                                     |
| `defaultVisible`        | `true`                                       | Initial visibility. Persistence and the v-model both outrank it.                                            |
| `editor`                | inferred (see below)                         | The control that opens on edit.                                                                             |
| `options`               | —                                            | Feeds the `badge` / `select` / `tags` renderers **and** the `select` editor. One source of truth.           |
| `min`/`max`/`step`      | —                                            | Forwarded to the `number` editor's input attributes.                                                        |

### `renderer` and `editor` are two independent axes

How a cell **looks** and how it is **edited** are separate decisions. A badge can be read-only, and a
plain text cell can open a dropdown. Coupling them would force a renderer per combination.

```ts
// Looks like a flat badge (no chevron), but edits through a dropdown.
{ key: 'priority', renderer: 'badge', editor: 'select', editable: true, options: PRIORITIES }

// Looks like a dropdown (badge + chevron) but is not editable at all.
{ key: 'status', renderer: 'select', options: STATUSES }
```

### Editor inference

When `column.editor` is absent, the type is inferred from the **current cell value**, in this order:

| #   | Condition                     | Editor     |
| --- | ----------------------------- | ---------- |
| 1   | `column.editor` is set        | that one   |
| 2   | value is a `boolean`          | `checkbox` |
| 3   | value is a `number`           | `number`   |
| 4   | value is a `Date`             | `date`     |
| 5   | `column.options` is non-empty | `select`   |
| 6   | otherwise                     | `text`     |

Value type beats `options` deliberately: a boolean column with two options is still a checkbox, not a
two-item dropdown. And `options` beats the text fallback because a declared list is an explicit
intent to constrain the possible values.

The `checkbox` editor has no floating control — the checkbox lives in the cell. Clicking it is an
_intent_: the pool reverts the visual state immediately and sends the change through the same
`beforeEdit` → `editCommit` → `afterEdit` pipeline, so a veto cannot be bypassed through it.

The `date` editor round-trips in UTC on both sides. Mixing local time and UTC is the classic source
of the "date shifted by one day" bug.

---

## Renderers

A renderer is a **stateless strategy**: `create` builds a cell's internal structure once, `update`
mutates it on every repaint. One shared instance per name serves every cell.

Eight are registered out of the box. Set one with `renderer: '<name>'`.

### `text` — the default

Writes the value as plain text. Uses `column.format` when present, otherwise the built-in
representation: `Date` → ISO string, everything else → `String(value)`.

Objects and arrays arrive already stringified (the value path narrows to `CellValue`), so they show
as `[object Object]`. That is deliberate: a blank cell would hide the problem, this one points at a
column that needs an `accessor` or a `format`.

### `number` — right-aligned, thousands separators

Accepts a `number`; a numeric string is parsed. `null`, `undefined` and `NaN` render as an **empty
string**, not `"NaN"` — in a money column `NaN` reads as corrupted data. `defaultAlign: 'right'`, so
the header aligns with the cells without asking.

The `Intl.NumberFormat` is built once at module scope. Building one inside `update` would mean one
instance per cell per frame.

### `badge` — a colored pill

Resolves the value against `column.options`, first by identity then by string form (a backend may
return `"1"` where the options declare `1`). Unknown values render the **raw value with the neutral
color** — never a blank cell; a state the UI does not know about is still data the user needs. With
no `options` at all it behaves as a neutral badge showing the value.

Color is written as one custom property, `--dt-badge-color`; the stylesheet derives the tinted
background from it.

### `select` — badge plus a chevron

Same value handling as `badge`, plus a chevron that signals "this opens". It does **not** open
anything by itself — the dropdown is the `select` _editor_. The chevron SVG is built once in `create`
and never touched again.

### `progress` — an SVG ring with a percentage

Accepts `0`–`100`; a numeric string is parsed. Out-of-range values are clamped. `null`, `undefined`
and `NaN` are treated as `0` — an empty ring reads as "no progress", a blank cell reads as broken.

The label is `column.format` when present, otherwise `` `${Math.round(percent)}%` ``. The ring color
comes from thresholds: `≥100` green, `≥60` blue, `≥30` amber, below that red.

### `avatar` — initials or a photo

Accepts a `string` name, or an object `{ name, src }` read from `ctx.raw`. With `src` it shows the
image; without it, up to two initials (first letter of the first and the last word). Anything else is
stringified and used as the name. An empty name leaves a neutral circle with no initials, which reads
as "unassigned".

Because it needs the object shape, **do not give this column an `accessor`** — an accessor returns
`CellValue`, which cannot express an object. Put `{ name, src }` on the row under `column.key`.

The color is a stable djb2 hash of the name against a fixed palette, not a counter or a row index.
That is the only way the same person keeps the same color across sessions and, above all, after the
pool recycles the node — a position-derived color would make avatars flicker while scrolling.

### `checkbox` — a real `<input type="checkbox">`

Accepts a `boolean`; anything else is read by truthiness. `null` / `undefined` produce the
**indeterminate** state, which is visually distinct from unchecked — "not answered yet" is not the
same as "answered no". The input is `disabled` unless the column is `editable`.

A native input is used so keyboard support, the accessibility role, the indeterminate state and
screen-reader announcements come in correct by default.

### `tags` — several pills from a list value

Reads an array from `ctx.raw`; each entry is resolved against `column.options` for its label and
color. A non-array value is treated as a single-item list, so a column can go from single to multiple
without changing renderer. Empty, `null` and `''` draw nothing — an empty list is a legitimate state.
Unknown entries show their raw text in the neutral color.

It is the only built-in that may create nodes in `update`, because the pill count depends on the
data. It applies the same discipline one level down: pills are pooled per cell, grow only past the
high-water mark, and surplus pills are hidden rather than removed.

### Writing a custom renderer

**The hard rule: `create` runs once per cell node, `update` runs every repaint and must only mutate
what `create` built.** Inside `update` you must not:

- create nodes,
- read layout (`getBoundingClientRect`, `offsetWidth`, `getComputedStyle`),
- write anything that did not change.

All three have the same root: `update` runs per visible cell per frame. Creating nodes makes garbage
the GC later charges you for as a dropped frame; reading layout forces a synchronous reflow in the
middle of painting; writing redundantly invalidates style for nothing.

Keep per-cell state in a `WeakMap` keyed by the handle, and cache the last value you wrote so a
redundant write is a real no-op.

**Per-column (simplest — `TRow` is concrete):**

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
    if (state.width === width) return // skip the redundant write
    state.width = width
    state.bar.style.width = width
  },

  destroy(handle: CellRendererHandle): void {
    barStates.delete(handle)
  },
}

const column: DataTableColumn<Invoice> = { key: 'total', renderer: barRenderer }
```

**Registered globally (usable by name from any table):**

```ts
import { registerRenderer } from 'datagrid-vue'
import type { CellRenderContext, CellRendererHandle } from 'datagrid-vue'

registerRenderer('bar', () => ({
  type: 'bar',
  defaultAlign: 'right',
  create(cell: HTMLElement): CellRendererHandle {
    /* same as above */
  },
  // Note the generic `update`: a registered renderer serves every row shape.
  update<TRow>(handle: CellRendererHandle, ctx: CellRenderContext<TRow>): void {
    /* same as above */
  },
  destroy(handle: CellRendererHandle): void {
    /* same as above */
  },
}))

const column: DataTableColumn<Invoice> = { key: 'total', renderer: 'bar' }
```

A registered renderer **cannot** depend on the row shape — and that is correct. If it needs to know
`TRow`, it belongs on a specific column, not in the global registry. Re-registering a name replaces
the factory and drops the memoized instance; existing nodes rebuild themselves as soon as the type
changes.

What `update` receives:

| Field       | Type                    | Notes                                                                          |
| ----------- | ----------------------- | ------------------------------------------------------------------------------ |
| `value`     | `CellValue`             | Already read through `column.accessor`, narrowed to a primitive / `Date`.      |
| `raw`       | `unknown`               | The unnormalized value. This is where arrays and objects survive. Validate it. |
| `row`       | `TRow`                  | The whole row, for renderers that need more than one column.                   |
| `rowIndex`  | `number`                | Index into the `rows` prop.                                                    |
| `column`    | `DataTableColumn<TRow>` | With its `format` and `options`.                                               |
| `isEditing` | `boolean`               | Whether this cell currently has the editor over it.                            |

You can also compose on top of the built-ins — they are all exported as instances (`badgeRenderer`,
`avatarRenderer`, …) plus `createTextRenderer()` and `resolveRenderer()`.

---

## Theming

Every color is declared as `var(--ui-*, <fallback>)`. If the host application defines the
**NuxtUI v3** tokens, the table adopts them with zero configuration; if not, the fallback keeps it
presentable on its own. The extra `--dt-*` indirection lets you override a single table token without
touching the global theme.

```css
/* Override one token for one table, anywhere in your CSS. */
.invoices .dt-root {
  --dt-primary: #6366f1;
  --dt-row-height: 36px; /* presentation only — see the warning below */
}
```

### Tokens

| Token                  | Light default | Dark default | Picks up                           |
| ---------------------- | ------------- | ------------ | ---------------------------------- |
| `--dt-bg`              | `#ffffff`     | `#111827`    | `--ui-bg`                          |
| `--dt-bg-muted`        | `#f9fafb`     | `#1f2937`    | `--ui-bg-muted`                    |
| `--dt-bg-elevated`     | `#f3f4f6`     | `#1f2937`    | `--ui-bg-elevated`                 |
| `--dt-bg-accented`     | `#e5e7eb`     | `#374151`    | `--ui-bg-accented`                 |
| `--dt-border`          | `#e5e7eb`     | `#374151`    | `--ui-border`                      |
| `--dt-border-accented` | `#d1d5db`     | `#4b5563`    | `--ui-border-accented`             |
| `--dt-text`            | `#111827`     | `#f9fafb`    | `--ui-text`                        |
| `--dt-text-muted`      | `#6b7280`     | `#9ca3af`    | `--ui-text-muted`                  |
| `--dt-text-dimmed`     | `#9ca3af`     | `#6b7280`    | `--ui-text-dimmed`                 |
| `--dt-primary`         | `#00c16a`     | same         | `--ui-primary`                     |
| `--dt-radius`          | `0.375rem`    | same         | `--ui-radius`                      |
| `--dt-color-blue`      | `#1d4ed8`     | `#60a5fa`    | —                                  |
| `--dt-color-red`       | `#b91c1c`     | `#f87171`    | —                                  |
| `--dt-color-amber`     | `#b45309`     | `#fbbf24`    | —                                  |
| `--dt-color-green`     | `#15803d`     | `#4ade80`    | —                                  |
| `--dt-color-purple`    | `#7e22ce`     | `#c084fc`    | —                                  |
| `--dt-color-neutral`   | `#4b5563`     | `#9ca3af`    | —                                  |
| `--dt-tint-strength`   | `14%`         | `20%`        | —                                  |
| `--dt-row-height`      | `40px`        | same         | written inline from `rowHeight`    |
| `--dt-header-height`   | `44px`        | same         | written inline from `headerHeight` |
| `--dt-font-size`       | `0.875rem`    | same         | —                                  |
| `--dt-cell-px`         | `0.75rem`     | same         | —                                  |

The status palette exists so `CellOption.color` can be a theme token rather than a hard-coded hex.
Use the exported `COLOR_TOKENS` map (`COLOR_TOKENS.red` → `'var(--dt-color-red)'`) so a rename in the
stylesheet propagates from one place. `CellOption.color` also accepts any CSS color.

Badges use a **tinted background with saturated text**, not a solid fill with white text, on purpose:
a solid fill would require guaranteeing text contrast against six colors plus whatever a consumer
brings, which in practice means computing luminance. With a tint, the text keeps the accent color —
already chosen to be legible on the theme background — and the tint never covers it.

Renderers write three more custom properties per cell: `--dt-badge-color`, `--dt-progress-color`,
`--dt-avatar-color`. Restyle a renderer by redefining how the stylesheet consumes them.

> **`rowHeight` is a prop, not a CSS token.** The virtualizer divides scroll offset by row height
> every frame; reading that number from CSS would need a `getComputedStyle` per frame, which forces
> layout. The prop is the source of truth and `--dt-row-height` is its mirror. Setting only the CSS
> variable desynchronizes geometry from math. Same for `--dt-header-height`.

### Light and dark

Three ways to reach dark, and none of them can override an explicit light choice:

1. `theme="dark"` on the component (`data-theme="dark"` on the root).
2. A `.dark` class on `<html>`, for an app-level toggle — with `theme="auto"`.
3. `prefers-color-scheme: dark`, scoped as `:root:not(.light)` so an app that forces light wins over
   the system preference.

`theme="light"` matches none of the three, so it always wins.

`DataTableColumnToggle` is a separate component that can be mounted outside `.dt-root`, so it follows
the **document** (`.dark` / `.light` class, or the system preference) rather than the table's `theme`
prop. If you drive the document class alongside the prop, the two stay in sync:

```ts
watchEffect(() => {
  const classes = document.documentElement.classList
  classes.toggle('dark', theme.value === 'dark')
  classes.toggle('light', theme.value === 'light')
})
```

### Dense

`dense` is a preset, not a single knob: row height `40 → 30`, header `44 → 34`, font `0.875 → 0.8125rem`,
cell padding `0.75 → 0.5rem`. An explicit `rowHeight` / `headerHeight` still wins.

### Selection styling

Selection introduces no new tokens — it is drawn entirely from `--dt-primary` and `--dt-bg-accented`,
so restyling the accent restyles the selection.

| Hook                             | What it does                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dt-cell--active`               | The active cell. `box-shadow: inset 0 0 0 2px var(--dt-primary)` plus `z-index: 1`.                                                                |
| `.dt-row--active`                | The row containing the active cell. Background `--dt-bg-accented`, in **both** `'cell'` and `'row'` mode.                                          |
| `.dt-header-cell--active`        | The header of the active column. Accented background plus a 2px underline in `--dt-primary`.                                                       |
| `[data-selection]` on `.dt-root` | Mirrors `selectionMode` (`none` / `cell` / `row`). The stylesheet uses it to move the ring: in `'row'` mode the row gets it and the cell drops it. |

The ring is `box-shadow: inset`, not `border` and not `outline`, and the choice is load-bearing:

- A `border` would change the cell's box and shift its content by 2px as the selection moves.
- An `outline` draws outside the box, so the neighbouring cell — which is absolutely positioned right
  against it — would paint over half of it.

`inset` box-shadow draws inside the existing box, costs no layout, and composites. `z-index: 1` lifts
the active cell above its neighbours so the ring is not clipped by the next cell's background.

Because `.dt-row--active` and `.dt-row--stripe` have the same specificity and a row can be both, the
active rule is declared **after** the stripe rule and wins on source order. If you override either,
keep that ordering.

### Styling cells from your own CSS

`column.cellClass` returns a class name that lands on the `.dt-cell` element. **That rule must be
global.** Body rows and cells are created with `document.createElement` by the pool, outside Vue's
render, so they never carry the `data-v-*` attribute that `<style scoped>` keys on — a scoped rule
targeting them simply never applies.

---

## Column visibility, order, and persistence

### The v-model trio

```vue
<DataTable
  v-model:column-visibility="visibility"
  v-model:column-order="order"
  v-model:column-widths="widths"
  …
/>
```

Bind only what you want to own. In practice you usually bind `column-visibility` (so
`DataTableColumnToggle` can share it) and leave order and widths to the component.

`DataTableColumnToggle` is optional UI over the same state:

```vue
<DataTableColumnToggle v-model="visibility" :columns="columns" label="Columns" />
```

| Prop         | Type                                | Default     |
| ------------ | ----------------------------------- | ----------- |
| `columns`    | `readonly DataTableColumn<TRow>[]`  | —           |
| `modelValue` | `Readonly<Record<string, boolean>>` | —           |
| `label`      | `string`                            | `'Columns'` |

Only columns with `hideable !== false` are listed. **The last visible column cannot be hidden** — its
checkbox is disabled rather than silently rejecting the click, because a table with zero columns is
not a user preference, it is a broken state with no way back except clearing storage. Escape closes
the panel, arrow keys move focus between options, a click outside closes it.

### Persistence

```vue
<!-- localStorage with defaults -->
<DataTable table-id="invoices" persist … />
```

```ts
// Or configured
const persist: DataTablePersistOptions = {
  enabled: true,
  adapter: myAdapter, // default: localStorage
  debounce: 300, // ms; collapses a whole resize drag into one write
  version: 1, // bump to invalidate old layouts
  include: { visibility: true, widths: true, order: true },
}
```

| Detail            | Behavior                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Storage key       | `datatable:{tableId}`                                                                                                                                  |
| Missing `tableId` | Persistence is **disabled** and a `console.warn` fires once. It never throws.                                                                          |
| Load timing       | On mount, before saving is enabled — otherwise the default state would overwrite the saved one.                                                        |
| Save timing       | Debounced (300ms default). Flushed on unmount, and on demand via `flushPersistence()`.                                                                 |
| Version mismatch  | The saved payload is discarded entirely.                                                                                                               |
| Corrupt payload   | Shape-validated after `JSON.parse`; anything unexpected means "start fresh", never an exception.                                                       |
| Storage failures  | Quota exceeded, private mode, SSR: all absorbed. A preference that fails to save is an annoyance; a table that fails to render because of it is a bug. |

### Custom storage adapter

Implement three methods. They may be sync or async.

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

`save` and `remove` must **absorb their own failures**, never propagate them. Whatever `load` returns
is validated and reconciled before it reaches the table, so a malformed response degrades to
defaults. `createLocalStorageAdapter()` is exported if you want to wrap or compose the default.

The persisted payload is flat and holds only keys, never column definitions:

```ts
interface PersistedTableState {
  version: number
  columnVisibility: Record<string, boolean>
  columnWidths: Record<string, number>
  columnOrder: string[]
}
```

### Reconciliation — read this one

**Saved state is out of date by definition.** Between the session where a user arranged their table
and the session where they come back, you added columns, deleted others and renamed a key. Applying
saved state verbatim produces silent, hard-to-trace failures. So it is never applied verbatim: it is
reconciled against today's columns first.

| What changed between deploys           | What happens on load                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A column was added**                 | It appears **visible** (`defaultVisible ?? true`), positioned **where you declared it** relative to the rest — never hidden just because the saved map predates it, and never dropped at an arbitrary index. |
| **A column was removed**               | Its key is dropped from the order, the visibility map and the width map. No ghost slots.                                                                                                                     |
| **`minWidth` / `maxWidth` tightened**  | The saved width is **re-clamped to today's bounds** (and to the global `32 … 4000`), so an old layout cannot reintroduce an illegal one.                                                                     |
| **A saved width is `NaN`/`Infinity`**  | Discarded, not clamped — there is no sensible position for a non-finite number inside a range.                                                                                                               |
| **The saved order has duplicate keys** | Deduplicated. A duplicated key would make one column occupy two pool slots.                                                                                                                                  |
| **The saved order has unknown keys**   | Dropped.                                                                                                                                                                                                     |
| **`version` does not match**           | The whole payload is discarded and the table starts from defaults.                                                                                                                                           |

The invariant: the reconciled order contains **exactly once** every key of the current columns — no
more, no fewer. The same reconciliation runs on a `columnOrder` prop you pass yourself, because a
v-model can carry stale keys just as easily as storage can.

When you make a change that should invalidate saved layouts entirely (a column means something
different now, widths were rebalanced), bump `persist.version`.

---

## Performance notes

### What makes it fast

| Mechanism                           | Effect                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body cells are not vnodes           | No per-frame vnode diff. The pool writes only changed properties.                                                                                                             |
| Node recycling by viewport slot     | The pool grows with the visible count and never shrinks during scroll.                                                                                                        |
| Write-only-if-changed everywhere    | Every node caches what was last painted on it. A repaint with the same inputs writes nothing.                                                                                 |
| Raw-value paint cache               | If a cell already shows this value, for this row and column, `format`, `cellClass` and `update` are all skipped.                                                              |
| `transform`, not `top` / `left`     | Positioning resolves on the compositor and does not invalidate document layout.                                                                                               |
| One delegated listener per event    | Not 450 listener registrations per frame.                                                                                                                                     |
| `shallowRef` / shallow props        | 100k rows cost zero proxies. Window math is O(1): one division per frame, independent of row count.                                                                           |
| Header scroll is a single transform | The header is Vue-rendered but never re-diffed while scrolling.                                                                                                               |
| Selection resolved by comparison    | The active position is destructured once per frame; each cell compares two values it already holds. Moving the selection writes to exactly the two cells whose state changed. |

### What you can do to make it slow

These are the realistic ways to give the performance back, in rough order of how often they happen:

1. **An expensive `format`.** It runs per visible cell per frame that the cell's value changed. The
   classic mistake is constructing an `Intl.NumberFormat` or `Intl.DateTimeFormat` inside it — that
   negotiates a locale and builds symbol tables, times ~450 cells. Build formatters **once at module
   scope** and call them inside `format`.

   ```ts
   // ✗ one instance per cell, per frame
   format: (value) => new Intl.NumberFormat('en-US').format(Number(value))

   // ✓ one instance, ever
   const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
   format: (value) => (typeof value === 'number' ? money.format(value) : '')
   ```

   The same applies to `cellClass`: keep it to comparisons, no allocation, no string building beyond
   returning a constant.

2. **A `ref()` over the rows instead of `shallowRef()`.** A deep `ref` wraps every row in a Proxy.
   For 100k rows that is 100k proxies allocated up front, plus dependency tracking on every property
   read the paint path performs. Use `shallowRef` and replace the array to signal a change.

3. **An allocating custom renderer.** Creating nodes, building arrays or objects, or template
   literals in `update` produces garbage the GC collects during a scroll — which is exactly a dropped
   frame. Cache the last written value and return early. Never read layout in `update`
   (`offsetWidth`, `getBoundingClientRect`, `getComputedStyle`): that forces a synchronous reflow in
   the middle of painting.

4. **A new `columns` array identity on every render.** Column definitions are compared by reference
   in the cell cache. Rebuilding them inside a `computed` that also depends on unrelated state
   invalidates every cell. Define them at module scope, or in a `computed` that depends only on what
   actually changes them.

5. **A huge `overscan`.** It is a straight multiplier on cells painted per frame. `4` is the default
   for a reason; `50` will not feel smoother.

6. **`virtualizeColumns` left on for a narrow table.** If all columns fit on screen, the window math
   and the slice are pure overhead. Turn it off.

7. **Non-uniform row heights.** Not supported — the O(1) window math depends on a single fixed row
   height. Don't try to fake it with CSS; the virtualizer's geometry would stop matching the DOM.

---

## Limitations

Stated plainly. None of these are implemented:

| Not implemented                              | Notes                                                                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sorting**                                  | No sort state, no sort indicators, no click-to-sort. Sort `rows` yourself and pass the sorted array.                                                                              |
| **Filtering / search**                       | Same: filter upstream and pass the filtered array.                                                                                                                                |
| **Range selection**                          | Selection is exactly one cell (or one row). No `Shift`+click, no `Shift`+arrow range, no `Ctrl`+click multi-select, no copy of a block.                                           |
| **Multi-row selection with checkboxes**      | No `selectedRows` model and no built-in checkbox column. `'row'` selection mode marks one row at a time; `rowClick` and `cellSelect` are the hooks if you need to build your own. |
| **Grouping / pivoting**                      | No group headers, no aggregation, no expand/collapse.                                                                                                                             |
| **Drag-to-reorder columns**                  | The `columnOrder` v-model exists and is fully reconciled, but no drag UI ships with it. Resizing does have a drag handle.                                                         |
| **Row virtualization with variable heights** | `rowHeight` is fixed per table. Variable heights would replace the O(1) division with a measured offset index.                                                                    |
| **Frozen / pinned columns**                  | Every column scrolls.                                                                                                                                                             |
| **Multi-select editor**                      | The `tags` renderer displays lists; there is no editor that edits one.                                                                                                            |
| **SSR of the body**                          | The header and the shell render fine; the body is painted on mount, client-side only.                                                                                             |

### Per-cell Vue components — deliberately not supported

You cannot put a Vue component inside a body cell, and that is the whole architecture, not an
oversight. A vnode-backed cell means Vue owns the scroll hot path again: mounting and unmounting
component instances as rows recycle, running the scheduler inside the frame budget, and paying vnode
diffing for ~450 cells per frame. That is precisely the cost this component exists to avoid.

The replacement is the renderer protocol: `create` once, `update` per frame, mutating plain DOM. It
covers the same ground — badges, rings, avatars, inputs — at a fraction of the cost, and it is
exported and documented so you are not blocked. The header **is** Vue-rendered, because it is a
handful of nodes that re-diff only when the column configuration changes.

---

## Pre-publish checklist

Installing from GitHub already works. Everything below is what is left before pushing to **npm**.

Already done — nothing to do:

- [x] **Name** `datagrid-vue`, **version** `0.1.0`, **description** and **keywords**.
- [x] **License** MIT, declared in `package.json` and present as a `LICENSE` file.
- [x] **Author** `jorge-koki`; **`repository`**, **`homepage`** and **`bugs`** all point at
      `jorge-koki/datagrid-vue`.
- [x] **`private`** removed, so `npm publish` will work.
- [x] **`prepare`** script, so `npm install github:jorge-koki/datagrid-vue` builds `dist/` on install
      without committing build output.

Still open:

- [ ] **Check the name is free on npm** — `npm view datagrid-vue`. If it is taken, publish under a
      scope (`@jorge-koki/datagrid-vue`) and update every import in this README.
- [ ] **Decide on the Vue range.** `peerDependencies.vue` is `^3.5.0 || >=3.6.0-0`, which admits 3.6
      release candidates because that is what this repo develops against. Narrow it to `^3.5.0` if
      you would rather not promise support for prereleases.
- [ ] **Know what `prepare` costs you.** It also runs on every local `npm install` in this repo, and
      a build failure fails the install. The alternative is committing `dist/` and dropping the
      script.
- [ ] **Add a CHANGELOG** if you plan to ship more than one version.

Publishing to npm needs no extra step: `npm publish` runs `prepare`, which builds `dist/`, and
`files: ["dist"]` keeps everything else out of the tarball.

---

## Reference: what the package exports

| Export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Kind                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `DataTable` (also the default export), `DataTableColumnToggle`                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Components                                    |
| `COLOR_TOKENS`, `ColorTokenName`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status palette map and its key type           |
| `registerRenderer`, `resolveRenderer`, `createTextRenderer`, `TEXT_RENDERER_TYPE`                                                                                                                                                                                                                                                                                                                                                                                                                                     | Renderer registry                             |
| `textRenderer`, `numberRenderer`, `badgeRenderer`, `selectRenderer`, `progressRenderer`, `avatarRenderer`, `checkboxRenderer`, `tagsRenderer`                                                                                                                                                                                                                                                                                                                                                                         | Built-in renderer instances, for composing on |
| `createLocalStorageAdapter`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The default storage adapter                   |
| `DataTableProps`, `DataTableColumn`, `DataTableInstance`, `DataTableTheme`, `CellValue`, `CellAlign`, `CellOption`, `CellEditorType`, `CellPosition`, `CellRenderer`, `CellRenderContext`, `CellRendererHandle`, `AnyCellRenderer`, `CellRendererFactory`, `SelectionMode`, `CellSelectEvent`, `BeforeEditEvent`, `AfterEditEvent`, `EditCommitEvent`, `ColumnResizeEvent`, `ColumnVisibilityState`, `ColumnWidthState`, `DataTablePersistOptions`, `DataTableStorageAdapter`, `PersistedTableState`, `VirtualWindow` | Types                                         |

The composables and the node pool are **not** exported. They are implementation details, and
exporting them would turn them into API that has to be supported forever.
