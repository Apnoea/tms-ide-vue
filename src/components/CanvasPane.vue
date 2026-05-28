<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { dia, shapes } from '@joint/core'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { getStencilById } from '../stencils/registry'
import {
  injectStencilSvg,
  reinjectAllStencils,
  computeBusPorts,
  busPortX,
  desiredBusPortCount,
} from '../stencils/svgInjector'
import { exportProject, downloadFile } from '../services/exporter'
import { getEligiblePrefixes, getUsedPrefixes } from '../stencils/tagMatching'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from '../composables/useCanvas'
import { nplural } from '../utils/plural'
import PrefixPickerDialog from './PrefixPickerDialog.vue'
import TagPickerDialog from './TagPickerDialog.vue'

const project = useProjectStore()
const ui = useUiStore()
const canvas = useCanvas()
const toast = useToast()
const confirm = useConfirm()

// ──────────────────────────────────────────────────────────────────────
// JointJS shape definition
//
// Минимальная обёртка: контейнер-группа `root`, в которую мы потом
// впихнём содержимое нашего shape.svg (после `injectIds`).
// ──────────────────────────────────────────────────────────────────────
const TMSStencil = dia.Element.define(
  'tms.Stencil',
  {
    size: { width: 120, height: 220 },
    // Группы портов в шапке шейпа — JointJS этим занимается общим стилем,
    // позицией (absolute по args.x/y) и magnet-поведением.
    ports: {
      groups: {
        port: {
          position: { name: 'absolute' },
          markup: [{ tagName: 'circle', selector: 'portBody' }],
          attrs: {
            portBody: {
              r: 3,
              fill: '#ffffff',
              stroke: '#10b981',
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

// ──────────────────────────────────────────────────────────────────────
// Vue refs / JointJS state
// ──────────────────────────────────────────────────────────────────────
const paperContainer = ref(null)
let paper = null
let graph = null
let resizeObserver = null

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
 * Возвращает массив link-items, оба конца которых лежат в наборе cellIds.
 * Используется чтобы автоматически добавлять «мостовые» линии в выделение
 * при multi-select ячеек (лассо, Ctrl-клик).
 */
function computeBridgeLinks(cellIds) {
  if (!graph) return []
  const set = new Set(cellIds)
  const out = []
  for (const link of graph.getLinks()) {
    const s = link.get('source')?.id
    const t = link.get('target')?.id
    if (s && t && set.has(s) && set.has(t)) {
      out.push({ kind: 'link', id: link.id })
    }
  }
  return out
}

/**
 * Заменяет выделение на cells + автодобавленные «мостовые» линии между ними.
 */
function selectCellsWithBridges(cellItems) {
  const cellIds = cellItems.map((c) => c.id)
  const bridges = computeBridgeLinks(cellIds)
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
  if (cellView && stencil) injectStencilSvg(cellView, stencil, cell.get('tms')?.prefix || '')
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
 *   1) досоздаёт недостающие порты 0..desired-1 (закрывает «дыры»)
 *   2) удаляет порты с индексом >= desired, КРОМЕ занятых проводом
 *      (это убирает порты, вылезшие за край при сужении)
 *   3) репозиционирует выжившие в канонические координаты — но только если
 *      они реально сместились (иначе лишний re-render каждый кадр)
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

// Счётчики prefix'ов per stencil id — нужны для auto-increment в nextPrefix
// (fallback когда tag-list не загружен или у стенсила нет required-суффиксов)
const counters = new Map()

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

// Цвета сетки. Фон paper'а управляется CSS-ом, грид зашит в SVG-pattern,
// поэтому перерисовываем его явно при смене темы через paper.setGrid().
const GRID_COLOR_LIGHT = '#e2e8f0' // slate-200
const GRID_COLOR_DARK = '#334155' // slate-700

function nextPrefix(stencilId) {
  const n = (counters.get(stencilId) || 0) + 1
  counters.set(stencilId, n)
  // Auto-prefix fallback (когда tag-list не загружен / стенсил без обязательных
  // суффиксов). В нормальном flow prefix приходит из picker'а.
  return `${stencilId}_${n}`
}

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
      name: 'mesh',
      color: ui.darkMode ? GRID_COLOR_DARK : GRID_COLOR_LIGHT,
      thickness: 1,
    },
    // Фон оставляем — JointJS всё равно ставит inline стиль, но CSS с !important
    // в style.css переопределяет его и обеспечивает реактивность по .dark классу.
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
    defaultLink: () =>
      new shapes.standard.Link({
        // manhattan-router строит ортогональные пути, ИЗБЕГАЯ ячеек.
        // step должен совпадать с gridSize холста, чтобы линии ложились на сетку.
        router: {
          name: 'manhattan',
          args: { padding: 10, step: 10 },
        },
        // Углы на изгибах острые — без скругления.
        connector: { name: 'normal' },
        attrs: {
          line: {
            stroke: '#000',
            strokeWidth: 2,
            targetMarker: { type: 'none' },
            sourceMarker: { type: 'none' },
          },
        },
      }),
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
          os.id === srcId && (os.port || null) === srcPort &&
          ot.id === tgtId && (ot.port || null) === tgtPort
        const reverse =
          os.id === tgtId && (os.port || null) === tgtPort &&
          ot.id === srcId && (ot.port || null) === srcPort
        if (same || reverse) return false
      }
      return true
    },
  })

  // Дублирующая страховка: при изменении размеров контейнера
  // (drag сплиттера, ресайз окна) явно пересчитываем размер paper'а.
  resizeObserver = new ResizeObserver(() => {
    if (!paper || !paperContainer.value) return
    paper.setDimensions(
      paperContainer.value.clientWidth,
      paperContainer.value.clientHeight
    )
  })
  resizeObserver.observe(paperContainer.value)

  // ─── Zoom: колесо мыши с центром на курсоре ───
  paperContainer.value.addEventListener('wheel', onWheel, { passive: false })

  // ─── Cursor tracking для status-bar (paper-local координаты) ───
  paperContainer.value.addEventListener('mousemove', onCanvasMouseMove)
  paperContainer.value.addEventListener('mouseleave', onCanvasMouseLeave)

  // ─── Resize шины: capture-phase mousedown ───
  // Хватаем pointerdown ДО JointJS, чтобы он не начал drag'ать шину как ячейку.
  // Триггер — data-edge атрибут на SVG-резайз-хэндле (см. svgInjector.buildBusContent).
  paperContainer.value.addEventListener('mousedown', onMaybeStartResize, true)

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
      const currentCells = canvas.selection.value
        .filter((i) => i.kind === 'cell')
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
        other.set(
          'position',
          { x: startPos.x + dx, y: startPos.y + dy },
          { multiDrag: true }
        )
      }
    }
  })
  paper.on('element:pointerup', () => {
    activeDragCellId = null
    dragSnapshot = null
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

  window.addEventListener('keydown', onKeyDown)

  // Сообщаем о восстановлении уже после монтирования (toast service готов)
  if (restored > 0) {
    toast.add({
      severity: 'info',
      summary: 'Автосейв восстановлен',
      detail: `${nplural(restored, 'ячейка', 'ячейки', 'ячеек')} с прошлой сессии`,
      life: 3500,
    })
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
  canvas.setUndoRedoAvail(
    historyIndex > 0,
    historyIndex < history.length - 1
  )
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
  (sel, prev) => {
    if (!paper) return

    // Снимаем класс со всех ранее выделенных
    const root = paper.el
    root.querySelectorAll('.tms-selected').forEach((node) =>
      node.classList.remove('tms-selected')
    )

    if (!Array.isArray(sel) || sel.length === 0) return
    for (const item of sel) {
      const cell = graph?.getCell(item.id)
      if (!cell) continue
      const view = paper.findViewByModel(cell)
      view?.el?.classList.add('tms-selected')
    }
  },
  { deep: true }
)

// ─── Внешние запросы snapshot'а (Inspector после смены prefix'а и т.п.) ───
// Эти watches должны жить на уровне script setup — внутри async onMounted после
// await они теряют component effectScope и не автоочищаются на unmount.
watch(
  () => canvas.snapshotTick.value,
  () => scheduleSnapshot()
)

// ─── Грид перекрашиваем при переключении темы ───
// Цвет грида зашит в SVG-pattern, dynamic CSS его не достанет — нужен явный
// paper.setGrid() с новым цветом. Фон div'а .joint-paper-background меняется
// отдельно через CSS-rules в style.css.
watch(
  () => ui.darkMode,
  (isDark) => {
    if (!paper) return
    paper.setGrid({
      name: 'mesh',
      color: isDark ? GRID_COLOR_DARK : GRID_COLOR_LIGHT,
      thickness: 1,
    })
  }
)

// ─── Хоткеи: Delete/Backspace и Undo/Redo ───
function isFocusInInput(t) {
  return (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable)
  )
}

function onKeyDown(event) {
  // Undo / Redo
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
    if (isFocusInInput(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
    if (isFocusInInput(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    redo()
    return
  }

  // Escape — снять выделение. Открытые PrimeVue-диалоги закрываются сами
  // (close-on-escape), так что вешать stopPropagation не надо.
  if (event.key === 'Escape') {
    if (isFocusInInput(event.target)) return
    if (canvas.selection.value.length) canvas.clearSelection()
    return
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return

  // Не перехватываем, если пользователь печатает в инпуте/textarea/contenteditable
  if (isFocusInInput(event.target)) return

  const sel = canvas.selection.value
  if (!sel.length || !graph) return
  event.preventDefault()
  event.stopPropagation()
  // Удаляем всех — копию делаем чтобы не итерировать по мутируемому массиву
  for (const item of [...sel]) {
    graph.getCell(item.id)?.remove()
  }
  canvas.clearSelection()

  // PrimeVue Splitter gutter перехватывает фокус на keydown через делегирование
  // и подсвечивает соседнюю панель (палитру) :focus-кольцом. Снимаем фокус
  // явно — событие уже обработано.
  const active = document.activeElement
  if (active && active !== document.body && typeof active.blur === 'function') {
    active.blur()
  }
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  paperContainer.value?.removeEventListener('wheel', onWheel)
  paperContainer.value?.removeEventListener('mousemove', onCanvasMouseMove)
  paperContainer.value?.removeEventListener('mouseleave', onCanvasMouseLeave)
  paperContainer.value?.removeEventListener('mousedown', onMaybeStartResize, true)
  document.removeEventListener('mousemove', onPanMove)
  document.removeEventListener('mouseup', onPanEnd)
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  // Лассо-листенеры обычно снимаются в onLassoEnd, но если unmount случился
  // прямо во время рисования рамки — подчищаем здесь, иначе утечка на document.
  document.removeEventListener('mousemove', onLassoMove)
  document.removeEventListener('mouseup', onLassoEnd)
  // Drag-из-палитры листенеры (вешаются по watch ui.dragging) — на случай
  // unmount'а прямо во время перетаскивания стенсила.
  document.removeEventListener('pointermove', onDragPointerMove)
  document.removeEventListener('pointerup', onDragPointerUp)
  window.removeEventListener('blur', onDragCancel)
  window.removeEventListener('keydown', onKeyDown)
  // Отложенные таймеры: после unmount graph=null, их колбэки безвредны (guard'ы),
  // но чистим, чтобы не держать ссылки на функции компонента.
  clearTimeout(snapshotTimer)
  clearTimeout(savedFlashTimer)
  canvas.clearCanvasRefs()
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
    const currentCells = canvas.selection.value
      .filter((i) => i.kind === 'cell')
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
}

/**
 * Создаёт ячейку из стенсила в указанной точке (paper-координаты центра).
 * Если prefix не задан — берёт автоинкремент через nextPrefix.
 * extraTms — дополнительные поля для tms (напр. {valueTag: 'PS031TN001.UA'}).
 */
function createStencilAt(stencilId, x, y, forcedPrefix = null, extraTms = null) {
  if (!graph || !paper) return

  const stencil = getStencilById(stencilId)
  if (!stencil) {
    console.warn(`[Canvas] Стенсил "${stencilId}" не найден в реестре`)
    return
  }

  const prefix = forcedPrefix || nextPrefix(stencilId)

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

  // meta для экспорта: какой стенсил + prefix. Текстовое поле дополнительно
  // хранит редактируемое содержимое в tms.text; cell_value — выбранный тег.
  const tms = { stencilId, prefix }
  if (stencilId === 'cell_text') tms.text = stencil.defaultText ?? 'Текст'
  if (stencilId === 'cell_value') tms.valueTag = ''
  if (extraTms) Object.assign(tms, extraTms)

  const cell = new TMSStencil({
    position: { x: finalX, y: finalY },
    size: { width: stencil.width, height: stencil.height },
    tms,
    ports: { items: portItems },
  })
  graph.addCell(cell)

  // После рендера cell'а в DOM — впихнуть наш SVG в его body-группу
  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil, prefix)
}

// ─── Drag-drop из палитры с preview-overlay ───

// Координаты курсора внутри paperContainer (для позиционирования preview)
const cursorX = ref(-1000)
const cursorY = ref(-1000)

const previewVisible = computed(() => ui.dragging !== null && cursorX.value >= 0)
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

// ─── Prefix picker state (открывается при drop'е, если tag-list загружен) ───
const pickerOpen = ref(false)
const pickerOptions = ref([])
const pickerStencilLabel = ref('')
const pickerTagSuffixes = ref([])
const pendingDrop = ref(null) // { stencilId, x, y }

// ─── Tag picker state (для cell_value: выбор отображаемого полного тега) ───
const valueTagPickerOpen = ref(false)
const pendingValueDrop = ref(null) // { stencilId, x, y }

/**
 * Размещает стенсил в точке (paper-координаты). Решает, нужен ли picker
 * выбора prefix'а: tag-less стенсилы и режим без tag-list'а создаются сразу,
 * иначе — фильтр подходящих prefix'ов из tag-list.
 */
function placeStencil(stencilId, point) {
  const stencil = getStencilById(stencilId)
  if (!stencil) return

  // cell_value — спецслучай: при загруженном tag-list'е открываем picker
  // полного тега (label/единица определятся по суффиксу). Без tag-list'а —
  // создаём без тега, пользователь выберет позже через инспектор.
  if (stencilId === 'cell_value') {
    if (!project.tags.length) {
      createStencilAt(stencilId, point.x, point.y)
      return
    }
    pendingValueDrop.value = { stencilId, x: point.x, y: point.y }
    valueTagPickerOpen.value = true
    return
  }

  // Tag-less стенсилы (шина, текст, заземление) — сразу с auto-prefix
  const required = (stencil.tagSuffixes || []).filter((s) => s.required)
  if (required.length === 0) {
    createStencilAt(stencilId, point.x, point.y)
    return
  }

  // Tag-list не загружен → fallback на auto-increment
  if (!project.tags.length) {
    createStencilAt(stencilId, point.x, point.y)
    return
  }

  // Tag-list есть → находим подходящие prefix'ы.
  // used фильтруем по stencilId, чтобы разные стенсилы могли сидеть на одном
  // логическом объекте (на одном prefix'е, если у них непересекающиеся суффиксы).
  const used = getUsedPrefixes(graph, stencilId)
  const eligible = getEligiblePrefixes(stencil, project.tags, used)

  if (eligible.length === 0) {
    console.warn(
      `[Canvas] Нет подходящих prefix'ов для ${stencilId} (pattern ${stencil.tagPattern})`
    )
    return
  }

  if (eligible.length === 1) {
    // Единственный вариант — создаём сразу без диалога
    createStencilAt(stencilId, point.x, point.y, eligible[0])
    return
  }

  // Несколько вариантов — показываем picker
  pendingDrop.value = { stencilId, x: point.x, y: point.y }
  pickerOptions.value = eligible
  pickerStencilLabel.value = stencil.label
  pickerTagSuffixes.value = stencil.tagSuffixes || []
  pickerOpen.value = true
}

function onPickerSelect(prefix) {
  const p = pendingDrop.value
  if (!p) return
  createStencilAt(p.stencilId, p.x, p.y, prefix)
  pendingDrop.value = null
}

function onPickerCancel() {
  pendingDrop.value = null
}

function onValueTagPickerSelect(tag) {
  const p = pendingValueDrop.value
  if (!p) return
  createStencilAt(p.stencilId, p.x, p.y, null, { valueTag: tag })
  pendingValueDrop.value = null
}

function onValueTagPickerCancel() {
  pendingValueDrop.value = null
}

// ─── Очистить холст ───
function onClearCanvas() {
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
    header: 'Очистить холст?',
    message: `${nplural(count, 'элемент', 'элемента', 'элементов')} будет удалено. Автосейв тоже сбросится.`,
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
    life: 2500,
  })
}

// ─── Экспорт ───
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
      life: 3000,
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
      nplural(result.linkCount, 'линия', 'линии', 'линий'),
      `${nplural(animCount, 'карточка', 'карточки', 'карточек')} анимаций`,
    ].join(', '),
    life: 4000,
  })
}
</script>

