/**
 * Reconciliación del estado persistido contra las columnas actuales.
 *
 * El escenario que cubre este archivo es siempre el mismo: el estado guardado es
 * viejo por definición. Entre la sesión en que el usuario acomodó la tabla y la
 * sesión en que vuelve, alguien agregó columnas, borró otras, renombró una clave
 * o apretó los límites de ancho. Todo lo que sale de acá tiene que ser válido
 * HOY, sin importar lo que dijera el payload.
 */

import { describe, expect, it } from 'vitest'
import {
  isPersistedTableState,
  reconcileColumnOrder,
  reconcileColumnVisibility,
  reconcileColumnWidths,
  reconcilePersistedState,
} from '../internal/reconcile'
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../internal/constants'
import type { DataTableColumn, PersistedTableState } from '../types'

type Row = { a: string; b: string; c: string }

const COLUMNS: readonly DataTableColumn<Row>[] = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

describe('reconcileColumnOrder — the result is always a permutation of today', () => {
  it('keeps the saved order when nothing changed', () => {
    expect(reconcileColumnOrder(['c', 'a', 'b'], COLUMNS)).toEqual(['c', 'a', 'b'])
  })

  it('drops keys of columns that no longer exist', () => {
    expect(reconcileColumnOrder(['ghost', 'c', 'a', 'b'], COLUMNS)).toEqual(['c', 'a', 'b'])
  })

  it('appends a column added after the save, in declaration order', () => {
    const columns: readonly DataTableColumn<Row>[] = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

    // El estado guardado no conoce `c`: aparece al final, no en una posición
    // arbitraria ni delante de lo que el usuario acomodó.
    expect(reconcileColumnOrder(['b', 'a'], columns)).toEqual(['b', 'a', 'c'])
  })

  it('collapses duplicate keys so no column can occupy two slots', () => {
    expect(reconcileColumnOrder(['a', 'a', 'b'], COLUMNS)).toEqual(['a', 'b', 'c'])
  })

  it('returns declaration order for an empty saved order', () => {
    expect(reconcileColumnOrder([], COLUMNS)).toEqual(['a', 'b', 'c'])
  })

  it('contains every current key exactly once, with no ghosts and no duplicates', () => {
    const result = reconcileColumnOrder(['x', 'c', 'c', 'y', 'a'], COLUMNS)

    expect([...result].sort()).toEqual(['a', 'b', 'c'])
    expect(new Set(result).size).toBe(result.length)
  })
})

