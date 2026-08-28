/**
 * Проблемы привязанного тега — обе показываются в одном месте (чип тега), поэтому
 * считаются одной функцией:
 *
 *  • `breaks-id` — whitespace в теге. Критично для cell_value: у него id узла = сам
 *    тег, а id с пробелом рантайм не найдёт через `getElementById`.
 *  • `unknown` — тега нет в загруженном tag-list (привязка к исчезнувшему сигналу
 *    выглядит рабочей).
 *
 * Tag-list не загружен → про `unknown` молчим.
 */

/** Whitespace в теге ломает SVG-id. */
export function tagBreaksId(tag) {
  return !!tag && /\s/.test(tag)
}

/**
 * @param {string} tag
 * @param {Set<string>|null} knownNames — имена из загруженного tag-list (null/пустой = не загружен)
 * @returns {'breaks-id'|'unknown'|null}
 */
export function tagIssue(tag, knownNames) {
  if (!tag) return null
  if (tagBreaksId(tag)) return 'breaks-id'
  if (knownNames?.size && !knownNames.has(tag)) return 'unknown'
  return null
}

/** Человекочитаемая причина для tooltip'а. */
export function tagIssueLabel(issue) {
  if (issue === 'breaks-id') return 'Пробел в имени тега — рантайм не найдёт узел анимации'
  if (issue === 'unknown') return 'Тега нет в загруженном tag-list'
  return ''
}
