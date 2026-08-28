import { ref, computed } from 'vue'
import { useEventListener } from '@vueuse/core'
import { getStencilById } from '../stencils/registry'
import { injectStencilSvg } from '../stencils/svgInjector'
import {
  busPortX,
  busPortY,
  busPortIndex,
  desiredBusPortCount,
  BUS_PORT_SPACING,
} from '../stencils/busCell'
import { snapToGrid } from '../utils/grid'
import { useCanvas } from './useCanvas'

/**
 * Ресайз шины: drag edge-хэндла меняет ширину, порты пересчитываются под новую
 * длину. Жест живёт на document-listener'ах параллельно JointJS.
 *
 * `onMaybeStartResize` цепляется в capture-фазе, до JointJS, иначе тот начнёт свой
 * drag. `isResizing()` читают те, кто гасит свой UI на время жеста.
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
    // DOM-узел cellView опознаётся по атрибуту model-id.
    const cellEl = evt.target.closest('[model-id]')
    const modelId = cellEl?.getAttribute('model-id')
    const graph = canvas.graphRef.value
    if (!modelId || !graph) return
    const cell = graph.getCell(modelId)
    if (!cell || cell.get('tms')?.stencilId !== 'cell_bus') return
    if (cell.get('tms')?.locked) return // замок: ресайз запрещён (хэндлы скрыты CSS)
    evt.stopPropagation()
    evt.preventDefault()
    startBusResize(cell, edge, evt.clientX)
  }

  function startBusResize(cell, edge, startClientX) {
    const paper = canvas.paperRef.value
    if (!cell || !paper) return
    const size = cell.get('size')
    // paper-X курсора: delta считается в paper-координатах, они zoom-инвариантны.
    const local = paper.clientToLocalPoint(startClientX, 0)
    activeResize = {
      cellId: cell.id,
      edge,
      startWidth: size.width,
      startHeight: size.height,
      startMouseX: local.x,
      // Последняя применённая ширина — guard от re-render'а SVG на каждый mousemove,
      // когда курсор дёргается в пределах одного шага сетки.
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

    const local = paper.clientToLocalPoint(evt.clientX, evt.clientY)
    const dx = local.x - activeResize.startMouseX
    // Левый хэндл растёт при движении влево (dx<0), правый — вправо (dx>0).
    const delta = activeResize.edge === 'right' ? dx : -dx
    // Снап к шагу портов, а не к gridSize: один шаг ширины = один слот, и при левом
    // ресайзе сдвиг индексов ровно компенсирует сдвиг origin.
    const newWidth = Math.max(minW, snapToGrid(activeResize.startWidth + delta, BUS_PORT_SPACING))

    // Width-guard: та же ширина после снапа означала бы повторный resize,
    // syncBusPorts и injectStencilSvg (последний перебирает весь DOM ячейки).
    if (newWidth === activeResize.lastWidth) return

    // direction держит противоположный край на месте: 'right' — фиксирован левый,
    // 'left' — правый (позицию JointJS сдвигает сам).
    cell.resize(newWidth, activeResize.startHeight, { direction: activeResize.edge })

    // При левом ресайзе origin уезжает влево, и порты сместились бы вместе с ним,
    // потащив провода: порт-рефы линков сдвигаются на число добавленных слотов.
    if (activeResize.edge === 'left') {
      // round — на случай шины с шириной не кратной шагу порта (первый кадр).
      const k = Math.round((newWidth - activeResize.lastWidth) / BUS_PORT_SPACING)
      if (k !== 0) shiftBusLinkPorts(cell, k)
    }
    activeResize.lastWidth = newWidth

    // Строго ДО syncBusPorts: тот не удаляет занятые порты, поэтому без клампа за
    // краем оставался бы висячий слот с проводом.
    clampBusLinkPorts(cell, newWidth)

    syncBusPorts(cell, newWidth, activeResize.startHeight)

    const cellView = paper.findViewByModel(cell)
    if (cellView && stencil) injectStencilSvg(cellView, stencil)
  }

  /**
   * Левый резайз сдвигает origin, и канонические порты уехали бы вместе с ним,
   * потащив провода. Поэтому сдвигаем порт-РЕФЫ линков на `k` слотов
   * (`p_4` → `p_(4+k)`): новый порт `syncBusPorts` создаст там, где старый был
   * абсолютно, — провод стоит на месте. Сами порты не пересоздаём (remove/add терял
   * бы провода). Выход за диапазон правит `clampBusLinkPorts`.
   */
  function shiftBusLinkPorts(cell, k) {
    const graph = canvas.graphRef.value
    if (!graph) return
    for (const link of graph.getConnectedLinks(cell)) {
      for (const end of ['source', 'target']) {
        const ref = link.get(end)
        if (ref?.id !== cell.id || !ref.port) continue
        const us = ref.port.indexOf('_')
        const newIdx = Number(ref.port.slice(us + 1)) + k
        link.prop([end, 'port'], `${ref.port.slice(0, us)}_${newIdx}`)
      }
    }
  }

  /**
   * Прижимает порт-рефы линков к существующим слотам `0..desired-1`: сжатие уводит
   * крайние за границу (справа индекс >= desired, слева — отрицательный), и провод
   * переезжает на крайний слот вместо того, чтобы висеть на несуществующем порту
   * (после reload `computeBusPorts` его не создаст → конец уехал бы в центр шины).
   */
  function clampBusLinkPorts(cell, width) {
    const graph = canvas.graphRef.value
    if (!graph) return
    const last = desiredBusPortCount(width) - 1
    for (const link of graph.getConnectedLinks(cell)) {
      for (const end of ['source', 'target']) {
        const ref = link.get(end)
        if (ref?.id !== cell.id || !ref.port) continue
        const idx = busPortIndex(ref.port)
        if (!Number.isFinite(idx)) continue
        const clamped = Math.min(Math.max(0, idx), last)
        if (clamped === idx) continue
        const us = ref.port.indexOf('_')
        link.prop([end, 'port'], `${ref.port.slice(0, us)}_${clamped}`)
      }
    }
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
    const targetY = busPortY(height)

    for (let i = 0; i < desired; i++) {
      if (!cell.hasPort(`p_${i}`)) {
        cell.addPort({ id: `p_${i}`, group: 'port', args: { x: busPortX(i), y: targetY } })
      }
    }

    const linked = getLinkedBusPortIds(cell)
    for (const p of cell.getPorts()) {
      const idx = busPortIndex(p.id)
      if (idx >= desired && !linked.has(p.id)) {
        cell.removePort(p.id)
        continue
      }
      const targetX = busPortX(idx)
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
    if (!changed) return
    scheduleSnapshot()
  }

  return { isResizing, onMaybeStartResize }
}
