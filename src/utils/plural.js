/**
 * Возвращает правильную форму существительного для числа по русским правилам:
 *   1, 21, 31 ... → one
 *   2-4, 22-24, 32-34 ... → few
 *   0, 5-20, 25-30, 11-14 (исключение) → many
 *
 * @example
 *   plural(1,  'тег', 'тега', 'тегов') → 'тег'
 *   plural(2,  'тег', 'тега', 'тегов') → 'тега'
 *   plural(5,  'тег', 'тега', 'тегов') → 'тегов'
 *   plural(11, 'тег', 'тега', 'тегов') → 'тегов'
 *   plural(21, 'тег', 'тега', 'тегов') → 'тег'
 */
function plural(n, one, few, many) {
  const abs = Math.abs(n)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/**
 * Удобный шортхэнд "N форма".
 * @example  nplural(5, 'тег', 'тега', 'тегов') → '5 тегов'
 */
export function nplural(n, one, few, many) {
  return `${n} ${plural(n, one, few, many)}`
}
