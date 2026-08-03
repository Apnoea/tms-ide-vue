import { describe, it, expect } from 'vitest'
import { normalizeBoolSource, boolSourceTags } from './boolSource'

describe('normalizeBoolSource', () => {
  it('null/undefined/{} → нет групп', () => {
    expect(normalizeBoolSource(null)).toEqual({ groups: [] })
    expect(normalizeBoolSource(undefined)).toEqual({ groups: [] })
    expect(normalizeBoolSource({})).toEqual({ groups: [] })
  })

  it('сохраняет группы в исходном порядке', () => {
    expect(normalizeBoolSource({ groups: [['a', 'b'], ['c']] })).toEqual({
      groups: [['a', 'b'], ['c']],
    })
  })

  it('дедуп тегов ВНУТРИ группы, между группами повтор допустим', () => {
    expect(normalizeBoolSource({ groups: [['a', 'a', 'b'], ['a']] })).toEqual({
      groups: [['a', 'b'], ['a']],
    })
  })

  it('пустые группы и falsy-теги отбрасываются', () => {
    expect(normalizeBoolSource({ groups: [[], ['x', null, ''], null] })).toEqual({
      groups: [['x']],
    })
  })

  it('старая форма {or,and} не поддерживается → нет групп', () => {
    expect(normalizeBoolSource({ or: ['x'], and: ['y'] })).toEqual({ groups: [] })
  })
})

describe('boolSourceTags', () => {
  it('плоский уникальный список всех тегов групп', () => {
    expect(
      boolSourceTags({
        groups: [
          ['a', 'b'],
          ['b', 'c'],
        ],
      })
    ).toEqual(['a', 'b', 'c'])
  })
  it('пустой источник → []', () => {
    expect(boolSourceTags(null)).toEqual([])
    expect(boolSourceTags({})).toEqual([])
  })
})
