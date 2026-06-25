import { describe, it, expect } from 'vitest'
import { withRestoreGuard } from './restoreGuard'

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
