/**
 * Все ПРИВЯЗАННЫЕ теги ячейки/линка — slot-значения, voltageSource.tag,
 * switchSources.tags[], valueTag. БЕЗ text/navigation (это не теги, это
 * payload-поля).
 *
 * Используется eye-подсветкой (exact-match на любой tag-field), а также как
 * базис для search-strings.
 *
 * @param {{ get: (k: string) => any }} cell — JointJS-cell с методом get('tms')
 * @returns {string[]}
 */
export function getCellTags(cell) {
  const tms = cell.get('tms') || {}
  const tags = []
  if (tms.slots) {
    for (const v of Object.values(tms.slots)) {
      if (v) tags.push(String(v))
    }
  }
  if (tms.voltageSource?.tag) tags.push(tms.voltageSource.tag)
  if (tms.switchSources?.tags?.length) {
    for (const t of tms.switchSources.tags) if (t) tags.push(t)
  }
  if (tms.valueTag) tags.push(tms.valueTag)
  return tags
}

/** Exact-match: содержит ли ячейка/линк указанный тег в любом из tag-полей. */
export function cellHasTag(cell, tag) {
  if (!tag) return false
  return getCellTags(cell).includes(tag)
}

/**
 * Сборка строк ячейки, по которым работает поиск Ctrl+F: tag-поля
 * (см. getCellTags) + tms.text у cell_text (юзер часто помнит лейбл на
 * схеме, а не тег) + tms.navigation (целевая view).
 *
 * Используется в useCanvas.runSearch для substring-matching (case-insensitive).
 *
 * @param {{ get: (k: string) => any }} cell
 * @returns {string[]}
 */
export function getCellSearchStrings(cell) {
  const tms = cell.get('tms') || {}
  const strings = getCellTags(cell)
  if (tms.text) strings.push(String(tms.text))
  if (tms.navigation) strings.push(String(tms.navigation))
  if (tms.label) strings.push(String(tms.label))
  return strings
}

/**
 * @param {object} cell — JointJS-cell
 * @param {string} queryLower — уже приведённый к lower-case query (вызывающий
 *   нормализует один раз и переиспользует на всех ячейках)
 */
export function cellMatchesQuery(cell, queryLower) {
  if (!queryLower) return false
  const strings = getCellSearchStrings(cell)
  for (const s of strings) {
    if (s.toLowerCase().includes(queryLower)) return true
  }
  return false
}
