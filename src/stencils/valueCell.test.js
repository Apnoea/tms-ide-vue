import { describe, it, expect } from 'vitest'
import { resolveValueDisplay } from './valueCell'

// Пресеты приходят из stencil.json cell_value (`valuePresets`); здесь — минимальный
// набор, чтобы проверить приоритеты резолва.
const PRESETS = [
  { suffix: '.IA', label: 'Ia', unit: 'А' },
  { suffix: '.UA', label: 'Ua', unit: 'В' },
  { suffix: '.COSF', label: 'cosφ', unit: '' },
]

describe('resolveValueDisplay', () => {
  it('пресет по суффиксу тега', () => {
    expect(resolveValueDisplay('PS031VV001.IA', null, PRESETS)).toEqual({ label: 'Ia', unit: 'А' })
    expect(resolveValueDisplay('PS031TN001.UA', null, PRESETS)).toEqual({ label: 'Ua', unit: 'В' })
  })

  it('пресет без единицы (cosφ)', () => {
    expect(resolveValueDisplay('PS031VV001.COSF', null, PRESETS)).toEqual({
      label: 'cosφ',
      unit: '',
    })
  })

  it('выбранная пара в tms перебивает пресет по суффиксу', () => {
    const tms = { valueLabel: 'Давление', valueUnit: 'кПа' }
    expect(resolveValueDisplay('PS031TN001.UA', tms, PRESETS)).toEqual({
      label: 'Давление',
      unit: 'кПа',
    })
  })

  it('выбранная пара без единицы — единицу не выдумываем', () => {
    expect(resolveValueDisplay('X.UA', { valueLabel: 'Уровень' }, PRESETS)).toEqual({
      label: 'Уровень',
      unit: '',
    })
  })

  it('нет пресета под суффикс и нет выбора → пусто, а не «?» или суффикс', () => {
    // Подпись из имени тега («WHATEVER») и «?» читались как сбой приложения:
    // тег без конвенции — штатный случай, пользователь выберет величину сам.
    expect(resolveValueDisplay('PS031X.WHATEVER', null, PRESETS)).toEqual({ label: '', unit: '' })
    expect(resolveValueDisplay('WATER_LEVEL', null, PRESETS)).toEqual({ label: '', unit: '' })
    expect(resolveValueDisplay('', null, PRESETS)).toEqual({ label: '', unit: '' })
    expect(resolveValueDisplay(undefined)).toEqual({ label: '', unit: '' })
  })
})
