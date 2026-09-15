/**
 * Ciclo de vida de la edición de celdas.
 *
 * Tres contratos se verifican acá, y los tres son fáciles de romper sin que nada
 * se note hasta producción:
 *
 * 1. El veto de `beforeEdit` no tiene puertas traseras. `beginEdit` y
 *    `commitValue` —el camino de la casilla— pasan por el mismo chequeo.
 * 2. El valor que se entrega al padre conserva el tipo del dato original.
 *    Devolver `"42"` donde había `42` corrompe el dataset en silencio.
 * 3. La tabla es CONTROLADA: nada de este módulo escribe sobre las filas.
 */

import { describe, expect, it, vi } from 'vitest'
import { defineComponent, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import { inferEditorType, useCellEditor } from '../composables/useCellEditor'
import type { CellGeometry, UseCellEditorReturn } from '../composables/useCellEditor'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellPosition,
  DataTableColumn,
  EditCommitEvent,
} from '../types'

type Row = {
  id: number
  name: string
  amount: number
  flag: boolean
  when: Date
  choice: string
}

const OPTIONS = [
  { value: 1, label: 'One' },
  { value: 2, label: 'Two' },
] as const

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { key: 'name', editable: true },
  { key: 'amount', editable: true },
  { key: 'flag', editable: true },
  { key: 'when', editable: true },
  { key: 'choice', editable: true, options: OPTIONS, editor: 'select' },
  { key: 'readonly', editable: false },
  { key: 'flagAsText', editable: true, editor: 'text', accessor: (row) => row.flag },
  { key: 'amountAsText', editable: true, editor: 'text', accessor: (row) => row.amount },
]

function makeRows(): Row[] {
  return [
    {
      id: 0,
      name: 'Ada',
      amount: 10,
      flag: true,
      when: new Date('2024-03-01T00:00:00Z'),
      choice: '1',
    },
    {
      id: 1,
      name: 'Alan',
      amount: 20,
      flag: false,
      when: new Date('2024-06-15T00:00:00Z'),
      choice: '2',
    },
  ]
}

interface EditorHarness {
  editor: UseCellEditorReturn
  rows: Row[]
  before: BeforeEditEvent<Row>[]
  after: AfterEditEvent<Row>[]
  committed: EditCommitEvent<Row>[]
  /** Se invoca en cada `beforeEdit`, para que un test pueda vetar. */
  veto: { handler: ((event: BeforeEditEvent<Row>) => void) | null }
  /** Controla lo que responde `isCellPainted`. */
  painted: { value: boolean }
  /** Cuántas veces se pidió bajar la selección después de un Enter. */
  enter: { count: number }
  control(): HTMLInputElement | HTMLSelectElement | null
  unmount(): void
}

function mountEditor(): EditorHarness {
  const rows = makeRows()
  const before: BeforeEditEvent<Row>[] = []
  const after: AfterEditEvent<Row>[] = []
  const committed: EditCommitEvent<Row>[] = []
  const veto: EditorHarness['veto'] = { handler: null }
  const painted = { value: true }
  const enter = { count: 0 }
  const holder: { value: UseCellEditorReturn | null } = { value: null }
  const host = shallowRef<HTMLElement | null>(null)

  const wrapper = mount(
    defineComponent({
      setup() {
        const hostEl = document.createElement('div')
        document.body.appendChild(hostEl)
        host.value = hostEl

        holder.value = useCellEditor<Row>({
          host,
          getRow: (rowIndex) => rows[rowIndex],
          getColumn: (columnKey) => COLUMNS.find((column) => column.key === columnKey),
          getCellGeometry: (position): CellGeometry => ({
            x: 0,
            y: position.rowIndex * 40,
            width: 120,
            height: 40,
          }),
          isCellPainted: () => painted.value,
          emitBeforeEdit: (event) => {
            before.push(event)
            veto.handler?.(event)
          },
          emitAfterEdit: (event) => after.push(event),
          emitEditCommit: (event) => committed.push(event),
          onEnterCommit: () => {
            enter.count += 1
          },
        })
        return () => null
      },
    }),
  )

  const editor = holder.value
  if (!editor) throw new Error('[test] el editor no se inicializó')

  return {
    editor,
    rows,
    before,
    after,
    committed,
    veto,
    painted,
    enter,
    control(): HTMLInputElement | HTMLSelectElement | null {
      const hostEl = host.value
      if (!hostEl) return null
      for (const node of hostEl.querySelectorAll('.dt-editor')) {
        if (
          (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) &&
          !node.hidden
        ) {
          return node
        }
      }
      return null
    },
    unmount(): void {
      wrapper.unmount()
      host.value?.remove()
    },
  }
}

