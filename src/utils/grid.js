/**
 * Снап координаты к ближайшему узлу сетки.
 *   snapToGrid(53, 10)    → 50
 *   snapToGrid(56, 10)    → 60
 *   snapToGrid(-7, 10)    → -10
 *
 * Используется в местах где paper.options.gridSize должен ограничить
 * пользовательский ввод (drop, paste, resize, drag).
 */
export function snapToGrid(value, gridSize) {
  return Math.round(value / gridSize) * gridSize
}
