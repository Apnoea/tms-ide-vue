/** Снап координаты к ближайшему узлу сетки: `snapToGrid(53, 10)` → 50. */
export function snapToGrid(value, gridSize) {
  return Math.round(value / gridSize) * gridSize
}
