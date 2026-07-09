import { describe, it, expect } from 'vitest'
import { createStencilEditor, useStencilEditor, PORT_GRID } from './useStencilEditor'

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
    ed.removeShape(s.id)
    expect(ed.shapes.value).toHaveLength(0)
    expect(ed.selectedId.value).toBeNull()
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

  it('movePort снапит к сетке и держит порт на границе', () => {
    const ed = createStencilEditor() // 40×40
    const p = ed.addPort(0, 0)
    ed.movePort(p.id, 37, 15) // снап (40,20) → ближайшая сторона right → (40,20)
    const moved = ed.ports.value.find((x) => x.id === p.id)
    expect(moved).toMatchObject({ x: 40, y: 20 })
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
      layoutOnly: true,
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
        '<rect x="0" y="0" width="20" height="20" fill="none" stroke="#000" stroke-width="2"/></svg>',
    })
    expect(ed.meta.noRotate).toBe(true)
    expect(ed.meta.layoutOnly).toBe(true)
    expect(ed.output().json).toMatchObject({ noRotate: true, layoutOnly: true })
  })

  it('addShape по умолчанию даёт state=always; setShapeState меняет и коммитит', () => {
    const ed = createStencilEditor()
    const s = ed.addShape({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 })
    expect(s.state).toBe('always')
    ed.setShapeState(s.id, 'true')
    expect(ed.shapes.value[0].state).toBe('true')
    ed.undo() // setShapeState коммитит → undo возвращает к always
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
    ed.setShapeState(s.id, 'true')
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
      layoutOnly: false,
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