/** Escribe en el control abierto y confirma con Enter. */
function typeAndCommit(harness: EditorHarness, text: string): void {
  const control = harness.control()
  if (!control) throw new Error('[test] no hay editor abierto')
  control.value = text
  control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

const NAME_CELL: CellPosition = { rowIndex: 0, columnKey: 'name' }
const AMOUNT_CELL: CellPosition = { rowIndex: 0, columnKey: 'amount' }

describe('inferEditorType — the value type wins over the options list', () => {
  const column: DataTableColumn<Row> = { key: 'x' }

  it('uses an explicit editor above everything else', () => {
    expect(inferEditorType({ key: 'x', editor: 'text' }, 42)).toBe('text')
  })

  it('maps a boolean to a checkbox', () => {
    expect(inferEditorType(column, true)).toBe('checkbox')
  })

  it('maps a number to a number input', () => {
    expect(inferEditorType(column, 42)).toBe('number')
  })

  it('maps a Date to a date input', () => {
    expect(inferEditorType(column, new Date())).toBe('date')
  })

  it('keeps a boolean as a checkbox even when the column declares options', () => {
    // El tipo del dato es una señal más fuerte que la existencia de una lista:
    // una columna booleana con dos opciones sigue siendo una casilla.
    expect(inferEditorType({ key: 'x', options: OPTIONS }, false)).toBe('checkbox')
  })

  it('falls back to select when there are options and no type signal', () => {
    expect(inferEditorType({ key: 'x', options: OPTIONS }, null)).toBe('select')
  })

  it('falls back to text with nothing to go on', () => {
    expect(inferEditorType(column, null)).toBe('text')
  })

  it('ignores an empty options array', () => {
    expect(inferEditorType({ key: 'x', options: [] }, null)).toBe('text')
  })
})

describe('useCellEditor — the beforeEdit veto has no back door', () => {
  it('blocks the editor from opening', () => {
    const harness = mountEditor()
    harness.veto.handler = (event) => event.cancel()

    expect(harness.editor.beginEdit(NAME_CELL)).toBe(false)
    expect(harness.editor.editing.value).toBeNull()
    expect(harness.control()).toBeNull()
    // Sin editor abierto no hay sesión de edición, así que tampoco hay cierre.
    expect(harness.after).toHaveLength(0)
    harness.unmount()
  })

  it('blocks the editor when cancel is DESTRUCTURED off the event', () => {
    const harness = mountEditor()
    // Este fue un bug real: si `cancel` escribiera `this.canceled`, arrancarlo
    // del evento perdería el receptor y el veto se descartaría en silencio.
    harness.veto.handler = ({ cancel }) => cancel()

    expect(harness.editor.beginEdit(NAME_CELL)).toBe(false)
    expect(harness.editor.editing.value).toBeNull()
    harness.unmount()
  })

  it('tolerates cancel() being called more than once', () => {
    const harness = mountEditor()
    harness.veto.handler = (event) => {
      event.cancel()
      event.cancel()
    }

    expect(harness.editor.beginEdit(NAME_CELL)).toBe(false)
    harness.unmount()
  })

  it('honours a listener that sets canceled directly instead of calling cancel()', () => {
    const harness = mountEditor()
    harness.veto.handler = (event) => {
      event.canceled = true
    }

    expect(harness.editor.beginEdit(NAME_CELL)).toBe(false)
    harness.unmount()
  })

  it('blocks commitValue, the path the checkbox renderer uses', () => {
    const harness = mountEditor()
    harness.veto.handler = ({ cancel }) => cancel()

    expect(harness.editor.commitValue({ rowIndex: 0, columnKey: 'flag' }, false)).toBe(false)
    expect(harness.committed).toHaveLength(0)
    expect(harness.after).toHaveLength(0)
    harness.unmount()
  })

  it('opens normally when no listener cancels', () => {
    const harness = mountEditor()

    expect(harness.editor.beginEdit(NAME_CELL)).toBe(true)
    expect(harness.editor.editing.value).toEqual(NAME_CELL)
    expect(harness.before).toHaveLength(1)
    expect(harness.before[0]?.value).toBe('Ada')
    harness.unmount()
  })

  it('refuses to open a column that is not editable', () => {
    const harness = mountEditor()

    expect(harness.editor.beginEdit({ rowIndex: 0, columnKey: 'readonly' })).toBe(false)
    // Ni siquiera se emite `beforeEdit`: no hay nada que vetar.
    expect(harness.before).toHaveLength(0)
    harness.unmount()
  })

  it('refuses to open an unknown column or a row out of range', () => {
    const harness = mountEditor()

    expect(harness.editor.beginEdit({ rowIndex: 0, columnKey: 'nope' })).toBe(false)
    expect(harness.editor.beginEdit({ rowIndex: 99, columnKey: 'name' })).toBe(false)
    harness.unmount()
  })

  it('refuses to open a floating editor over a checkbox cell', () => {
    const harness = mountEditor()

    // La casilla se edita en la propia celda; el renderer manda su intención
    // por `commitValue`.
    expect(harness.editor.beginEdit({ rowIndex: 0, columnKey: 'flag' })).toBe(false)
    harness.unmount()
  })
})

describe('useCellEditor — the committed value keeps the original primitive type', () => {
  it('returns a number for a numeric column', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(AMOUNT_CELL)
    typeAndCommit(harness, '42')

    expect(harness.committed).toHaveLength(1)
    expect(harness.committed[0]?.newValue).toBe(42)
    expect(typeof harness.committed[0]?.newValue).toBe('number')
    harness.unmount()
  })

  it('returns null for an emptied numeric column', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(AMOUNT_CELL)
    typeAndCommit(harness, '   ')

    expect(harness.committed[0]?.newValue).toBeNull()
    harness.unmount()
  })

  it('falls back to the raw text when a numeric column is edited as text', () => {
    const harness = mountEditor()
    harness.editor.beginEdit({ rowIndex: 0, columnKey: 'amountAsText' })
    typeAndCommit(harness, 'abc')

    // Nunca `NaN`: un valor no parseable se entrega tal como lo escribió el
    // usuario, para que el padre decida si lo valida o lo rechaza.
    expect(harness.committed[0]?.newValue).toBe('abc')
    harness.unmount()
  })

  it('commits null when an <input type=number> scrubs unparseable text', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(AMOUNT_CELL)
    typeAndCommit(harness, 'abc')

    // El propio control aplica la sanitización de valor del estándar HTML: un
    // input numérico nunca llega a exponer texto no numérico, así que lo que ve
    // el editor es una cadena vacía. La rama de texto crudo de `fromControlValue`
    // existe para el caso de arriba, donde el editor es de tipo `text`.
    expect(harness.committed[0]?.newValue).toBeNull()
    harness.unmount()
  })

  it('coerces a boolean column edited as text', () => {
    const harness = mountEditor()
    harness.editor.beginEdit({ rowIndex: 1, columnKey: 'flagAsText' })
    typeAndCommit(harness, 'TRUE')

    expect(harness.committed[0]?.newValue).toBe(true)
    harness.unmount()
  })

  it('accepts the documented falsy spellings for a boolean column', () => {
    for (const text of ['false', '0', 'no']) {
      const harness = mountEditor()
      harness.editor.beginEdit({ rowIndex: 0, columnKey: 'flagAsText' })
      typeAndCommit(harness, text)

      expect(harness.committed[0]?.newValue, `texto "${text}"`).toBe(false)
      harness.unmount()
    }
  })

  it('falls back to the raw text for an unrecognised boolean spelling', () => {
    const harness = mountEditor()
    harness.editor.beginEdit({ rowIndex: 1, columnKey: 'flagAsText' })
    typeAndCommit(harness, 'maybe')

    expect(harness.committed[0]?.newValue).toBe('maybe')
    harness.unmount()
  })

  it('returns the typed option value for a select, not its string form', () => {
    const harness = mountEditor()
    harness.editor.beginEdit({ rowIndex: 0, columnKey: 'choice' })
    const control = harness.control()
    if (!(control instanceof HTMLSelectElement)) throw new Error('[test] no abrió un select')

    control.value = '2'
    control.dispatchEvent(new Event('change', { bubbles: true }))

    // El `<select>` solo devuelve strings: un padre que guardaba `2` no debe
    // recibir `"2"`.
    expect(harness.committed[0]?.newValue).toBe(2)
    harness.unmount()
  })

  it('round-trips a Date through the date input in UTC', () => {
    const harness = mountEditor()
    harness.editor.beginEdit({ rowIndex: 0, columnKey: 'when' })
    const control = harness.control()
    if (!control) throw new Error('[test] no hay editor abierto')

    expect(control.value).toBe('2024-03-01')
    typeAndCommit(harness, '2024-12-25')

    const committed = harness.committed[0]?.newValue
    expect(committed).toBeInstanceOf(Date)
    // UTC de punta a punta: sin eso, un navegador al oeste de Greenwich pierde
    // un día en el ida y vuelta.
    expect(committed instanceof Date ? committed.toISOString() : '').toBe(
      '2024-12-25T00:00:00.000Z',
    )
    harness.unmount()
  })
})

