import { describe, it, expect } from 'vitest'
import { resolveValueDisplay } from './valueCell'

describe('resolveValueDisplay', () => {
  it('maps known current suffix to amperes', () => {
    expect(resolveValueDisplay('PS031VV001.IA')).toEqual({ label: 'Ia', unit: 'А' })
  })

  it('maps known voltage suffix to volts', () => {
    expect(resolveValueDisplay('PS031TN001.UA')).toEqual({ label: 'Ua', unit: 'В' })
  })

  it('maps cosphi to no unit', () => {
    expect(resolveValueDisplay('PS031VV001.COSF')).toEqual({ label: 'cosφ', unit: '' })
  })

  it('falls back to suffix as label for unknown suffix', () => {
    expect(resolveValueDisplay('PS031X.WHATEVER')).toEqual({ label: 'WHATEVER', unit: '' })
  })

  it('handles empty/missing tag', () => {
    expect(resolveValueDisplay('')).toEqual({ label: '?', unit: '' })
    expect(resolveValueDisplay(undefined)).toEqual({ label: '?', unit: '' })
  })
})
