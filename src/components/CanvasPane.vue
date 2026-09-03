<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import Tag from 'primevue/tag'
import { useNotify, TOAST_LIFE } from '../composables/useNotify'
import { useConfirm } from 'primevue/useconfirm'
import { normalizeLinkZ, attachLinkTools, syncLinkEndMarkers } from '../stencils/linkDefaults'
import { getStencilById } from '../stencils/registry'
import { injectStencilSvg } from '../stencils/svgInjector'
import {
  createCanvasGraph,
  createCanvasPaper,
  gridColorFor,
  CANVAS_BG_DEFAULT,
} from '../stencils/canvasPaper'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useCanvas } from '../composables/useCanvas'
import { useAutosave } from '../composables/useAutosave'
import { useUndoRedo } from '../composables/useUndoRedo'
import { useBusResize } from '../composables/useBusResize'
import { useSimulation } from '../composables/useSimulation'
import { useTextEdit } from '../composables/useTextEdit'
import { useClipboard } from '../composables/useClipboard'
import { useWireSplice } from '../composables/useWireSplice'
import { useBusSnap } from '../composables/useBusSnap'
import { useProject } from '../composables/useProject'
import { useHotkeys } from '../composables/useHotkeys'
import { useSelectionOverlay } from '../composables/useSelectionOverlay'
import { useHoverTooltip } from '../composables/useHoverTooltip'
import { usePan } from '../composables/usePan'
import { useCanvasZoom, ZOOM_STEP } from '../composables/useCanvasZoom'
import { useCellHighlight } from '../composables/useCellHighlight'
import { useMultiDrag } from '../composables/useMultiDrag'
import { useLasso } from '../composables/useLasso'
import { useCanvasDraw } from '../composables/useCanvasDraw'
import { useCanvasResize } from '../composables/useCanvasResize'
import { useContextMenu } from '../composables/useContextMenu'
import { usePaletteDrag } from '../composables/usePaletteDrag'
import { nplural } from '../utils/plural'
import { withRestoreGuard } from '../utils/restoreGuard'
import { confirmDanger } from '../utils/confirmDanger'
import { computeBridgeLinks } from '../utils/bridgeLinks'
import { cssColor } from '../constants/animation'
import { projectToScreen, rotatedAabb } from '../utils/paperGeom'
import { TEXT_ICON, POLYLINE_ICON } from '../constants/icons'
import SearchBar from './SearchBar.vue'

const project = useProjectStore()
const ui = useUiStore()
const workspace = useWorkspaceStore()
const canvas = useCanvas()

const notify = useNotify()
const confirm = useConfirm()

// Общий флаг «идёт восстановление графа» (useAutosave + useUndoRedo): без него
// snapshot → save → restore зацикливается. Взводится и на массовых правках графа.
const restoringHistory = ref(false)

const {
  restoreProject,
  saveActiveForm,
  clearActiveForm,
  persistMeta,
  replaceProject,
  readTagsText,
  persistForm,
  removeFormPersist,
  loadTrash,
  pushTrash,
  popTrash,
} = useAutosave({ restoringHistory })

const { initHistory, snapshot, scheduleSnapshot, undo, redo, cancelPendingSnapshot } = useUndoRedo({
  restoringHistory,
  saveAutosave: saveActiveForm,
})
const bus = useBusResize({ scheduleSnapshot })

// ─── Vue refs / JointJS state ───
// Объявления идут ДО блока listeners: useEventListener читает paperContainer как
// зависимость, а у `const` нет hoisting'а (TDZ).
const paperContainer = ref(null)
// Скрытый <input type="color"> пикера фона: кнопка тулбара открывает его click()'ом.
const bgInput = ref(null)
let paper = null
let graph = null

// ─── Zoom / viewport ───
// zoomPercent живёт в синглтоне useCanvas, механика (колесо, кнопки ±, fit) — в
// useCanvasZoom. Объявление ДО блока listeners: onWheel уходит туда значением.
const zoomPercent = canvas.zoomPercent
const { onWheel, zoomByStep, fitToContent, centerOnCell } = useCanvasZoom(paperContainer)
// Подсветки по тегу и результатам поиска (CSS-классы на view'ах) — в композабле;
// clearCellClass используется ниже и для `.tms-selected`.
const { clearCellClass } = useCellHighlight({ centerOnCell })
// Pan — в usePan (свои document move/up); onPanStart зовётся из capture-mousedown
// ниже (средняя кнопка или Space+ЛКМ).
const { onPanStart, isPanning } = usePan()

// useEventListener снимает всё на unmount. Значения из композаблов (`const`) можно
// ссылать только после объявления, hoisted-функции — до.
useEventListener(paperContainer, 'wheel', onWheel, { passive: false })
useEventListener(paperContainer, 'mousemove', onCanvasMouseMove)
useEventListener(paperContainer, 'mouseenter', onCanvasEnter)
useEventListener(paperContainer, 'mouseleave', onCanvasMouseLeave)
// Capture-фаза: ресайз шины и pan перехватывают mousedown раньше JointJS, иначе он
// начнёт свой drag.
useEventListener(paperContainer, 'mousedown', bus.onMaybeStartResize, true)
useEventListener(paperContainer, 'mousedown', onPanMouseDown, true)
useEventListener(document, 'mouseup', onPanMouseUp)
useEventListener(window, 'keydown', onSpaceDown)
useEventListener(window, 'keyup', onSpaceUp)
// Свои document/window-события pan/lasso/palette-drag слушают сами.

// Ресайз окна → пересчёт paper'а. Регистрируется в синхронном setup-скоупе: из async
// onMounted vueuse не зацепит scope-dispose, и observer утечёт.
useResizeObserver(paperContainer, () => {
  if (!paper || !paperContainer.value) return
  paper.setDimensions(paperContainer.value.clientWidth, paperContainer.value.clientHeight)
})

// JointJS шлёт change:position ~60 раз/сек, поэтому bumpVersion подавляется в окне
// pointerdown → pointerup (иначе details и overlayBtns считаются на каждый mousemove).
// document-mouseup — на случай отпускания вне холста.
let isPointerDownOnCell = false
// «Ячейку тащат» — взводится на первом change в окне pointer-down (drag, а не клик).
// Пока true, overlay-кнопки скрыты: bumpVersion подавлен.
const cellDragging = ref(false)
function releasePointerDrag() {
  if (!isPointerDownOnCell) return
  isPointerDownOnCell = false
  cellDragging.value = false
  canvas.bumpVersion()
}
useEventListener(document, 'mouseup', releasePointerDrag, { capture: true })

