/**
 * Здоровье привязанного тега. Две беды разной природы, но пользователь видит их в
 * одном месте (чип тега в инспекторе), поэтому и считаются одной функцией:
 *
 *  • `breaks-id` — пробел (или иной whitespace) в теге. Критично ТОЛЬКО для
 *    cell_value: у него id узла = сам тег (`animation-<tag>` — рантайм-конвенция,
 *    text-handler ищет через `getElementById`), а id по стандарту не может
 *    содержать пробелов, значит анимация не найдёт узел и карточка навсегда с
 *    прочерком. У остальных символов тег в id не попадает (там stencilId +
 *    short-id), пробел безвреден — но и там он почти всегда опечатка в tag-list'е.
 *  • `unknown` — тега нет в загруженном tag-list. Привязка к исчезнувшему сигналу
 *    выглядит рабочей: чип заполнен, а сигнала за ним нет.
 *
 * Список тегов пуст (не загружен) → про `unknown` молчим: иначе предупреждение
 * висело бы на каждом поле сразу после открытия проекта.
 */

/** Whitespace в теге ломает SVG-id (см. выше). */
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
