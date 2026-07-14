import { useEventListener } from '@vueuse/core'
import { useCanvas } from './useCanvas'

/**
 * Pan холста: drag двигает paper (translate). onPanStart вызывается из CanvasPane
 * при нажатии средней кнопки или Space+ЛКМ; move/up слушаются на document (drag
 * может уйти за пределы холста) — auto-cleanup через useEventListener.
 * `isPanning()` отдаём наружу — hover-tooltip гасится во время pan'а.
 *
 * Курсор (grab/grabbing) не трогаем — им единолично управляет CanvasPane
 * (там же живёт состояние Space), чтобы не было двух владельцев одного стиля.
 */
export function usePan() {
  const canvas = useCanvas()
  let isPanning = false
  let panStart = null

  function onPanStart(event) {
    const paper = canvas.paperRef.value
    if (!paper) return
    isPanning = true
    const { tx, ty } = paper.translate()
    panStart = { clientX: event.clientX, clientY: event.clientY, tx, ty }
  }

  function onPanMove(event) {
    const paper = canvas.paperRef.value
    if (!isPanning || !paper) return
    const dx = event.clientX - panStart.clientX
    const dy = event.clientY - panStart.clientY
    paper.translate(panStart.tx + dx, panStart.ty + dy)
    canvas.bumpPaperView()
  }

  function onPanEnd() {
    if (!isPanning) return
    isPanning = false
    panStart = null
  }

  useEventListener(document, 'mousemove', onPanMove)
  useEventListener(document, 'mouseup', onPanEnd)

  return { onPanStart, isPanning: () => isPanning }
}
