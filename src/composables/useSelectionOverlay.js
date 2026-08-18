import { computed } from 'vue'
import { useCanvas } from './useCanvas'
import { getStencilById, registryVersion } from '../stencils/registry'
import { isShapeCell } from '../stencils/shapeElement'
import { injectStencilSvg, buildPortItems } from '../stencils/svgInjector'
import { projectToScreen, rotatedAabb } from '../utils/paperGeom'

/**
 * HTML-overlay одиночной выделенной ячейки: rotate/delete/lock по углам visual-AABB
 * и flip на серединах сторон. Не JointJS elementTools — те кэшируют bbox при
 * addTools и не следуют за resize. Что доступно — решают `canCellRotate` (noRotate,
 * замок, из фигур только подпись) и `canCellFlip` (только символы).
 */
export function useSelectionOverlay({ scheduleSnapshot, textEditing, dragging }) {
  const canvas = useCanvas()

  /**
   * Поворот. Заблокированную (`tms.locked`) не вращаем, noRotate-стенсилы — тоже.
   * Из фигур-разметки поворачивается только ПОДПИСЬ: у остальных ручки ресайза тянут
   * габарит в экранных осях, и поворот пришлось бы в них учитывать, а у подписи
   * ручек нет (её габарит задаёт шрифт).
   */
  function canCellRotate(cell) {
    if (!cell || cell.get('tms')?.locked) return false
    if (isShapeCell(cell)) return cell.get('tms')?.shape?.type === 'text'
    return !getStencilById(cell.get('tms')?.stencilId)?.noRotate
  }

  /**
   * Отражение — только символы: оно зеркалит их SVG и позиции портов, а у фигуры ни
   * того, ни другого нет (кнопка была бы мёртвой).
   */
  function canCellFlip(cell) {
    return canCellRotate(cell) && !isShapeCell(cell)
  }

  const overlayBtns = computed(() => {
    canvas.graphVersion.value
    canvas.paperViewTick.value
    // Флаги символа (`noRotate`) читаются из реестра, а он меняется при правке символа
    // в редакторе — без этой зависимости кнопки у уже выделенной ячейки остались бы
    // прежними до следующего изменения графа.
    registryVersion.value
    // Прячем на время drag'а ячейки: bumpVersion в drag-окне подавлен, поэтому
    // кнопки иначе замерли бы на старом месте. Флаг реактивный — computed
    // пересчитывается на старте/конце drag'а (не на каждый mousemove).
    if (dragging?.value) return null
    const sel = canvas.selection.value
    if (sel.length !== 1 || sel[0].kind !== 'cell') return null
    if (textEditing.value) return null
    const paper = canvas.paperRef.value
    const graph = canvas.graphRef.value
    if (!paper || !graph) return null
    const cell = graph.getCell(sel[0].id)
    if (!cell) return null
    // Углы visual-AABB (с учётом поворота) в экранных координатах.
    const aabb = rotatedAabb(cell.get('position'), cell.get('size'), cell.angle() || 0)
    const tl = projectToScreen(paper, aabb.x, aabb.y)
    const br = projectToScreen(paper, aabb.x + aabb.width, aabb.y + aabb.height)
    const { x: left, y: top } = tl
    const { x: right, y: bottom } = br
    const HALF = 16 // половина кнопки (32×32) — позиции считаем по её центру
    // Кнопка крупнее мелкого символа (20×20), поэтому зазор заметный: иначе
    // кнопки наползают на соседей и клик по соседу попадает в них.
    const GAP = 24
    return {
      id: cell.id,
      canRotate: canCellRotate(cell),
      canFlip: canCellFlip(cell),
      locked: !!cell.get('tms')?.locked,
      rotateCcw: { left: `${left - GAP - HALF}px`, top: `${top - GAP - HALF}px` },
      rotateCw: { left: `${right + GAP - HALF}px`, top: `${top - GAP - HALF}px` },
      delete: { left: `${right + GAP - HALF}px`, top: `${bottom + GAP - HALF}px` },
      // Замок — нижний-левый угол; кнопка видна всегда (единственный способ снять
      // блокировку при read-only остальных).
      lock: { left: `${left - GAP - HALF}px`, top: `${bottom + GAP - HALF}px` },
      // Flip — на серединах сторон: горизонтальный (лево↔право) сверху по центру,
      // вертикальный (верх↔низ) слева по центру.
      flipH: { left: `${(left + right) / 2 - HALF}px`, top: `${top - GAP - HALF}px` },
      flipV: { left: `${left - GAP - HALF}px`, top: `${(top + bottom) / 2 - HALF}px` },
    }
  })

  function rotateSelectedBy(delta) {
    const graph = canvas.graphRef.value
    if (!graph) return
    const sel = canvas.selection.value.filter((s) => s.kind === 'cell')
    let changed = false
    for (const item of sel) {
      const cell = graph.getCell(item.id)
      if (!canCellRotate(cell)) continue
      cell.rotate(delta)
      changed = true
    }
    if (changed) scheduleSnapshot()
  }

  /**
   * Отражение по оси ('h'/'v'): тоггл tms.flipH/flipV + пересчёт портов (провода
   * идут за ними) + перерисовка визуала. false-флаги не храним. noRotate/locked
   * пропускаем.
   */
  function flipSelected(axis) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph) return
    const sel = canvas.selection.value.filter((s) => s.kind === 'cell')
    let changed = false
    for (const item of sel) {
      const cell = graph.getCell(item.id)
      if (!canCellFlip(cell)) continue
      const stencil = getStencilById(cell.get('tms')?.stencilId)
      if (!stencil) continue
      const tms = cell.get('tms') || {}
      const next = { ...tms }
      // axis — ЭКРАННАЯ ось кнопки, а flipH/flipV хранятся в локальных координатах:
      // при 90/270° оси повёрнуты, поэтому маппим экранную ось на локальную.
      const angle = (cell.angle() || 0) % 360
      const swap = angle === 90 || angle === 270
      const localAxis = swap ? (axis === 'h' ? 'v' : 'h') : axis
      if (localAxis === 'h') next.flipH = !tms.flipH
      else next.flipV = !tms.flipV
      if (!next.flipH) delete next.flipH
      if (!next.flipV) delete next.flipV
      cell.set('tms', next)
      const size = cell.get('size')
      cell.prop(
        'ports/items',
        buildPortItems(stencil, size.width, size.height, {
          flipH: !!next.flipH,
          flipV: !!next.flipV,
        })
      )
      const view = paper?.findViewByModel(cell)
      if (view) injectStencilSvg(view, stencil)
      changed = true
    }
    if (changed) scheduleSnapshot()
  }

  function onDeleteSelected() {
    const sel = canvas.selection.value
    if (sel.length !== 1 || sel[0].kind !== 'cell') return
    canvas.deleteItems(sel)
  }

  function toggleLockSelected() {
    canvas.toggleLocked(canvas.selection.value)
  }

  return { overlayBtns, rotateSelectedBy, flipSelected, onDeleteSelected, toggleLockSelected }
}
