/**
 * Область применения символа — ОРТОГОНАЛЬНАЯ метка, а не второй уровень категорий.
 * Один и тот же выключатель нужен и в энергетике, и в технологии, а в дереве он лежал
 * бы только в одной ветке — определение пришлось бы дублировать.
 *
 * Список ФИКСИРОВАННЫЙ: ключ уезжает в `stencil.json`, а тот приходит из чужого .zip —
 * свободные значения нанесли бы в фильтр палитры мусор, который нечем убрать.
 * Незнакомые ключи отбрасываются на чтении (`normalizeDomains`).
 *
 * Слово «домен», не «тег»: `tag` в проекте — это SCADA-сигнал (tag-list, TagField,
 * detailTags), второе значение того же слова расползлось бы по коду и разговорам.
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
 * Проходит ли символ фильтр палитры. Пустой фильтр = показываем всё.
 *
 * Символ БЕЗ доменов виден при любом фильтре: иначе только что нарисованный (домен
 * ещё не выставлен) и домен-нейтральная разметка молча исчезали бы из палитры.
 */
export function matchesDomains(stencil, selected) {
  if (!selected?.length) return true
  const domains = normalizeDomains(stencil?.domains)
  if (!domains.length) return true
  return domains.some((d) => selected.includes(d))
}
