// @vitest-environment jsdom
// Жесты рисования на столе редактора: протяжка, клики ломаной, отмена по Esc.
import { describe, it, expect, afterEach } from 'vitest'
import { ref } from 'vue'
import { withSetup } from './test-utils'
import { createStencilEditor } from './useStencilEditor'
import { useEditorDraw } from './useEditorDraw'

let scope = null
afterEach(() => scope?.stop())

// Координаты события = user-координаты: масштаб и снап здесь не проверяются.
const units = (e) => ({ x: e.clientX, y: e.clientY })
const press = (x, y) => ({ button: 0, clientX: x, clientY: y, target: { closest: () => null } })
const pointer = (type, x, y) =>
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }))

function setup(tool) {
  const ed = createStencilEditor()
  ed.setTool(tool)
  const [draw, s] = withSetup(() =>
    useEditorDraw({ ed, scale: ref(10), unitsFromEvent: units, snappedShape: units })
  )
  scope = s
  return { ed, draw }
}

describe('useEditorDraw', () => {
  it('прямоугольник — протяжкой, клик без протяжки фигуры не даёт', () => {
    const { ed, draw } = setup('rect')
    draw.onDrawDown(press(2, 2))
    pointer('pointermove', 12, 8)
    expect(draw.draftRect.value).toEqual({ x: 2, y: 2, w: 10, h: 6 })
    pointer('pointerup', 12, 8)
    expect(ed.shapes.value[0]).toMatchObject({ type: 'rect', x: 2, y: 2, w: 10, h: 6 })

    ed.setTool('rect')
    draw.onDrawDown(press(5, 5))
    pointer('pointerup', 5, 5)
    expect(ed.shapes.value).toHaveLength(1)
  })

  it('ломаная: клик по стартовой вершине замыкает её', () => {
    const { ed, draw } = setup('polyline')
    draw.onDrawDown(press(0, 0))
    draw.onDrawDown(press(10, 0))
    draw.onDrawDown(press(10, 10))
    draw.onDrawDown(press(0, 0))
    expect(ed.shapes.value[0]).toMatchObject({ type: 'polyline', closed: true })
    expect(ed.shapes.value[0].points).toHaveLength(3)
  })

  it('cancelDraw бросает начатую ломаную и сообщает, было ли что бросать', () => {
    const { ed, draw } = setup('polyline')
    expect(draw.cancelDraw()).toBe(false)
    draw.onDrawDown(press(0, 0))
    expect(draw.cancelDraw()).toBe(true)
    expect(draw.polyPreview.value).toBe('')
    expect(ed.shapes.value).toHaveLength(0)
  })
})
