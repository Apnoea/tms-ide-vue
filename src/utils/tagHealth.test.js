import { describe, it, expect } from 'vitest'
import { tagBreaksId, tagIssue, tagIssueLabel } from './tagHealth'

describe('tagHealth', () => {
  const known = new Set(['PS031.UA', 'PS031VK001.ONOFF'])

  it('пробел в теге ломает id', () => {
    expect(tagBreaksId('ПС 1.НАПРЯЖЕНИЕ A')).toBe(true)
    expect(tagBreaksId('PS031.UA')).toBe(false)
    // Кириллица в id валидна — про неё не предупреждаем.
    expect(tagBreaksId('ПС1.НАПРЯЖЕНИЕ')).toBe(false)
    expect(tagBreaksId('')).toBe(false)
  })

  it('breaks-id важнее отсутствия в tag-list (сначала техническая поломка)', () => {
    expect(tagIssue('A B', known)).toBe('breaks-id')
  })

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

  it('у каждой причины есть текст для tooltip’а', () => {
    expect(tagIssueLabel('breaks-id')).toMatch(/Пробел/)
    expect(tagIssueLabel('unknown')).toMatch(/tag-list/)
    expect(tagIssueLabel(null)).toBe('')
  })
})
