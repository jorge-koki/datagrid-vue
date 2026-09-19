/**
 * El editor por slot: un componente del consumidor sobre la celda en edición.
 *
 * Lo que se verifica aquí es exactamente lo que hace que esta función no
 * contradiga la tesis del componente:
 *
 * 1. **Una sola tubería.** `commit()` y `cancel()` publican por el mismo camino
 *    que el editor incluido —`beforeEdit` al abrir, `editCommit` solo ante un
 *    cambio real, `afterEdit` siempre— y no existe una segunda vía que esquive
 *    el veto ni que emita dos veces.
 * 2. **Una sola instancia.** El contenido del slot se monta al abrir y se
 *    desmonta al cerrar, y solo puede haber una celda abierta.
 * 3. **Costo cero por frame.** Declarar el slot no mueve el presupuesto de
 *    escrituras de un paso de scroll, ni siquiera con el editor abierto.
 */

import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import type { VNode } from 'vue'
import { mountTable } from './harness'
import type { GridRow, TableHarness, TableProps, TableSlots } from './harness'
import { countMatching, recordDomWrites } from './dom-recorder'
import type { DomWriteEntry } from './dom-recorder'
import type { CellEditorSlotProps, DataTableColumn } from '../types'

/**
 * El mismo presupuesto por fila entrante que fija `pool.perf.test.ts`.
 *
 * Se repite aquí como constante local en vez de importarse porque el número que
 * este archivo tiene que defender es OTRO: que declarar el slot `#editor` no lo
 * mueva. Si alguna vez divergieran, el que manda es el de `pool.perf.test.ts`,
 * donde está derivado del contrato de `internal/dom.ts`.
 */
const ENTERING_ROW_WRITES = 6

/* --------------------------------------------------------------- Andamiaje */

/**
 * Sonda que se monta dentro del slot `#editor`.
 *
 * Guarda las últimas props recibidas para que el test pueda invocar `commit()` y
 * `cancel()` como lo haría el componente del consumidor, y cuenta montajes y
 * desmontajes, que es la medida directa de "una instancia por sesión de edición
 * y no una por celda".
 */
interface SlotProbe {
  /** Últimas props que recibió el slot, o `null` si todavía no se abrió. */
  latest: CellEditorSlotProps<GridRow> | null
  /** Cuántas veces se renderizó el contenido del slot. */
  renders: number
  /** La función de slot que se le pasa a {@link mountTable}. */
  slot: (props: CellEditorSlotProps<GridRow>) => VNode
}

function createSlotProbe(): SlotProbe {
  const probe: SlotProbe = {
    latest: null,
    renders: 0,
    slot: (props: CellEditorSlotProps<GridRow>): VNode => {
      probe.latest = props
      probe.renders += 1
      // Un input de verdad y no un `<div>`: lo que se verifica más abajo es que
      // el foco aterrice en el primer elemento enfocable del contenido, y para
      // eso el contenido tiene que tener uno.
      return h('input', { class: 'slot-probe', 'data-column-key': props.columnKey })
    },
  }
  return probe
}

/** Props que el slot recibió la última vez, o un error con un mensaje claro. */
function openProps(probe: SlotProbe): CellEditorSlotProps<GridRow> {
  const props = probe.latest
  if (!props) throw new Error('[test] el slot #editor nunca se renderizó')
  return props
}

const COLUMNS: readonly DataTableColumn<GridRow>[] = [
  { key: 'id', width: 120 },
  { key: 'amount', width: 120, editable: true },
  { key: 'owner', width: 140, editable: true, editor: 'slot' },
  { key: 'note', width: 140, editor: 'slot' },
]

/** Filas donde el `id` coincide con el índice ORIGINAL, a propósito. */
function makeRows(count: number): GridRow[] {
  const rows: GridRow[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({ id: index, amount: index * 10, owner: `Owner ${index}`, note: `Note ${index}` })
  }
  return rows
}

interface MountOptions {
  rows?: readonly GridRow[]
  columns?: readonly DataTableColumn<GridRow>[]
  props?: Partial<TableProps>
  /** `null` monta la tabla SIN declarar el slot `#editor`. */
  slots?: TableSlots | null
}

async function mountWithSlot(probe: SlotProbe, options: MountOptions = {}): Promise<TableHarness> {
  const slots: TableSlots | undefined =
    options.slots === null ? undefined : (options.slots ?? { editor: probe.slot })

  return mountTable({
    viewport: { width: 600, height: 400 },
    props: {
      rows: options.rows ?? makeRows(5),
      columns: options.columns ?? COLUMNS,
      rowKey: 'id',
      rowHeight: 40,
      ...options.props,
    },
    slots,
  })
}

