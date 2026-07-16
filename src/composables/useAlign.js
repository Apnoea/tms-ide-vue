import { computed } from 'vue'
import { snapToGrid } from '../utils/grid'
import { useCanvas } from './useCanvas'

/**
 * Выравнивание выделенных ячеек по общей рамке выделения — БЕЗ наложений.
 *
 * Ключевая идея: ячейки, пересекающиеся по перпендикулярной оси, образуют «полосу»
 * и пакуются ВПЛОТНУЮ (в исходном порядке) вдоль оси выравнивания — так они сводятся
 * до касания, но не налезают друг на друга. Полоса из одной ячейки = обычное
 * выравнивание (край/центр). Разные полосы по перпендикуляру не пересекаются, значит
 * и после сдвига наложений нет.
 *
 * Двигаем `cell.translate(dx, dy, { uiNudge: true })` — тот же путь, что сдвиг
 * стрелками: multi-drag-хендлер флаг пропускает; в конце один bumpVersion +
 * requestSnapshot (реактивность + undo/autosave). Провода перестроятся за портами.
 *
 * Края (left/right/top/bottom) остаются на сетке сами (edge и размеры кратны шагу);
 * центры — старт полосы снапим к сетке, дальше курсор шагает по размерам (кратны 10).
 */

// Полосы: индексы боксов, пересекающихся по перпендикулярной оси (транзитивно,
// union-find). Касание краями (равные координаты) полосой НЕ считается.
function overlapLanes(boxes, perp, perpSize) {
  const parent = boxes.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a[perp] < b[perp] + b[perpSize] && b[perp] < a[perp] + a[perpSize]) {
        parent[find(i)] = find(j)
      }
    }
  }
  const lanes = new Map()
  for (let i = 0; i < boxes.length; i++) {
    const r = find(i)
    if (!lanes.has(r)) lanes.set(r, [])
    lanes.get(r).push(i)
  }
  return [...lanes.values()]
}

// Сдвиги {dx,dy} для каждого бокса под режим. Чистая — экспортируем для тестов.
export function computeAlignMoves(mode, boxes, grid = 10) {
  const axis = mode === 'left' || mode === 'right' || mode === 'centerX' ? 'x' : 'y'
  const size = axis === 'x' ? 'width' : 'height'
  const perp = axis === 'x' ? 'y' : 'x'
  const perpSize = axis === 'x' ? 'height' : 'width'
  const min = Math.min(...boxes.map((b) => b[axis]))
  const max = Math.max(...boxes.map((b) => b[axis] + b[size]))

  const moves = boxes.map(() => ({ dx: 0, dy: 0 }))
  for (const lane of overlapLanes(boxes, perp, perpSize)) {
    // порядок вдоль оси — чтобы упаковка сохранила взаимное расположение
    const ordered = [...lane].sort((a, b) => boxes[a][axis] - boxes[b][axis])
    const total = ordered.reduce((s, i) => s + boxes[i][size], 0)
    let cursor
    if (mode === 'left' || mode === 'top') cursor = min
    else if (mode === 'right' || mode === 'bottom') cursor = max - total
    else cursor = snapToGrid((min + max) / 2 - total / 2, grid) // центр полосы к оси выделения
    for (const i of ordered) {
      const delta = cursor - boxes[i][axis]
      if (axis === 'x') moves[i].dx = delta
      else moves[i].dy = delta
      cursor += boxes[i][size]
    }
  }
  return moves
}

export function useAlign() {
  const canvas = useCanvas()

  // Ячейки-модели из выделения (без линков — у них нет своей позиции).
  function selectedCells() {
    const graph = canvas.graphRef.value
    if (!graph) return []
    return canvas.selection.value
      .filter((s) => s.kind === 'cell')
      .map((s) => graph.getCell(s.id))
      .filter((c) => c && c.isElement?.())
  }

  // Выравнивать есть смысл от двух ячеек — гейт для показа кнопок.
  const canAlign = computed(
    () => canvas.selection.value.filter((s) => s.kind === 'cell').length >= 2
  )

  function alignCells(mode) {
    const graph = canvas.graphRef.value
    const cells = selectedCells()
    if (!graph || cells.length < 2) return
    const grid = canvas.paperRef.value?.options?.gridSize || 10

    const boxes = cells.map((c) => c.getBBox())
    const moves = computeAlignMoves(mode, boxes, grid)

    let moved = false
    moves.forEach((m, i) => {
      if (m.dx || m.dy) {
        cells[i].translate(m.dx, m.dy, { uiNudge: true })
        moved = true
      }
    })
    if (!moved) return
    canvas.bumpVersion()
    canvas.requestSnapshot()
  }

  return { canAlign, alignCells }
}
