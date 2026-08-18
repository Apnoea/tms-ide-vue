import { describe, it, expect } from 'vitest'
import { createStencilEditor, useStencilEditor, PORT_GRID } from './useStencilEditor'

/**
 * Видимость по состоянию — тем же путём, каким её ставит инспектор: выделить,
 * применить на выделение, зафиксировать шаг истории (см. StencilInspector.shapeState).
 */
function setState(ed, id, state) {
  ed.select(id)
  ed.applyToSelected({ state })
  ed.commit()
}

describe('useStencilEditor', () => {
  it('addShape присваивает id, дефолты обводки, выделяет и возвращает в select', () => {
    const ed = createStencilEditor()
    ed.setTool('rect')
    const s = ed.addShape({ type: 'rect', x: 0, y: 0, w: 20, h: 20 })
    expect(s.id).toBeTruthy()
    expect(s.stroke).toBe('#000')
    expect(s.strokeWidth).toBe(2)
    expect(s.fill).toBe('none')
    expect(ed.selectedId.value).toBe(s.id)
    expect(ed.tool.value).toBe('select')
    expect(ed.shapes.value).toHaveLength(1)
  })

  it('updateShape меняет только целевую фигуру', () => {
    const ed = createStencilEditor()
    const a = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    const b = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    ed.updateShape(a.id, { w: 30 })
    expect(ed.shapes.value.find((s) => s.id === a.id).w).toBe(30)
    expect(ed.shapes.value.find((s) => s.id === b.id).w).toBe(10)
  })

  it('removeShape снимает выделение если удалили выделенное', () => {
    const ed = createStencilEditor()
    const s = ed.addShape({ type: 'circle', cx: 5, cy: 5, r: 3 })
    ed.removeShapes([s.id])
    expect(ed.shapes.value).toHaveLength(0)
    expect(ed.selectedId.value).toBeNull()
  })

  it('copyShapes/pasteShapes: клон со свойствами, новый id, сдвиг, выделение копии', () => {
    const ed = createStencilEditor()
    const a = ed.addShape({
      type: 'rect',
      x: 10,
      y: 10,
      w: 20,
      h: 20,
      fill: '#f00',
      strokeWidth: 3,
    })
    ed.select(a.id)
    expect(ed.copyShapes()).toBe(true)
    const [b] = ed.pasteShapes()
    expect(ed.shapes.value).toHaveLength(2)
    expect(b.id).not.toBe(a.id)
    expect(b.fill).toBe('#f00') // свойства сохранены
    expect(b.strokeWidth).toBe(3)
    expect(b.x).not.toBe(a.x) // сдвинут, не поверх
    expect(ed.selectedId.value).toBe(b.id) // paste выделяет копию
  })

  it('copyShapes без выделения → false; pasteShapes с пустым буфером → []', () => {
    const ed = createStencilEditor()
    ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    ed.select(null)
    expect(ed.copyShapes()).toBe(false)
    expect(createStencilEditor().pasteShapes()).toEqual([])
  })

  // Мультиселект: рамка/Ctrl+клик выделяют пачку, drag и Delete работают на всю.
  it('select/toggleSelect/selectMany/selectAll ведут selectedIds; selectedId только при одной', () => {
    const ed = createStencilEditor()
    const a = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    const b = ed.addShape({ type: 'rect', x: 20, y: 0, w: 10, h: 10 })

    ed.select(a.id)
    expect(ed.selectedId.value).toBe(a.id)

    ed.toggleSelect(b.id)
    expect(ed.selectedIds.value).toEqual([a.id, b.id])
    // Свойства и ручки при N>1 недоступны — это и означает selectedId === null.
    expect(ed.selectedId.value).toBeNull()

    ed.toggleSelect(a.id)
    expect(ed.selectedIds.value).toEqual([b.id])

    ed.select(a.id)
    ed.selectMany([b.id], true) // additive-лассо
    expect(ed.selectedSet.value.has(a.id)).toBe(true)
    expect(ed.selectedSet.value.has(b.id)).toBe(true)

    ed.selectMany([b.id]) // обычная рамка заменяет выделение
    expect(ed.selectedIds.value).toEqual([b.id])

    ed.selectAll()
    expect(ed.selectedIds.value).toHaveLength(2)
  })

  it('additive-выделение не дублирует уже выделенное', () => {
    const ed = createStencilEditor()
    const a = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    ed.select(a.id)
    ed.selectMany([a.id], true)
    expect(ed.selectedIds.value).toEqual([a.id])
  })

  it('removeShapes удаляет пачку одним шагом истории и чистит выделение', () => {
    const ed = createStencilEditor()
    const a = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    const b = ed.addShape({ type: 'rect', x: 20, y: 0, w: 10, h: 10 })
    const c = ed.addShape({ type: 'rect', x: 40, y: 0, w: 10, h: 10 })
    ed.selectMany([a.id, b.id])

    ed.removeShapes(ed.selectedIds.value)
    expect(ed.shapes.value.map((s) => s.id)).toEqual([c.id])
    expect(ed.selectedIds.value).toEqual([])
    // Один Ctrl+Z возвращает обе удалённые, а не по одной.
    ed.undo()
    expect(ed.shapes.value).toHaveLength(3)
  })

  it('pasteShapes: пачка вставляется одним шагом истории и становится выделением', () => {
    const ed = createStencilEditor()
    const a = ed.addShape({ type: 'rect', x: 10, y: 10, w: 10, h: 10 })
    const b = ed.addShape({ type: 'circle', cx: 30, cy: 10, r: 5 })
    ed.selectMany([a.id, b.id])
    ed.copyShapes()
    const added = ed.pasteShapes()

    expect(added).toHaveLength(2)
    expect(ed.shapes.value).toHaveLength(4)
    expect(ed.selectedIds.value).toEqual(added.map((s) => s.id))
    // Взаимное расположение сохранено: обе копии сдвинуты на один и тот же шаг.
    expect(added[0].x - a.x).toBe(added[1].cx - b.cx)
    ed.undo()
    expect(ed.shapes.value).toHaveLength(2)
  })

  it('updateShapes патчит только выделенные, по патчу на фигуру', () => {
    const ed = createStencilEditor()
    const a = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    const b = ed.addShape({ type: 'rect', x: 20, y: 0, w: 10, h: 10 })
    const c = ed.addShape({ type: 'rect', x: 40, y: 0, w: 10, h: 10 })
    ed.updateShapes([a.id, b.id], (s) => ({ x: s.x + 5 }))
    const byId = (id) => ed.shapes.value.find((s) => s.id === id)
    expect(byId(a.id).x).toBe(5)
    expect(byId(b.id).x).toBe(25)
    expect(byId(c.id).x).toBe(40)
  })

  // Групповая правка свойств в инспекторе: контрол виден, если свойство применимо
  // хоть к одной выделенной, значение общее (или «разные»), правка — ко всем.
  describe('commonValue / applyToSelected / selectedFor', () => {
    const NOT_TEXT = (s) => s.type !== 'text'

    it('общее значение отдаётся, расходящееся — undefined', () => {
      const ed = createStencilEditor()
      const a = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10, strokeWidth: 2 })
      const b = ed.addShape({ type: 'rect', x: 20, y: 0, w: 10, h: 10, strokeWidth: 2 })
      ed.selectMany([a.id, b.id])
      expect(ed.commonValue((s) => s.strokeWidth)).toBe(2)

      ed.updateShape(b.id, { strokeWidth: 5 })
      expect(ed.commonValue((s) => s.strokeWidth)).toBeUndefined()
    })

    it('фильтр применимости отсекает неподходящие типы (и в чтении, и в правке)', () => {
      const ed = createStencilEditor()
      const rect = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10, strokeWidth: 2 })
      const text = ed.addShape({ type: 'text', x: 5, y: 5, text: 'Wh' })
      ed.selectMany([rect.id, text.id])

      // Подпись в толщину линии не входит — расхождения нет, значение общее.
      expect(ed.commonValue((s) => s.strokeWidth ?? 2, NOT_TEXT)).toBe(2)
      expect(ed.selectedFor(NOT_TEXT).map((s) => s.id)).toEqual([rect.id])

      ed.applyToSelected({ strokeWidth: 4 }, NOT_TEXT)
      const byId = (id) => ed.shapes.value.find((s) => s.id === id)
      expect(byId(rect.id).strokeWidth).toBe(4)
      // У подписи поле есть (дефолт makeShape), но обводки она не рисует — правка
      // его не касается, иначе «толщина линии» меняла бы данные впустую.
      expect(byId(text.id).strokeWidth).toBe(2)
    })

    it('applyToSelected правит все выделенные и не трогает остальные', () => {
      const ed = createStencilEditor()
      const a = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
      const b = ed.addShape({ type: 'circle', cx: 30, cy: 10, r: 5 })
      const c = ed.addShape({ type: 'rect', x: 60, y: 0, w: 10, h: 10 })
      ed.selectMany([a.id, b.id])
      ed.applyToSelected({ stroke: '#ff0000' })

      const byId = (id) => ed.shapes.value.find((s) => s.id === id)
      expect(byId(a.id).stroke).toBe('#ff0000')
      expect(byId(b.id).stroke).toBe('#ff0000')
      expect(byId(c.id).stroke).toBe('#000')
    })

    it('без выделения правка — no-op, общее значение — undefined', () => {
      const ed = createStencilEditor()
      const a = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
      ed.select(null)
      ed.applyToSelected({ stroke: '#ff0000' })
      expect(ed.shapes.value.find((s) => s.id === a.id).stroke).toBe('#000')
      expect(ed.commonValue((s) => s.stroke)).toBeUndefined()
    })
  })

  it('смена инструмента снимает выделение целиком', () => {
    const ed = createStencilEditor()
    ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    ed.addShape({ type: 'rect', x: 20, y: 0, w: 10, h: 10 })
    ed.selectAll()
    ed.setTool('rect')
    expect(ed.selectedIds.value).toEqual([])
  })

  it('applyPositionPreset: фигуры со старых ключей возвращаются в always (не теряются в SVG)', () => {
    const ed = createStencilEditor()
    ed.setAnimationMode('value')
    ed.addState()
    const oldKey = ed.meta.states[0].key
    ed.setStateColor(oldKey, '#f00')
    const shape = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    setState(ed, shape.id, oldKey)

    ed.applyPositionPreset() // набор состояний заменяется целиком

    expect(ed.meta.states.some((s) => s.key === oldKey)).toBe(false)
    // Иначе фигура осталась бы на несуществующем ключе и выпала из shape.svg.
    expect(ed.shapes.value[0].state).toBe('always')
    expect(ed.meta.stateColors[oldKey]).toBeUndefined()
    ed.undo() // пресет коммитится в историю
    expect(ed.shapes.value[0].state).toBe(oldKey)
  })

  it('setStateColor задаёт и снимает цвет состояния', () => {
    const ed = createStencilEditor()
    ed.setStateColor('false', '#64748b')
    expect(ed.meta.stateColors.false).toBe('#64748b')
    ed.setStateColor('false', '')
    expect(ed.meta.stateColors.false).toBeUndefined()
  })

  it('setStateColor: stroke+fill → объект; снятие одного канала оставляет другой', () => {
    const ed = createStencilEditor()
    ed.setStateColor('false', '#111', 'stroke')
    ed.setStateColor('false', '#222', 'fill')
    expect(ed.meta.stateColors.false).toEqual({ stroke: '#111', fill: '#222' })
    // сняли контур → остаётся только заливка (объект { fill })
    ed.setStateColor('false', '', 'stroke')
    expect(ed.meta.stateColors.false).toEqual({ fill: '#222' })
    // сняли заливку → ключ исчезает
    ed.setStateColor('false', '', 'fill')
    expect(ed.meta.stateColors.false).toBeUndefined()
  })

  it('setAnimationMode сбрасывает цвета состояний (ключи режимов разные)', () => {
    const ed = createStencilEditor()
    ed.setStateColor('false', '#64748b')
    ed.setAnimationMode('value')
    expect(ed.meta.stateColors).toEqual({})
  })

  it('removeState снимает цвет удалённого состояния', () => {
    const ed = createStencilEditor()
    ed.setAnimationMode('value')
    ed.addState()
    const key = ed.meta.states[0].key
    ed.setStateColor(key, '#ef4444')
    ed.removeState(key)
    expect(ed.meta.stateColors[key]).toBeUndefined()
  })

  it('addPort снапит к PORT_GRID, кладёт на ближайшую границу и авто-именует', () => {
    const ed = createStencilEditor() // 40×40 по умолчанию
    const p = ed.addPort(12, 3) // снап (10,0) → ближайшая сторона top → (10,0)
    expect(p.x % PORT_GRID).toBe(0)
    expect(p.y % PORT_GRID).toBe(0)
    expect(p).toMatchObject({ x: 10, y: 0, name: 'p1' })
  })

  it('addPort дедупит совпадающие точки', () => {
    const ed = createStencilEditor()
    ed.addPort(10, 10)
    const dup = ed.addPort(12, 8) // снап туда же → 10,10
    expect(dup).toBeNull()
    expect(ed.ports.value).toHaveLength(1)
  })

  it('имена портов не переиспользуются после удаления', () => {
    // Имя — вечный ключ: по нему провод держится за порт и оно уезжает в
    // data-tms-meta экспорта. Выдай его повторно — провод в другой форме сядет на
    // новый порт в другом месте символа.
    const ed = createStencilEditor()
    ed.addPort(0, 0)
    ed.addPort(10, 0)
    const p3 = ed.addPort(20, 0)
    ed.removePort(p3.id) // удалён ПОСЛЕДНИЙ — max по именам дал бы снова p3
    expect(ed.addPort(30, 0).name).toBe('p4')
    // Дырка в середине тоже не переиспользуется.
    ed.removePort(ed.ports.value.find((p) => p.name === 'p2').id)
    expect(ed.addPort(40, 10).name).toBe('p5')
    expect(ed.output().json.portSeq).toBe(5)
  })

  it('правка символа без portSeq продолжает нумерацию от максимума имён', () => {
    // Символы, сохранённые до появления счётчика: поля нет, но занятые имена есть.
    const ed = createStencilEditor()
    ed.loadStencil({
      id: 'cell_x',
      label: 'X',
      category: 'C',
      width: 40,
      height: 40,
      ports: [
        { name: 'p1', x: 0, y: 0 },
        { name: 'p7', x: 40, y: 0 },
      ],
      svgText: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g/></svg>',
    })
    expect(ed.addPort(10, 0).name).toBe('p8')
  })

  it('movePort снапит к сетке и держит порт на границе', () => {
    const ed = createStencilEditor() // 40×40
    const p = ed.addPort(0, 0)
    ed.movePort(p.id, 37, 15) // снап к 5 → (35,15) → ближайшая сторона right → (40,15)
    const moved = ed.ports.value.find((x) => x.id === p.id)
    expect(moved).toMatchObject({ x: 40, y: 15 })
  })

  it('снап зажимает координаты в bbox стенсила', () => {
    const ed = createStencilEditor()
    ed.meta.width = 40
    ed.meta.height = 40
    expect(ed.snapShapeX(999)).toBe(40)
    expect(ed.snapShapeY(-5)).toBe(0)
    expect(ed.snapShapeX(7.6)).toBe(8) // снап фигур к 1px — округление до пикселя
  })

  it('output собирает json + svg из черновика', () => {
    const ed = createStencilEditor()
    ed.meta.id = 'cell_test'
    ed.meta.label = 'Тест'
    ed.meta.category = 'Прочее'
    ed.meta.width = 20
    ed.meta.height = 20
    ed.addShape({ type: 'rect', x: 0, y: 0, w: 20, h: 20 })
    ed.addPort(10, 0)
    const { json, svg } = ed.output()
    expect(json).toMatchObject({ id: 'cell_test', shapeFile: 'shape.svg', width: 20 })
    expect(json.ports).toEqual([{ name: 'p1', x: 10, y: 0 }])
    expect(svg).toContain('<rect')
    expect(svg).toContain('viewBox="0 0 20 20"')
  })

  it('undo/redo: пустая история в начале, шаг за добавлением фигуры', () => {
    const ed = createStencilEditor()
    expect(ed.canUndo.value).toBe(false)
    const s = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    expect(ed.canUndo.value).toBe(true)
    expect(ed.canRedo.value).toBe(false)
    ed.undo()
    expect(ed.shapes.value).toHaveLength(0)
    expect(ed.canRedo.value).toBe(true)
    ed.redo()
    expect(ed.shapes.value).toHaveLength(1)
    expect(ed.shapes.value[0].id).toBe(s.id)
  })

  it('undo откатывает удаление и перемещение (commit на конце жеста)', () => {
    const ed = createStencilEditor()
    const s = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    ed.updateShape(s.id, { x: 20 }) // «drag» — сам по себе историю не пишет
    ed.commit() // компонент коммитит на конце жеста
    expect(ed.shapes.value[0].x).toBe(20)
    ed.undo()
    expect(ed.shapes.value[0].x).toBe(0)
  })

  it('commit дедупит no-op (drag без сдвига)', () => {
    const ed = createStencilEditor()
    ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    ed.commit() // ничего не менялось после addShape → шаг не добавляется
    ed.undo()
    expect(ed.shapes.value).toHaveLength(0) // один undo вернул к пустому
  })

  it('undo откатывает правку меты (подпись, размер)', () => {
    const ed = createStencilEditor()
    ed.meta.label = 'Задвижка'
    ed.meta.width = 60
    ed.commit() // инспектор/тулбар коммитят по завершении ввода
    ed.undo()
    expect(ed.meta.label).toBe('')
    expect(ed.meta.width).toBe(40)
    ed.redo()
    expect(ed.meta.label).toBe('Задвижка')
    expect(ed.meta.width).toBe(60)
  })

  it('undo откатывает цвет состояния', () => {
    const ed = createStencilEditor()
    ed.setAnimationMode('boolean')
    ed.setStateColor('false', '#64748b')
    ed.commit() // пипетка закрыта (@change)
    expect(ed.meta.stateColors.false).toBe('#64748b')
    ed.undo()
    expect(ed.meta.stateColors.false).toBeUndefined()
    expect(ed.meta.stateful).toBe(true) // откатился только цвет
  })

  it('setAnimationMode — ОДИН шаг истории, undo возвращает состояния и цвета целиком', () => {
    const ed = createStencilEditor()
    ed.setAnimationMode('value')
    ed.addState()
    const key = ed.meta.states[0].key
    ed.setStateColor(key, '#ef4444')
    ed.commit()
    ed.setAnimationMode('off') // сбрасывает stateful, quality, а НЕ states/цвета
    expect(ed.meta.stateful).toBe(false)
    ed.undo() // один Ctrl+Z — снова «по значению» с состоянием и его цветом
    expect(ed.meta.stateful).toBe(true)
    expect(ed.meta.stateMode).toBe('value')
    expect(ed.meta.states).toHaveLength(1)
    expect(ed.meta.stateColors[key]).toBe('#ef4444')
  })

  it('setAnimationMode(off) гасит quality до снимка — undo даёт целостное состояние', () => {
    const ed = createStencilEditor()
    ed.setAnimationMode('boolean')
    ed.meta.quality = true
    ed.commit()
    ed.setAnimationMode('off')
    expect(ed.meta.quality).toBe(false) // без анимации quality-биндингу не за что цепляться
    ed.undo()
    expect(ed.meta.quality).toBe(true)
    expect(ed.meta.stateful).toBe(true)
  })

  it('смена режима анимации откатывается целиком: и режим, и видимость фигур', () => {
    const ed = createStencilEditor()
    ed.setAnimationMode('boolean')
    const s = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    setState(ed, s.id, 'true')
    ed.setAnimationMode('value') // сбрасывает видимость фигур на always
    expect(ed.shapes.value[0].state).toBe('always')
    ed.undo()
    expect(ed.meta.stateMode).toBe('boolean')
    expect(ed.shapes.value[0].state).toBe('true') // раньше режим оставался новым
  })

  it('addState — дискретная операция, откатывается одним undo', () => {
    const ed = createStencilEditor()
    ed.setAnimationMode('value')
    ed.addState()
    expect(ed.meta.states).toHaveLength(1)
    ed.undo()
    expect(ed.meta.states).toHaveLength(0)
  })

  it('новое действие после undo отсекает redo-хвост', () => {
    const ed = createStencilEditor()
    ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    ed.undo()
    expect(ed.canRedo.value).toBe(true)
    ed.addShape({ type: 'circle', cx: 5, cy: 5, r: 3 })
    expect(ed.canRedo.value).toBe(false)
  })

  it('output обрезает пустые поля холста до контента', () => {
    const ed = createStencilEditor()
    ed.meta.id = 'cell_crop'
    ed.meta.label = 'Crop'
    ed.meta.category = 'Прочее'
    ed.meta.width = 40
    ed.meta.height = 40
    ed.addShape({ type: 'rect', x: 10, y: 10, w: 20, h: 20 }) // элемент 20×20 на 40×40
    const { json, svg } = ed.output()
    expect(json).toMatchObject({ width: 20, height: 20 })
    expect(svg).toContain('viewBox="0 0 20 20"')
    expect(svg).toContain('<rect x="0" y="0" width="20" height="20"')
  })

  it('loadStencil грузит стенсил на правку (editingId, shapes, ports, чистая история)', () => {
    const ed = createStencilEditor()
    ed.loadStencil({
      id: 'cell_edit',
      label: 'Правка',
      category: 'Прочее',
      width: 20,
      height: 20,
      ports: [{ name: 'top', x: 10, y: 0 }],
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
        '<rect x="0" y="0" width="20" height="20" fill="none" stroke="#000" stroke-width="2"/></svg>',
    })
    expect(ed.editingId.value).toBe('cell_edit')
    expect(ed.meta).toMatchObject({ id: 'cell_edit', label: 'Правка', width: 20 })
    expect(ed.shapes.value[0]).toMatchObject({ type: 'rect', x: 0, y: 0, w: 20, h: 20 })
    expect(ed.ports.value[0]).toMatchObject({ name: 'top', x: 10, y: 0 })
    // История сброшена к загруженному состоянию — первый undo не уводит к пустому.
    expect(ed.canUndo.value).toBe(false)
  })

  it('loadStencil грузит декл-флаги, output их пишет', () => {
    const ed = createStencilEditor()
    ed.loadStencil({
      id: 'cell_flags',
      label: 'F',
      category: 'Прочее',
      width: 20,
      height: 20,
      noRotate: true,
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
        '<rect x="0" y="0" width="20" height="20" fill="none" stroke="#000" stroke-width="2"/></svg>',
    })
    expect(ed.meta.noRotate).toBe(true)
    expect(ed.output().json).toMatchObject({ noRotate: true })
  })

  it('запрет поворота, выставленный существующему символу, доезжает до json', () => {
    // Символ БЕЗ флага: правим и включаем запрет — он обязан появиться в json, иначе
    // на холсте кнопки поворота останутся живыми (гейт canCellRotate читает реестр).
    const ed = createStencilEditor()
    ed.loadStencil({
      id: 'cell_plain',
      label: 'P',
      category: 'Прочее',
      width: 20,
      height: 20,
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
        '<rect x="0" y="0" width="20" height="20" fill="none" stroke="#000" stroke-width="2"/></svg>',
    })
    expect(ed.meta.noRotate).toBe(false)
    expect(ed.output().json.noRotate).toBeUndefined()

    ed.meta.noRotate = true
    ed.commit()
    expect(ed.output().json).toMatchObject({ noRotate: true })
    // Снимок истории тоже несёт флаг: иначе следующий Ctrl+Z молча снял бы запрет.
    ed.undo()
    ed.redo()
    expect(ed.meta.noRotate).toBe(true)
  })

  it('addShape по умолчанию даёт state=always; смена состояния меняет и коммитит', () => {
    const ed = createStencilEditor()
    const s = ed.addShape({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 })
    expect(s.state).toBe('always')
    setState(ed, s.id, 'true')
    expect(ed.shapes.value[0].state).toBe('true')
    ed.undo() // смена состояния коммитит → undo возвращает к always
    expect(ed.shapes.value[0].state).toBe('always')
  })

  it('stateful выключен по умолчанию; output не пишет анимацию, пока не включён', () => {
    const ed = createStencilEditor()
    ed.meta.id = 'cell_anim'
    ed.meta.label = 'A'
    ed.meta.category = 'Прочее'
    ed.meta.width = 20
    ed.meta.height = 20
    const s = ed.addShape({ type: 'line', x1: 10, y1: 0, x2: 10, y2: 20 })
    setState(ed, s.id, 'true')
    expect(ed.meta.stateful).toBe(false)
    expect(ed.output().json.animationTemplate).toBeUndefined() // тумблер выключен

    ed.meta.stateful = true
    const { json, svg } = ed.output()
    expect(json.slots).toEqual([{ key: 'onoff', type: 'Boolean' }])
    expect(json.animationTemplate).toHaveLength(1)
    expect(svg).toContain('data-anim-suffix=".true"')
  })

  it('loadStencil включает stateful и читает слот из animationTemplate-стенсила', () => {
    const ed = createStencilEditor()
    ed.loadStencil({
      id: 'cell_state',
      label: 'S',
      category: 'Прочее',
      width: 20,
      height: 40,
      // старый ключ state/лейбл — на загрузке нормализуются к стандартному onoff (без label)
      slots: [{ key: 'state', label: 'пук', type: 'Boolean' }],
      animationTemplate: [{ idSuffix: '.true', type: 'shape', bindings: [] }],
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 40"><g></g>' +
        '<g data-anim-suffix=".true"><line x1="10" y1="12" x2="10" y2="28" stroke="#000" stroke-width="2"/></g></svg>',
    })
    expect(ed.meta.stateful).toBe(true)
    expect(ed.meta.stateSlot).toEqual({ key: 'onoff' })
    expect(ed.shapes.value[0]).toMatchObject({ type: 'line', state: 'true' })
  })

  it('режим «по значению»: пресет, назначение фигуры, output даёт value-слот + states', () => {
    const ed = createStencilEditor()
    ed.meta.id = 'cell_qs'
    ed.meta.label = 'Q'
    ed.meta.category = 'Прочее'
    ed.meta.width = 20
    ed.meta.height = 40
    ed.meta.stateful = true
    ed.setAnimationMode('value')
    expect(ed.meta.stateSlot).toEqual({ key: 'value' })
    ed.applyPositionPreset()
    expect(ed.meta.states.map((s) => s.key)).toEqual(['on', 'off', 'intermediate', 'invalid'])
    ed.updateState('on', { code: '01' })
    ed.updateState('off', { code: '10' })
    const s = ed.addShape({ type: 'line', x1: 10, y1: 0, x2: 10, y2: 20 })
    setState(ed, s.id, 'on')

    const { json, svg } = ed.output()
    expect(json.slots).toEqual([{ key: 'value', type: 'Value' }])
    expect(json.states).toHaveLength(4)
    expect(svg).toContain('data-anim-suffix=".on"')
    const on = json.animationTemplate.find((t) => t.idSuffix === '.on')
    expect(on.bindings[0].when.cases['10'].apply.addClass).toBe('animation-hidden')
  })

  it('setAnimationMode сбрасывает видимость фигур (ключи режимов несовместимы)', () => {
    const ed = createStencilEditor()
    const s = ed.addShape({ type: 'line', x1: 10, y1: 0, x2: 10, y2: 20 })
    ed.meta.stateful = true
    setState(ed, s.id, 'true')
    ed.setAnimationMode('value')
    expect(ed.shapes.value[0].state).toBe('always')
  })

  it('removeState возвращает осиротевшие фигуры в always', () => {
    const ed = createStencilEditor()
    ed.meta.stateful = true
    ed.setAnimationMode('value')
    ed.addState()
    const key = ed.meta.states[0].key
    const s = ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    setState(ed, s.id, key)
    ed.removeState(key)
    expect(ed.meta.states).toHaveLength(0)
    expect(ed.shapes.value[0].state).toBe('always')
  })

  it('loadStencil c полем states → режим value, ключи состояний из суффиксов', () => {
    const ed = createStencilEditor()
    ed.loadStencil({
      id: 'cell_qs',
      label: 'Q',
      category: 'Прочее',
      width: 20,
      height: 40,
      slots: [{ key: 'value', type: 'Value' }],
      states: [
        { key: 'on', label: 'Включен', code: '01' },
        { key: 'off', label: 'Отключен', code: '10' },
      ],
      animationTemplate: [{ idSuffix: '.on', type: 'shape', bindings: [] }],
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 40"><g></g>' +
        '<g data-anim-suffix=".on"><line x1="10" y1="12" x2="10" y2="28" stroke="#000" stroke-width="2"/></g></svg>',
    })
    expect(ed.meta.stateful).toBe(true)
    expect(ed.meta.stateMode).toBe('value')
    expect(ed.meta.stateSlot).toEqual({ key: 'value' })
    expect(ed.meta.states).toHaveLength(2)
    expect(ed.shapes.value[0]).toMatchObject({ type: 'line', state: 'on' })
  })

  it('reset очищает черновик к пустому', () => {
    const ed = createStencilEditor()
    ed.meta.id = 'cell_x'
    ed.meta.noRotate = true
    ed.meta.stateful = true
    ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    ed.reset()
    expect(ed.meta).toMatchObject({
      id: '',
      label: '',
      width: 40,
      height: 40,
      noRotate: false,
      stateful: false,
    })
    expect(ed.shapes.value).toHaveLength(0)
    expect(ed.editingId.value).toBeNull()
    expect(ed.canUndo.value).toBe(false)
  })
})