const { simulating, toggleSimulation, stopSimulation } = useSimulation()
const { textEditing, textEditValue, textEditorRef, startTextEdit, commitTextEdit, cancelTextEdit } =
  useTextEdit({ scheduleSnapshot })
const { copySelection, pasteClipboard, duplicateSelection, hasClipboard } = useClipboard({
  scheduleSnapshot,
})
// Символ на шине: ложится центром и едет за ней (useBusSnap). Нужен и палитре (drop),
// и здесь — жестам с уже стоящими ячейками.
const busSnap = useBusSnap()
const { syncBusAttachment, detachFromBus, followBus, releaseBus } = busSnap
// Drag символа из палитры (превью, создание ячейки, врезка в провод, посадка на шину)
// целиком в usePaletteDrag: wireSplice и busSnap нужны только ему, свои
// document-листенеры он цепляет сам.
const { previewVisible, previewStyle, draggingStencilSvg } = usePaletteDrag(
  paperContainer,
  useWireSplice(),
  busSnap
)

// Проектная оркестрация (переключение формы, импорт и экспорт .zip): функции приходят
// уже обёрнутыми в общий busy-флаг, плюс флаг оверлея.
const {
  exportingProject,
  projectBusy,
  selectForm: guardedSelectForm,
  importProjectFromArchive: guardedImportArchive,
  exportProjectToArchive: guardedExportArchive,
  createForm: guardedCreateForm,
  duplicateForm: guardedDuplicateForm,
  deleteForm: guardedDeleteForm,
  restoreForm: guardedRestoreForm,
  renameForm: guardedRenameForm,
  moveFormNode: guardedMoveForm,
  trash: formTrash,
  refreshTrash,
} = useProject({
  restoringHistory,
  autosave: {
    saveActiveForm,
    persistMeta,
    replaceProject,
    readTagsText,
    persistForm,
    removeFormPersist,
    loadTrash,
    pushTrash,
    popTrash,
  },
  undo: { cancelPendingSnapshot, initHistory },
  simulation: { stopSimulation, simulating },
  commitTextEdit,
  textEditing,
})

// useHotkeys навешивает window-keydown через useEventListener (снимается сам).
useHotkeys({
  undo,
  redo,
  scheduleSnapshot,
  copySelection,
  pasteClipboard,
  duplicateSelection,
  // Обёртка, а не прямая ссылка: rotateSelectedBy/flipSelected объявлены ниже, и
  // стрелка резолвит их на keydown, минуя TDZ.
  rotateSelected: (deg) => rotateSelectedBy(deg),
  flipSelected: (axis) => flipSelected(axis),
  cancelDraw: () => cancelDraw(),
  onExport: guardedExportArchive,
  projectBusy,
  notify,
})

// Кнопка-лупа тоглит панель поиска: закрытие сбрасывает подсветку и матчи, как close
// в SearchBar. Ctrl+F живёт в useHotkeys и всегда открывает или рефокусит.
function toggleSearch() {
  if (ui.searchOpen) {
    canvas.clearSearch()
    ui.closeSearch()
  } else {
    ui.openSearch()
  }
}

// Multi-drag выделенных ячеек (и изломов проводов между ними) — в useMultiDrag,
// хендлеры цепляются на paper/graph в onMounted.
const { prepareMultiDrag, onPositionChange, endMultiDrag, isMultiDragging } = useMultiDrag()

// ─── Overlay-фичи холста ───
// Кнопки выделенной ячейки, hover-tooltip и контекстное меню: все читают graph/paper
// через canvas.*-ref, tooltip получает предикат «идёт взаимодействие».
const { overlayBtns, rotateSelectedBy, flipSelected, onDeleteSelected, toggleLockSelected } =
  useSelectionOverlay({
    scheduleSnapshot,
    textEditing,
    dragging: cellDragging,
  })
// Бейдж-замок в углу заблокированной ячейки: правый верхний угол visual-AABB (с
// учётом поворота).
const lockedBadges = computed(() => {
  canvas.graphVersion.value
  canvas.paperViewTick.value
  const paper = canvas.paperRef.value
  const graph = canvas.graphRef.value
  if (!paper || !graph) return []
  return graph
    .getElements()
    .filter((c) => c.get('tms')?.locked)
    .map((c) => {
      // Правый-верхний угол visual-AABB (с учётом поворота) — якорь бейджа.
      const aabb = rotatedAabb(c.get('position'), c.get('size'), c.angle() || 0)
      const tr = projectToScreen(paper, aabb.x + aabb.width, aabb.y)
      return { id: c.id, left: `${tr.x - 16}px`, top: `${tr.y - 2}px` }
    })
})

// Пунктирная рамка группы по ховеру: границы видны до клика.
const hoveredCellId = ref(null)
const groupHoverRect = computed(() => {
  canvas.graphVersion.value
  canvas.paperViewTick.value
  if (cellDragging.value) return null
  const id = hoveredCellId.value
  const paper = canvas.paperRef.value
  const graph = canvas.graphRef.value
  if (!id || !paper || !graph) return null
  const gid = graph.getCell(id)?.get('tms')?.groupId
  if (!gid) return null
  const members = graph.getElements().filter((e) => e.get('tms')?.groupId === gid)
  if (members.length < 2) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const m of members) {
    const aabb = rotatedAabb(m.get('position'), m.get('size'), m.angle() || 0)
    minX = Math.min(minX, aabb.x)
    minY = Math.min(minY, aabb.y)
    maxX = Math.max(maxX, aabb.x + aabb.width)
    maxY = Math.max(maxY, aabb.y + aabb.height)
  }
  const tl = projectToScreen(paper, minX, minY)
  const br = projectToScreen(paper, maxX, maxY)
  const pad = 4
  return {
    left: `${tl.x - pad}px`,
    top: `${tl.y - pad}px`,
    width: `${br.x - tl.x + 2 * pad}px`,
    height: `${br.y - tl.y + 2 * pad}px`,
  }
})

