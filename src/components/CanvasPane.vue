<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from '../stencils/tmsStencil'
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { getStencilById } from '../stencils/registry'
import {
  injectStencilSvg,
  reinjectAllStencils,
  computeBusPorts,
  TEXT_FONT_SIZE,
  textCellHeight,
  textCellWidth,
} from '../stencils/svgInjector'
import { LINK_DEFAULTS } from '../stencils/linkDefaults'
import { exportProject, downloadFile } from '../services/exporter'
import { parseSvgProject } from '../services/projectLoader'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from '../composables/useCanvas'
import { useAutosave } from '../composables/useAutosave'
import { useUndoRedo } from '../composables/useUndoRedo'
import { useBusResize } from '../composables/useBusResize'
import { useSimulation } from '../composables/useSimulation'
import { useTextEdit } from '../composables/useTextEdit'
import { useClipboard } from '../composables/useClipboard'
import { useHotkeys } from '../composables/useHotkeys'
import { nplural } from '../utils/plural'
import { snapToGrid } from '../utils/grid'
import { computeBridgeLinks } from '../utils/bridgeLinks'
import { cellHasTag } from '../utils/cellSearch'
import { TOAST_LIFE } from '../constants/toast'
import TagPickerDialog from './TagPickerDialog.vue'
import SearchBar from './SearchBar.vue'
import ProjectActions from './ProjectActions.vue'

const project = useProjectStore()
const ui = useUiStore()
const canvas = useCanvas()
const toast = useToast()
const confirm = useConfirm()

// Общий флаг «идёт восстановление графа» — useAutosave и useUndoRedo делят его,
// чтобы не зациклиться snapshot → save → restore → snapshot. Также взводится
// performClearCanvas / performImportFromSvgText на время массовых правок.
const restoringHistory = ref(false)
const { tryRestoreAutosave, saveAutosave, clearAutosave } = useAutosave({ restoringHistory })
const { initHistory, scheduleSnapshot, undo, redo, cancelPendingSnapshot } = useUndoRedo({
  restoringHistory,
  saveAutosave,
})
const bus = useBusResize({ scheduleSnapshot })
const { simulating, toggleSimulation } = useSimulation()
const { textEditing, textEditValue, textEditorRef, startTextEdit, commitTextEdit, cancelTextEdit } =
  useTextEdit({ scheduleSnapshot })
const { copySelection, pasteClipboard, duplicateSelection, hasClipboard } = useClipboard({
  scheduleSnapshot,
})
// useHotkeys навешивает window-keydown listener (через useEventListener — auto-cleanup).
// onExport объявлен ниже как function declaration, поэтому ссылка стабильна.
useHotkeys({
  undo,
  redo,
  scheduleSnapshot,
  copySelection,
  pasteClipboard,
  duplicateSelection,
  onExport,
})

// ─── Vue refs / JointJS state ───
const paperContainer = ref(null)
let paper = null
let graph = null

// ─── Zoom & Pan state ───
// zoomPercent живёт в useCanvas — нужен и status-bar'у в AppFooter
const zoomPercent = canvas.zoomPercent
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

let isPanning = false
let panStart = null

// Multi-drag: id ячейки, за которую пользователь начал drag, и снимок
// исходных позиций всех selected-ячеек. Очищается на element:pointerup.
let activeDragCellId = null
let dragSnapshot = null

/**
 * Заменяет выделение на cells + автодобавленные «мостовые» линии между ними.
 * computeBridgeLinks вынесен в utils/bridgeLinks.js — общая логика c useCanvas.
 */
function selectCellsWithBridges(cellItems) {
  const cellIds = cellItems.map((c) => c.id)
  const bridges = computeBridgeLinks(graph, cellIds)
  canvas.setSelection([...cellItems, ...bridges])
}

function prepareMultiDrag(cellId) {
  if (!canvas.isSelected(cellId) || canvas.selection.value.length < 2) {
    activeDragCellId = null
    dragSnapshot = null
    return
  }
  activeDragCellId = cellId
  dragSnapshot = {}
  for (const item of canvas.selection.value) {
    if (item.kind !== 'cell') continue
    const c = graph?.getCell(item.id)
    if (c) {
      const p = c.get('position')
      dragSnapshot[item.id] = { x: p.x, y: p.y }
    }
  }
}

// ─── Resize шины (cell_bus), undo/redo, autosave — вынесены в composables.
// onMaybeStartResize вешается на mousedown в onMounted; isResizing() читают
// hover-tooltip и прочие места, которым нужно подавлять UI пока тянем edge.

const GRID_COLOR = '#e2e8f0' // slate-200

