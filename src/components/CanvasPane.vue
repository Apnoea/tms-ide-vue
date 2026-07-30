<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import Tag from 'primevue/tag'
import { useNotify, TOAST_LIFE } from '../composables/useNotify'
import { useConfirm } from 'primevue/useconfirm'
import { LINK_Z, attachLinkTools } from '../stencils/linkDefaults'
import { createCanvasGraph, createCanvasPaper } from '../stencils/canvasPaper'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from '../composables/useCanvas'
import { useAutosave } from '../composables/useAutosave'
import { useUndoRedo } from '../composables/useUndoRedo'
import { useBusResize } from '../composables/useBusResize'
import { useSimulation } from '../composables/useSimulation'
import { useTextEdit } from '../composables/useTextEdit'
import { useClipboard } from '../composables/useClipboard'
import { useWireSplice } from '../composables/useWireSplice'
import { useProject } from '../composables/useProject'
import { useHotkeys } from '../composables/useHotkeys'
import { useSelectionOverlay } from '../composables/useSelectionOverlay'
import { useHoverTooltip } from '../composables/useHoverTooltip'
import { usePan } from '../composables/usePan'
import { useCanvasZoom, ZOOM_STEP } from '../composables/useCanvasZoom'
import { useCellHighlight } from '../composables/useCellHighlight'
import { useMultiDrag } from '../composables/useMultiDrag'
import { useLasso } from '../composables/useLasso'
import { useContextMenu } from '../composables/useContextMenu'
import { usePaletteDrag } from '../composables/usePaletteDrag'
import { nplural } from '../utils/plural'
import { withRestoreGuard } from '../utils/restoreGuard'
import { confirmDanger } from '../utils/confirmDanger'
import { computeBridgeLinks } from '../utils/bridgeLinks'
import { projectToScreen, rotatedAabb } from '../utils/paperGeom'
import TagPickerDialog from './TagPickerDialog.vue'
import SearchBar from './SearchBar.vue'

const project = useProjectStore()
const ui = useUiStore()
const canvas = useCanvas()
const notify = useNotify()
const confirm = useConfirm()

// Общий флаг «идёт восстановление графа» (useAutosave + useUndoRedo): иначе
// snapshot → save → restore зациклится. Взводится и на массовых правках графа.
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
} = useAutosave({ restoringHistory })

const { initHistory, snapshot, scheduleSnapshot, undo, redo, cancelPendingSnapshot } = useUndoRedo({
  restoringHistory,
  saveAutosave: saveActiveForm,
})
const bus = useBusResize({ scheduleSnapshot })

// ─── Vue refs / JointJS state ───
// Объявляем до listeners-блока: useEventListener читает paperContainer как
// зависимость, а у `const`-ref'а нет hoisting'а (TDZ).
const paperContainer = ref(null)
let paper = null
let graph = null

// ─── Zoom / viewport ───
// zoomPercent живёт в singleton useCanvas — общая ссылка, чтобы зум читался без
// prop-drilling из любого компонента/композабла. Сама механика (колесо, кнопки ±,
// fit-to-content, доводка ячейки в вид) — в useCanvasZoom.
// Объявляем ДО listeners-блока: onWheel уходит туда ЗНАЧЕНИЕМ, а у `const`
// hoisting'а нет (TDZ) — ниже блока это падало бы на setup'е.
const zoomPercent = canvas.zoomPercent
const { onWheel, zoomByStep, fitToContent, centerOnCell } = useCanvasZoom(paperContainer)
// Подсветки по тегу и результатам поиска (CSS-классы на view'ах) — в композабле;
// clearCellClass переиспользуем для `.tms-selected` ниже.
const { clearCellClass } = useCellHighlight({ centerOnCell })
// Pan — в usePan (свои document move/up). onPanStart дёргаем из capture-mousedown
// ниже (средняя кнопка или Space+ЛКМ).
const { onPanStart, isPanning } = usePan()

// useEventListener авто-снимает всё на unmount, а ref-target цепляется после mount.
// Hoisted-функции можно ссылать до объявления, а всё из композаблов (`const`) —
// только после (TDZ, см. блок зума выше).
useEventListener(paperContainer, 'wheel', onWheel, { passive: false })
useEventListener(paperContainer, 'mousemove', onCanvasMouseMove)
useEventListener(paperContainer, 'mouseenter', onCanvasEnter)
useEventListener(paperContainer, 'mouseleave', onCanvasMouseLeave)
// Capture-фаза: ресайз шины и pan должны перехватить mousedown раньше JointJS,
// иначе он начнёт свой drag.
useEventListener(paperContainer, 'mousedown', bus.onMaybeStartResize, true)
useEventListener(paperContainer, 'mousedown', onPanMouseDown, true)
useEventListener(document, 'mouseup', onPanMouseUp)
useEventListener(window, 'keydown', onSpaceDown)
useEventListener(window, 'keyup', onSpaceUp)
// Свои document/window-события pan/lasso/palette-drag слушают сами.

