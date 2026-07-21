import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useCanvas } from './useCanvas'

/**
 * Lasso-выделение (ЛКМ-drag по пустому месту — Figma-стандарт). startLasso
 * вызывается из blank:pointerdown в CanvasPane; move/up слушаются на document
 * (drag уходит за пределы холста) — auto-cleanup через useEventListener. lassoRect
 * отдаём в шаблон для overlay-рамки. Ctrl/Cmd на старте → добавление к выделению.
 *
 * Клик по пустому без drag'а (рамка <3px) = снять выделение — этот кейс тоже
 * приходит сюда (pan ушёл на среднюю кнопку/Space, ЛКМ по пустому всегда лассо).
 *
 * findModelsInArea ловит только ячейки; линии между ними добавляет
 * `selectCellsWithBridges` (общая логика выделения, живёт в CanvasPane).
 *
 * @param {import('vue').Ref<HTMLElement|null>} paperContainer
 * @param {{ selectCellsWithBridges: (cellItems: Array) => void }} deps
 */
export function useLasso(paperContainer, { selectCellsWithBridges }) {
  const canvas = useCanvas()
  const lassoRect = ref(null) // { x, y, w, h } в container-координатах для overlay
  let lassoActive = false
  let lassoStartLocal = null
  let lassoStartClient = null
  let lassoAdditive = false

  function startLasso(evt) {
    const paper = canvas.paperRef.value
    if (!paper) return
    lassoActive = true
    lassoAdditive = evt.ctrlKey || evt.metaKey
    lassoStartLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY)
    lassoStartClient = { x: evt.clientX, y: evt.clientY }
    lassoRect.value = { x: 0, y: 0, w: 0, h: 0 }
  }

  function onLassoMove(evt) {
    if (!lassoActive || !paperContainer.value) return
    const rect = paperContainer.value.getBoundingClientRect()
    const x1 = Math.min(lassoStartClient.x, evt.clientX) - rect.left
    const y1 = Math.min(lassoStartClient.y, evt.clientY) - rect.top
    const x2 = Math.max(lassoStartClient.x, evt.clientX) - rect.left
    const y2 = Math.max(lassoStartClient.y, evt.clientY) - rect.top
    lassoRect.value = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }

  function onLassoEnd(evt) {
    if (!lassoActive) return
    lassoActive = false

    const paper = canvas.paperRef.value
    const graph = canvas.graphRef.value
    const endLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY)
    const x = Math.min(lassoStartLocal.x, endLocal.x)
    const y = Math.min(lassoStartLocal.y, endLocal.y)
    const w = Math.abs(endLocal.x - lassoStartLocal.x)
    const h = Math.abs(endLocal.y - lassoStartLocal.y)
    lassoRect.value = null

    // Слишком маленькая рамка — это клик по пустому, а не drag: снимаем выделение
    // (кроме additive-клика с Ctrl/Cmd, где выделение осознанно сохраняем).
    if (w < 3 && h < 3) {
      if (!lassoAdditive) {
        canvas.clearSelection()
        if (canvas.highlightedTag.value) canvas.clearHighlightedTag()
      }
      return
    }
    if (!graph) return

    const cells = graph.findModelsInArea({ x, y, width: w, height: h })
    // Задетых членов группы дотягиваем до целой группы (expandGroups).
    const newCells = canvas.expandGroups(
      cells
        // Заблокированные (`tms.locked`) лассо не захватывает — их не двигают
        // группой; выделить для снятия замка можно кликом.
        .filter((c) => c.isElement && c.isElement() && !c.get('tms')?.locked)
        .map((c) => ({ kind: 'cell', id: c.id }))
    )

    if (lassoAdditive) {
      // Объединяем с уже выделенными ячейками, дедуплицируя по id. Ранее
      // выделенные провода сохраняем (keepLinks) — additive не должен их ронять.
      const currentCells = canvas.selection.value.filter((i) => i.kind === 'cell')
      const currentLinks = canvas.selection.value.filter((i) => i.kind === 'link')
      const ids = new Set(currentCells.map((c) => c.id))
      const merged = [...currentCells]
      for (const item of newCells) {
        if (!ids.has(item.id)) {
          merged.push(item)
          ids.add(item.id)
        }
      }
      selectCellsWithBridges(merged, currentLinks)
    } else {
      selectCellsWithBridges(newCells)
    }
  }

  useEventListener(document, 'mousemove', onLassoMove)
  useEventListener(document, 'mouseup', onLassoEnd)

  return { lassoRect, startLasso }
}
