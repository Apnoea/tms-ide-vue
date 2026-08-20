// Геометрия JointJS-paper'а. Чистые функции — без обращения к singleton-canvas.

/**
 * Проекция точки из model-координат в экранные (container-px) по текущему
 * zoom/pan paper'а. Единая формула для overlay-композаблов (кнопки выделения,
 * hover-плашка), чтобы позиционирование не разъезжалось.
 *
 * @param {import('@joint/core').dia.Paper} paper
 * @param {number} mx  — x в model-координатах
 * @param {number} my  — y в model-координатах
 * @returns {{ x: number, y: number }} экранные (container-px) координаты
 */
export function projectToScreen(paper, mx, my) {
  const scale = paper.scale().sx
  const { tx, ty } = paper.translate()
  return { x: mx * scale + tx, y: my * scale + ty }
}

/**
 * Точка ячейки, ПОВЁРНУТАЯ вместе с ней. `angle` в JointJS вращает outer-группу вокруг
 * центра ячейки, поэтому визуальное место любой локальной точки (угол габарита, ручка
 * ресайза) не равно её модельным координатам. Обратный поворот — тот же вызов с
 * отрицательным углом.
 *
 * @param {{x:number, y:number}} point — точка в модельных координатах (до поворота)
 * @param {{x:number, y:number}} center — центр вращения (центр ячейки)
 * @param {number} angle — градусы
 */
export function rotatePoint(point, center, angle) {
  const a = ((angle || 0) * Math.PI) / 180
  if (!a) return { x: point.x, y: point.y }
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

// Overlay-кнопки выделения (32×32). Зазор заметный: кнопка крупнее мелкого символа
// (20×20), иначе она наползает на него и на соседей, и клик по соседу попадает в неё.
const BTN_HALF = 16
const BTN_GAP = 24

/**
 * Позиции overlay-кнопок вокруг рамки выделения (css-`left`/`top` по центру кнопки).
 * Считаются от рамки в ПИКСЕЛЯХ — что за ней (ячейка холста или габарит фигур в
 * редакторе символов), функции всё равно; общая формула держит раскладку кнопок
 * одинаковой в холсте и редакторе.
 *
 * Повороты — по верхним углам, отражения — на серединах сторон (горизонтальное
 * сверху, вертикальное слева), удаление и замок — по нижним.
 */
export function overlayButtonPositions({ left, top, right, bottom }) {
  const at = (x, y) => ({ left: `${x - BTN_HALF}px`, top: `${y - BTN_HALF}px` })
  return {
    rotateCcw: at(left - BTN_GAP, top - BTN_GAP),
    rotateCw: at(right + BTN_GAP, top - BTN_GAP),
    flipH: at((left + right) / 2, top - BTN_GAP),
    flipV: at(left - BTN_GAP, (top + bottom) / 2),
    delete: at(right + BTN_GAP, bottom + BTN_GAP),
    lock: at(left - BTN_GAP, bottom + BTN_GAP),
  }
}

/**
 * Осевыровненный bbox ячейки С УЧЁТОМ поворота. `cell.getBBox()` даёт
 * неповёрнутую рамку (position+size), поэтому у развёрнутого стенсила (вертикальный
 * положили горизонтально) габариты считались бы по исходным → щели/наложения при
 * выравнивании, смещённые overlay/бейджи. Здесь поворачиваем вокруг центра и берём
 * охватывающий прямоугольник. Углы в проекте кратны 90°, поэтому округляем (гасим
 * float-эпсилон cos/sin). Возвращает { x, y, width, height } в model-координатах.
 */
export function rotatedAabb(pos, size, angle) {
  const w = size.width
  const h = size.height
  const a = ((angle || 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(a))
  const sin = Math.abs(Math.sin(a))
  const rw = w * cos + h * sin
  const rh = w * sin + h * cos
  const cx = pos.x + w / 2
  const cy = pos.y + h / 2
  return {
    x: Math.round(cx - rw / 2),
    y: Math.round(cy - rh / 2),
    width: Math.round(rw),
    height: Math.round(rh),
  }
}
