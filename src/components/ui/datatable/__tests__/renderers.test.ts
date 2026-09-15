/**
 * Renderers incluidos, con foco en los valores inesperados.
 *
 * Una celda que recibe el valor que su renderer espera es el caso fácil. Lo que
 * rompe en producción es la fila con el campo en `null`, el porcentaje que llegó
 * como string, la opción que alguien borró del catálogo y la lista que resultó
 * ser un escalar. En todos esos casos el renderer tiene que mostrar ALGO: una
 * celda vacía es indistinguible de un dato faltante y esconde el problema.
 */

import { describe, expect, it } from 'vitest'
import {
  avatarRenderer,
  badgeRenderer,
  checkboxRenderer,
  numberRenderer,
  progressRenderer,
  resolveRenderer,
  revertCheckbox,
  selectRenderer,
  tagsRenderer,
  textRenderer,
  TEXT_RENDERER_TYPE,
} from '../internal/renderers'
import type { AnyCellRenderer } from '../internal/renderers'
import { toCellValue } from '../internal/values'
import type { CellOption, CellRenderContext, DataTableColumn } from '../types'

type Row = { value: unknown }

const OPTIONS: readonly CellOption[] = [
  { value: 'open', label: 'Open', color: 'var(--dt-color-blue)' },
  { value: 1, label: 'One', color: 'var(--dt-color-green)' },
]

/** Celda montada con un renderer, lista para recibir valores sucesivos. */
interface Rendered {
  cell: HTMLElement
  /** Repinta la celda con otro valor crudo. */
  update(raw: unknown): void
  destroy(): void
}

function render(
  renderer: AnyCellRenderer,
  raw: unknown,
  column: DataTableColumn<Row> = { key: 'value' },
): Rendered {
  const cell = document.createElement('div')
  cell.className = 'dt-cell'
  document.body.appendChild(cell)
  const handle = renderer.create(cell)

  function paint(next: unknown): void {
    const ctx: CellRenderContext<Row> = {
      value: toCellValue(next),
      raw: next,
      row: { value: next },
      rowIndex: 0,
      column,
      isEditing: false,
    }
    renderer.update(handle, ctx)
  }

  paint(raw)

  return {
    cell,
    update: paint,
    destroy(): void {
      renderer.destroy?.(handle)
      cell.remove()
    },
  }
}

describe('resolveRenderer — unknown names degrade to text', () => {
  it('returns the text renderer when the column declares none', () => {
    expect(resolveRenderer(undefined).type).toBe(TEXT_RENDERER_TYPE)
  })

  it('returns the text renderer for a name nobody registered', () => {
    // Una columna con un typo en el nombre del renderer tiene que mostrar el
    // dato igual, no dejar la celda en blanco.
    expect(resolveRenderer('does-not-exist').type).toBe(TEXT_RENDERER_TYPE)
  })

  it('returns a custom renderer instance untouched', () => {
    expect(resolveRenderer(badgeRenderer).type).toBe('badge')
  })
})

describe('text renderer', () => {
  it('shows an empty cell for null and undefined', () => {
    expect(render(textRenderer, null).cell.textContent).toBe('')
    expect(render(textRenderer, undefined).cell.textContent).toBe('')
  })

  it('stringifies a number', () => {
    expect(render(textRenderer, 42).cell.textContent).toBe('42')
  })

  it('renders a Date as ISO, not as a locale string', () => {
    // Construir un formateador `Intl` por celda y por frame dominaría el
    // presupuesto de pintado. Para fechas orientadas a personas está `format`.
    const rendered = render(textRenderer, new Date('2024-03-01T00:00:00Z'))

    expect(rendered.cell.textContent).toBe('2024-03-01T00:00:00.000Z')
  })

  it('renders an invalid Date as an empty string', () => {
    expect(render(textRenderer, new Date('nonsense')).cell.textContent).toBe('')
  })

  it('makes an unmapped object visible as [object Object] instead of hiding it', () => {
    // Es una señal deliberada: esa columna necesita `accessor` o `format`.
    expect(render(textRenderer, { a: 1 }).cell.textContent).toBe('[object Object]')
  })

  it('uses the column format hook when present', () => {
    const column: DataTableColumn<Row> = { key: 'value', format: (value) => `#${String(value)}` }

    expect(render(textRenderer, 7, column).cell.textContent).toBe('#7')
  })
})