describe('reconcileColumnVisibility — a new column is never born invisible', () => {
  it('keeps the saved visibility of columns that still exist', () => {
    expect(reconcileColumnVisibility({ a: false, b: true }, COLUMNS)).toEqual({
      a: false,
      b: true,
      c: true,
    })
  })

  it('shows a column added after the save instead of hiding it', () => {
    const result = reconcileColumnVisibility({ a: true, b: true }, COLUMNS)

    // Este es el peor error posible de esta función: leer "ausente" como
    // `false` dejaría la columna nueva invisible y sin forma de descubrirla.
    expect(result.c).toBe(true)
  })

  it('honours defaultVisible for a column the saved state does not mention', () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { key: 'a' },
      { key: 'b', defaultVisible: false },
    ]

    expect(reconcileColumnVisibility({}, columns)).toEqual({ a: true, b: false })
  })

  it('lets the saved state override defaultVisible', () => {
    const columns: readonly DataTableColumn<Row>[] = [{ key: 'a', defaultVisible: false }]

    expect(reconcileColumnVisibility({ a: true }, columns)).toEqual({ a: true })
  })

  it('drops visibility entries of removed columns', () => {
    const result = reconcileColumnVisibility({ ghost: false, a: false }, COLUMNS)

    expect(Object.keys(result).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('reconcileColumnWidths — saved widths are re-clamped to today constraints', () => {
  it('keeps a width that is still legal', () => {
    expect(reconcileColumnWidths({ a: 200 }, COLUMNS)).toEqual({ a: 200 })
  })

  it('clamps a saved width when the developer tightened maxWidth', () => {
    const columns: readonly DataTableColumn<Row>[] = [{ key: 'a', maxWidth: 150 }]

    expect(reconcileColumnWidths({ a: 900 }, columns)).toEqual({ a: 150 })
  })

  it('clamps a saved width when the developer raised minWidth', () => {
    const columns: readonly DataTableColumn<Row>[] = [{ key: 'a', minWidth: 300 }]

    expect(reconcileColumnWidths({ a: 80 }, columns)).toEqual({ a: 300 })
  })

  it('applies the global bounds to a hand-edited value', () => {
    expect(reconcileColumnWidths({ a: 1, b: 999_999 }, COLUMNS)).toEqual({
      a: MIN_COLUMN_WIDTH,
      b: MAX_COLUMN_WIDTH,
    })
  })

  it('discards a non-finite width instead of clamping it', () => {
    // `NaN` no tiene una posición sensata dentro de un rango: se descarta y la
    // columna vuelve a su ancho declarado.
    expect(reconcileColumnWidths({ a: Number.NaN, b: Number.POSITIVE_INFINITY }, COLUMNS)).toEqual(
      {},
    )
  })

  it('drops widths of removed columns', () => {
    expect(reconcileColumnWidths({ ghost: 200, a: 180 }, COLUMNS)).toEqual({ a: 180 })
  })
})

describe('reconcilePersistedState — the three axes at once', () => {
  it('rebuilds a state that is valid against the current columns', () => {
    const saved: PersistedTableState = {
      version: 1,
      columnVisibility: { a: false, ghost: true },
      columnWidths: { a: 5, ghost: 100 },
      columnOrder: ['ghost', 'b', 'a'],
    }

    expect(reconcilePersistedState(saved, COLUMNS)).toEqual({
      version: 1,
      columnVisibility: { a: false, b: true, c: true },
      columnWidths: { a: MIN_COLUMN_WIDTH },
      columnOrder: ['b', 'a', 'c'],
    })
  })

  it('preserves the version untouched, because validating it is the caller job', () => {
    const saved: PersistedTableState = {
      version: 7,
      columnVisibility: {},
      columnWidths: {},
      columnOrder: [],
    }

    expect(reconcilePersistedState(saved, COLUMNS).version).toBe(7)
  })
})

describe('isPersistedTableState — storage content is untrusted input', () => {
  const valid: PersistedTableState = {
    version: 1,
    columnVisibility: { a: true },
    columnWidths: { a: 100 },
    columnOrder: ['a'],
  }

  it('accepts a well-formed payload', () => {
    expect(isPersistedTableState(valid)).toBe(true)
  })

  it('rejects null and primitives without throwing', () => {
    expect(isPersistedTableState(null)).toBe(false)
    expect(isPersistedTableState(undefined)).toBe(false)
    expect(isPersistedTableState('{}')).toBe(false)
    expect(isPersistedTableState(42)).toBe(false)
  })

  it('rejects an array, which JSON.parse produces just as easily as an object', () => {
    expect(isPersistedTableState([])).toBe(false)
  })

  it('rejects a missing or non-numeric version', () => {
    expect(isPersistedTableState({ ...valid, version: undefined })).toBe(false)
    expect(isPersistedTableState({ ...valid, version: '1' })).toBe(false)
    expect(isPersistedTableState({ ...valid, version: Number.NaN })).toBe(false)
  })

  it('rejects a visibility map with a non-boolean value', () => {
    expect(isPersistedTableState({ ...valid, columnVisibility: { a: 'yes' } })).toBe(false)
  })

  it('rejects a widths map with a non-finite value', () => {
    expect(isPersistedTableState({ ...valid, columnWidths: { a: Number.NaN } })).toBe(false)
    expect(isPersistedTableState({ ...valid, columnWidths: { a: '100' } })).toBe(false)
  })

  it('rejects an order that is not an array of strings', () => {
    expect(isPersistedTableState({ ...valid, columnOrder: 'a,b' })).toBe(false)
    expect(isPersistedTableState({ ...valid, columnOrder: ['a', 2] })).toBe(false)
  })

  it('rejects a payload truncated halfway through a write', () => {
    expect(isPersistedTableState({ version: 1, columnVisibility: { a: true } })).toBe(false)
  })
})

describe('corrupted JSON is rejected without throwing', () => {
  it('survives anything JSON.parse can produce', () => {
    const payloads = ['null', '[]', '"text"', '3', 'true', '{"version":"1"}', '{}']

    for (const payload of payloads) {
      const parsed: unknown = JSON.parse(payload)
      expect(() => isPersistedTableState(parsed)).not.toThrow()
      expect(isPersistedTableState(parsed)).toBe(false)
    }
  })
})