onMounted(async () => {
  if (!paperContainer.value) return

  // Ждём, пока Splitter PrimeVue распределит размеры по панелям —
  // иначе clientWidth/Height окажутся слишком маленькими на момент создания paper'а.
  await nextTick()

  graph = new dia.Graph({}, { cellNamespace: tmsNamespace })

  paper = new dia.Paper({
    el: paperContainer.value,
    model: graph,
    width: '100%',
    height: '100%',
    gridSize: 10,
    drawGrid: {
      name: 'dot',
      color: GRID_COLOR,
      thickness: 1,
    },
    // CSS с !important в style.css переопределяет inline-стиль JointJS.
    background: { color: '#f8fafc' },
    cellViewNamespace: tmsNamespace,
    interactive: true,
    // ─── Конфигурация связей ───
    linkPinning: false, // линии не могут болтаться в воздухе
    // Снэп endpoint'а линии к ближайшему magnet'у в радиусе — пользователю
    // не нужно «целиться» в маленький кружок порта, достаточно бросить линию
    // рядом, JointJS сам подтянет к ближайшему порту ячейки.
    snapLinks: { radius: 30 },
    // Линия заканчивается ровно в позиции anchor'а порта (центр кружка),
    // а не подгоняется под boundary магнита (тогда был бы offset = portRadius).
    // Применяется ко ВСЕМ линиям, независимо от source/target — на paper-уровне.
    defaultConnectionPoint: { name: 'anchor' },
    defaultLink: () => new shapes.standard.Link(LINK_DEFAULTS),
    validateConnection: (sourceView, sourceMagnet, targetView, targetMagnet, _end, linkView) => {
      // запрещаем «на себя» и в воздух (targetMagnet нужен)
      if (sourceView === targetView) return false
      if (!targetMagnet) return false

      // Запрещаем дубль линии между той же парой портов (в любом направлении)
      const srcId = sourceView.model.id
      const tgtId = targetView.model.id
      const srcPort = sourceMagnet?.getAttribute('port') || null
      const tgtPort = targetMagnet?.getAttribute('port') || null
      const drawn = linkView?.model
      for (const link of graph.getLinks()) {
        if (link === drawn) continue
        const os = link.get('source')
        const ot = link.get('target')
        if (!os?.id || !ot?.id) continue
        const same =
          os.id === srcId &&
          (os.port || null) === srcPort &&
          ot.id === tgtId &&
          (ot.port || null) === tgtPort
        const reverse =
          os.id === tgtId &&
          (os.port || null) === tgtPort &&
          ot.id === srcId &&
          (ot.port || null) === srcPort
        if (same || reverse) return false
      }
      return true
    },
  })

  // Перерасчёт размера paper'а при изменении контейнера (drag сплиттера, ресайз окна).
  useResizeObserver(paperContainer, () => {
    if (!paper || !paperContainer.value) return
    paper.setDimensions(paperContainer.value.clientWidth, paperContainer.value.clientHeight)
  })

  // Hook'и paperContainer'а — useEventListener авто-снимает на unmount.
  useEventListener(paperContainer, 'wheel', onWheel, { passive: false })
  useEventListener(paperContainer, 'mousemove', onCanvasMouseMove)
  useEventListener(paperContainer, 'mouseleave', onCanvasMouseLeave)
  // Capture-phase mousedown для resize шины — раньше JointJS, чтобы он не начал drag.
  useEventListener(paperContainer, 'mousedown', bus.onMaybeStartResize, true)

  // ─── Pan vs Lasso на пустой области холста ───
  // Plain LMB-drag = pan; Alt+LMB-drag = lasso (выделение рамкой).
  paper.on('blank:pointerdown', (evt) => {
    if (evt.altKey) {
      startLasso(evt)
    } else {
      onPanStart(evt)
    }
  })
  document.addEventListener('mousemove', onPanMove)
  document.addEventListener('mouseup', onPanEnd)

  // ─── Selection ───
  // Ctrl/Cmd+click — toggle (multi-select); plain click — replace selection.
  // При multi-select ячеек автоматически добавляем линии между ними.
  paper.on('element:pointerdown', (elementView, evt) => {
    const cellId = elementView.model.id
    if (evt.ctrlKey || evt.metaKey) {
      // Toggle этой ячейки в выделении + пересчёт «мостов»
      const currentCells = canvas.selection.value.filter((i) => i.kind === 'cell')
      let nextCells
      if (currentCells.some((c) => c.id === cellId)) {
        nextCells = currentCells.filter((c) => c.id !== cellId)
      } else {
        nextCells = [...currentCells, { kind: 'cell', id: cellId }]
      }
      selectCellsWithBridges(nextCells)
    } else if (!canvas.isSelected(cellId)) {
      canvas.selectOnly('cell', cellId)
    }
    // Если ячейка уже в выделении и нет Ctrl — оставляем как есть (multi-drag).
    prepareMultiDrag(cellId)
  })
  paper.on('link:pointerdown', (linkView, evt) => {
    if (evt.ctrlKey || evt.metaKey) {
      canvas.toggleInSelection('link', linkView.model.id)
    } else if (!canvas.isSelected(linkView.model.id)) {
      canvas.selectOnly('link', linkView.model.id)
    }
  })
  paper.on('blank:pointerdown', (evt) => {
    // Alt-drag запустит lasso, не сбрасываем выделение в этом случае
    if (evt.altKey) return
    canvas.clearSelection()
    // Клик по пустому месту — естественный «выход из подсветки», иначе она
    // зависает пока юзер не нажмёт Escape или кнопку повторно.
    if (canvas.highlightedTag.value) canvas.clearHighlightedTag()
  })

  // ─── Multi-drag: при перетаскивании одной из multi-selected ячеек —
  // синхронно сдвигаем все остальные с тем же delta. opt.multiDrag блокирует
  // рекурсию при программном set('position') у соседей.
  graph.on('change:position', (cell, newPos, opt) => {
    if (opt?.multiDrag) return
    if (!activeDragCellId || cell.id !== activeDragCellId) return
    const start = dragSnapshot?.[cell.id]
    if (!start) return
    const dx = newPos.x - start.x
    const dy = newPos.y - start.y
    for (const item of canvas.selection.value) {
      if (item.id === activeDragCellId || item.kind !== 'cell') continue
      const startPos = dragSnapshot[item.id]
      const other = graph.getCell(item.id)
      if (other && startPos) {
        other.set('position', { x: startPos.x + dx, y: startPos.y + dy }, { multiDrag: true })
      }
    }
  })
  paper.on('element:pointerup', () => {
    activeDragCellId = null
    dragSnapshot = null
  })

  // Double-click по cell_text — открыть inline-редактор поверх ячейки.
  paper.on('element:pointerdblclick', (elementView) => {
    const tms = elementView.model.get('tms') || {}
    if (tms.stencilId === 'cell_text') startTextEdit(elementView.model.id)
  })

  // Hover-tooltip: показываем над ячейкой при mouseenter, прячем при leave.
  // Также скрываем на pointerdown (drag/select), чтобы не висел поверх drag'а.
  paper.on('element:mouseenter', showCellTooltip)
  paper.on('element:mouseleave', hideCellTooltip)
  paper.on('element:pointerdown', hideCellTooltip)
  paper.on('blank:pointerdown', hideCellTooltip)

  // Context menu: правый клик по ячейке / проводу / пустому месту. JointJS
  // сам подавляет нативный browser-контекстменю на своём paper-уровне.
  paper.on('element:contextmenu', (view, evt) => {
    hideCellTooltip()
    showContextMenu({ kind: 'cell', id: view.model.id }, evt)
  })
  paper.on('link:contextmenu', (view, evt) => {
    hideCellTooltip()
    showContextMenu({ kind: 'link', id: view.model.id }, evt)
  })
  paper.on('blank:contextmenu', (evt) => {
    hideCellTooltip()
    showContextMenu(null, evt)
  })

  // ─── Graph change tracking (для Inspector computed-ов) ───
  graph.on('change add remove', () => canvas.bumpVersion())

  // Линии — всегда за ячейками, чтобы порты не перекрывались линией в точке anchor.
  graph.on('add', (cell) => {
    if (cell.isLink && cell.isLink()) cell.toBack()
  })

  // Прокидываем graph/paper в composable ДО tryRestoreAutosave — composable'ы
  // useAutosave / useUndoRedo читают их через canvas.graphRef.value.
  canvas.setCanvasRefs(graph, paper)

  // ─── Restore из localStorage если есть автосейв ───
  const restored = tryRestoreAutosave()

  // ─── History: snapshot на «стабильных» событиях ───
  // Раньше слушали 'change' — JointJS шлёт его десятки раз во время draw'а линии,
  // дебаунс не всегда схлопывал. Теперь снимаем snapshot только на pointerup
  // (после действия пользователя) и на add/remove (drop из палитры, удаление).
  initHistory()

  // Drop элемента из палитры (для линий ждём pointerup, т.к. add'ятся в начале draw'а)
  graph.on('add', (cell) => {
    if (cell.isLink && cell.isLink()) return
    scheduleSnapshot()
  })

  // Удаление любой ячейки/линии
  graph.on('remove', () => scheduleSnapshot())

  // Pointerup на любой cell-view: конец drag'а ячейки, конец draw'а линии,
  // конец редактирования link-tools.
  paper.on('cell:pointerup', () => scheduleSnapshot())

  // Регистрируем функции импорта/экспорта чтобы ProjectActions мог их триггерить
  canvas.setImportFromSvgFn(importFromSvgText)
  canvas.setExportFn(onExport)
  canvas.setFitToContentFn(fitToContent)

  // Сообщаем о восстановлении уже после монтирования (toast service готов)
  if (restored > 0) {
    toast.add({
      severity: 'info',
      summary: 'Автосейв восстановлен',
      detail: `${nplural(restored, 'ячейка', 'ячейки', 'ячеек')} с прошлой сессии`,
      life: TOAST_LIFE.NORMAL,
    })
    // Центрируем viewport на bbox восстановленного контента — иначе ячейки,
    // нарисованные в прошлой сессии где-нибудь в (500, 800), окажутся за
    // пределами видимой области (paper стартует с translate(0,0)).
    // nextTick — чтобы paperContainer успел получить итоговые clientWidth/Height.
    await nextTick()
    fitToContent()
  }
})

// Толщина линий — статичная. Раньше при выделении делали жирнее,
// но визуально это сбивает восприятие схемы; теперь полагаемся на Inspector
// и индикатор «выделено» в canvas info-bar'е.

// ─── Подсветка выделенных элементов ───
// На каждое изменение selection: откатываем стили всех ранее выделенных линий
// + снимаем resize-tools с предыдущих шин, затем накладываем выделение на текущие.
watch(
  () => canvas.selection.value,
  (sel) => {
    if (!paper) return

    // Снимаем класс со всех ранее выделенных
    const root = paper.el
    root.querySelectorAll('.tms-selected').forEach((node) => node.classList.remove('tms-selected'))

    if (!Array.isArray(sel) || sel.length === 0) return
    for (const item of sel) {
      const cell = graph?.getCell(item.id)
      if (!cell) continue
      const view = paper.findViewByModel(cell)
      view?.el?.classList.add('tms-selected')
    }
    // Inline-× реализован как HTML-overlay (см. deleteBtnStyle в template).
    // Раньше использовали JointJS elementTools.Remove, но они кэшируют bbox
    // после addTools и не пересчитывают положение при cell.resize — × «застревал»
    // на старой позиции после ресайза cell_text / cell_bus.
  },
  { deep: true }
)

