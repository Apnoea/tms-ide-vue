import { watch } from 'vue'
import { useCanvas } from './useCanvas'
import { cellHasTag } from '../utils/cellSearch'

/**
 * Подсветки холста — CSS-классы на view'ах, модель не трогаем: по тегу
 * (`.tms-tag-match`) и по результатам Ctrl+F (`.tms-search-match` /
 * `.tms-search-current` + доводка текущего в вид). Выделение живёт в CanvasPane
 * (к нему привязаны link-tools), но пользуется теми же хелперами.
 *
 * @param {object} deps
 * @param {(cellId: string) => void} deps.centerOnCell
 */
export function useCellHighlight({ centerOnCell }) {
  const canvas = useCanvas()

  /** Снять класс со всех view'ев paper'а (быстрее обхода графа: ищем по DOM). */
  function clearCellClass(...classes) {
    const paper = canvas.paperRef.value
    if (!paper) return
    for (const cls of classes) {
      paper.el.querySelectorAll(`.${cls}`).forEach((n) => n.classList.remove(cls))
    }
  }

  /** Навесить класс на view'ы переданных ячеек (id или модели). Только для watch'ей ниже. */
  function markCells(ids, cls) {
    const paper = canvas.paperRef.value
    const graph = canvas.graphRef.value
    if (!paper || !graph) return
    for (const id of ids) {
      const cell = typeof id === 'object' ? id : graph.getCell(id)
      if (!cell) continue
      paper.findViewByModel(cell)?.el?.classList.add(cls)
    }
  }

  // Exact-match по любому tag-полю (см. cellHasTag). Переживает смену выделения
  // и pan/zoom — это чисто визуальный слой.
  watch(
    () => canvas.highlightedTag.value,
    (tag) => {
      const graph = canvas.graphRef.value
      clearCellClass('tms-tag-match')
      if (!tag || !graph) return
      markCells(
        graph.getCells().filter((c) => cellHasTag(c, tag)),
        'tms-tag-match'
      )
    }
  )

  // Выделение НЕ трогаем: закрытие поиска не должно сбрасывать выбор.
  watch(
    () => [canvas.searchMatchIds.value, canvas.searchCurrentIdx.value],
    ([ids, idx]) => {
      const graph = canvas.graphRef.value
      clearCellClass('tms-search-match', 'tms-search-current')
      if (!ids.length || !graph) return
      ids.forEach((id, i) => markCells([id], i === idx ? 'tms-search-current' : 'tms-search-match'))
      centerOnCell(ids[idx])
    }
  )

  return { clearCellClass }
}
