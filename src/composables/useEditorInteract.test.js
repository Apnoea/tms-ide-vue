// @vitest-environment jsdom
// Перенос фигур и портов и ресайз ручками на столе редактора: старт жеста, гейты, история.
import { describe, it, expect, afterEach } from 'vitest'
import { withSetup } from './test-utils'
import { createStencilEditor } from './useStencilEditor'
import { useEditorInteract } from './useEditorInteract'

let scope = null
afterEach(() => {
  scope?.stop()
  document.body.innerHTML = ''
})

// Координаты события = user-координаты: масштаб стола здесь не проверяется.
const units = (e) => ({ x: e.clientX, y: e.clientY })

function setup({ locked = false } = {}) {
  const ed = createStencilEditor()
  ;[, scope] = withSetup(() => useEditorInteract({ ed, unitsFromEvent: units, locked }))
  return ed
}

/** Элемент стола с ролью жеста — как фигура, ручка или порт в StencilEditor. */
function target(role, id, h) {
  const el = document.createElement('div')
  el.dataset.seMove = role
  el.dataset.id = id
  if (h) el.dataset.h = h
  document.body.append(el)
  return el
}
const down = (el, x, y, button = 0) =>
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button, clientX: x, clientY: y }))
const move = (x, y, opts = {}) =>
  document.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, ...opts }))
const up = () => document.dispatchEvent(new MouseEvent('pointerup'))

describe('useEditorInteract', () => {
  it('фигура едет со сдвига больше 1px, весь жест — один шаг истории', () => {
    const ed = setup()
    const s = ed.addShape({ type: 'rect', x: 5, y: 5, w: 10, h: 10 })
    const el = target('shape', s.id)
    down(el, 10, 10)
    move(11, 10)
    expect(ed.shapes.value[0]).toMatchObject({ x: 5, y: 5 })
    move(20, 13)
    move(22, 13)
    expect(ed.shapes.value[0]).toMatchObject({ x: 17, y: 8 })
    up()
    ed.undo()
    expect(ed.shapes.value[0]).toMatchObject({ x: 5, y: 5 })
  })

  it('клик без сдвига истории не пишет', () => {
    const ed = setup()
    const s = ed.addShape({ type: 'rect', x: 5, y: 5, w: 10, h: 10 })
    down(target('shape', s.id), 10, 10)
    up()
    ed.undo() // откатывает уже само добавление фигуры
    expect(ed.shapes.value).toHaveLength(0)
  })

  it('не ЛКМ, активный инструмент и запертый рисунок фигуру не двигают', () => {
    const ed = setup()
    const s = ed.addShape({ type: 'rect', x: 5, y: 5, w: 10, h: 10 })
    const el = target('shape', s.id)
    down(el, 10, 10, 2)
    move(20, 10)
    up()
    ed.setTool('rect')
    down(el, 10, 10)
    move(20, 10)
    up()
    expect(ed.shapes.value[0]).toMatchObject({ x: 5, y: 5 })

    scope.stop()
    document.body.innerHTML = ''
    const lockedEd = setup({ locked: true })
    const ls = lockedEd.addShape({ type: 'rect', x: 5, y: 5, w: 10, h: 10 })
    down(target('shape', ls.id), 10, 10)
    move(20, 10)
    expect(lockedEd.shapes.value[0]).toMatchObject({ x: 5, y: 5 })
  })

  it('ручка эллипса: Shift тянет обе полуоси', () => {
    const ed = setup()
    const s = ed.addShape({ type: 'circle', cx: 20, cy: 20, rx: 5, ry: 5 })
    const el = target('handle', s.id, 'rx')
    down(el, 25, 20)
    move(28, 20)
    expect(ed.shapes.value[0]).toMatchObject({ rx: 8, ry: 5 })
    move(30, 20, { shiftKey: true })
    expect(ed.shapes.value[0]).toMatchObject({ rx: 10, ry: 10 })
    up()
  })

  it('порт едет по своей грани', () => {
    const ed = setup()
    const p = ed.addPort(0, 10)
    down(target('port', p.id), 0, 10)
    move(0, 20)
    up()
    expect(ed.ports.value.find((x) => x.id === p.id)).toMatchObject({ x: 0, y: 20 })
  })
})