// ─── Proximity-подсветка портов ───
// JS пишет --port-proximity (0..1) на каждый .joint-port по дистанции до
// курсора в клетках сетки. Формула: max(0, 1 - 0.2 * cells). RAF-throttle.
let portUpdateRaf = null
function scheduleUpdatePortProximity() {
  if (portUpdateRaf) return
  portUpdateRaf = requestAnimationFrame(() => {
    portUpdateRaf = null
    updatePortProximity()
  })
}

function updatePortProximity() {
  if (!paper || !graph) return
  const cursor = canvas.cursorLocal.value
  const gridSize = paper.options.gridSize || 10
  for (const cell of graph.getElements()) {
    const ports = cell.get('ports')?.items || []
    if (!ports.length) continue
    const cellView = paper.findViewByModel(cell)
    if (!cellView?.el) continue
    const pos = cell.get('position')
    for (const port of ports) {
      // JointJS пишет атрибут `port` на ВНУТРЕННЕМ port-body (например circle),
      // не на контейнере .joint-port. Поднимаемся до контейнера через closest —
      // CSS-правило opacity висит на .joint-port (видно/скрыто всё содержимое
      // включая hit-area).
      const portBody = cellView.el.querySelector(`[port="${port.id}"]`)
      const portContainer = portBody?.closest('.joint-port')
      if (!portContainer) continue
      if (!cursor) {
        portContainer.style.removeProperty('--port-proximity')
        continue
      }
      const px = pos.x + (port.args?.x ?? 0)
      const py = pos.y + (port.args?.y ?? 0)
      const dx = px - cursor.x
      const dy = py - cursor.y
      const distCells = Math.sqrt(dx * dx + dy * dy) / gridSize
      const opacity = Math.max(0, 1 - 0.2 * distCells)
      if (opacity > 0) {
        portContainer.style.setProperty('--port-proximity', opacity.toFixed(2))
      } else {
        portContainer.style.removeProperty('--port-proximity')
      }
    }
  }
}

watch(() => canvas.cursorLocal.value, scheduleUpdatePortProximity)

// ─── Подсветка элементов по тегу (кнопка «Подсветить на схеме»). ───
// Watch на canvas.highlightedTag: на set/change перерисовываем класс
// tms-tag-match у всех cells/links с любым tag-полем == tag (см. cellHasTag —
// slots, voltageSource.tag, switchSources.tags, valueTag). Подсветка
// сохраняется через selection-change и pan/zoom (чисто визуальный overlay).
watch(
  () => canvas.highlightedTag.value,
  (tag) => {
    if (!paper) return
    const root = paper.el
    root.querySelectorAll('.tms-tag-match').forEach((n) => n.classList.remove('tms-tag-match'))
    if (!tag || !graph) return
    for (const cell of graph.getCells()) {
      if (!cellHasTag(cell, tag)) continue
      const view = paper.findViewByModel(cell)
      view?.el?.classList.add('tms-tag-match')
    }
  }
)

// ─── Подсветка результатов поиска (Ctrl+F) ───
// Селекшен НЕ трогаем — закрытие поиска не должно сбрасывать выбор.
watch(
  () => [canvas.searchMatchIds.value, canvas.searchCurrentIdx.value],
  ([ids, idx]) => {
    if (!paper) return
    const root = paper.el
    root
      .querySelectorAll('.tms-search-match')
      .forEach((n) => n.classList.remove('tms-search-match'))
    root
      .querySelectorAll('.tms-search-current')
      .forEach((n) => n.classList.remove('tms-search-current'))
    if (!ids.length || !graph) return
    for (let i = 0; i < ids.length; i++) {
      const cell = graph.getCell(ids[i])
      if (!cell) continue
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      view.el.classList.add(i === idx ? 'tms-search-current' : 'tms-search-match')
    }
    centerOnCell(ids[idx])
  }
)

/**
 * Доводим переданную ячейку в центр viewport'а (paper.translate без изменения
 * zoom'а). Если она уже видна целиком — не двигаем (избегаем дёрганья при
 * Enter-листании близких match'ей). bbox считается в model-координатах,
 * проектируем на экран через текущий paper.scale().
 */
function centerOnCell(cellId) {
  if (!paper || !graph || !cellId || !paperContainer.value) return
  const cell = graph.getCell(cellId)
  if (!cell) return
  const bbox = cell.getBBox?.()
  if (!bbox) return
  const s = paper.scale().sx
  const { tx, ty } = paper.translate()
  const paperW = paperContainer.value.clientWidth
  const paperH = paperContainer.value.clientHeight
  const screenX = bbox.x * s + tx
  const screenY = bbox.y * s + ty
  const screenW = bbox.width * s
  const screenH = bbox.height * s
  const margin = 40
  const inView =
    screenX >= margin &&
    screenY >= margin &&
    screenX + screenW <= paperW - margin &&
    screenY + screenH <= paperH - margin
  if (inView) return
  const cx = bbox.x + bbox.width / 2
  const cy = bbox.y + bbox.height / 2
  paper.translate(paperW / 2 - cx * s, paperH / 2 - cy * s)
  canvas.bumpPaperView()
}

// ─── Внешние запросы snapshot'а (Inspector после правки слотов и т.п.) ───
// Эти watches должны жить на уровне script setup — внутри async onMounted после
// await они теряют component effectScope и не автоочищаются на unmount.
watch(
  () => canvas.snapshotTick.value,
  () => scheduleSnapshot()
)

onBeforeUnmount(() => {
  // useEventListener/useResizeObserver сами снимаются на unmount — не дублируем.
  // Здесь чистим только document-листенеры, которые вешаются динамически
  // (pan/resize/lasso/drag) и могут остаться висеть, если unmount случился
  // прямо во время операции.
  document.removeEventListener('mousemove', onPanMove)
  document.removeEventListener('mouseup', onPanEnd)
  document.removeEventListener('mousemove', onLassoMove)
  document.removeEventListener('mouseup', onLassoEnd)
  document.removeEventListener('pointermove', onDragPointerMove)
  document.removeEventListener('pointerup', onDragPointerUp)
  window.removeEventListener('blur', onDragCancel)
  // Resize-listener'ы, snapshot-таймеры, sim-интервал — собираются их
  // composable'ами через onBeforeUnmount внутри них.
  canvas.clearCanvasRefs()
  canvas.setImportFromSvgFn(null)
  canvas.setExportFn(null)
  canvas.setFitToContentFn(null)
  paper?.remove()
  paper = null
  graph = null
})

function onCanvasMouseMove(event) {
  if (!paper) return
  const p = paper.clientToLocalPoint(event.clientX, event.clientY)
  canvas.setCursorLocal({ x: Math.round(p.x), y: Math.round(p.y) })
}

function onCanvasMouseLeave() {
  canvas.setCursorLocal(null)
}

function onWheel(event) {
  if (!paper) return
  event.preventDefault()

  const scale = paper.scale().sx
  const delta = event.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale * delta))
  if (newScale === scale) return

  // Зум центрируется на положении курсора:
  // 1) определяем локальную точку (в координатах paper) под курсором ДО зума
  // 2) меняем масштаб
  // 3) смещаем paper так, чтобы та же локальная точка осталась под курсором
  const localBefore = paper.clientToLocalPoint(event.clientX, event.clientY)

  paper.scale(newScale, newScale)

  const localAfter = paper.clientToLocalPoint(event.clientX, event.clientY)
  const dx = (localAfter.x - localBefore.x) * newScale
  const dy = (localAfter.y - localBefore.y) * newScale
  const { tx, ty } = paper.translate()
  paper.translate(tx + dx, ty + dy)

  zoomPercent.value = Math.round(newScale * 100)
  canvas.bumpPaperView()
}

function onPanStart(event) {
  isPanning = true
  const { tx, ty } = paper.translate()
  panStart = {
    clientX: event.clientX,
    clientY: event.clientY,
    tx,
    ty,
  }
  if (paperContainer.value) paperContainer.value.style.cursor = 'grabbing'
}

