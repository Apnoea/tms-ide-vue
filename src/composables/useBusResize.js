import { ref, computed } from 'vue'
import { useEventListener } from '@vueuse/core'
import { getStencilById } from '../stencils/registry'
import { injectStencilSvg, busPortX, desiredBusPortCount } from '../stencils/svgInjector'
import { snapToGrid } from '../utils/grid'
import { useCanvas } from './useCanvas'

/**
 * Resize-логика для cell_bus: drag edge-хэндлов (left/right) меняет ширину,
 * порты досоздаются/удаляются под новую длину (BUS_PORT_SPACING). Стенсилы
 * без `data-edge` атрибута игнорируются — функционал узко-целевой.
 *
 * Управление мышью через document-listener'ы (mousemove/mouseup) — JointJS
 * внутри не получает событий, drag живёт параллельно. Listener'ы навешиваются
 * через `useEventListener` с реактивным target'ом: dragging=true → target
 * становится document, listener зацепляется; end-resize → target null,
 * listener снимается. Auto-cleanup на unmount без явного onBeforeUnmount.
 *
 * Зависит от:
 *  • `scheduleSnapshot` (fn из useUndoRedo) — после end ресайза дебаунс-snapshot.
 *
 * Возвращает:
 *  • `onMaybeStartResize` — listener'ом на mousedown paperContainer'а в
 *    capture-фазе (раньше JointJS, чтобы он не начал свой drag).
 *  • `isResizing()` — для hover-tooltip и других consumer'ов которым нужно
 *    подавить свой UI пока юзер тянет резайз.
 */
