import { describe, it, expect } from 'vitest'
import {
  getCellSearchStrings,
  getCellTags,
  getCellTagsFromTms,
  cellHasTag,
  cellMatchesQuery,
} from './cellSearch'

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

  it('подхватывает voltageSource.tag, switchSources.tags[], valueTag', () => {
    const cell = makeCell({
      voltageSource: { tag: 'PS031TN001.U' },
      switchSources: { tags: ['ОБЩИЙ.ONOFF', 'LOCAL.ONOFF'] },
      valueTag: 'PS031TN001.UA',
    })
    const strings = getCellSearchStrings(cell)
    expect(strings).toEqual(
      expect.arrayContaining(['PS031TN001.U', 'ОБЩИЙ.ONOFF', 'LOCAL.ONOFF', 'PS031TN001.UA'])
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

describe('getCellTags / cellHasTag', () => {
  it('собирает все привязанные теги (slots + voltage + switchSources + valueTag)', () => {
    const cell = makeCell({
      slots: { onoff: 'A.ONOFF', alr: 'A.ALR' },
      voltageSource: { tag: 'A.U' },
      switchSources: { tags: ['B.ONOFF', 'C.ONOFF'] },
      valueTag: 'A.IA',
    })
    expect(getCellTags(cell).sort()).toEqual(
      ['A.ALR', 'A.IA', 'A.ONOFF', 'A.U', 'B.ONOFF', 'C.ONOFF'].sort()
    )
  })

  it('text / navigation НЕ попадают в теги', () => {
    const cell = makeCell({ text: 'СШ-110', navigation: 'view_other' })
    expect(getCellTags(cell)).toEqual([])
  })

  it('cellHasTag exact-match по любому tag-полю', () => {
    const cell = makeCell({
      slots: { onoff: 'A.ONOFF' },
      switchSources: { tags: ['B.ONOFF'] },
    })
    expect(cellHasTag(cell, 'A.ONOFF')).toBe(true)
    expect(cellHasTag(cell, 'B.ONOFF')).toBe(true)
    expect(cellHasTag(cell, 'A')).toBe(false) // не substring
    expect(cellHasTag(cell, 'X.ONOFF')).toBe(false)
    expect(cellHasTag(cell, '')).toBe(false)
  })
})

describe('getCellTagsFromTms', () => {
  it('принимает сырой tms-объект без cell-обёртки', () => {
    const tms = {
      slots: { onoff: 'X.ONOFF' },
      voltageSource: { tag: 'V.U' },
      switchSources: { tags: ['S1', 'S2'] },
      valueTag: 'VT',
    }
    expect(getCellTagsFromTms(tms)).toEqual(['X.ONOFF', 'V.U', 'S1', 'S2', 'VT'])
  })

  it('null / undefined / пустой объект → []', () => {
    expect(getCellTagsFromTms(null)).toEqual([])
    expect(getCellTagsFromTms(undefined)).toEqual([])
    expect(getCellTagsFromTms({})).toEqual([])
  })

  it('пустые значения в slots / switchSources.tags фильтруются', () => {
    expect(
      getCellTagsFromTms({
        slots: { a: 'A', b: '', c: null },
        switchSources: { tags: ['X', '', 'Y'] },
      })
    ).toEqual(['A', 'X', 'Y'])
  })

  it('getCellTags — однострочная обёртка над getCellTagsFromTms', () => {
    const cell = makeCell({ slots: { onoff: 'A' } })
    expect(getCellTags(cell)).toEqual(getCellTagsFromTms(cell.get('tms')))
  })
})
