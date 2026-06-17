import { describe, it, expect } from 'vitest'
import { pickPassThroughPorts, spliceRotation, planWireBridge } from './wireSplice'

// Порты cell_qf/qr: top@(10,0), bottom@(10,40) при позиции (0,0).
const vertPorts = [
  { id: 'top', x: 10, y: 0 },
  { id: 'bottom', x: 10, y: 40 },
]
// Порты cell_qw: 4 стороны.
const quadPorts = [
  { id: 'top', x: 10, y: 0 },
  { id: 'right', x: 20, y: 10 },
  { id: 'bottom', x: 10, y: 20 },
  { id: 'left', x: 0, y: 10 },
]

describe('pickPassThroughPorts', () => {
  it('<2 портов → null', () => {
    expect(
      pickPassThroughPorts([{ id: 'only', x: 10, y: 10 }], { x: 0, y: 0 }, { x: 0, y: 99 })
    ).toBe(null)
    expect(pickPassThroughPorts([], { x: 0, y: 0 }, { x: 0, y: 99 })).toBe(null)
  })

  it('вертикальный провод + вертикальные порты: in=верхний (к source сверху)', () => {
    const r = pickPassThroughPorts(vertPorts, { x: 10, y: -50 }, { x: 10, y: 90 })
    expect(r).toEqual({ portIn: 'top', portOut: 'bottom' })
  })

  it('перевёрнутый вертикальный провод: in/out меняются местами', () => {
    const r = pickPassThroughPorts(vertPorts, { x: 10, y: 90 }, { x: 10, y: -50 })
    expect(r).toEqual({ portIn: 'bottom', portOut: 'top' })
  })

  it('ГОРИЗОНТАЛЬНЫЙ провод + вертикальные порты (баг-кейс): всё равно два разных порта', () => {
    const r = pickPassThroughPorts(vertPorts, { x: -50, y: 20 }, { x: 90, y: 20 })
    expect(r).not.toBeNull()
    expect(r.portIn).not.toBe(r.portOut)
    expect(new Set([r.portIn, r.portOut])).toEqual(new Set(['top', 'bottom']))
  })

  it('4 порта, вертикальный провод → выбирает top/bottom', () => {
    const r = pickPassThroughPorts(quadPorts, { x: 10, y: -50 }, { x: 10, y: 70 })
    expect(new Set([r.portIn, r.portOut])).toEqual(new Set(['top', 'bottom']))
    expect(r.portIn).toBe('top') // source сверху
  })

  it('4 порта, горизонтальный провод → выбирает left/right', () => {
    const r = pickPassThroughPorts(quadPorts, { x: -50, y: 10 }, { x: 70, y: 10 })
    expect(new Set([r.portIn, r.portOut])).toEqual(new Set(['left', 'right']))
    expect(r.portIn).toBe('left') // source слева
  })

  it('4 порта, согнутый провод (центры по диагонали) + верт. сегмент → top/bottom', () => {
    // source вверху-слева, target внизу (диагональ центров), но локальный
    // сегмент провода вертикальный (wireDir) → пара top/bottom, не диагональная.
    const r = pickPassThroughPorts(
      quadPorts,
      { x: -100, y: -50 },
      { x: 30, y: 100 },
      { x: 0, y: 1 }
    )
    expect(new Set([r.portIn, r.portOut])).toEqual(new Set(['top', 'bottom']))
    expect(r.portIn).toBe('top') // source выше
  })
})

