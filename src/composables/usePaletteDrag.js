import { ref, computed } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useCanvas } from './useCanvas'
import { useUiStore } from '../stores/useUiStore'
import { getStencilById } from '../stencils/registry'
import { materializeStencil } from '../stencils/svgInjector'
import { textCellSize } from '../stencils/textCell'
import { snapToGrid } from '../utils/grid'

/**
 * Drag стенсила из палитры на холст: pointer-events (не нативный HTML5 DnD) →
 * превью липнет к курсору на полной частоте. PalettePane ставит ui.dragging на
 * pointerdown; здесь реактивный `dragListenerTarget` цепляет document-листенеры
 * на время drag'а, превью снапится к сетке (или к проводу в режиме врезки), а на
 * pointerup ячейка создаётся в точке дропа.
 *
 * @param {import('vue').Ref<HTMLElement|null>} paperContainer
 * @param {{ splicePreview, findLinkAtPoint, spliceCellIntoLink, updateSplicePreview, clearSplicePreview }} wireSplice
 */
export function usePaletteDrag(paperContainer, wireSplice) {
  const canvas = useCanvas()
  const ui = useUiStore()
  const {
    splicePreview,
    findLinkAtPoint,
    spliceCellIntoLink,
    updateSplicePreview,
    clearSplicePreview,
  } = wireSplice

  // Координаты курсора внутри paperContainer (для позиционирования preview).
  const cursorX = ref(-1000)
  const cursorY = ref(-1000)

  const previewVisible = computed(() => ui.dragging !== null && cursorX.value >= 0)

  // SVG-миниатюра превью — та же svgText, что в палитре (через registry).
  const draggingStencilSvg = computed(() => {
    const id = ui.dragging?.stencilId
    return id ? getStencilById(id)?.svgText || '' : ''
  })

  const previewStyle = computed(() => {
    if (!ui.dragging) return {}
    canvas.zoomPercent.value // reactive-touch: пересчёт превью при изменении зума
    // Берём ТОЧНЫЙ scale из paper, а не округлённый zoomPercent — иначе при
    // дробном зуме (177% = 1.7735…) ошибка cp·(точный−округлённый) растёт с
    // координатой и превью уезжает с провода.
    const p = canvas.paperRef.value
    const scale = p ? p.scale().sx : (canvas.zoomPercent.value || 100) / 100
    const w = ui.dragging.width * scale
    const h = ui.dragging.height * scale

    // Режим врезки: центр прилипает к точке на проводе + поворот под углом врезки.
    const sp = splicePreview.value
    if (sp && p) {
      const { tx, ty } = p.translate()
      const leftPx = sp.cx * scale + tx - w / 2
      const topPx = sp.cy * scale + ty - h / 2
      return {
        left: '0',
        top: '0',
        width: `${w}px`,
        height: `${h}px`,
        transform: `translate3d(${leftPx}px, ${topPx}px, 0) rotate(${sp.angle}deg)`,
        willChange: 'transform',
      }
    }

    // Top-left превью под курсором в container-px + снап к сетке (переводим в
    // paper-локальные, округляем до gridSize, возвращаем) — превью лежит ровно
    // туда, куда упадёт ячейка.
    let leftPx = cursorX.value - w / 2
    let topPx = cursorY.value - h / 2
    if (p) {
      const g = p.options.gridSize
      const { tx, ty } = p.translate()
      leftPx = snapToGrid((leftPx - tx) / scale, g) * scale + tx
      topPx = snapToGrid((topPx - ty) / scale, g) * scale + ty
    }

    // left/top:0 — якорь; реальный сдвиг через translate3d (GPU-композитинг,
    // без re-layout на каждый dragover).
    return {
      left: '0',
      top: '0',
      width: `${w}px`,
      height: `${h}px`,
      transform: `translate3d(${leftPx}px, ${topPx}px, 0)`,
      willChange: 'transform',
    }
  })

  /**
   * Создаёт ячейку из стенсила в точке (paper-координаты центра). Слоты и теги при
   * drop'е из палитры пусты — юзер заполнит в инспекторе (нет привязки = нет анимации).
   */
  function createStencilAt(stencilId, x, y) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return

    const stencil = getStencilById(stencilId)
    if (!stencil) {
      console.warn(`[Canvas] Стенсил"${stencilId}" не найден в реестре`)
      return
    }

    // Снап позиции к сетке — ячейка падает точно под рамку превью.
    const g = paper.options.gridSize
    const finalX = snapToGrid(x - stencil.width / 2, g)
    const finalY = snapToGrid(y - stencil.height / 2, g)
    const tms = { stencilId }
    // Стенсильные дефолты (`defaults` в stencil.json). structuredClone — иначе
    // вложенные объекты зашарили бы ссылку из реестра между ячейками.
    if (stencil.defaults) Object.assign(tms, structuredClone(stencil.defaults))

    // cell_text — размер под фактический текст, иначе широкая пустая bbox.
    let cellWidth = stencil.width
    let cellHeight = stencil.height
    if (stencilId === 'cell_text') {
      ;({ width: cellWidth, height: cellHeight } = textCellSize(tms))
    }

    return materializeStencil(graph, paper, stencil, {
      position: { x: finalX, y: finalY },
      size: { width: cellWidth, height: cellHeight },
      tms,
    })
  }

  /**
   * Размещает стенсил в точке. Стенсил с ≥2 портами, брошенный на провод, врезается
   * в него (split); иначе просто создаётся. Тег никто по пути не спрашивает —
   * привязка живёт в инспекторе, одинаково для всех символов.
   */
  function placeStencil(stencilId, point) {
    const stencil = getStencilById(stencilId)
    if ((stencil?.ports?.length || 0) >= 2) {
      const link = findLinkAtPoint(point)
      if (link) {
        const cell = createStencilAt(stencilId, point.x, point.y)
        if (cell) {
          spliceCellIntoLink(link, cell, point)
          return
        }
      }
    }
    createStencilAt(stencilId, point.x, point.y)
  }

  function onDragPointerMove(event) {
    const paper = canvas.paperRef.value
    if (!ui.dragging || !paperContainer.value) return
    const rect = paperContainer.value.getBoundingClientRect()
    // Курсор над палитрой (слева) → отрицательный X → previewVisible прячет рамку.
    cursorX.value = event.clientX - rect.left
    cursorY.value = event.clientY - rect.top
    if (paper) {
      const point = paper.clientToLocalPoint(event.clientX, event.clientY)
      updateSplicePreview(ui.dragging?.stencilId, point)
    }
  }

  function onDragPointerUp(event) {
    const paper = canvas.paperRef.value
    const stencilId = ui.dragging?.stencilId
    clearPreview() // stopDragging + сброс курсора (dragListenerTarget→null отцепит листенеры)
    if (!stencilId || !paper || !paperContainer.value) return

    // Дроп только если отпустили над холстом (не над палитрой/инспектором/вне окна).
    const rect = paperContainer.value.getBoundingClientRect()
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    if (!inside) return

    placeStencil(stencilId, paper.clientToLocalPoint(event.clientX, event.clientY))
  }

  // Drag прервался (Alt+Tab / потеря фокуса окна) — отменяем без дропа.
  function onDragCancel() {
    if (ui.dragging) clearPreview()
  }

  function clearPreview() {
    cursorX.value = -1000
    cursorY.value = -1000
    clearSplicePreview()
    ui.stopDragging()
  }

  // ui.dragging → document на время drag'а; useEventListener сам цепляет/снимает.
  const dragListenerTarget = computed(() => (ui.dragging ? document : null))
  useEventListener(dragListenerTarget, 'pointermove', onDragPointerMove)
  useEventListener(dragListenerTarget, 'pointerup', onDragPointerUp)
  useEventListener(window, 'blur', onDragCancel)

  return { previewVisible, previewStyle, draggingStencilSvg }
}