function onPanMove(event) {
  if (!isPanning || !paper) return
  const dx = event.clientX - panStart.clientX
  const dy = event.clientY - panStart.clientY
  paper.translate(panStart.tx + dx, panStart.ty + dy)
  canvas.bumpPaperView()
}

function onPanEnd() {
  if (!isPanning) return
  isPanning = false
  panStart = null
  if (paperContainer.value) paperContainer.value.style.cursor = ''
}

// ─── Lasso (Alt+LMB drag по пустой области) ───
const lassoRect = ref(null) // { x, y, w, h } в container-координатах для overlay
let lassoActive = false
let lassoStartLocal = null
let lassoStartClient = null
let lassoAdditive = false // если Ctrl/Cmd зажат на старте — добавляем к выделению

function startLasso(evt) {
  lassoActive = true
  lassoAdditive = evt.ctrlKey || evt.metaKey
  lassoStartLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY)
  lassoStartClient = { x: evt.clientX, y: evt.clientY }
  lassoRect.value = { x: 0, y: 0, w: 0, h: 0 }
  document.addEventListener('mousemove', onLassoMove)
  document.addEventListener('mouseup', onLassoEnd)
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
  document.removeEventListener('mousemove', onLassoMove)
  document.removeEventListener('mouseup', onLassoEnd)

  const endLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY)
  const x = Math.min(lassoStartLocal.x, endLocal.x)
  const y = Math.min(lassoStartLocal.y, endLocal.y)
  const w = Math.abs(endLocal.x - lassoStartLocal.x)
  const h = Math.abs(endLocal.y - lassoStartLocal.y)
  lassoRect.value = null

  // Слишком маленькая рамка — игнорируем (клик мимо без перетаскивания)
  if (w < 3 && h < 3) return
  if (!graph) return

  // findModelsInArea ловит только ячейки. Линии между ними добавим автоматически
  // как «мостовые» — это покрывает ожидаемое поведение «выделил группу ячеек =
  // получи и связи между ними».
  const cells = graph.findModelsInArea({ x, y, width: w, height: h })
  const newCells = cells
    .filter((c) => c.isElement && c.isElement())
    .map((c) => ({ kind: 'cell', id: c.id }))

  if (lassoAdditive) {
    // Объединяем с уже выделенными ячейками, дедуплицируя по id
    const currentCells = canvas.selection.value.filter((i) => i.kind === 'cell')
    const ids = new Set(currentCells.map((c) => c.id))
    const merged = [...currentCells]
    for (const item of newCells) {
      if (!ids.has(item.id)) {
        merged.push(item)
        ids.add(item.id)
      }
    }
    selectCellsWithBridges(merged)
  } else {
    selectCellsWithBridges(newCells)
  }
}

function fitToContent() {
  if (!paper || !graph) return

  // Пустой холст — просто сброс
  if (graph.getCells().length === 0) {
    paper.scale(1, 1)
    paper.translate(0, 0)
    zoomPercent.value = 100
    canvas.bumpPaperView()
    return
  }

  // JointJS сам считает bbox контента и масштабирует/смещает paper так,
  // чтобы всё уместилось с указанным отступом.
  // maxScale: 1 — не приближаем больше 100%, чтобы при маленьком контенте
  // он не растягивался во весь экран; только центрируется.
  paper.scaleContentToFit({
    padding: 40,
    minScale: MIN_ZOOM,
    maxScale: 1,
    useModelGeometry: false,
  })

  // После scaleContentToFit контент прижат к верхнему-левому углу с padding'ом.
  // Если он меньше viewport (хитнули maxScale=1), вокруг остаётся пустое поле справа/снизу.
  // Доводим до центра: смещаем так, чтобы bbox контента оказался ровно посередине.
  const bbox = graph.getBBox()
  if (bbox && paperContainer.value) {
    const s = paper.scale().sx
    const paperW = paperContainer.value.clientWidth
    const paperH = paperContainer.value.clientHeight
    const tx = (paperW - bbox.width * s) / 2 - bbox.x * s
    const ty = (paperH - bbox.height * s) / 2 - bbox.y * s
    paper.translate(tx, ty)
  }

  zoomPercent.value = Math.round(paper.scale().sx * 100)
  canvas.bumpPaperView()
}

/**
 * Создаёт ячейку из стенсила в указанной точке (paper-координаты центра).
 * extraTms — дополнительные поля для tms (напр. {valueTag: 'PS031TN001.UA'} или
 * {slots: {onoff: 'PS031.ONOFF'}} при paste/duplicate).
 *
 * Слоты для tag-bindings'ов остаются ПУСТЫМИ при drop'е из палитры — юзер
 * заполнит их в инспекторе. Без выбранных слотов стенсил рендерится как
 * статика, что соответствует mental model «нет привязки = нет анимации».
 */
function createStencilAt(stencilId, x, y, extraTms = null) {
  if (!graph || !paper) return

  const stencil = getStencilById(stencilId)
  if (!stencil) {
    console.warn(`[Canvas] Стенсил"${stencilId}" не найден в реестре`)
    return
  }

  // Снап финальной позиции к сетке, чтобы ячейка падала точно под рамку превью
  const g = paper.options.gridSize
  const finalX = snapToGrid(x - stencil.width / 2, g)
  const finalY = snapToGrid(y - stencil.height / 2, g)

  // Порты — из стенсила, все в группу 'port' с absolute-позиционированием.
  // Шина — спецслучай: количество и id'ы фиксированы, координаты пересчитываются
  // при resize. Так подключённые ранее провода переживают изменение ширины.
  const portItems =
    stencilId === 'cell_bus'
      ? computeBusPorts(stencil.width, stencil.height)
      : (stencil.ports || []).map((p) => ({
          id: p.name,
          group: 'port',
          args: { x: p.x, y: p.y },
        }))

  const tms = { stencilId }
  if (stencilId === 'cell_text') tms.text = stencil.defaultText ?? 'Текст'
  if (stencilId === 'cell_value') tms.valueTag = ''
  if (extraTms) Object.assign(tms, extraTms)

  // cell_text — размер подгоняем под фактический текст, иначе остаётся
  // широкая пустая bbox с inline-X в правом верхнем углу далеко от текста.
  let cellWidth = stencil.width
  let cellHeight = stencil.height
  if (stencilId === 'cell_text') {
    const fz = tms.fontSize ?? TEXT_FONT_SIZE
    cellWidth = textCellWidth(tms.text ?? '', fz, !!tms.bold)
    cellHeight = textCellHeight(fz)
  }

  const cell = new TMSStencil({
    position: { x: finalX, y: finalY },
    size: { width: cellWidth, height: cellHeight },
    tms,
    ports: { items: portItems },
  })
  graph.addCell(cell)

  // После рендера cell'а в DOM — впихнуть наш SVG в его body-группу.
  // injectStencilSvg сам читает cell.id + tms.slots для interpolation.
  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil)
}

// ─── Drag-drop из палитры с preview-overlay ───

// Координаты курсора внутри paperContainer (для позиционирования preview)
const cursorX = ref(-1000)
const cursorY = ref(-1000)

const previewVisible = computed(() => ui.dragging !== null && cursorX.value >= 0)

