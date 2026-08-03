import { computed } from 'vue'
import { useCanvas } from './useCanvas'
import { getStencilById } from '../stencils/registry'
import { injectStencilSvg, buildPortItems } from '../stencils/svgInjector'
import { projectToScreen, rotatedAabb } from '../utils/paperGeom'

/**
 * HTML-overlay одиночной выделенной ячейки: кнопки по углам/серединам сторон
 * visual-AABB — rotate-ccw/cw + delete + lock (углы) и flip-H/flip-V (середины
 * верхней/левой сторон). Учитывает rotation (при 90/270° w/h меняются местами,
 * центр прежний). Позиция reactive через graphVersion + paperViewTick + selection.
 * HTML-overlay, а не JointJS elementTools — те кэшируют bbox при addTools и не
 * следуют за resize. rotate/flip скрыты для noRotate-стенсилов (`canCellTransform`).
 */
export function useSelectionOverlay({ scheduleSnapshot, textEditing, dragging }) {
  const canvas = useCanvas()

  function canCellTransform(cell) {
    // Заблокированную (`tms.locked`) не вращаем; noRotate-стенсилы — тоже.
    return cell && !cell.get('tms')?.locked && !getStencilById(cell.get('tms')?.stencilId)?.noRotate
  }

  const overlayBtns = computed(() => {
    canvas.graphVersion.value
    canvas.paperViewTick.value
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
      canTransform: canCellTransform(cell),
      locked: !!cell.get('tms')?.locked,
      rotateCcw: { left: `${left - GAP - HALF}px`, top: `${top - GAP - HALF}px` },
      rotateCw: { left: `${right + GAP - HALF}px`, top: `${top - GAP - HALF}px` },
      delete: { left: `${right + GAP - HALF}px`, top: `${bottom + GAP - HALF}px` },
      // Замок — нижний-левый угол; кнопка видна всегда (единственный способ снять
      // блокировку при read-only остальных).
      lock: { left: `${left - GAP - HALF}px`, top: `${bottom + GAP - HALF}px` },
      // Flip — на серединах сторон: горизонтальный (лево↔право) сверху по центру,
      // вертикальный (верх↔низ) слева по центру. Видны при canTransform (как rotate).
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
      if (!canCellTransform(cell)) continue
      cell.rotate(delta)
      changed = true
    }
    if (changed) scheduleSnapshot()
  }

  /**
   * Отражает выделенные ячейки по оси ('h' / 'v'): тоггл tms.flipH/flipV +
   * пересчёт позиций портов (провода следуют за портами) + перерисовка визуала
   * (transform на body). false-флаги не храним — round-trip пишет flip только при
   * true. noRotate/locked пропускаем (canCellTransform).
   */
  function flipSelected(axis) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph) return
    const sel = canvas.selection.value.filter((s) => s.kind === 'cell')
    let changed = false
    for (const item of sel) {
      const cell = graph.getCell(item.id)
      if (!canCellTransform(cell)) continue
      const stencil = getStencilById(cell.get('tms')?.stencilId)
      if (!stencil) continue
      const tms = cell.get('tms') || {}
      const next = { ...tms }
      // axis — ЭКРАННАЯ ось кнопки. flipH/flipV хранятся в локальных координатах
      // символа; при повороте на 90/270° локальные оси повёрнуты, поэтому экранную
      // ось маппим на локальную — иначе «горизонтально»/«вертикально» менялись бы
      // местами относительно того, что видит пользователь.
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
