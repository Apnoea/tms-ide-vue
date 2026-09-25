import { describe, it, expect } from 'vitest'
import { GRID_PERIOD, gridPatternLines, tickInset, rulerTicks } from './editorRulers'

// Сетка редактора — один паттерн с тайлом GRID_PERIOD: в нём линия на каждую единицу
// и все три уровня яркости.
describe('gridPatternLines', () => {
  const lines = gridPatternLines()
  const colorAt = (p) => lines.find((l) => l.p === p).color

  it('линия на каждую единицу тайла, граница — с обеих сторон', () => {
    expect(lines.map((l) => l.p).sort((a, b) => a - b)).toEqual(
      Array.from({ length: GRID_PERIOD + 1 }, (_, i) => i)
    )
  })

  it('три уровня яркости: ÷10 темнее, ÷5 средний, остальное еле видно', () => {
    expect(colorAt(0)).toBe('#cbd5e1')
    expect(colorAt(GRID_PERIOD)).toBe('#cbd5e1')
    expect(colorAt(5)).toBe('#e2e8f0')
    expect(colorAt(7)).toBe('#f1f5f9')
  })

  it('тёмные линии идут последними — на пересечениях они сверху', () => {
    expect(lines.slice(-2).map((l) => l.p)).toEqual([0, GRID_PERIOD])
    expect(lines.at(-3).p).toBe(5)
  })
})

describe('rulerTicks', () => {
  it('на крупном зуме шаг 1, уровни major/medium/minor', () => {
    const ticks = rulerTicks(10, 8)
    expect(ticks).toHaveLength(11) // 0..10
    expect(ticks[0]).toEqual({ u: 0, p: 0, level: 'major' })
    expect(ticks[5]).toEqual({ u: 5, p: 40, level: 'medium' })
    expect(ticks[7].level).toBe('minor')
  })

  it('на мелком зуме 1px-штрихи скрыты (шаг 5)', () => {
    expect(rulerTicks(10, 3).map((t) => t.u)).toEqual([0, 5, 10])
  })

  // Прокрутка в делениях не участвует — её применяют сдвигом группы, поэтому список
  // не пересобирается на каждый скролл.
  it('позиции — от нуля символа, без учёта прокрутки', () => {
    expect(rulerTicks(10, 4).map((t) => t.p)).toEqual([0, 20, 40])
  })

  it('tickInset: длина штриха по уровню', () => {
    expect([tickInset('major'), tickInset('medium'), tickInset('minor')]).toEqual([10, 6, 3])
  })
})
