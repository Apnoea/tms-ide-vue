// Шина (cell_bus) — символ с изменяемой шириной и программными портами: слоты и вид
// считаются от текущего размера, а не берутся из stencil.json. Геометрию портов читают
// ресайз (useBusResize), создание ячейки и round-trip.
import { RANGE_FILL_CLASS, cssColor } from '../constants/animation'
import { SVG_NS, svgEl } from '../utils/xml'

/** Ширина resize-хэндлов (только редактор — в экспорт не идут). */
const BUS_HANDLE_WIDTH = 6

/**
 * Цвет тела шины по умолчанию. Свой (`tms.color`) — БАЗОВЫЙ: диапазоны и
 * обесточивание заливают тело поверх него (`tms-range-fill` + `!important`), поэтому
 * он виден, пока ни один animation-класс не активен.
 */
export const BUS_COLOR_DEFAULT = '#000000'

/**
 * Цвет тела к отрисовке — чистится здесь, а не у вызывающих: значение уходит в
 * атрибут `fill` экспортного SVG, а в модель могло попасть `url(#…)` из чужого архива.
 */
function busColor(value) {
  return cssColor(value) || BUS_COLOR_DEFAULT
}

/** Шаг портов: ресайз снапит ширину к нему, один шаг = один слот порта. */
export const BUS_PORT_SPACING = 20

/** X порта по индексу: первый — на шаг от левого края, дальше через шаг. */
export function busPortX(index) {
  return (index + 1) * BUS_PORT_SPACING
}

/** Сколько портов влезет: минимум 1, крайние не доходят до resize-хэндлов. */
export function desiredBusPortCount(width) {
  return Math.max(1, Math.floor(width / BUS_PORT_SPACING) - 1)
}

/** Индекс порта шины из его id (`p_3` → 3); NaN, если это не порт шины. */
export function busPortIndex(portId) {
  const us = String(portId).indexOf('_')
  return us < 0 ? NaN : Number(String(portId).slice(us + 1))
}

/**
 * Y порта — середина толщины: слот шины физически одна точка цепи, провода сверху и
 * снизу приходят в неё же. Округляем — дробный Y увёл бы порт с сетки.
 */
export function busPortY(height) {
  return Math.round((Number(height) || 0) / 2)
}

/** `ports.items` шины. id стабильны (`p_i`) — провода переживают ресайз. */
export function computeBusPorts(width, height) {
  const items = []
  const count = desiredBusPortCount(width)
  const y = busPortY(height)
  for (let i = 0; i < count; i++) {
    items.push({ id: `p_${i}`, group: 'port', args: { x: busPortX(i), y } })
  }
  return items
}

/** Предел толщины: шина шире этого перестаёт читаться как линия связи. */
export const BUS_THICKNESS_MAX = 40

/**
 * Толщина шины — это ВЫСОТА ячейки: тело рисуется по ней, порты стоят в её середине
 * (busPortY) и сдвигаются следом (правим `args/y`, набор не пересобираем — он зависит
 * только от ширины).
 *
 * Минимум — дефолтная высота из определения символа, значение целое (дробная высота
 * увела бы порты с сетки).
 *
 * @returns {boolean} менялось ли что-то (false = шаг истории не нужен)
 */
export function setBusThickness(cell, paper, value, min) {
  const size = cell.get('size')
  const next = Math.min(BUS_THICKNESS_MAX, Math.max(min, Math.round(value)))
  if (!Number.isFinite(next) || next === size.height) return false
  cell.resize(size.width, next)
  const y = busPortY(next)
  for (const port of cell.getPorts()) {
    if (port.args?.y !== y) cell.portProp(port.id, 'args/y', y)
  }
  return true
}

/** Заливка маркера соединения: «дырка» в теле шины, видна на любом тёмном цвете. */
export const BUS_MARKER_FILL = '#ffffff'

/** Не меньше порта на холсте (r=3), у толстого провода — чуть шире линии. */
export function busMarkerRadius(strokeWidth) {
  const w = Number(strokeWidth)
  return Math.max(3, Math.round((Number.isFinite(w) && w > 0 ? w : 2) + 1))
}

