// Текстовая подпись (cell_text) — программный стенсил: содержимое и размер живут
// в tms, а не в shape.svg. Метрики (textCellWidth/Height) общие для автосайза
// ячейки, inline-редактора и экспорта — иначе hit-area разъезжается с текстом.
import { SVG_NS, escapeXml, escapeAttr, svgEl } from '../utils/xml'
import { measureTextWidth, SVG_FONT } from '../utils/textMetrics'

/** Параметры рендера текстового стенсила (общие для редактора и экспорта). */
export const TEXT_FONT_SIZE = 14 // дефолт размера шрифта (pt)
export const TEXT_PADDING_X = 4

/** Высота ячейки под размер шрифта — hit-area совпадает с текстом. */
export function textCellHeight(fontSize) {
  return fontSize + 6
}

/**
 * Ширина ячейки под текст/шрифт/жирность (метрика — `utils/textMetrics`).
 * Минимум 24px: пустой текст не должен схлопываться в 0. Без canvas (SSR/jsdom)
 * отдаём 100 — ячейка остаётся кликабельной.
 */
export function textCellWidth(text, fontSize, bold = false) {
  const w = measureTextWidth(text, fontSize, bold, -1)
  if (w < 0) return 100
  return Math.max(24, Math.ceil(w) + TEXT_PADDING_X * 2)
}

/**
 * Ресайз с сохранением якоря. Блок всегда обтягивает текст, поэтому `align` — это
 * какой край остаётся на месте при росте (сам текст внутри прижат влево):
 * left — растёт вправо, center — симметрично, right — влево. Высота всегда вниз.
 * Возвращает применённую ширину (нужна overlay-инпуту inline-правки).
 */
export function resizeTextCell(cell, newW, newH, align = 'left') {
  const oldW = cell.get('size').width
  cell.resize(newW, newH)
  if (oldW !== newW && (align === 'center' || align === 'right')) {
    const pos = cell.get('position')
    const dx = align === 'center' ? (oldW - newW) / 2 : oldW - newW
    cell.position(pos.x + dx, pos.y)
  }
  return newW
}

/** Экспортный SVG: текст по центру по вертикали, с отступом слева. */
export function buildTextExportSvg(
  text,
  height,
  { fontSize = TEXT_FONT_SIZE, bold = false, color = '#000' } = {}
) {
  const y = height / 2
  const weight = bold ? ' font-weight="bold"' : ''
  // Статичная подпись — цвет задаёт автор (tms.color), заливка по диапазонам тут не нужна.
  return `<svg xmlns="${SVG_NS}"><text x="${TEXT_PADDING_X}" y="${y}" dominant-baseline="central" font-size="${fontSize}" font-family="${SVG_FONT}"${weight} fill="${escapeAttr(color || '#000')}">${escapeXml(text)}</text></svg>`
}

/** Контент на холсте: одна <text>-нода из tms.text. Стенсил статичный. */
export function buildTextContent(cellView) {
  const { height } = cellView.model.size()
  const tms = cellView.model.get('tms') || {}
  const fontSize = tms.fontSize ?? TEXT_FONT_SIZE

  return [
    svgEl(
      'text',
      {
        x: TEXT_PADDING_X,
        y: height / 2,
        'dominant-baseline': 'central',
        'font-size': fontSize,
        'font-family': SVG_FONT,
        'font-weight': tms.bold ? 'bold' : null,
        fill: tms.color || '#000',
      },
      tms.text ?? ''
    ),
  ]
}