/* ------------------------------------------------- Dónde abre y dónde no */

describe('slot editor — it opens only on the column that asks for it', () => {
  it('opens the #editor slot over a column flagged editor: "slot"', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')

    expect(harness.slotEditor()).not.toBeNull()
    // El control incluido no se construye: la columna pidió el suyo.
    expect(harness.editor()).toBeNull()
    expect(openProps(probe)).toMatchObject({
      rowIndex: 2,
      columnKey: 'owner',
      value: 'Owner 2',
    })
    expect(openProps(probe).row).toMatchObject({ id: 2 })
    harness.unmount()
  })

  it('leaves a plain editable column on the built-in control', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(1, 'amount')

    expect(harness.editor()).toBeInstanceOf(HTMLInputElement)
    expect(harness.slotEditor()).toBeNull()
    expect(probe.renders).toBe(0)
    harness.unmount()
  })

  it('opens nothing when the table declares no #editor slot', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, { slots: null })

    await harness.doubleClickCell(2, 'owner')

    // Ni el slot ni un editor incluido de reemplazo: la columna pidió su propio
    // control justamente porque el incluido no sirve para ella.
    expect(harness.slotEditor()).toBeNull()
    expect(harness.editor()).toBeNull()
    expect(harness.wrapper.emitted('beforeEdit')).toBeUndefined()
    harness.unmount()
  })

  it('does not even render the host element without the slot', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, { slots: null })

    // Una tabla que no usa la función produce exactamente el mismo DOM que antes
    // de que existiera.
    expect(harness.grid.querySelector('.dt-editor-slot')).toBeNull()
    harness.unmount()
  })

  it('refuses a slot column that is not editable', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    // `note` declara `editor: 'slot'` pero no `editable: true`. La bandera de
    // edición sigue siendo la que manda, igual que para cualquier otra columna.
    await harness.doubleClickCell(2, 'note')

    expect(harness.slotEditor()).toBeNull()
    expect(harness.wrapper.emitted('beforeEdit')).toBeUndefined()
    harness.unmount()
  })

  it('opens from the keyboard too, with Enter over the active cell', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.clickCell(1, 'owner')
    await harness.press('Enter')

    expect(harness.slotEditor()).not.toBeNull()
    expect(openProps(probe).rowIndex).toBe(1)
    harness.unmount()
  })
})

/* ------------------------------------------------------------------ Veto */

describe('slot editor — the beforeEdit veto has no back door', () => {
  it('prevents the slot from opening at all', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, {
      props: {
        onBeforeEdit: (event) => {
          event.cancel()
        },
      },
    })

    await harness.doubleClickCell(2, 'owner')

    expect(harness.slotEditor()).toBeNull()
    // El contenido del consumidor nunca llega a montarse.
    expect(probe.renders).toBe(0)
    // Sin editor abierto no hay sesión de edición, así que tampoco hay cierre.
    expect(harness.wrapper.emitted('afterEdit')).toBeUndefined()
    harness.unmount()
  })

  it('emits beforeEdit exactly once per opened slot editor', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    openProps(probe).commit('Grace')
    await harness.flush()

    // Confirmar NO vuelve a pasar por el veto: ese chequeo ya corrió al abrir, y
    // repetirlo dejaría a un listener capaz de cancelar una edición que el
    // usuario ya terminó.
    expect(harness.wrapper.emitted('beforeEdit')).toHaveLength(1)
    harness.unmount()
  })

  it('reports the original row index to the veto listener', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(3, 'owner')

    expect(harness.wrapper.emitted('beforeEdit')?.[0]?.[0]).toMatchObject({
      rowIndex: 3,
      columnKey: 'owner',
      value: 'Owner 3',
    })
    harness.unmount()
  })
})

/* ------------------------------------------------------------- commit() */

