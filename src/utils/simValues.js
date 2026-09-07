/**
 * Значения тегов для симуляции: превью считает по ним то же, что рантайм считает по
 * данным с объекта — строка диапазона выбирается сравнением с границами, состояние
 * «по значению» — совпадением с кодом, подпись показывает отформатированное число.
 *
 * Функции чистые: `useSimulation` держит значения тегов и применяет классы, здесь
 * только правила выбора.
 */

import { rangeRowColor } from '../constants/animation'

/** Значение как boolean: рантайм трактует «ложь» как false-кейс биндинга. */
export function boolOf(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value !== '' && value !== '0' && !/^false$/i.test(value)
  return false
}

/**
 * Строка диапазона под значение: границы inclusive с обоих концов — так их сравнивает
 * condition-evaluator рантайма. Строки без цвета не дают класса, поэтому пропускаются.
 * Значение вне всех строк → null (цвета нет, как и в рантайме).
 */
export function rangeRowFor(rangeSource, value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  for (const row of rangeSource?.ranges || []) {
    if (!rangeRowColor(row)) continue
    const min = Number(row.min)
    const max = Number(row.max)
    const okMin = !Number.isFinite(min) || value >= min
    const okMax = !Number.isFinite(max) || value <= max
    if (okMin && okMax) return row
  }
  return null
}

/**
 * Ключ состояния «по значению» под значение тега: сравнение по `code` строкой —
 * коды вписывает автор, и в карточке они уезжают ключами `cases`. Совпадения нет →
 * null, ни одна группа не активна.
 */
export function stateKeyFor(states, value) {
  if (value == null) return null
  const code = String(value)
  const hit = (states || []).find((s) => s.code !== '' && s.code != null && String(s.code) === code)
  return hit?.key ?? null
}

/** Текст подписи со значением: число — с точностью карточки, прочее — как есть. */
export function formatValueText(value, decimals) {
  if (value == null) return '--'
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toFixed(Math.max(0, Math.min(20, decimals ?? 0))) : '--'
  }
  return String(value)
}

/**
 * Случайное значение тега — для тех, что не задали вручную: «просто посмотреть» должно
 * работать без заполнения всех полей.
 *
 * Оно подбирается ОСМЫСЛЕННО, иначе превью показывало бы недостижимые состояния:
 * у символа «по значению» берётся код одного из состояний, у диапазонов — точка внутри
 * случайной строки, у булевых — true/false.
 *
 * @param {object} opts
 * @param {string} [opts.type] — тип из tag-list
 * @param {object} [opts.rangeSource] — источник диапазонов, если тег в нём участвует
 * @param {Array} [opts.states] — состояния символа, если тег драйвит их
 * @param {() => number} [opts.rnd] — генератор 0..1 (тесты подставляют свой)
 */
export function randomValueForTag({ type, rangeSource, states, rnd = Math.random } = {}) {
  const coded = (states || []).filter((s) => s.code !== '' && s.code != null)
  if (coded.length) {
    const code = coded[Math.min(coded.length - 1, Math.floor(rnd() * coded.length))].code
    const num = Number(code)
    return Number.isFinite(num) && String(num) === String(code) ? num : code
  }
  const rows = (rangeSource?.ranges || []).filter((r) => rangeRowColor(r))
  if (rows.length) {
    const row = rows[Math.min(rows.length - 1, Math.floor(rnd() * rows.length))]
    const min = Number(row.min)
    const max = Number(row.max)
    if (Number.isFinite(min) && Number.isFinite(max)) return min + (max - min) * rnd()
    if (Number.isFinite(min)) return min + rnd() * 100
    if (Number.isFinite(max)) return max - rnd() * 100
  }
  if (/^bool/i.test(type || '')) return rnd() < 0.5
  return rnd() * 100
}
