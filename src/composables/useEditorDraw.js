import { computed, onScopeDispose, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { snapToGrid } from '../utils/grid'
import { TEXT_SHAPE_SIZE } from '../constants/text'
import { SHAPE_GRID } from './useStencilEditor'

/**
 * Рисование жестами на столе редактора символов: прямоугольник, линия и эллипс —
 * протяжкой, ломаная — кликами, подпись и порт — одним кликом. Превью тянущейся фигуры
 * (пунктиром) считается здесь же.
 *
 * Жест слушается со STAGE, а не с SVG символа: штрих и порт можно начинать за пределами
 * холста. К области символа координаты прижимает снап (`snapShapeX/Y` и `portOnEdge`
 * клампят в 0..width/height).
 *
 * @param {object} deps
 * @param {object} deps.ed — модель редактора (useStencilEditor)
 * @param {import('vue').Ref<number>} deps.scale — px на единицу модели
 * @param {(e: PointerEvent) => {x: number, y: number}} deps.unitsFromEvent
 * @param {(e: PointerEvent) => {x: number, y: number}} deps.snappedShape — то же со снапом
 */
export function useEditorDraw({ ed, scale, unitsFromEvent, snappedShape }) {
  const { tool, addShape, addPort } = ed

  // Зажат ли Shift: у эллипса он держит равные полуоси и при рисовании, и при ресайзе
  // ручкой — в interact-колбэке самого события нет.
  const shiftHeld = ref(false)
  useEventListener(document, 'keydown', (e) => {
    if (e.key === 'Shift') shiftHeld.value = true
  })
  useEventListener(document, 'keyup', (e) => {
    if (e.key === 'Shift') shiftHeld.value = false
  })

  const drawing = ref(null) // { type, sx, sy, cx, cy } — тянущаяся фигура
  const polyPoints = ref([]) // накопленные вершины ломаной
  const polyCursor = ref(null) // «резинка» до курсора

  function onDrawDown(e) {
    if (e.button !== 0) return
    if (tool.value === 'port') {
      if (e.target.closest('[data-se-move="port"]')) return // клик по порту — его хендлер
      const u = unitsFromEvent(e)
      addPort(u.x, u.y)
      return
    }
    // Подпись ставится одним кликом: габарит задаёт шрифт, а не рамка. Якорь — левый
    // край (клик = начало текста); у фигур БЕЗ поля `align` дефолт остаётся центром.
    if (tool.value === 'text') {
      const u = snappedShape(e)
      addShape({
        type: 'text',
        x: u.x,
        y: u.y,
        text: 'Текст',
        fontSize: TEXT_SHAPE_SIZE,
        align: 'left',
      })
      return
    }
    if (tool.value === 'polyline') {
      const u = snappedShape(e)
      const pts = polyPoints.value
      // Клик рядом с вершиной (при ≥2 точках): по стартовой — замыкание в polygon (без
      // дубля точки, помечаем closed), по последней — конец открытой ломаной. Порог ~10
      // экранных px.
      if (pts.length >= 2) {
        const near = (pt) => Math.hypot(u.x - pt[0], u.y - pt[1]) <= 10 / scale.value
        if (near(pts[0]) || near(pts[pts.length - 1])) {
          addShape({ type: 'polyline', points: [...pts], closed: near(pts[0]) })
          polyPoints.value = []
          polyCursor.value = null
          return
        }
      }
      polyPoints.value = [...pts, [u.x, u.y]]
      return
    }
    const u = snappedShape(e)
    drawing.value = { type: tool.value, sx: u.x, sy: u.y, cx: u.x, cy: u.y }
    window.addEventListener('pointermove', onDrawMove)
    window.addEventListener('pointerup', onDrawUp)
  }

  function onStageMove(e) {
    if (tool.value === 'polyline' && polyPoints.value.length) {
      const u = snappedShape(e)
      polyCursor.value = [u.x, u.y]
    }
  }

  function onDrawMove(e) {
    if (!drawing.value) return
    const u = snappedShape(e)
    drawing.value = { ...drawing.value, cx: u.x, cy: u.y }
  }
  function onDrawUp() {
    window.removeEventListener('pointermove', onDrawMove)
    window.removeEventListener('pointerup', onDrawUp)
    commitDrawing()
  }
  function commitDrawing() {
    const d = drawing.value
    drawing.value = null
    if (!d) return
    if (d.type === 'rect') {
      const w = Math.abs(d.cx - d.sx)
      const h = Math.abs(d.cy - d.sy)
      if (w < SHAPE_GRID || h < SHAPE_GRID) return // клик без протяжки — не фигура
      addShape({ type: 'rect', x: Math.min(d.sx, d.cx), y: Math.min(d.sy, d.cy), w, h })
    } else if (d.type === 'line') {
      if (d.sx === d.cx && d.sy === d.cy) return
      addShape({ type: 'line', x1: d.sx, y1: d.sy, x2: d.cx, y2: d.cy })
    } else if (d.type === 'circle') {
      // Радиусы — полуоси габарита от центра (курсор идёт по границе), с Shift равные:
      // один инструмент даёт и эллипс, и ровный круг.
      const { rx, ry } = draftRadii(d)
      if (rx < SHAPE_GRID || ry < SHAPE_GRID) return
      addShape({ type: 'circle', cx: d.sx, cy: d.sy, rx, ry })
    }
  }

  function finishPolyline() {
    if (tool.value !== 'polyline') return
    // Дедуп подряд идущих совпадающих точек: двойной клик добавляет лишнюю.
    const pts = polyPoints.value.filter(
      (p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1]
    )
    if (pts.length >= 2) addShape({ type: 'polyline', points: pts })
    polyPoints.value = []
    polyCursor.value = null
  }

  /** Бросить начатый жест (Esc); false — бросать нечего. */
  function cancelDraw() {
    if (!drawing.value && !polyPoints.value.length) return false
    drawing.value = null
    polyPoints.value = []
    polyCursor.value = null
    return true
  }

  const draftRect = computed(() => {
    const d = drawing.value
    if (d?.type !== 'rect') return null
    return {
      x: Math.min(d.sx, d.cx),
      y: Math.min(d.sy, d.cy),
      w: Math.abs(d.cx - d.sx),
      h: Math.abs(d.cy - d.sy),
    }
  })
  /** Полуоси тянущегося эллипса от центра; Shift — равные (ровный круг). */
  function draftRadii(d) {
    const rx = snapToGrid(Math.abs(d.cx - d.sx), SHAPE_GRID)
    const ry = snapToGrid(Math.abs(d.cy - d.sy), SHAPE_GRID)
    if (!shiftHeld.value) return { rx, ry }
    const r = Math.max(rx, ry)
    return { rx: r, ry: r }
  }
  const draftEllipse = computed(() => {
    const d = drawing.value
    if (d?.type !== 'circle') return null
    const { rx, ry } = draftRadii(d)
    return rx > 0 && ry > 0 ? { cx: d.sx, cy: d.sy, rx, ry } : null
  })
  const polyPreview = computed(() => {
    if (!polyPoints.value.length) return ''
    const pts = polyCursor.value ? [...polyPoints.value, polyCursor.value] : polyPoints.value
    return pts.map(([x, y]) => `${x},${y}`).join(' ')
  })

  onScopeDispose(() => {
    window.removeEventListener('pointermove', onDrawMove)
    window.removeEventListener('pointerup', onDrawUp)
  })

  return {
    shiftHeld,
    drawing,
    draftRect,
    draftEllipse,
    polyPreview,
    onDrawDown,
    onStageMove,
    finishPolyline,
    cancelDraw,
  }
}
