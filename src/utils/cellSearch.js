import { switchSourceTags } from './switchSources'

/**
 * Все ПРИВЯЗАННЫЕ теги из tms-payload — slot-значения, voltageSource.tag,
 * switchSources (or + and), valueTag. БЕЗ text/navigation (это не теги, это
 * payload-поля).
 *
 * Принимает СЫРОЙ tms-объект — общий контракт для cell-обёрток
 * (см. getCellTags) и для plain-объектов exporter.cellExports (тоже имеют
 * slots/voltageSource/switchSources на верхнем уровне). Появление нового
 * tag-поля надо отразить здесь — и поиск, и detailTags подхватят сразу.
 *
 * @param {object} tms — tms-payload или structurally-совместимый объект
 * @returns {string[]}
 */
export function getCellTagsFromTms(tms) {
  if (!tms) return []
  const tags = []
  if (tms.slots) {
    for (const v of Object.values(tms.slots)) {
      if (v) tags.push(String(v))
    }
  }
  if (tms.voltageSource?.tag) tags.push(tms.voltageSource.tag)
  for (const t of switchSourceTags(tms.switchSources)) if (t) tags.push(t)
  if (tms.valueTag) tags.push(tms.valueTag)
  return tags
}

/**
 * Тонкая обёртка над getCellTagsFromTms для JointJS-cell'ов (читает tms через
 * cell.get('tms')). Используется eye-подсветкой (exact-match по любому tag-полю),
 * а также как базис для search-strings.
 *
 * @param {{ get: (k: string) => any }} cell — JointJS-cell с методом get('tms')
 * @returns {string[]}
 */
export function getCellTags(cell) {
  return getCellTagsFromTms(cell.get('tms') || {})
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