describe('useStencilEditor (синглтон)', () => {
  it('возвращает один и тот же инстанс', () => {
    expect(useStencilEditor()).toBe(useStencilEditor())
  })
})

describe('nudgeShapes', () => {
  it('двигает всё выделение одним смещением, один шаг истории', () => {
    const ed = createStencilEditor()
    const a = ed.addShape({ type: 'rect', x: 10, y: 10, w: 10, h: 10 })
    const b = ed.addShape({ type: 'line', x1: 12, y1: 12, x2: 18, y2: 12 })
    const c = ed.addShape({ type: 'rect', x: 0, y: 0, w: 5, h: 5 })
    ed.selectMany([a.id, b.id])

    ed.nudgeShapes(5, 0)
    const byId = (id) => ed.shapes.value.find((s) => s.id === id)
    expect(byId(a.id)).toMatchObject({ x: 15, y: 10 })
    // Взаимное расположение не разъезжается: поштучный снап сдвинул бы линию иначе.
    expect(byId(b.id)).toMatchObject({ x1: 17, x2: 23, y1: 12 })
    expect(byId(c.id)).toMatchObject({ x: 0, y: 0 }) // не выделена
    // Один Ctrl+Z откатывает сдвиг всей пачки.
    ed.undo()
    expect(byId(a.id)).toMatchObject({ x: 10, y: 10 })
    expect(byId(b.id)).toMatchObject({ x1: 12, x2: 18 })
  })

  it('упор в край обрезает шаг, а не отменяет его', () => {
    const ed = createStencilEditor() // холст 40×40
    const s = ed.addShape({ type: 'rect', x: 33, y: 0, w: 5, h: 5 })
    ed.select(s.id)

    ed.nudgeShapes(5, 0)
    // Правый край фигуры (38) доезжает до 40 — шаг обрезан, а не потерян.
    expect(ed.shapes.value[0]).toMatchObject({ x: 35 })
    ed.nudgeShapes(5, 0)
    expect(ed.shapes.value[0]).toMatchObject({ x: 35 })
    // Шаг «в упор» пустой — истории не пишет, поэтому Ctrl+Z возвращает к 33.
    ed.undo()
    expect(ed.shapes.value[0]).toMatchObject({ x: 33 })
  })

  it('без выделения и с нулевым смещением ничего не делает', () => {
    const ed = createStencilEditor()
    const s = ed.addShape({ type: 'rect', x: 10, y: 10, w: 10, h: 10 })
    ed.select(null)
    ed.nudgeShapes(5, 0)
    ed.select(s.id)
    ed.nudgeShapes(0, 0)
    expect(ed.shapes.value[0]).toMatchObject({ x: 10, y: 10 })
  })
})