describe('slot editor — commit() routes through the existing pipeline', () => {
  it('emits editCommit and then afterEdit, with the value untouched', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    openProps(probe).commit('Grace')
    await harness.flush()

    const committed = harness.wrapper.emitted('editCommit')
    expect(committed).toHaveLength(1)
    expect(committed?.[0]?.[0]).toMatchObject({
      rowIndex: 2,
      columnKey: 'owner',
      oldValue: 'Owner 2',
      newValue: 'Grace',
    })

    const after = harness.wrapper.emitted('afterEdit')
    expect(after).toHaveLength(1)
    expect(after?.[0]?.[0]).toMatchObject({ canceled: false, newValue: 'Grace' })
    harness.unmount()
  })

  it('hands the value through with its type intact, without coercing anything', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    // El editor incluido recibe un string de un control del DOM y tiene que
    // devolverlo al tipo original. Aquí el consumidor ya tiene el valor tipado:
    // coaccionarlo sería corromperlo.
    openProps(probe).commit(42)
    await harness.flush()

    const committed = harness.wrapper.emitted('editCommit')?.[0]?.[0]
    expect(committed).toMatchObject({ newValue: 42 })
    harness.unmount()
  })

  it('emits afterEdit but no editCommit when the value did not change', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    openProps(probe).commit('Owner 2')
    await harness.flush()

    expect(harness.wrapper.emitted('afterEdit')).toHaveLength(1)
    expect(harness.wrapper.emitted('editCommit')).toBeUndefined()
    harness.unmount()
  })

  it('closes the editor and unmounts the slot content', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    expect(harness.grid.querySelector('.slot-probe')).not.toBeNull()

    openProps(probe).commit('Grace')
    await harness.flush()

    expect(harness.slotEditor()).toBeNull()
    expect(harness.grid.querySelector('.slot-probe')).toBeNull()
    harness.unmount()
  })

  it('ignores a commit() that arrives after the session closed', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    const props = openProps(probe)
    props.commit('Grace')
    await harness.flush()

    // La closure sobrevive al desmontaje del contenido: un componente que
    // confirma desde un `setTimeout` la llamaría con la sesión ya cerrada, y eso
    // no puede publicar una segunda edición sobre una celda que ya no está
    // abierta.
    props.commit('Again')
    await harness.flush()

    expect(harness.wrapper.emitted('editCommit')).toHaveLength(1)
    expect(harness.wrapper.emitted('afterEdit')).toHaveLength(1)
    harness.unmount()
  })

  it('mounts exactly one instance per edit session, not one per cell', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, { rows: makeRows(200) })

    // Cinco ediciones consecutivas sobre cinco filas distintas. Si el slot
    // viviera dentro de la celda, con 200 filas ya habría 200 instancias antes
    // de la primera edición.
    for (const rowIndex of [0, 1, 2, 3, 4]) {
      await harness.doubleClickCell(rowIndex, 'owner')
      expect(harness.grid.querySelectorAll('.slot-probe')).toHaveLength(1)
      openProps(probe).commit(`Owner ${rowIndex}!`)
      await harness.flush()
      expect(harness.grid.querySelectorAll('.slot-probe')).toHaveLength(0)
    }

    expect(harness.wrapper.emitted('editCommit')).toHaveLength(5)
    harness.unmount()
  })
})

/* ------------------------------------- commit() con agrupación de por medio */

describe('slot editor — commit() reports the ORIGINAL row index', () => {
  const GROUPED_COLUMNS: readonly DataTableColumn<GridRow>[] = [
    { key: 'id', width: 100 },
    { key: 'status', width: 100 },
    { key: 'owner', width: 160, editable: true, editor: 'slot' },
  ]

  /** El `id` es el índice dentro de `rows`, y no la posición visible. */
  function groupedRows(): GridRow[] {
    return [
      { id: 0, status: 'open', owner: 'Ada' },
      { id: 1, status: 'open', owner: 'Alan' },
      { id: 2, status: 'done', owner: 'Grace' },
      { id: 3, status: 'done', owner: 'Edsger' },
      { id: 4, status: 'late', owner: 'Barbara' },
    ]
  }

  async function mountGrouped(probe: SlotProbe): Promise<TableHarness> {
    return mountWithSlot(probe, {
      rows: groupedRows(),
      columns: GROUPED_COLUMNS,
      props: { groupBy: ['status'] },
    })
  }

  it('with the groups expanded', async () => {
    const probe = createSlotProbe()
    const harness = await mountGrouped(probe)

    // `id` 3 vive en la posición visible 6: dos cabeceras y dos filas por delante.
    await harness.doubleClickCell(3, 'owner')
    expect(openProps(probe).rowIndex).toBe(3)

    openProps(probe).commit('Donald')
    await harness.flush()

    expect(harness.wrapper.emitted('editCommit')?.[0]?.[0]).toMatchObject({
      rowIndex: 3,
      newValue: 'Donald',
    })
    harness.unmount()
  })

  it('with an earlier group collapsed, where visible and original diverge', async () => {
    const probe = createSlotProbe()
    const harness = await mountGrouped(probe)

    // Plegar el primer grupo es el caso donde la posición visible y el índice
    // original se separan de verdad: `id` 3 pasa de la posición 6 a la 4.
    const firstGroup = harness.canvas.querySelector('.dt-group-row')
    firstGroup?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await harness.flush()

    await harness.doubleClickCell(3, 'owner')

    // Lo que ve el slot ya es el índice del dataset, no la posición vertical.
    expect(openProps(probe).rowIndex).toBe(3)
    expect(openProps(probe).row).toMatchObject({ id: 3, owner: 'Edsger' })

    openProps(probe).commit('Donald')
    await harness.flush()

    const committed = harness.wrapper.emitted('editCommit')?.[0]?.[0]
    expect(committed).toMatchObject({ rowIndex: 3, newValue: 'Donald' })
    // Y la fila que viaja en el evento es la del dataset, no una vecina.
    expect(harness.wrapper.emitted('afterEdit')?.[0]?.[0]).toMatchObject({ rowIndex: 3 })
    harness.unmount()
  })
})

