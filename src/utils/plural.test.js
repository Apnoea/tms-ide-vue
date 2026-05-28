import { describe, it, expect } from 'vitest'
import { nplural } from './plural'

describe('nplural', () => {
  it('1, 21, 31 → one form', () => {
    expect(nplural(1, 'тег', 'тега', 'тегов')).toBe('1 тег')
    expect(nplural(21, 'тег', 'тега', 'тегов')).toBe('21 тег')
    expect(nplural(31, 'тег', 'тега', 'тегов')).toBe('31 тег')
  })

  it('2..4, 22..24 → few form', () => {
    expect(nplural(2, 'тег', 'тега', 'тегов')).toBe('2 тега')
    expect(nplural(3, 'тег', 'тега', 'тегов')).toBe('3 тега')
    expect(nplural(4, 'тег', 'тега', 'тегов')).toBe('4 тега')
    expect(nplural(22, 'тег', 'тега', 'тегов')).toBe('22 тега')
  })

  it('5..20, 25..30 → many form', () => {
    expect(nplural(0, 'тег', 'тега', 'тегов')).toBe('0 тегов')
    expect(nplural(5, 'тег', 'тега', 'тегов')).toBe('5 тегов')
    expect(nplural(10, 'тег', 'тега', 'тегов')).toBe('10 тегов')
    expect(nplural(25, 'тег', 'тега', 'тегов')).toBe('25 тегов')
  })

  it('11..14 — особый случай (many)', () => {
    expect(nplural(11, 'тег', 'тега', 'тегов')).toBe('11 тегов')
    expect(nplural(12, 'тег', 'тега', 'тегов')).toBe('12 тегов')
    expect(nplural(13, 'тег', 'тега', 'тегов')).toBe('13 тегов')
    expect(nplural(14, 'тег', 'тега', 'тегов')).toBe('14 тегов')
  })
})
