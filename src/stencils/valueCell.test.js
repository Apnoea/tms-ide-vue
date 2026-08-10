import { describe, it, expect } from 'vitest'
import { resolveValueDisplay, resolveValueDecimals, VALUE_DECIMALS_DEFAULT } from './valueCell'

// Справочника величин больше нет: подпись и единицу автор вписывает сам. Угадывание
// по суффиксу тега убрано — имена тегов в проектах единой конвенции не следуют.
describe('resolveValueDisplay', () => {
  it('берёт то, что вписал автор', () => {
    expect(resolveValueDisplay({ valueLabel: 'Ua', valueUnit: 'В' })).toEqual({
      label: 'Ua',
      unit: 'В',
    })
  })

  it('единицу не выдумываем, если её не задали', () => {
    expect(resolveValueDisplay({ valueLabel: 'Уровень' })).toEqual({ label: 'Уровень', unit: '' })
  })

  it('ничего не задано → пусто, а не «?» или суффикс тега', () => {
    // Подпись из имени тега и «?» читались как сбой приложения.
    expect(resolveValueDisplay({})).toEqual({ label: '', unit: '' })
    expect(resolveValueDisplay(null)).toEqual({ label: '', unit: '' })
    expect(resolveValueDisplay()).toEqual({ label: '', unit: '' })
  })
})

describe('resolveValueDecimals', () => {
  it('явное значение, включая нуль', () => {
    expect(resolveValueDecimals({ decimals: 3 })).toBe(3)
    expect(resolveValueDecimals({ decimals: 0 })).toBe(0)
  })

  it('без значения — дефолт (в карточку пишем всегда, иначе рантайм возьмёт свои 4)', () => {
    expect(resolveValueDecimals({})).toBe(VALUE_DECIMALS_DEFAULT)
    expect(resolveValueDecimals(null)).toBe(VALUE_DECIMALS_DEFAULT)
    expect(resolveValueDecimals()).toBe(VALUE_DECIMALS_DEFAULT)
  })
})
