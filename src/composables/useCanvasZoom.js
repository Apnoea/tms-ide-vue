import { useCanvas } from './useCanvas'

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

  /**
   * Масштабирует, сохраняя точку (clientX, clientY) под тем же местом экрана:
   * локальная точка под якорем до зума → смена масштаба → сдвиг paper'а так, чтобы
   * она осталась под якорем.
   */
  function zoomAt(clientX, clientY, factor) {
    const paper = canvas.paperRef.value
    if (!paper) return
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

  /** Зум кнопками +/− из тулбара: якорь — геометрический центр контейнера. */
  function zoomByStep(factor) {
    const el = paperContainer.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  function fitToContent() {
    const paper = canvas.paperRef.value
    const graph = canvas.graphRef.value
    if (!paper || !graph) return

    // Пустой холст — просто сброс
    if (graph.getCells().length === 0) {
      paper.scale(1, 1)
      paper.translate(0, 0)
      canvas.zoomPercent.value = 100
      canvas.bumpPaperView()
      return
    }

    // maxScale: 1 — не приближаем больше 100%: маленький контент просто центрируется.
    paper.transformToFitContent({
      padding: 40,
      minScale: MIN_ZOOM,
      maxScale: 1,
      horizontalAlign: 'middle',
      verticalAlign: 'middle',
      useModelGeometry: false,
    })

    canvas.zoomPercent.value = Math.round(paper.scale().sx * 100)
    canvas.bumpPaperView()
  }

  /**
   * Доводит ячейку в центр вьюпорта (translate без смены зума). Если видна целиком
   * — не двигаем: иначе Enter-листание близких match'ей дёргало бы холст.
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
    paper.translate(paperW / 2 - cx * s, paperH / 2 - cy * s)
    canvas.bumpPaperView()
  }

  return { onWheel, zoomByStep, fitToContent, centerOnCell }
}
