import { computed } from 'vue'
import { useCanvas } from './useCanvas'
import { getStencilById, registryVersion } from '../stencils/registry'
import {
  isShapeCell,
  rotateShapeCells,
  flipShapeCells,
  canRotateShapeGeometry,
  canFlipShapeGeometry,
} from '../stencils/shapeElement'
import { injectStencilSvg, buildPortItems } from '../stencils/svgInjector'
import { projectToScreen, rotatedAabb, overlayButtonPositions } from '../utils/paperGeom'

/**
 * HTML-overlay одиночной выделенной ячейки: rotate/delete/lock по углам visual-AABB
 * и flip на серединах сторон. Не JointJS elementTools — те кэшируют bbox при
 * addTools и не следуют за resize. Что доступно — решают `canCellRotate` и
 * `canCellFlip` (замок, noRotate, а у фигур — меняет ли операция картинку).
 */
export function useSelectionOverlay({ scheduleSnapshot, textEditing, dragging }) {
  const canvas = useCanvas()

  /**
   * Поворот. Заблокированную (`tms.locked`) не вращаем, noRotate-стенсилы — тоже.
   * У фигуры-разметки поворачивается ГЕОМЕТРИЯ (`rotateShapeCells`), поэтому габарит
   * остаётся в модельных осях и ручки ресайза продолжают работать; исключение —
   * ПОДПИСЬ: её глифы горизонтальны, поворот геометрии дал бы просто перенос точки
   * привязки, поэтому её вращает `angle` ячейки. Симметричной фигуре (круг, квадрат)
   * кнопку не показываем — операция ничего не изменит.
   */
  function canCellRotate(cell) {
    if (!cell || cell.get('tms')?.locked) return false
    if (isShapeCell(cell)) {
      return cell.get('tms')?.shape?.type === 'text' || canRotateShapeGeometry(cell)
    }
    return !getStencilById(cell.get('tms')?.stencilId)?.noRotate
  }

  /**
   * Отражение по оси. У символа оно зеркалит SVG и позиции портов (`tms.flipH/flipV`),
   * у фигуры — саму геометрию, и там же решается, есть ли смысл: прямоугольник и
   * ортогональная линия отражением не меняются.
   */
  function canCellFlip(cell, axis) {
    if (!cell || cell.get('tms')?.locked) return false
    if (isShapeCell(cell)) return canFlipShapeGeometry(cell, axis)
    return !getStencilById(cell.get('tms')?.stencilId)?.noRotate
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
    return {
      id: cell.id,
      canRotate: canCellRotate(cell),
      canFlipH: canCellFlip(cell, 'h'),
      canFlipV: canCellFlip(cell, 'v'),
      // Замок виден всегда — им же снимают блокировку, когда остальное read-only.
      locked: !!cell.get('tms')?.locked,
      ...overlayButtonPositions({ left: tl.x, top: tl.y, right: br.x, bottom: br.y }),
    }
  })

  function rotateSelectedBy(delta) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph) return
    const sel = canvas.selection.value.filter((s) => s.kind === 'cell')
    let changed = false
    // Фигуры (кроме подписи) поворачиваем геометрией — одной операцией на пачку.
    const geometryIds = sel
      .map((item) => graph.getCell(item.id))
      .filter((cell) => canRotateShapeGeometry(cell))
      .map((cell) => cell.id)
    if (geometryIds.length) {
      changed = rotateShapeCells(graph, paper, geometryIds, delta < 0 ? -1 : 1) > 0
    }
    const geometrySet = new Set(geometryIds)
    for (const item of sel) {
      const cell = graph.getCell(item.id)
      if (geometrySet.has(item.id) || !canCellRotate(cell)) continue
      cell.rotate(delta)
      changed = true
    }
    if (changed) {
      canvas.bumpVersion()
      scheduleSnapshot()
    }
  }

  /**
   * Отражение по оси ('h'/'v'). У СИМВОЛА — тоггл tms.flipH/flipV + пересчёт портов
   * (провода идут за ними) + перерисовка визуала; false-флаги не храним. У ФИГУРЫ
   * зеркалится сама геометрия (`flipShapeCells`) — ни SVG-обёртки, ни портов у неё
   * нет, а у подписи заодно инвертируется якорь роста. noRotate/locked пропускаем.
   */
  function flipSelected(axis) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph) return
    const sel = canvas.selection.value.filter((s) => s.kind === 'cell')
    let changed = false
    const shapeIds = sel
      .map((item) => graph.getCell(item.id))
      .filter((cell) => canFlipShapeGeometry(cell, axis))
      .map((cell) => cell.id)
    if (shapeIds.length) {
      changed = flipShapeCells(graph, paper, shapeIds, axis) > 0
    }
    for (const item of sel) {
      const cell = graph.getCell(item.id)
      if (isShapeCell(cell) || !canCellFlip(cell, axis)) continue
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
    if (changed) {
      canvas.bumpVersion()
      scheduleSnapshot()
    }
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
