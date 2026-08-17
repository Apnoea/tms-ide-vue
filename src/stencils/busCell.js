// Шина (cell_bus) — единственный стенсил с изменяемой шириной: порты и разметка
// считаются от текущего размера, а не берутся из stencil.json. Геометрия портов
// нужна и ресайзу (useBusResize), и созданию ячейки, и round-trip'у.
import { RANGE_FILL_CLASS, cssColor } from '../constants/animation'
import { SVG_NS, svgEl } from '../utils/xml'

/** Ширина resize-хэндлов (только редактор — в экспорт не идут). */
const BUS_HANDLE_WIDTH = 6

/**
 * Цвет тела шины по умолчанию. Автор может задать свой (`tms.color`) — это БАЗОВЫЙ
 * цвет: привязанные диапазоны/обесточивание заливают тело поверх него
 * (`tms-range-fill` + `!important` в CSS), поэтому в рантайме свой цвет виден, пока
 * ни один animation-класс не активен.
 */
export const BUS_COLOR_DEFAULT = '#000000'

/**
 * Цвет тела к отрисовке. Чистим ЗДЕСЬ, а не у вызывающих: значение уходит в атрибут
 * `fill` (и в экспортный SVG), а в модель оно могло попасть из чужого архива или
 * старого автосейва — `url(#…)` там подменил бы отрисовку целиком.
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
 * Y порта — середина толщины: слот шины физически ОДНА точка цепи, и провод сверху с
 * проводом снизу приходят в неё же. Два ряда по краям (прошлая схема `top_i`/`bot_i`)
 * делали из одной точки два независимых порта, а с регулируемой толщиной ещё и
 * разносили их визуально. Округляем: дробный Y увёл бы порт с сетки.
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
 * Толщина шины — это ВЫСОТА ячейки: тело рисуется по ней, а порты стоят в её середине
 * (busPortY), поэтому сдвигаем их следом (провода едут за портом сами). Количество
 * портов зависит только от ширины, так что набор не пересобираем — двигаем `args/y`.
 *
 * Минимум — дефолтная высота из определения символа: она и есть «тонкая шина», ниже
 * тело сливается с проводами. Значение округляем до целого: дробная высота увела бы
 * порты на дробные координаты.
 *
 * @returns {boolean} менялось ли что-то (false = вызывающему нечего писать в историю)
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
 * Атрибуты маркера соединения. Нужен он потому, что слот стоит в СЕРЕДИНЕ толщины:
 * конец провода уходит ПОД тело шины (символы выше проводов по z), и без точки
 * «соединено» не отличить от «провод проходит мимо». Рисуем в контенте шины, а не на
 * конце линии — маркер в группе провода оказался бы под телом; в `view.svg` портов
 * вообще нет, а на холсте они скрыты до hover (см. style.css).
 *
 * Заливка контрастная, обводка — цветом провода, чтобы точка читалась как его
 * продолжение; цвет чистим здесь же (см. busColor — он мог приехать из чужого архива).
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
 * проводов в один порт — штатная ситуация (слот шины = одна точка цепи), обводку берём
 * от первого. Обходим `getLinks`, а не `getConnectedLinks`: тот же путь годится и
 * экспортёру, который работает с графом только на чтение.
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
 * Контент на холсте: тело по текущему размеру + маркеры занятых слотов + resize-хэндлы
 * по краям. Маркеры те же, что в экспорте (общий busMarkerAttrs), иначе холст расходился
 * бы с `view.svg`; занятость читаем из графа — перерисовку при подключении/отключении
 * провода дёргает CanvasPane.
 */
export function buildBusContent(cellView) {
  const { width, height } = cellView.model.size()
  const color = busColor(cellView.model.get('tms')?.color)
  const hw = BUS_HANDLE_WIDTH
  const overhang = 2 // насколько хэндл выпирает по Y за тело шины

  const out = [
    // Тот же opt-in класс, что в экспорте: иначе симуляция расходится с view.svg.
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
