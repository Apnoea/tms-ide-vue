// @vitest-environment jsdom
// Рендер примитивов редактора: тег/атрибуты по типу фигуры, halo выделения и
// SVG-namespace. Namespace проверяем отдельно: примитив создаётся через
// <component :is>, и если Vue отрендерит его как HTML-элемент, браузер покажет
// пустой холст (валидная разметка, но не SVG).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ShapePrimitive from './ShapePrimitive.vue'

const SVG_NS = 'http://www.w3.org/2000/svg'

function mountShape(shape, props = {}) {
  return mount({
    components: { ShapePrimitive },
    template: '<svg><ShapePrimitive :shape="shape" v-bind="extra" /></svg>',
    data: () => ({ shape, extra: props }),
  })
}

describe('ShapePrimitive', () => {
  it('rect: геометрия, стиль и data-атрибуты для interact', () => {
    const w = mountShape({
      id: 's1',
      type: 'rect',
      x: 5,
      y: 10,
      w: 20,
      h: 30,
      stroke: '#111',
      strokeWidth: 2,
      fill: 'none',
    })
    const el = w.find('rect')
    expect(el.element.namespaceURI).toBe(SVG_NS)
    expect(el.attributes()).toMatchObject({
      x: '5',
      y: '10',
      width: '20',
      height: '30',
      stroke: '#111',
      'stroke-width': '2',
      'data-se-move': 'shape',
      'data-id': 's1',
    })
    expect(el.attributes('rx')).toBeUndefined() // не rounded
  })

  it('rounded rect получает rx', () => {
    const w = mountShape({ id: 's1', type: 'rect', x: 0, y: 0, w: 10, h: 10, rounded: true })
    expect(w.find('rect').attributes('rx')).toBeDefined()
  })

  it('line: без заливки, скругление — круглые торцы', () => {
    const w = mountShape({
      id: 's2',
      type: 'line',
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      fill: '#fff',
      rounded: true,
    })
    const el = w.find('line')
    expect(el.element.namespaceURI).toBe(SVG_NS)
    expect(el.attributes('fill')).toBeUndefined() // заливка у линии бессмысленна
    expect(el.attributes('stroke-linecap')).toBe('round')
  })

  it('ломаная: замкнутая → polygon, открытая → polyline', () => {
    const points = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const closed = mountShape({ id: 's3', type: 'polyline', points, closed: true })
    expect(closed.find('polygon').attributes('points')).toBe('0,0 10,0 10,10')
    expect(closed.find('polyline').exists()).toBe(false)

    const open = mountShape({ id: 's4', type: 'polyline', points })
    expect(open.find('polyline').exists()).toBe(true)
    expect(open.find('polygon').exists()).toBe(false)
  })

  it('выделенная: halo идёт ПЕРЕД фигурой (в её слое, под ней)', () => {
    const shape = { id: 's5', type: 'circle', cx: 5, cy: 5, r: 3 }
    const w = mountShape(shape, { selected: true, haloWidth: 4, haloStroke: '#0ff' })
    const children = [...w.find('svg').element.children]
    expect(children.map((c) => c.tagName)).toEqual(['g', 'circle'])
    const halo = children[0]
    expect(halo.getAttribute('stroke-width')).toBe('4')
    expect(halo.getAttribute('fill')).toBe('none')
    expect(halo.firstElementChild.tagName).toBe('circle') // halo обводит ту же геометрию
    expect(halo.firstElementChild.namespaceURI).toBe(SVG_NS)
  })

  it('невыделенная halo не рисует', () => {
    const w = mountShape({ id: 's6', type: 'circle', cx: 5, cy: 5, r: 3 })
    expect(w.find('g').exists()).toBe(false)
  })

  it('pointerdown по фигуре эмитит select', async () => {
    const w = mountShape({ id: 's7', type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    await w.find('[data-se-move="shape"]').trigger('pointerdown')
    expect(w.findComponent(ShapePrimitive).emitted('select')).toHaveLength(1)
  })

  it('подпись: якорь из align, одна строка без tspan', () => {
    const w = mountShape({ id: 's9', type: 'text', x: 4, y: 12, text: 'Ввод', align: 'left' })
    const el = w.find('text')
    expect(el.attributes('text-anchor')).toBe('start')
    expect(el.findAll('tspan')).toHaveLength(0)
    expect(el.text()).toBe('Ввод')
  })

  it('подпись без align центрируется (дефолтный якорь)', () => {
    const w = mountShape({ id: 's10', type: 'text', x: 4, y: 12, text: 'Ввод' })
    expect(w.find('text').attributes('text-anchor')).toBe('middle')
  })

  it('многострочная подпись: tspan на строку, dy у первой = 0', () => {
    const w = mountShape({
      id: 's11',
      type: 'text',
      x: 4,
      y: 12,
      text: 'Ввод 110\nячейка 12',
      fontSize: 10,
      align: 'left',
    })
    const rows = w.findAll('tspan')
    expect(rows).toHaveLength(2)
    expect(rows[0].attributes()).toMatchObject({ x: '4', dy: '0' })
    expect(rows[1].attributes('dy')).toBe('12')
    expect(rows[1].text()).toBe('ячейка 12')
  })

  it('пустая подпись рисуется рамкой — иначе её нечем выделить и сдвинуть', () => {
    const w = mountShape({ id: 's12', type: 'text', x: 40, y: 15, fontSize: 10, align: 'right' })
    expect(w.find('text').exists()).toBe(false)
    // Рамка стоит там, где появится набранный текст: якорь end — влево от точки.
    expect(w.find('rect').attributes()).toMatchObject({
      x: '20',
      y: '5',
      width: '20',
      'data-se-move': 'shape',
      'data-id': 's12',
    })
  })

  it('роль подписи видна у фигуры: решётка у значения тега, пунктир у правимой', () => {
    // Иначе роль читается только по галкам выделенной фигуры, и в символе с тремя
    // подписями её приходится искать перебором.
    const value = mountShape({
      id: 's13',
      type: 'text',
      x: 10,
      y: 20,
      text: '--',
      fontSize: 10,
      valueText: true,
    })
    expect(value.findAll('text').some((t) => t.text() === '#')).toBe(true)
    expect(value.find('line').exists()).toBe(false)

    const param = mountShape({
      id: 's14',
      type: 'text',
      x: 10,
      y: 20,
      text: 'Ua',
      fontSize: 10,
      param: 'p1',
    })
    expect(param.find('line').attributes('stroke-dasharray')).toBe('2 2')
    expect(param.findAll('text').some((t) => t.text() === '#')).toBe(false)
  })

  it('pointerEvents=none в режиме рисования — фигура прозрачна для мыши', () => {
    const w = mountShape(
      { id: 's8', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
      {
        pointerEvents: 'none',
      }
    )
    expect(w.find('rect').attributes('pointer-events')).toBe('none')
  })
})
