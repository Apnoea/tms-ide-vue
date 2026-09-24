/**
 * Значения тегов для симуляции: превью считает по ним то же, что рантайм считает по
 * данным с объекта — строка диапазона выбирается сравнением с границами, состояние
 * «по значению» — совпадением с кодом, подпись показывает отформатированное число.
 *
 * Функции чистые: `useSimulation` держит значения тегов и применяет классы, здесь
 * только правила выбора.
 */

import { rangeRowColor } from '../constants/animation'
import { RANGE_SLOT } from '../constants/ids'

/**
 * Роль тега по слоту символа, к которому он привязан: подпись со значением (`Text`) и
 * слот зон (`range`) — число; слот-драйвер — состояние, если у символа они есть, иначе
 * булев. Слот зон — тоже не-`Text`, и без явной проверки его тег уходил бы в тумблер
 * или список состояний, хотя красит символ по числу.
 */
export function slotRole(slot, stencil) {
  if (slot?.type === 'Text' || slot?.key === RANGE_SLOT) return 'value'
  return stencil?.states?.length ? 'state' : 'bool'
}

/** Значение как boolean: рантайм трактует «ложь» как false-кейс биндинга. */
export function boolOf(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value !== '' && value !== '0' && !/^false$/i.test(value)
  return false
}

/** Порог строки диапазона числом; не задан → null (граница открыта). */
export function rangeBound(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
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
    const min = rangeBound(row.min)
    const max = rangeBound(row.max)
    if ((min === null || value >= min) && (max === null || value <= max)) return row
  }
  return null
}

/**
 * Значение, которое точно покрасит элемент строкой `row`, — для кнопок зон в панели
 * симуляции. Закрытая зона — середина, открытая — шаг внутрь от заданной границы: сама
 * граница inclusive и могла отойти соседней строке. Кандидат проверяется тем же
 * `rangeRowFor` (рантайм берёт ПЕРВУЮ подходящую строку): если выше стоит строка,
 * перекрывающая зону целиком, значения для неё нет — null.
 */
export function zoneValueFor(rangeSource, row) {
  const lo = rangeBound(row?.min)
  const hi = rangeBound(row?.max)
  const candidates =
    lo !== null && hi !== null
      ? [(lo + hi) / 2, hi, lo]
      : lo !== null
        ? [lo + 1, lo]
        : hi !== null
          ? [hi - 1, hi]
          : [0]
  for (const raw of candidates) {
    // Три знака — столько показывает поле значения в панели.
    const v = Math.round(raw * 1000) / 1000
    if (rangeRowFor(rangeSource, v) === row) return v
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
