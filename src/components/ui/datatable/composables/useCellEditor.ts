import { onBeforeUnmount, shallowRef } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import type {
  AfterEditEvent,
  BeforeEditEvent,
  CellEditorType,
  CellOption,
  CellPosition,
  CellValue,
  DataTableColumn,
  EditCommitEvent,
} from '../types'
import {
  cellValuesEqual,
  coerceEditValue,
  fromDateInputString,
  readCellValue,
  toDateInputString,
  toEditString,
} from '../internal/values'

/** Rectángulo de una celda en coordenadas del canvas, no de la pantalla. */
export interface CellGeometry {
  /** Borde izquierdo en px respecto del canvas. */
  x: number
  /** Borde superior en px respecto del canvas. */
  y: number
  /** Ancho en px. */
  width: number
  /** Alto en px. */
  height: number
}

/** Controles que puede usar un editor. Ambos exponen `value` como string. */
type EditorControl = HTMLInputElement | HTMLSelectElement

/** Opciones de {@link useCellEditor}. */
export interface UseCellEditorOptions<TRow> {
  /** Contenedor donde se montan los controles de edición. */
  host: Readonly<ShallowRef<HTMLElement | null>>
  /**
   * Caja que envuelve al contenido del slot `#editor`, si la tabla lo declara.
   *
   * Este módulo no la crea ni la llena: la renderiza Vue y su contenido lo pone
   * el consumidor. Acá solo se la POSICIONA sobre la celda en edición, con la
   * misma geometría y el mismo caché que los controles incluidos, y se mira si
   * el foco quedó adentro al cerrar. Sin esta referencia, una columna con
   * `editor: 'slot'` no abre nada.
   */
  slotHost?: Readonly<ShallowRef<HTMLElement | null>>
  /** Devuelve la fila en ese índice, o `undefined` si está fuera de rango. */
  getRow: (rowIndex: number) => TRow | undefined
  /** Devuelve la definición de columna, o `undefined` si la clave es desconocida. */
  getColumn: (columnKey: string) => DataTableColumn<TRow> | undefined
  /** Geometría de la celda en coordenadas del canvas, o `null` si no se puede resolver. */
  getCellGeometry: (position: CellPosition) => CellGeometry | null
  /** Si la celda sigue pintada dentro de la ventana virtual. */
  isCellPainted: (position: CellPosition) => boolean
  /** Emite `beforeEdit`. El evento es mutable: los listeners pueden cancelarlo. */
  emitBeforeEdit: (event: BeforeEditEvent<TRow>) => void
  /** Emite `afterEdit`. */
  emitAfterEdit: (event: AfterEditEvent<TRow>) => void
  /** Emite `editCommit`. */
  emitEditCommit: (event: EditCommitEvent<TRow>) => void
  /**
   * Se invoca después de confirmar con Enter.
   *
   * Existe para que el componente pueda bajar la selección una fila, como hace
   * una planilla de cálculo. El editor detiene la propagación de Enter, así que
   * el manejador del viewport nunca lo ve: sin este callback no habría forma de
   * encadenar las dos acciones.
   */
  onEnterCommit?: () => void
  /**
   * Se invoca al cerrar el editor, solo si el control TENÍA el foco del DOM.
   *
   * `close()` suelta el foco a propósito —ver su documentación— y soltarlo lo
   * manda al `body`. Desde ahí el manejador de teclado de la tabla, que escucha
   * en el viewport, deja de recibir las teclas: después de un Escape o de un
   * cierre por scroll, la flecha siguiente no haría absolutamente nada. Este
   * callback existe para que el componente recupere el foco sin que este módulo
   * tenga que conocer el viewport ni ningún otro nodo ajeno a su control.
   */
  onReleaseFocus?: () => void
}

