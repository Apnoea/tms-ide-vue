// Геометрия «символ на шине»: куда сажать и как разворачивать. Чистые функции без
// JointJS — работа с графом в composables/useBusSnap.
//
// Шина ведёт себя как провод при врезке: символ ложится НА неё центром (поперёк — на
// линию, вдоль — по снапу курсора) и разворачивается по стороне подноса. Отличие от
// врезки в том, что шина не разбивается и провода не появляются: символ просто сидит на
// шине сверху, а закрепление ведёт `tms.busId`.
import { busPortY } from '../stencils/busCell'
import { snapToGrid } from './grid'

/** Допуск хит-теста по вертикали: тело шины 8px, курсором в него не попасть. */
export const BUS_SNAP_RANGE = 20

/** Y линии, на которую садятся символы: середина толщины (там же стоят слоты портов). */
export function busLineY(origin, size) {
  return origin.y + busPortY(size.height)
}

/**
 * Сторона, с которой символ подносят: `top` — выше линии шины, `bottom` — ниже.
 * Сравниваем с линией, а не с краем тела: у толстой шины «выше» началось бы раньше,
 * чем это видит автор.
 */
export function busApproachSide(origin, size, point) {
  return point.y < busLineY(origin, size) ? 'top' : 'bottom'
}

/**
 * Раскладка символа на шине: угол и позиция (top-left).
 *
 * Поперёк — центр символа встаёт на линию шины (при смене толщины линия едет, и
 * символы едут за ней). Вдоль — снап курсора к сетке, как при обычном размещении:
 * привязывать к слотам портов незачем, символ на шине не соединяется проводом.
 *
 * Угол: 0 при подносе снизу, 180 сверху — то самое «направление зависит от того, с
 * какой стороны подносим». Символ с `noRotate` остаётся как есть.
 *
 * @param {{position: {x, y}, size: {width, height}}} bus
 * @param {{width: number, height: number}} cellSize
 * @param {{x: number, y: number}} point — курсор/точка подноса
 * @param {{canRotate?: boolean, gridSize?: number}} opts
 */
export function busAttachPlacement(bus, cellSize, point, { canRotate = true, gridSize = 10 } = {}) {
  const side = busApproachSide(bus.position, bus.size, point)
  const lineY = busLineY(bus.position, bus.size)
  return {
    side,
    angle: canRotate && side === 'top' ? 180 : 0,
    position: {
      x: snapToGrid(point.x - cellSize.width / 2, gridSize),
      y: lineY - cellSize.height / 2,
    },
  }
}
