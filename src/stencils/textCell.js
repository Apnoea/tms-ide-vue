// Текстовая подпись (cell_text) — программный символ: содержимое и размер живут
// в tms, а не в shape.svg. Метрики (textCellWidth/Height) общие для автосайза
// ячейки, inline-редактора и экспорта — иначе hit-area разъезжается с текстом.
import { SVG_NS, escapeXml, escapeAttr, svgEl } from '../utils/xml'
import { measureTextWidth, normalizeFont } from '../utils/textMetrics'

/** Параметры рендера текстового символа (общие для редактора и экспорта). */
export const TEXT_FONT_SIZE = 14 // дефолт размера шрифта (pt)
export const TEXT_PADDING_X = 4

/** Высота ячейки под размер шрифта — hit-area совпадает с текстом. */
function textCellHeight(fontSize) {
  return fontSize + 6
}

/**
 * Ширина ячейки под текст/шрифт/жирность (метрика — `utils/textMetrics`).
 * Минимум 24px: пустой текст не должен схлопываться в 0. Без canvas (SSR/jsdom)
 * отдаём 100 — ячейка остаётся кликабельной.
 */
function textCellWidth(text, fontSize, bold = false, font) {
  const w = measureTextWidth(text, fontSize, bold, -1, font)
  if (w < 0) return 100
  return Math.max(24, Math.ceil(w) + TEXT_PADDING_X * 2)
}

/**
 * Габарит ячейки по её tms — единственная точка расчёта размера подписи
 * (палитра, инспектор, inline-правка идут сюда).
 *
 * @param {object} tms — payload cell_text (text/fontSize/bold/fontFamily)
 * @param {string} [text] — переопределение текста (live-resize при печати)
 */
export function textCellSize(tms, text) {
  const fontSize = tms?.fontSize ?? TEXT_FONT_SIZE
  return {
    width: textCellWidth(text ?? tms?.text ?? '', fontSize, !!tms?.bold, tms?.fontFamily),
    height: textCellHeight(fontSize),
  }
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

/**
 * Экспортный SVG: текст по центру по вертикали, с отступом слева.
 *
 * `textLength` фиксирует ширину, посчитанную IDE: панель под generic-именем
 * может взять другую гарнитуру, и подпись наползла бы за габарит ячейки. При
 * совпадении гарнитур не меняет ничего. Без замера или на пустом тексте не
 * пишем — `textLength="0"` схлопнул бы строку.
 */
export function buildTextExportSvg(
  text,
  height,
  { fontSize = TEXT_FONT_SIZE, bold = false, color = '#000', font } = {}
) {
  const y = height / 2
  const weight = bold ? ' font-weight="bold"' : ''
  const measured = measureTextWidth(text, fontSize, bold, -1, font)
  const fit =
    measured > 0 ? ` textLength="${Math.ceil(measured)}" lengthAdjust="spacingAndGlyphs"` : ''
  // Статичная подпись — цвет задаёт автор (tms.color), заливка по диапазонам тут не нужна.
  return `<svg xmlns="${SVG_NS}"><text x="${TEXT_PADDING_X}" y="${y}" dominant-baseline="central" font-size="${fontSize}" font-family="${normalizeFont(font)}"${weight}${fit} fill="${escapeAttr(color || '#000')}">${escapeXml(text)}</text></svg>`
}

/** Контент на холсте: одна <text>-нода из tms.text. Символ статичный. */
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
        'font-family': normalizeFont(tms.fontFamily),
        'font-weight': tms.bold ? 'bold' : null,
        fill: tms.color || '#000',
      },
      tms.text ?? ''
    ),
  ]
}
