import { getCurrentScope, onScopeDispose } from 'vue'
import { useCanvas } from './useCanvas'
import { MOTION_MS, prefersReducedMotion } from '../constants/motion'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 4
// Строка прокрутки в пикселях (deltaMode 1 у Firefox): ~высота строки интерфейса.
const WHEEL_LINE_PX = 16
// Шаг зума кнопками тулбара (крупнее колеса 0.9/1.1 — клик должен ощутимо двигать).
export const ZOOM_STEP = 1.2

/**
 * Навигация по холсту: колесо (прокрутка / зум с Ctrl, якорь — курсор), кнопки ±
 * (якорь — центр вьюпорта), fit-to-content и доводка ячейки в вид.
 *
 * @param {import('vue').Ref<HTMLElement|null>} paperContainer
 */
export function useCanvasZoom(paperContainer) {
  const canvas = useCanvas()

  // ─── Плавная камера ───
  // Для переходов по команде: «Вписать в экран», доводка совпадения поиска и шаг зума
  // кнопками ± / Ctrl+= / Ctrl+−. Мгновенный скачок там терял ориентацию — непонятно,
  // куда сдвинулась схема. Колесо остаётся мгновенным: им ведут непрерывно, и задержка
  // мешала бы.
  let viewAnim = null // { raf, target } текущего перехода
  if (getCurrentScope()) onScopeDispose(() => stopViewAnimation())

  function stopViewAnimation() {
    if (viewAnim) cancelAnimationFrame(viewAnim.raf)
    viewAnim = null
  }

  function applyView(paper, s, tx, ty) {
    paper.scale(s, s)
    paper.translate(tx, ty)
    canvas.zoomPercent.value = Math.round(s * 100)
    canvas.bumpPaperView()
  }

  /**
   * Переводит вид к `target` ({ s, tx, ty }) за `MOTION_MS.slow` с замедлением в конце.
   * Если холст сдвинули другим жестом (pan, колесо) — переход уступает ему и
   * останавливается, а не тянет вид обратно.
   */
  function animateView(target) {
    const paper = canvas.paperRef.value
    if (!paper) return
    stopViewAnimation()
    const from = { s: paper.scale().sx, ...paper.translate() }
    if (prefersReducedMotion()) {
      applyView(paper, target.s, target.tx, target.ty)
      return
    }
    const start = performance.now()
    let last = from
    const step = (now) => {
      const cur = paper.translate()
      const moved =
        Math.abs(cur.tx - last.tx) > 0.5 ||
        Math.abs(cur.ty - last.ty) > 0.5 ||
        Math.abs(paper.scale().sx - last.s) > 1e-6
      if (moved) {
        viewAnim = null
        return
      }
      const t = Math.min(1, (now - start) / MOTION_MS.slow)
      const k = 1 - (1 - t) ** 3
      last = {
        s: from.s + (target.s - from.s) * k,
        tx: from.tx + (target.tx - from.tx) * k,
        ty: from.ty + (target.ty - from.ty) * k,
      }
      applyView(paper, last.s, last.tx, last.ty)
      if (t < 1) viewAnim.raf = requestAnimationFrame(step)
      else viewAnim = null
    }
    viewAnim = { raf: requestAnimationFrame(step), target }
  }

  /**
   * Масштабирует, сохраняя точку (clientX, clientY) под тем же местом экрана:
   * локальная точка под якорем до зума → смена масштаба → сдвиг paper'а так, чтобы
   * она осталась под якорем.
   */
  function zoomAt(clientX, clientY, factor) {
    const paper = canvas.paperRef.value
    if (!paper) return
    stopViewAnimation()
    const scale = paper.scale().sx
    const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale * factor))
    if (newScale === scale) return

    const localBefore = paper.clientToLocalPoint(clientX, clientY)
    paper.scale(newScale, newScale)
    const localAfter = paper.clientToLocalPoint(clientX, clientY)
    const { tx, ty } = paper.translate()
    paper.translate(
      tx + (localAfter.x - localBefore.x) * newScale,
      ty + (localAfter.y - localBefore.y) * newScale
    )

    canvas.zoomPercent.value = Math.round(newScale * 100)
    canvas.bumpPaperView()
  }

  /** Сдвиг холста на экранные пиксели (колесо / трекпад), без смены масштаба. */
  function panBy(dx, dy) {
    const paper = canvas.paperRef.value
    if (!paper || (!dx && !dy)) return
    stopViewAnimation()
    const { tx, ty } = paper.translate()
    paper.translate(tx - dx, ty - dy)
    canvas.bumpPaperView()
  }

  /**
   * Шаг колеса в ПИКСЕЛЯХ: браузеры отдают дельту в строках (Firefox, deltaMode 1)
   * или страницах (deltaMode 2), и без приведения прокрутка была бы то на 3 пикселя,
   * то на пол-экрана.
   */
  function wheelPixels(delta, mode, pageSize) {
    if (mode === 1) return delta * WHEEL_LINE_PX
    if (mode === 2) return delta * (pageSize || WHEEL_LINE_PX * 20)
    return delta
  }

  /**
   * Колесо — как в Figma и схемных редакторах (Visio, draw.io, Inkscape):
   * прокрутка, с Shift — горизонтальная, с Ctrl/Cmd — зум к курсору.
   *
   * Ctrl-ветка обслуживает и трекпад: pinch-zoom браузер отдаёт как `wheel` с
   * `ctrlKey: true`, а двухпальцевый жест — обычными deltaX/deltaY. Поэтому одно
   * условие даёт правильное поведение и мыши, и трекпаду: зум по «голому» колесу дал бы
   * на трекпаде скачок масштаба при любой прокрутке.
   */
  function onWheel(event) {
    const el = paperContainer.value
    if (!canvas.paperRef.value) return
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.9 : 1.1)
      return
    }
    const dy = wheelPixels(event.deltaY, event.deltaMode, el?.clientHeight)
    const dx = wheelPixels(event.deltaX, event.deltaMode, el?.clientWidth)
    // Shift+колесо у мыши: часть браузеров сама переносит дельту в deltaX, часть
    // оставляет в deltaY — поэтому переносим только когда deltaX пуст.
    if (event.shiftKey && !dx) panBy(dy, 0)
    else panBy(dx, dy)
  }

  /**
   * Зум кнопками ± и Ctrl+= / Ctrl+− — плавно, якорь — центр контейнера. Шаг считается
   * от ЦЕЛИ идущего перехода, а не от промежуточного кадра: иначе серия быстрых нажатий
   * теряла бы шаги и масштаб вставал бы на дробные значения.
   */
  function zoomByStep(factor) {
    const paper = canvas.paperRef.value
    const el = paperContainer.value
    if (!paper || !el) return
    const base = viewAnim?.target ?? { s: paper.scale().sx, ...paper.translate() }
    const s = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base.s * factor))
    if (s === base.s) return
    // Точка схемы под центром остаётся под центром.
    const cx = el.clientWidth / 2
    const cy = el.clientHeight / 2
    const lx = (cx - base.tx) / base.s
    const ly = (cy - base.ty) / base.s
    animateView({ s, tx: cx - lx * s, ty: cy - ly * s })
  }

  /**
   * Вписать схему в экран (не крупнее 100%). `{ animate: true }` — плавно: так зовут
   * команды пользователя (кнопка масштаба, Ctrl+0, пункт меню). Без него — сразу: при
   * открытии формы и проекта вид должен встать на место до первого кадра. Аргумент
   * читается только по полю `animate`: из `@click` сюда приходит событие.
   */
  function fitToContent(opts) {
    const paper = canvas.paperRef.value
    const graph = canvas.graphRef.value
    if (!paper || !graph) return
    stopViewAnimation()
    const before = { s: paper.scale().sx, ...paper.translate() }

    if (graph.getCells().length === 0) {
      // Пустой холст — просто сброс.
      paper.scale(1, 1)
      paper.translate(0, 0)
    } else {
      // maxScale: 1 — не приближаем больше 100%: маленький контент просто центрируется.
      paper.transformToFitContent({
        padding: 40,
        minScale: MIN_ZOOM,
        maxScale: 1,
        horizontalAlign: 'middle',
        verticalAlign: 'middle',
        useModelGeometry: false,
      })
    }

    const target = { s: paper.scale().sx, ...paper.translate() }
    if (opts?.animate === true) {
      // Целевой вид посчитал JointJS; возвращаем прежний (в тот же кадр — без мигания)
      // и едем к целевому.
      paper.scale(before.s, before.s)
      paper.translate(before.tx, before.ty)
      animateView(target)
      return
    }
    applyView(paper, target.s, target.tx, target.ty)
  }

  /**
   * Доводит ячейку в центр вьюпорта (translate без смены зума), плавно. Если видна
   * целиком — не двигаем: иначе Enter-листание близких match'ей дёргало бы холст.
   */
  function centerOnCell(cellId) {
    const paper = canvas.paperRef.value
    const graph = canvas.graphRef.value
    const el = paperContainer.value
    if (!paper || !graph || !cellId || !el) return
    const cell = graph.getCell(cellId)
    if (!cell) return
    const bbox = cell.getBBox?.()
    if (!bbox) return
    const s = paper.scale().sx
    const { tx, ty } = paper.translate()
    const paperW = el.clientWidth
    const paperH = el.clientHeight
    const screenX = bbox.x * s + tx
    const screenY = bbox.y * s + ty
    const screenW = bbox.width * s
    const screenH = bbox.height * s
    const margin = 40
    const inView =
      screenX >= margin &&
      screenY >= margin &&
      screenX + screenW <= paperW - margin &&
      screenY + screenH <= paperH - margin
    if (inView) return
    const cx = bbox.x + bbox.width / 2
    const cy = bbox.y + bbox.height / 2
    animateView({ s, tx: paperW / 2 - cx * s, ty: paperH / 2 - cy * s })
  }

  return { onWheel, zoomByStep, fitToContent, centerOnCell }
}