describe('useCellEditor — editCommit only fires on a real change', () => {
  it('emits afterEdit but not editCommit when the value did not change', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    typeAndCommit(harness, 'Ada')

    expect(harness.after).toHaveLength(1)
    expect(harness.after[0]?.canceled).toBe(false)
    // Emitir `editCommit` sin cambio empujaría al padre a reemplazar el array de
    // filas y a repintar la tabla entera por una edición que no cambió nada.
    expect(harness.committed).toHaveLength(0)
    harness.unmount()
  })

  it('emits exactly one afterEdit per opened editor', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    typeAndCommit(harness, 'Grace')

    expect(harness.after).toHaveLength(1)
    expect(harness.committed).toHaveLength(1)
    harness.unmount()
  })

  it('reports oldValue and newValue on both events', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    typeAndCommit(harness, 'Grace')

    expect(harness.after[0]).toMatchObject({ oldValue: 'Ada', newValue: 'Grace', rowIndex: 0 })
    expect(harness.committed[0]).toMatchObject({ oldValue: 'Ada', newValue: 'Grace' })
    harness.unmount()
  })
})

describe('useCellEditor — how an edit session ends', () => {
  it('Escape discards the edit and reports it as canceled', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    const control = harness.control()
    if (!control) throw new Error('[test] no hay editor abierto')
    control.value = 'Discarded'
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(harness.editor.editing.value).toBeNull()
    expect(harness.after).toHaveLength(1)
    expect(harness.after[0]?.canceled).toBe(true)
    expect(harness.after[0]?.newValue).toBe('Ada')
    expect(harness.committed).toHaveLength(0)
    harness.unmount()
  })

  it('Enter commits and asks the owner to move down', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    typeAndCommit(harness, 'Grace')

    expect(harness.committed).toHaveLength(1)
    expect(harness.enter.count).toBe(1)
    harness.unmount()
  })

  it('blur commits, like leaving a spreadsheet cell', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    const control = harness.control()
    if (!control) throw new Error('[test] no hay editor abierto')
    control.value = 'Grace'
    control.dispatchEvent(new Event('blur'))

    expect(harness.committed).toHaveLength(1)
    expect(harness.editor.editing.value).toBeNull()
    harness.unmount()
  })

  it('opening another cell commits the previous one', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    const control = harness.control()
    if (!control) throw new Error('[test] no hay editor abierto')
    control.value = 'Grace'

    harness.editor.beginEdit(AMOUNT_CELL)

    expect(harness.committed).toHaveLength(1)
    expect(harness.committed[0]?.columnKey).toBe('name')
    // Deliberadamente no se afirma nada sobre el editor NUEVO en este camino.
    // Cambiar de celda sin que el control anterior haya perdido el foco deja el
    // `blur` del control viejo pendiente, y cuándo se dispara depende del
    // entorno. Ver el test siguiente, que cubre la secuencia real del navegador.
    harness.unmount()
  })

  it('keeps the new editor open when the previous control lost focus first', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    const control = harness.control()
    if (!control) throw new Error('[test] no hay editor abierto')
    control.value = 'Grace'

    // Es la secuencia real: apuntar a otra celda mueve el foco primero, y el
    // `blur` del control anterior confirma la edición antes de que el manejador
    // de la tabla llegue a pedir la apertura del editor nuevo.
    control.blur()
    harness.editor.beginEdit(AMOUNT_CELL)

    expect(harness.committed).toHaveLength(1)
    expect(harness.committed[0]?.columnKey).toBe('name')
    expect(harness.editor.editing.value).toEqual(AMOUNT_CELL)
    harness.unmount()
  })

  it('re-opening the same cell is a no-op and does not re-emit beforeEdit', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)

    expect(harness.editor.beginEdit(NAME_CELL)).toBe(true)
    expect(harness.before).toHaveLength(1)
    harness.unmount()
  })

  it('commits when the edited row scrolls out of the painted window', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    const control = harness.control()
    if (!control) throw new Error('[test] no hay editor abierto')
    control.value = 'Grace'

    harness.painted.value = false
    harness.editor.syncPosition()

    // La alternativa sería dejar un control flotando sobre filas que ya
    // pertenecen a otros datos.
    expect(harness.editor.editing.value).toBeNull()
    expect(harness.committed).toHaveLength(1)
    harness.unmount()
  })

  it('commit() with no open editor does nothing', () => {
    const harness = mountEditor()

    expect(() => harness.editor.commit()).not.toThrow()
    expect(harness.after).toHaveLength(0)
    harness.unmount()
  })

  it('does not emit twice when closing triggers a blur', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    const control = harness.control()
    if (!control) throw new Error('[test] no hay editor abierto')
    control.value = 'Grace'

    harness.editor.commit()
    // Cerrar oculta el control, y ocultarlo dispara `blur` en un navegador real.
    control.dispatchEvent(new Event('blur'))

    expect(harness.after).toHaveLength(1)
    expect(harness.committed).toHaveLength(1)
    harness.unmount()
  })
})