const { cellHoverTooltip, showCellTooltip, hideCellTooltip } = useHoverTooltip({
  suppress: () => isPanning() || isMultiDragging() || bus.isResizing() || textEditing.value,
})
const { ctxMenuRef, ctxItems, showContextMenu } = useContextMenu({
  hasClipboard,
  pasteClipboard,
  copySelection,
  duplicateSelection,
  detachFromBus,
  notify,
})
// Lasso — startLasso дёргаем из blank:pointerdown (обычный ЛКМ); move/up свои.
const { lassoRect, startLasso } = useLasso(paperContainer, { selectCellsWithBridges })
// Рисование фигур-разметки: свои capture-хендлеры, лассо гасим на время инструмента.
const { drawPreview, isDrawing, cancelDraw } = useCanvasDraw(paperContainer, {
  scheduleSnapshot,
})
// Ручки ресайза выделенного — overlay, как кнопки поворота; на время drag'а ячейки
// скрываются тем же флагом.
const { resizeHandles, onHandleDown } = useCanvasResize({
  scheduleSnapshot,
  dragging: cellDragging,
})
// Иконки те же, что в тулбаре редактора символов: жест и результат совпадают.
const DRAW_TOOLS = [
  { key: 'line', icon: 'pi pi-minus', tip: 'Линия' },
  { key: 'rect', icon: 'pi pi-stop', tip: 'Прямоугольник' },
  { key: 'circle', icon: 'pi pi-circle', tip: 'Эллипс (Shift — ровный круг)' },
  {
    key: 'polyline',
    glyph: POLYLINE_ICON,
    tip: 'Ломаная (клик по началу замыкает, двойной клик завершает)',
  },
  { key: 'text', glyph: TEXT_ICON, tip: 'Подпись (текст правится в инспекторе)' },
]

// ─── Pan-жесты ──────────────────────────────────────────────────────────────
// Средняя кнопка или Space+ЛКМ панят холст, обычный ЛКМ по пустому — лассо.
// Курсор: Space над холстом → grab, во время pan → grabbing. spaceHeld и overCanvas —
// модульные флаги, не reactive: их читают raw-хендлеры.
let spaceHeld = false
let overCanvas = false

function setCursor(value) {
  if (paperContainer.value) paperContainer.value.style.cursor = value
}

// Space-pan работает только когда курсор над холстом: иначе пробел перехватывался бы
// в остальном UI.
function onCanvasEnter() {
  overCanvas = true
}
function onSpaceDown(event) {
  if (event.code !== 'Space' || spaceHeld || !overCanvas) return
  const t = event.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  spaceHeld = true
  event.preventDefault() // пробел не должен скроллить страницу / жать фокус-кнопку
  setCursor('grab')
}
function onSpaceUp(event) {
  if (event.code !== 'Space') return
  spaceHeld = false
  if (!isPanning()) setCursor('')
}

// Capture-фаза: перехват ДО JointJS, чтобы средняя кнопка и Space+ЛКМ не начали drag
// элемента и не всплыли в blank:pointerdown как лассо. preventDefault на средней
// кнопке гасит autoscroll-кружок Windows.
function onPanMouseDown(event) {
  const wantPan = event.button === 1 || (event.button === 0 && spaceHeld)
  if (!wantPan) return
  event.preventDefault()
  event.stopPropagation()
  onPanStart(event)
  setCursor('grabbing')
}
// После любого mouseup курсор возвращается в покой: grab, если Space ещё зажат над
// холстом, иначе обычный.
function onPanMouseUp() {
  setCursor(spaceHeld ? 'grab' : '')
}

/**
 * Заменяет выделение на cells + «мостовые» провода между ними (computeBridgeLinks —
 * общая логика с useCanvas).
 *
 * keepLinks — провода, выделенные вручную: нужен для toggle-веток (Ctrl+клик,
 * additive-лассо), иначе они слетали бы, ведь selection пересобирается из ячеек и
 * мостов. Дедуп по id: мост мог совпасть с уже выделённым проводом.
 */
function selectCellsWithBridges(cellItems, keepLinks = []) {
  const cellIds = cellItems.map((c) => c.id)
  const bridges = computeBridgeLinks(graph, cellIds)
  const seen = new Set(bridges.map((l) => l.id))
  const links = [...bridges]
  for (const l of keepLinks) {
    if (!seen.has(l.id)) {
      links.push(l)
      seen.add(l.id)
    }
  }
  canvas.setSelection([...cellItems, ...links])
}

// ─── Resize шины (cell_bus), undo/redo, autosave — в композаблах.
// onMaybeStartResize вешается на mousedown в onMounted, isResizing() читают те, кто
// гасит свой UI на время жеста.

