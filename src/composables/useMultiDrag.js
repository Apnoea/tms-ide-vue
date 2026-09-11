import { useCanvas } from './useCanvas'
import { isFreeEnd } from '../stencils/linkDefaults'
import { snapToGrid } from '../utils/grid'
import { CANVAS_GRID } from '../stencils/canvasPaper'

/**
 * Multi-drag: JointJS двигает только ячейку, за которую взялись, поэтому остальных
 * выделенных сдвигаем программно из `change:position` ведущей. Хендлеры цепляет
 * CanvasPane (graph/paper рождаются в onMounted).
 */
export function useMultiDrag() {
  const canvas = useCanvas()

  // Не reactive: читается только из raw-хендлеров JointJS.
  let activeDragCellId = null
  let dragSnapshot = null
  // Снимок исходных изломов выделенных проводов, ОБА конца которых среди двигаемых
  // ячеек — двигаются жёстко вместе с группой (иначе маршрут остался бы на месте).
  let dragLinkSnapshot = null

  function prepareMultiDrag(cellId) {
    const graph = canvas.graphRef.value
    if (!canvas.isSelected(cellId) || canvas.selection.value.length < 2) {
      activeDragCellId = null
      dragSnapshot = null
      return
    }
    activeDragCellId = cellId
    dragSnapshot = {}
    dragLinkSnapshot = {}
    const cellIds = new Set()
    for (const item of canvas.selection.value) {
      if (item.kind !== 'cell') continue
      const c = graph?.getCell(item.id)
      if (c) {
        const p = c.get('position')
        dragSnapshot[item.id] = { x: p.x, y: p.y }
        cellIds.add(item.id)
      }
    }
    // Изломы выделенных проводов между двигаемыми ячейками (оба конца в наборе) —
    // сдвинутся жёстко вместе с группой. Если конец у неподвижной ячейки — не трогаем
    // (провод перестроится сам за портом).
    //
    // Свободный конец (точка на холсте) ни за чем не следует, поэтому его двигаем
    // сами: иначе перетаскивание выделения растягивало бы провод, а точка оставалась
    // на месте.
    for (const item of canvas.selection.value) {
      if (item.kind !== 'link') continue
      const l = graph?.getCell(item.id)
      if (!l) continue
      const source = l.get('source')
      const target = l.get('target')
      const moves = (end) => (end?.id ? cellIds.has(end.id) : isFreeEnd(end))
      if (!moves(source) || !moves(target)) continue
      const verts = l.get('vertices')
      dragLinkSnapshot[item.id] = {
        vertices: (verts || []).map((v) => ({ x: v.x, y: v.y })),
        source: isFreeEnd(source) ? { x: source.x, y: source.y } : null,
        target: isFreeEnd(target) ? { x: target.x, y: target.y } : null,
      }
    }
  }

  /** `opt.multiDrag` блокирует рекурсию при программном set('position') у соседей. */
  function onPositionChange(cell, newPos, opt) {
    const graph = canvas.graphRef.value
    if (opt?.multiDrag || opt?.uiNudge || !graph) return
    if (!activeDragCellId || cell.id !== activeDragCellId) return
    const start = dragSnapshot?.[cell.id]
    if (!start) return
    const dx = newPos.x - start.x
    const dy = newPos.y - start.y
    for (const item of canvas.selection.value) {
      if (item.id === activeDragCellId || item.kind !== 'cell') continue
      const startPos = dragSnapshot[item.id]
      const other = graph.getCell(item.id)
      // Заблокированную ячейку не двигаем даже в группе (multi-drag программный,
      // в обход paper.interactive — иначе замок обошёлся бы).
      if (other && startPos && !other.get('tms')?.locked) {
        other.set('position', { x: startPos.x + dx, y: startPos.y + dy }, { multiDrag: true })
      }
    }
    // Изломы и свободные концы проводов, целиком принадлежащих группе — тем же delta
    // от исходных (без дрейфа) и СО СНАПОМ к сетке: исходные точки могли стоять криво
    // (прежние формы), и конец провода уехал бы с сетки. vertexSnap гасит снап-хендлер
    // изломов: снапим здесь.
    const g = canvas.paperRef.value?.options?.gridSize || CANVAS_GRID
    const shifted = (v) => ({ x: snapToGrid(v.x + dx, g), y: snapToGrid(v.y + dy, g) })
    for (const linkId in dragLinkSnapshot) {
      const link = graph.getCell(linkId)
      if (!link) continue
      const snap = dragLinkSnapshot[linkId]
      if (snap.vertices.length) {
        link.vertices(snap.vertices.map(shifted), { vertexSnap: true })
      }
      for (const end of ['source', 'target']) {
        const start = snap[end]
        if (start) link.set(end, shifted(start), { multiDrag: true })
      }
    }
  }

  function endMultiDrag() {
    activeDragCellId = null
    dragSnapshot = null
    dragLinkSnapshot = null
  }

  /** «Идёт multi-drag» — hover-tooltip подавляется на время жеста. */
  function isMultiDragging() {
    return !!activeDragCellId
  }

  return { prepareMultiDrag, onPositionChange, endMultiDrag, isMultiDragging }
}
