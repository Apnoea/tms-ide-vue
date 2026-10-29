// Подсказки с задержкой по умолчанию: строка → объектная форма PrimeVue, явная задержка
// и пустое значение не трогаются.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { withShowDelay, TOOLTIP_SHOW_DELAY, DelayedTooltip } from './tooltip'

const { Tooltip } = vi.hoisted(() => ({
  Tooltip: { beforeMount: vi.fn(), updated: vi.fn(), unmounted: vi.fn() },
}))
vi.mock('primevue/tooltip', () => ({ default: Tooltip }))

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

// PrimeVue в `updated` снимает показанную подсказку — перерисовка без смены значения не
// должна до него доходить, иначе подсказка гаснет на каждом шаге симуляции.
describe('DelayedTooltip.updated', () => {
  const el = {}
  afterEach(() => vi.resetAllMocks())

  it('то же значение (строка или объект с теми же полями) PrimeVue не трогает', () => {
    DelayedTooltip.updated(el, { value: 'Закрыть', oldValue: 'Закрыть' })
    DelayedTooltip.updated(el, { value: { value: 'x' }, oldValue: { value: 'x' } })
    expect(Tooltip.updated).not.toHaveBeenCalled()
  })

  it('новое значение уходит в PrimeVue с задержкой', () => {
    DelayedTooltip.updated(el, { value: 'Скрыть', oldValue: 'Показать' })
    DelayedTooltip.updated(el, { value: null, oldValue: 'Показать' })
    expect(Tooltip.updated).toHaveBeenCalledTimes(2)
    expect(Tooltip.updated.mock.calls[0][1].value).toEqual({
      value: 'Скрыть',
      showDelay: TOOLTIP_SHOW_DELAY,
    })
  })
})