// Ресайз окна → пересчёт размеров paper'а. Регистрируем в синхронном setup-скоупе:
// в async onMounted (после await) vueuse не зацепит scope-dispose и observer утечёт.
useResizeObserver(paperContainer, () => {
  if (!paper || !paperContainer.value) return
  paper.setDimensions(paperContainer.value.clientWidth, paperContainer.value.clientHeight)
})

// JointJS шлёт change:position ~60 раз/сек, и bumpVersion на каждый гонял бы
// details/overlayBtns на каждом mousemove. Подавляем в окне pointerdown → pointerup,
// эмитим один раз в конце. document-mouseup — fallback на отпускание вне холста
// (в синхронном скоупе, иначе auto-cleanup не встанет).
let isPointerDownOnCell = false
// «Ячейку тащат» — взводится на ПЕРВОМ change в окне pointer-down, т.е. на реальном
// drag'е, не на клике. Пока true, overlay-кнопки скрыты: bumpVersion подавлен, и они
// замерли бы на старом месте.
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
// Drag стенсила из палитры (превью + создание ячейки + врезка в провод + picker
// для cell_value) — целиком в usePaletteDrag. wireSplice (useWireSplice) нужен
// только ему, прокидываем напрямую. Цепляет свои document-листенеры сам.
const {
  previewVisible,
  previewStyle,
  draggingStencilSvg,
  valueTagPickerOpen,
  onValueTagPickerSelect,
  onValueTagPickerCancel,
} = usePaletteDrag(paperContainer, useWireSplice())

// Проектная оркестрация (переключение формы / импорт+экспорт .zip). Возвращает
// уже обёрнутые в общий busy-флаг функции (взаимное исключение) + оверлей-флаг.
const {
  exportingProject,
  projectBusy,
  selectForm: guardedSelectForm,
  importProjectFromArchive: guardedImportArchive,
  exportProjectToArchive: guardedExportArchive,
  createForm: guardedCreateForm,
  duplicateForm: guardedDuplicateForm,
  deleteForm: guardedDeleteForm,
  renameForm: guardedRenameForm,
  moveFormNode: guardedMoveForm,
} = useProject({
  restoringHistory,
  autosave: {
    saveActiveForm,
    persistMeta,
    replaceProject,
    readTagsText,
    persistForm,
    removeFormPersist,
  },
  undo: { cancelPendingSnapshot, initHistory },
  simulation: { stopSimulation, simulating },
  commitTextEdit,
  textEditing,
})

// useHotkeys навешивает window-keydown listener (через useEventListener — auto-cleanup).
useHotkeys({
  undo,
  redo,
  scheduleSnapshot,
  copySelection,
  pasteClipboard,
  duplicateSelection,
  // Обёртка (не прямая ссылка): rotateSelectedBy/flipSelected объявлены ниже —
  // стрелка резолвит их лениво, на keydown (после mount), TDZ не задевает.
  rotateSelected: (deg) => rotateSelectedBy(deg),
  flipSelected: (axis) => flipSelected(axis),
  onExport: guardedExportArchive,
  projectBusy,
  notify,
})

// Кнопка-лупа в тулбаре тогглит панель поиска: открыта → закрыть (со сбросом
// подсветки/матчей, как close в SearchBar), закрыта → открыть. Хоткей Ctrl+F
// живёт отдельно (в useHotkeys) и всегда открывает/рефокусит.
function toggleSearch() {
  if (ui.searchOpen) {
    canvas.clearSearch()
    ui.closeSearch()
  } else {
    ui.openSearch()
  }
}

// Multi-drag выделенных ячеек (+ изломов проводов между ними) — в useMultiDrag;
// хендлеры цепляем на paper/graph в onMounted.
const { prepareMultiDrag, onPositionChange, endMultiDrag, isMultiDragging } = useMultiDrag()

// ─── Overlay-фичи холста ───
// overlay-кнопки выделенной ячейки, hover-tooltip и контекстное меню. Все читают
// graph/paper через canvas.*-ref; tooltip получает suppress-предикат «идёт
// взаимодействие» (pan/drag/resize/edit).
const { overlayBtns, rotateSelectedBy, flipSelected, onDeleteSelected, toggleLockSelected } =
  useSelectionOverlay({
    scheduleSnapshot,
    textEditing,
    dragging: cellDragging,
  })
