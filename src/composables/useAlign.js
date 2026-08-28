import { computed } from 'vue'
import { snapToGrid } from '../utils/grid'
import { rotatedAabb } from '../utils/paperGeom'
import { useCanvas } from './useCanvas'

/**
 * Выравнивание выделенных ячеек по общей рамке выделения — БЕЗ наложений.
 *
 * Ячейки, пересекающиеся по перпендикулярной оси, образуют «полосу» и пакуются
 * ВПЛОТНУЮ (в исходном порядке) вдоль оси выравнивания: сводятся до касания, но не
 * налезают. Полоса из одной ячейки = обычное выравнивание по краю или центру; разные
 * полосы по перпендикуляру не пересекаются, поэтому наложений нет и после сдвига.
 *
 * Сдвиг идёт через `cell.translate(dx, dy, { uiNudge: true })` — тот же путь, что у
 * стрелок (multi-drag-хендлер этот флаг пропускает), в конце один bumpVersion и
 * requestSnapshot. Провода перестраиваются за портами.
 *
 * Края остаются на сетке сами (edge и размеры кратны шагу), у центров к сетке снапится
 * старт полосы, дальше курсор шагает по размерам.
 */

// Полосы: индексы боксов, пересекающихся по перпендикулярной оси (транзитивно,
// union-find). Касание краями полосой не считается.
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

// Сдвиги для РАСПРЕДЕЛЕНИЯ: равные интервалы по оси (axis 'x'/'y'). Группируем ПО
// ОСИ распределения (колонки для 'x', строки для 'y' — пересечение ВДОЛЬ оси):
// элементы одной колонки/строки двигаются как одна группа, распределяются сами
// группы. Так сетка не схлопывается (колонка едет целиком), а «3 элемента в ряд»
// корректно расходятся (каждый — своя группа). Нужно ≥3 групп. Крайние держат
// концы, середины — равный gap (снап к сетке); gap<0 → 0. Чистая.
export function computeDistributeMoves(axis, boxes, grid = 10) {
  const size = axis === 'x' ? 'width' : 'height'
  const moves = boxes.map(() => ({ dx: 0, dy: 0 }))
  const groups = overlapLanes(boxes, axis, size).map((idxs) => {
    const start = Math.min(...idxs.map((i) => boxes[i][axis]))
    const end = Math.max(...idxs.map((i) => boxes[i][axis] + boxes[i][size]))
    return { idxs, start, end, len: end - start }
  })
  if (groups.length < 3) return moves
  groups.sort((a, b) => a.start - b.start)
  const last = groups.length - 1
  const spanStart = groups[0].start
  const spanEnd = groups[last].end
  const sumLen = groups.reduce((s, g) => s + g.len, 0)
  const gap = Math.max(0, (spanEnd - spanStart - sumLen) / last)
  let cursor = spanStart
  groups.forEach((g, k) => {
    let targetStart
    if (k === 0) targetStart = spanStart
    else if (k === last) targetStart = spanEnd - g.len
    else targetStart = snapToGrid(cursor, grid)
    const delta = targetStart - g.start
    for (const i of g.idxs) {
      if (axis === 'x') moves[i].dx = delta
      else moves[i].dy = delta
    }
    cursor += g.len + gap
  })
  return moves
}

export function useAlign() {
  const canvas = useCanvas()

  // Ячейки-модели из выделения (без линков — у них нет своей позиции; без locked —
  // их не двигаем, read-only, иначе выравнивание/распределение сдвинуло бы замок).
  function selectedCells() {
    const graph = canvas.graphRef.value
    if (!graph) return []
    return canvas.selection.value
      .filter((s) => s.kind === 'cell')
      .map((s) => graph.getCell(s.id))
      .filter((c) => c && c.isElement?.() && !c.get('tms')?.locked)
  }

  // Выравнивать есть смысл от двух ячеек, распределять — от трёх (крайние держат
  // концы, распределяются середины). Гейты для показа/дизейбла кнопок.
  const cellCount = computed(() => canvas.selection.value.filter((s) => s.kind === 'cell').length)
  const canAlign = computed(() => cellCount.value >= 2)
  const canDistribute = computed(() => cellCount.value >= 3)

  // Рамки с учётом поворота (см. rotatedAabb) — иначе развёрнутый символ считается
  // по исходным габаритам.
  const cellBoxes = (cells) =>
    cells.map((c) => rotatedAabb(c.get('position'), c.get('size'), c.angle?.() || 0))

  // Применяет сдвиги: translate({uiNudge}) мимо multi-drag-хендлера, один snapshot.
  function applyMoves(cells, moves) {
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

  function alignCells(mode) {
    const cells = selectedCells()
    if (cells.length < 2) return
    const grid = canvas.paperRef.value?.options?.gridSize || 10
    applyMoves(cells, computeAlignMoves(mode, cellBoxes(cells), grid))
  }

  function distributeCells(axis) {
    const cells = selectedCells()
    if (cells.length < 3) return
    const grid = canvas.paperRef.value?.options?.gridSize || 10
    applyMoves(cells, computeDistributeMoves(axis, cellBoxes(cells), grid))
  }

  return { canAlign, canDistribute, alignCells, distributeCells }
}