export function useBusResize({ scheduleSnapshot }) {
  const canvas = useCanvas()
  let activeResize = null
  const dragging = ref(false)
  const dragTarget = computed(() => (dragging.value ? document : null))

  useEventListener(dragTarget, 'mousemove', onResizeMove)
  useEventListener(dragTarget, 'mouseup', onResizeEnd)

  function isResizing() {
    return dragging.value
  }

  function onMaybeStartResize(evt) {
    if (evt.button !== 0) return
    const edge = evt.target?.dataset?.edge
    if (!edge) return
    // Находим DOM-узел JointJS cellView (у него атрибут model-id)
    const cellEl = evt.target.closest('[model-id]')
    const modelId = cellEl?.getAttribute('model-id')
    const graph = canvas.graphRef.value
    if (!modelId || !graph) return
    const cell = graph.getCell(modelId)
    if (!cell || cell.get('tms')?.stencilId !== 'cell_bus') return
    evt.stopPropagation()
    evt.preventDefault()
    startBusResize(cell, edge, evt.clientX)
  }

  function startBusResize(cell, edge, startClientX) {
    const paper = canvas.paperRef.value
    if (!cell || !paper) return
    const pos = cell.get('position')
    const size = cell.get('size')
    // Запоминаем paper-X курсора — delta считаем в paper-координатах
    // (zoom-инвариантно, в отличие от client-px).
    const local = paper.clientToLocalPoint(startClientX, 0)
    activeResize = {
      cellId: cell.id,
      edge,
      startWidth: size.width,
      startHeight: size.height,
      startX: pos.x,
      startMouseX: local.x,
      // Последняя применённая ширина — guard от полного re-render'а SVG на
      // каждый mousemove, если ширина после snapToGrid та же что и в прошлом
      // кадре (mouse дёргается в пределах одного grid-шага).
      lastWidth: size.width,
    }
    canvas.selectOnly('cell', cell.id)
    dragging.value = true
  }

  function onResizeMove(evt) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!activeResize || !paper || !graph) return
    const cell = graph.getCell(activeResize.cellId)
    if (!cell) return

    const stencil = getStencilById(cell.get('tms')?.stencilId)
    const minW = stencil?.minWidth ?? 20
    const g = paper.options.gridSize

    const local = paper.clientToLocalPoint(evt.clientX, evt.clientY)
    const dx = local.x - activeResize.startMouseX

    let newWidth, newX
    if (activeResize.edge === 'right') {
      newWidth = activeResize.startWidth + dx
      newX = activeResize.startX
    } else {
      // Left edge: ширина и позиция меняются зеркально
      newWidth = activeResize.startWidth - dx
      newX = activeResize.startX + dx
    }

    newWidth = Math.max(minW, snapToGrid(newWidth, g))
    if (activeResize.edge === 'left') {
      // Восстанавливаем X так, чтобы правый край оставался на месте после клампа
      newX = activeResize.startX + (activeResize.startWidth - newWidth)
    }
    newX = snapToGrid(newX, g)

    // Width-guard: если шаг snapToGrid дал ту же ширину что в прошлый mousemove,
    // resize/syncBusPorts/injectStencilSvg повторят ту же работу впустую.
    // Особенно injectStencilSvg — он полностью перебирает DOM ячейки.
    if (newWidth === activeResize.lastWidth) return
    activeResize.lastWidth = newWidth

    cell.resize(newWidth, activeResize.startHeight)
    if (activeResize.edge === 'left') {
      cell.position(newX, cell.get('position').y)
    }

    syncBusPorts(cell, newWidth, activeResize.startHeight)

    const cellView = paper.findViewByModel(cell)
    if (cellView && stencil) injectStencilSvg(cellView, stencil)
  }

  /** id'ы портов шины, к которым подключён хотя бы один провод. */
  function getLinkedBusPortIds(cell) {
    const graph = canvas.graphRef.value
    const ids = new Set()
    if (!graph) return ids
    for (const link of graph.getConnectedLinks(cell)) {
      const s = link.get('source')
      const t = link.get('target')
      if (s?.id === cell.id && s.port) ids.add(s.port)
      if (t?.id === cell.id && t.port) ids.add(t.port)
    }
    return ids
  }

  /**
   * Приводит набор портов шины в соответствие ширине: порт каждые 2 клетки
   * (BUS_PORT_SPACING). Идемпотентна — безопасно звать на каждом кадре drag'а.
   * 1) досоздаёт недостающие порты 0..desired-1 (закрывает «дыры»)
   * 2) удаляет порты с индексом >= desired, КРОМЕ занятых проводом
   * 3) репозиционирует выжившие в канонические координаты — только если они
   *    реально сместились (иначе лишний re-render каждый кадр).
   * addPort/removePort/portProp идут через port-manager (set('ports') бы сломал).
   */
  function syncBusPorts(cell, width, height) {
    const desired = desiredBusPortCount(width)

    for (let i = 0; i < desired; i++) {
      if (!cell.hasPort(`top_${i}`)) {
        cell.addPort({ id: `top_${i}`, group: 'port', args: { x: busPortX(i), y: 0 } })
      }
      if (!cell.hasPort(`bot_${i}`)) {
        cell.addPort({ id: `bot_${i}`, group: 'port', args: { x: busPortX(i), y: height } })
      }
    }

    const linked = getLinkedBusPortIds(cell)
    for (const p of cell.getPorts()) {
      const idx = Number(p.id.slice(p.id.indexOf('_') + 1))
      if (idx >= desired && !linked.has(p.id)) {
        cell.removePort(p.id)
        continue
      }
      const targetX = busPortX(idx)
      const targetY = p.id.startsWith('bot_') ? height : 0
      if (p.args?.x !== targetX) cell.portProp(p.id, 'args/x', targetX)
      if (p.args?.y !== targetY) cell.portProp(p.id, 'args/y', targetY)
    }
  }

  function onResizeEnd() {
    if (!activeResize) return
    // Snapshot только если ширина реально менялась. Клик по хэндлу без движения
    // (или дёрганье в пределах одного grid-шага) не должен порождать «пустой»
    // undo-шаг — onResizeMove обновляет lastWidth лишь на фактическом изменении.
    const changed = activeResize.lastWidth !== activeResize.startWidth
    activeResize = null
    dragging.value = false
    if (changed) scheduleSnapshot()
  }

  return { isResizing, onMaybeStartResize }
}
