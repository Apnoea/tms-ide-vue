import { describe, it, expect } from 'vitest'
import {
  resolveValueDisplay,
  busPortX,
  desiredBusPortCount,
  computeBusPorts,
} from './svgInjector'

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

describe('bus port math', () => {
  it('busPortX returns step * (index + 1)', () => {
    expect(busPortX(0)).toBe(20)
    expect(busPortX(1)).toBe(40)
    expect(busPortX(4)).toBe(100)
  })

  it('desiredBusPortCount: width / step - 1, минимум 1', () => {
    expect(desiredBusPortCount(80)).toBe(3) // 80/20 - 1 = 3
    expect(desiredBusPortCount(200)).toBe(9)
    expect(desiredBusPortCount(40)).toBe(1) // 40/20 - 1 = 1
    expect(desiredBusPortCount(10)).toBe(1) // clamp to 1
  })

  it('computeBusPorts создаёт пары top_*/bot_* с правильными координатами', () => {
    const ports = computeBusPorts(80, 8)
    // desired = 3, значит ожидаем по 3 top и 3 bot = 6 портов
    expect(ports).toHaveLength(6)

    const top0 = ports.find((p) => p.id === 'top_0')
    expect(top0).toEqual({ id: 'top_0', group: 'port', args: { x: 20, y: 0 } })

    const bot2 = ports.find((p) => p.id === 'bot_2')
    expect(bot2).toEqual({ id: 'bot_2', group: 'port', args: { x: 60, y: 8 } })
  })
})
