// Подсказки с задержкой по умолчанию: строка → объектная форма PrimeVue, явная задержка
// и пустое значение не трогаются.
import { describe, it, expect } from 'vitest'
import { withShowDelay, TOOLTIP_SHOW_DELAY, DelayedTooltip } from './tooltip'

describe('withShowDelay', () => {
  it('строка получает задержку', () => {
    expect(withShowDelay('Отменить')).toEqual({ value: 'Отменить', showDelay: TOOLTIP_SHOW_DELAY })
  })

  it('объект без задержки — дополняется, с задержкой — как есть', () => {
    expect(withShowDelay({ value: 'x', escape: false })).toEqual({
      value: 'x',
      escape: false,
      showDelay: TOOLTIP_SHOW_DELAY,
    })
    const own = { value: 'x', showDelay: 0 }
    expect(withShowDelay(own)).toBe(own)
  })

  it('пустое значение (подсказки нет) не превращается в объект', () => {
    expect(withShowDelay('')).toBe('')
    expect(withShowDelay(null)).toBe(null)
  })

  it('директива повторяет хуки PrimeVue', () => {
    expect(typeof DelayedTooltip.beforeMount).toBe('function')
    expect(typeof DelayedTooltip.updated).toBe('function')
    expect(typeof DelayedTooltip.unmounted).toBe('function')
  })
})
