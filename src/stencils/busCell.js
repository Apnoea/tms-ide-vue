// Шина (cell_bus) — единственный стенсил с изменяемой шириной: порты и разметка
// считаются от текущего размера, а не берутся из stencil.json. Геометрия портов
// нужна и ресайзу (useBusResize), и созданию ячейки, и round-trip'у.
import { RANGE_FILL_CLASS } from '../constants/animation'
import { SVG_NS, svgEl } from '../utils/xml'

/** Ширина resize-хэндлов (только редактор — в экспорт не идут). */
const BUS_HANDLE_WIDTH = 6

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

/** Индекс порта шины из его id (`top_3` → 3); NaN, если это не порт шины. */
export function busPortIndex(portId) {
  const us = String(portId).indexOf('_')
  return us < 0 ? NaN : Number(String(portId).slice(us + 1))
}

/** `ports.items` шины. id стабильны (`top_i`/`bot_i`) — провода переживают ресайз. */
export function computeBusPorts(width, height) {
  const items = []
  const count = desiredBusPortCount(width)
  for (let i = 0; i < count; i++) {
    const x = busPortX(i)
    items.push({ id: `top_${i}`, group: 'port', args: { x, y: 0 } })
    items.push({ id: `bot_${i}`, group: 'port', args: { x, y: height } })
  }
  return items
}

/** Экспортный SVG: только тело, без resize-хэндлов (они редактор-only). */
export function buildBusExportSvg(width, height) {
  // RANGE_FILL_CLASS — opt-in заливки цветом диапазона (см. buildRangeCssRules).
  return `<svg xmlns="${SVG_NS}"><rect class="${RANGE_FILL_CLASS}" x="0" y="0" width="${width}" height="${height}" fill="#000"/></svg>`
}

/** Контент на холсте: тело по текущему размеру + resize-хэндлы по краям. */
export function buildBusContent(cellView) {
  const { width, height } = cellView.model.size()
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
      fill: '#000',
    }),
  ]

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