onMounted(async () => {
  if (!paperContainer.value) return

  // Ждём, пока flex-лейаут проставит размеры карточки: иначе clientWidth/Height на
  // момент создания paper'а окажутся слишком малы.
  await nextTick()

  // Конфиг graph/paper (интерактив, снап связей, anchor'ы, validateConnection) — в
  // stencils/canvasPaper, здесь только подписка на события.
  graph = createCanvasGraph()
  paper = createCanvasPaper({
    el: paperContainer.value,
    graph,
    isSelected: (id) => canvas.isSelected(id),
    background: workspace.activeFormBg || CANVAS_BG_DEFAULT,
    // Функцией, а не значением: настройки инструмента меняются в инспекторе, а paper
    // создаётся один раз.
    wireStyle: () => workspace.wireStyle,
  })

  // ─── Клик по пустому месту ───
  paper.on('blank:pointerdown', (evt) => {
    hideCellTooltip()
    // ЛКМ по пустому — лассо; pan перехватывает capture-mousedown и сюда не доходит.
    // Снятие выделения при клике без drag'а делает onLassoEnd. Активный инструмент
    // рисования забирает жест себе.
    if (isDrawing()) return
    startLasso(evt)
  })

  // ─── Selection ───
  // Ctrl/Cmd+клик — тогл, обычный клик — замена выделения; провода между выделенными
  // ячейками добавляются автоматически.
  paper.on('element:pointerdown', (elementView, evt) => {
    const cellId = elementView.model.id
    // Клик по члену группы выделяет группу целиком (expandGroups).
    const groupItems = canvas.expandGroups([{ kind: 'cell', id: cellId }])
    const groupIds = groupItems.map((i) => i.id)
    if (evt.ctrlKey || evt.metaKey) {
      // Тогл группы (или одиночки) с пересчётом «мостов»; ранее выделенные провода
      // сохраняются через keepLinks.
      const currentCells = canvas.selection.value.filter((i) => i.kind === 'cell')
      const currentLinks = canvas.selection.value.filter((i) => i.kind === 'link')
      const allIn = groupIds.every((id) => currentCells.some((c) => c.id === id))
      let nextCells
      if (allIn) {
        nextCells = currentCells.filter((c) => !groupIds.includes(c.id))
      } else {
        const have = new Set(currentCells.map((c) => c.id))
        nextCells = [...currentCells, ...groupItems.filter((i) => !have.has(i.id))]
      }
      selectCellsWithBridges(nextCells, currentLinks)
    } else {
      // Обычный клик: группу выделяем целиком, одиночку — её одну. Уже полностью
      // выделенное не трогаем, оно уходит под multi-drag.
      const selIds = new Set(
        canvas.selection.value.filter((i) => i.kind === 'cell').map((i) => i.id)
      )
      const allSelected = groupIds.every((id) => selIds.has(id))
      if (groupItems.length > 1) {
        if (!allSelected) selectCellsWithBridges(groupItems)
      } else if (!canvas.isSelected(cellId)) {
        canvas.selectOnly('cell', cellId)
      }
    }
    // Ячейка уже в выделении и нет Ctrl — оставляем как есть (multi-drag).
    prepareMultiDrag(cellId)
  })
  paper.on('link:pointerdown', (linkView, evt) => {
    if (evt.ctrlKey || evt.metaKey) {
      canvas.toggleInSelection('link', linkView.model.id)
    } else if (!canvas.isSelected(linkView.model.id)) {
      canvas.selectOnly('link', linkView.model.id)
    }
  })
  // Multi-drag: ведущая ячейка тянет остальных выделенных (см. useMultiDrag).
  graph.on('change:position', onPositionChange)
  paper.on('element:pointerup', endMultiDrag)

  // Закрепление на шине: сдвинули шину — закреплённые символы едут за ней. Выделенные
  // пропускаются (их уже сдвинул multi-drag), `busFollow` гасит реентри.
  graph.on('change:position', (cell, newPos, opt) => {
    if (opt?.busFollow || cell.get('tms')?.stencilId !== 'cell_bus') return
    const prev = cell.previous('position')
    if (!prev) return
    const skip = new Set(canvas.selection.value.filter((i) => i.kind === 'cell').map((i) => i.id))
    followBus(cell, newPos.x - prev.x, newPos.y - prev.y, skip)
  })

  // Толщина двигает линию шины (её середину), а закреплённые сидят на ней центром —
  // поэтому едут на половину прироста.
  graph.on('change:size', (cell, newSize, opt) => {
    if (opt?.busFollow || cell.get('tms')?.stencilId !== 'cell_bus') return
    const prev = cell.previous('size')
    if (!prev) return
    const dy = Math.round(newSize.height / 2) - Math.round(prev.height / 2)
    if (dy) followBus(cell, 0, dy)
  })

  // Шину удалили — снимаем закрепление, иначе символы привязаны к пустоте.
  graph.on('remove', (cell) => {
    if (cell.get?.('tms')?.stencilId === 'cell_bus') releaseBus(cell)
  })

  // Отпустили символ: лёг на шину — закрепляем, увели с неё — закрепление снимаем.
  paper.on('element:pointerup', (view) => syncBusAttachment(view.model))

  // Double-click по cell_text — открыть inline-редактор поверх ячейки.
  paper.on('element:pointerdblclick', (elementView) => {
    const tms = elementView.model.get('tms') || {}
    if (tms.stencilId === 'cell_text') startTextEdit(elementView.model.id)
  })

  // Hover-tooltip: показывается при mouseenter, скрывается при leave и
  // element:pointerdown (blank:pointerdown гасит его выше).
  paper.on('element:mouseenter', (view) => {
    hoveredCellId.value = view.model.id // для пунктирной рамки группы
    showCellTooltip(view)
  })
  paper.on('element:mouseleave', () => {
    hoveredCellId.value = null
    hideCellTooltip()
  })
  paper.on('element:pointerdown', hideCellTooltip)

  // Контекстное меню: ПКМ по ячейке, проводу или пустому месту. Нативное меню
  // браузера JointJS подавляет сам.
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

  // ─── Отслеживание изменений графа (для computed'ов инспектора) ───
  // Окно подавления bumpVersion при drag'е ячейки (isPointerDownOnCell,
  // releasePointerDrag, document-mouseup) живёт в синхронном setup-скоупе выше; здесь
  // только paper-события — paper готов лишь в onMounted.
  paper.on('cell:pointerdown', () => {
    isPointerDownOnCell = true
  })
  paper.on('cell:pointerup', releasePointerDrag)

  graph.on('change add remove', () => {
    if (isPointerDownOnCell) {
      cellDragging.value = true // первый change в drag-окне → прячем overlay-кнопки
      return
    }
    canvas.bumpVersion()
  })

  // Реконнект конца провода меняет source/target — это шаг undo (во время restore
  // scheduleSnapshot молчит сам). Заодно пересобираются маркеры концов: точка
  // свободного конца появляется при отцеплении и уходит при привязке к порту.
  graph.on('change:source change:target', (link) => {
    syncLinkEndMarkers(link)
    scheduleSnapshot()
  })

  // Снап ручных изломов к сетке: тул кладёт vertex в сырых координатах, а линию
  // роутер держит на сетке, и без снапа хэндл отрывается от линии; vertexSnap гасит
  // реентри. Здесь же snapshot: linkTools.Vertices делает stopPropagation, поэтому
  // cell:pointerup для линка не эмитится, и правка изломов иначе не попадёт в undo.
  graph.on('change:vertices', (link, vertices, opt) => {
    if (opt?.vertexSnap) return
    if (paper && vertices?.length) {
      const g = paper.options.gridSize || 10
      const snapped = vertices.map((v) => ({
        x: Math.round(v.x / g) * g,
        y: Math.round(v.y / g) * g,
      }))
      if (snapped.some((s, i) => s.x !== vertices[i].x || s.y !== vertices[i].y)) {
        link.vertices(snapped, { vertexSnap: true })
      }
    }
    scheduleSnapshot() // сам no-op во время restore (см. change:source/target выше)
  })

  // Линии всегда за ячейками, иначе линия перекрывает порт в точке anchor.
  graph.on('add', (cell) => {
    // Полоса проводов, а не `toBack()` (тот даёт min-1 и уводит z в дрейф). Через
    // normalizeLinkZ, а не жёсткий LINK_Z: авто-z нарисованного мышью провода вне
    // полосы и едет на дно, а заданный автором порядок сохраняется.
    if (cell.isLink && cell.isLink()) cell.set('z', normalizeLinkZ(cell.get('z')))
  })

  // Маркер «здесь подключён провод» рисует контент шины: слот стоит в середине
  // толщины, и конец провода уходит под тело. Занятость слотов читается из графа, а не
  // хранится в модели (portProp/attrs попали бы в graphJson и дрейфили между снимками
  // undo), поэтому перерисовка шины дёргается на изменениях связей.
  const refreshBusMarks = (cell) => {
    if (!cell?.isLink?.()) return
    const ids = new Set()
    for (const end of ['source', 'target']) {
      ids.add(cell.get(end)?.id)
      ids.add(cell.previous?.(end)?.id)
    }
    for (const id of ids) {
      const bus = id ? graph.getCell(id) : null
      if (bus?.get('tms')?.stencilId !== 'cell_bus') continue
      const view = paper.findViewByModel(bus)
      const stencil = getStencilById('cell_bus')
      if (view && stencil) injectStencilSvg(view, stencil)
    }
  }
  graph.on('add remove change:source change:target', refreshBusMarks)

  // graph/paper прокидываются ДО restoreProject: useAutosave и useUndoRedo читают их
  // через canvas.graphRef.value.
  canvas.setCanvasRefs(graph, paper)

  // ─── Restore проекта из IndexedDB (активная форма → граф) ───
  // try/catch обязателен: на битом graphJson fromJSON бросает, и без перехвата
  // onMounted оборвётся ДО initHistory и graph.on — холст останется без истории и
  // хоткеев. Ловим → пустой холст и error-тост, остальные формы не тронуты.
  let restored = 0
  try {
    restored = await restoreProject()
  } catch (e) {
    console.error('[Restore] не удалось поднять проект из IndexedDB:', e)
    withRestoreGuard(restoringHistory, () => {
      graph.clear()
      canvas.bumpVersion()
    })
    notify.error(
      'Не удалось восстановить проект',
      'Локальные данные формы повреждены — открыт пустой холст. Переключите форму или переоткройте проект.'
    )
  }

  // ─── История: снимок на «стабильных» событиях ───
  // Только pointerup (после действия) и add/remove: на 'change' JointJS шлёт десятки
  // событий за один draw линии, и дебаунс не всегда их схлопывает.
  initHistory()

  // Drop элемента из палитры (у линий ждём pointerup: они добавляются в начале draw'а).
  graph.on('add', (cell) => {
    if (cell.isLink && cell.isLink()) return
    scheduleSnapshot()
  })

  // Удаление любой ячейки или провода.
  graph.on('remove', () => {
    scheduleSnapshot()
    // Hover-tooltip над удаляемой ячейкой надо снять вручную: mouseleave уже не
    // придёт.
    hideCellTooltip()
  })

  // Pointerup на любом cell-view: конец drag'а ячейки, draw'а линии или правки
  // link-tools.
  paper.on('cell:pointerup', () => scheduleSnapshot())

  // Проектные операции регистрируются, чтобы их могли вызвать другие панели:
  // переключение формы идёт через canvas.selectForm.
  canvas.setSelectFormFn(guardedSelectForm)
  // Импорт и экспорт .zip — ProjectActions зовёт через canvas.*Archive.
  canvas.setArchiveFns({
    importFromArchive: guardedImportArchive,
    exportToArchive: guardedExportArchive,
  })
  // Вписать контент в область видимости — импорт зовёт canvas.fitToContent.
  canvas.setFitViewFn(fitToContent)
  // CRUD форм и DnD-перенос — FormTree зовёт canvas.createForm/…/moveFormNode.
  canvas.setFormCrudFns({
    createForm: guardedCreateForm,
    duplicateForm: guardedDuplicateForm,
    deleteForm: guardedDeleteForm,
    restoreForm: guardedRestoreForm,
    renameForm: guardedRenameForm,
    moveForm: guardedMoveForm,
    trash: formTrash,
  })
  // Корзина живёт в IDB: после перезагрузки кнопка возврата должна знать про формы,
  // удалённые в прошлой сессии.
  refreshTrash()

  // Хранилище не читается (restoreProject вернул -1): данные в IDB целы, но в сторе
  // пустышка, поэтому autosave выключен до перезагрузки. Говорим прямо — иначе
  // пользователь примет пустой холст за потерю и начнёт рисовать заново.
  if (restored < 0) {
    notify.error(
      'Локальные данные недоступны',
      'Не удалось прочитать проект из хранилища браузера. Автосохранение отключено, чтобы не потерять данные — перезагрузите страницу.',
      TOAST_LIFE.LONG
    )
  }

  // Сообщаем о восстановлении уже после монтирования (toast service готов).
  //
  // Только на ПЕРВОМ монтировании за загрузку страницы: в dev правка любого нашего
  // `.js` поднимает hot-update до этого компонента, он перемонтируется, и тост с
  // центрированием повторялись бы на каждое сохранение файла. Флаг переживает
  // hot-update через `hot.data`; в проде `hot` нет и условие всегда истинно.
  const firstMount = !import.meta.hot?.data.restoreShown
  if (import.meta.hot) import.meta.hot.data.restoreShown = true
  if (restored > 0) {
    // Тост — только на первом монтировании (см. выше). Вписывание в область
    // видимости — на КАЖДОМ: paper всегда стартует с translate(0,0), и форма,
    // нарисованная где-нибудь в (500, 800), иначе оказывается за кадром — холст
    // выглядит пустым, будто содержимое уехало в левый верхний угол.
    // nextTick — чтобы paperContainer успел получить итоговые clientWidth/Height.
    if (firstMount) {
      notify.info(
        'Автосейв восстановлен',
        `${nplural(restored, 'символ', 'символа', 'символов')} с прошлой сессии`
      )
    }
    await nextTick()
    fitToContent()
  }
})

