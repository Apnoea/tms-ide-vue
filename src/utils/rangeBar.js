/**
 * Полоска-превью диапазонов: строки «пороги → цвет» в сегменты для отрисовки.
 *
 * В столбике чисел не видно ни порядка, ни пропусков, ни того, какая полоса шире —
 * а рантайм берёт ПЕРВУЮ подходящую строку, поэтому пробелы и перекрытия меняют цвет
 * молча. Полоска показывает это как есть: сегменты идут в порядке строк, фон под ними
 * остаётся видимым там, где значения цвета не получат.
 *
 * Пустой порог = ОТКРЫТАЯ граница (так же читает значение `simValues.rangeRowFor`):
 * строка без верха красит всё от своего низа и выше. Такая зона тянется до края
 * полоски, а подпись шкалы на этом конце — «∞».
 */

import { rangeRowColor } from '../constants/animation'

// Доля полоски под «хвост» открытой зоны: без запаса она сливалась бы с закрытой,
// упирающейся в тот же край.
const OPEN_PAD = 15

/** Число либо null (порог не задан = граница открыта). */
function boundOf(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {Array<{min?: number, max?: number, color?: string}>} ranges
 * @returns {{from: number, to: number, openLeft: boolean, openRight: boolean,
 *   segments: Array<{left: number, width: number, color: string, from: number|null,
 *   to: number|null}>}|null} null — рисовать нечего (нет годных строк или вся шкала
 *   в одной точке без открытых концов).
 */
export function rangeBarSegments(ranges) {
  const rows = []
  for (const r of ranges || []) {
    const color = rangeRowColor(r)
    if (!color) continue
    const min = boundOf(r?.min)
    const max = boundOf(r?.max)
    if (min === null && max === null) continue
    // Перевёрнутые границы нормализуем; открыта ровно та сторона, порог которой пуст.
    const from = min === null ? null : max === null ? min : Math.min(min, max)
    const to = max === null ? null : min === null ? max : Math.max(min, max)
    rows.push({ color, from, to })
  }
  if (!rows.length) return null

  const bounds = rows.flatMap((r) => [r.from, r.to]).filter((v) => v !== null)
  const from = Math.min(...bounds)
  const to = Math.max(...bounds)
  const openLeft = rows.some((r) => r.from === null)
  const openRight = rows.some((r) => r.to === null)
  const span = to - from
  // Точка без открытых концов — шкале нечего показывать («3 — 3» в одной строке).
  if (!(span > 0) && !openLeft && !openRight) return null

  const padLeft = openLeft ? OPEN_PAD : 0
  const inner = 100 - padLeft - (openRight ? OPEN_PAD : 0)
  // Все пороги в одной точке (единственная открытая строка): прижимаем её к тому краю,
  // от которого зона растёт, иначе половина полоски осталась бы пустой.
  const dot = openLeft && openRight ? 50 : openLeft ? 100 : 0
  const pos = (v) => (span > 0 ? padLeft + ((v - from) / span) * inner : dot)

  const segments = rows.map((r) => {
    const left = r.from === null ? 0 : pos(r.from)
    const right = r.to === null ? 100 : pos(r.to)
    return { color: r.color, from: r.from, to: r.to, left, width: Math.max(0, right - left) }
  })
  return { from, to, openLeft, openRight, segments }
}