/** Resultado de {@link useCellEditor}. */
export interface UseCellEditorReturn {
  /** Celda en edición, o `null`. Reactivo: el pintado lo usa para marcar la celda. */
  editing: Readonly<Ref<CellPosition | null>>
  /** Intenta abrir el editor. Devuelve `false` si se vetó o la celda no es editable. */
  beginEdit: (position: CellPosition, initialText?: string) => boolean
  /**
   * Aplica un valor sin abrir ningún control.
   *
   * Es la vía que usan los controles embebidos en la celda, como la casilla del
   * renderer `checkbox`. Recorre exactamente la misma tubería —`beforeEdit`
   * cancelable, `editCommit`, `afterEdit`— para que no exista un camino que
   * esquive el veto.
   */
  commitValue: (position: CellPosition, newValue: CellValue) => boolean
  /** Confirma la edición en curso. No hace nada si no hay ninguna. */
  commit: () => void
  /**
   * Confirma la sesión abierta con el valor que entrega el slot `#editor`.
   *
   * Es la vía del editor de slot y la única que recibe el valor ya tipado desde
   * afuera. Reusa el mismo publicador que el editor incluido —`editCommit` solo
   * ante un cambio real, después `afterEdit`—, así que no existe un segundo
   * camino de edición. No vuelve a emitir `beforeEdit`: ese veto ya corrió al
   * abrir.
   */
  commitSlotValue: (newValue: CellValue) => void
  /**
   * Cierra el editor de slot si la celda apuntada no es la que está abierta.
   *
   * Los controles incluidos no lo necesitan: confirman solos al perder el foco.
   * El de slot no puede hacerlo, porque el contenido del consumidor puede abrir
   * un popover teleportado al `body` que se lleva el foco sin que la edición
   * haya terminado. Cerrar por `blur` ahí significaría cerrar el editor justo
   * cuando el usuario despliega la lista.
   */
  commitIfElsewhere: (position: CellPosition) => void
  /** Descarta la edición en curso sin escribir. */
  cancelEdit: () => void
  /** Reubica el editor sobre su celda. Se llama una vez por frame. */
  syncPosition: () => void
  /** Tipo de editor que corresponde a una celda, ya inferido. */
  resolveEditorType: (position: CellPosition) => CellEditorType | null
  /** Cierra el editor y libera listeners. */
  dispose: () => void
}

/**
 * Infiere qué control corresponde a una celda.
 *
 * El orden importa y es deliberado:
 *
 * 1. `column.editor` explícito gana siempre.
 * 2. `boolean` -> `checkbox`.
 * 3. `number` -> `number`.
 * 4. `Date` -> `date`.
 * 5. Hay `options` -> `select`.
 * 6. Si no -> `text`.
 *
 * `'slot'` solo puede salir del paso 1: no hay ninguna forma de un valor que
 * signifique "el control lo pone el consumidor", así que declararlo es la única
 * manera de pedirlo.
 *
 * Los tipos del valor se consultan ANTES que `options` porque el tipo del dato
 * es una señal más fuerte que la existencia de una lista: una columna booleana
 * con dos opciones sigue siendo una casilla, no un desplegable de dos ítems. Y
 * `options` se consulta antes que el fallback a texto porque una lista declarada
 * es una intención explícita de acotar los valores posibles.
 */
export function inferEditorType<TRow>(
  column: DataTableColumn<TRow>,
  value: CellValue,
): CellEditorType {
  if (column.editor) return column.editor
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (value instanceof Date) return 'date'
  if (column.options && column.options.length > 0) return 'select'
  return 'text'
}

