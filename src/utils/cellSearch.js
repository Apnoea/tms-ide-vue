import { boolSourceTags, normalizeBoolSource } from './boolSource'

/**
 * Все привязанные теги payload'а: слоты, rangeSource.tag, boolSource
 * (text/navigation/params — не теги). Принимает СЫРОЙ tms, поэтому работает и с
 * plain-объектами exporter'а. Новое tag-поле добавляется здесь и в `renameTmsTags` —
 * поиск, detailTags и замена в привязках читают отсюда.
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

/**
 * Переименовать теги в привязках payload'а — те же поля, что у `getCellTagsFromTms`.
 * Возвращает новый tms и число изменённых привязок либо null, если менять нечего.
 *
 * @param {object} tms
 * @param {(tag: string) => string} rename
 * @returns {{ tms: object, changed: number } | null}
 */
export function renameTmsTags(tms, rename) {
  if (!tms) return null
  let changed = 0
  const swap = (tag) => {
    const next = rename(tag)
    if (next !== tag) changed++
    return next
  }
  const next = { ...tms }
  if (tms.slots) {
    next.slots = Object.fromEntries(
      Object.entries(tms.slots).map(([key, tag]) => [key, tag ? swap(String(tag)) : tag])
    )
  }
  if (tms.rangeSource?.tag)
    next.rangeSource = { ...tms.rangeSource, tag: swap(tms.rangeSource.tag) }
  if (tms.boolSource) {
    const { groups } = normalizeBoolSource(tms.boolSource)
    // Два старых тега могли стать одним — внутри группы тег уникален.
    next.boolSource = { ...tms.boolSource, groups: groups.map((g) => [...new Set(g.map(swap))]) }
  }
  return changed ? { tms: next, changed } : null
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
 * их вписывает автор, и на схеме видно именно их) и текст подписи-разметки
 * (`tms.shape.text`).
 */
export function getCellSearchStrings(cell) {
  const tms = cell.get('tms') || {}
  const strings = getCellTags(cell)
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
