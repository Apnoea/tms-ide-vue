/**
 * Сборка строк ячейки, по которым работает поиск Ctrl+F:
 *   - все привязанные теги из tms.slots
 *   - voltageSource.tag / switchSource.tag / valueTag
 *   - tms.text у cell_text (юзер часто помнит лейбл на схеме, а не тег)
 *
 * Используется в useCanvas.runSearch для substring-matching (case-insensitive).
 * Вынесено в утилиту чтобы тестировать без JointJS DOM-окружения.
 *
 * @param {{ get: (k: string) => any }} cell — JointJS-cell с методом get('tms')
 * @returns {string[]}
 */
export function getCellSearchStrings(cell) {
  const tms = cell.get('tms') || {}
  const strings = []
  if (tms.slots) {
    for (const v of Object.values(tms.slots)) {
      if (v) strings.push(String(v))
    }
  }
  if (tms.voltageSource?.tag) strings.push(tms.voltageSource.tag)
  if (tms.switchSource?.tag) strings.push(tms.switchSource.tag)
  if (tms.valueTag) strings.push(tms.valueTag)
  if (tms.text) strings.push(String(tms.text))
  if (tms.navigation) strings.push(String(tms.navigation))
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
