/**
 * boolSource — булевы теги-условия, гасящие элемент (`animation-off`). Форма:
 * `{ groups: [[tag,…],…] }` — внутри группы теги через И, группы между собой через
 * ИЛИ, то есть элемент активен при выполнении хотя бы одной группы целиком. Нет
 * групп — зависимости нет.
 *
 * Тег уникален ВНУТРИ группы, между группами повторяется свободно (общее условие на
 * нескольких ветках). Домен произвольный: «группа» — любое И-условие.
 */
export function normalizeBoolSource(ss) {
  const groups = Array.isArray(ss?.groups) ? ss.groups : []
  return {
    groups: groups
      .map((g) => [...new Set((g || []).filter(Boolean))]) // дедуп внутри группы
      .filter((g) => g.length), // пустые группы отбрасываем
  }
}

/** Плоский уникальный список всех тегов групп (для поиска / detailTags). */
export function boolSourceTags(ss) {
  return [...new Set(normalizeBoolSource(ss).groups.flat())]
}