/**
 * Ciclo de vida de la edición de celdas.
 *
 * ## Una instancia por TIPO de editor, no por celda
 *
 * Los controles se crean de forma perezosa la primera vez que se necesita cada
 * tipo y después se reutilizan. Una tabla que solo edita texto nunca construye
 * un `<select>`; una que edita ambos construye uno de cada y los reposiciona.
 * Crear un control por celda significaría crear y destruir un elemento de
 * formulario —con su estado de foco, su validación y su participación en el
 * layout— por cada edición, para algo que solo puede estar activo de a uno.
 *
 * ## Por qué el editor sigue al scroll en lugar de cerrarse
 *
 * Los controles viven dentro del viewport que scrollea y se posicionan en
 * coordenadas del canvas, las mismas que usan las filas. Como consecuencia,
 * scrollear los desplaza junto con el contenido sin que haya que reposicionarlos:
 * no hay cálculo por frame ni lectura del DOM.
 *
 * El límite es la ventana virtual: cuando la fila editada sale del tramo
 * pintado, el nodo que la representaba ya fue reciclado y la edición pierde su
 * anclaje visual. Ahí sí se cierra, y se cierra **confirmando**, con la misma
 * semántica que un blur.
 *
 * ## El editor de slot es la misma idea, un nivel más afuera
 *
 * Con `editor: 'slot'` el control lo pone el consumidor desde el slot `#editor`
 * del componente, y este módulo se queda con lo que ya hacía: correr el veto,
 * posicionar la caja sobre la celda, cerrarla cuando la fila sale de la ventana
 * y publicar el resultado. El contenido se monta al abrir y se desmonta al
 * cerrar, así que existe como mucho UNA instancia del componente del consumidor
 * en toda la tabla.
 *
 * La única asimetría con los controles incluidos es el `blur`, y es deliberada:
 * un desplegable de un design system suele abrir su lista en un portal colgado
 * del `body`, con lo que el foco sale de la caja del editor en mitad de la
 * interacción. Confirmar ahí cerraría el editor justo cuando el usuario despliega
 * las opciones. Por eso el editor de slot cierra por `commit()`, por `cancel()`,
 * porque la fila salió de la ventana, o porque el puntero apuntó otra celda
 * ({@link UseCellEditorReturn.commitIfElsewhere}), pero nunca por perder el foco.
 *
 * ## La tabla es controlada
 *
 * Nada de este módulo escribe sobre `rows`. Se emite `editCommit` con el valor
 * nuevo y el padre decide si persiste, valida o descarta. Si el padre ignora el
 * evento, la celda vuelve a mostrar el valor anterior en el próximo pintado, que
 * es el comportamiento correcto para un componente controlado.
 */