// ─── Подсветка выделенных элементов ───
// На каждое изменение selection: откатываем стили всех ранее выделенных линий
// + снимаем resize-tools с предыдущих шин, затем накладываем выделение на текущие.
watch(
  () => canvas.selection.value,
  (sel, oldSel) => {
    if (!paper) return

    // Снимаем класс со всех ранее выделенных
    clearCellClass('tms-selected')
    // Снимаем arrowhead-ручки только с РАНЕЕ выделенных линков (tools висят лишь на
    // выделенных) — полный перебор графа на каждый клик не нужен.
    for (const item of oldSel || []) {
      if (item.kind !== 'link') continue
      const link = graph?.getCell(item.id)
      if (link) paper.findViewByModel(link)?.removeTools()
    }

    if (!Array.isArray(sel) || sel.length === 0) return
    for (const item of sel) {
      const cell = graph?.getCell(item.id)
      if (!cell) continue
      const view = paper.findViewByModel(cell)
      if (!view) continue
      view.el?.classList.add('tms-selected')
      // Провод: ручки концов (переанкеринг к другому порту) + изломы — см.
      // attachLinkTools в linkDefaults.
      if (cell.isLink?.()) attachLinkTools(view)
    }
    // Inline-× — HTML-overlay (deleteBtnStyle в template). JointJS
    // elementTools.Remove кэширует bbox при addTools, не пересчитывает на
    // cell.resize → × застревал после ресайза cell_text / cell_bus.
  }
  // deep НЕ нужен: selection всегда ЗАМЕНЯЕТСЯ новым массивом (selectOnly/
  // setSelection/toggle/clear), ref-сравнения достаточно.
)

