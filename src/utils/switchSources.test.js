import { describe, it, expect } from 'vitest'
import { normalizeSwitchSources, switchSourceTags } from './switchSources'

describe('normalizeSwitchSources', () => {
  it('null/undefined/{} → нет групп', () => {
    expect(normalizeSwitchSources(null)).toEqual({ groups: [] })
    expect(normalizeSwitchSources(undefined)).toEqual({ groups: [] })
    expect(normalizeSwitchSources({})).toEqual({ groups: [] })
  })

  it('сохраняет группы в исходном порядке', () => {
    expect(normalizeSwitchSources({ groups: [['a', 'b'], ['c']] })).toEqual({
      groups: [['a', 'b'], ['c']],
    })
  })

  it('дедуп тегов ВНУТРИ группы, между группами повтор допустим', () => {
    expect(normalizeSwitchSources({ groups: [['a', 'a', 'b'], ['a']] })).toEqual({
      groups: [['a', 'b'], ['a']],
    })
  })

  it('пустые группы и falsy-теги отбрасываются', () => {
    expect(normalizeSwitchSources({ groups: [[], ['x', null, ''], null] })).toEqual({
      groups: [['x']],
    })
  })

  it('старая форма {or,and} не поддерживается → нет групп', () => {
    expect(normalizeSwitchSources({ or: ['x'], and: ['y'] })).toEqual({ groups: [] })
  })
})

describe('switchSourceTags', () => {
  it('плоский уникальный список всех тегов групп', () => {
    expect(
      switchSourceTags({
        groups: [
          ['a', 'b'],
          ['b', 'c'],
        ],
      })
    ).toEqual(['a', 'b', 'c'])
  })
  it('пустой источник → []', () => {
    expect(switchSourceTags(null)).toEqual([])
    expect(switchSourceTags({})).toEqual([])
  })
})
