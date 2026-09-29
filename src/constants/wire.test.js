import { describe, it, expect } from 'vitest'
import { normalizeWireStyle } from './wire'

// Допуски вида провода: одна проверка на правку из инспектора и на чтение меты.
describe('normalizeWireStyle', () => {
  it('оставляет годные значения', () => {
    expect(
      normalizeWireStyle({ strokeWidth: 4, strokeColor: '#ff0000', arrowEnd: 'solid' })
    ).toEqual({ strokeWidth: 4, strokeColor: '#ff0000', arrowEnd: 'solid' })
  })

  it('толщина вне 0.5..20, чужой цвет и неизвестный наконечник отбрасываются', () => {
    expect(normalizeWireStyle({ strokeWidth: 30 })).toEqual({})
    expect(normalizeWireStyle({ strokeWidth: 0.1 })).toEqual({})
    expect(normalizeWireStyle({ strokeWidth: '4' })).toEqual({ strokeWidth: 4 })
    expect(normalizeWireStyle({ strokeColor: 'url(evil)' })).toEqual({})
    expect(normalizeWireStyle({ arrowStart: 'dot' })).toEqual({})
  })

  it('не объект → пусто', () => {
    expect(normalizeWireStyle(null)).toEqual({})
    expect(normalizeWireStyle('solid')).toEqual({})
  })

  it('маршрут: «прямой» — липкий, неизвестный отбрасывается', () => {
    expect(normalizeWireStyle({ route: 'straight' })).toEqual({ route: 'straight' })
    expect(normalizeWireStyle({ route: 'manhattan' })).toEqual({})
  })
})
