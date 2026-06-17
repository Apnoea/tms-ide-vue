/**
 * switchSources описывает булевы теги, гасящие элемент (обычно выключатели).
 * Каноническая форма — два списка:
 *  • `or`  — «Параллельно»: достаточно ЛЮБОГО = true (альтернативные вводы).
 *  • `and` — «Последовательно»: нужны ВСЕ = true (цепочка в одном вводе).
 *
 * Активен = (любой `or` = true) ИЛИ (все `and` = true).
 * Серый (animation-off) = НЕ активен = (все `or` = false) И (любой `and` = false),
 * пустой список из формулы выпадает.
 *
 * Backward-compat со старой формой `{ tags, mode }`: `mode: 'or'` → `or`, иначе
 * → `and` (исторический switchSources без mode имел AND-семантику = цепочка).
 */
export function normalizeSwitchSources(ss) {
  if (!ss) return { or: [], and: [] }
  if (ss.or || ss.and) return { or: ss.or || [], and: ss.and || [] }
  const tags = ss.tags || []
  return ss.mode === 'or' ? { or: [...tags], and: [] } : { or: [], and: [...tags] }
}

/** Плоский список всех switchSources-тегов (для поиска / detailTags). */
export function switchSourceTags(ss) {
  const { or, and } = normalizeSwitchSources(ss)
  return [...or, ...and]
}
