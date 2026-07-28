import { useCanvas } from './useCanvas'

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
    for (const item of canvas.selection.value) {
      if (item.kind !== 'link') continue
      const l = graph?.getCell(item.id)
      const verts = l?.get('vertices')
      if (!verts?.length) continue
      if (cellIds.has(l.get('source')?.id) && cellIds.has(l.get('target')?.id)) {
        dragLinkSnapshot[item.id] = verts.map((v) => ({ x: v.x, y: v.y }))
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
    // Изломы проводов между двигаемыми ячейками — тем же delta (от исходных, без
    // дрейфа). vertexSnap гасит снап-хендлер: delta кратен сетке (края на сетке).
    for (const linkId in dragLinkSnapshot) {
      const link = graph.getCell(linkId)
      if (!link) continue
      const shifted = dragLinkSnapshot[linkId].map((v) => ({ x: v.x + dx, y: v.y + dy }))
      link.vertices(shifted, { vertexSnap: true })
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