// Бейдж-замок в углу КАЖДОЙ заблокированной ячейки (виден без выделения — иначе
// непонятно, почему ячейка read-only). Позиция — правый-верхний угол visual-AABB
// (с учётом поворота), reactive через graphVersion/paperViewTick.
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

// Пунктирная рамка группы: при наведении на члена группы обводим весь её
// visual-AABB — видно границы группы до клика. Прячем во время drag'а.
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
  notify,
})
// Lasso — startLasso дёргаем из blank:pointerdown (обычный ЛКМ); move/up свои.
const { lassoRect, startLasso } = useLasso(paperContainer, { selectCellsWithBridges })

// ─── Pan-жесты (Figma-модель) ───────────────────────────────────────────────
// Средняя кнопка или Space+ЛКМ панят холст; обычный ЛКМ по пустому — лассо.
// Курсор: Space (наведён на холст) → grab, во время pan → grabbing, иначе обычный.
// spaceHeld/overCanvas — модульные флаги (не reactive, читаются в raw-хендлерах).
let spaceHeld = false
let overCanvas = false

function setCursor(value) {
  if (paperContainer.value) paperContainer.value.style.cursor = value
}

// Space-pan включаем только когда курсор над холстом — иначе перехватывали бы
// пробел в остальном UI (кнопки/скролл страницы).
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

// Capture-phase: перехватываем ДО JointJS, чтобы MMB/Space+ЛКМ не начали drag
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
// После любого mouseup возвращаем курсор в покой: grab, если Space ещё зажат
// (над холстом), иначе обычный. Отрабатывает конец pan'а во всех ветках.
function onPanMouseUp() {
  setCursor(spaceHeld ? 'grab' : '')
}

