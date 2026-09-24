import { describe, it, expect } from 'vitest'
import { zoomKeyOf, toolDigitOf } from './viewKeys'

describe('zoomKeyOf', () => {
  it.each([
    ['Equal', 'in'],
    ['NumpadAdd', 'in'],
    ['Minus', 'out'],
    ['NumpadSubtract', 'out'],
    ['Digit0', 'fit'],
    ['Numpad0', 'fit'],
  ])('Ctrl+%s → %s', (code, dir) => {
    expect(zoomKeyOf({ code, ctrlKey: true })).toBe(dir)
  })

  it('Shift не мешает: «+» на основной клавиатуре — это Shift+=', () => {
    expect(zoomKeyOf({ code: 'Equal', ctrlKey: true, shiftKey: true })).toBe('in')
  })

  it('без Ctrl и с Alt — не зум', () => {
    expect(zoomKeyOf({ code: 'Equal' })).toBeNull()
    expect(zoomKeyOf({ code: 'Minus', ctrlKey: true, altKey: true })).toBeNull()
    expect(zoomKeyOf({ code: 'KeyZ', ctrlKey: true })).toBeNull()
  })
})

describe('toolDigitOf', () => {
  it('цифра верхнего ряда и цифрового блока → индекс инструмента', () => {
    expect(toolDigitOf({ code: 'Digit1' })).toBe(0)
    expect(toolDigitOf({ code: 'Numpad5' })).toBe(4)
  })

  it('с модификатором или не цифра — не инструмент', () => {
    expect(toolDigitOf({ code: 'Digit1', ctrlKey: true })).toBe(-1)
    expect(toolDigitOf({ code: 'Digit2', shiftKey: true })).toBe(-1)
    expect(toolDigitOf({ code: 'Digit0' })).toBe(-1)
    expect(toolDigitOf({ code: 'KeyR' })).toBe(-1)
  })
})
