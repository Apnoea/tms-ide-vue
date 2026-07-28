import { useCanvas } from './useCanvas'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 4
// Шаг зума кнопками тулбара (крупнее колеса 0.9/1.1 — клик должен ощутимо двигать).
export const ZOOM_STEP = 1.2

/**
 * Зум холста: колесо (якорь — курсор), кнопки ± (якорь — центр вьюпорта),
 * fit-to-content и доводка ячейки в вид.
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

  function onWheel(event) {
    if (!canvas.paperRef.value) return
    event.preventDefault()
    zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.9 : 1.1)
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
