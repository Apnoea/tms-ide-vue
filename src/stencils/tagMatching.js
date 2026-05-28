/**
 * Утилиты для сопоставления стенсилов и тегов из tag-list.
 */

/**
 * Из полного имени тега выделяет prefix (всё до первой точки).
 *   "PS031VK001.ONOFF" → "PS031VK001"
 *   "PS031TN001.UA"   → "PS031TN001"
 */
function extractPrefix(tagName) {
  const dotIdx = tagName.indexOf('.')
  return dotIdx >= 0 ? tagName.slice(0, dotIdx) : tagName
}

/**
 * Из tag-list возвращает уникальные prefix'ы, удовлетворяющие
 * tagPattern стенсила, у которых ПРИСУТСТВУЮТ все `required` суффиксы,
 * и которые не использованы ранее (out of `usedPrefixes`).
 *
 * @param {object} stencil — определение стенсила (с полями `tagPattern`, `tagSuffixes`)
 * @param {Array<{name: string, type: string}>} tags — теги из tag-list
 * @param {Set<string>|Array<string>} usedPrefixes — уже использованные prefix'ы
 * @returns {string[]} отсортированный массив доступных prefix'ов
 */
export function getEligiblePrefixes(stencil, tags, usedPrefixes = new Set()) {
  if (!stencil?.tagPattern || !Array.isArray(tags)) return []

  const used = usedPrefixes instanceof Set ? usedPrefixes : new Set(usedPrefixes)
  const pattern = new RegExp(stencil.tagPattern)

  // Группируем теги по prefix'у — нужно быстро проверять наличие всех суффиксов
  const suffixesByPrefix = new Map()
  for (const tag of tags) {
    const prefix = extractPrefix(tag.name)
    const suffix = tag.name.slice(prefix.length) // включая точку
    if (!suffixesByPrefix.has(prefix)) suffixesByPrefix.set(prefix, new Set())
    suffixesByPrefix.get(prefix).add(suffix)
  }

  const requiredSuffixes = (stencil.tagSuffixes || [])
    .filter((s) => s.required)
    .map((s) => s.suffix)

  const found = []
  for (const [prefix, suffixSet] of suffixesByPrefix) {
    if (!pattern.test(prefix)) continue
    if (used.has(prefix)) continue
    if (!requiredSuffixes.every((suf) => suffixSet.has(suf))) continue
    found.push(prefix)
  }

  return found.sort()
}

/**
 * Собирает prefix'ы, которые уже использованы на JointJS-графе
 * (есть meta `tms.prefix` на ячейках). Если передан `stencilId` — учитывает
 * только ячейки этого стенсила (стенсилы разных типов могут шарить prefix,
 * показывая разные срезы одного логического объекта).
 */
export function getUsedPrefixes(graph, stencilId = null) {
  if (!graph) return new Set()
  const set = new Set()
  for (const cell of graph.getCells()) {
    const tms = cell.get('tms')
    if (!tms?.prefix) continue
    if (stencilId && tms.stencilId !== stencilId) continue
    set.add(tms.prefix)
  }
  return set
}