export function useCellEditor<TRow extends Record<string, unknown>>(
  options: UseCellEditorOptions<TRow>,
): UseCellEditorReturn {
  const editing = shallowRef<CellPosition | null>(null)

  /** Controles ya construidos, uno por tipo. */
  const controls = new Map<CellEditorType, EditorControl>()

  /** Control actualmente visible, o `null`. */
  let activeControl: EditorControl | null = null
  /**
   * Caja del slot mientras el editor abierto es de tipo `'slot'`, o `null`.
   *
   * Es excluyente con {@link activeControl}: una sesión de edición tiene un
   * control incluido o tiene el slot, nunca los dos.
   */
  let activeSlot: HTMLElement | null = null
  /** Tipo del control activo. */
  let activeType: CellEditorType | null = null
  /** Valor al abrir el editor. Se congela para poder reportarlo como `oldValue`. */
  let originalValue: CellValue = undefined
  /** Opciones con las que se llenó el `<select>`, para no rehacerlo sin motivo. */
  let selectOptions: readonly CellOption[] | null = null

  /**
   * Evita la reentrada mientras se cierra.
   *
   * Cerrar oculta el control y le suelta el foco, y las dos cosas disparan
   * `blur`, cuyo handler intentaría confirmar otra vez y emitir eventos
   * duplicados.
   */
  let closing = false

  /** Última geometría aplicada, para no reescribir estilos idénticos por frame. */
  let appliedGeometry: CellGeometry | null = null

  function resolveContext(position: CellPosition): {
    row: TRow
    column: DataTableColumn<TRow>
    value: CellValue
  } | null {
    const row = options.getRow(position.rowIndex)
    if (row === undefined) return null
    const column = options.getColumn(position.columnKey)
    if (!column) return null
    return { row, column, value: readCellValue(column, row) }
  }

  function resolveEditorType(position: CellPosition): CellEditorType | null {
    const context = resolveContext(position)
    if (!context) return null
    return inferEditorType(context.column, context.value)
  }

  /**
   * Nodo que este módulo posiciona sobre la celda en edición.
   *
   * Es el control incluido o, con el editor de slot, la caja que envuelve al
   * contenido del consumidor. Separarlo de {@link activeControl} es lo que
   * permite que la geometría —y su caché— sea exactamente el mismo código para
   * los dos casos.
   */
  function positionedElement(): HTMLElement | null {
    return activeControl ?? activeSlot
  }

  /** Construye el control de un tipo. `checkbox` y `slot` no usan overlay propio. */
  function createControl(type: CellEditorType): EditorControl | null {
    if (type === 'slot') return null
    if (type === 'select') {
      const select = document.createElement('select')
      select.className = 'dt-editor dt-editor--select'
      return select
    }

    const input = document.createElement('input')
    input.className = 'dt-editor'
    input.spellcheck = false
    if (type === 'number') input.type = 'number'
    else if (type === 'date') input.type = 'date'
    else input.type = 'text'
    return input
  }

  /** Devuelve el control de un tipo, creándolo la primera vez. */
  function getControl(type: CellEditorType): EditorControl | null {
    const existing = controls.get(type)
    if (existing) return existing

    const host = options.host.value
    if (!host) return null

    const control = createControl(type)
    if (!control) return null

    control.hidden = true
    control.addEventListener('keydown', handleKeyDown)
    control.addEventListener('blur', handleBlur)
    // Elegir una opción confirma de inmediato: es lo que espera cualquiera que
    // haya usado un desplegable en una planilla.
    if (control instanceof HTMLSelectElement) control.addEventListener('change', handleSelectChange)

    host.appendChild(control)
    controls.set(type, control)
    return control
  }

  /**
   * Llena el `<select>` con las opciones de la columna.
   *
   * Solo rehace la lista cuando cambia la IDENTIDAD del array. Reconstruir los
   * `<option>` en cada apertura tiraría y recrearía nodos sin motivo, y en una
   * lista larga eso se nota al abrir.
   */
  function populateSelect(select: HTMLSelectElement, next: readonly CellOption[]): void {
    if (selectOptions === next) return
    selectOptions = next

    select.textContent = ''
    for (const option of next) {
      const element = document.createElement('option')
      element.value = String(option.value)
      element.textContent = option.label
      select.appendChild(element)
    }
  }

  /** Texto con el que se abre el control, según su tipo. */
  function toControlValue(type: CellEditorType, value: CellValue): string {
    if (type === 'date') return toDateInputString(value)
    if (type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      return toEditString(value)
    }
    return toEditString(value)
  }

  /** Convierte lo que escribió el usuario al tipo del dato original. */
  function fromControlValue(
    type: CellEditorType,
    raw: string,
    previous: CellValue,
    column: DataTableColumn<TRow>,
  ): CellValue {
    if (type === 'date') return fromDateInputString(raw, previous)

    if (type === 'select') {
      // Se recupera el valor tipado de la opción: el `<select>` solo devuelve
      // strings, y un padre que guardaba `1` no debe recibir `"1"`.
      const match = column.options?.find((option) => String(option.value) === raw)
      if (match) return match.value
      return coerceEditValue(raw, previous)
    }

    if (type === 'number') {
      const trimmed = raw.trim()
      if (trimmed === '') return null
      const parsed = Number(trimmed)
      // Igual que en el resto: si no se puede parsear se devuelve el texto crudo,
      // nunca `NaN`.
      return Number.isNaN(parsed) ? raw : parsed
    }

    return coerceEditValue(raw, previous)
  }

  /**
   * Abre el editor sobre una celda.
   *
   * `initialText` es el modo "escribir para editar": el usuario tecleó un
   * carácter imprimible sobre la celda activa y esa tecla tiene que ser el
   * primer carácter del valor nuevo, no perderse. Se siembra el control con ese
   * texto en lugar del valor actual, y NO se selecciona el contenido, para que
   * lo que siga escribiendo se agregue en vez de reemplazarlo.
   */
  function beginEdit(position: CellPosition, initialText?: string): boolean {
    const current = editing.value
    if (
      current &&
      current.rowIndex === position.rowIndex &&
      current.columnKey === position.columnKey
    ) {
      return true
    }
    // Abrir otra celda confirma la anterior, igual que hace una hoja de cálculo.
    if (current) commit()

    const context = resolveContext(position)
    if (!context) return false
    if (context.column.editable !== true) return false

    const type = inferEditorType(context.column, context.value)
    // La casilla se edita en la propia celda: no hay control flotante que abrir.
    // El renderer manda su intención por `commitValue`.
    if (type === 'checkbox') return false

    // Las dos ramas resuelven el mismo requisito —tener dónde dibujar el editor—
    // contra fuentes distintas: el control incluido se construye acá, y la caja
    // del slot la renderiza Vue. Se resuelve ANTES de `runBeforeEdit` para no
    // emitir un veto sobre una edición que después no va a abrir.
    let control: EditorControl | null = null
    let slotHost: HTMLElement | null = null
    if (type === 'slot') {
      slotHost = options.slotHost?.value ?? null
      // Una columna con `editor: 'slot'` en una tabla que no declara el slot
      // `#editor` no abre nada. Caer en un editor de texto sería peor: el
      // consumidor pidió su propio control justamente porque el incluido no
      // sirve para esa columna.
      if (!slotHost) return false
    } else {
      control = getControl(type)
      if (!control) return false
    }

    if (!runBeforeEdit(position, context.row, context.column, context.value)) return false

    originalValue = context.value
    editing.value = { rowIndex: position.rowIndex, columnKey: position.columnKey }
    appliedGeometry = null
    activeControl = control
    activeSlot = slotHost
    activeType = type

    // El contenido del slot lo monta Vue al ver cambiar `editing`, así que acá no
    // hay ningún valor que sembrar ni ningún nodo que mostrar: solo se deja la
    // geometría aplicada para que la caja ya esté sobre la celda correcta cuando
    // el patch la haga visible. El foco lo toma el componente después del patch,
    // que es el único momento en que su contenido existe.
    if (!control) {
      applyGeometry(position)
      return true
    }

    if (control instanceof HTMLSelectElement) {
      populateSelect(control, context.column.options ?? [])
    } else if (type === 'number') {
      applyNumericBounds(control, context.column)
    }

    const seeded = initialText !== undefined && type !== 'select' && type !== 'date'
    control.value = seeded ? initialText : toControlValue(type, context.value)

    applyGeometry(position)
    control.hidden = false
    control.focus()
    // Al sembrar no se selecciona: el cursor queda al final para que el usuario
    // siga escribiendo sobre lo que ya tecleó.
    if (!seeded && control instanceof HTMLInputElement && type !== 'date') control.select()

    return true
  }

  /** Traslada `min` / `max` / `step` de la columna al input numérico. */
  function applyNumericBounds(control: EditorControl, column: DataTableColumn<TRow>): void {
    if (!(control instanceof HTMLInputElement)) return
    control.min = column.min === undefined ? '' : String(column.min)
    control.max = column.max === undefined ? '' : String(column.max)
    control.step = column.step === undefined ? '' : String(column.step)
  }

  /**
   * Emite `beforeEdit` y devuelve `false` si algún listener lo vetó.
   *
   * Está factorizado para que `beginEdit` y `commitValue` compartan exactamente
   * el mismo camino: si un día divergieran, uno de los dos se convertiría en una
   * puerta trasera que saltea el veto.
   */
  function runBeforeEdit(
    position: CellPosition,
    row: TRow,
    column: DataTableColumn<TRow>,
    value: CellValue,
  ): boolean {
    // El evento se arma mutable a propósito: `cancel()` marca la bandera y el
    // emisor lee el resultado de forma sincrónica cuando vuelve. Es el único
    // protocolo que permite a un listener vetar sin recurrir a promesas.
    //
    // `cancel` cierra sobre una variable local en lugar de escribir `this`:
    // un listener que haga `const { cancel } = event` y lo invoque suelto
    // perdería el receptor, y el veto se descartaría en silencio.
    let canceled = false
    const event: BeforeEditEvent<TRow> = {
      row,
      rowIndex: position.rowIndex,
      column,
      columnKey: position.columnKey,
      value,
      canceled: false,
      cancel(): void {
        canceled = true
        event.canceled = true
      },
    }
    options.emitBeforeEdit(event)
    return !canceled && !event.canceled
  }

  /** Emite `afterEdit` y, si el valor cambió de verdad, `editCommit`. */
  function publishResult(
    position: CellPosition,
    row: TRow,
    column: DataTableColumn<TRow>,
    oldValue: CellValue,
    newValue: CellValue,
  ): void {
    options.emitAfterEdit({
      row,
      rowIndex: position.rowIndex,
      column,
      columnKey: position.columnKey,
      oldValue,
      newValue,
      canceled: false,
    })

    // `editCommit` solo dispara ante un cambio real. Emitirlo con un valor
    // idéntico empujaría al padre a reemplazar el array de filas y a repintar
    // toda la tabla por una edición que no cambió nada.
    if (cellValuesEqual(oldValue, newValue)) return

    options.emitEditCommit({
      row,
      rowIndex: position.rowIndex,
      column,
      columnKey: position.columnKey,
      oldValue,
      newValue,
    })
  }

  function commitValue(position: CellPosition, newValue: CellValue): boolean {
    // Si hay otra celda abierta, se confirma primero para no dejar dos ediciones
    // en vuelo.
    if (editing.value) commit()

    const context = resolveContext(position)
    if (!context) return false
    if (context.column.editable !== true) return false

    if (!runBeforeEdit(position, context.row, context.column, context.value)) return false

    publishResult(position, context.row, context.column, context.value, newValue)
    return true
  }

  function commit(): void {
    const position = editing.value
    if (!position || closing) return

    const control = activeControl
    const type = activeType
    const context = resolveContext(position)

    // El texto crudo y el valor original se capturan ANTES de cerrar: `close()`
    // vacía el control y descarta `originalValue`, así que leerlos después
    // devolvería una cadena vacía y `undefined`.
    const rawText = control ? control.value : ''
    const oldValue = originalValue
    close()

    if (!context || !type) return

    const newValue = control ? fromControlValue(type, rawText, oldValue, context.column) : oldValue

    publishResult(position, context.row, context.column, oldValue, newValue)
  }

  function commitSlotValue(newValue: CellValue): void {
    const position = editing.value
    // La guarda por tipo no es defensiva de más: el slot vive en el árbol de Vue
    // y su `commit` es una closure que el consumidor puede invocar tarde, después
    // de que la sesión se cerrara por scroll o por un clic en otra celda. Sin
    // esto, ese llamado publicaría una edición sobre una celda que ya no está
    // abierta.
    if (!position || closing || activeType !== 'slot') return

    const context = resolveContext(position)

    // Igual que en `commit`: el valor original se captura antes de que `close()`
    // lo descarte.
    const oldValue = originalValue
    close()

    if (!context) return

    publishResult(position, context.row, context.column, oldValue, newValue)
  }

  function commitIfElsewhere(position: CellPosition): void {
    const current = editing.value
    if (!current || activeType !== 'slot') return
    if (current.rowIndex === position.rowIndex && current.columnKey === position.columnKey) return
    commit()
  }

  function cancelEdit(): void {
    const position = editing.value
    if (!position || closing) return

    const context = resolveContext(position)

    // Igual que en `commit`: el valor original se captura antes de que `close()`
    // lo descarte.
    const oldValue = originalValue
    close()

    if (!context) return

    // Escape igual emite `afterEdit`: el contrato promete exactamente un
    // `afterEdit` por editor abierto, así que un listener que libera un lock o
    // cierra un modal no necesita distinguir cómo terminó la edición.
    options.emitAfterEdit({
      row: context.row,
      rowIndex: position.rowIndex,
      column: context.column,
      columnKey: position.columnKey,
      oldValue,
      newValue: oldValue,
      canceled: true,
    })
  }

  /**
   * Cierra la sesión de edición en curso.
   *
   * ## El foco se suelta acá, a propósito y en este orden
   *
   * Cerrar sin soltar el foco dejaba una carrera real al pasar de un editor a
   * otro. La secuencia era: `beginEdit` confirmaba el anterior, `close()` ocultaba
   * su control pero lo dejaba con el foco del DOM, `editing` pasaba a la celda
   * nueva y recién entonces `control.focus()` sobre el control nuevo disparaba el
   * `blur` del viejo. Ese `blur` llamaba a `commit()`, que cerraba el editor
   * RECIÉN ABIERTO y emitía un `afterEdit` fantasma sobre una edición que el
   * usuario nunca terminó. La guarda `closing` no lo cubría porque el `blur`
   * aterrizaba después de que `close()` ya había vuelto.
   *
   * El arreglo es mover la transición de foco adentro de la región guardada: se
   * llama a `blur()` explícitamente con `closing` ya en `true`, así el handler
   * entra, encuentra la guarda levantada y no hace nada. Cuando después se
   * enfoca el control nuevo, el viejo ya no tiene el foco y no hay ningún `blur`
   * pendiente que pueda llegar tarde.
   *
   * El `blur` explícito NO alcanza por sí solo, y por eso {@link handleBlur}
   * además compara la identidad del control: un entorno que difiera la entrega
   * del evento lo haría aterrizar igual después de `close()`. Y la comparación de
   * identidad tampoco alcanza sola, porque al pasar entre dos celdas del mismo
   * tipo de editor el control viejo y el nuevo son el MISMO nodo y la comparación
   * no distingue nada. Hacen falta las dos, y juntas cubren tanto el orden de
   * `happy-dom` como el de un navegador real.
   *
   * Se consulta `document.activeElement` antes de llamar a `blur()` para no
   * emitir un evento sobre un control que no tenía el foco: es el caso de una
   * confirmación por scroll, donde el usuario nunca llegó a tipear.
   *
   * ## Y el foco se DEVUELVE, no se abandona
   *
   * `blur()` manda el foco al `body`, que está fuera de la tabla. El manejador
   * de teclado escucha en el viewport, así que un foco en el `body` deja la
   * grilla muda: después de un Escape, la flecha siguiente no llegaba a ningún
   * lado. Por eso la misma lectura que decide si hay que soltar el foco decide
   * si hay que pedir que lo recuperen, con {@link UseCellEditorOptions.onReleaseFocus}
   * y recién al final, con `closing` ya bajado y el estado limpio.
   */
  function close(): void {
    closing = true
    const control = activeControl
    const slot = activeSlot
    // Se recuerda si el control tenía el foco para poder devolverlo al final,
    // con el cierre ya terminado y la guarda de reentrada abajo. Devolverlo
    // antes reentraría en este mismo camino con el estado a medio limpiar.
    let hadFocus = false
    if (control) {
      if (control.ownerDocument.activeElement === control) {
        hadFocus = true
        control.blur()
      }
      control.hidden = true
      control.value = ''
    }
    // El editor de slot no se oculta desde acá: su visibilidad la escribe Vue a
    // partir de `editing`, y dos dueños para el mismo atributo terminan
    // pisándose. Lo único que le corresponde a este cierre es el foco, porque el
    // contenido está por desmontarse y soltarlo lo mandaría al `body` —fuera de
    // la tabla— dejando la grilla muda. Se mira quién lo tiene ANTES de bajar
    // `editing`, que es lo que dispara el desmontaje.
    if (slot) {
      const focused = slot.ownerDocument.activeElement
      if (focused instanceof HTMLElement && slot.contains(focused)) {
        hadFocus = true
        focused.blur()
      }
    }
    editing.value = null
    activeControl = null
    activeSlot = null
    activeType = null
    originalValue = undefined
    appliedGeometry = null
    closing = false
    if (hadFocus) options.onReleaseFocus?.()
  }

  function applyGeometry(position: CellPosition): void {
    // El control incluido o la caja del slot, según cuál esté abierto: la
    // geometría se resuelve igual para los dos, y por eso este es el único lugar
    // del módulo que escribe posición.
    const element = positionedElement()
    if (!element) return

    const geometry = options.getCellGeometry(position)
    if (!geometry) return

    const previous = appliedGeometry
    if (
      previous &&
      previous.x === geometry.x &&
      previous.y === geometry.y &&
      previous.width === geometry.width &&
      previous.height === geometry.height
    ) {
      return
    }

    appliedGeometry = geometry
    element.style.transform = `translate3d(${geometry.x}px, ${geometry.y}px, 0)`
    element.style.width = `${geometry.width}px`
    element.style.height = `${geometry.height}px`
  }

  function syncPosition(): void {
    const position = editing.value
    if (!position) return

    // Si el pool ya no tiene un nodo para esta celda, la fila salió de la
    // ventana virtual. Se confirma y se cierra: la alternativa sería dejar un
    // control flotando sobre filas que pertenecen a otros datos.
    if (!options.isCellPainted(position)) {
      commit()
      return
    }

    applyGeometry(position)
  }

  // El parámetro es `Event` y no `KeyboardEvent` porque `addEventListener` sobre
  // la unión `HTMLInputElement | HTMLSelectElement` resuelve a la sobrecarga
  // base de `EventTarget`, que solo acepta un listener de `Event`. Se estrecha
  // adentro con `instanceof`, sin aserciones.
  function handleKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return

    // Enter y Escape detienen la propagación además de prevenir el default: si
    // burbujearan hasta el viewport, su manejador los volvería a interpretar
    // —Enter como "abrir editor" sobre la celda que se acaba de cerrar— y la
    // edición se reabriría sola.
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      commit()
      options.onEnterCommit?.()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
      return
    }
    // El resto de las teclas se detiene aquí: el editor comparte el viewport con
    // el canvas, y dejar burbujear las flechas o la barra espaciadora haría que
    // el contenedor scrolleara mientras se escribe.
    event.stopPropagation()
  }

  /**
   * Salir del control confirma, como al dejar una celda de una planilla.
   *
   * Solo confirma el control que en este momento ES el activo. Un `blur` de
   * cualquier otro es el eco de una sesión que ya se cerró —el control anterior
   * al cambiar de celda, típicamente— y hacerle caso cerraría el editor que se
   * acaba de abrir. Ver el razonamiento completo en {@link close}.
   */
  function handleBlur(event: Event): void {
    if (event.target !== activeControl) return
    commit()
  }

  function handleSelectChange(): void {
    commit()
  }

  function dispose(): void {
    for (const control of controls.values()) {
      control.removeEventListener('keydown', handleKeyDown)
      control.removeEventListener('blur', handleBlur)
      if (control instanceof HTMLSelectElement) {
        control.removeEventListener('change', handleSelectChange)
      }
      control.remove()
    }
    controls.clear()
    activeControl = null
    activeSlot = null
    activeType = null
    selectOptions = null
    editing.value = null
    appliedGeometry = null
  }

  onBeforeUnmount(dispose)

  return {
    editing,
    beginEdit,
    commitValue,
    commit,
    commitSlotValue,
    commitIfElsewhere,
    cancelEdit,
    syncPosition,
    resolveEditorType,
    dispose,
  }
}
