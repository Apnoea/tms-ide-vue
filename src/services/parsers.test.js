import { describe, it, expect } from 'vitest'
import { parseTagList } from './parsers'

describe('parseTagList', () => {
  it('parses standard name=Type;... lines', () => {
    const text = 'PS031VK001.ONOFF=Boolean;\nPS031TN001.UA=Float;'
    expect(parseTagList(text)).toEqual([
      { name: 'PS031VK001.ONOFF', type: 'Boolean' },
      { name: 'PS031TN001.UA', type: 'Float' },
    ])
  })

  it('skips comment lines starting with #', () => {
    const text = `#Format <Tag name>=<Tag type>
#
PS031VK001.ONOFF=Boolean`
    expect(parseTagList(text)).toEqual([{ name: 'PS031VK001.ONOFF', type: 'Boolean' }])
  })

  it('skips empty/whitespace-only lines', () => {
    const text = '\n\n   \nPS031.X=Boolean\n\n'
    expect(parseTagList(text)).toEqual([{ name: 'PS031.X', type: 'Boolean' }])
  })

  it('skips lines without =', () => {
    expect(parseTagList('garbage\nPS031.X=Float')).toEqual([{ name: 'PS031.X', type: 'Float' }])
  })

  it('returns empty array for empty input', () => {
    expect(parseTagList('')).toEqual([])
  })
})