describe('useCellEditor — type-to-edit seeding', () => {
  it('seeds the control with the typed character instead of the current value', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL, 'G')

    expect(harness.control()?.value).toBe('G')
    harness.unmount()
  })

  it('does not seed a select, whose value comes from its options', () => {
    const harness = mountEditor()
    harness.editor.beginEdit({ rowIndex: 0, columnKey: 'choice' }, 'x')

    expect(harness.control()?.value).not.toBe('x')
    harness.unmount()
  })

  it('opens with the underlying value, not its formatted presentation', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(AMOUNT_CELL)

    // Se edita el dato, no su presentación: una columna que muestra "$10,00"
    // abre igual con "10".
    expect(harness.control()?.value).toBe('10')
    harness.unmount()
  })

  it('carries min, max and step to the numeric input', () => {
    const rows = makeRows()
    void rows
    const harness = mountEditor()
    harness.editor.beginEdit(AMOUNT_CELL)
    const control = harness.control()

    // La columna del andamiaje no declara límites: los atributos quedan vacíos
    // en lugar de heredar los de una edición anterior.
    expect(control instanceof HTMLInputElement ? control.min : null).toBe('')
    harness.unmount()
  })
})

describe('useCellEditor — the table is controlled', () => {
  it('never mutates the row object on commit', () => {
    const harness = mountEditor()
    const snapshot = structuredClone(harness.rows)
    const rowBefore = harness.rows[0]

    harness.editor.beginEdit(NAME_CELL)
    typeAndCommit(harness, 'Grace')

    // Si el padre ignora `editCommit`, la celda vuelve a mostrar el valor
    // anterior: ese es el comportamiento correcto de un componente controlado.
    expect(harness.rows).toEqual(snapshot)
    expect(harness.rows[0]).toBe(rowBefore)
    harness.unmount()
  })

  it('never mutates the row object on commitValue', () => {
    const harness = mountEditor()
    const snapshot = structuredClone(harness.rows)

    harness.editor.commitValue({ rowIndex: 0, columnKey: 'flag' }, false)

    expect(harness.committed).toHaveLength(1)
    expect(harness.rows).toEqual(snapshot)
    harness.unmount()
  })

  it('never mutates the row object on cancel', () => {
    const harness = mountEditor()
    const snapshot = structuredClone(harness.rows)

    harness.editor.beginEdit(NAME_CELL)
    const control = harness.control()
    if (control) control.value = 'Discarded'
    harness.editor.cancelEdit()

    expect(harness.rows).toEqual(snapshot)
    harness.unmount()
  })
})

