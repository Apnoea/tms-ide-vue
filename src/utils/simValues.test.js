import { describe, it, expect } from 'vitest'
import { boolOf, rangeRowFor, stateKeyFor, formatValueText, randomValueForTag } from './simValues'

describe('boolOf', () => {
  it('число, строка и boolean приводятся к состоянию биндинга', () => {
    expect(boolOf(true)).toBe(true)
    expect(boolOf(1)).toBe(true)
    expect(boolOf(0)).toBe(false)
    expect(boolOf('1')).toBe(true)
    expect(boolOf('false')).toBe(false)
    expect(boolOf('')).toBe(false)
    expect(boolOf(undefined)).toBe(false)
  })
})

describe('rangeRowFor', () => {
  const src = {
    ranges: [
      { min: 0, max: 5, color: '#10b981' },
      { min: 5, max: 100, color: '#f59e0b' },
      { min: 100, max: 1000, color: '#ef4444' },
    ],
  }

  it('строка выбирается сравнением с границами, обе inclusive', () => {
    expect(rangeRowFor(src, 3).color).toBe('#10b981')
    // Граница принадлежит обеим строкам — берём первую, как порядок в источнике.
    expect(rangeRowFor(src, 5).color).toBe('#10b981')
    expect(rangeRowFor(src, 50).color).toBe('#f59e0b')
    expect(rangeRowFor(src, 500).color).toBe('#ef4444')
  })

  it('значение вне строк и не-число → цвета нет', () => {
    expect(rangeRowFor(src, 5000)).toBeNull()
    expect(rangeRowFor(src, -1)).toBeNull()
    expect(rangeRowFor(src, 'x')).toBeNull()
    expect(rangeRowFor(null, 1)).toBeNull()
  })

  it('строка без цвета не участвует, открытая граница не ограничивает', () => {
    expect(rangeRowFor({ ranges: [{ min: 0, max: 5 }] }, 1)).toBeNull()
    expect(rangeRowFor({ ranges: [{ min: 10, color: '#fff' }] }, 1e6).color).toBe('#fff')
    expect(rangeRowFor({ ranges: [{ max: 10, color: '#fff' }] }, -1e6).color).toBe('#fff')
  })
})

describe('stateKeyFor', () => {
  const states = [
    { key: 'on', code: '1' },
    { key: 'off', code: '2' },
    { key: 'unknown', code: '' },
  ]

  it('состояние выбирается по коду, сравнение строковое', () => {
    expect(stateKeyFor(states, 1)).toBe('on')
    expect(stateKeyFor(states, '2')).toBe('off')
  })

  it('состояние без кода и значение вне кодов не активируются', () => {
    expect(stateKeyFor(states, 3)).toBeNull()
    expect(stateKeyFor(states, '')).toBeNull()
    expect(stateKeyFor(states, null)).toBeNull()
  })
})

describe('formatValueText', () => {
  it('число печатается с точностью карточки, прочее — как есть', () => {
    expect(formatValueText(12.345, 2)).toBe('12.35')
    expect(formatValueText(12.345, 0)).toBe('12')
    expect(formatValueText('АВАРИЯ', 2)).toBe('АВАРИЯ')
    expect(formatValueText(null, 2)).toBe('--')
    expect(formatValueText(Infinity, 2)).toBe('--')
  })
})

describe('randomValueForTag', () => {
  it('у символа «по значению» берётся код состояния', () => {
    const states = [
      { key: 'on', code: '1' },
      { key: 'off', code: '2' },
    ]
    expect(randomValueForTag({ states, rnd: () => 0 })).toBe(1)
    expect(randomValueForTag({ states, rnd: () => 0.99 })).toBe(2)
  })

  it('при диапазонах значение попадает ВНУТРЬ строки, иначе цвет был бы недостижим', () => {
    const rangeSource = { ranges: [{ min: 10, max: 20, color: '#fff' }] }
    const v = randomValueForTag({ rangeSource, rnd: () => 0.5 })
    expect(v).toBeGreaterThanOrEqual(10)
    expect(v).toBeLessThanOrEqual(20)
    expect(rangeRowFor(rangeSource, v)).not.toBeNull()
  })

  it('булев тип даёт boolean, прочее — число', () => {
    expect(randomValueForTag({ type: 'Boolean', rnd: () => 0.1 })).toBe(true)
    expect(randomValueForTag({ type: 'Boolean', rnd: () => 0.9 })).toBe(false)
    expect(typeof randomValueForTag({ type: 'Float', rnd: () => 0.5 })).toBe('number')
  })
})