/* ------------------------------------------------------------- cancel() */

describe('slot editor — cancel() discards without writing', () => {
  it('emits afterEdit with canceled: true and no editCommit', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    openProps(probe).cancel()
    await harness.flush()

    const after = harness.wrapper.emitted('afterEdit')
    expect(after).toHaveLength(1)
    expect(after?.[0]?.[0]).toMatchObject({
      canceled: true,
      oldValue: 'Owner 2',
      newValue: 'Owner 2',
      rowIndex: 2,
    })
    expect(harness.wrapper.emitted('editCommit')).toBeUndefined()
    expect(harness.slotEditor()).toBeNull()
    harness.unmount()
  })

  it('Escape inside the slot cancels, exactly like a built-in editor', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    const content = harness.grid.querySelector('.slot-probe')
    content?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await harness.flush()

    expect(harness.slotEditor()).toBeNull()
    expect(harness.wrapper.emitted('afterEdit')?.[0]?.[0]).toMatchObject({ canceled: true })
    expect(harness.wrapper.emitted('editCommit')).toBeUndefined()
    harness.unmount()
  })

  it('keeps the selection where it was after Escape', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.clickCell(2, 'owner')
    await harness.press('Enter')
    const content = harness.grid.querySelector('.slot-probe')
    content?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await harness.flush()

    const selections = harness.wrapper.emitted('update:activeCell')
    expect(selections?.[selections.length - 1]?.[0]).toMatchObject({
      rowIndex: 2,
      columnKey: 'owner',
    })
    harness.unmount()
  })
})

/* ------------------------------------------------------- Cómo más cierra */

describe('slot editor — closing paths other than commit and cancel', () => {
  it('closes when the edited row scrolls out of the painted window', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, { rows: makeRows(200) })

    await harness.doubleClickCell(2, 'owner')
    expect(harness.slotEditor()).not.toBeNull()

    await harness.scrollTo({ top: 100 * 40 })

    // Se cierra CONFIRMANDO, con la misma semántica que un blur: la alternativa
    // sería dejar el componente del consumidor flotando sobre filas que ya
    // pertenecen a otros datos.
    expect(harness.slotEditor()).toBeNull()
    const after = harness.wrapper.emitted('afterEdit')
    expect(after).toHaveLength(1)
    expect(after?.[0]?.[0]).toMatchObject({ canceled: false, rowIndex: 2 })
    // La tabla no sabe qué valor tenía el control del consumidor, así que
    // confirma el que había: sin cambio real no hay nada que persistir.
    expect(harness.wrapper.emitted('editCommit')).toBeUndefined()
    harness.unmount()
  })

  it('closes when the pointer picks another cell', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    await harness.clickCell(3, 'amount')

    // El editor de slot no confirma al perder el foco —su contenido puede abrir
    // un popover teleportado que se lo lleva—, así que apuntar otra celda es lo
    // que lo cierra.
    expect(harness.slotEditor()).toBeNull()
    expect(harness.wrapper.emitted('afterEdit')).toHaveLength(1)
    harness.unmount()
  })

  it('stays open when the pointer picks the very same cell', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    await harness.clickCell(2, 'owner')

    expect(harness.slotEditor()).not.toBeNull()
    expect(harness.wrapper.emitted('afterEdit')).toBeUndefined()
    harness.unmount()
  })

  it('opening another slot cell closes the previous one exactly once', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(1, 'owner')
    await harness.doubleClickCell(3, 'owner')

    expect(harness.slotEditor()).not.toBeNull()
    expect(openProps(probe).rowIndex).toBe(3)
    const after = harness.wrapper.emitted('afterEdit')
    expect(after).toHaveLength(1)
    expect(after?.[0]?.[0]).toMatchObject({ rowIndex: 1 })
    harness.unmount()
  })
})

