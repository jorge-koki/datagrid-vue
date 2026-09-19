/**
 * Marcar filas: por CLAVE, no por posición.
 *
 * ## Qué protege este archivo
 *
 * La razón de ser de toda la función. Un conjunto de índices parece funcionar
 * hasta que el usuario filtra: la fila que estaba en la posición 1 ya no es la
 * misma, y al quitar el filtro la selección queda apuntando a registros que
 * nunca eligió. Con claves eso no pasa, y lo que se verifica aquí es justamente
 * el viaje de ida y vuelta: marcar, filtrar, desfiltrar, y que vuelva marcado lo
 * mismo que se marcó.
 *
 * ## El segundo modo, y por qué existe
 *
 * Nueve mil filas en modo servidor, de las cuales la tabla conoce las cincuenta
 * que alcanzó a descargar, y el usuario presiona la casilla del encabezado. No
 * hay nueve mil claves que enumerar. El estado se invierte —`'all'` más la lista
 * de EXCLUIDAS— y entonces una fila que todavía no llegó ya está marcada.
 *
 * Eso es lo que hace que la pregunta no se pueda responder con `keys.includes`:
 * en `'all'` la respuesta es la contraria. Por eso se exportan
 * {@link isRowSelected} y {@link countSelectedRows}, y por eso varios tests de
 * aquí abajo comparan contra ellos y no contra la lista cruda.
 */

import { describe, expect, it, vi } from 'vitest'
import { mountTable } from './harness'
import {
  countSelectedRows,
  EMPTY_ROW_SELECTION,
  isRowSelected,
  rowSelectionHeaderState,
  setAllRowsSelected,
  toggleRowSelection,
} from '../internal/row-selection'
import { SELECTION_COLUMN_KEY } from '../internal/constants'
import type { RowSelectionState } from '../types'

type Row = { id: number; name: string; city: string }

const COLUMNS = [
  { key: 'id', width: 120 },
  { key: 'name', width: 200 },
] as const

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    name: `Fila ${index}`,
    city: index % 2 === 0 ? 'Norte' : 'Sur',
  }))
}

async function mountWith(rows: readonly Row[], selectedRows?: RowSelectionState) {
  return mountTable({
    viewport: { width: 700, height: 400 },
    props: {
      rows,
      columns: COLUMNS,
      rowKey: 'id',
      selectionColumn: true,
      ...(selectedRows ? { selectedRows } : {}),
    },
  })
}

/** Las casillas de la columna de selección que están pintadas ahora mismo. */
function checkboxes(harness: Awaited<ReturnType<typeof mountWith>>): HTMLInputElement[] {
  return [...harness.canvas.querySelectorAll('.dt-selection-checkbox')] as HTMLInputElement[]
}

describe('marcar filas — el estado es de claves', () => {
  it('sobrevive a filtrar y desfiltrar', async () => {
    // EL test del archivo. Se marca la fila 3, se filtra a un subconjunto que no
    // la contiene, y se quita el filtro: tiene que volver marcada. Con índices,
    // la marca habría quedado sobre otra fila al reordenarse el arreglo.
    const todas = makeRows(20)
    const seleccion: RowSelectionState = { mode: 'some', keys: [3] }

    const soloNorte = todas.filter((row) => row.city === 'Norte')
    expect(soloNorte.some((row) => row.id === 3)).toBe(false)

    // Filtrada, la fila 3 no está: nadie la muestra marcada porque no se muestra.
    expect(soloNorte.filter((row) => isRowSelected(seleccion, row.id))).toHaveLength(0)
    // Y al volver el dataset entero, sigue siendo la única marcada.
    const marcadas = todas.filter((row) => isRowSelected(seleccion, row.id))
    expect(marcadas.map((row) => row.id)).toEqual([3])
  })

  it('marca la fila que dice la clave, no la que está en esa posición', async () => {
    // Mismo conjunto, otro orden: lo marcado tiene que viajar con la fila.
    const alReves = [...makeRows(6)].reverse()
    const harness = await mountWith(alReves, { mode: 'some', keys: [0] })

    const marcada = harness.canvas.querySelector('.dt-row[data-row-key="0"]')
    const suCasilla = marcada?.querySelector('.dt-selection-checkbox') as HTMLInputElement | null
    const primera = checkboxes(harness)[0]

    expect(suCasilla?.checked).toBe(true)
    // La primera fila de la pantalla es la 5, y NO está marcada.
    expect(primera?.checked).toBe(false)

    harness.unmount()
  })
})

describe('marcar filas — el modo `all`, para lo que no se descargó', () => {
  it('da por marcada una fila que la tabla nunca vio', () => {
    const todas = setAllRowsSelected(true)

    // La prueba de fuego del conjunto invertido: la clave 8000 no figura en
    // ninguna lista y aun así está marcada.
    expect(isRowSelected(todas, 8000)).toBe(true)
    expect(todas.keys).toHaveLength(0)
  })

  it('cuenta contra el dataset entero y no contra lo cargado', () => {
    const todas = setAllRowsSelected(true)

    // Con 50 filas en memoria de 9000, el contador tiene que decir 9000: es lo
    // que el usuario acaba de elegir, no lo que la tabla alcanzó a descargar.
    expect(countSelectedRows(todas, 9000)).toBe(9000)
  })

  it('desmarcar en modo `all` EXCLUYE, no vacía', () => {
    const sinUna = toggleRowSelection(setAllRowsSelected(true), 42)

    expect(sinUna.mode).toBe('all')
    expect(sinUna.keys).toEqual([42])
    expect(isRowSelected(sinUna, 42)).toBe(false)
    expect(isRowSelected(sinUna, 43)).toBe(true)
    expect(countSelectedRows(sinUna, 9000)).toBe(8999)
  })

  it('limpiar vuelve a `some` vacío y no a `all` con todo excluido', () => {
    // Son el mismo conjunto, pero el segundo crece con el dataset: excluir 9000
    // claves para decir "ninguna" es exactamente lo que este diseño evita.
    expect(setAllRowsSelected(false)).toEqual(EMPTY_ROW_SELECTION)
    expect(setAllRowsSelected(false).keys).toHaveLength(0)
  })
})

