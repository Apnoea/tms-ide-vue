/**
 * switchSources описывает, какие выключатели гасят элемент. Каноническая форма —
 * два списка:
 *  • `or`  — «Параллельно»: достаточно ЛЮБОГО замкнутого (альтернативные вводы).
 *  • `and` — «Последовательно»: нужны ВСЕ замкнутые (цепочка в одном вводе).
 *
 * Под напряжением = (любой `or` замкнут) ИЛИ (все `and` замкнуты).
 * Серый (animation-off) = НЕ под напряжением = (все `or` открыты) И (любой `and` открыт),
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
