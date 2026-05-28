import { describe, it, expect } from 'vitest'
import { getEligiblePrefixes, getUsedPrefixes } from './tagMatching'

const stencilVk = {
  tagPattern: '^PS\\d+\\w+\\d+$',
  tagSuffixes: [{ suffix: '.ONOFF', type: 'Boolean', required: true }],
}

const stencilMultiReq = {
  tagPattern: '^PS\\d{3}VK\\d{3}$',
  tagSuffixes: [
    { suffix: '.ONOFF', type: 'Boolean', required: true },
    { suffix: '.ALR', type: 'Boolean', required: true },
  ],
}

const tags = [
  { name: 'PS031VK001.ONOFF', type: 'Boolean' },
  { name: 'PS031VK001.ALR', type: 'Boolean' },
  { name: 'PS031VK002.ONOFF', type: 'Boolean' },
  // VK002 без .ALR — для multi-required не подойдёт
  { name: 'PS031TN001.UA', type: 'Float' },
  // TN не матчит более узкий VK-pattern
]

describe('getEligiblePrefixes', () => {
  it('returns prefixes that have all required suffixes', () => {
    // PS031TN001 не подходит — у него только .UA, нет .ONOFF
    expect(getEligiblePrefixes(stencilVk, tags)).toEqual(['PS031VK001', 'PS031VK002'])
  })

  it('filters by tagPattern', () => {
    const tight = { ...stencilVk, tagPattern: '^PS\\d{3}VK\\d{3}$' }
    expect(getEligiblePrefixes(tight, tags)).toEqual(['PS031VK001', 'PS031VK002'])
  })

  it('excludes used prefixes', () => {
    const used = new Set(['PS031VK001'])
    const tight = { ...stencilVk, tagPattern: '^PS\\d{3}VK\\d{3}$' }
    expect(getEligiblePrefixes(tight, tags, used)).toEqual(['PS031VK002'])
  })

  it('requires ALL required suffixes, not a subset', () => {
    expect(getEligiblePrefixes(stencilMultiReq, tags)).toEqual(['PS031VK001'])
  })

  it('returns empty when tagPattern missing', () => {
    expect(getEligiblePrefixes({ tagPattern: null, tagSuffixes: [] }, tags)).toEqual([])
  })
})

describe('getUsedPrefixes', () => {
  // Минимальный мок графа
  function fakeGraph(cells) {
    return { getCells: () => cells }
  }
  const fakeCell = (tms) => ({ get: (k) => (k === 'tms' ? tms : undefined) })

  it('collects prefixes from tms of all cells', () => {
    const g = fakeGraph([
      fakeCell({ stencilId: 'cell_vk', prefix: 'A' }),
      fakeCell({ stencilId: 'cell_rz', prefix: 'B' }),
    ])
    expect([...getUsedPrefixes(g)]).toEqual(['A', 'B'])
  })

  it('filters by stencilId when provided', () => {
    const g = fakeGraph([
      fakeCell({ stencilId: 'cell_vk', prefix: 'A' }),
      fakeCell({ stencilId: 'cell_rz', prefix: 'B' }),
    ])
    expect([...getUsedPrefixes(g, 'cell_vk')]).toEqual(['A'])
  })

  it('ignores cells without tms.prefix', () => {
    const g = fakeGraph([fakeCell({ stencilId: 'cell_vk' }), fakeCell(null)])
    expect([...getUsedPrefixes(g)]).toEqual([])
  })
})