<template>
  <section class="h-full flex flex-col bg-surface-100 dark:bg-surface-950">
    <div
      class="px-4 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 flex items-center justify-between gap-2"
    >
      <h2
        class="text-sm font-semibold text-surface-900 dark:text-surface-50 uppercase tracking-wide"
      >
        Холст
      </h2>
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
        <Button
          v-tooltip.bottom="'Подогнать под контент (не больше 100%)'"
          :label="`${zoomPercent}%`"
          icon="pi pi-arrows-alt"
          severity="secondary"
          text
          size="small"
          class="!font-mono"
          @click="fitToContent"
        />
        <Button
          v-tooltip.bottom="'Очистить холст'"
          icon="pi pi-trash"
          severity="secondary"
          text
          size="small"
          :disabled="canvas.cellsCount.value === 0"
          @click="onClearCanvas"
        />
        <Button
          v-tooltip.bottom="'Экспорт в view.svg и animations.json'"
          label="Экспорт"
          icon="pi pi-download"
          size="small"
          @click="onExport"
        />
      </div>
    </div>

    <div class="flex-1 relative overflow-hidden">
      <div
        ref="paperContainer"
        class="absolute inset-0 bg-white dark:bg-surface-900 cursor-grab"
        role="application"
        aria-label="Холст редактора мнемосхемы"
      ></div>

      <div
        v-show="previewVisible"
        class="absolute pointer-events-none border-2 border-dashed border-primary-500 bg-primary-500/10 rounded transition-opacity"
        :style="previewStyle"
      >
        <div
          class="absolute -top-6 left-0 text-xs font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/80 px-1.5 py-0.5 rounded"
        >
          {{ ui.dragging?.label }}
        </div>
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

      <!-- Empty canvas hint — показываем когда нет ячеек и не идёт drag -->
      <div
        v-if="canvas.cellsCount.value === 0 && !ui.dragging"
        class="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div
          class="text-center text-surface-400 dark:text-surface-500 max-w-xs"
        >
          <i class="pi pi-arrow-circle-left text-3xl mb-3 block opacity-60" />
          <div class="text-sm font-medium text-surface-500 dark:text-surface-400 mb-2">
            Пустой холст
          </div>
          <p class="text-xs leading-relaxed">
            Перетащи стенсил из палитры слева, чтобы начать.<br />
            <span class="text-[11px] opacity-75">
              Колесом — зум · drag по пустому месту — pan ·
              <kbd
                class="px-1 py-0.5 bg-surface-100 dark:bg-surface-800 rounded text-[10px] font-mono"
                >Del</kbd
              >
              — удалить ·
              <kbd
                class="px-1 py-0.5 bg-surface-100 dark:bg-surface-800 rounded text-[10px] font-mono"
                >Ctrl+Z</kbd
              >
              — undo
            </span>
          </p>
        </div>
      </div>

      <!-- Canvas info-bar: координаты курсора + выделение. Плавает в правом нижнем
           углу, появляется только когда есть что показать (курсор над холстом или
           что-то выделено). Не влияет на ширину футера. -->
      <div
        v-if="canvas.cursorLocal.value || canvas.selectionLabel.value"
        class="absolute bottom-2 right-2 pointer-events-none flex items-center gap-2 px-2 py-1 rounded bg-surface-0/90 dark:bg-surface-900/90 border border-surface-200 dark:border-surface-700 text-[11px] font-mono text-surface-500 dark:text-surface-400 shadow-sm backdrop-blur-sm"
      >
        <span v-if="canvas.cursorLocal.value">
          {{ canvas.cursorLocal.value.x }}, {{ canvas.cursorLocal.value.y }}
        </span>
        <span
          v-if="canvas.cursorLocal.value && canvas.selectionLabel.value"
          class="text-surface-300 dark:text-surface-700"
        >
          ·
        </span>
        <span
          v-if="canvas.selectionLabel.value"
          class="text-primary-600 dark:text-primary-300"
        >
          {{ canvas.selectionLabel.value }}
        </span>
      </div>
    </div>

    <PrefixPickerDialog
      v-model:visible="pickerOpen"
      :options="pickerOptions"
      :stencil-label="pickerStencilLabel"
      :tag-suffixes="pickerTagSuffixes"
      @select="onPickerSelect"
      @cancel="onPickerCancel"
    />

    <TagPickerDialog
      v-model:visible="valueTagPickerOpen"
      :tags="project.tags"
      header="Выберите тег для отображения значения"
      @select="onValueTagPickerSelect"
      @cancel="onValueTagPickerCancel"
    />
  </section>
</template>
