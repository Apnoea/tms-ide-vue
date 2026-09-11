import { shallowRef } from 'vue'
import { useCanvas } from './useCanvas'
import { guideCandidates, findGuides } from '../utils/snapGuides'
import { projectToScreen, rotatedAabb } from '../utils/paperGeom'
import { portPoints } from '../utils/portGeom'
import { snapToGrid } from '../utils/grid'
import { CANVAS_GRID } from '../stencils/canvasPaper'

/**
 * Направляющие при перетаскивании ячеек: пока символ едет, его края, центр и порты
 * сравниваются с линиями остальных элементов, и на почти-совпадении набор притягивается
 * к линии (она же рисуется поверх холста).
 *
 * Корректируем позицию ВЕДУЩЕЙ ячейки: остальных выделенных сдвигает `useMultiDrag` от
 * снимка на каждый `change:position`, поэтому правка ведущей доезжает до всего набора.
 * Приходит она уже после снапа JointJS к сетке и перебивает его по той оси, где нашлась
 * направляющая, но только если позиция ведущей остаётся на сетке (см. updateGuides).
 *
 * Кандидаты собираются ОДИН раз на начало жеста: соседи не двигаются, а на форме их
 * сотни. Порты двигаемого берём только у одиночной ячейки — у набора это десятки линий
 * сразу, и подсказка превращается в шум.
 */

/** Порог притяжения в ЭКРАННЫХ px: на зуме 300% модельные дали бы полклетки. */
const SNAP_PX = 6

export function useSnapGuides() {
  const canvas = useCanvas()
  /**
   * Линии для отрисовки в container-px: `[{ x1, y1, x2, y2 }]`. `shallowRef` — список
   * пересобирается целиком на каждый шаг жеста (десятки раз в секунду), и глубокие
   * прокси на нём только мешают.
   */
  const guideLines = shallowRef([])

  let candidates = null
  let movingIds = null

  /** Габарит с учётом поворота: направляющая обещает то, что видно. */
  function boxOf(cell, withPorts) {
    const aabb = rotatedAabb(cell.get('position'), cell.get('size'), cell.angle?.() || 0)
    return withPorts ? { ...aabb, ports: portPoints(cell) } : aabb
  }

  /** Габарит всего двигаемого набора — по нему считаются края и центр. */
  function movingBox(graph) {
    const cells = movingIds.map((id) => graph.getCell(id)).filter(Boolean)
    if (!cells.length) return null
    if (cells.length === 1) return boxOf(cells[0], true)
    const boxes = cells.map((c) => boxOf(c, false))
    const x = Math.min(...boxes.map((b) => b.x))
    const y = Math.min(...boxes.map((b) => b.y))
    return {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    }
  }

  /** Начало жеста: запоминаем, что двигается. Линии соседей — при первом сдвиге. */
  function beginGuides(leadId) {
    candidates = null
    movingIds = null
    // Запертые ячейки не двигаются (их пропускает и multi-drag), поэтому в габарит
    // набора не входят: иначе край считался бы по тому, что стоит на месте. Запертая
    // ВЕДУЩАЯ отменяет жест целиком — `element:pointermove` приходит и на неё, хотя
    // JointJS её не двигает, и притяжение сдвинуло бы запертый символ.
    const selected = canvas
      .writableItems(canvas.selection.value.filter((i) => i.kind === 'cell'))
      .map((c) => c.id)
    if (selected.includes(leadId)) {
      movingIds = selected
      return
    }
    if (canvas.writableItems([{ kind: 'cell', id: leadId }]).length) movingIds = [leadId]
  }

  /** Шаг жеста: притянуть ведущую к линии и обновить подсказки. Alt — без притяжения. */
  function updateGuides(leadCell, evt) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!movingIds || !graph || !paper || !leadCell) return
    if (evt?.altKey) {
      guideLines.value = []
      return
    }
    // Соседей снимаем при первом сдвиге, а не на pointerdown: клик без перетаскивания
    // самое частое действие, а обход графа с портами ему не нужен.
    if (!candidates) {
      const moving = new Set(movingIds)
      const others = graph.getElements().filter((c) => !moving.has(c.id))
      candidates = guideCandidates(others.map((c) => boxOf(c, true)))
    }
    const box = movingBox(graph)
    if (!box) return
    // Притяжение не должно увозить ведущую с сетки: порты стоят на клетках относительно
    // позиции, и некратная позиция даёт наклонный сегмент провода у порта (роутер
    // снапит маршрут, конец — нет). Центр соседа с габаритом 25, край с некратной
    // шириной или сосед, стоящий криво, дают именно такой сдвиг — его отбрасываем.
    const grid = paper.options?.gridSize || CANVAS_GRID
    const pos = leadCell.get('position')
    const keepsGrid = (axis, delta) => {
      const v = (axis === 'x' ? pos.x : pos.y) + delta
      return snapToGrid(v, grid) === v
    }
    const { dx, dy, lines } = findGuides(
      box,
      candidates,
      SNAP_PX / (paper.scale().sx || 1),
      keepsGrid
    )
    if (dx || dy) leadCell.position(pos.x + dx, pos.y + dy)
    guideLines.value = lines.map((line) => {
      const vertical = line.axis === 'x'
      const a = projectToScreen(paper, vertical ? line.v : line.from, vertical ? line.from : line.v)
      const b = projectToScreen(paper, vertical ? line.v : line.to, vertical ? line.to : line.v)
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
    })
  }

  function endGuides() {
    candidates = null
    movingIds = null
    guideLines.value = []
  }

  return { guideLines, beginGuides, updateGuides, endGuides }
}
