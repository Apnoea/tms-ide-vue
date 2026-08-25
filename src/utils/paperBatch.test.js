import { describe, it, expect, vi } from 'vitest'
import { withPaperFrozen } from './paperBatch'

describe('withPaperFrozen', () => {
  it('замораживает на время правки и размораживает после', () => {
    const calls = []
    const paper = { freeze: () => calls.push('freeze'), unfreeze: () => calls.push('unfreeze') }
    const out = withPaperFrozen(paper, () => {
      calls.push('work')
      return 42
    })
    expect(calls).toEqual(['freeze', 'work', 'unfreeze'])
    expect(out).toBe(42)
  })

  it('размораживает даже при исключении — иначе холст замирает навсегда', () => {
    const unfreeze = vi.fn()
    const paper = { freeze: vi.fn(), unfreeze }
    expect(() =>
      withPaperFrozen(paper, () => {
        throw new Error('bang')
      })
    ).toThrow('bang')
    expect(unfreeze).toHaveBeenCalledOnce()
  })

  it('paper без методов (мок в тестах) не мешает работе', () => {
    expect(withPaperFrozen(null, () => 'ok')).toBe('ok')
    expect(withPaperFrozen({}, () => 'ok')).toBe('ok')
  })
})
