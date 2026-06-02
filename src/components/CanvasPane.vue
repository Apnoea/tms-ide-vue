<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { onClickOutside, useEventListener, useResizeObserver } from '@vueuse/core'
import { dia, shapes } from '@joint/core'
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
  busPortX,
  desiredBusPortCount,
  TEXT_FONT_SIZE,
  TEXT_PADDING_X,
  textCellHeight,
  textCellWidth,
} from '../stencils/svgInjector'
import { LINK_DEFAULTS } from '../stencils/linkDefaults'
import { exportProject, downloadFile } from '../services/exporter'
import { parseSvgProject } from '../services/projectLoader'
import {
  ANIMATION_CLASS_COLORS,
  ANIMATION_CLASS_OPTIONS,
  ANIMATION_OFF_COLOR,
} from '../constants/animation'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from '../composables/useCanvas'
import { nplural } from '../utils/plural'
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

// JointJS shape: контейнер-группа `body`, в которую инжектится shape.svg.
const TMSStencil = dia.Element.define(
  'tms.Stencil',
  {
    size: { width: 120, height: 220 },
    ports: {
      groups: {
        port: {
          position: { name: 'absolute' },
          markup: [{ tagName: 'circle', selector: 'portBody' }],
          attrs: {
            portBody: {
              r: 3,
              fill: '#ffffff',
              stroke: '#06b6d4', // cyan-500 (= primary темы)
              strokeWidth: 1,
              magnet: 'active',
              cursor: 'crosshair',
            },
          },
        },
      },
    },
  },
  {
    // selector 'root' зарезервирован JointJS — используем 'body'
    markup: [{ tagName: 'g', selector: 'body' }],
  }
)

const tmsNamespace = { ...shapes, tms: { Stencil: TMSStencil } }

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

// Resize шины (cell_bus): фиксируем cellId + edge + начальное состояние,
// дальше слушаем document mousemove/mouseup до отпускания кнопки.
let activeResize = null

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

/**
 * Capture-phase mousedown на paperContainer: если клик пришёл по элементу
 * с data-edge — стартуем resize шины и блокируем дальнейшее распространение
 * события (JointJS иначе начнёт обычный element-drag).
 */
function onMaybeStartResize(evt) {
  if (evt.button !== 0) return
  const edge = evt.target?.dataset?.edge
  if (!edge) return

  // Находим DOM-узел JointJS cellView (у него атрибут model-id)
  const cellEl = evt.target.closest('[model-id]')
  const modelId = cellEl?.getAttribute('model-id')
  if (!modelId || !graph) return
  const cell = graph.getCell(modelId)
  if (!cell || cell.get('tms')?.stencilId !== 'cell_bus') return

  evt.stopPropagation()
  evt.preventDefault()
  startBusResize(cell, edge, evt.clientX)
}

/**
 * Старт ресайза шины. Запоминаем исходную геометрию и paper-X курсора —
 * на move будем считать delta в paper-координатах (важно: zoom-инвариантно).
 */
function startBusResize(cell, edge, startClientX) {
  if (!cell || !paper) return
  const pos = cell.get('position')
  const size = cell.get('size')
  const local = paper.clientToLocalPoint(startClientX, 0)
  activeResize = {
    cellId: cell.id,
    edge,
    startWidth: size.width,
    startHeight: size.height,
    startX: pos.x,
    startMouseX: local.x,
  }
  // На время ресайза выделяем шину — пользователь видит, что объект «в фокусе»
  canvas.selectOnly('cell', cell.id)
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(evt) {
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

  // Снап ширины к сетке + защита от шага меньше minW
  newWidth = Math.max(minW, Math.round(newWidth / g) * g)
  // Восстанавливаем X так, чтобы правый край оставался на месте при left-resize
  // после клампа ширины
  if (activeResize.edge === 'left') {
    newX = activeResize.startX + (activeResize.startWidth - newWidth)
  }
  newX = Math.round(newX / g) * g

  cell.resize(newWidth, activeResize.startHeight)
  if (activeResize.edge === 'left') {
    cell.position(newX, cell.get('position').y)
  }

  // Динамически досоздаём/удаляем порты под новую ширину. syncBusPorts
  // идемпотентен и репозиционирует только при реальном изменении координаты —
  // churn'а нет, наездов нет, лишние (за краем) порты удаляются сразу.
  syncBusPorts(cell, newWidth, activeResize.startHeight)

  // Перерисовываем тело шины + резайз-хэндлы под новый размер
  const cellView = paper.findViewByModel(cell)
  if (cellView && stencil) injectStencilSvg(cellView, stencil)
}

/** id'ы портов шины, к которым подключён хотя бы один провод. */
function getLinkedBusPortIds(cell) {
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
 * (это убирает порты, вылезшие за край при сужении)
 * 3) репозиционирует выжившие в канонические координаты — но только если
 * они реально сместились (иначе лишний re-render каждый кадр)
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
  activeResize = null
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  // Порты уже синхронизированы в onResizeMove — здесь только snapshot для undo
  scheduleSnapshot()
}

