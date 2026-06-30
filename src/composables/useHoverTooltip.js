import { ref } from 'vue'
import { useCanvas } from './useCanvas'
import { getStencilById } from '../stencils/registry'
import { previewOuterKey } from '../constants/ids'
import { projectToScreen } from '../utils/paperGeom'

// Debounce на mouseenter — иначе плашка мерцает при быстром скольжении мыши
// между ячейками.
const HOVER_DELAY_MS = 400

/**
 * Hover-tooltip над ячейкой: HTML-плашка с лейблом стенсила, его id и id
 * outer-карточки в animations.json / экспортном SVG. `suppress()` — предикат
 * «сейчас идёт взаимодействие» (pan / drag / resize / edit-in-place), при
 * котором плашку не показываем. showCellTooltip/hideCellTooltip навешиваются
 * на paper-события в CanvasPane.
 */
export function useHoverTooltip({ suppress } = {}) {
  const canvas = useCanvas()
  const cellHoverTooltip = ref(null)
  let hoverShowTimer = null

  function showCellTooltip(elementView) {
    clearTimeout(hoverShowTimer)
    hoverShowTimer = setTimeout(() => doShowCellTooltip(elementView), HOVER_DELAY_MS)
  }

  function doShowCellTooltip(elementView) {
    const paper = canvas.paperRef.value
    if (!paper) return
    if (suppress?.()) return

    const cell = elementView.model
    const tms = cell.get('tms') || {}
    const stencil = getStencilById(tms.stencilId)
    if (!stencil) return

    const pos = cell.get('position')
    const size = cell.get('size')

    // Anchor: top-right ячейки в container-px. Нижний-правый угол плашки
    // прижимаем к anchor'у (transform translate(-100%, -100%)) с зазором 4px.
    const anchor = projectToScreen(paper, pos.x + size.width, pos.y)

    cellHoverTooltip.value = {
      style: {
        left: `${anchor.x}px`,
        top: `${anchor.y - 4}px`,
        transform: 'translate(-100%, -100%)',
      },
      stencilLabel: stencil.label,
      stencilId: tms.stencilId,
      // id outer-карточки в animations.json (тот же, что эмитит exporter).
      exportId: previewOuterKey(tms.stencilId, cell.id, tms.valueTag),
    }
  }

  function hideCellTooltip() {
    clearTimeout(hoverShowTimer)
    cellHoverTooltip.value = null
  }

  return { cellHoverTooltip, showCellTooltip, hideCellTooltip }
}
