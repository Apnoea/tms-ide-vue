import { boolSourceTags } from './boolSource'

/**
 * Все привязанные теги payload'а: слоты, rangeSource.tag, boolSource
 * (text/navigation/params — не теги). Принимает СЫРОЙ tms, поэтому работает и с
 * plain-объектами exporter'а. Новое tag-поле добавляется здесь — поиск и detailTags
 * читают отсюда.
 *
 * @param {object} tms
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
  if (tms.rangeSource?.tag) tags.push(tms.rangeSource.tag)
  for (const t of boolSourceTags(tms.boolSource)) if (t) tags.push(t)
  return tags
}

/** То же для JointJS-ячейки. */
export function getCellTags(cell) {
  return getCellTagsFromTms(cell.get('tms') || {})
}

/** Exact-match: содержит ли ячейка/линк указанный тег в любом из tag-полей. */
export function cellHasTag(cell, tag) {
  if (!tag) return false
  return getCellTags(cell).includes(tag)
}

/**
 * Строки для Ctrl+F: теги, navigation, правимые подписи символа (`tms.params` —
 * их вписывает автор, и на схеме видно именно их), текст подписи — и у прошлого
 * символа (`tms.text`), и у фигуры-разметки (`tms.shape.text`): на схеме это одна
 * и та же надпись.
 */
export function getCellSearchStrings(cell) {
  const tms = cell.get('tms') || {}
  const strings = getCellTags(cell)
  if (tms.text) strings.push(String(tms.text))
  if (tms.shape?.text) strings.push(String(tms.shape.text))
  if (tms.navigation) strings.push(String(tms.navigation))
  for (const v of Object.values(tms.params || {})) if (v) strings.push(String(v))
  return strings
}

/** @param {string} queryLower — lower-case запрос (нормализует вызывающий, один раз) */
export function cellMatchesQuery(cell, queryLower) {
  if (!queryLower) return false
  const strings = getCellSearchStrings(cell)
  for (const s of strings) {
    if (s.toLowerCase().includes(queryLower)) return true
  }
  return false
}