// ─── Undo/Redo history ───
// Стек snapshot'ов graph.toJSON(). Каждое значимое изменение → debounce 200ms → snapshot.
// JointJS не таскает CommandManager в open-source @joint/core, поэтому минимальная
// своя реализация — full-graph replay; для текущего объёма (десятки ячеек) ок.
const HISTORY_LIMIT = 50
let history = []
let historyIndex = -1
let restoringHistory = false
let snapshotTimer = null

// ─── Auto-save в localStorage ───
// Версионированный ключ — если в будущем поменяем формат JSON, увеличим v и
// устаревшие сохранения просто проигнорируются.
const AUTOSAVE_KEY = 'tms-ide:graph:v1'

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
  useEventListener(paperContainer, 'mousedown', onMaybeStartResize, true)

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

  // ─── Restore из localStorage если есть автосейв ───
  const restored = tryRestoreAutosave()

  // ─── History: snapshot на «стабильных» событиях ───
  // Раньше слушали 'change' — JointJS шлёт его десятки раз во время draw'а линии,
  // дебаунс не всегда схлопывал. Теперь снимаем snapshot только на pointerup
  // (после действия пользователя) и на add/remove (drop из палитры, удаление).
  history = [graph.toJSON()]
  historyIndex = 0

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

  // Прокидываем graph/paper в composable, чтобы Inspector мог читать
  canvas.setCanvasRefs(graph, paper)
  // Регистрируем функции импорта/экспорта чтобы AppHeader мог их триггерить
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

/**
 * Пытается восстановить граф из localStorage. Возвращает кол-во восстановленных
 * ячеек (0 если сейва нет / битый). После загрузки JSON в граф пробегает по
 * ячейкам и переинжектит SVG для каждой tms-ячейки.
 */
function tryRestoreAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return 0
    const json = JSON.parse(raw)
    if (!json?.cells) return 0
    restoringHistory = true
    graph.fromJSON(json)
    reinjectAllStencils(graph, paper)
    // fromJSON делает silent reset — 'add'/'remove' события не летят,
    // graphVersion-листенер не подхватит. Бампаем явно, иначе cellsCount
    // и empty-canvas hint остаются в старом состоянии.
    canvas.bumpVersion()
    restoringHistory = false
    return graph.getElements().length
  } catch (e) {
    console.warn('[Canvas] Не удалось восстановить автосейв', e)
    restoringHistory = false
    return 0
  }
}

// Таймер для индикатора autosave в footer'е — после успешного сохранения
// показываем «✓ Сохранено» 1.5 секунды, потом возвращаемся к «Авто».
let savedFlashTimer = null

function saveAutosave() {
  if (!graph || restoringHistory) return
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(graph.toJSON()))
    canvas.setRecentlySaved(true)
    canvas.setLastSavedAt(Date.now())
    clearTimeout(savedFlashTimer)
    savedFlashTimer = setTimeout(() => canvas.setRecentlySaved(false), 1500)
  } catch (e) {
    // Quota exceeded — не критично, просто пропускаем сохранение
    console.warn('[Canvas] Автосейв упал', e)
  }
}

// Обновляем флаги доступности undo/redo для footer'а.
// Вызываем после каждого изменения history (snapshot, undo, redo, clear).
function syncUndoRedoAvail() {
  canvas.setUndoRedoAvail(historyIndex > 0, historyIndex < history.length - 1)
}

// ─── Undo/Redo ───
function snapshot() {
  if (restoringHistory || !graph) return
  // Если делаем новое действие после серии undo — отрезаем «будущее»
  if (historyIndex < history.length - 1) {
    history = history.slice(0, historyIndex + 1)
  }
  history.push(graph.toJSON())
  historyIndex++
  if (history.length > HISTORY_LIMIT) {
    history.shift()
    historyIndex--
  }
  // Автосейв пишем по тому же триггеру, что и history snapshot —
  // оба отражают «стабильное» состояние после действия пользователя.
  saveAutosave()
  syncUndoRedoAvail()
}

function scheduleSnapshot() {
  if (restoringHistory) return
  clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    snapshot()
  }, 200)
}

function undo() {
  if (historyIndex <= 0) return
  historyIndex--
  restoreFromHistory()
}

function redo() {
  if (historyIndex >= history.length - 1) return
  historyIndex++
  restoreFromHistory()
}

