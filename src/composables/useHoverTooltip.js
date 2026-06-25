import { ref } from 'vue'
import { useCanvas } from './useCanvas'
import { getStencilById } from '../stencils/registry'
import { outerKey } from '../constants/ids'

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
    const scale = paper.scale().sx
    const { tx, ty } = paper.translate()

    // Anchor: top-right ячейки в container-px. Нижний-правый угол плашки
    // прижимаем к anchor'у (transform translate(-100%, -100%)) с зазором 4px.
    const anchorX = (pos.x + size.width) * scale + tx
    const anchorY = pos.y * scale + ty - 4

    // id outer-карточки в animations.json. animId — первый сегмент UUID (как в
    // exporter.uniqueShortId без коллизии); cell_value использует сам valueTag.
    const animId =
      tms.stencilId === 'cell_value' && tms.valueTag ? tms.valueTag : String(cell.id).split('-')[0]

    cellHoverTooltip.value = {
      style: {
        left: `${anchorX}px`,
        top: `${anchorY}px`,
        transform: 'translate(-100%, -100%)',
      },
      stencilLabel: stencil.label,
      stencilId: tms.stencilId,
      exportId: outerKey(tms.stencilId, animId),
    }
  }

  function hideCellTooltip() {
    clearTimeout(hoverShowTimer)
    cellHoverTooltip.value = null
  }

  return { cellHoverTooltip, showCellTooltip, hideCellTooltip }
}
