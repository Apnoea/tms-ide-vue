import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useCanvas } from './useCanvas'
import { useUiStore } from '../stores/useUiStore'
import { snapToGrid } from '../utils/grid'
import { materializeShape, dedupeAdjacent } from '../stencils/shapeElement'
import { TEXT_FONT_SIZE } from '../stencils/textCell'

/**
 * Рисование фигур-разметки на холсте теми же жестами, что в редакторе символов:
 * rect/эллипс/линия тянутся drag'ом, ломаная набирается кликами и замыкается кликом у
 * стартовой вершины, подпись ставится одним кликом (габарит задаёт шрифт).
 *
 * Модель у фигур своя (`tms.Shape`, stencils/shapeElement), поэтому это отдельный
 * композабл, а не ветка usePaletteDrag с ячейками-символами.
 *
 * pointerdown слушается в capture-фазе: рисовать нужно и поверх существующих символов
 * (рамка вокруг группы), а JointJS иначе начнёт drag ячейки.
 */

// Стиль новой фигуры: разметка контурная, заливки и скругления нет.
const DRAW_DEFAULTS = { stroke: '#000', strokeWidth: 2 }
// Порог «клик, а не протяжка» в ЭКРАННЫХ px, как у лассо: одинаков на любом зуме.
const DRAG_THRESHOLD = 3
// Клик рядом с вершиной: по стартовой — замкнуть в полигон, по последней — закончить.
const CLOSE_THRESHOLD = 10

