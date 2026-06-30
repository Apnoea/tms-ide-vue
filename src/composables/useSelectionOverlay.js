import { computed } from 'vue'
import { useCanvas } from './useCanvas'
import { getStencilById } from '../stencils/registry'
import { projectToScreen } from '../utils/paperGeom'

/**
 * HTML-overlay одиночной выделенной ячейки: кнопки rotate-ccw / rotate-cw /
 * delete по углам visual-AABB (с учётом rotation: при 90/270° w/h меняются
 * местами, центр прежний). Позиция reactive через graphVersion + paperViewTick +
 * selection. HTML-overlay, а не JointJS elementTools — те кэшируют bbox при
 * addTools и не следуют за resize. rotate скрыт для noRotate-стенсилов
 * (cell_text / cell_value / cell_bus) — `canCellTransform`.
 */
export function useSelectionOverlay({ scheduleSnapshot, textEditing }) {
  const canvas = useCanvas()

  function canCellTransform(cell) {
    return cell && !getStencilById(cell.get('tms')?.stencilId)?.noRotate
  }

  const overlayBtns = computed(() => {
    canvas.graphVersion.value
    canvas.paperViewTick.value
    const sel = canvas.selection.value
    if (sel.length !== 1 || sel[0].kind !== 'cell') return null
    if (textEditing.value) return null
    const paper = canvas.paperRef.value
    const graph = canvas.graphRef.value
    if (!paper || !graph) return null
    const cell = graph.getCell(sel[0].id)
    if (!cell) return null
    const pos = cell.get('position')
    const size = cell.get('size')
    const angle = (cell.angle() || 0) % 360
    const rot90 = angle === 90 || angle === 270
    const bbW = rot90 ? size.height : size.width
    const bbH = rot90 ? size.width : size.height
    const cx = pos.x + size.width / 2
    const cy = pos.y + size.height / 2
    // Углы visual-AABB в экранных координатах.
    const tl = projectToScreen(paper, cx - bbW / 2, cy - bbH / 2)
    const br = projectToScreen(paper, cx + bbW / 2, cy + bbH / 2)
    const { x: left, y: top } = tl
    const { x: right, y: bottom } = br
    const HALF = 16
    const GAP = 10
    return {
      id: cell.id,
      canTransform: canCellTransform(cell),
      rotateCcw: { left: `${left - GAP - HALF}px`, top: `${top - GAP - HALF}px` },
      rotateCw: { left: `${right + GAP - HALF}px`, top: `${top - GAP - HALF}px` },
      delete: { left: `${right + GAP - HALF}px`, top: `${bottom + GAP - HALF}px` },
    }
  })

  function rotateSelectedBy(delta) {
    const graph = canvas.graphRef.value
    if (!graph) return
    const sel = canvas.selection.value.filter((s) => s.kind === 'cell')
    let changed = false
    for (const item of sel) {
      const cell = graph.getCell(item.id)
      if (!canCellTransform(cell)) continue
      cell.rotate(delta)
      changed = true
    }
    if (changed) scheduleSnapshot()
  }

  function onDeleteSelected() {
    const sel = canvas.selection.value
    if (sel.length !== 1 || sel[0].kind !== 'cell') return
    canvas.deleteItems(sel)
  }

  return { overlayBtns, rotateSelectedBy, onDeleteSelected }
}
