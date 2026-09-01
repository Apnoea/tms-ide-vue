import { describe, it, expect } from 'vitest'
import { tagIssue, tagIssueLabel } from './tagHealth'

describe('tagHealth', () => {
  const known = new Set(['PS031.UA', 'PS031VK001.ONOFF'])

  it('тег вне загруженного tag-list → unknown', () => {
    expect(tagIssue('PS031.UA', known)).toBe(null)
    expect(tagIssue('НЕТ.ТАКОГО', known)).toBe('unknown')
  })

  it('tag-list не загружен → про unknown молчим', () => {
    // Иначе предупреждение висело бы на каждом поле сразу после открытия проекта.
    expect(tagIssue('НЕТ.ТАКОГО', new Set())).toBe(null)
    expect(tagIssue('НЕТ.ТАКОГО', null)).toBe(null)
  })

  it('пустой тег — не проблема (просто не привязан)', () => {
    expect(tagIssue('', known)).toBe(null)
  })

  it('у причины есть текст для tooltip’а', () => {
    expect(tagIssueLabel('unknown')).toMatch(/tag-list/)
    expect(tagIssueLabel(null)).toBe('')
  })
})