// Цвет, пока пикер открыт: нативный диалог шлёт `input` непрерывно (живое превью),
// и писать на каждый тик в стор + IndexedDB значило бы десятки записей за один выбор.
// Поэтому превью держим локально, а в проект пишем на `change` — по закрытию диалога.
const bgPreview = ref(null)

function previewFormBackground(color) {
  bgPreview.value = cssColor(color) || null
}

/**
 * Фон активной формы: в стор + персист меты (фон живёт в `project:meta`, а не в графе —
 * `Ctrl+Z` его не откатывает) + пометка «проект разошёлся с .zip». `null` — дефолт.
 */
function commitFormBackground(color) {
  bgPreview.value = null
  if (!workspace.setFormBg(workspace.activeFormId, color)) return
  persistMeta()
  canvas.markDirty()
}

// Фон холста — свойство ФОРМЫ (`workspace.formBg`), поэтому watch следит и за сменой
// активной формы: открыл другую — холст перекрасился в её цвет. Цвет точек сетки
// перерисовываем вместе с фоном, иначе на тёмном сетка исчезает.
const formBackground = computed(
  () => bgPreview.value || workspace.activeFormBg || CANVAS_BG_DEFAULT
)
watch(
  () => formBackground.value,
  (color) => {
    if (!paper) return
    paper.drawBackground({ color })
    paper.setGrid({ name: 'dot', color: gridColorFor(color), thickness: 1 })
  }
)

// ─── Внешние запросы snapshot'а (Inspector после правки слотов и т.п.) ───
// Эти watches должны жить на уровне script setup — внутри async onMounted после
// await они теряют component effectScope и не автоочищаются на unmount.
watch(
  () => canvas.snapshotTick.value,
  () => scheduleSnapshot()
)

onBeforeUnmount(() => {
  // useEventListener / useResizeObserver / composable'ы сами снимают свои
  // ресурсы — здесь только сбрасываем singleton-ссылки на graph/paper.
  hideCellTooltip() // pending hover-tooltip не должен стрелять после unmount
  canvas.clearCanvasRefs()
  canvas.setSelectFormFn(null)
  canvas.setArchiveFns({ importFromArchive: null, exportToArchive: null })
  canvas.setFitViewFn(null)
  canvas.setFormCrudFns({
    createForm: null,
    duplicateForm: null,
    deleteForm: null,
    restoreForm: null,
    renameForm: null,
    moveForm: null,
    trash: [],
  })
  paper?.remove()
  paper = null
  graph = null
})

function onCanvasMouseMove(event) {
  if (!paper) return
  const p = paper.clientToLocalPoint(event.clientX, event.clientY)
  const nx = Math.round(p.x)
  const ny = Math.round(p.y)
  // Гард: sub-pixel дрожание мыши в пределах того же целого пикселя не должно
  // создавать новый объект (cursorLocal питает только info-bar с координатами).
  const cur = canvas.cursorLocal.value
  if (cur && cur.x === nx && cur.y === ny) return
  canvas.setCursorLocal({ x: nx, y: ny })
}

function onCanvasMouseLeave() {
  canvas.setCursorLocal(null)
  overCanvas = false
}

// ─── Очистить холст ───
// event приходит из @click="onClearCanvas($event)" — нужен ConfirmPopup'у как
// якорь, чтобы всплыть прямо у кнопки-урны. Без target popup упадёт в (0,0).
function onClearCanvas(event) {
  if (!graph) return
  const count = graph.getElements().length + graph.getLinks().length
  if (count === 0) {
    // Уже пусто — на всякий случай вытираем сейв активной формы и выходим
    clearActiveForm()
    return
  }
  confirmDanger(confirm, {
    target: event.currentTarget,
    // count = символы + провода, поэтому зонтичный «элемент», а не «символ».
    message: `Очистить холст? ${nplural(count, 'элемент', 'элемента', 'элементов')} будет удалено.`,
    acceptLabel: 'Очистить',
    accept: () => performClearCanvas(count),
  })
}

function performClearCanvas(count) {
  cancelPendingSnapshot()
  // Снимок состояния ДО очистки (flush pending-правки в стек), затем чистим под
  // guard'ом и снимаем пустое поверх. НЕ initHistory: сброс истории делал очистку
  // безвозвратной (Ctrl+Z не спасал, autosave тут же перезаписывал пустоту).
  snapshot()
  withRestoreGuard(restoringHistory, () => {
    graph.clear()
    canvas.bumpVersion()
  })
  clearActiveForm()
  snapshot() // пустое состояние в стек — очистка откатывается Ctrl+Z
  canvas.clearSelection()
  canvas.markDirty() // очистка формы → проект разошёлся с .zip

  notify.info(
    'Холст очищен',
    `Удалено ${nplural(count, 'элемент', 'элемента', 'элементов')}`,
    TOAST_LIFE.SHORT
  )
}
</script>

