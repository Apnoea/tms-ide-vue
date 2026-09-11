/**
 * Правила строк диапазона — чистые, общие для двух мест, где строки задаются: зоны
 * символа в редакторе и `tms.rangeSource` провода/шины на холсте. Формат строки один:
 * `{ min, max, color }`.
 */

import { RANGE_COLOR_PRESETS, rangeRowColor } from '../constants/animation'

/**
 * Новая строка: цвет — первый пресет, не занятый другими строками, пороги пустые (их
 * вписывает автор).
 */
export function newRangeRow(ranges) {
  const used = new Set((ranges || []).map((r) => rangeRowColor(r)))
  return { color: RANGE_COLOR_PRESETS.find((c) => !used.has(c)) || RANGE_COLOR_PRESETS[0] }
}

/**
 * Шкала начинается с нуля: у ПЕРВОЙ строки низ фиксирован (в UI поле не правится).
 * Приводим при правках списка, а не на чтении: старую форму с другим низом молча
 * переписывать нельзя, а после первой же правки она станет обычной.
 */
export function withZeroStart(ranges) {
  if (!ranges?.length || ranges[0].min === 0) return ranges
  return ranges.map((r, i) => (i === 0 ? { ...r, min: 0 } : r))
}

/**
 * Строки к сохранению в определении символа: только с цветом и хотя бы одной границей
 * (прочие в анимацию не попадают — как в экспорте), поля в каноническом виде
 * `{ min?, max?, color }`. Один и тот же вид у редактора символов и у миграции — по
 * нему наборы разных ячеек и сравниваются между собой.
 */
export function cleanRangeRows(ranges) {
  return (ranges || [])
    .filter((r) => rangeRowColor(r) && (Number.isFinite(r?.min) || Number.isFinite(r?.max)))
    .map((r) => ({
      ...(Number.isFinite(r.min) ? { min: r.min } : {}),
      ...(Number.isFinite(r.max) ? { max: r.max } : {}),
      color: rangeRowColor(r),
    }))
}

/**
 * Правка одной строки: новый массив ranges либо null, если ввод невалиден. min/max —
 * числа, нечисловой ввод дал бы NaN и сломал сравнение при экспорте. Десятичная
 * запятая («3,99») нормализуется в точку до Number().
 */
export function editRanges(ranges, idx, field, value) {
  let parsed = value
  if (field !== 'color') {
    const raw = String(value).trim().replace(',', '.')
    // Пустая строка отсекается ДО Number(): `Number('')` даёт 0, и очистка поля
    // записала бы порог 0.
    if (!raw) return null
    parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
  }
  return ranges.map((r, i) => (i === idx ? { ...r, [field]: parsed } : r))
}
