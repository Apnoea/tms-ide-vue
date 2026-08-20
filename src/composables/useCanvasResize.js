import { computed, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useCanvas } from './useCanvas'
import { snapToGrid } from '../utils/grid'
import { projectToScreen, rotatePoint } from '../utils/paperGeom'
import { isShapeResizable, resizeShapeCell, moveShapePoint } from '../stencils/shapeElement'
import {
  scalableStencil,
  applyStencilScale,
  scaledSize,
  STENCIL_SCALE_MAX,
} from '../stencils/svgInjector'

/**
 * Ресайз за ручки на холсте: фигуры-разметки и символов с растяжимой шириной.
 * HTML-overlay, а не хэндлы внутри ячейки (как у шины): ручки нужны только
 * выделенному, а рисовать их в его же DOM значило бы показывать всем и тащить в
 * экспорт.
 *
 * Прямоугольник и эллипс тянут за ГАБАРИТ — геометрия масштабируется под него
 * (`resizeShapeCell`), противоположный край стоит на месте, минимум — шаг сетки
 * (фигура нулевого размера неотличима от исчезнувшей). Линия и ломаная правятся ПО
 * ТОЧКАМ (`moveShapePoint`): ручка на каждой вершине, как в редакторе символов.
 *
 * Символы масштабируются ПРОПОРЦИОНАЛЬНО за УГЛОВЫЕ ручки: рисунок не
 * перерисовывается, растягивается трансформом, а порты пересчитываются от размера
 * (`applyStencilScale`). Боковых ручек у них нет — растяжение по одной оси для
 * SCADA-символа бессмысленно (разъединитель, растянутый по горизонтали, читается как
 * ошибка). Ниже родного размера не уменьшаем: порты сошлись бы в одну клетку.
 *
 * Повёрнутый СИМВОЛ масштабируется наравне с прямым: масштаб один на обе оси, поэтому
 * достаточно повернуть вектор жеста на −angle, а ручки поставить на визуальные углы
 * (`rotatePoint`). Позицию при этом считаем от ВИЗУАЛЬНОГО якоря: поворот идёт вокруг
 * центра, центр при смене размера уезжает, и без компенсации символ уползал бы из-под
 * курсора. ФИГУРА повёрнутой ручек не получает — там ручки тянут две оси независимо, а
 * геометрия живёт в локальных координатах: сначала снимите поворот.
 */

const HANDLES = [
  { key: 'nw', fx: 0, fy: 0 },
  { key: 'n', fx: 0.5, fy: 0 },
  { key: 'ne', fx: 1, fy: 0 },
  { key: 'e', fx: 1, fy: 0.5 },
  { key: 'se', fx: 1, fy: 1 },
  { key: 's', fx: 0.5, fy: 1 },
  { key: 'sw', fx: 0, fy: 1 },
  { key: 'w', fx: 0, fy: 0.5 },
]

// Курсоры по секторам 45°: направление ручки от центра + поворот ячейки. Держать
// курсор в самой ручке нельзя — у повёрнутого символа диагонали меняются местами, и
// «nwse» на верхнем-правом углу показывал бы растяжение не в ту сторону.
const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']

function handleCursor(handle, angle) {
  const deg = (Math.atan2(handle.fy - 0.5, handle.fx - 0.5) * 180) / Math.PI + (angle || 0)
  const sector = Math.round((((deg % 180) + 180) % 180) / 45) % 4
  return CURSORS[sector]
}
// Пропорциональный масштаб символа тянут только углы: боковая ручка означала бы
// растяжение по одной оси.
const CORNER_HANDLES = HANDLES.filter((h) => h.fx !== 0.5 && h.fy !== 0.5)
const HALF = 4 // половина ручки (8×8) — позиции считаем по её центру

/**
 * Позиция ячейки, при которой ВИЗУАЛЬНОЕ место локального угла (`fx`/`fy` — доли
 * габарита) совпадёт с `anchor`. Из `visual = pos + size/2 + R(angle)·d`, где
 * `d` — вектор от центра к углу: `pos = anchor − size/2 − R(angle)·d`.
 *
 * Результат снапим к сетке — позиция ячейки обязана стоять на клетках; визуальный
 * якорь при этом отходит меньше чем на половину клетки.
 */
function positionForAnchor(anchor, size, angle, handle, grid) {
  const d = { x: (handle.fx - 0.5) * size.width, y: (handle.fy - 0.5) * size.height }
  const r = rotatePoint(d, { x: 0, y: 0 }, angle)
  return {
    x: snapToGrid(anchor.x - size.width / 2 - r.x, grid),
    y: snapToGrid(anchor.y - size.height / 2 - r.y, grid),
  }
}

