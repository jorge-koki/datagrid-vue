/**
 * Modo fila: que la columna deje de decidir lo que el usuario no puede ver.
 *
 * ## Qué protege este archivo
 *
 * `selectionMode: 'row'` nació como un solo cambio de pintado, y durante un
 * tiempo fue exactamente eso: una piel. Adentro la selección seguía siendo una
 * celda —fila MÁS columna— y todo lo que leía ese estado seguía funcionando como
 * en modo celda. Solo dos reglas de CSS escondían la celda.
 *
 * El resultado era lo peor de los dos mundos: la columna no se ve, pero la
 * columna sigue decidiendo. El encabezado marcaba una que la fila no decía, las
 * flechas la corrían sin que se viera nada moverse, `Ctrl`+`C` copiaba una sola
 * celda de una fila entera elegida, y `Enter` abría el editor de una celda que
 * el usuario nunca señaló.
 *
 * Cada `it` de aquí es uno de esos síntomas. Todos comparten una sola regla, y
 * es la que conviene tener en la cabeza al tocar cualquiera de ellos:
 *
 * > Si el usuario no puede VER en qué columna está, ninguna tecla puede moverlo
 * > por ellas ni decidir según cuál sea.
 *
 * Lo que NO cambia, y tiene su propia prueba abajo: editar sigue estando, por
 * doble clic, que es el gesto donde sí se señala una celda concreta.
 */
import { describe, expect, it } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { mountTable } from './harness'
import type { GridRow } from './harness'
import type { CellPosition, SelectionMode } from '../types'

const COLUMNS = [
  { key: 'id', width: 120 },
  // Editables a propósito: la mitad de este archivo mide POR QUÉ CAMINO se llega
  // a editar, y con columnas de solo lectura no se distinguiría "el modo no deja"
  // de "la columna no deja".
  { key: 'name', width: 200, editable: true },
  { key: 'city', width: 160, editable: true },
] as const

function rows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    name: `Fila ${index}`,
    city: `Ciudad ${index}`,
  }))
}

async function mountWith(selectionMode: SelectionMode) {
  return mountTable({
    viewport: { width: 700, height: 400 },
    props: { rows: rows(30), columns: COLUMNS, rowKey: 'id', selectionMode },
  })
}

/** Última posición anunciada por `update:activeCell`. */
function lastActiveCell(wrapper: VueWrapper): CellPosition | null {
  const events = wrapper.emitted('update:activeCell')
  if (!events || events.length === 0) throw new Error('[test] nunca se emitió update:activeCell')
  const payload: unknown = events[events.length - 1]?.[0]
  if (payload === null || payload === undefined) return null
  if (typeof payload !== 'object' || !('rowIndex' in payload) || !('columnKey' in payload)) {
    throw new Error('[test] update:activeCell emitió una forma inesperada')
  }
  return payload as CellPosition
}

describe('modo fila — el encabezado no marca ninguna columna', () => {
  it('no enciende ninguna cabecera al elegir una fila', async () => {
    const harness = await mountWith('row')
    await harness.clickCell(3, 'name')

    // Era el síntoma visible, y el que contradecía de frente a la propia
    // documentación: «en modo row la unidad seleccionada es la fila».
    expect(harness.grid.querySelectorAll('.dt-header-cell--active')).toHaveLength(0)

    harness.unmount()
  })

  it('en modo celda sí la enciende, que es donde la columna es parte de lo elegido', async () => {
    const harness = await mountWith('cell')
    await harness.clickCell(3, 'name')

    // El contraste importa: la marca no se borró de la hoja, se ató al modo.
    expect(harness.grid.querySelectorAll('.dt-header-cell--active')).toHaveLength(1)

    harness.unmount()
  })
})