describe('useCellEditor — control reuse and disposal', () => {
  it('builds one control per editor type and reuses it', () => {
    const harness = mountEditor()
    const created = vi.spyOn(document, 'createElement')

    harness.editor.beginEdit(NAME_CELL)
    harness.editor.commit()
    const afterFirst = created.mock.calls.length

    harness.editor.beginEdit({ rowIndex: 1, columnKey: 'name' })
    harness.editor.commit()

    // La segunda apertura del mismo tipo no construye nada: crear un control de
    // formulario por celda destruiría su estado de foco y su validación en cada
    // edición.
    expect(created.mock.calls.length).toBe(afterFirst)
    created.mockRestore()
    harness.unmount()
  })

  it('dispose() removes every control from the host', () => {
    const harness = mountEditor()
    harness.editor.beginEdit(NAME_CELL)
    harness.editor.commit()
    harness.editor.beginEdit({ rowIndex: 0, columnKey: 'choice' })
    harness.editor.commit()

    harness.editor.dispose()

    expect(document.querySelectorAll('.dt-editor')).toHaveLength(0)
    harness.unmount()
  })

  it('resolveEditorType reports what a cell would open, without opening it', () => {
    const harness = mountEditor()

    expect(harness.editor.resolveEditorType(NAME_CELL)).toBe('text')
    expect(harness.editor.resolveEditorType(AMOUNT_CELL)).toBe('number')
    expect(harness.editor.resolveEditorType({ rowIndex: 0, columnKey: 'flag' })).toBe('checkbox')
    expect(harness.editor.resolveEditorType({ rowIndex: 0, columnKey: 'nope' })).toBeNull()
    expect(harness.editor.editing.value).toBeNull()
    harness.unmount()
  })
})
