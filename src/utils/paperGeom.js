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