describe('number renderer', () => {
  it('aligns right by default', () => {
    expect(numberRenderer.defaultAlign).toBe('right')
  })

  it('formats a number with locale separators', () => {
    const text = render(numberRenderer, 1234567).cell.textContent ?? ''

    // No se fija el separador exacto: depende del locale del entorno. Lo que se
    // verifica es que se agrupó, que es lo que el renderer promete.
    expect(text).not.toBe('1234567')
    expect(text.replace(/\D/g, '')).toBe('1234567')
  })

  it('parses a numeric string', () => {
    expect(render(numberRenderer, '42').cell.textContent).toBe('42')
  })

  it('shows an empty cell for a non-numeric string', () => {
    expect(render(numberRenderer, 'abc').cell.textContent).toBe('')
  })

  it('shows an empty cell for null, NaN and Infinity', () => {
    expect(render(numberRenderer, null).cell.textContent).toBe('')
    expect(render(numberRenderer, Number.NaN).cell.textContent).toBe('')
    expect(render(numberRenderer, Number.POSITIVE_INFINITY).cell.textContent).toBe('')
  })

  it('lets the column format hook override the formatter entirely', () => {
    const column: DataTableColumn<Row> = { key: 'value', format: () => 'custom' }

    expect(render(numberRenderer, 1000, column).cell.textContent).toBe('custom')
  })
})

describe('badge renderer', () => {
  const column: DataTableColumn<Row> = { key: 'value', options: OPTIONS }

  it('shows the option label and colour for a known value', () => {
    const rendered = render(badgeRenderer, 'open', column)
    const pill = rendered.cell.querySelector('.dt-badge')

    expect(pill?.textContent).toBe('Open')
    expect(rendered.cell.querySelector('.dt-badge'))
    expect(pill instanceof HTMLElement ? pill.style.getPropertyValue('--dt-badge-color') : '').toBe(
      'var(--dt-color-blue)',
    )
  })

  it('matches an option by string form, so "1" finds the option whose value is 1', () => {
    expect(render(badgeRenderer, '1', column).cell.querySelector('.dt-badge')?.textContent).toBe(
      'One',
    )
  })

  it('shows the raw value for an unknown option, never a blank pill', () => {
    // Una opción borrada del catálogo dejaría la celda vacía y el usuario no
    // tendría forma de saber qué valor tiene la fila.
    expect(
      render(badgeRenderer, 'archived', column).cell.querySelector('.dt-badge')?.textContent,
    ).toBe('archived')
  })

  it('falls back to the neutral colour for an unknown option', () => {
    const pill = render(badgeRenderer, 'archived', column).cell.querySelector('.dt-badge')

    expect(pill instanceof HTMLElement ? pill.style.getPropertyValue('--dt-badge-color') : '').toBe(
      'var(--dt-color-neutral)',
    )
  })

  it('shows an empty pill for null', () => {
    expect(render(badgeRenderer, null, column).cell.querySelector('.dt-badge')?.textContent).toBe(
      '',
    )
  })

  it('works with no options at all', () => {
    expect(render(badgeRenderer, 'anything').cell.querySelector('.dt-badge')?.textContent).toBe(
      'anything',
    )
  })
})

