import { computed } from 'vue'
import { useCanvas } from './useCanvas'
import { getStencilById } from '../stencils/registry'

/**
 * Бейджи незаполненных required-слотов на холсте. Для каждой ячейки, чей стенсил
 * декларирует required-слоты и хотя бы один пуст — жёлтый «!» в правом нижнем
 * углу. Клик выделяет ячейку и просит инспектор открыть picker первого пустого
 * слота (`canvas.requestSlotPick` → InspectorPane слушает).
 *
 * cell_value НЕ обрабатывается: его drop-flow всегда открывает tag-picker (или
 * не даёт создать ячейку), так что cell_value без valueTag в норме не бывает.
 *
 * Двухступенчатый расчёт ради перфа: ЧТО показывать (дорогой обход графа +
 * getStencilById) — на graphVersion; КУДА (дешёвая проекция model→screen) — на
 * paperViewTick, чтобы pan/zoom не гонял полный обход каждый кадр.
 */
export function useSlotWarnings() {
  const canvas = useCanvas()

  const slotWarningCells = computed(() => {
    canvas.graphVersion.value
    const graph = canvas.graphRef.value
    if (!graph) return []
    const out = []
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const slots = getStencilById(tms.stencilId)?.slots
      if (!slots?.length) continue
      const slotValues = tms.slots || {}
      const missing = slots.filter((s) => s.required && !slotValues[s.key])
      if (!missing.length) continue
      const pos = cell.get('position')
      const size = cell.get('size')
      // Якорь бейджа — правый-нижний угол ячейки (в model-координатах).
      out.push({
        cellId: cell.id,
        missingLabels: missing.map((s) => s.label).join(', '),
        mx: pos.x + size.width,
        my: pos.y + size.height,
      })
    }
    return out
  })

  const slotWarnings = computed(() => {
    canvas.paperViewTick.value
    const paper = canvas.paperRef.value
    if (!paper) return []
    const scale = paper.scale().sx
    const { tx, ty } = paper.translate()
    return slotWarningCells.value.map((w) => ({
      cellId: w.cellId,
      missingLabels: w.missingLabels,
      // Бейдж 12px центрирован на углу (delete-overlay при selected живёт там же).
      style: { left: `${w.mx * scale + tx - 6}px`, top: `${w.my * scale + ty - 6}px` },
    }))
  })

  function onSlotBadgeClick(cellId) {
    canvas.selectOnly('cell', cellId)
    canvas.requestSlotPick()
  }

  return { slotWarnings, onSlotBadgeClick }
}