function restoreFromHistory() {
  if (!graph || !paper) return
  restoringHistory = true
  clearTimeout(snapshotTimer)
  snapshotTimer = null

  graph.fromJSON(history[historyIndex])
  reinjectAllStencils(graph, paper)
  // fromJSON делает silent reset — нужно явно бампнуть version, иначе cellsCount
  // и empty-canvas hint застрянут в старом состоянии.
  canvas.bumpVersion()

  canvas.clearSelection()
  restoringHistory = false
  // После undo/redo состояние графа изменилось — сохраняем в autosave,
  // чтобы перезагрузка вкладки давала именно тот результат, что виден сейчас.
  saveAutosave()
  syncUndoRedoAvail()
}

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

// ─── Хоткеи ───
function isFocusInInput(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
// Все хоткеи через единый raw-keydown handler. Используем event.code (физическая
// клавиша), а не event.key (символ) — иначе на нелатинских раскладках
// (русская, немецкая, ...) Ctrl+S, Ctrl+Z, etc. не срабатывают.
function onKeyDown(event) {
  const cmd = event.ctrlKey || event.metaKey
  const code = event.code
  const inInput = isFocusInInput(event.target)

  // ─── Ctrl+F — открыть поиск. Срабатывает даже при фокусе в инпуте
  // (стандартное браузерное find-in-page-поведение, мы его перехватываем). ───
  if (cmd && !event.shiftKey && code === 'KeyF') {
    event.preventDefault()
    event.stopPropagation()
    if (ui.searchOpen) {
      ui.closeSearch()
      nextTick(() => ui.openSearch())
    } else {
      ui.openSearch()
    }
    return
  }

  // ─── F3 — листать совпадения поиска (только когда открыт). ───
  if (code === 'F3') {
    if (!ui.searchOpen) return
    event.preventDefault()
    event.stopPropagation()
    canvas.cycleSearchMatch(event.shiftKey ? -1 : 1)
    return
  }

  // ─── Escape — снять выделение / highlight. ───
  if (code === 'Escape') {
    if (inInput) return
    if (canvas.highlightedTag.value) canvas.clearHighlightedTag()
    if (canvas.selection.value.length) canvas.clearSelection()
    return
  }

  // ─── Ctrl-комбинации (Z/Y/S/O/C/V/D/A). Не срабатывают при фокусе в инпуте. ───
  if (cmd && !inInput) {
    if (code === 'KeyZ') {
      event.preventDefault()
      event.stopPropagation()
      event.shiftKey ? redo() : undo()
      return
    }
    if (code === 'KeyY') {
      event.preventDefault()
      event.stopPropagation()
      redo()
      return
    }
    if (code === 'KeyS') {
      event.preventDefault()
      event.stopPropagation()
      onExport()
      return
    }
    if (code === 'KeyO') {
      event.preventDefault()
      event.stopPropagation()
      window.dispatchEvent(new CustomEvent('tms-open-project'))
      return
    }
    if (code === 'KeyC' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      copySelection()
      return
    }
    if (code === 'KeyV' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      pasteClipboard()
      return
    }
    if (code === 'KeyD') {
      event.preventDefault()
      event.stopPropagation()
      duplicateSelection()
      return
    }
    if (code === 'KeyA') {
      if (!graph) return
      event.preventDefault()
      event.stopPropagation()
      canvas.selectAllCells()
      return
    }
  }

  // ─── Стрелки + Del/Backspace — оставляем как было (event.key для них
  // безопасен, эти клавиши одинаковы во всех раскладках). ───
  const isArrow =
    event.key === 'ArrowUp' ||
    event.key === 'ArrowDown' ||
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight'
  if (isArrow) {
    if (isFocusInInput(event.target) || !graph || !paper) return
    const cellSel = canvas.selection.value.filter((s) => s.kind === 'cell')
    if (!cellSel.length) return
    event.preventDefault()
    event.stopPropagation()
    const grid = paper.options.gridSize || 10
    const step = (event.shiftKey ? 5 : 1) * grid
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    for (const item of cellSel) graph.getCell(item.id)?.translate(dx, dy)
    scheduleSnapshot()
    return
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (isFocusInInput(event.target)) return
  const sel = canvas.selection.value
  if (!sel.length || !graph) return
  event.preventDefault()
  event.stopPropagation()
  for (const item of [...sel]) graph.getCell(item.id)?.remove()
  canvas.clearSelection()
  // PrimeVue Splitter gutter ловит keydown — снимаем фокус явно.
  const active = document.activeElement
  if (active && active !== document.body && typeof active.blur === 'function') active.blur()
}
useEventListener(window, 'keydown', onKeyDown)

onBeforeUnmount(() => {
  // useEventListener/useResizeObserver сами снимаются на unmount — не дублируем.
  // Здесь чистим только document-листенеры, которые вешаются динамически
  // (pan/resize/lasso/drag) и могут остаться висеть, если unmount случился
  // прямо во время операции.
  document.removeEventListener('mousemove', onPanMove)
  document.removeEventListener('mouseup', onPanEnd)
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.removeEventListener('mousemove', onLassoMove)
  document.removeEventListener('mouseup', onLassoEnd)
  document.removeEventListener('pointermove', onDragPointerMove)
  document.removeEventListener('pointerup', onDragPointerUp)
  window.removeEventListener('blur', onDragCancel)
  // Отложенные таймеры: после unmount graph=null, их колбэки безвредны (guard'ы),
  // но чистим, чтобы не держать ссылки на функции компонента.
  clearTimeout(snapshotTimer)
  clearTimeout(savedFlashTimer)
  clearInterval(simIntervalId)
  simIntervalId = null
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
  const finalX = Math.round((x - stencil.width / 2) / g) * g
  const finalY = Math.round((y - stencil.height / 2) / g) * g

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
    const snappedX = Math.round(localX / g) * g
    const snappedY = Math.round(localY / g) * g
    leftPx = snappedX * scale + tx
    topPx = snappedY * scale + ty
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
    if (!clipboard.cells.length) return []
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
    try {
      localStorage.removeItem(AUTOSAVE_KEY)
    } catch {
      /* ignore */
    }
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
  restoringHistory = true
  clearTimeout(snapshotTimer)
  snapshotTimer = null
  graph.clear()
  canvas.bumpVersion()
  restoringHistory = false

  try {
    localStorage.removeItem(AUTOSAVE_KEY)
  } catch {
    /* ignore */
  }

  // Сбрасываем history до текущего пустого состояния
  history = [graph.toJSON()]
  historyIndex = 0
  canvas.clearSelection()
  syncUndoRedoAvail()

  toast.add({
    severity: 'info',
    summary: 'Холст очищен',
    detail: `Удалено ${nplural(count, 'элемент', 'элемента', 'элементов')}`,
    life: TOAST_LIFE.SHORT,
  })
}

// ─── Copy / Paste / Duplicate ячеек + bridge-проводов ───
// Внутренний буфер: { cells: [...], links: [...] }. Не уходит в нативный
// clipboard (не вставится в другую вкладку), теряется на F5. Достаточно для
// «продублировал кусок схемы внутри одного сеанса».
//
// Bridge-провода — линии, у которых ОБА конца лежат в копируемом наборе ячеек.
// Их source/target id'ы на paste'е перевешиваются на новые ячейки через
// oldId → newId маппинг.
let clipboard = { cells: [], links: [] }

function snapshotCell(item) {
  const c = graph?.getCell(item.id)
  if (!c) return null
  const tms = c.get('tms') || {}
  const pos = c.get('position')
  const size = c.get('size')
  return {
    oldId: c.id,
    stencilId: tms.stencilId,
    tms: { ...tms },
    position: { x: pos.x, y: pos.y },
    size: { width: size.width, height: size.height },
  }
}

/** Собирает снимки всех bridge-линий между cellIds (оба конца внутри набора). */
function collectBridgeLinkSnaps(cellIds) {
  if (!graph) return []
  const set = new Set(cellIds)
  const out = []
  for (const link of graph.getLinks()) {
    const s = link.get('source')?.id
    const t = link.get('target')?.id
    if (!s || !t || !set.has(s) || !set.has(t)) continue
    out.push({
      sourceCellId: s,
      targetCellId: t,
      // toJSON сохраняет всё: type, router, attrs, tms (с voltageSource).
      // На paste'е id обнуляется, source/target.id перевешиваются.
      json: link.toJSON(),
    })
  }
  return out
}

function pasteSnapshots(snaps) {
  if (!graph || !paper || !snaps.cells.length) {
    return { added: 0, skipped: 0, linksAdded: 0 }
  }
  const offset = 20
  const oldToNew = new Map()
  const newCellIds = []
  let skipped = 0

  for (const snap of snaps.cells) {
    const stencil = getStencilById(snap.stencilId)
    if (!stencil) {
      skipped++
      continue
    }

    const g = paper.options.gridSize
    const finalX = Math.round((snap.position.x + offset) / g) * g
    const finalY = Math.round((snap.position.y + offset) / g) * g

    const portItems =
      snap.stencilId === 'cell_bus'
        ? computeBusPorts(snap.size.width, snap.size.height)
        : (stencil.ports || []).map((p) => ({
            id: p.name,
            group: 'port',
            args: { x: p.x, y: p.y },
          }))

    // tms копируется полностью включая slots — paste должен сохранять привязки
    // тегов (две копии одного стенсила могут указывать на один и тот же объект,
    // это нормально для мнемосхем где много визуализаций одного агрегата).
    const cell = new TMSStencil({
      position: { x: finalX, y: finalY },
      size: snap.size,
      tms: { ...snap.tms, stencilId: snap.stencilId },
      ports: { items: portItems },
    })
    graph.addCell(cell)
    oldToNew.set(snap.oldId, cell.id)
    newCellIds.push(cell.id)

    const cellView = paper.findViewByModel(cell)
    if (cellView) injectStencilSvg(cellView, stencil)
  }

  // Восстанавливаем bridge-линии: id ячеек перевешиваем через oldToNew,
  // port-id'ы остаются те же (новые ячейки того же стенсила имеют такие же порты).
  let linksAdded = 0
  const newLinkItems = []
  for (const linkSnap of snaps.links) {
    const newSrcId = oldToNew.get(linkSnap.sourceCellId)
    const newTgtId = oldToNew.get(linkSnap.targetCellId)
    if (!newSrcId || !newTgtId) continue
    const linkData = JSON.parse(JSON.stringify(linkSnap.json))
    delete linkData.id // JointJS назначит новый
    linkData.source = { ...linkData.source, id: newSrcId }
    linkData.target = { ...linkData.target, id: newTgtId }
    const linkModel = graph.addCell(linkData)
    if (linkModel) {
      newLinkItems.push({ kind: 'link', id: linkModel.id })
      linksAdded++
    }
  }

  if (newCellIds.length) {
    canvas.setSelection([...newCellIds.map((id) => ({ kind: 'cell', id })), ...newLinkItems])
    scheduleSnapshot()
  }
  return { added: newCellIds.length, skipped, linksAdded }
}

/** Формирует строку для toast'а: «3 ячейки + 2 провода» или варианты. */
function describePasted(added, linksAdded, skipped) {
  const parts = [nplural(added, 'ячейка', 'ячейки', 'ячеек')]
  if (linksAdded > 0) {
    parts.push(nplural(linksAdded, 'провод', 'провода', 'проводов'))
  }
  let out = parts.join(' + ')
  if (skipped > 0) out += ` · пропущено: ${skipped}`
  return out
}

function copySelection() {
  if (!graph) return
  const cellSel = canvas.selection.value.filter((s) => s.kind === 'cell')
  if (!cellSel.length) {
    toast.add({
      severity: 'info',
      summary: 'Нечего копировать',
      detail: 'Выдели хотя бы одну ячейку',
      life: TOAST_LIFE.SHORT,
    })
    return
  }
  const cellIds = cellSel.map((s) => s.id)
  clipboard = {
    cells: cellSel.map(snapshotCell).filter(Boolean),
    links: collectBridgeLinkSnaps(cellIds),
  }
  toast.add({
    severity: 'success',
    summary: 'Скопировано',
    detail: clipboard.links.length
      ? `${nplural(clipboard.cells.length, 'ячейка', 'ячейки', 'ячеек')} + ${nplural(clipboard.links.length, 'провод', 'провода', 'проводов')}`
      : nplural(clipboard.cells.length, 'ячейка', 'ячейки', 'ячеек'),
    life: TOAST_LIFE.SHORT,
  })
}

function pasteClipboard() {
  if (!clipboard.cells.length) {
    toast.add({
      severity: 'info',
      summary: 'Буфер пуст',
      detail: 'Скопируй ячейки через Ctrl+C',
      life: TOAST_LIFE.SHORT,
    })
    return
  }
  const { added, skipped, linksAdded } = pasteSnapshots(clipboard)
  if (added) {
    toast.add({
      severity: 'success',
      summary: 'Вставлено',
      detail: describePasted(added, linksAdded, skipped),
      life: TOAST_LIFE.SHORT,
    })
  } else {
    toast.add({
      severity: 'warn',
      summary: 'Не удалось вставить',
      detail: 'Не удалось создать копии — стенсилы не найдены в реестре',
      life: TOAST_LIFE.NORMAL,
    })
  }
}

function duplicateSelection() {
  if (!graph) return
  const cellSel = canvas.selection.value.filter((s) => s.kind === 'cell')
  if (!cellSel.length) {
    toast.add({
      severity: 'info',
      summary: 'Нечего дублировать',
      detail: 'Выдели хотя бы одну ячейку',
      life: TOAST_LIFE.SHORT,
    })
    return
  }
  const cellIds = cellSel.map((s) => s.id)
  const snaps = {
    cells: cellSel.map(snapshotCell).filter(Boolean),
    links: collectBridgeLinkSnaps(cellIds),
  }
  const { added, skipped, linksAdded } = pasteSnapshots(snaps)
  if (added) {
    toast.add({
      severity: 'success',
      summary: 'Дублировано',
      detail: describePasted(added, linksAdded, skipped),
      life: TOAST_LIFE.SHORT,
    })
  } else {
    toast.add({
      severity: 'warn',
      summary: 'Не удалось дублировать',
      detail: 'Не удалось создать копии — стенсилы не найдены в реестре',
      life: TOAST_LIFE.NORMAL,
    })
  }
}

// ─── Inline-× кнопка удаления выделенной ячейки ───
// HTML-overlay (а не elementTools.Remove): позиция reactive через computed
// от graphVersion + paperViewTick + selection.
const deleteBtn = computed(() => {
  // Touch ref'ы для reactive-зависимости — без чтения computed не пересчитается
  // при изменении графа / pan'е / zoom'е. Это deliberate side-effect.
  canvas.graphVersion.value
  canvas.paperViewTick.value
  const sel = canvas.selection.value
  if (sel.length !== 1 || sel[0].kind !== 'cell') return null
  if (textEditing.value) return null // во время инлайн-edit'а × прячем
  if (!paper || !graph) return null
  const cell = graph.getCell(sel[0].id)
  if (!cell) return null
  const pos = cell.get('position')
  const size = cell.get('size')
  const scale = paper.scale().sx
  const { tx, ty } = paper.translate()
  // anchor: top-right cell'а в container-px; кнопка центрируется на anchor'е
  // через left/top - halfSize (а не через CSS transform), чтобы Tailwind
  // hover:scale-* мог корректно работать поверх позиционирования.
  const HALF = 16 // half of 32px button (PrimeVue Button small rounded)
  // +10 / -10 — кнопка «висит» вне правого верхнего угла ячейки с заметным
  // отступом, не наезжая на содержимое
  const anchorX = (pos.x + size.width) * scale + tx + 10
  const anchorY = pos.y * scale + ty - 10
  return {
    id: cell.id,
    style: {
      left: `${anchorX - HALF}px`,
      top: `${anchorY - HALF}px`,
    },
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
  if (isPanning || activeDragCellId || activeResize || textEditing.value) return

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
  // slot.onoff (для cell_vk) + ВСЕ switchSources.tags. Каждый тег = отдельная
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

// ─── Edit-in-place для cell_text ───
// Double-click открывает HTML-overlay <input> поверх ячейки. SVG-<text>
// прячется (visibility:hidden). Коммит клика-вне ловим document-mousedown
// в capture-фазе — у input'а @blur не срабатывает из-за JointJS preventDefault.
const textEditing = ref(null) // { id, original, style }
const textEditValue = ref('')

// Live-resize ячейки пока юзер печатает. cell.resize не дёргает snapshot —
// финальный snapshot снимется на commit.
watch(textEditValue, (val) => {
  const editing = textEditing.value
  if (!editing || !paper) return
  const cell = graph?.getCell(editing.id)
  if (!cell) return
  const tms = cell.get('tms') || {}
  const fz = tms.fontSize ?? TEXT_FONT_SIZE
  const newCellW = textCellWidth(val, fz, !!tms.bold)
  const currentW = cell.get('size').width
  if (newCellW !== currentW) {
    cell.resize(newCellW, textCellHeight(fz))
    // bumpVersion в свою очередь реактивно перепозиционирует HTML × overlay
    canvas.bumpVersion()
  }
  const scale = paper.scale().sx
  textEditing.value = {
    ...editing,
    style: {
      ...editing.style,
      width: `${Math.max(40, newCellW * scale - TEXT_PADDING_X * scale)}px`,
    },
  }
})

function findCellTextEl(cellId) {
  const cell = graph?.getCell(cellId)
  if (!cell || !paper) return null
  const cellView = paper.findViewByModel(cell)
  return cellView?.el?.querySelector('text') ?? null
}

function startTextEdit(cellId) {
  if (!graph || !paper) return
  const cell = graph.getCell(cellId)
  if (!cell) return
  const tms = cell.get('tms') || {}
  if (tms.stencilId !== 'cell_text') return

  const pos = cell.get('position')
  const size = cell.get('size')
  const scale = paper.scale().sx
  const tr = paper.translate()
  const fontSize = tms.fontSize ?? TEXT_FONT_SIZE

  textEditValue.value = tms.text ?? ''
  textEditing.value = {
    id: cellId,
    original: tms.text ?? '',
    style: {
      left: `${pos.x * scale + tr.tx + TEXT_PADDING_X * scale}px`,
      top: `${pos.y * scale + tr.ty}px`,
      width: `${Math.max(40, size.width * scale - TEXT_PADDING_X * scale)}px`,
      height: `${size.height * scale}px`,
      fontSize: `${fontSize * scale}px`,
      fontWeight: tms.bold ? 'bold' : 'normal',
    },
  }

  // Прячем SVG-текст, чтобы не просвечивал сквозь прозрачный input.
  findCellTextEl(cellId)?.style.setProperty('visibility', 'hidden')

  nextTick(() => textEditorRef.value?.focus())
}

function commitTextEdit() {
  const editing = textEditing.value
  if (!editing) return
  textEditing.value = null

  const cell = graph?.getCell(editing.id)
  // Восстановить видимость SVG-текста независимо от того, был ли изменён текст:
  // при re-inject ниже элемент пересоздаётся, и атрибут визуально сбрасывается;
  // если re-inject не происходит — без restore остался бы скрытым.
  findCellTextEl(editing.id)?.style.removeProperty('visibility')
  if (!cell) return

  const tms = cell.get('tms') || {}
  const stencil = getStencilById(tms.stencilId)
  const newText = textEditValue.value
  if (!stencil || newText === editing.original) return

  cell.set('tms', { ...tms, text: newText })
  // Ресайз под новый текст — ширина адаптивная, высота под шрифт.
  const fz = tms.fontSize ?? TEXT_FONT_SIZE
  cell.resize(textCellWidth(newText, fz, !!tms.bold), textCellHeight(fz))
  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil)
  canvas.bumpVersion()
  scheduleSnapshot()
}

function cancelTextEdit() {
  const editing = textEditing.value
  if (!editing) return
  textEditing.value = null
  findCellTextEl(editing.id)?.style.removeProperty('visibility')
}

// Коммит текста при клике мимо input'а. JointJS preventDefault'ит pointerdown,
// поэтому @blur не срабатывает — ловим клик через onClickOutside.
const textEditorRef = ref(null)
onClickOutside(textEditorRef, () => {
  if (textEditing.value) commitTextEdit()
})

// ─── Симуляция: визуальный цикл animation-классов ───
// Preview анимаций таймером раз в SIM_CYCLE_MS: voltage low→mid→high,
// bool on↔off. Общий цикл = LCM(3,2) = 6 тиков. CSS под .tms-simulating
// инжектим один раз чтобы не протекало в обычный режим.
const SIM_CYCLE_MS = 1500
const SIM_TOTAL_STATES = ANIMATION_CLASS_OPTIONS.length * 2 // voltage × bool
const simulating = ref(false)
let simIntervalId = null
let simIndex = 0
let simCssInjected = false

function injectSimulationCss() {
  if (simCssInjected) return
  const style = document.createElement('style')
  style.id = 'tms-sim-css'
  // Исключения для voltage-stroke селектора:
  // [joint-selector="wrapper"] — у standard.Link широкий невидимый path
  // для хитбокса; без exclusion с !important становится окрашен и толст.
  // .tms-hit-area — наш прозрачный rect-хитбокс у каждой ячейки;
  // без exclusion рисует зелёную «рамку» у стенсилов без своей rect-обёртки.
  const voltageRules = Object.entries(ANIMATION_CLASS_COLORS)
    .map(
      ([cls, hex]) => `
.tms-simulating .${cls},
.tms-simulating .${cls} *:not(text):not([joint-selector="wrapper"]):not(.tms-hit-area) { stroke: ${hex} !important; }
.tms-simulating .${cls} .tms-voltage-fill,
.tms-simulating .${cls}.tms-voltage-fill { fill: ${hex} !important; }`
    )
    .join('\n')
  // Boolean false-classes — те же что навешивает WebScada-рантайм при value=false.
  // animation-off перебивает voltage-классы серым stroke'ом (та же descendant-схема
  // с исключениями для wrapper/hit-area, что и у voltage). В отличие от opacity 0.4
  // эффект чистый — voltage-цвет не «просвечивает» под dim'ом.
  const boolRules = `
.tms-simulating .animation-hidden { display: none !important; }
.tms-simulating .animation-off,
.tms-simulating .animation-off *:not(text):not([joint-selector="wrapper"]):not(.tms-hit-area) { stroke: ${ANIMATION_OFF_COLOR} !important; }
.tms-simulating .animation-off .tms-voltage-fill,
.tms-simulating .animation-off.tms-voltage-fill { fill: ${ANIMATION_OFF_COLOR} !important; }`
  style.textContent = voltageRules + '\n' + boolRules
  document.head.appendChild(style)
  simCssInjected = true
}

/** Снимает все sim-классы — voltage с outer-g, animation-hidden/off с descendants. */
function clearSimClasses() {
  if (!graph || !paper) return
  for (const cell of graph.getCells()) {
    const view = paper.findViewByModel(cell)
    if (!view?.el) continue
    for (const cls of ANIMATION_CLASS_OPTIONS) view.el.classList.remove(cls)
    // animation-off от switchSource висит на outer-g (затемнение всей ячейки),
    // от стенсильного template — на внутренних элементах. Чистим оба места.
    view.el.classList.remove('animation-off')
    for (const el of view.el.querySelectorAll('.animation-hidden, .animation-off')) {
      el.classList.remove('animation-hidden')
      el.classList.remove('animation-off')
    }
  }
}

/** Применяет classы текущего тика: voltage (если voltageSource) + bool-false (по animationTemplate). */
function applySimClass() {
  if (!graph || !paper) return
  const voltageCls = ANIMATION_CLASS_OPTIONS[simIndex % ANIMATION_CLASS_OPTIONS.length]
  // Bool флипается КАЖДЫЙ тик — alarm/ONOFF мерцают «вкл/выкл» в темпе voltage'а.
  // Чётные тики = true (default), нечётные = false (применяем false-классы).
  const boolFalsePhase = simIndex % 2 === 1

  clearSimClasses()

  // Voltage классы на outer-g элементов с voltageSource (cells + links)
  for (const cell of graph.getCells()) {
    const vs = cell.get('tms')?.voltageSource
    if (!vs?.tag) continue
    const view = paper.findViewByModel(cell)
    view?.el?.classList.add(voltageCls)
  }
  // cell_node наследует voltage от соединённого провода (если своего нет)
  for (const cell of graph.getElements()) {
    const tms = cell.get('tms') || {}
    if (tms.stencilId !== 'cell_node' || tms.voltageSource?.tag) continue
    for (const link of graph.getConnectedLinks(cell)) {
      if (link.get('tms')?.voltageSource?.tag) {
        paper.findViewByModel(cell)?.el?.classList.add(voltageCls)
        break
      }
    }
  }

  // Bool-false классы на внутренних элементах ячеек по animationTemplate стенсилов.
  // Generic: для каждого binding'а с when.cases.false.apply.addClass находим
  // нужный элемент по id="animation-{cellId}{idSuffix}" — parser.injectIds
  // удаляет data-anim-suffix и пишет id, поэтому ищем именно по id.
  if (boolFalsePhase) {
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms') || {}
      const stencil = getStencilById(tms.stencilId)
      if (!stencil?.animationTemplate?.length) continue
      const view = paper.findViewByModel(cell)
      if (!view?.el) continue
      for (const tpl of stencil.animationTemplate) {
        const targetId = `animation-${cell.id}${tpl.idSuffix || ''}`
        const el = view.el.querySelector(`[id="${targetId}"]`)
        if (!el) continue
        for (const binding of tpl.bindings || []) {
          const cls = binding.when?.cases?.false?.apply?.addClass
          if (cls) el.classList.add(cls)
        }
      }
    }
    // switchSources: затемняем outer-g на любой false-биндинг. В симуляции
    // достаточно проверить «есть ли хоть один тег» — в реальном рантайме
    // эффект тот же (любой false из N тегов → animation-off на корне).
    for (const cell of graph.getCells()) {
      const ss = cell.get('tms')?.switchSources
      if (!ss?.tags?.length) continue
      const view = paper.findViewByModel(cell)
      view?.el?.classList.add('animation-off')
    }
  }
}

function startSimulation() {
  if (simulating.value || !paper) return
  injectSimulationCss()
  // Класс tms-simulating вешает Vue через :class binding'и на paperContainer
  // (см. template) — реактивно на simulating ref. Manual classList.add тут
  // не нужен; ранее он терялся при re-render'е :class.
  simulating.value = true
  simIndex = 0
  applySimClass()
  simIntervalId = setInterval(() => {
    simIndex = (simIndex + 1) % SIM_TOTAL_STATES
    applySimClass()
  }, SIM_CYCLE_MS)
}

function stopSimulation() {
  clearInterval(simIntervalId)
  simIntervalId = null
  simulating.value = false
  clearSimClasses()
}

function toggleSimulation() {
  if (simulating.value) stopSimulation()
  else startSimulation()
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
  restoringHistory = true
  clearTimeout(snapshotTimer)
  snapshotTimer = null
  graph.clear()
  graph.fromJSON({ cells: parsed.cells })
  // fromJSON использует resetCells — 'add'-event не летит, наш авто-toBack
  // для линий не срабатывает. Отправляем все провода на задний план явно,
  // иначе они накроют ячейки/порты.
  for (const link of graph.getLinks()) link.toBack()
  reinjectAllStencils(graph, paper)
  canvas.bumpVersion()
  restoringHistory = false

  // History начинается с восстановленного состояния — undo не должен «возвращать» к старому
  history = [graph.toJSON()]
  historyIndex = 0
  canvas.clearSelection()
  syncUndoRedoAvail()
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
 * (AppHeader спрашивает ConfirmPopup'ом ДО открытия нативного file-picker'а,
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
      <!-- :class содержит и tms-simulating, и emerald-ring — оба класса
 управляются Vue вместе. Раньше tms-simulating добавлялся через
 classList.add() в startSimulation(), но любой re-render :class
 перетирал весь className атрибут и убивал нашу метку, из-за чего
 CSS-правила .tms-simulating .X переставали работать. -->
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

      <!-- Inline-удаление одиночной выделенной ячейки. Reactive HTML-overlay
 (а не JointJS elementTools.Remove — кэширует позицию, не следует за resize). -->
      <Button
        v-if="deleteBtn"
        v-tooltip.top="'Удалить · Del'"
        icon="pi pi-trash"
        severity="secondary"
        rounded
        size="small"
        class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
        :style="deleteBtn.style"
        aria-label="Удалить ячейку"
        @click="onDeleteSelected"
      />

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
