import { describe, it, expect, vi } from 'vitest'
import { withRestoreGuard, withPaperFrozen } from './graphBatch'

describe('withRestoreGuard', () => {
  it('держит флаг true во время fn, сбрасывает после', () => {
    const flag = { value: false }
    let during
    const out = withRestoreGuard(flag, () => {
      during = flag.value
      return 42
    })
    expect(during).toBe(true)
    expect(flag.value).toBe(false)
    expect(out).toBe(42)
  })

  it('сбрасывает флаг даже если fn бросает, пробрасывает исключение', () => {
    const flag = { value: false }
    expect(() =>
      withRestoreGuard(flag, () => {
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(flag.value).toBe(false)
  })

  it('вложенный guard восстанавливает предыдущее значение, не снимает рано', () => {
    const flag = { value: false }
    let outerAfterInner
    withRestoreGuard(flag, () => {
      withRestoreGuard(flag, () => {})
      // внутренний finally НЕ должен снять флаг, пока активен внешний
      outerAfterInner = flag.value
    })
    expect(outerAfterInner).toBe(true)
    expect(flag.value).toBe(false)
  })
})

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
