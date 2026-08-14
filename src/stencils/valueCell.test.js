import { describe, it, expect } from 'vitest'
import {
  resolveValueDisplay,
  resolveValueDecimals,
  VALUE_DECIMALS_DEFAULT,
  buildValueContent,
  buildValueExportSvg,
} from './valueCell'

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

describe('карточка без тега помечается на холсте', () => {
  /** cellView-мок: buildValueContent читает только модель. */
  function viewOf(tms) {
    return { model: { get: () => tms, size: () => ({ width: 100, height: 20 }) } }
  }

  it('без valueTag добавляется рамка-предупреждение, с тегом — нет', () => {
    const marks = (tms) =>
      buildValueContent(viewOf(tms)).filter((el) => el.getAttribute('class') === 'tms-value-empty')
    expect(marks({}).length).toBe(1)
    expect(marks({ valueTag: 'T1.VAL' }).length).toBe(0)
  })

  it('в экспортный SVG пометка не уходит — это подсказка автору, не часть схемы', () => {
    expect(buildValueExportSvg('T1.VAL', 100, 20, {})).not.toContain('tms-value-empty')
  })
})
