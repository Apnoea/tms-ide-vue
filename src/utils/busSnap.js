// Геометрия «символ на шине»: куда сажать и как разворачивать. Чистые функции без
// JointJS — работа с графом в composables/useBusSnap.
//
// Символ ложится НА шину центром (поперёк — на линию слотов, вдоль — по снапу курсора)
// и разворачивается по стороне подноса. Шина при этом не разбивается и проводов не
// появляется: закрепление держит `tms.busId`.
import { busPortY } from '../stencils/busCell'
import { snapToGrid } from './grid'

/**
 * Допуск хит-теста по вертикали (сверх полутолщины тела): тело шины 8px, курсором в
 * него не попасть. Больше — символ прилипал бы, стоя рядом.
 */
export const BUS_SNAP_RANGE = 15

/** Y линии, на которую садятся символы: середина толщины (там же стоят слоты портов). */
export function busLineY(origin, size) {
  return origin.y + busPortY(size.height)
}

/**
 * Сторона подноса: `top` — выше линии шины, `bottom` — ниже. Сравнение с линией, а не
 * с краем тела (у толстой шины край даёт другой ответ, чем видит автор).
 */
export function busApproachSide(origin, size, point) {
  return point.y < busLineY(origin, size) ? 'top' : 'bottom'
}

/**
 * Раскладка символа на шине: угол и позиция (top-left).
 *
 * Поперёк — центр символа на линию шины (она едет при смене толщины, символы за ней).
 * Вдоль — снап курсора к сетке: к слотам портов не привязываем, символ на шине не
 * соединяется проводом.
 *
 * Угол: 0 при подносе снизу, 180 сверху. Символ с `noRotate` остаётся как есть.
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