<template>
  <section class="h-full flex flex-col bg-surface-100">
    <div
      class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center justify-between gap-2"
    >
      <!-- Слева — заголовок, инструменты рисования, затем симуляция (глобальное
           действие над всей схемой; остаётся на холсте, это взаимодействие с ним, а
           не проектное действие для шапки). Порядок и шаг кнопок — как в тулбаре
           редактора символов; отступ у заголовка отыгрывает более короткое слово
           «Холст», чтобы инструменты не прижимались к нему. -->
      <div class="flex items-center gap-2">
        <h2 class="mr-6 text-sm font-semibold text-surface-900 uppercase tracking-wide">Холст</h2>
        <div class="flex items-center gap-1">
          <Button
            v-for="t in DRAW_TOOLS"
            :key="t.key"
            v-tooltip.bottom="t.tip"
            :icon="t.icon"
            :severity="ui.canvasTool === t.key ? 'primary' : 'secondary'"
            :text="ui.canvasTool !== t.key"
            size="small"
            class="tms-icon-btn"
            @click="ui.setCanvasTool(t.key)"
          >
            <template v-if="t.glyph" #icon>
              <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true">
                <path
                  v-for="(el, i) in t.glyph"
                  :key="i"
                  :d="el.d"
                  :fill="el.mode === 'fill' ? 'currentColor' : 'none'"
                  :stroke="el.mode === 'stroke' ? 'currentColor' : 'none'"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </template>
          </Button>
        </div>

        <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>

        <Button
          v-tooltip.bottom="simulating ? 'Остановить симуляцию' : 'Запустить симуляцию'"
          :icon="simulating ? 'pi pi-pause-circle' : 'pi pi-play-circle'"
          :severity="simulating ? 'primary' : 'secondary'"
          :text="!simulating"
          size="small"
          class="tms-icon-btn"
          @click="toggleSimulation"
        />
      </div>

      <!-- Справа — инструменты группами: история │ вид (поиск + зум) │ удаление. -->
      <div class="flex items-center gap-2">
        <Button
          v-tooltip.bottom="'Отменить · Ctrl+Z'"
          icon="pi pi-undo"
          severity="secondary"
          text
          size="small"
          class="tms-icon-btn"
          :disabled="!canvas.canUndo.value"
          @click="undo"
        />
        <Button
          v-tooltip.bottom="'Повторить · Ctrl+Y'"
          icon="pi pi-refresh"
          severity="secondary"
          text
          size="small"
          class="tms-icon-btn"
          :disabled="!canvas.canRedo.value"
          @click="redo"
        />

        <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>

        <!-- Фон АКТИВНОЙ ФОРМЫ (см. workspace.formBg). Клик по иконке открывает
             нативный пикер сразу: промежуточная всплывашка ради одного контрола
             стоила лишнего клика. Сам `input` спрятан, но живёт в DOM — открыть
             диалог можно только его собственным click(). -->
        <span class="relative inline-flex">
          <Button
            v-tooltip.bottom="'Фон этой формы'"
            icon="pi pi-palette"
            severity="secondary"
            text
            size="small"
            class="tms-icon-btn"
            @click="bgInput?.click()"
          />
          <!-- Крестик поверх иконки — сброс к дефолту. Виден только у формы со своим
               фоном: иначе висел бы пустым обещанием. stop, чтобы клик не всплыл на
               кнопку и не открыл пикер вместо сброса. -->
          <button
            v-if="workspace.activeFormBg"
            v-tooltip.bottom="'Вернуть фон по умолчанию'"
            type="button"
            class="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
            @click.stop="commitFormBackground(null)"
          >
            <i class="pi pi-times text-[7px]!" />
          </button>
        </span>
        <input
          ref="bgInput"
          type="color"
          class="sr-only"
          tabindex="-1"
          aria-hidden="true"
          :value="formBackground"
          @input="previewFormBackground($event.target.value)"
          @change="commitFormBackground($event.target.value)"
        />

        <!-- Поиск (Ctrl+F) — в той же группе, что фон и зум: всё про просмотр схемы.
             Кнопка делает фичу видимой, а не только клавиатурной (панель SearchBar). -->
        <Button
          v-tooltip.bottom="'Найти на схеме по тегу / тексту · Ctrl+F'"
          icon="pi pi-search"
          :severity="ui.searchOpen ? 'primary' : 'secondary'"
          :text="!ui.searchOpen"
          size="small"
          class="tms-icon-btn"
          @click="toggleSearch"
        />

        <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>

        <div class="flex items-center">
          <Button
            v-tooltip.bottom="'Уменьшить'"
            icon="pi pi-minus"
            severity="secondary"
            text
            size="small"
            class="tms-icon-btn"
            :disabled="zoomPercent <= 20"
            @click="zoomByStep(1 / ZOOM_STEP)"
          />
          <!-- Центр группы — текущий масштаб, клик вписывает в экран. Фикс-ширина,
               чтобы +/− не дёргались при смене числа. Колесо тоже зумит (в тултипе). -->
          <Button
            v-tooltip.bottom="'Вписать в экран (до 100%) · колесо — зум'"
            :label="`${zoomPercent}%`"
            severity="secondary"
            text
            size="small"
            class="font-mono! min-w-[3.25rem]! justify-center!"
            @click="fitToContent"
          />
          <Button
            v-tooltip.bottom="'Увеличить'"
            icon="pi pi-plus"
            severity="secondary"
            text
            size="small"
            class="tms-icon-btn"
            :disabled="zoomPercent >= 400"
            @click="zoomByStep(ZOOM_STEP)"
          />
        </div>

        <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>

        <Button
          v-tooltip.bottom="'Очистить холст'"
          icon="pi pi-trash"
          severity="secondary"
          text
          size="small"
          class="tms-icon-btn"
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
        class="absolute inset-0 bg-white cursor-default"
        :class="[
          simulating ? 'tms-simulating ring-2 ring-inset ring-emerald-400/60 ' : '',
          // Активный инструмент рисования видно по курсору: иначе «выделение
          // рамкой перестало работать» выглядит как баг.
          ui.canvasTool !== 'select' ? 'cursor-crosshair!' : '',
        ]"
      ></div>

      <!-- Оверлей на время экспорта проекта: формы по очереди грузятся в живой
 paper (нужен exporter'у для геометрии), холст мелькает — прячем процесс. -->
      <div
        v-if="exportingProject"
        class="absolute inset-0 z-20 flex items-center justify-center bg-surface-0/70 backdrop-blur-sm cursor-wait"
      >
        <div class="flex items-center gap-2 text-sm text-surface-600">
          <i class="pi pi-spin pi-spinner" />
          Экспорт проекта…
        </div>
      </div>

      <!-- Indicator симуляции: PrimeVue Tag в правом верхнем углу холста +
 зелёная inset-рамка вокруг paper'а (см. ring-* в paperContainer).
 pointer-events отключены — это чисто визуальная метка, клик уходит
 на холст под ней. severity=success подтягивает emerald-цвет темы. -->
      <Tag
        v-if="simulating"
        value="Симуляция"
        icon="pi pi-play-circle"
        severity="success"
        class="absolute! top-3! right-3! z-30! pointer-events-none text-xs! shadow-md!"
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
        <!-- Миниатюра символа внутри preview-рамки — то же SVG, что в палитре.
 stencil-thumb-классом подхватываем правило (w/h 100%, block) из style.css. -->
        <div
          v-if="draggingStencilSvg"
          class="stencil-thumb absolute inset-1 opacity-70"
          v-html="draggingStencilSvg"
        />
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

      <!-- Hover-tooltip над ячейкой: лейбл символа + «В группе (N)» у сгруппированной.
 pointer-events отключены чтобы tooltip не перехватывал клики/hover,
 иначе после mouseenter он бы сам ловил mouseleave при выходе из cell-bbox.
 Fade на исчезновение делает выход с ячейки мягче: появление с задержкой
 400ms (см. HOVER_DELAY_MS), исчезновение — через Transition. -->
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
            v-if="cellHoverTooltip.groupCount > 1"
            class="text-[10px] opacity-75 mt-1 flex items-center gap-1"
          >
            <i class="pi pi-th-large text-[9px]!" />
            В группе ({{ cellHoverTooltip.groupCount }})
          </div>
        </div>
      </Transition>

      <!-- Inline-overlay одиночной выделенной ячейки: поворот ↺/↻ и отражение H/V
           (гейты `canRotate`/`canFlipH`/`canFlipV`: noRotate, замок, а у фигур — меняет ли
           операция картинку), удаление (скрыто у locked)
           и замок (виден всегда — им же блокировку снимают). Reactive
           HTML-overlay, а не JointJS elementTools.Remove: тот кэширует позицию и
           не следует за resize. -->
      <template v-if="overlayBtns">
        <Button
          v-if="overlayBtns.canRotate"
          v-tooltip.top="'Повернуть против часовой · Shift+R'"
          icon="pi pi-undo"
          severity="secondary"
          rounded
          size="small"
          class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
          :style="overlayBtns.rotateCcw"
          @click="rotateSelectedBy(-90)"
        />
        <Button
          v-if="overlayBtns.canRotate"
          v-tooltip.top="'Повернуть по часовой · R'"
          icon="pi pi-undo -scale-x-100"
          severity="secondary"
          rounded
          size="small"
          class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
          :style="overlayBtns.rotateCw"
          @click="rotateSelectedBy(90)"
        />
        <Button
          v-if="overlayBtns.canFlipH"
          v-tooltip.top="'Отразить по горизонтали · Shift+H'"
          icon="pi pi-arrows-h"
          severity="secondary"
          rounded
          size="small"
          class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
          :style="overlayBtns.flipH"
          @click="flipSelected('h')"
        />
        <Button
          v-if="overlayBtns.canFlipV"
          v-tooltip.top="'Отразить по вертикали · Shift+V'"
          icon="pi pi-arrows-v"
          severity="secondary"
          rounded
          size="small"
          class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
          :style="overlayBtns.flipV"
          @click="flipSelected('v')"
        />
        <Button
          v-if="!overlayBtns.locked"
          v-tooltip.top="'Удалить · Del'"
          icon="pi pi-trash"
          severity="secondary"
          rounded
          size="small"
          class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
          :style="overlayBtns.delete"
          @click="onDeleteSelected"
        />
        <!-- Замок: виден всегда. При locked это единственная активная кнопка (delete
             скрыт, rotate скрыт через canTransform) — ей же замок и снимают. -->
        <Button
          v-tooltip.top="overlayBtns.locked ? 'Разблокировать' : 'Заблокировать'"
          :icon="overlayBtns.locked ? 'pi pi-lock' : 'pi pi-unlock'"
          :severity="overlayBtns.locked ? 'primary' : 'secondary'"
          rounded
          size="small"
          class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
          :style="overlayBtns.lock"
          @click="toggleLockSelected"
        />
      </template>

      <!-- Пунктирная рамка вокруг группы при наведении на любого её члена. -->
      <div
        v-if="groupHoverRect"
        class="absolute z-0 pointer-events-none rounded border border-dashed border-primary-400"
        :style="groupHoverRect"
      />

      <!-- Бейдж-замок у каждой заблокированной ячейки (индикатор read-only). -->
      <div
        v-for="b in lockedBadges"
        :key="b.id"
        class="absolute z-10 pointer-events-none flex h-[18px] w-[18px] items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm"
        :style="{ left: b.left, top: b.top }"
      >
        <i class="pi pi-lock text-[9px]!" />
      </div>

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

      <!-- Lasso overlay (ЛКМ-drag по пустому): рамка выделения, координаты в container-px -->
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

      <!-- Ручки ресайза выделенной фигуры-разметки: тянут её габарит, геометрия
           масштабируется под него. Overlay поверх холста — в DOM ячейки их держать
           нельзя, иначе они видны у всех фигур и уедут в экспорт. -->
      <div
        v-for="h in resizeHandles"
        :key="h.key"
        class="absolute z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface-0 bg-primary-500 shadow-sm"
        :style="{ ...h.style, cursor: h.cursor }"
        @pointerdown="onHandleDown($event, h.key)"
      ></div>

      <!-- Превью рисуемой фигуры (координаты в container-px, как у лассо). Рамка для
           прямоугольника/эллипса, линия и ломаная — своими примитивами. -->
      <svg
        v-if="drawPreview"
        class="absolute inset-0 pointer-events-none w-full h-full overflow-visible"
      >
        <rect
          v-if="drawPreview.type === 'rect'"
          :x="drawPreview.x"
          :y="drawPreview.y"
          :width="drawPreview.w"
          :height="drawPreview.h"
          fill="none"
          stroke="currentColor"
          stroke-dasharray="4 3"
          class="text-primary-500"
        />
        <polyline
          v-else
          :points="drawPreview.points.map((p) => p.join(',')).join(' ')"
          fill="none"
          stroke="currentColor"
          stroke-dasharray="4 3"
          class="text-primary-500"
        />
      </svg>

      <!-- Empty canvas hint — показываем когда нет ячеек и не идёт drag.
 Двухшаговый чек-лист: tag-list → символ. Первый шаг отмечается ✓
 когда теги загружены (без tag-list'а анимации символов не работают). -->
      <div
        v-if="canvas.cellsCount.value === 0 && !ui.dragging"
        class="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div class="text-center text-surface-400 px-4">
          <i class="pi pi-sitemap block text-4xl text-surface-300 mb-3" />
          <div class="text-sm font-medium text-surface-600 mb-3">Пустой холст</div>
          <ul class="inline-block text-left text-xs space-y-1.5">
            <li class="flex items-center gap-2">
              <i
                :class="
                  project.tags.length
                    ? 'pi pi-check-circle text-emerald-500'
                    : 'pi pi-circle text-surface-300'
                "
              />
              <span
                :class="project.tags.length ? 'text-surface-400 line-through' : 'text-surface-600'"
              >
                Загрузите tag-list (кнопка в тулбаре)
              </span>
            </li>
            <li class="flex items-center gap-2">
              <i class="pi pi-circle text-surface-300" />
              <span class="text-surface-600">Перетащите символ из палитры слева</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <ContextMenu ref="ctxMenuRef" :model="ctxItems" />
  </section>
</template>
