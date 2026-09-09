import { describe, it, expect } from 'vitest'
import { rangeBarSegments } from './rangeBar'

const ROWS = [
  { min: 0, max: 4, color: '#10b981' },
  { min: 4, max: 6, color: '#f59e0b' },
  { min: 6, max: 10, color: '#ef4444' },
]

describe('rangeBarSegments', () => {
  it('сегменты идут в порядке строк, ширина пропорциональна', () => {
    const bar = rangeBarSegments(ROWS)
    expect({ from: bar.from, to: bar.to }).toEqual({ from: 0, to: 10 })
    expect(bar.segments.map((s) => [s.left, s.width])).toEqual([
      [0, 40],
      [40, 20],
      [60, 40],
    ])
  })

  it('пропуск между строками сегментом не закрывается — фон полоски виден', () => {
    const bar = rangeBarSegments([
      { min: 0, max: 2, color: '#10b981' },
      { min: 8, max: 10, color: '#ef4444' },
    ])
    expect(bar.segments.map((s) => [s.left, s.width])).toEqual([
      [0, 20],
      [80, 20],
    ])
  })

  it('перекрытие рисуется как есть: рантайм берёт первую подходящую строку', () => {
    const bar = rangeBarSegments([
      { min: 0, max: 6, color: '#10b981' },
      { min: 4, max: 10, color: '#ef4444' },
    ])
    expect(bar.segments.map((s) => s.left)).toEqual([0, 40])
  })

  it('перевёрнутые границы нормализуются', () => {
    const bar = rangeBarSegments([{ min: 10, max: 0, color: '#10b981' }])
    expect(bar.segments[0]).toMatchObject({ left: 0, width: 100, from: 0, to: 10 })
  })

  it('строки без цвета и без чисел не участвуют', () => {
    const bar = rangeBarSegments([
      { min: 0, max: 5 }, // без цвета — в экспорт не попадёт
      { color: '#10b981' }, // без границ
      { min: 0, max: 10, color: 'url(evil)' }, // цвет вне маски
      { min: 0, max: 10, color: '#10b981' },
    ])
    expect(bar.segments).toHaveLength(1)
  })

  it('нечего рисовать: пусто, одна точка, мусор', () => {
    expect(rangeBarSegments([])).toBeNull()
    expect(rangeBarSegments(null)).toBeNull()
    expect(rangeBarSegments([{ min: 3, max: 3, color: '#10b981' }])).toBeNull()
  })
})
