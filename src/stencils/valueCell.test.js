import { describe, it, expect } from 'vitest'
import { resolveValueDisplay } from './valueCell'

describe('resolveValueDisplay', () => {
  it('суффикс тока → амперы', () => {
    expect(resolveValueDisplay('PS031VV001.IA')).toEqual({ label: 'Ia', unit: 'А' })
  })

  it('суффикс напряжения → вольты', () => {
    expect(resolveValueDisplay('PS031TN001.UA')).toEqual({ label: 'Ua', unit: 'В' })
  })

  it('cosφ → без единицы', () => {
    expect(resolveValueDisplay('PS031VV001.COSF')).toEqual({ label: 'cosφ', unit: '' })
  })

  it('неизвестный суффикс → сам суффикс как подпись', () => {
    expect(resolveValueDisplay('PS031X.WHATEVER')).toEqual({ label: 'WHATEVER', unit: '' })
  })

  it('handles empty/missing tag', () => {
    expect(resolveValueDisplay('')).toEqual({ label: '?', unit: '' })
    expect(resolveValueDisplay(undefined)).toEqual({ label: '?', unit: '' })
  })
})