// SVG-миниатюра для preview-overlay'я при drag'е из палитры — берём ту же
// svgText, что показывается в палитре. Достаём через registry по stencilId.
const draggingStencilSvg = computed(() => {
  const id = ui.dragging?.stencilId
  return id ? getStencilById(id)?.svgText || '' : ''
})
const previewStyle = computed(() => {
  if (!ui.dragging) return {}
  // Масштабируем превью под текущий zoom paper'а — иначе при увеличении/уменьшении
  // холста рамка не совпадает с реальной ячейкой, которая упадёт.
  const scale = (canvas.zoomPercent.value || 100) / 100
  const w = ui.dragging.width * scale
  const h = ui.dragging.height * scale

  // Top-left превью под курсором в container-px
  let leftPx = cursorX.value - w / 2
  let topPx = cursorY.value - h / 2

  // Снап к сетке: переводим в paper-локальные px, округляем до gridSize,
  // возвращаем обратно. Превью теперь лежит ровно туда, куда упадёт ячейка.
  const p = canvas.paperRef.value
  if (p) {
    const g = p.options.gridSize
    const { tx, ty } = p.translate()
    const localX = (leftPx - tx) / scale
    const localY = (topPx - ty) / scale
    leftPx = snapToGrid(localX, g) * scale + tx
    topPx = snapToGrid(localY, g) * scale + ty
  }

  // transform: translate3d вместо left/top — браузер композитит на GPU,
  // не пересчитывает layout/paint при каждом dragover.
  return {
    left: '0',
    top: '0',
    width: `${w}px`,
    height: `${h}px`,
    transform: `translate3d(${leftPx}px, ${topPx}px, 0)`,
    willChange: 'transform',
  }
})

// ─── Drag из палитры на pointer-events ───
// PalettePane выставляет ui.dragging на pointerdown. Здесь watch'им это и
// вешаем document-листенеры — pointermove идёт на полной частоте, превью липнет
// к курсору без задержки нативного DnD.
watch(
  () => ui.dragging,
  (val) => {
    if (val) {
      document.addEventListener('pointermove', onDragPointerMove)
      document.addEventListener('pointerup', onDragPointerUp)
      window.addEventListener('blur', onDragCancel)
    } else {
      document.removeEventListener('pointermove', onDragPointerMove)
      document.removeEventListener('pointerup', onDragPointerUp)
      window.removeEventListener('blur', onDragCancel)
    }
  }
)

function onDragPointerMove(event) {
  if (!ui.dragging || !paperContainer.value) return
  const rect = paperContainer.value.getBoundingClientRect()
  // Координаты курсора относительно холста. Когда курсор над палитрой (слева)
  // получится отрицательный X → previewVisible сам спрячет рамку.
  cursorX.value = event.clientX - rect.left
  cursorY.value = event.clientY - rect.top
}

function onDragPointerUp(event) {
  const stencilId = ui.dragging?.stencilId
  clearPreview() // stopDragging + сброс курсора (watch снимет листенеры)
  if (!stencilId || !paper || !paperContainer.value) return

  // Дроп только если отпустили над холстом (не над палитрой/инспектором/вне окна)
  const rect = paperContainer.value.getBoundingClientRect()
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  if (!inside) return

  const point = paper.clientToLocalPoint(event.clientX, event.clientY)
  placeStencil(stencilId, point)
}

// Drag прервался (Alt+Tab / потеря фокуса окна) — отменяем без дропа.
function onDragCancel() {
  if (ui.dragging) clearPreview()
}

function clearPreview() {
  cursorX.value = -1000
  cursorY.value = -1000
  ui.stopDragging()
}

// ─── Tag picker state (для cell_value: выбор отображаемого полного тега) ───
const valueTagPickerOpen = ref(false)
const pendingValueDrop = ref(null) // { stencilId, x, y }

// ─── Context menu state ───
// ctxTarget — что под правым кликом ({kind,id} | null для blank).
// items вычисляются по таргету: для cell/link разные наборы, для blank — paste.
const ctxMenuRef = ref(null)
const ctxTarget = ref(null)

const ctxItems = computed(() => {
  const t = ctxTarget.value
  // Blank: только paste, и только если в буфере что-то есть
  if (!t) {
    if (!hasClipboard()) return []
    return [
      {
        label: 'Вставить',
        icon: 'pi pi-clone',
        command: pasteClipboard,
      },
    ]
  }

  const cell = graph?.getCell(t.id)
  if (!cell) return []

  if (t.kind === 'cell') {
    return [
      {
        label: 'Дублировать',
        icon: 'pi pi-copy',
        command: () => runOnTarget(t, duplicateSelection),
      },
      {
        label: 'Скопировать',
        icon: 'pi pi-clone',
        command: () => runOnTarget(t, copySelection),
      },
      { separator: true },
      {
        label: 'Удалить',
        icon: 'pi pi-trash',
        command: () => removeCells([t]),
      },
    ]
  }

  if (t.kind === 'link') {
    return [
      {
        label: 'Удалить',
        icon: 'pi pi-trash',
        command: () => removeCells([t]),
      },
    ]
  }
  return []
})

/** Выделяет target (если не выделено) и запускает функцию, работающую через selection. */
function runOnTarget(target, fn) {
  if (!canvas.isSelected(target.id)) {
    canvas.selectOnly(target.kind, target.id)
  }
  fn()
}

function removeCells(items) {
  if (!graph) return
  for (const it of items) graph.getCell(it.id)?.remove()
  canvas.clearSelection()
}

/** Показать context-menu для целевого элемента. Также выделяет target,
 * если он не был выделен — стандартный editor-pattern. */
function showContextMenu(target, evt) {
  if (target && !canvas.isSelected(target.id)) {
    canvas.selectOnly(target.kind, target.id)
  }
  ctxTarget.value = target
  // Если меню пустое (blank-клик с пустым буфером) — не показываем рамку без
  // пунктов. PrimeVue ContextMenu при пустом items всё равно рисует контейнер.
  if (!ctxItems.value.length) return
  // PrimeVue ContextMenu.show(MouseEvent) — позиция от clientX/Y
  ctxMenuRef.value?.show(evt)
  // На всякий случай — JointJS обычно сам preventDefault'ит, но дублируем
  if (evt && typeof evt.preventDefault === 'function') evt.preventDefault()
}

/**
 * Размещает стенсил в точке (paper-координаты). Слоты для bindings остаются
 * пустыми — юзер заполнит их в инспекторе. Без слотов стенсил рендерится как
 * статика; runtime получает только те anim-карточки, у которых все слоты
 * выбраны (см. parser.generateAnimations).
 *
 * Исключение — cell_value: при загруженном tag-list'е сразу спрашиваем тег
 * через picker (label/единица определяются по суффиксу тега, иначе ячейка
 * рендерится с пустым label'ом — некрасиво).
 */
function placeStencil(stencilId, point) {
  if (stencilId === 'cell_value' && project.tags.length) {
    pendingValueDrop.value = { stencilId, x: point.x, y: point.y }
    valueTagPickerOpen.value = true
    return
  }
  createStencilAt(stencilId, point.x, point.y)
}

function onValueTagPickerSelect(tag) {
  const p = pendingValueDrop.value
  if (!p) return
  createStencilAt(p.stencilId, p.x, p.y, { valueTag: tag })
  pendingValueDrop.value = null
}

function onValueTagPickerCancel() {
  pendingValueDrop.value = null
}