describe('modo fila — ninguna tecla corre un cursor invisible', () => {
  it('las flechas horizontales no mueven la columna', async () => {
    const harness = await mountWith('row')
    await harness.clickCell(3, 'name')

    await harness.press('ArrowRight')
    await harness.press('ArrowRight')
    await harness.press('ArrowLeft')

    // Tres teclas y la posición intacta. Sin esto el usuario cambiaba de columna
    // a ciegas, y con ella cambiaba lo que iba a copiar y lo que iba a editar.
    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 3, columnKey: 'name' })

    harness.unmount()
  })

  it('las verticales sí mueven, que son las que recorren filas', async () => {
    const harness = await mountWith('row')
    await harness.clickCell(3, 'name')

    await harness.press('ArrowDown')

    expect(lastActiveCell(harness.wrapper)).toEqual({ rowIndex: 4, columnKey: 'name' })

    harness.unmount()
  })

  it('`Home` y `End` van a la primera y a la última FILA', async () => {
    const harness = await mountWith('row')
    await harness.clickCell(3, 'name')

    await harness.press('End')
    expect(lastActiveCell(harness.wrapper)?.rowIndex).toBe(29)

    await harness.press('Home')
    expect(lastActiveCell(harness.wrapper)?.rowIndex).toBe(0)

    // Sin esto quedaban llevando a una columna invisible: la fila no se movía y
    // la tecla se sentía muerta.
    harness.unmount()
  })
})

describe('modo fila — copiar devuelve la fila, no una celda', () => {
  it('copia todas las columnas visibles de la fila elegida', async () => {
    const harness = await mountWith('row')
    await harness.clickCell(2, 'name')

    const texto = await harness.copy()

    // Una línea —una fila— y una columna por cada visible. Antes devolvía el
    // valor de una sola celda: algo que el usuario nunca eligió, y que además no
    // podía ver cuál era.
    expect(texto).not.toBeNull()
    expect(texto?.split('\n')).toHaveLength(1)
    expect(texto?.split('\t')).toHaveLength(COLUMNS.length)
    expect(texto).toContain('Fila 2')
    expect(texto).toContain('Ciudad 2')

    harness.unmount()
  })

  it('no depende de en qué columna se hizo clic', async () => {
    const harness = await mountWith('row')
    await harness.clickCell(2, 'id')
    const desdeLaPrimera = await harness.copy()

    await harness.clickCell(2, 'city')
    const desdeLaUltima = await harness.copy()

    // La fila es la unidad: elegirla por un lado o por el otro es elegir lo
    // mismo, y lo que se copia tiene que ser idéntico.
    expect(desdeLaPrimera).toBe(desdeLaUltima)

    harness.unmount()
  })

  it('en modo celda sigue copiando solo la celda', async () => {
    const harness = await mountWith('cell')
    await harness.clickCell(2, 'name')

    const texto = await harness.copy()

    expect(texto).toBe('Fila 2')

    harness.unmount()
  })
})

describe('modo fila — editar sigue estando, pero solo donde se señala una celda', () => {
  it('`Enter` no abre el editor', async () => {
    const harness = await mountWith('row')
    await harness.clickCell(3, 'name')

    await harness.press('Enter')

    // No es que no se pueda editar: es que `Enter` no sabe QUÉ editar cuando no
    // hay una columna a la vista.
    expect(harness.editor()).toBeNull()

    harness.unmount()
  })

  it('escribir tampoco lo abre', async () => {
    const harness = await mountWith('row')
    await harness.clickCell(3, 'name')

    await harness.press('a')

    expect(harness.editor()).toBeNull()

    harness.unmount()
  })

  it('el doble clic sí, porque ahí la celda se señaló con el dedo', async () => {
    const harness = await mountWith('row')

    await harness.doubleClickCell(3, 'name')

    // La capacidad no se pierde con el modo. Quien la quiera apagar tiene
    // `editable: false` por columna y el veto de `beforeEdit`, que es donde esa
    // decisión pertenece.
    expect(harness.editor()).not.toBeNull()

    harness.unmount()
  })

  it('en modo celda `Enter` sigue abriendo', async () => {
    const harness = await mountWith('cell')
    await harness.clickCell(3, 'name')

    await harness.press('Enter')

    expect(harness.editor()).not.toBeNull()

    harness.unmount()
  })
})