export function useCanvasResize({ scheduleSnapshot, dragging }) {
  const canvas = useCanvas()
  let drag = null
  // Пока тянем — позиции ручек считаем от «живого» габарита, а не от снимка.
  const resizeTick = ref(0)

  /** Ручки выделенного в экранных координатах (null — показывать нечего). */
  const resizeHandles = computed(() => {
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
    if (!cell) return null
    const angle = cell.angle ? cell.angle() : 0
    const shapeMode = isShapeResizable(cell)
    const scaleMode = !shapeMode && !!scalableStencil(cell)
    if (!shapeMode && !scaleMode) return null
    // Поворот масштабу символа не мешает (ручки едут на визуальные углы), а вот
    // габаритным ручкам фигуры и ширине карточки — мешает.
    if (angle % 360 !== 0 && !scaleMode) return null
    const pos = cell.get('position')
    const size = cell.get('size')
    const shape = cell.get('tms')?.shape
    // Линию и ломаную правят ПО ТОЧКАМ (как в редакторе символов): рамка вокруг
    // наклонной прямой или ломаной ничего не задаёт, форму держат сами вершины.
    const points =
      shape?.type === 'line'
        ? [
            { key: 'p1', x: shape.x1, y: shape.y1 },
            { key: 'p2', x: shape.x2, y: shape.y2 },
          ]
        : shape?.type === 'polyline'
          ? shape.points.map(([x, y], i) => ({ key: `v${i}`, x, y }))
          : null
    if (points) {
      return points.map((e) => {
        const p = projectToScreen(paper, pos.x + e.x, pos.y + e.y)
        return {
          key: e.key,
          cursor: 'move',
          style: { left: `${p.x - HALF}px`, top: `${p.y - HALF}px` },
        }
      })
    }
    const handles = scaleMode ? CORNER_HANDLES : HANDLES
    const center = { x: pos.x + size.width / 2, y: pos.y + size.height / 2 }
    return handles.map((h) => {
      const corner = rotatePoint(
        { x: pos.x + size.width * h.fx, y: pos.y + size.height * h.fy },
        center,
        angle
      )
      const p = projectToScreen(paper, corner.x, corner.y)
      return {
        key: h.key,
        cursor: handleCursor(h, angle),
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
    const shapeMode = isShapeResizable(cell)
    const stencil = shapeMode ? null : scalableStencil(cell)
    if (!shapeMode && !stencil) return
    evt.preventDefault()
    evt.stopPropagation()
    const pos = cell.get('position')
    const size = cell.get('size')
    const angle = cell.angle ? cell.angle() : 0
    // Якорь жеста — противоположный тянутому угол, В ВИЗУАЛЬНЫХ координатах: он стоит
    // на месте весь жест, и от него считаются и масштаб, и новая позиция.
    const opposite = HANDLES.find(
      (h) => h.fx === (key.includes('w') ? 1 : 0) && h.fy === (key.includes('n') ? 1 : 0)
    )
    drag = {
      cell,
      key,
      // Режим фиксируем на старте: ключи ручек у обоих одни, а правят они разное —
      // габарит фигуры против пропорционального масштаба символа.
      mode: shapeMode ? 'shape' : 'scale',
      stencil,
      angle,
      anchorHandle: opposite,
      anchor:
        stencil && opposite
          ? rotatePoint(
              { x: pos.x + size.width * opposite.fx, y: pos.y + size.height * opposite.fy },
              { x: pos.x + size.width / 2, y: pos.y + size.height / 2 },
              angle
            )
          : null,
      start: { x: pos.x, y: pos.y, width: size.width, height: size.height },
      changed: false,
    }
  }

  function onMove(evt) {
    if (!drag) return
    const paper = canvas.paperRef.value
    const grid = paper.options.gridSize || 5
    const p = paper.clientToLocalPoint(evt.clientX, evt.clientY)
    if (drag.mode === 'scale') {
      const stencil = drag.stencil
      const handle = HANDLES.find((h) => h.key === drag.key)
      if (!drag.anchor || !handle) return
      // Курсор в локальных осях символа: поворот вектора «курсор − якорь» на −angle.
      // Масштаб один на обе оси, поэтому «ведущей» осью считаем ту, куда курсор ушёл
      // дальше — иначе диагональный жест почти не двигал бы символ.
      const v = rotatePoint(
        { x: p.x - drag.anchor.x, y: p.y - drag.anchor.y },
        { x: 0, y: 0 },
        -drag.angle
      )
      const k = Math.max(Math.abs(v.x) / stencil.width, Math.abs(v.y) / stencil.height)
      const scale = Math.min(Math.max(1, k), STENCIL_SCALE_MAX)
      const target = scaledSize(stencil, scale)
      const position = positionForAnchor(drag.anchor, target, drag.angle, drag.anchorHandle, grid)
      if (applyStencilScale(drag.cell, paper, scale, { position })) {
        drag.changed = true
        resizeTick.value++
      }
      return
    }
    // Ручка точки (конец линии / вершина ломаной) — двигаем её, не габарит.
    if (drag.key === 'p1' || drag.key === 'p2' || drag.key.startsWith('v')) {
      const point = { x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) }
      if (moveShapePoint(drag.cell, paper, drag.key, point)) {
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

  return { resizeHandles, onHandleDown }
}
