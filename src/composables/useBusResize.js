import { ref, computed } from 'vue'
import { useEventListener } from '@vueuse/core'
import { getStencilById } from '../stencils/registry'
import { injectStencilSvg } from '../stencils/svgInjector'
import {
  busPortX,
  desiredBusPortCount,
  isBusPortOutOfRange,
  BUS_PORT_SPACING,
} from '../stencils/busCell'
import { snapToGrid } from '../utils/grid'
import { nplural } from '../utils/plural'
import { useNotify } from './useNotify'
import { useCanvas } from './useCanvas'

// Скрытие слота и провода, которые исчезнут после сжатия (оформление — style.css).
const DOOMED_PORT_CLASS = 'tms-port-doomed'
const DOOMED_LINK_CLASS = 'tms-link-doomed'

/**
 * Ресайз шины: drag edge-хэндла меняет ширину, порты досоздаются/удаляются под новую
 * длину. Жест живёт на document-listener'ах параллельно JointJS (внутрь события не
 * уходят); реактивный target у useEventListener сам цепляет и снимает их по dragging.
 *
 * `onMaybeStartResize` вешают на mousedown контейнера в capture-фазе — раньше
 * JointJS, иначе он начнёт свой drag. `isResizing()` нужен потребителям, которым
 * надо подавить свой UI на время жеста (hover-плашка и т.п.).
 */
