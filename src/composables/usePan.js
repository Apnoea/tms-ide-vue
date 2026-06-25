import { useEventListener } from '@vueuse/core'
import { useCanvas } from './useCanvas'

/**
 * Pan холста: ЛКМ-drag по пустому месту двигает paper (translate). onPanStart
 * вызывается из blank:pointerdown в CanvasPane; move/up слушаются на document
 * (drag может уйти за пределы холста) — auto-cleanup через useEventListener.
 * `isPanning()` отдаём наружу — hover-tooltip гасится во время pan'а.
 *
 * @param {import('vue').Ref<HTMLElement|null>} paperContainer — для cursor-стиля.
 */
export function usePan(paperContainer) {
  const canvas = useCanvas()
  let isPanning = false
  let panStart = null

  function onPanStart(event) {
    const paper = canvas.paperRef.value
    if (!paper) return
    isPanning = true
    const { tx, ty } = paper.translate()
    panStart = { clientX: event.clientX, clientY: event.clientY, tx, ty }
    if (paperContainer.value) paperContainer.value.style.cursor = 'grabbing'
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
    if (paperContainer.value) paperContainer.value.style.cursor = ''
  }

  useEventListener(document, 'mousemove', onPanMove)
  useEventListener(document, 'mouseup', onPanEnd)

  return { onPanStart, isPanning: () => isPanning }
}