/* -------------------------------------------------------------------- Foco */

describe('slot editor — focus goes in and comes back', () => {
  it('lands on the first focusable node of the slot content when it opens', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')

    const content = harness.grid.querySelector('.slot-probe')
    expect(content).not.toBeNull()
    expect(document.activeElement).toBe(content)
    harness.unmount()
  })

  it('falls back to the host when the slot content has nothing focusable', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, {
      slots: { editor: () => h('span', { class: 'slot-static' }, 'sin control') },
    })

    await harness.doubleClickCell(2, 'owner')

    // Sin foco dentro de la caja, Escape no llegaría a ningún lado.
    expect(document.activeElement).toBe(harness.slotEditor())
    harness.unmount()
  })

  it('returns to the viewport when the editor commits', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    openProps(probe).commit('Grace')
    await harness.flush()

    // El manejador de teclado escucha en el viewport: con el foco en el `body`
    // la flecha siguiente a una edición no llegaría a ningún lado.
    expect(document.activeElement).toBe(harness.viewport)
    harness.unmount()
  })

  it('returns to the viewport when the editor cancels', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    openProps(probe).cancel()
    await harness.flush()

    expect(document.activeElement).toBe(harness.viewport)
    harness.unmount()
  })

  it('keeps the keyboard working after the editor closes', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.clickCell(1, 'owner')
    await harness.press('Enter')
    openProps(probe).cancel()
    await harness.flush()

    await harness.press('ArrowDown')

    const selections = harness.wrapper.emitted('update:activeCell')
    expect(selections?.[selections.length - 1]?.[0]).toMatchObject({ rowIndex: 2 })
    harness.unmount()
  })

  it('does not steal focus from slot content that focused itself', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, {
      slots: {
        editor: () =>
          h('div', [
            h('input', { class: 'slot-first' }),
            h('input', {
              class: 'slot-second',
              // Quien escribió un control compuesto sabe mejor que la tabla qué
              // parte tiene que recibir el foco.
              onVnodeMounted: (vnode) => {
                if (vnode.el instanceof HTMLElement) vnode.el.focus()
              },
            }),
          ]),
      },
    })

    await harness.doubleClickCell(2, 'owner')

    expect(document.activeElement).toBe(harness.grid.querySelector('.slot-second'))
    harness.unmount()
  })
})

/* ------------------------------------------- Los editores incluidos, intactos */

describe('slot editor — the built-in editors are unaffected', () => {
  it('a plain column still opens and commits through its own control', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(1, 'amount')
    const control = harness.editor()
    if (!control) throw new Error('[test] no se abrió el editor incluido')
    control.value = '999'
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await harness.flush()

    expect(harness.wrapper.emitted('editCommit')?.[0]?.[0]).toMatchObject({
      rowIndex: 1,
      columnKey: 'amount',
      newValue: 999,
    })
    expect(probe.renders).toBe(0)
    harness.unmount()
  })

  it('a built-in editor still commits on blur with the slot declared', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(1, 'amount')
    const control = harness.editor()
    if (!control) throw new Error('[test] no se abrió el editor incluido')
    control.value = '555'
    control.dispatchEvent(new Event('blur'))
    await harness.flush()

    expect(harness.wrapper.emitted('editCommit')).toHaveLength(1)
    harness.unmount()
  })

  it('switching from a slot editor to a built-in one closes exactly one session', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'owner')
    await harness.doubleClickCell(2, 'amount')

    expect(harness.slotEditor()).toBeNull()
    expect(harness.editor()).toBeInstanceOf(HTMLInputElement)
    const after = harness.wrapper.emitted('afterEdit')
    expect(after).toHaveLength(1)
    expect(after?.[0]?.[0]).toMatchObject({ columnKey: 'owner' })
    harness.unmount()
  })

  it('switching from a built-in editor to a slot one closes exactly one session', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe)

    await harness.doubleClickCell(2, 'amount')
    const control = harness.editor()
    control?.focus()
    await harness.doubleClickCell(2, 'owner')

    expect(harness.slotEditor()).not.toBeNull()
    expect(harness.wrapper.emitted('afterEdit')).toHaveLength(1)
    harness.unmount()
  })
})

