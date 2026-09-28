// @vitest-environment jsdom
// Символ под курсором поднимается над соседями (их узлы в слое позже и закрывают его
// порты), на уходе мыши возвращается на место. Модель не меняется — только DOM.
import { describe, it, expect, vi } from 'vitest'
import { createHoverRaise } from './hoverRaise'

function setup() {
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const cells = new Map()
  const view = (id, { ports = 1, locked = false, element = true } = {}) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    el.id = id
    layer.appendChild(el)
    const model = {
      id,
      isElement: () => element,
      getPorts: () => Array.from({ length: ports }, (_, i) => ({ id: `p${i}` })),
      get: (key) => (key === 'tms' && locked ? { locked: true } : undefined),
    }
    cells.set(id, model)
    return { el, model }
  }
  // Возврат по z: для теста — «на исходное место», первым в слой.
  const insertCellView = vi.fn((v) => layer.insertBefore(v.el, layer.firstChild))
  const paper = {
    model: { getCell: (id) => cells.get(id) ?? null, getCellLayerId: () => 'cells' },
    getLayerView: () => ({ insertCellView }),
  }
  const order = () => Array.from(layer.children, (n) => n.id)
  return { layer, cells, view, paper, insertCellView, order }
}

describe('createHoverRaise', () => {
  it('символ под курсором — последним в слое, на уходе — обратно по z', () => {
    const { view, paper, order, insertCellView } = setup()
    const a = view('a')
    view('b')
    const hr = createHoverRaise(paper)
    hr.raise(a)
    expect(order()).toEqual(['b', 'a'])
    hr.lower()
    expect(insertCellView).toHaveBeenCalledWith(a)
    expect(order()).toEqual(['a', 'b'])
  })

  it('новый ховер сначала возвращает прежний', () => {
    const { view, paper, insertCellView } = setup()
    const a = view('a')
    const b = view('b')
    view('c')
    const hr = createHoverRaise(paper)
    hr.raise(a)
    hr.raise(b)
    expect(insertCellView).toHaveBeenCalledWith(a)
  })

  it('без портов (фигура-разметка) и заблокированный — не поднимаются', () => {
    const { view, paper, order } = setup()
    const shape = view('shape', { ports: 0 })
    const locked = view('locked', { locked: true })
    view('b')
    const hr = createHoverRaise(paper)
    hr.raise(shape)
    hr.raise(locked)
    expect(order()).toEqual(['shape', 'locked', 'b'])
  })

  it('уже последний узел не переставляется', () => {
    const { view, paper, layer } = setup()
    view('a')
    const b = view('b')
    const hr = createHoverRaise(paper)
    const spy = vi.spyOn(layer, 'appendChild')
    hr.raise(b)
    expect(spy).not.toHaveBeenCalled()
  })

  it('удалённую ячейку не возвращает в слой', () => {
    const { view, paper, cells, insertCellView } = setup()
    const a = view('a')
    view('b')
    const hr = createHoverRaise(paper)
    hr.raise(a)
    cells.delete('a')
    a.el.remove()
    hr.lower()
    expect(insertCellView).not.toHaveBeenCalled()
  })
})
