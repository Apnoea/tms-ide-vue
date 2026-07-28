import { describe, it, expect } from 'vitest'
import { range, rangeFromTo, gridLineColor, tickInset, rulerTicks } from './editorRulers'

describe('range / rangeFromTo', () => {
  it('range включает 0 и max', () => {
    expect(range(3)).toEqual([0, 1, 2, 3])
    expect(range(10, 5)).toEqual([0, 5, 10])
  })

  it('rangeFromTo работает с отрицательного (сетка за границами символа)', () => {
    expect(rangeFromTo(-2, 2)).toEqual([-2, -1, 0, 1, 2])
  })
})

describe('gridLineColor', () => {
  it('три уровня яркости: ÷10 темнее, ÷5 средний, остальное еле видно', () => {
    expect(gridLineColor(20)).toBe('#cbd5e1')
    expect(gridLineColor(15)).toBe('#e2e8f0')
    expect(gridLineColor(7)).toBe('#f1f5f9')
  })
})

describe('rulerTicks', () => {
  it('на крупном зуме шаг 1, уровни major/medium/minor', () => {
    const ticks = rulerTicks(10, 0, 8)
    expect(ticks).toHaveLength(11) // 0..10
    expect(ticks[0]).toEqual({ u: 0, p: 0, level: 'major' })
    expect(ticks[5]).toEqual({ u: 5, p: 40, level: 'medium' })
    expect(ticks[7].level).toBe('minor')
  })

  it('на мелком зуме 1px-штрихи скрыты (шаг 5)', () => {
    expect(rulerTicks(10, 0, 3).map((t) => t.u)).toEqual([0, 5, 10])
  })

  it('origin сдвигает экранные позиции', () => {
    expect(rulerTicks(0, 12, 4)[0].p).toBe(12)
  })

  it('tickInset: длина штриха по уровню', () => {
    expect([tickInset('major'), tickInset('medium'), tickInset('minor')]).toEqual([10, 6, 3])
  })
})
