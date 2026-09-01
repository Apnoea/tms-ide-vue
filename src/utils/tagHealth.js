/**
 * Проблема привязанного тега — показывается на чипе тега.
 *
 * Tag-list не загружен → молчим: предупреждение висело бы на каждом поле сразу
 * после открытия проекта.
 *
 * @param {string} tag
 * @param {Set<string>|null} knownNames — имена из загруженного tag-list (null/пустой = не загружен)
 * @returns {'unknown'|null}
 */
export function tagIssue(tag, knownNames) {
  if (!tag) return null
  if (knownNames?.size && !knownNames.has(tag)) return 'unknown'
  return null
}

/** Человекочитаемая причина для tooltip'а. */
export function tagIssueLabel(issue) {
  if (issue === 'unknown') return 'Тега нет в загруженном tag-list'
  return ''
}