/* ------------------------------------------------- Presupuesto por frame */

/**
 * El costo por frame de declarar el slot `#editor`.
 *
 * ## Qué está en juego
 *
 * Toda la tesis del componente es que el camino caliente del scroll no pasa por
 * Vue. Abrir una puerta a un componente del consumidor es exactamente el tipo de
 * cambio que podría reintroducirlo sin que nada se rompa: la tabla seguiría
 * renderizando bien y solo scrollearía peor.
 *
 * Por eso lo que se mide es que el presupuesto de un paso de scroll sea el MISMO
 * —seis escrituras, las de la única fila que entró— con el slot declarado y,
 * sobre todo, con el editor ABIERTO. La caja del editor se posiciona en
 * coordenadas del canvas y vive dentro del viewport que scrollea, así que
 * desplazarse no la mueve ni un píxel: no hay ninguna escritura que hacer.
 */
describe('slot editor — the per-frame write budget does not move', () => {
  /** Mide las escrituras de un paso de scroll sobre la grilla entera. */
  async function measureStep(
    harness: TableHarness,
    fromRow: number,
  ): Promise<{
    total: number
    textContent: number
    style: number
    attribute: number
    report: string
    entries: readonly DomWriteEntry[]
  }> {
    await harness.scrollTo({ top: fromRow * 40 })
    await harness.flush()

    const recorder = recordDomWrites(harness.grid)
    try {
      await harness.scrollTo({ top: (fromRow + 1) * 40 })
    } finally {
      recorder.stop()
    }
    const counts = recorder.counts()
    return {
      total: counts.total,
      textContent: counts.textContent,
      style: counts.style,
      attribute: counts.attribute,
      report: recorder.report(),
      entries: [...recorder.entries()],
    }
  }

  const SCROLL_COLUMNS: readonly DataTableColumn<GridRow>[] = [
    { key: 'id', width: 120 },
    { key: 'amount', width: 120 },
    { key: 'owner', width: 120, editable: true, editor: 'slot' },
  ]

  it('costs exactly the entering row with the slot declared and closed', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, {
      rows: makeRows(200),
      columns: SCROLL_COLUMNS,
    })

    const measured = await measureStep(harness, 10)

    // El mismo `ENTERING_ROW_WRITES` que mide `pool.perf.test.ts` sobre una tabla
    // sin ningún slot: 1 `transform`, 2 atributos de identidad y 3 textos.
    expect(measured.total, measured.report).toBe(ENTERING_ROW_WRITES)
    expect(measured.textContent, measured.report).toBe(3)
    expect(measured.style, measured.report).toBe(1)
    expect(measured.attribute, measured.report).toBe(2)
    harness.unmount()
  })

  it('costs exactly the entering row with the slot editor OPEN', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, {
      rows: makeRows(200),
      columns: SCROLL_COLUMNS,
    })

    await harness.scrollTo({ top: 10 * 40 })
    await harness.doubleClickCell(12, 'owner')
    expect(harness.slotEditor()).not.toBeNull()

    const measured = await measureStep(harness, 10)

    // La caja del editor no se reposiciona al scrollear: está en coordenadas del
    // canvas, dentro del contenedor que se desplaza. Si este número subiera,
    // sería porque alguien la sacó de ahí o porque el contenido del slot pasó a
    // rediferenciarse por frame.
    expect(measured.total, measured.report).toBe(ENTERING_ROW_WRITES)
    expect(countMatching(measured.entries, 'dt-editor-slot'), measured.report).toBe(0)
    // Y el editor sigue abierto: el paso no lo sacó de la ventana pintada.
    expect(harness.slotEditor()).not.toBeNull()
    harness.unmount()
  })

  it('renders the slot content once per session, not once per frame', async () => {
    const probe = createSlotProbe()
    const harness = await mountWithSlot(probe, {
      rows: makeRows(200),
      columns: SCROLL_COLUMNS,
    })

    await harness.scrollTo({ top: 10 * 40 })
    await harness.doubleClickCell(12, 'owner')
    const rendersAtOpen = probe.renders

    for (let step = 10; step < 14; step += 1) {
      await harness.scrollTo({ top: step * 40 })
    }

    // Cuatro frames de scroll con el editor abierto: el contenido del consumidor
    // no se vuelve a renderizar ni una vez. Es la diferencia entre montar un
    // componente sobre la celda en edición y montar uno por celda visible.
    expect(probe.renders).toBe(rendersAtOpen)
    harness.unmount()
  })
})
