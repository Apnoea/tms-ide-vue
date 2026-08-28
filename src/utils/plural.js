/**
 * Форма существительного по числу (русские правила).
 *
 * @example plural(1, 'тег', 'тега', 'тегов') → 'тег'; plural(11, …) → 'тегов'
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

/** «N форма»: `nplural(5, 'тег', 'тега', 'тегов')` → '5 тегов'. */
export function nplural(n, one, few, many) {
  return `${n} ${plural(n, one, few, many)}`
}
