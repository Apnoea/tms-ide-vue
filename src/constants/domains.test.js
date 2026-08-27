// Область применения символа — ортогональная метка (фильтр палитры), а не второй
// уровень категорий: один символ может годиться сразу нескольким областям.
import { describe, it, expect } from 'vitest'
import { STENCIL_DOMAINS, isValidDomain, normalizeDomains, matchesDomains } from './domains'

describe('normalizeDomains', () => {
  it('оставляет только известные ключи, без дублей', () => {
    expect(normalizeDomains(['energy', 'network', 'energy', 'plumbing'])).toEqual([
      'energy',
      'network',
    ])
  })

  it('не массив / мусор → пусто (поле приходит из чужого архива)', () => {
    expect(normalizeDomains(undefined)).toEqual([])
    expect(normalizeDomains('energy')).toEqual([])
    expect(normalizeDomains([null, 42, {}])).toEqual([])
  })

  it('список фиксированный: ключи известны наперёд', () => {
    expect(STENCIL_DOMAINS.map((d) => d.key)).toEqual(['energy', 'process', 'network'])
    expect(isValidDomain('energy')).toBe(true)
    expect(isValidDomain('Energy')).toBe(false)
  })
})

describe('matchesDomains', () => {
  const sw = { domains: ['network'] }
  const breaker = { domains: ['energy', 'process'] }
  const label = {} // разметка: домен-нейтральна

  it('фильтр пуст → показываем всё', () => {
    expect(matchesDomains(sw, [])).toBe(true)
    expect(matchesDomains(sw, undefined)).toBe(true)
  })

  it('совпадение хотя бы по одной области', () => {
    expect(matchesDomains(breaker, ['process'])).toBe(true)
    expect(matchesDomains(breaker, ['network'])).toBe(false)
    expect(matchesDomains(sw, ['network', 'energy'])).toBe(true)
  })

  it('символ без областей виден при любом фильтре', () => {
    // Иначе только что нарисованный символ (домен ещё не выставлен) и разметка
    // молча исчезали бы из палитры.
    expect(matchesDomains(label, ['network'])).toBe(true)
    expect(matchesDomains({ domains: [] }, ['energy'])).toBe(true)
    expect(matchesDomains({ domains: ['bogus'] }, ['energy'])).toBe(true)
  })
})
