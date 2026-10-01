import { computed } from 'vue'
import { useCanvas } from './useCanvas'
import { BUS_STENCIL_ID } from '../constants/ids'
import { isShapeCell, shapeTypeLabel } from '../stencils/shapeElement'

/**
 * Лист заголовка-пути «… › Символ» для правой колонки холста — что выделено: «Символ»,
 * «Шина», «Провод», тип фигуры-разметки («Прямоугольник»), «Группа» (все выделенные
 * ячейки — члены одной группы) или «Выделение». null — ничего не выделено. Одно правило
 * на инспектор и панель симуляции: колонка меняет содержимое, а путь — нет.
 */
export function useSelectionHeading() {
  const canvas = useCanvas()
  return computed(() => {
    canvas.graphVersion.value
    const graph = canvas.graphRef.value
    const sel = canvas.selection.value
    if (!graph || !sel.length) return null
    if (sel.length > 1) {
      const groups = sel
        .filter((s) => s.kind === 'cell')
        .map((s) => graph.getCell(s.id)?.get('tms')?.groupId)
      const oneGroup = groups.length > 1 && groups.every((g) => g && g === groups[0])
      return oneGroup ? 'Группа' : 'Выделение'
    }
    const cell = graph.getCell(sel[0].id)
    if (!cell) return null
    if (sel[0].kind === 'link') return 'Провод'
    if (isShapeCell(cell)) return shapeTypeLabel(cell.get('tms')?.shape || {})
    return cell.get('tms')?.stencilId === BUS_STENCIL_ID ? 'Шина' : 'Символ'
  })
}