describe('порядок наложения фигур', () => {
  const ids = (ed) => ed.shapes.value.map((s) => s.text)

  /** Три подписи с известным порядком: a (низ) → b → c (верх). */
  function threeShapes() {
    const ed = createStencilEditor()
    for (const text of ['a', 'b', 'c']) ed.addShape({ type: 'text', x: 0, y: 0, text })
    return ed
  }

  it('на передний/задний план двигает выделенное как целое', () => {
    const ed = threeShapes()
    const [a, b] = ed.shapes.value.map((s) => s.id)
    ed.reorderShapes([a, b], 'front')
    // Взаимный порядок выделенных сохраняется.
    expect(ids(ed)).toEqual(['c', 'a', 'b'])
    ed.reorderShapes([b], 'back')
    expect(ids(ed)).toEqual(['b', 'c', 'a'])
  })

  it('выше/ниже — на одну позицию', () => {
    const ed = threeShapes()
    const b = ed.shapes.value[1].id
    ed.reorderShapes([b], 'forward')
    expect(ids(ed)).toEqual(['a', 'c', 'b'])
    ed.reorderShapes([b], 'backward')
    expect(ids(ed)).toEqual(['a', 'b', 'c'])
  })

  it('шаг истории только на реальном перемещении, undo возвращает порядок', () => {
    const ed = threeShapes()
    const top = ed.shapes.value[2].id
    // Верхняя уже на переднем плане — двигать некуда, пустой шаг не пишем.
    ed.reorderShapes([top], 'front')
    expect(ed.canUndo.value).toBe(true) // от addShape
    const before = ids(ed)
    ed.undo()
    // Последним шагом был addShape('c'), а не порядок → откатывается именно он.
    expect(ids(ed)).toEqual(['a', 'b'])
    ed.redo()
    expect(ids(ed)).toEqual(before)

    ed.reorderShapes([ed.shapes.value[0].id], 'front')
    expect(ids(ed)).toEqual(['b', 'c', 'a'])
    ed.undo()
    expect(ids(ed)).toEqual(['a', 'b', 'c'])
  })

  it('чужие и пустые id игнорируются', () => {
    const ed = threeShapes()
    ed.reorderShapes(['ghost'], 'front')
    ed.reorderShapes([], 'back')
    expect(ids(ed)).toEqual(['a', 'b', 'c'])
  })
})
