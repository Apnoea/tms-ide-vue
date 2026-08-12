import { computed, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useCanvas } from './useCanvas'
import { snapToGrid } from '../utils/grid'
import { projectToScreen } from '../utils/paperGeom'
import { isShapeResizable, resizeShapeCell, moveLineEnd } from '../stencils/shapeElement'

/**
 * Ресайз фигуры-разметки за ручки. HTML-overlay, а не хэндлы внутри ячейки (как у
 * шины): ручки нужны только выделенной фигуре, а рисовать их в её же DOM значило бы
 * показывать всем и тащить в экспорт.
 *
 * Тянем ГАБАРИТ, геометрия масштабируется под него (shapeElement.resizeShapeCell).
 * Противоположный край стоит на месте, снап — к сетке холста, минимум — один её шаг:
 * фигура нулевого размера неотличима от исчезнувшей.
 *
 * Повёрнутая фигура ручек не получает: `angle` живёт на outer-группе, и тянуть
 * габарит в экранных осях означало бы решать, что делать с поворотом — сначала
 * снимите поворот.
 */

const HANDLES = [
  { key: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { key: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { key: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { key: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { key: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { key: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { key: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { key: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
]
const HALF = 4 // половина ручки (8×8) — позиции считаем по её центру

export function useShapeResize({ scheduleSnapshot, dragging }) {
  const canvas = useCanvas()
  let drag = null
  // Пока тянем — позиции ручек считаем от «живого» габарита, а не от снимка.
  const resizeTick = ref(0)

  /** Ручки выделенной фигуры в экранных координатах (null — показывать нечего). */
  const shapeHandles = computed(() => {
    canvas.graphVersion.value
    canvas.paperViewTick.value
    resizeTick.value
    if (dragging?.value) return null
    const sel = canvas.selection.value
    if (sel.length !== 1 || sel[0].kind !== 'cell') return null
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return null
    const cell = graph.getCell(sel[0].id)
    if (!isShapeResizable(cell) || (cell.angle && cell.angle() % 360 !== 0)) return null
    const pos = cell.get('position')
    const size = cell.get('size')
    const shape = cell.get('tms')?.shape
    // У линии тянут концы, а не габарит: рамка вокруг наклонной прямой ничего не
    // задаёт, а направление держат ровно две точки.
    if (shape?.type === 'line') {
      return [
        { key: 'p1', x: shape.x1, y: shape.y1 },
        { key: 'p2', x: shape.x2, y: shape.y2 },
      ].map((e) => {
        const p = projectToScreen(paper, pos.x + e.x, pos.y + e.y)
        return {
          key: e.key,
          cursor: 'move',
          style: { left: `${p.x - HALF}px`, top: `${p.y - HALF}px` },
        }
      })
    }
    return HANDLES.map((h) => {
      const p = projectToScreen(paper, pos.x + size.width * h.fx, pos.y + size.height * h.fy)
      return {
        key: h.key,
        cursor: h.cursor,
        style: { left: `${p.x - HALF}px`, top: `${p.y - HALF}px` },
      }
    })
  })

  function onHandleDown(evt, key) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    const sel = canvas.selection.value
    if (!graph || !paper || sel.length !== 1) return
    const cell = graph.getCell(sel[0].id)
    if (!isShapeResizable(cell)) return
    evt.preventDefault()
    evt.stopPropagation()
    const pos = cell.get('position')
    const size = cell.get('size')
    drag = {
      cell,
      key,
      start: { x: pos.x, y: pos.y, width: size.width, height: size.height },
      changed: false,
    }
  }

  function onMove(evt) {
    if (!drag) return
    const paper = canvas.paperRef.value
    const grid = paper.options.gridSize || 5
    const p = paper.clientToLocalPoint(evt.clientX, evt.clientY)
    if (drag.key === 'p1' || drag.key === 'p2') {
      const point = { x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) }
      if (moveLineEnd(drag.cell, paper, drag.key, point)) {
        drag.changed = true
        resizeTick.value++
      }
      return
    }
    const s = drag.start
    // Тянем только те края, что входят в ручку: 'n' двигает верх, 'se' — правый и
    // низ. Противоположный край держим — иначе фигура «уплывала» бы из-под курсора.
    let left = s.x
    let top = s.y
    let right = s.x + s.width
    let bottom = s.y + s.height
    if (drag.key.includes('w')) left = snapToGrid(p.x, grid)
    if (drag.key.includes('e')) right = snapToGrid(p.x, grid)
    if (drag.key.includes('n')) top = snapToGrid(p.y, grid)
    if (drag.key.includes('s')) bottom = snapToGrid(p.y, grid)
    // Минимум — шаг сетки: нулевой габарит визуально равен исчезновению фигуры.
    const box = {
      x: Math.min(left, right - grid),
      y: Math.min(top, bottom - grid),
      width: Math.max(grid, right - left),
      height: Math.max(grid, bottom - top),
    }
    if (box.width === s.width && box.height === s.height && box.x === s.x && box.y === s.y) return
    if (resizeShapeCell(drag.cell, paper, box)) {
      drag.changed = true
      resizeTick.value++
    }
  }

  function onUp() {
    if (!drag) return
    const changed = drag.changed
    drag = null
    if (!changed) return
    // Один снимок на жест (move'ы шли без истории) + пометка «правки не в .zip».
    canvas.bumpVersion()
    canvas.markDirty()
    scheduleSnapshot()
  }

  useEventListener(document, 'pointermove', onMove)
  useEventListener(document, 'pointerup', onUp)

  return { shapeHandles, onHandleDown }
}
