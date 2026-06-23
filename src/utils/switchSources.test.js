import { describe, it, expect } from 'vitest'
import { normalizeSwitchSources, switchSourceTags } from './switchSources'

describe('normalizeSwitchSources', () => {
  it('null/undefined/{} → пустые or/and', () => {
    expect(normalizeSwitchSources(null)).toEqual({ or: [], and: [] })
    expect(normalizeSwitchSources(undefined)).toEqual({ or: [], and: [] })
    expect(normalizeSwitchSources({})).toEqual({ or: [], and: [] })
  })

  it('сохраняет or/and, недостающий список → []', () => {
    expect(normalizeSwitchSources({ or: ['x'] })).toEqual({ or: ['x'], and: [] })
    expect(normalizeSwitchSources({ and: ['y'] })).toEqual({ or: [], and: ['y'] })
    expect(normalizeSwitchSources({ or: ['x'], and: ['y'] })).toEqual({ or: ['x'], and: ['y'] })
  })

  it('поля не из схемы {or,and} игнорируются → пустой результат', () => {
    expect(normalizeSwitchSources({ tags: ['a'], mode: 'or' })).toEqual({ or: [], and: [] })
  })
})

describe('switchSourceTags', () => {
  it('конкатенирует or+and в порядке [...or, ...and]', () => {
    expect(switchSourceTags({ or: ['a', 'b'], and: ['c'] })).toEqual(['a', 'b', 'c'])
  })
  it('пустой источник → []', () => {
    expect(switchSourceTags(null)).toEqual([])
    expect(switchSourceTags({})).toEqual([])
  })
})