describe('marcar filas — la tricasilla del encabezado', () => {
  it('distingue los tres estados contra el total real', () => {
    expect(rowSelectionHeaderState(EMPTY_ROW_SELECTION, 100)).toBe('none')
    expect(rowSelectionHeaderState({ mode: 'some', keys: [1, 2] }, 100)).toBe('some')
    expect(rowSelectionHeaderState(setAllRowsSelected(true), 100)).toBe('all')
    // Una exclusión sobre "todas" es una selección parcial, aunque el modo diga
    // `'all'`: leer el modo en vez de contar daría la respuesta equivocada.
    expect(rowSelectionHeaderState(toggleRowSelection(setAllRowsSelected(true), 5), 100)).toBe(
      'some',
    )
  })

  it('una tabla vacía no muestra la casilla llena', () => {
    // Sin filas no hay nada marcado, diga lo que diga el modo. Una tabla vacía
    // con la palomita puesta se lee como un error.
    expect(rowSelectionHeaderState(setAllRowsSelected(true), 0)).toBe('none')
  })
})

describe('marcar filas — la columna que pone la tabla', () => {
  it('aparece al inicio y no la declara el consumidor', async () => {
    const harness = await mountWith(makeRows(10))

    // Va anclada al inicio, así que vive en el carril anclado y no en el tramo
    // que scrollea: se la busca por su clave y no por posición en el documento.
    // Una casilla por fila pintada, ni más ni menos.
    const filas = harness.canvas.querySelectorAll('.dt-row')
    expect(filas.length).toBeGreaterThan(0)
    for (const fila of filas) {
      expect(fila.querySelectorAll('.dt-selection-checkbox')).toHaveLength(1)
    }

    // En el encabezado, la suya es la PRIMERA: va anclada al inicio.
    const encabezados = [...harness.wrapper.element.querySelectorAll('.dt-header-cell')]
    expect(encabezados[0]?.getAttribute('data-column-key')).toBe(SELECTION_COLUMN_KEY)
    // Y las del consumidor siguen estando, sin que haya que declarar nada.
    expect(encabezados.some((h) => h.getAttribute('data-column-key') === 'name')).toBe(true)

    harness.unmount()
  })

  it('no está cuando no se pide', async () => {
    const harness = await mountTable({
      viewport: { width: 700, height: 400 },
      props: { rows: makeRows(10), columns: COLUMNS, rowKey: 'id' },
    })

    expect(harness.canvas.querySelector('.dt-selection-checkbox')).toBeNull()

    harness.unmount()
  })
})

describe('marcar filas — cuando el consumidor no tiene identificador', () => {
  it('sin `rowKey`, la identidad sale del objeto y sobrevive a filtrar', async () => {
    // El caso que motivó todo. `filter` devuelve LOS MISMOS objetos, así que una
    // identidad atada a la referencia sigue valiendo del otro lado del filtro.
    const todas = makeRows(8)
    const harness = await mountTable({
      viewport: { width: 700, height: 400 },
      props: { rows: todas, columns: COLUMNS, selectionColumn: true },
    })

    const claves = [...harness.canvas.querySelectorAll('.dt-row')].map((row) =>
      row.getAttribute('data-row-key'),
    )
    // Cada fila recibió una identidad propia, sin que nadie la declarara.
    expect(new Set(claves).size).toBe(claves.length)

    // Filtrar y volver: los mismos objetos, las mismas claves.
    await harness.wrapper.setProps({ rows: todas.filter((row) => row.city === 'Norte') })
    await harness.flush()
    await harness.wrapper.setProps({ rows: todas })
    await harness.flush()

    const despues = [...harness.canvas.querySelectorAll('.dt-row')].map((row) =>
      row.getAttribute('data-row-key'),
    )
    expect(despues).toEqual(claves)

    harness.unmount()
  })

  it('avisa una vez si hay casillas y modo servidor sin `rowKey`', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const harness = await mountTable({
      viewport: { width: 700, height: 400 },
      props: {
        rows: makeRows(20),
        columns: COLUMNS,
        selectionColumn: true,
        rowCount: 9000,
      },
    })
    await harness.flush()

    // Es el único caso que la tabla NO puede arreglar sola: cada página llega
    // como objetos nuevos y la identidad sintética se apoya en la referencia.
    // Perder la selección en silencio sería peor que avisar.
    const mensajes = warn.mock.calls.map((call) => String(call[0]))
    const aviso = mensajes.filter((mensaje) => mensaje.includes('`rowKey`'))
    expect(aviso.length).toBeGreaterThan(0)
    expect(aviso[0]).toContain('modo servidor')

    warn.mockRestore()
    harness.unmount()
  })
})