export function useCanvasDraw(paperContainer, { scheduleSnapshot }) {
  const canvas = useCanvas()
  const ui = useUiStore()

  // Превью в координатах контейнера (рисует overlay-SVG в CanvasPane):
  // { type, x, y, w, h } для рамки, { type: 'line'|'polyline', points } для линий.
  const drawPreview = ref(null)
  // Набранные вершины ломаной (локальные координаты холста) + позиция курсора.
  const polyPoints = ref([])
  let polyCursor = null
  let drag = null

  function localPoint(evt) {
    const paper = canvas.paperRef.value
    const p = paper.clientToLocalPoint(evt.clientX, evt.clientY)
    const grid = paper.options.gridSize || 5
    return { x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) }
  }

  function toContainer(point) {
    const paper = canvas.paperRef.value
    const p = paper.localToClientPoint(point)
    const rect = paperContainer.value.getBoundingClientRect()
    return { x: p.x - rect.left, y: p.y - rect.top }
  }

  /** Активен ли жест рисования (CanvasPane гейтит по нему лассо и курсор). */
  function isDrawing() {
    return ui.canvasTool !== 'select'
  }

  function commitShape(shape) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    const cell = materializeShape(graph, paper, { ...DRAW_DEFAULTS, ...shape })
    if (!cell) return
    canvas.setSelection([{ kind: 'cell', id: cell.id }])
    canvas.markDirty()
    scheduleSnapshot()
    // Инструмент одноразовый, как в редакторе: нарисовал — вернулись к выбору.
    // Ломаная сама решает, когда закончила (замыкание/двойной клик).
    ui.resetCanvasTool()
  }

  function finishPolyline(closed) {
    const pts = dedupeAdjacent(polyPoints.value)
    polyPoints.value = []
    polyCursor = null
    drawPreview.value = null
    // Одна точка — это клик без фигуры, ломаной из неё не выйдет.
    if (pts.length >= 2) commitShape({ type: 'polyline', points: pts, closed })
    else ui.resetCanvasTool()
  }

  function onPointerDown(evt) {
    if (!isDrawing() || evt.button !== 0 || ui.projectBusy) return
    if (!canvas.paperRef.value || !paperContainer.value) return
    if (!paperContainer.value.contains(evt.target)) return
    // JointJS не должен начать drag ячейки/рисование связи под курсором.
    evt.preventDefault()
    evt.stopPropagation()

    const tool = ui.canvasTool
    const p = localPoint(evt)

    if (tool === 'text') {
      // Якорь новой подписи — по левому краю: клик ставит НАЧАЛО текста (как в любом
      // редакторе), а многострочная подпись выравнивается по левому краю. Дефолт для
      // фигуры БЕЗ поля `align` остался центром, поэтому уже расставленные подписи и
      // старые архивы не съезжают.
      commitShape({
        type: 'text',
        x: p.x,
        y: p.y,
        text: 'Текст',
        fontSize: TEXT_FONT_SIZE,
        align: 'left',
      })
      return
    }

    if (tool === 'polyline') {
      const pts = polyPoints.value
      if (pts.length >= 2) {
        const scale = canvas.paperRef.value.scale().sx || 1
        const near = (pt) => Math.hypot(p.x - pt[0], p.y - pt[1]) <= CLOSE_THRESHOLD / scale
        // Клик по началу замыкает в полигон, по последней вершине — заканчивает
        // открытую ломаную: иначе попытка «поправить последнюю точку» ставила новую
        // вершину и тянула резинку дальше.
        if (near(pts[0])) {
          finishPolyline(true)
          return
        }
        if (near(pts[pts.length - 1])) {
          finishPolyline(false)
          return
        }
      }
      // Повтор предыдущей вершины не добавляем: завершающий двойной клик — это два
      // pointerdown в одной точке, и дубль дал бы две ручки на одном месте.
      const last = pts[pts.length - 1]
      if (!last || last[0] !== p.x || last[1] !== p.y) polyPoints.value = [...pts, [p.x, p.y]]
      updatePolyPreview()
      return
    }

    drag = { tool, start: p, startClient: { x: evt.clientX, y: evt.clientY } }
  }

  function onPointerMove(evt) {
    if (polyPoints.value.length) {
      polyCursor = localPoint(evt)
      updatePolyPreview()
      return
    }
    if (!drag) return
    const p = localPoint(evt)
    drag.current = p
    drag.shift = evt.shiftKey
    if (drag.tool === 'line') {
      drawPreview.value = {
        type: 'line',
        points: [toContainer(drag.start), toContainer(p)].map((c) => [c.x, c.y]),
      }
      return
    }
    const a = toContainer(drag.start)
    const b = toContainer(p)
    drawPreview.value = {
      type: 'rect',
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    }
  }

  function onPointerUp(evt) {
    if (!drag) return
    const { tool, start, startClient } = drag
    const moved = Math.hypot(evt.clientX - startClient.x, evt.clientY - startClient.y)
    const end = drag.current || start
    const shift = drag.shift
    drag = null
    drawPreview.value = null
    // Протяжки не было — трактуем как промах, а не как фигуру нулевого размера.
    if (moved < DRAG_THRESHOLD) return

    if (tool === 'line') {
      commitShape({ type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y })
      return
    }
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    const w = Math.abs(end.x - start.x)
    const h = Math.abs(end.y - start.y)
    if (tool === 'circle') {
      // Shift — ровный круг (как в редакторе): по меньшей полуоси.
      const rx = w / 2
      const ry = h / 2
      const r = Math.min(rx, ry)
      commitShape({
        type: 'circle',
        cx: x + rx,
        cy: y + ry,
        rx: shift ? r : rx,
        ry: shift ? r : ry,
      })
      return
    }
    commitShape({ type: 'rect', x, y, w, h })
  }

  function updatePolyPreview() {
    const pts = [...polyPoints.value]
    if (polyCursor) pts.push([polyCursor.x, polyCursor.y])
    drawPreview.value = {
      type: 'polyline',
      points: pts.map(([x, y]) => {
        const c = toContainer({ x, y })
        return [c.x, c.y]
      }),
    }
  }

  /** Двойной клик — завершить незамкнутую ломаную (как в редакторе). */
  function onDoubleClick(evt) {
    if (!isDrawing() || !polyPoints.value.length) return
    evt.preventDefault()
    evt.stopPropagation()
    finishPolyline(false)
  }

  /** Esc — отменить набор ломаной, иначе выйти из инструмента (гейт в useHotkeys). */
  function cancelDraw() {
    if (polyPoints.value.length) {
      polyPoints.value = []
      polyCursor = null
      drawPreview.value = null
      return true
    }
    if (!isDrawing()) return false
    ui.resetCanvasTool()
    return true
  }

  useEventListener(paperContainer, 'pointerdown', onPointerDown, true)
  useEventListener(paperContainer, 'dblclick', onDoubleClick, true)
  useEventListener(document, 'pointermove', onPointerMove)
  useEventListener(document, 'pointerup', onPointerUp)

  return { drawPreview, isDrawing, cancelDraw }
}
