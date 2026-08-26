// Точка соединения (cell_node) — программный символ: сама точка рисуется по
// `tms` (цвет и размер задаёт автор), а не берётся из shape.svg. Геометрия и цвета
// одни для экспорта (buildNodeExportSvg) и холста (buildNodeContent), иначе схема в
// рантайме разойдётся с тем, что видно в IDE.
//
// Габарит ячейки (20×20) при этом НЕ меняется: он держит hit-area и порт `center` из
// stencil.json, а `defaultAnchor`/`defaultConnectionPoint` холста считают центр bbox
// (см. canvasPaper) — привязка проводов не должна зависеть от того, как выглядит точка.
import { RANGE_FILL_CLASS, cssColor } from '../constants/animation'
import { SVG_NS, svgEl } from '../utils/xml'

/**
 * Цвет и диаметр точки по умолчанию — тот же вид, что был захардкожен в shape.svg
 * (он остался для превью в палитре). Минимум диаметра = дефолт: точка тоньше
 * неотличима от места пересечения проводов.
 */
export const NODE_COLOR_DEFAULT = '#000000'
export const NODE_SIZE_DEFAULT = 2
/** Больше габарита ячейки точка не растёт — иначе вылезет за свою hit-area. */
export const NODE_SIZE_MAX = 20

/**
 * Цвет к отрисовке. Чистим здесь, а не у вызывающих: значение уходит в атрибут `fill`
 * экспортного SVG, а в модель могло попасть из чужого архива — `url(#…)` подменил бы
 * отрисовку (та же причина, что у `busColor`).
 */
function nodeColor(value) {
  return cssColor(value) || NODE_COLOR_DEFAULT
}

/** Диаметр к отрисовке: целый, в пределах [дефолт, габарит ячейки]. */
export function nodeSize(value) {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return NODE_SIZE_DEFAULT
  return Math.min(NODE_SIZE_MAX, Math.max(NODE_SIZE_DEFAULT, Math.round(n)))
}

/** Экспортный SVG: точка по центру ячейки. */
export function buildNodeExportSvg(width, height, tms = {}) {
  const r = nodeSize(tms.dotSize) / 2
  // RANGE_FILL_CLASS — opt-in заливки цветом диапазона (см. buildRangeCssRules).
  return (
    `<svg xmlns="${SVG_NS}"><circle class="${RANGE_FILL_CLASS}" ` +
    `cx="${width / 2}" cy="${height / 2}" r="${r}" fill="${nodeColor(tms.color)}"/></svg>`
  )
}

/** Контент на холсте — та же точка тем же классом, что уедет в view.svg. */
export function buildNodeContent(cellView) {
  const tms = cellView.model.get('tms') || {}
  const { width, height } = cellView.model.size()
  return [
    svgEl('circle', {
      class: RANGE_FILL_CLASS,
      cx: width / 2,
      cy: height / 2,
      r: nodeSize(tms.dotSize) / 2,
      fill: nodeColor(tms.color),
    }),
  ]
}
