// Правила строк диапазона — общие для редактора символов и миграций: формат строки
// один, а расхождение между местами ввода дало бы разные зоны в экспорте.
import { describe, it, expect } from 'vitest'
import { cleanRangeRows, editRanges, newRangeRow, withZeroStart } from './rangeRows'
import { RANGE_COLOR_PRESETS } from '../constants/animation'

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
})

describe('newRangeRow', () => {
  it('берёт первый свободный цвет-пресет, пороги пустые', () => {
    expect(newRangeRow(null)).toEqual({ color: RANGE_COLOR_PRESETS[0] })
    const used = RANGE_COLOR_PRESETS.slice(0, 2).map((color) => ({ color }))
    expect(newRangeRow(used).color).toBe(RANGE_COLOR_PRESETS[2])
  })
})

// Низ первой строки фиксирован нулём: в инспекторе поле не правится, поэтому данные
// обязаны совпадать с тем, что показано.
describe('withZeroStart', () => {
  it('первой строке ставит min = 0, остальные не трогает', () => {
    const out = withZeroStart([
      { min: 5, max: 8, color: '#10b981' },
      { min: 8, max: 10, color: '#ef4444' },
    ])
    expect(out[0]).toEqual({ min: 0, max: 8, color: '#10b981' })
    expect(out[1]).toEqual({ min: 8, max: 10, color: '#ef4444' })
  })

  it('готовый список отдаёт как есть (без лишней перезаписи)', () => {
    const rows = [{ min: 0, max: 4, color: '#10b981' }]
    expect(withZeroStart(rows)).toBe(rows)
    expect(withZeroStart([])).toEqual([])
  })
})

// Один канон строк на редактор символов и миграцию: по нему наборы разных ячеек
// сравниваются между собой.
describe('cleanRangeRows', () => {
  it('оставляет строки с цветом и хотя бы одной границей, поля — канонично', () => {
    expect(
      cleanRangeRows([
        { min: 0, max: 5, color: '#10b981', extra: 1 },
        { max: 10, color: '#ef4444' },
        { min: 10, color: '#f59e0b', max: NaN },
        { min: 1, max: 2 }, // без цвета
        { color: '#000000' }, // без границ
        null,
      ])
    ).toEqual([
      { min: 0, max: 5, color: '#10b981' },
      { max: 10, color: '#ef4444' },
      { min: 10, color: '#f59e0b' },
    ])
    expect(cleanRangeRows(undefined)).toEqual([])
  })
})
