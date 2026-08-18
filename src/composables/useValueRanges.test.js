import { describe, it, expect } from 'vitest'
import { editRanges } from './useValueRanges'

const RANGES = [
  { min: 0, max: 3.99, color: '#10b981' },
  { min: 4, max: 10, color: '#ef4444' },
]

describe('editRanges', () => {
  it('пишет число в нужный порог, остальные не трогает', () => {
    const out = editRanges(RANGES, 1, 'min', '5')
    expect(out[1]).toEqual({ min: 5, max: 10, color: '#ef4444' })
    expect(out[0]).toEqual(RANGES[0])
    expect(out).not.toBe(RANGES) // новый массив, без мутации исходного
  })

  it('русская десятичная запятая нормализуется в точку', () => {
    expect(editRanges(RANGES, 0, 'max', '3,5')[0].max).toBe(3.5)
  })

  it('нечисловой ввод → null (правку игнорируем, NaN в данные не попадает)', () => {
    expect(editRanges(RANGES, 0, 'min', 'abc')).toBeNull()
    expect(editRanges(RANGES, 0, 'min', '')).toBeNull()
  })

  it('цвет пишется строкой, без числового парсинга', () => {
    expect(editRanges(RANGES, 0, 'color', '#f59e0b')[0].color).toBe('#f59e0b')
  })

  it('точное значение правится тем же путём, что и порог', () => {
    const rows = [{ value: 1, color: '#10b981' }]
    expect(editRanges(rows, 0, 'value', '2')[0]).toEqual({ value: 2, color: '#10b981' })
    expect(editRanges(rows, 0, 'value', '')).toBeNull()
  })
})
