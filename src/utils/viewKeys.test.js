import { describe, it, expect, vi } from 'vitest'
import {
  zoomKeyOf,
  toolDigitOf,
  isFocusInInput,
  isInListWidget,
  hasTextSelectionOutside,
} from './viewKeys'

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

// Клавиши в полях и списках — их собственные: цифра это ввод, стрелка листает опции.
it('isFocusInInput / isInListWidget: поля ввода и выпадающие списки', () => {
  expect(isFocusInInput({ tagName: 'INPUT' })).toBe(true)
  expect(isFocusInInput({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  expect(isFocusInInput({ tagName: 'BUTTON' })).toBe(false)
  expect(isFocusInInput(null)).toBe(false)
  const inSelect = { closest: (sel) => (sel.includes('combobox') ? {} : null) }
  expect(isInListWidget(inSelect)).toBe(true)
  expect(isInListWidget({ closest: () => null })).toBe(false)
  expect(isInListWidget(null)).toBe(false)
})

// Выделенный текст вне холста или стола — Ctrl+C браузера, внутри — копирование фигур.
it('hasTextSelectionOutside: выделение вне области, внутри и пустое', () => {
  const select = (text, closest) =>
    vi.stubGlobal('window', {
      getSelection: () => ({
        isCollapsed: !text,
        toString: () => text,
        anchorNode: { nodeType: 3, parentElement: { closest } },
      }),
    })
  select('id символа', () => null)
  expect(hasTextSelectionOutside('[data-se-stage]')).toBe(true)
  select('подпись', () => ({}))
  expect(hasTextSelectionOutside('[data-se-stage]')).toBe(false)
  select('', () => null)
  expect(hasTextSelectionOutside('[data-se-stage]')).toBe(false)
  vi.unstubAllGlobals()
})
