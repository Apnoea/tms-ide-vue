import { describe, it, expect } from 'vitest'
import { editRanges } from './useValueRanges'

const RANGES = [
  { min: 0, max: 3.99, class: 'animation-low' },
  { min: 4, max: 10, class: 'animation-high' },
]

describe('editRanges', () => {
  it('пишет число в нужный порог, остальные не трогает', () => {
    const out = editRanges(RANGES, 1, 'min', '5')
    expect(out[1]).toEqual({ min: 5, max: 10, class: 'animation-high' })
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

  it('class меняется как строка, без числового парсинга', () => {
    expect(editRanges(RANGES, 0, 'class', 'animation-mid')[0].class).toBe('animation-mid')
  })
})
