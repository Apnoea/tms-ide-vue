/**
 * switchSources описывает булевы теги, гасящие элемент (обычно выключатели).
 * Каноническая форма — два списка:
 *  • `or`  — «Параллельно»: достаточно ЛЮБОГО = true (альтернативные вводы).
 *  • `and` — «Последовательно»: нужны ВСЕ = true (цепочка в одном вводе).
 *
 * Активен = (любой `or` = true) ИЛИ (все `and` = true).
 * Серый (animation-off) = НЕ активен = (все `or` = false) И (любой `and` = false),
 * пустой список из формулы выпадает.
 */
export function normalizeSwitchSources(ss) {
  if (!ss) return { or: [], and: [] }
  return { or: ss.or || [], and: ss.and || [] }
}

/** Плоский список всех switchSources-тегов (для поиска / detailTags). */
export function switchSourceTags(ss) {
  const { or, and } = normalizeSwitchSources(ss)
  return [...or, ...and]
}
