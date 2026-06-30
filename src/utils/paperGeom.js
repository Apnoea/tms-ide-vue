// Геометрия JointJS-paper'а. Чистые функции — без обращения к singleton-canvas.

/**
 * Проекция точки из model-координат в экранные (container-px) по текущему
 * zoom/pan paper'а. Единая формула для overlay-композаблов (кнопки выделения,
 * бейджи слотов, hover-плашка), чтобы позиционирование не разъезжалось.
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