/**
 * Заменяет выделение на cells + автодобавленные «мостовые» линии между ними.
 * computeBridgeLinks — в utils/bridgeLinks.js, общая логика c useCanvas.
 *
 * keepLinks — провода, которые нужно сохранить в выделении (уже выделены вручную).
 * Нужен для toggle-веток (Ctrl+клик по ячейке, additive-лассо): без него любой
 * выделенный провод слетал бы, т.к. selection пересобирается из ячеек + мостов.
 * Дедуп по id — мост мог совпасть с уже выделённым проводом.
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

// ─── Resize шины (cell_bus), undo/redo, autosave — живут в composables.
// onMaybeStartResize вешается на mousedown в onMounted; isResizing() читают
// hover-tooltip и прочие места, которым нужно подавлять UI пока тянем edge.

onMounted(async () => {
  if (!paperContainer.value) return

  // Ждём, пока flex-лейаут проставит размеры карточки — иначе clientWidth/Height
  // окажутся слишком маленькими на момент создания paper'а.
  await nextTick()

  // Конфиг graph/paper (интерактив, снап связей, anchor'ы, validateConnection) —
  // в stencils/canvasPaper; здесь только подписка на события.
  graph = createCanvasGraph()
  paper = createCanvasPaper({
    el: paperContainer.value,
    graph,
    isSelected: (id) => canvas.isSelected(id),
  })

  // ─── Клик по пустому месту ───
  paper.on('blank:pointerdown', (evt) => {
    hideCellTooltip()
    // ЛКМ по пустому — всегда лассо. Pan (MMB / Space+ЛКМ) перехватывается
    // capture-mousedown'ом и сюда не доходит. Снятие выделения при клике без
    // drag'а делает сам onLassoEnd (маленькая рамка).
    startLasso(evt)
  })

  // ─── Selection ───
  // Ctrl/Cmd+click — toggle (multi-select); plain click — replace selection.
  // При multi-select ячеек автоматически добавляем линии между ними.
  paper.on('element:pointerdown', (elementView, evt) => {
    const cellId = elementView.model.id
    // Клик по члену группы выделяет всю группу целиком (expandGroups). Одиночная
    // ячейка → сама по себе.
    const groupItems = canvas.expandGroups([{ kind: 'cell', id: cellId }])
    const groupIds = groupItems.map((i) => i.id)
    if (evt.ctrlKey || evt.metaKey) {
      // Toggle группы (или одиночки) в выделении + пересчёт «мостов». Ранее
      // выделенные провода сохраняем (keepLinks) — иначе слетали бы при Ctrl+клике.
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
      // Plain-клик: группу — выделить целиком (если ещё не вся выделена); одиночку
      // — выделить её одну. Уже полностью выделенное не трогаем — отдаём под multi-drag.
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
  // Multi-drag: ведущая ячейка тянет остальных выделенных (см. useMultiDrag).
  graph.on('change:position', onPositionChange)
  paper.on('element:pointerup', endMultiDrag)

  // Double-click по cell_text — открыть inline-редактор поверх ячейки.
  paper.on('element:pointerdblclick', (elementView) => {
    const tms = elementView.model.get('tms') || {}
    if (tms.stencilId === 'cell_text') startTextEdit(elementView.model.id)
  })

  // Hover-tooltip: показываем над ячейкой при mouseenter, прячем при leave
  // и element:pointerdown. blank:pointerdown сам скрывает tooltip выше.
  paper.on('element:mouseenter', (view) => {
    hoveredCellId.value = view.model.id // для пунктирной рамки группы
    showCellTooltip(view)
  })
  paper.on('element:mouseleave', () => {
    hoveredCellId.value = null
    hideCellTooltip()
  })
  paper.on('element:pointerdown', hideCellTooltip)

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
  // Окно подавления bumpVersion при drag'е ячейки: флаг isPointerDownOnCell,
  // releasePointerDrag и document-mouseup fallback живут в синхронном setup-
  // скоупе (см. выше). Здесь только paper-события — paper готов лишь в onMounted.
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

  // Реконнект конца провода (arrowheadMove) меняет source/target — кладём в undo.
  // scheduleSnapshot сам пропускает во время restore, лишних снимков на загрузке нет.
  graph.on('change:source change:target', () => scheduleSnapshot())

  // Снап ручных изломов (linkTools.Vertices) к сетке: тул кладёт vertex в сырых
  // координатах, а линию gridRightAngleRouter держит на сетке — без снапа хэндл
  // отрывался бы от линии. vertexSnap-флаг гасит реентри (наш же set → событие).
  // + snapshot: linkTools.Vertices делает stopPropagation/undelegateEvents, поэтому
  // cell:pointerup для линка НЕ эмитится — без явного scheduleSnapshot правка изломов
  // (добавить/двигать/убрать) не попадала бы ни в undo, ни в autosave.
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

  // Линии — всегда за ячейками, чтобы порты не перекрывались линией в точке anchor.
  graph.on('add', (cell) => {
    // Фиксированный LINK_Z, а не toBack(): тот даёт min-1 и уводил бы z в дрейф.
    if (cell.isLink && cell.isLink()) cell.set('z', LINK_Z)
  })

  // Прокидываем graph/paper в composable ДО restoreProject — composable'ы
  // useAutosave / useUndoRedo читают их через canvas.graphRef.value.
  canvas.setCanvasRefs(graph, paper)

  // ─── Restore проекта из IndexedDB (активная форма → граф) ───
  // try/catch обязателен: битый graphJson в IndexedDB → fromJSON бросает, и без
  // перехвата onMounted оборвался бы ДО initHistory / graph.on — холст навсегда
  // без истории и хоткеев, лечится только ручной чисткой IDB. Ловим → пустой
  // холст + error-тост; остальные формы не тронуты, их можно открыть из дерева.
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

  // ─── History: snapshot на «стабильных» событиях ───
  // Только pointerup (после действия) + add/remove. На 'change' JointJS шлёт
  // десятки событий во время draw'а линии — дебаунс не всегда схлопывает.
  initHistory()

  // Drop элемента из палитры (для линий ждём pointerup, т.к. add'ятся в начале draw'а)
  graph.on('add', (cell) => {
    if (cell.isLink && cell.isLink()) return
    scheduleSnapshot()
  })

  // Удаление любой ячейки/линии
  graph.on('remove', () => {
    scheduleSnapshot()
    // Если hover-tooltip висел над удаляемой ячейкой, без явной зачистки
    // он остаётся на холсте — сама ячейка пропала, mouseleave не приходит.
    hideCellTooltip()
  })

  // Pointerup на любой cell-view: конец drag'а ячейки, конец draw'а линии,
  // конец редактирования link-tools.
  paper.on('cell:pointerup', () => scheduleSnapshot())

  // Регистрируем проектные операции чтобы ProjectActions мог их триггерить.
  // Переключение формы — панель форм дёргает через canvas.selectForm.
  canvas.setSelectFormFn(guardedSelectForm)
  // Импорт из .zip + экспорт (.zip) — ProjectActions дёргает через canvas.*Archive.
  canvas.setArchiveFns({
    importFromArchive: guardedImportArchive,
    exportToArchive: guardedExportArchive,
  })
  // Вписать контент в область видимости — импорт дёргает через canvas.fitToContent.
  canvas.setFitViewFn(fitToContent)
  // CRUD форм + DnD-перенос — FormTree дёргает через canvas.createForm/…/moveFormNode.
  canvas.setFormCrudFns({
    createForm: guardedCreateForm,
    duplicateForm: guardedDuplicateForm,
    deleteForm: guardedDeleteForm,
    renameForm: guardedRenameForm,
    moveForm: guardedMoveForm,
  })

  // Сообщаем о восстановлении уже после монтирования (toast service готов)
  if (restored > 0) {
    notify.info(
      'Автосейв восстановлен',
      `${nplural(restored, 'символ', 'символа', 'символов')} с прошлой сессии`
    )
    // Центрируем viewport на bbox восстановленного контента — иначе ячейки,
    // нарисованные в прошлой сессии где-нибудь в (500, 800), окажутся за
    // пределами видимой области (paper стартует с translate(0,0)).
    // nextTick — чтобы paperContainer успел получить итоговые clientWidth/Height.
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
    renameForm: null,
    moveForm: null,
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
      <!-- Слева — заголовок + симуляция: глобальное действие над всей схемой,
           остаётся на холсте (это взаимодействие с холстом, не проектное
           действие для шапки). -->
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Холст</h2>
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

        <!-- Поиск (Ctrl+F) — рядом с зумом: оба про навигацию по холсту. Кнопка
             делает фичу видимой, а не только клавиатурной (та же панель SearchBar). -->
        <Button
          v-tooltip.bottom="'Найти на схеме по тегу / тексту · Ctrl+F'"
          icon="pi pi-search"
          :severity="ui.searchOpen ? 'primary' : 'secondary'"
          :text="!ui.searchOpen"
          size="small"
          class="tms-icon-btn"
          @click="toggleSearch"
        />
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
            class="!font-mono !min-w-[3.25rem] !justify-center"
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
        :class="simulating ? 'tms-simulating ring-2 ring-inset ring-emerald-400/60 ' : ''"
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

      <!-- Hover-tooltip над ячейкой: лейбл стенсила + «В группе (N)» у сгруппированной.
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
            <i class="pi pi-th-large !text-[9px]" />
            В группе ({{ cellHoverTooltip.groupCount }})
          </div>
        </div>
      </Transition>

      <!-- Inline-overlay одиночной выделенной ячейки: поворот ↺/↻ и отражение H/V
           (скрыты у noRotate/locked — `canTransform`), удаление (скрыто у locked)
           и замок (виден всегда — им же блокировку снимают). Reactive
           HTML-overlay, а не JointJS elementTools.Remove: тот кэширует позицию и
           не следует за resize. -->
      <template v-if="overlayBtns">
        <Button
          v-if="overlayBtns.canTransform"
          v-tooltip.top="'Повернуть против часовой · Shift+R'"
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
          v-tooltip.top="'Повернуть по часовой · R'"
          icon="pi pi-undo -scale-x-100"
          severity="secondary"
          rounded
          size="small"
          class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
          :style="overlayBtns.rotateCw"
          @click="rotateSelectedBy(90)"
        />
        <Button
          v-if="overlayBtns.canTransform"
          v-tooltip.top="'Отразить по горизонтали · Shift+H'"
          icon="pi pi-arrows-h"
          severity="secondary"
          rounded
          size="small"
          class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
          :style="overlayBtns.flipH"
          @click="flipSelected('h')"
        />
        <Button
          v-if="overlayBtns.canTransform"
          v-tooltip.top="'Отразить по вертикали · Shift+V'"
          icon="pi pi-arrows-v"
          severity="secondary"
          rounded
          size="small"
          class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
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
          class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
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
          class="!absolute !z-20 !w-8 !h-8 !p-0 !min-w-0 !border !border-surface-300 hover:!border-surface-400"
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
        <i class="pi pi-lock !text-[9px]" />
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

      <!-- Empty canvas hint — показываем когда нет ячеек и не идёт drag.
 Двухшаговый чек-лист: tag-list → стенсил. Первый шаг отмечается ✓
 когда теги загружены (без tag-list'а анимации стенсилов не работают). -->
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

    <TagPickerDialog
      v-model:visible="valueTagPickerOpen"
      :tags="project.floatTags"
      header="Выберите тег для отображения значения"
      @select="onValueTagPickerSelect"
      @cancel="onValueTagPickerCancel"
    />

    <ContextMenu ref="ctxMenuRef" :model="ctxItems" />
  </section>
</template>