// ─── Очистить холст ───
// event приходит из @click="onClearCanvas($event)" — нужен ConfirmPopup'у как
// якорь, чтобы всплыть прямо у кнопки-урны. Без target popup упадёт в (0,0).
function onClearCanvas(event) {
  if (!graph) return
  const count = graph.getElements().length + graph.getLinks().length
  if (count === 0) {
    // Уже пусто — на всякий случай вытираем autosave и выходим
    clearAutosave()
    return
  }
  confirm.require({
    target: event.currentTarget,
    message: `Очистить холст? ${nplural(count, 'элемент', 'элемента', 'элементов')} будет удалено.`,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Очистить',
    rejectLabel: 'Отмена',
    acceptProps: { severity: 'danger', size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    accept: () => performClearCanvas(count),
  })
}

function performClearCanvas(count) {
  restoringHistory.value = true
  cancelPendingSnapshot()
  graph.clear()
  canvas.bumpVersion()
  restoringHistory.value = false
  clearAutosave()
  // Сбрасываем history до текущего пустого состояния
  initHistory()
  canvas.clearSelection()

  toast.add({
    severity: 'info',
    summary: 'Холст очищен',
    detail: `Удалено ${nplural(count, 'элемент', 'элемента', 'элементов')}`,
    life: TOAST_LIFE.SHORT,
  })
}

// ─── Inline-кнопки overlay'я выделенной ячейки ───
// HTML-overlay (а не JointJS elementTools.Remove): позиция reactive через
// computed от graphVersion + paperViewTick + selection.
//
// Раскладка (TL/TR/BR от axis-aligned bbox с учётом rotation):
//   TL — повернуть против часовой
//   TR — повернуть по часовой
//   BR — удалить
//
// rotate недоступен для cell_text/cell_value/cell_bus (см. canCellTransform):
// `canTransform=false` в результате — template скрывает две верхние кнопки,
// оставляя только удаление.
const overlayBtns = computed(() => {
  // Touch ref'ы для reactive-зависимости — без чтения computed не пересчитается
  // при изменении графа / pan'е / zoom'е. Это deliberate side-effect.
  canvas.graphVersion.value
  canvas.paperViewTick.value
  const sel = canvas.selection.value
  if (sel.length !== 1 || sel[0].kind !== 'cell') return null
  if (textEditing.value) return null // во время инлайн-edit'а оверлей прячем
  if (!paper || !graph) return null
  const cell = graph.getCell(sel[0].id)
  if (!cell) return null
  const pos = cell.get('position')
  const size = cell.get('size')
  const scale = paper.scale().sx
  const { tx, ty } = paper.translate()
  // Visual AABB с учётом rotation: при 90/270° ширина/высота меняются местами
  // (центр остаётся прежним — JointJS вращает вокруг центра ячейки).
  const angle = (cell.angle() || 0) % 360
  const rot90 = angle === 90 || angle === 270
  const bbW = rot90 ? size.height : size.width
  const bbH = rot90 ? size.width : size.height
  const cx = pos.x + size.width / 2
  const cy = pos.y + size.height / 2
  const left = (cx - bbW / 2) * scale + tx
  const right = (cx + bbW / 2) * scale + tx
  const top = (cy - bbH / 2) * scale + ty
  const bottom = (cy + bbH / 2) * scale + ty
  const HALF = 16 // half of 32px кнопок (rounded small)
  const GAP = 10 // отступ от ячейки чтобы не наезжать на контент
  return {
    id: cell.id,
    canTransform: canCellTransform(cell),
    rotateCcw: { left: `${left - GAP - HALF}px`, top: `${top - GAP - HALF}px` },
    rotateCw: { left: `${right + GAP - HALF}px`, top: `${top - GAP - HALF}px` },
    delete: { left: `${right + GAP - HALF}px`, top: `${bottom + GAP - HALF}px` },
  }
})

/**
 * Бейджи незаполненных required-слотов. Для КАЖДОЙ ячейки на холсте, у которой
 * стенсил декларирует required-слоты И хотя бы один из них пустой, рендерим
 * жёлтый «!» в левом верхнем углу. Pure-info indicator — клик выделяет ячейку
 * + просит инспектор открыть picker первого пустого required-слота.
 *
 * cell_value НЕ обрабатывается: drop-flow для него всегда открывает tag-picker
 * (если tag-list загружен) или вообще не даёт создать ячейку (cancel picker'а
 * = нет cell'а), так что cell_value без valueTag в нормальном flow не бывает.
 */
const slotWarnings = computed(() => {
  // Touch ref'ы для reactive-зависимости — без чтения computed не пересчитается
  // при изменении графа / pan'е / zoom'е. Это deliberate side-effect.
  canvas.graphVersion.value
  canvas.paperViewTick.value
  if (!paper || !graph) return []
  const scale = paper.scale().sx
  const { tx, ty } = paper.translate()
  const out = []
  for (const cell of graph.getElements()) {
    const tms = cell.get('tms') || {}
    const stencil = getStencilById(tms.stencilId)
    const slots = stencil?.slots
    if (!slots?.length) continue
    const slotValues = tms.slots || {}
    const missing = slots.filter((s) => s.required && !slotValues[s.key])
    if (!missing.length) continue
    const pos = cell.get('position')
    const size = cell.get('size')
    // Бейдж 12px в правом-нижнем углу ячейки, центрирован на угле.
    // Левый-верхний угол занимает delete-кнопка при selected-состоянии.
    out.push({
      cellId: cell.id,
      missingLabels: missing.map((s) => s.label).join(', '),
      style: {
        left: `${(pos.x + size.width) * scale + tx - 6}px`,
        top: `${(pos.y + size.height) * scale + ty - 6}px`,
      },
    })
  }
  return out
})

/**
 * Клик по жёлтому slot-warning бейджу: выделяем ячейку и просим инспектор
 * открыть picker первого пустого required-слота. Инспектор слушает
 * canvas.slotPickRequest и делает дальше — мы только эмитим intent.
 */
function onSlotBadgeClick(cellId) {
  canvas.selectOnly('cell', cellId)
  canvas.requestSlotPick(cellId)
}

function onDeleteSelected() {
  const sel = canvas.selection.value
  if (sel.length !== 1 || sel[0].kind !== 'cell' || !graph) return
  graph.getCell(sel[0].id)?.remove()
  canvas.clearSelection()
}

// ─── Поворот выделенной ячейки ───
// Контентозависимые стенсилы (текст, числовое значение, шина) после rotation
// становятся нечитаемыми / ломаются по resize, поэтому для них трансформ
// заблокирован — оверлейные кнопки rotate не рендерятся.
const TRANSFORM_FREE_STENCILS = new Set(['cell_text', 'cell_value', 'cell_bus'])
function canCellTransform(cell) {
  return cell && !TRANSFORM_FREE_STENCILS.has(cell.get('tms')?.stencilId)
}

function rotateSelectedBy(delta) {
  if (!graph) return
  const sel = canvas.selection.value.filter((s) => s.kind === 'cell')
  let changed = false
  for (const item of sel) {
    const cell = graph.getCell(item.id)
    if (!canCellTransform(cell)) continue
    cell.rotate(delta)
    changed = true
  }
  if (changed) scheduleSnapshot()
}

// ─── Hover-tooltip над ячейкой ───
// HTML-плашка с лейблом / тегом / счётчиком анимаций. Debounce 150ms на
// mouseenter — иначе мерцает при быстром скольжении между ячейками.
const cellHoverTooltip = ref(null)
let hoverShowTimer = null
const HOVER_DELAY_MS = 400

function showCellTooltip(elementView) {
  clearTimeout(hoverShowTimer)
  hoverShowTimer = setTimeout(() => doShowCellTooltip(elementView), HOVER_DELAY_MS)
}

function doShowCellTooltip(elementView) {
  if (!paper || !graph) return
  // Не показываем во время drag'а / pan'а / resize'а / edit-in-place
  if (isPanning || activeDragCellId || bus.isResizing() || textEditing.value) return

  const cell = elementView.model
  const tms = cell.get('tms') || {}
  const stencil = getStencilById(tms.stencilId)
  if (!stencil) return

  const pos = cell.get('position')
  const size = cell.get('size')
  const scale = paper.scale().sx
  const { tx, ty } = paper.translate()

  // Anchor: top-right ячейки в container-px. Tooltip позиционируем так чтобы
  // его нижний-правый угол прижался к anchor'у с зазором 4px сверху.
  const anchorX = (pos.x + size.width) * scale + tx
  const anchorY = pos.y * scale + ty - 4

  // Текст-превью только для cell_text/cell_value: их содержимое (текст / тег
  // значения) — это собственно «что показывает ячейка», в отдельные tag-строки
  // ниже не попадает. Для object-bound стенсилов идентификатор не дублируем —
  // он будет показан как alarmTag / switchTag / voltageTag ниже.
  let extra = null
  if (tms.stencilId === 'cell_text') {
    const t = (tms.text || '').trim()
    extra = t ? `«${t.length > 32 ? t.slice(0, 32) + '…' : t}»` : 'пустой текст'
  } else if (tms.stencilId === 'cell_value') {
    extra = tms.valueTag || '— тег не выбран —'
  }

  // Алярм/voltage — singular (по одной анимации на ячейку). Switch — массив:
  // slot.onoff (для cell_qw) + ВСЕ switchSources.tags. Каждый тег = отдельная
  // зависимость, в тултипе показываем все, не первый.
  const slotsDef = stencil.slots || []
  const slotValue = (suffix) => {
    const s = slotsDef.find((x) => x.tagSuffix === suffix)
    return s ? tms.slots?.[s.key] || null : null
  }
  const alarmTag = slotValue('.ALR')
  const voltageTag = tms.voltageSource?.tag || null
  const switchTags = []
  const slotOnoff = slotValue('.ONOFF')
  if (slotOnoff) switchTags.push(slotOnoff)
  for (const t of tms.switchSources?.tags || []) {
    if (t && !switchTags.includes(t)) switchTags.push(t)
  }

  cellHoverTooltip.value = {
    style: {
      left: `${anchorX}px`,
      top: `${anchorY}px`,
      transform: 'translate(-100%, -100%)',
    },
    stencilLabel: stencil.label,
    alarmTag,
    voltageTag,
    switchTags,
    extra,
  }
}

function hideCellTooltip() {
  clearTimeout(hoverShowTimer)
  cellHoverTooltip.value = null
}

function onExport() {
  if (!graph) return

  // Передаём paper в exporter — он по нему достанет реальные SVG-пути линий
  // (с учётом manhattan-роутинга), а не straight-lines.
  const result = exportProject(graph, paper)
  if (result.count === 0) {
    toast.add({
      severity: 'warn',
      summary: 'Экспорт',
      detail: 'Холст пуст — нечего экспортировать',
      life: TOAST_LIFE.NORMAL,
    })
    return
  }

  downloadFile('view.svg', result.svgText, 'image/svg+xml')
  downloadFile('animations.json', result.animationsJson, 'application/json')

  const animCount = Object.keys(result.animations.animations).length
  toast.add({
    severity: 'success',
    summary: 'Экспорт готов',
    detail: [
      nplural(result.count, 'ячейка', 'ячейки', 'ячеек'),
      nplural(result.linkCount, 'провод', 'провода', 'проводов'),
      `${nplural(animCount, 'карточка', 'карточки', 'карточек')} анимаций`,
    ].join(', '),
    life: TOAST_LIFE.NORMAL,
  })
}

// ─── Импорт SVG (обратная операция экспорту) ───
// Считывает data-tms-meta JSON-атрибуты с ячеек и проводов, реконструирует
// граф через graph.fromJSON, перерисовывает SVG-содержимое стенсилов.
// Заменяет текущее состояние холста; если на холсте есть элементы — confirm.

function performImportFromSvgText(svgText, sourceLabel = 'SVG') {
  if (!graph || !paper) return false
  const parsed = parseSvgProject(svgText)
  if (!parsed.ok) {
    toast.add({
      severity: 'error',
      summary: 'Не удалось загрузить',
      detail: parsed.errors.join('; ') || 'В файле нет ячеек / data-tms-meta',
      life: TOAST_LIFE.LONG,
    })
    return false
  }

  // Сбрасываем текущее состояние (как clear canvas)
  restoringHistory.value = true
  cancelPendingSnapshot()
  graph.clear()
  graph.fromJSON({ cells: parsed.cells })
  // fromJSON использует resetCells — 'add'-event не летит, наш авто-toBack
  // для линий не срабатывает. Отправляем все провода на задний план явно,
  // иначе они накроют ячейки/порты.
  for (const link of graph.getLinks()) link.toBack()
  reinjectAllStencils(graph, paper)
  canvas.bumpVersion()
  restoringHistory.value = false

  // History начинается с восстановленного состояния — undo не должен «возвращать» к старому
  initHistory()
  canvas.clearSelection()
  saveAutosave()

  const cellsAdded = graph.getElements().length
  const linksAdded = graph.getLinks().length
  toast.add({
    severity: 'success',
    summary: `Загружен ${sourceLabel}`,
    detail: `${nplural(cellsAdded, 'ячейка', 'ячейки', 'ячеек')}, ${nplural(linksAdded, 'провод', 'провода', 'проводов')}${parsed.errors.length ? ` · предупреждений: ${parsed.errors.length}` : ''}`,
    life: TOAST_LIFE.NORMAL,
  })
  if (parsed.errors.length) {
    console.warn('[Canvas] Импорт SVG с предупреждениями:', parsed.errors)
  }
  // После замены графа — центрируем viewport на bbox нового контента
  // (то же что кнопка «100%»). Иначе бы текущий pan/zoom от старой схемы
  // мог увести загруженную схему за пределы видимой области.
  fitToContent()
  return true
}

/**
 * Внешний entry point: заменяет состояние холста на распарсенный из SVG граф.
 * Подтверждение у юзера (при непустом холсте) — ответственность caller'а
 * (ProjectActions спрашивает ConfirmPopup'ом ДО открытия нативного file-picker'а,
 * чтобы попап вылетал чётко у кнопки Open, а не через минуту после клика).
 */
function importFromSvgText(svgText, sourceLabel = 'SVG') {
  if (!graph) return false
  return performImportFromSvgText(svgText, sourceLabel)
}
</script>

<template>
  <section class="h-full flex flex-col bg-surface-100">
    <div
      class="min-h-16 px-4 py-3 border-b border-surface-200 bg-surface-0 flex items-center justify-between gap-2"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Холст</h2>
        <span class="text-surface-300 mx-1">|</span>
        <ProjectActions />
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-tooltip.bottom="'Отменить · Ctrl+Z'"
          icon="pi pi-undo"
          severity="secondary"
          text
          size="small"
          :disabled="!canvas.canUndo.value"
          @click="undo"
        />
        <Button
          v-tooltip.bottom="'Повторить · Ctrl+Y'"
          icon="pi pi-refresh"
          severity="secondary"
          text
          size="small"
          :disabled="!canvas.canRedo.value"
          @click="redo"
        />

        <span class="text-surface-300 mx-1">|</span>

        <Button
          v-tooltip.bottom="'Подогнать (до 100%)'"
          :label="`${zoomPercent}%`"
          icon="pi pi-arrows-alt"
          severity="secondary"
          text
          size="small"
          class="!font-mono"
          @click="fitToContent"
        />
        <Button
          v-tooltip.bottom="simulating ? 'Остановить симуляцию' : 'Запустить симуляцию'"
          :icon="simulating ? 'pi pi-pause-circle' : 'pi pi-play-circle'"
          :severity="simulating ? 'primary' : 'secondary'"
          :text="!simulating"
          size="small"
          aria-label="Toggle simulation"
          @click="toggleSimulation"
        />

        <span class="text-surface-300 mx-1">|</span>

        <Button
          v-tooltip.bottom="'Очистить холст'"
          icon="pi pi-trash"
          severity="secondary"
          text
          size="small"
          :disabled="canvas.cellsCount.value === 0"
          @click="onClearCanvas($event)"
        />
      </div>
    </div>

    <div class="flex-1 relative overflow-hidden">
      <!-- tms-simulating и emerald-ring оба управляются Vue через :class на
 simulating ref (см. useSimulation). Manual classList.add не используем —
 любой re-render :class перетёр бы className и убил бы метку. -->
      <div
        ref="paperContainer"
        class="absolute inset-0 bg-white cursor-grab"
        :class="simulating ? 'tms-simulating ring-2 ring-inset ring-emerald-400/60 ' : ''"
        role="application"
        aria-label="Холст редактора мнемосхемы"
      ></div>

      <!-- Indicator симуляции: PrimeVue Tag в правом верхнем углу холста +
 зелёная inset-рамка вокруг paper'а (см. ring-* в paperContainer).
 pointer-events отключены — это чисто визуальная метка, клик уходит
 на холст под ней. severity=success подтягивает emerald-цвет темы. -->
      <Tag
        v-if="simulating"
        value="Симуляция"
        icon="pi pi-play-circle"
        severity="success"
        class="!absolute !top-3 !right-3 !z-30 pointer-events-none !text-xs !shadow-md"
      />

      <!-- SearchBar (Ctrl+F): плавающая панель поиска в правом верхнем углу.
 Открывается из хоткея, рендерится только когда ui.searchOpen — это
 же триггер для onMounted-автофокуса инпута. Состояние поиска (query,
 matches) живёт в useCanvas. Подсветка на холсте — через watch выше. -->
      <SearchBar v-if="ui.searchOpen" />

      <div
        v-show="previewVisible"
        class="absolute pointer-events-none border-2 border-dashed border-primary-500 bg-primary-500/10 rounded transition-opacity"
        :style="previewStyle"
      >
        <!-- Миниатюра стенсила внутри preview-рамки — то же SVG, что в палитре.
 stencil-thumb-классом подхватываем правило (w/h 100%, block) из style.css. -->
        <div
          v-if="draggingStencilSvg"
          class="stencil-thumb absolute inset-1 opacity-70"
          v-html="draggingStencilSvg"
        />
        <div
          class="absolute -top-6 left-0 text-xs font-medium text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded"
        >
          {{ ui.dragging?.label }}
        </div>
      </div>

      <!-- Edit-in-place для cell_text: прозрачный HTML <input> поверх ячейки.
 SVG-<text> на время edit'а скрыт (см. startTextEdit). Коммит на
 клик-вне ловится через onClickOutside (см. textEditorRef). -->
      <input
        v-if="textEditing"
        ref="textEditorRef"
        v-model="textEditValue"
        type="text"
        class="absolute z-10 p-0 m-0 bg-transparent border-0 outline-none text-black font-sans"
        :style="{ caretColor: 'var(--p-primary-500)', ...textEditing.style }"
        @keydown.enter.prevent="commitTextEdit"
        @keydown.esc.prevent="cancelTextEdit"
      />

      <!-- Hover-tooltip над ячейкой: HTML-плашка с расширенной инфой.
 pointer-events отключены чтобы tooltip не перехватывал клики/hover,
 иначе после mouseenter он бы сам ловил mouseleave при выходе из cell-bbox.
 Fade на исчезновение делает выход с ячейки мягче: появление с задержкой
 400ms (см. HOVER_DELAY_MS), исчезновение — 120ms через Transition. -->
      <Transition
        enter-active-class="transition-opacity duration-100"
        leave-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="cellHoverTooltip"
          class="absolute z-20 pointer-events-none bg-surface-800 text-surface-0 text-[11px] px-2 py-1.5 rounded shadow-lg max-w-[260px] font-sans leading-tight"
          :style="cellHoverTooltip.style"
        >
          <div class="font-semibold text-[11px]">
            {{ cellHoverTooltip.stencilLabel }}
          </div>
          <div
            v-if="cellHoverTooltip.extra"
            class="text-[10px] opacity-75 mt-0.5 font-mono truncate"
          >
            {{ cellHoverTooltip.extra }}
          </div>
          <div
            v-if="cellHoverTooltip.alarmTag"
            class="text-[10px] opacity-75 mt-0.5 flex items-center gap-1 truncate"
          >
            <i class="pi pi-bell text-[6px]" />
            <span class="font-mono truncate">{{ cellHoverTooltip.alarmTag }}</span>
          </div>
          <div
            v-for="(tag, idx) in cellHoverTooltip.switchTags"
            :key="idx"
            class="text-[10px] opacity-75 mt-0.5 flex items-center gap-1 truncate"
          >
            <i class="pi pi-power-off text-[6px]" />
            <span class="font-mono truncate">{{ tag }}</span>
          </div>
          <div
            v-if="cellHoverTooltip.voltageTag"
            class="text-[10px] opacity-75 mt-0.5 flex items-center gap-1 truncate"
          >
            <i class="pi pi-bolt text-[6px]" />
            <span class="font-mono truncate">{{ cellHoverTooltip.voltageTag }}</span>
          </div>
        </div>
      </Transition>

      <!-- Inline-overlay одиночной выделенной ячейки: rotate-ccw /
           rotate-cw / delete. Reactive HTML-overlay (а не JointJS
           elementTools.Remove — кэширует позицию, не следует за resize).
           rotate скрыт для cell_text/cell_value/cell_bus. -->
      <template v-if="overlayBtns">
        <Button
          v-if="overlayBtns.canTransform"
          v-tooltip.top="'Повернуть против часовой'"
          icon="pi pi-undo"
          severity="secondary"
          rounded
          size="small"
          class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
          :style="overlayBtns.rotateCcw"
          @click="rotateSelectedBy(-90)"
        />
        <Button
          v-if="overlayBtns.canTransform"
          v-tooltip.top="'Повернуть по часовой'"
          icon="pi pi-refresh"
          severity="secondary"
          rounded
          size="small"
          class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
          :style="overlayBtns.rotateCw"
          @click="rotateSelectedBy(90)"
        />
        <Button
          v-tooltip.top="'Удалить · Del'"
          icon="pi pi-trash"
          severity="secondary"
          rounded
          size="small"
          class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
          :style="overlayBtns.delete"
          @click="onDeleteSelected"
        />
      </template>

      <!-- Бейджи незаполненных required-слотов. Кликабельны: тык по бейджу
 выделяет ячейку и просит инспектор открыть picker первого пустого
 required-слота. Title с перечислением слотов даёт юзеру понять что
 именно не привязано до клика. -->
      <button
        v-for="badge in slotWarnings"
        :key="`warn-${badge.cellId}`"
        type="button"
        class="absolute z-10 w-3 h-3 rounded-full bg-amber-400 text-surface-900 text-[8px] font-bold leading-none flex items-center justify-center shadow-sm border border-amber-600 hover:scale-125 transition-transform cursor-pointer"
        :style="badge.style"
        :title="`Привязать тег · ${badge.missingLabels}`"
        @click="onSlotBadgeClick(badge.cellId)"
      >
        !
      </button>

      <!-- Floating info-bar: координаты курсора + selection label. Плавает
           внизу-справа холста, появляется только когда есть что показать. -->
      <div
        v-if="canvas.cursorLocal.value || canvas.selectionLabel.value"
        class="absolute bottom-2 right-2 pointer-events-none flex items-center gap-2 px-2 py-1 rounded bg-surface-0/90 border border-surface-200 text-[11px] font-mono text-surface-500 shadow-sm backdrop-blur-sm"
      >
        <span v-if="canvas.cursorLocal.value">
          {{ canvas.cursorLocal.value.x }}, {{ canvas.cursorLocal.value.y }}
        </span>
        <span
          v-if="canvas.cursorLocal.value && canvas.selectionLabel.value"
          class="text-surface-300"
        >
          ·
        </span>
        <span v-if="canvas.selectionLabel.value" class="text-primary-600">
          {{ canvas.selectionLabel.value }}
        </span>
      </div>

      <!-- Lasso overlay (Alt+LMB drag): рамка выделения, координаты в container-px -->
      <div
        v-if="lassoRect"
        class="absolute pointer-events-none border border-primary-500 bg-primary-500/10"
        :style="{
          left: `${lassoRect.x}px`,
          top: `${lassoRect.y}px`,
          width: `${lassoRect.w}px`,
          height: `${lassoRect.h}px`,
        }"
      ></div>

      <!-- Empty canvas hint — показываем когда нет ячеек и не идёт drag.
 Двухшаговый чек-лист: tag-list → стенсил. Первый шаг отмечается ✓
 когда теги загружены, чтобы юзер видел прогресс. -->
      <div
        v-if="canvas.cellsCount.value === 0 && !ui.dragging"
        class="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div class="text-center text-surface-400 px-4">
          <div class="text-sm font-medium text-surface-500">Пустой холст</div>
          <p class="text-xs mt-1">Перетащи стенсил из палитры слева</p>
        </div>
      </div>
    </div>

    <TagPickerDialog
      v-model:visible="valueTagPickerOpen"
      :tags="project.tags"
      header="Выберите тег для отображения значения"
      @select="onValueTagPickerSelect"
      @cancel="onValueTagPickerCancel"
    />

    <ContextMenu ref="ctxMenuRef" :model="ctxItems" />
  </section>
</template>
