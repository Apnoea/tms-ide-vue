// Правила списка недавних цветов: он лежит в localStorage, поэтому на чтении обязан
// отбрасывать мусор — иначе тот уехал бы свотчами в UI.
import { describe, it, expect } from 'vitest'
import { sanitizeRecentColors, withRecentColor, RECENT_MAX } from './useRecentColors'

describe('sanitizeRecentColors', () => {
  it('оставляет только 6-значные hex и приводит регистр', () => {
    expect(sanitizeRecentColors(['#10B981', 'red', '#abc', 42, null, '#ff0000'])).toEqual([
      '#10b981',
      '#ff0000',
    ])
  })

  it('режет по лимиту; не массив → пусто', () => {
    const many = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666']
    expect(sanitizeRecentColors(many)).toHaveLength(RECENT_MAX)
    expect(sanitizeRecentColors(null)).toEqual([])
    expect(sanitizeRecentColors('#111111')).toEqual([])
  })
})

describe('withRecentColor', () => {
  it('последний выбранный идёт первым, помнится RECENT_MAX штук', () => {
    let list = []
    for (const c of ['#111111', '#222222', '#333333', '#444444', '#555555']) {
      list = withRecentColor(list, c)
    }
    expect(list).toEqual(['#555555', '#444444', '#333333', '#222222'])
  })

  it('повтор поднимается наверх, а не дублируется', () => {
    let list = []
    for (const c of ['#111111', '#222222', '#111111']) list = withRecentColor(list, c)
    expect(list).toEqual(['#111111', '#222222'])
  })

  it('не-hex список не меняет, но чистит его', () => {
    for (const bad of ['red', '#abc', 'url(evil)', '', null, undefined]) {
      expect(withRecentColor(['#10b981', 'red'], bad)).toEqual(['#10b981'])
    }
  })
})