describe('spliceRotation', () => {
  const hDir = { x: 1, y: 0 } // горизонтальный сегмент провода
  const vDir = { x: 0, y: 1 } // вертикальный сегмент
  const hRef = { x: 0, y: 20 } // точка на горизонтальном проводе
  const vRef = { x: 10, y: 10 } // точка на вертикальном проводе

  it('гор. сегмент, курсор ВЫШЕ → 90 (по часовой)', () => {
    expect(spliceRotation(vertPorts, hDir, { x: 0, y: 0 }, hRef)).toBe(90)
  })

  it('гор. сегмент, курсор НИЖЕ → 270 (против часовой)', () => {
    expect(spliceRotation(vertPorts, hDir, { x: 0, y: 40 }, hRef)).toBe(270)
  })

  it('верт. сегмент + вертикальные порты (уже вдоль) → 0, НЕ 90', () => {
    // ключевой кейс: локальный сегмент вертикальный → элемент не доворачивается
    expect(spliceRotation(vertPorts, vDir, { x: -50, y: 10 }, vRef)).toBe(0)
  })

  it('верт. сегмент, курсор СПРАВА → 180', () => {
    expect(spliceRotation(vertPorts, vDir, { x: 50, y: 10 }, vRef)).toBe(180)
  })

  it('направление провода независимо от знака (вниз/вверх)', () => {
    expect(spliceRotation(vertPorts, { x: -1, y: 0 }, { x: 0, y: 0 }, hRef)).toBe(90)
  })

  it('4 порта (left/right вдоль гор. сегмента) → 0, курсор игнор', () => {
    expect(spliceRotation(quadPorts, hDir, { x: 0, y: 0 }, hRef)).toBe(0)
    expect(spliceRotation(quadPorts, hDir, { x: 0, y: 40 }, hRef)).toBe(0)
  })

  it('без курсора → базовое выравнивание', () => {
    expect(spliceRotation(vertPorts, hDir, null) % 180).toBe(90)
  })
})

describe('planWireBridge', () => {
  // A —[l1]— E —[l2]— B (E = удаляемый элемент)
  const passThrough = [
    { id: 'l1', source: { id: 'A', port: 'pa' }, target: { id: 'E', port: 'in' } },
    { id: 'l2', source: { id: 'E', port: 'out' }, target: { id: 'B', port: 'pb' } },
  ]

  it('проход A–E–B: выживает l1, его конец на E перецеливается на B', () => {
    expect(planWireBridge(passThrough, 'E')).toEqual({
      survivorId: 'l1',
      survivorEnd: 'target', // на E у l1 был target
      endpoint: { id: 'B', port: 'pb' },
      dropId: 'l2',
    })
  })

  it('оба провода входят в E как target — конец на элементе определяется верно', () => {
    const links = [
      { id: 'l1', source: { id: 'A' }, target: { id: 'E' } },
      { id: 'l2', source: { id: 'B' }, target: { id: 'E' } },
    ]
    const plan = planWireBridge(links, 'E')
    expect(plan.survivorEnd).toBe('target')
    expect(plan.endpoint).toEqual({ id: 'B' })
    expect(plan.dropId).toBe('l2')
  })

  it('endpoint без port — port в результат не попадает', () => {
    const links = [
      { id: 'l1', source: { id: 'A' }, target: { id: 'E', port: 'in' } },
      { id: 'l2', source: { id: 'E', port: 'out' }, target: { id: 'B' } },
    ]
    expect(planWireBridge(links, 'E').endpoint).toEqual({ id: 'B' })
  })

  it('1 провод (конечный элемент) → null', () => {
    expect(planWireBridge([passThrough[0]], 'E')).toBe(null)
  })

  it('3 провода (разветвление) → null', () => {
    expect(planWireBridge([...passThrough, passThrough[0]], 'E')).toBe(null)
  })

  it('оба провода к одному соседу → null', () => {
    const links = [
      { id: 'l1', source: { id: 'A' }, target: { id: 'E' } },
      { id: 'l2', source: { id: 'E' }, target: { id: 'A' } },
    ]
    expect(planWireBridge(links, 'E')).toBe(null)
  })

  it('висячий дальний конец → null', () => {
    const links = [
      { id: 'l1', source: { id: null }, target: { id: 'E' } },
      { id: 'l2', source: { id: 'E' }, target: { id: 'B' } },
    ]
    expect(planWireBridge(links, 'E')).toBe(null)
  })
})