describe('select renderer', () => {
  const column: DataTableColumn<Row> = { key: 'value', options: OPTIONS }

  it('renders a badge plus a chevron', () => {
    const rendered = render(selectRenderer, 'open', column)

    expect(rendered.cell.querySelector('.dt-badge')?.textContent).toBe('Open')
    expect(rendered.cell.querySelector('.dt-select-chevron')).not.toBeNull()
  })

  it('hides the chevron from assistive technology', () => {
    const chevron = render(selectRenderer, 'open', column).cell.querySelector('.dt-select-chevron')

    expect(chevron?.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows the raw value for an unknown option', () => {
    expect(
      render(selectRenderer, 'gone', column).cell.querySelector('.dt-badge')?.textContent,
    ).toBe('gone')
  })
})

/** Circunferencia del anillo del renderer `progress`, con radio 13. */
const CIRCUMFERENCE = 2 * Math.PI * 13

describe('progress renderer', () => {
  function offsetOf(cell: HTMLElement): number {
    return Number(cell.querySelector('.dt-progress-value')?.getAttribute('stroke-dashoffset'))
  }

  it('renders a whole percentage label', () => {
    expect(
      render(progressRenderer, 42.4).cell.querySelector('.dt-progress-label')?.textContent,
    ).toBe('42%')
  })

  it('clamps a negative value to zero', () => {
    const rendered = render(progressRenderer, -50)

    expect(rendered.cell.querySelector('.dt-progress-label')?.textContent).toBe('0%')
    expect(offsetOf(rendered.cell)).toBeCloseTo(CIRCUMFERENCE)
  })

  it('clamps a value above one hundred', () => {
    const rendered = render(progressRenderer, 150)

    expect(rendered.cell.querySelector('.dt-progress-label')?.textContent).toBe('100%')
    // Anillo completo: el trazo no tiene desplazamiento.
    expect(offsetOf(rendered.cell)).toBeCloseTo(0)
  })

  it('treats NaN as zero instead of producing an invalid SVG attribute', () => {
    const rendered = render(progressRenderer, Number.NaN)

    expect(rendered.cell.querySelector('.dt-progress-label')?.textContent).toBe('0%')
    expect(Number.isNaN(offsetOf(rendered.cell))).toBe(false)
  })

  it('treats null and a non-numeric string as zero', () => {
    expect(
      render(progressRenderer, null).cell.querySelector('.dt-progress-label')?.textContent,
    ).toBe('0%')
    expect(
      render(progressRenderer, 'abc').cell.querySelector('.dt-progress-label')?.textContent,
    ).toBe('0%')
  })

  it('parses a numeric string', () => {
    expect(
      render(progressRenderer, '75').cell.querySelector('.dt-progress-label')?.textContent,
    ).toBe('75%')
  })

  it('picks the colour band from the percentage', () => {
    const bands: readonly [number, string][] = [
      [10, 'var(--dt-color-red)'],
      [45, 'var(--dt-color-amber)'],
      [80, 'var(--dt-color-blue)'],
      [100, 'var(--dt-color-green)'],
    ]

    for (const [percent, token] of bands) {
      const root = render(progressRenderer, percent).cell.querySelector('.dt-progress')

      expect(
        root instanceof HTMLElement ? root.style.getPropertyValue('--dt-progress-color') : '',
        `porcentaje ${percent}`,
      ).toBe(token)
    }
  })
})

describe('avatar renderer', () => {
  function initialsOf(cell: HTMLElement): string {
    return cell.querySelector('.dt-avatar-initials')?.textContent ?? ''
  }

  function colourOf(cell: HTMLElement): string {
    const root = cell.querySelector('.dt-avatar')
    return root instanceof HTMLElement ? root.style.getPropertyValue('--dt-avatar-color') : ''
  }

  it('takes the first letter of the first and last word', () => {
    expect(initialsOf(render(avatarRenderer, 'Ada Lovelace').cell)).toBe('AL')
  })

  it('takes a single initial from a single word', () => {
    expect(initialsOf(render(avatarRenderer, 'Ada').cell)).toBe('A')
  })

  it('skips the middle words', () => {
    expect(initialsOf(render(avatarRenderer, 'Ada King Byron Lovelace').cell)).toBe('AL')
  })

  it('ignores surrounding and repeated whitespace', () => {
    expect(initialsOf(render(avatarRenderer, '   Ada   Lovelace  ').cell)).toBe('AL')
  })

  it('renders no initials for an empty or blank name', () => {
    expect(initialsOf(render(avatarRenderer, '').cell)).toBe('')
    expect(initialsOf(render(avatarRenderer, '    ').cell)).toBe('')
    expect(initialsOf(render(avatarRenderer, null).cell)).toBe('')
  })

  it('reads name and src out of an object value', () => {
    const rendered = render(avatarRenderer, { name: 'Ada Lovelace', src: 'https://x/a.png' })
    const image = rendered.cell.querySelector('.dt-avatar-image')

    expect(image instanceof HTMLImageElement ? image.src : '').toContain('a.png')
    expect(image instanceof HTMLElement ? image.hidden : true).toBe(false)
    // Con foto, las iniciales se ocultan en lugar de dibujarse debajo.
    expect(rendered.cell.querySelector('.dt-avatar-initials') instanceof HTMLElement).toBe(true)
    const initials = rendered.cell.querySelector('.dt-avatar-initials')
    expect(initials instanceof HTMLElement ? initials.hidden : false).toBe(true)
  })

  it('keeps the name as the image alt text', () => {
    const rendered = render(avatarRenderer, { name: 'Ada Lovelace', src: 'https://x/a.png' })
    const image = rendered.cell.querySelector('.dt-avatar-image')

    expect(image instanceof HTMLImageElement ? image.alt : '').toBe('Ada Lovelace')
  })

  it('falls back to initials when the object has no src', () => {
    const rendered = render(avatarRenderer, { name: 'Ada Lovelace' })
    const image = rendered.cell.querySelector('.dt-avatar-image')

    expect(image instanceof HTMLElement ? image.hidden : false).toBe(true)
    expect(initialsOf(rendered.cell)).toBe('AL')
  })

  it('derives the same colour for the same name on two separate nodes', () => {
    const first = render(avatarRenderer, 'Ada Lovelace').cell
    const second = render(avatarRenderer, 'Ada Lovelace').cell

    // El color sale de un hash del nombre: la misma persona tiene que verse
    // igual en cualquier tabla y en cualquier fila.
    expect(colourOf(first)).toBe(colourOf(second))
    expect(colourOf(first)).not.toBe('')
  })

  it('derives a neutral colour for an empty name', () => {
    expect(colourOf(render(avatarRenderer, '').cell)).toBe('var(--dt-color-neutral)')
  })

  it('keeps the colour stable when the same cell repaints the same name', () => {
    const rendered = render(avatarRenderer, 'Ada Lovelace')
    const before = colourOf(rendered.cell)
    rendered.update('Grace Hopper')
    rendered.update('Ada Lovelace')

    expect(colourOf(rendered.cell)).toBe(before)
  })
})

describe('checkbox renderer', () => {
  const editable: DataTableColumn<Row> = { key: 'value', editable: true }

  function inputOf(cell: HTMLElement): HTMLInputElement {
    const input = cell.querySelector('.dt-checkbox')
    if (!(input instanceof HTMLInputElement)) throw new Error('[test] no se construyó la casilla')
    return input
  }

  it('centers itself by default', () => {
    expect(checkboxRenderer.defaultAlign).toBe('center')
  })

  it('reflects a true value', () => {
    expect(inputOf(render(checkboxRenderer, true, editable).cell).checked).toBe(true)
  })

  it('reflects a false value', () => {
    expect(inputOf(render(checkboxRenderer, false, editable).cell).checked).toBe(false)
  })

  it('shows null as indeterminate rather than unchecked', () => {
    // Un dato faltante no es lo mismo que un "no": mostrarlo destildado mentiría.
    const input = inputOf(render(checkboxRenderer, null, editable).cell)

    expect(input.indeterminate).toBe(true)
    expect(input.checked).toBe(false)
  })

  it('disables itself when the column is not editable', () => {
    expect(inputOf(render(checkboxRenderer, true).cell).disabled).toBe(true)
  })

  it('stays out of the tab order, because 450 checkboxes would make the table untraversable', () => {
    expect(inputOf(render(checkboxRenderer, true, editable).cell).tabIndex).toBe(-1)
  })

  it('revertCheckbox flips the control back to what the state says', () => {
    const input = inputOf(render(checkboxRenderer, false, editable).cell)
    input.checked = true

    revertCheckbox(input)

    // El DOM vuelve a estar gobernado por el estado: el clic es solo una
    // intención que la tubería de edición puede rechazar.
    expect(input.checked).toBe(false)
  })
})

describe('tags renderer', () => {
  const column: DataTableColumn<Row> = { key: 'value', options: OPTIONS }

  function visiblePills(cell: HTMLElement): HTMLElement[] {
    return [...cell.querySelectorAll('.dt-tag')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && !node.hidden,
    )
  }

  it('renders one pill per array entry', () => {
    expect(visiblePills(render(tagsRenderer, ['a', 'b', 'c']).cell)).toHaveLength(3)
  })

  it('renders a single pill for a scalar value', () => {
    // Una columna declarada como lista puede traer un escalar desde el backend;
    // mostrarlo es mejor que no mostrar nada.
    const pills = visiblePills(render(tagsRenderer, 'solo').cell)

    expect(pills).toHaveLength(1)
    expect(pills[0]?.textContent).toBe('solo')
  })

  it('renders nothing for null, undefined and the empty string', () => {
    expect(visiblePills(render(tagsRenderer, null).cell)).toHaveLength(0)
    expect(visiblePills(render(tagsRenderer, undefined).cell)).toHaveLength(0)
    expect(visiblePills(render(tagsRenderer, '').cell)).toHaveLength(0)
  })

  it('renders nothing for an empty array', () => {
    expect(visiblePills(render(tagsRenderer, []).cell)).toHaveLength(0)
  })

  it('translates entries through the options list', () => {
    const pills = visiblePills(render(tagsRenderer, ['open', 'other'], column).cell)

    expect(pills[0]?.textContent).toBe('Open')
    expect(pills[0]?.style.getPropertyValue('--dt-badge-color')).toBe('var(--dt-color-blue)')
    // La entrada desconocida se muestra cruda, con el color neutro.
    expect(pills[1]?.textContent).toBe('other')
    expect(pills[1]?.style.getPropertyValue('--dt-badge-color')).toBe('var(--dt-color-neutral)')
  })

  it('renders a pill per entry even for non-string entries', () => {
    const pills = visiblePills(render(tagsRenderer, [1, true, null]).cell)

    expect(pills).toHaveLength(3)
    expect(pills[0]?.textContent).toBe('1')
    expect(pills[1]?.textContent).toBe('true')
    expect(pills[2]?.textContent).toBe('')
  })
})
