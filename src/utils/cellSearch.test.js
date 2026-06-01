import { describe, it, expect } from 'vitest'
import { getCellSearchStrings, cellMatchesQuery } from './cellSearch'

// Минимальный fake-cell с методом get, имитирующий JointJS API.
function makeCell(tms) {
  return {
    get(key) {
      return key === 'tms' ? tms : undefined
    },
  }
}

describe('getCellSearchStrings', () => {
  it('собирает все теги из slots', () => {
    const cell = makeCell({
      slots: { onoff: 'PS031VK001.ONOFF', alr: 'PS031VK001.ALR' },
    })
    const strings = getCellSearchStrings(cell)
    expect(strings).toContain('PS031VK001.ONOFF')
    expect(strings).toContain('PS031VK001.ALR')
  })

  it('подхватывает voltageSource.tag, switchSource.tag, valueTag', () => {
    const cell = makeCell({
      voltageSource: { tag: 'PS031TN001.U' },
      switchSource: { tag: 'PS031VK001.ONOFF' },
      valueTag: 'PS031TN001.UA',
    })
    const strings = getCellSearchStrings(cell)
    expect(strings).toEqual(
      expect.arrayContaining(['PS031TN001.U', 'PS031VK001.ONOFF', 'PS031TN001.UA'])
    )
  })

  it('подхватывает text у cell_text', () => {
    const cell = makeCell({ stencilId: 'cell_text', text: 'СШ-110' })
    expect(getCellSearchStrings(cell)).toContain('СШ-110')
  })

  it('подхватывает navigation (целевая view)', () => {
    const cell = makeCell({ navigation: 'view_substation_a' })
    expect(getCellSearchStrings(cell)).toContain('view_substation_a')
  })

  it('пропускает пустые/null значения слотов', () => {
    const cell = makeCell({ slots: { a: null, b: '', c: 'X' } })
    expect(getCellSearchStrings(cell)).toEqual(['X'])
  })

  it('без tms возвращает []', () => {
    const cell = { get: () => undefined }
    expect(getCellSearchStrings(cell)).toEqual([])
  })
})

describe('cellMatchesQuery', () => {
  it('substring match, case-insensitive', () => {
    const cell = makeCell({ slots: { onoff: 'PS031VK001.ONOFF' } })
    expect(cellMatchesQuery(cell, 'ps031')).toBe(true)
    expect(cellMatchesQuery(cell, 'vk001')).toBe(true)
    expect(cellMatchesQuery(cell, 'onoff')).toBe(true)
    expect(cellMatchesQuery(cell, 'xxx')).toBe(false)
  })

  it('пустой query — false', () => {
    const cell = makeCell({ slots: { onoff: 'X' } })
    expect(cellMatchesQuery(cell, '')).toBe(false)
  })

  it('матчит по тексту cell_text', () => {
    const cell = makeCell({ text: 'Фидер №3' })
    expect(cellMatchesQuery(cell, 'фидер')).toBe(true)
  })
})