export function useBusResize({ scheduleSnapshot }) {
  const canvas = useCanvas()
  const notify = useNotify()
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
    if (cell.get('tms')?.locked) return // замок: ресайз запрещён (хэндлы скрыты CSS)
    evt.stopPropagation()
    evt.preventDefault()
    startBusResize(cell, edge, evt.clientX)
  }

  function startBusResize(cell, edge, startClientX) {
    const paper = canvas.paperRef.value
    if (!cell || !paper) return
    const size = cell.get('size')
    // Запоминаем paper-X курсора — delta считаем в paper-координатах
    // (zoom-инвариантно, в отличие от client-px).
    const local = paper.clientToLocalPoint(startClientX, 0)
    activeResize = {
      cellId: cell.id,
      edge,
      startWidth: size.width,
      startHeight: size.height,
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

    const local = paper.clientToLocalPoint(evt.clientX, evt.clientY)
    const dx = local.x - activeResize.startMouseX
    // Левый хэндл растёт при движении влево (dx<0), правый — вправо (dx>0).
    const delta = activeResize.edge === 'right' ? dx : -dx
    // Снап к шагу портов (не к gridSize): один шаг ширины = ровно один слот, и
    // при левом резайзе сдвиг индексов компенсирует сдвиг origin тютелька-в-тютельку.
    const newWidth = Math.max(minW, snapToGrid(activeResize.startWidth + delta, BUS_PORT_SPACING))

    // Width-guard: если шаг snapToGrid дал ту же ширину что в прошлый mousemove,
    // resize/syncBusPorts/injectStencilSvg повторят ту же работу впустую.
    // Особенно injectStencilSvg — он полностью перебирает DOM ячейки.
    if (newWidth === activeResize.lastWidth) return

    // direction держит противоположный край на месте: 'right' → левый край
    // фиксирован (рост вправо), 'left' → правый фиксирован (рост влево, позицию
    // JointJS сдвигает сам — без ручного пересчёта X).
    cell.resize(newWidth, activeResize.startHeight, { direction: activeResize.edge })

    // При левом резайзе origin уезжает влево → канонические порты сместились бы
    // вместе с ним и потащили подключённые провода. Сдвигаем порт-рефы линков на
    // число добавленных/убранных слотов → провода остаются на месте.
    if (activeResize.edge === 'left') {
      // round — на случай шины с шириной не кратной шагу порта (первый кадр).
      const k = Math.round((newWidth - activeResize.lastWidth) / BUS_PORT_SPACING)
      if (k !== 0) shiftBusLinkPorts(cell, k)
    }
    activeResize.lastWidth = newWidth

    syncBusPorts(cell, newWidth, activeResize.startHeight)

    const cellView = paper.findViewByModel(cell)
    if (cellView && stencil) injectStencilSvg(cellView, stencil)

    // Слот за краем и его провод скрываем сразу — виден итог сжатия. Классами, а не
    // удалением: жест обратим. Перевешиваем каждый кадр — syncBusPorts и reinject
    // пересоздают DOM портов.
    markDoomed(cell, newWidth)
  }

  /**
   * Левый резайз сдвигает origin → канонические порты (индекс от левого края)
   * уезжают вместе с ним и тащат подключённые провода. Чтобы провода стояли,
   * сдвигаем порт-РЕФЫ линков на `k` слотов: линк на `top_4` → `top_(4+k)`. Сам
   * порт `top_(4+k)` создаёт `syncBusPorts` на канонической позиции, которая после
   * сдвига origin совпадает со старой абсолютной → провод на месте. Порты НЕ
   * пересоздаём (никакого remove/add → провода не теряются, без лага). idx<0
   * (срез слева за точку подключения) клампим к 0 — провод липнет к новому краю.
   */
  function shiftBusLinkPorts(cell, k) {
    const graph = canvas.graphRef.value
    if (!graph) return
    for (const link of graph.getConnectedLinks(cell)) {
      for (const end of ['source', 'target']) {
        const ref = link.get(end)
        if (ref?.id !== cell.id || !ref.port) continue
        const us = ref.port.indexOf('_')
        const newIdx = Math.max(0, Number(ref.port.slice(us + 1)) + k)
        link.prop([end, 'port'], `${ref.port.slice(0, us)}_${newIdx}`)
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

  /** Провода, чей конец сидит на слоте за краем шины такой ширины. */
  function linksBeyondWidth(cell, width) {
    const graph = canvas.graphRef.value
    if (!graph) return []
    const out = new Set()
    for (const link of graph.getConnectedLinks(cell)) {
      for (const end of ['source', 'target']) {
        const ref = link.get(end)
        if (ref?.id !== cell.id || !ref.port) continue
        if (isBusPortOutOfRange(ref.port, width)) out.add(link)
      }
    }
    return [...out]
  }

  /** Прячет слоты за краем шины и их провода (CSS в style.css). */
  function markDoomed(cell, width) {
    const paper = canvas.paperRef.value
    if (!paper) return
    clearDoomed()
    const view = paper.findViewByModel(cell)
    for (const node of view?.el?.querySelectorAll('[port]') || []) {
      if (isBusPortOutOfRange(node.getAttribute('port'), width)) {
        node.classList.add(DOOMED_PORT_CLASS)
      }
    }
    for (const link of linksBeyondWidth(cell, width)) {
      paper.findViewByModel(link)?.el?.classList.add(DOOMED_LINK_CLASS)
    }
  }

  /** Вернуть скрытое (конец жеста или ширина вернулась). */
  function clearDoomed() {
    const paper = canvas.paperRef.value
    if (!paper) return
    for (const cls of [DOOMED_PORT_CLASS, DOOMED_LINK_CLASS]) {
      paper.el.querySelectorAll(`.${cls}`).forEach((n) => n.classList.remove(cls))
    }
  }

  /**
   * Провода на исчезнувших слотах удаляем на КОНЦЕ жеста: во время протяжки они лишь
   * скрыты (markDoomed), поэтому лишний рывок мышью ничего не рвёт. Оставить их нельзя
   * — порт висел бы правее тела шины, а после reload (`computeBusPorts` создаёт только
   * слоты в пределах ширины) конец уехал бы в центр.
   * Возвращает число удалённых.
   */
  function dropLinksBeyondWidth(cell, width) {
    const doomed = linksBeyondWidth(cell, width)
    for (const link of doomed) link.remove()
    return doomed.length
  }

  function onResizeEnd() {
    if (!activeResize) return
    // Snapshot только если ширина реально менялась. Клик по хэндлу без движения
    // (или дёрганье в пределах одного grid-шага) не должен порождать «пустой»
    // undo-шаг — onResizeMove обновляет lastWidth лишь на фактическом изменении.
    const changed = activeResize.lastWidth !== activeResize.startWidth
    const graph = canvas.graphRef.value
    const cell = graph?.getCell(activeResize.cellId)
    const width = activeResize.lastWidth
    const height = activeResize.startHeight
    activeResize = null
    dragging.value = false
    clearDoomed()
    if (!changed) return

    if (cell) {
      const removed = dropLinksBeyondWidth(cell, width)
      if (removed) {
        // Порты освободились — второй проход их снимет (первый оставлял занятые).
        syncBusPorts(cell, width, height)
        const paper = canvas.paperRef.value
        const stencil = getStencilById(cell.get('tms')?.stencilId)
        const view = paper?.findViewByModel(cell)
        if (view && stencil) injectStencilSvg(view, stencil)
        notify.warn(
          'Шина сжата',
          `${nplural(removed, 'провод отключён', 'провода отключены', 'проводов отключено')}: точка подключения вышла за край`
        )
      }
    }
    scheduleSnapshot()
  }

  return { isResizing, onMaybeStartResize }
}
