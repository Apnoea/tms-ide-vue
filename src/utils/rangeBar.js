/**
 * Полоска-превью диапазонов: строки «пороги → цвет» в сегменты для отрисовки.
 *
 * В столбике чисел не видно ни порядка, ни пропусков, ни того, какая полоса шире —
 * а рантайм берёт ПЕРВУЮ подходящую строку, поэтому пробелы и перекрытия меняют цвет
 * молча. Полоска показывает это как есть: сегменты идут в порядке строк, фон под ними
 * остаётся видимым там, где значения цвета не получат.
 *
 * Считает по строкам с ЧИСЛОВЫМИ границами и заданным цветом — остальные в экспорт всё
 * равно не попадают.
 */

import { rangeRowColor } from '../constants/animation'

/**
 * @param {Array<{min?: number, max?: number, color?: string, class?: string}>} ranges
 * @returns {{from: number, to: number, segments: Array<{left: number, width: number,
 *   color: string, from: number, to: number}>}|null} null — рисовать нечего
 *   (нет годных строк или вся шкала в одной точке).
 */
export function rangeBarSegments(ranges) {
  const rows = []
  for (const r of ranges || []) {
    const color = rangeRowColor(r)
    const min = Number(r?.min)
    const max = Number(r?.max)
    if (!color || !Number.isFinite(min) || !Number.isFinite(max)) continue
    rows.push({ color, from: Math.min(min, max), to: Math.max(min, max) })
  }
  if (!rows.length) return null

  const from = Math.min(...rows.map((r) => r.from))
  const to = Math.max(...rows.map((r) => r.to))
  const span = to - from
  if (!(span > 0)) return null

  const segments = rows.map((r) => ({
    color: r.color,
    from: r.from,
    to: r.to,
    left: ((r.from - from) / span) * 100,
    width: ((r.to - r.from) / span) * 100,
  }))
  return { from, to, segments }
}