/**
 * Атрибуты маркера соединения: слот стоит в СЕРЕДИНЕ толщины, конец провода уходит под
 * тело шины, и без точки «соединено» не отличить от «проходит мимо». Маркер рисует
 * контент шины, а не группа провода (та оказалась бы под телом).
 *
 * Заливка контрастная, обводка — цветом провода; цвет чистится здесь же (busColor).
 *
 * @param {{index: number, color?: string, strokeWidth?: number}} mark
 */
function busMarkerAttrs(mark, y) {
  return {
    cx: busPortX(mark.index),
    cy: y,
    r: busMarkerRadius(mark.strokeWidth),
    fill: BUS_MARKER_FILL,
    stroke: busColor(mark.color),
    'stroke-width': 1,
  }
}

/**
 * Занятые слоты шины: `{ index, color, strokeWidth }` по одному на слот. Несколько
 * проводов в один порт — штатно (слот = одна точка цепи), обводка берётся от первого.
 */
export function collectBusMarks(graph, cellId) {
  const byIndex = new Map()
  for (const link of graph?.getLinks?.() || []) {
    const tms = link.get('tms') || {}
    for (const end of ['source', 'target']) {
      const ref = link.get(end)
      if (ref?.id !== cellId || !ref.port) continue
      const index = busPortIndex(ref.port)
      if (!Number.isFinite(index) || byIndex.has(index)) continue
      byIndex.set(index, { index, color: tms.strokeColor, strokeWidth: tms.strokeWidth })
    }
  }
  return [...byIndex.values()]
}

/** Экспортный SVG: тело + маркеры занятых слотов, без resize-хэндлов (редактор-only). */
export function buildBusExportSvg(width, height, color, marks = []) {
  const y = busPortY(height)
  const dots = marks
    .map((m) => {
      const a = busMarkerAttrs(m, y)
      return `<circle cx="${a.cx}" cy="${a.cy}" r="${a.r}" fill="${a.fill}" stroke="${a.stroke}" stroke-width="${a['stroke-width']}"/>`
    })
    .join('')
  // RANGE_FILL_CLASS — opt-in заливки цветом диапазона (см. buildRangeCssRules).
  return `<svg xmlns="${SVG_NS}"><rect class="${RANGE_FILL_CLASS}" x="0" y="0" width="${width}" height="${height}" fill="${busColor(color)}"/>${dots}</svg>`
}

/**
 * Контент на холсте: тело по текущему размеру + маркеры занятых слотов (те же, что в
 * экспорте) + resize-хэндлы по краям. Занятость читается из графа, перерисовку при
 * подключении провода дёргает CanvasPane.
 */
export function buildBusContent(cellView) {
  const { width, height } = cellView.model.size()
  const color = busColor(cellView.model.get('tms')?.color)
  const hw = BUS_HANDLE_WIDTH
  const overhang = 2 // насколько хэндл выпирает по Y за тело шины

  const out = [
    // Тот же opt-in класс, что в экспорте (симуляция и view.svg красятся одинаково).
    svgEl('rect', {
      class: RANGE_FILL_CLASS,
      x: hw,
      y: 0,
      width: Math.max(0, width - hw * 2),
      height,
      fill: color,
    }),
  ]

  const y = busPortY(height)
  for (const mark of collectBusMarks(cellView.model.graph, cellView.model.id)) {
    out.push(svgEl('circle', busMarkerAttrs(mark, y)))
  }

  for (const edge of ['left', 'right']) {
    const h = svgEl('rect', {
      class: 'tms-resize-handle',
      'data-edge': edge,
      x: edge === 'left' ? 0 : width - hw,
      y: -overhang,
      width: hw,
      height: height + overhang * 2,
      fill: '#06b6d4', // cyan-500 (= primary темы)
    })
    h.style.cursor = 'ew-resize'
    out.push(h)
  }

  return out
}
