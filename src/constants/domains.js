/**
 * Область применения символа — ортогональная метка (фильтр палитры), а не второй
 * уровень категорий: символ может годиться сразу нескольким областям.
 *
 * Список фиксированный: ключ приходит из `stencil.json` чужого архива, свободные
 * значения нанесли бы в фильтр мусор. Незнакомые отбрасывает `normalizeDomains`.
 */
export const STENCIL_DOMAINS = [
  { key: 'energy', label: 'Энергетика' },
  { key: 'process', label: 'Технология' },
  { key: 'network', label: 'Сети' },
]

const DOMAIN_KEYS = new Set(STENCIL_DOMAINS.map((d) => d.key))

export function isValidDomain(key) {
  return DOMAIN_KEYS.has(key)
}

/** Домены символа: только известные ключи, без дублей. Не массив → пусто. */
export function normalizeDomains(raw) {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter(isValidDomain))]
}

/**
 * Проходит ли символ фильтр палитры. Пустой фильтр = показываем всё; символ БЕЗ
 * доменов виден при любом фильтре (иначе новый символ и разметка исчезали бы молча).
 */
export function matchesDomains(stencil, selected) {
  if (!selected?.length) return true
  const domains = normalizeDomains(stencil?.domains)
  if (!domains.length) return true
  return domains.some((d) => selected.includes(d))
}
