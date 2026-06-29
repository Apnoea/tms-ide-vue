<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { dia, shapes, anchors, connectionPoints, linkTools, routers } from '@joint/core'
import { tmsNamespace } from '../stencils/tmsStencil'
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import Tag from 'primevue/tag'
import { useNotify, TOAST_LIFE } from '../composables/useNotify'
import { useConfirm } from 'primevue/useconfirm'
import { LINK_DEFAULTS, gridRightAngleRouter } from '../stencils/linkDefaults'
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
import { useSlotWarnings } from '../composables/useSlotWarnings'
import { useSelectionOverlay } from '../composables/useSelectionOverlay'
import { useHoverTooltip } from '../composables/useHoverTooltip'
import { usePan } from '../composables/usePan'
import { useLasso } from '../composables/useLasso'
import { useContextMenu } from '../composables/useContextMenu'
import { usePaletteDrag } from '../composables/usePaletteDrag'
import { nplural } from '../utils/plural'
import { withRestoreGuard } from '../utils/restoreGuard'
import { computeBridgeLinks } from '../utils/bridgeLinks'
import { cellHasTag } from '../utils/cellSearch'
import TagPickerDialog from './TagPickerDialog.vue'
import TagListControl from './TagListControl.vue'
import SaveIndicator from './SaveIndicator.vue'
import SearchBar from './SearchBar.vue'

const project = useProjectStore()
const ui = useUiStore()
const canvas = useCanvas()
const notify = useNotify()
const confirm = useConfirm()

// Общий флаг «идёт восстановление графа» — useAutosave и useUndoRedo делят его,
// чтобы не зациклиться snapshot → save → restore → snapshot. Также взводится
// при массовых правках графа (performClearCanvas, переключение/импорт форм).
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

const { initHistory, scheduleSnapshot, undo, redo, cancelPendingSnapshot } = useUndoRedo({
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

// ─── Listeners ───
// useEventListener авто-снимает всё на unmount. Hoisted-функции (onWheel,
// onCanvasMouseMove, ...) можно ссылать до их объявления — script-setup
// поднимает `function` declarations к верху scope'а.
//
// paperContainer-target: ref наполнится после mount, listener зацепится тогда.
useEventListener(paperContainer, 'wheel', onWheel, { passive: false })
useEventListener(paperContainer, 'mousemove', onCanvasMouseMove)
useEventListener(paperContainer, 'mouseleave', onCanvasMouseLeave)
// Capture-phase mousedown для resize шины — раньше JointJS, чтобы он не начал drag.
useEventListener(paperContainer, 'mousedown', bus.onMaybeStartResize, true)
// Pan/lasso/palette-drag слушают свои document/window-события сами
// (usePan/useLasso/usePaletteDrag).

// Перерасчёт размера paper'а при изменении контейнера (ресайз окна).
// Регистрируем здесь, в синхронном setup-скоупе: внутри async onMounted
// (после await) vueuse не зацепил бы scope-dispose и observer утёк бы на unmount.
useResizeObserver(paperContainer, () => {
  if (!paper || !paperContainer.value) return
  paper.setDimensions(paperContainer.value.clientWidth, paperContainer.value.clientHeight)
})

// Во время drag'а ячейки JointJS шлёт change:position ~60 раз/сек — bumpVersion
// на каждый event гонял бы Inspector.details / overlayBtns на каждом mousemove.
// Подавляем bumpVersion в окне cell:pointerdown → cell:pointerup (флаг ниже),
// эмитим один на pointerup. Сами cell:pointerdown/up вешаются в onMounted (нужен
// paper), а document-mouseup — fallback на отпускание вне холста — здесь, в
// синхронном скоупе: в async onMounted (после await) auto-cleanup не встал бы.
let isPointerDownOnCell = false
function releasePointerDrag() {
  if (!isPointerDownOnCell) return
  isPointerDownOnCell = false
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

// Проектная оркестрация (переключение формы / импорт / экспорт папки). Возвращает
// уже обёрнутые в общий busy-флаг функции (взаимное исключение) + оверлей-флаг.
const {
  exportingProject,
  selectForm: guardedSelectForm,
  importProject: guardedImportProject,
  exportProjectToFolder: guardedExport,
  createForm: guardedCreateForm,
  deleteForm: guardedDeleteForm,
  renameForm: guardedRenameForm,
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
  onExport: guardedExport,
})

// ─── Zoom state ───
// zoomPercent живёт в singleton useCanvas — общая ссылка, чтобы зум читался без
// prop-drilling из любого компонента/композабла.
const zoomPercent = canvas.zoomPercent
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

// Pan — в usePan (свои document move/up). onPanStart дёргаем из blank:pointerdown.
const { onPanStart, isPanning } = usePan(paperContainer)

// Multi-drag: id ячейки, за которую пользователь начал drag, и снимок
// исходных позиций всех selected-ячеек. Очищается на element:pointerup.
let activeDragCellId = null
let dragSnapshot = null

// ─── Overlay-фичи холста (вынесены в composables) ───
// slot-warning бейджи, overlay-кнопки выделенной ячейки, hover-tooltip и
// контекстное меню. Все читают graph/paper через canvas.*-ref; tooltip получает
// suppress-предикат «идёт взаимодействие» (pan/drag/resize/edit).
const { slotWarnings, onSlotBadgeClick } = useSlotWarnings()
const { overlayBtns, rotateSelectedBy, onDeleteSelected } = useSelectionOverlay({
  scheduleSnapshot,
  textEditing,
})
const { cellHoverTooltip, showCellTooltip, hideCellTooltip } = useHoverTooltip({
  suppress: () => isPanning() || !!activeDragCellId || bus.isResizing() || textEditing.value,
})
const { ctxMenuRef, ctxItems, showContextMenu } = useContextMenu({
  hasClipboard,
  pasteClipboard,
  copySelection,
  duplicateSelection,
})
// Lasso — startLasso дёргаем из blank:pointerdown (Alt+ЛКМ); move/up свои.
const { lassoRect, startLasso } = useLasso(paperContainer, { selectCellsWithBridges })

/**
 * Заменяет выделение на cells + автодобавленные «мостовые» линии между ними.
 * computeBridgeLinks — в utils/bridgeLinks.js, общая логика c useCanvas.
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

// ─── Resize шины (cell_bus), undo/redo, autosave — живут в composables.
// onMaybeStartResize вешается на mousedown в onMounted; isResizing() читают
// hover-tooltip и прочие места, которым нужно подавлять UI пока тянем edge.

const GRID_COLOR = '#e2e8f0' // slate-200

onMounted(async () => {
  if (!paperContainer.value) return

  // Ждём, пока flex-лейаут проставит размеры карточки — иначе clientWidth/Height
  // окажутся слишком маленькими на момент создания paper'а.
  await nextTick()

  graph = new dia.Graph({}, { cellNamespace: tmsNamespace })

  paper = new dia.Paper({
    el: paperContainer.value,
    model: graph,
    width: '100%',
    height: '100%',
    gridSize: 10,
    // Кастомный grid-снапящий роутер рядом со встроенными. LinkView резолвит имя
    // через paper.options.routerNamespace (по умолчанию — глобальный `routers`),
    // НЕ через `routers`-опцию. Спред сохраняет встроенные + добавляет
    // 'gridRightAngle' → имя резолвится и в редакторе, и на загрузке из JSON/SVG.
    routerNamespace: { ...routers, gridRightAngle: gridRightAngleRouter },
    drawGrid: {
      name: 'dot',
      color: GRID_COLOR,
      thickness: 1,
    },
    // CSS с !important в style.css переопределяет inline-стиль JointJS.
    background: { color: '#f8fafc' },
    cellViewNamespace: tmsNamespace,
    // Линки: тащим ТОЛЬКО концы (переанкеринг к порту) и только у ВЫДЕЛЕННОГО
    // провода. vertices / linkMove выключены — маршрут авто (rightAngle-роутер),
    // «только порты». validateConnection + linkPinning:false держат конец на
    // валидном порту. Ячейки — полный интерактив.
    interactive: (cellView) => {
      const m = cellView.model
      if (m.isLink?.()) {
        return {
          arrowheadMove: canvas.isSelected(m.id),
          vertexAdd: false,
          vertexMove: false,
          vertexRemove: false,
          linkMove: false,
        }
      }
      return true
    },
    // ─── Пороги обнаружения click vs drag ───
    // Без них любое микро-движение мышью при клике на magnet превращается в
    // draft-линию (мусор в undo-стек). 4-5px — стандарт UI-индустрии.
    clickThreshold: 5,
    magnetThreshold: 4,
    // ─── Конфигурация связей ───
    linkPinning: false, // линии не могут болтаться в воздухе
    // Снэп endpoint'а линии к ближайшему magnet'у в радиусе — пользователю
    // не нужно «целиться» в маленький кружок порта, достаточно бросить линию
    // рядом, JointJS сам подтянет к ближайшему порту ячейки.
    snapLinks: { radius: 30 },
    // Линия заканчивается ровно в позиции anchor'а порта (центр кружка),
    // а не подгоняется под boundary магнита (тогда был бы offset = portRadius).
    // Для cell_node — отдельный случай: anchor стоит на стороне bbox'а
    // (midSide, см. ниже), но визуально провод тянем дальше — до центра
    // ячейки, где нарисована точка. Без этого был бы 10px gap между концом
    // провода (на edge bbox'а) и видимым диском в центре.
    defaultConnectionPoint: function (line, view) {
      const stencilId = view?.model?.get?.('tms')?.stencilId
      if (stencilId === 'cell_node') return view.model.getBBox().center()
      return connectionPoints.anchor.apply(this, arguments)
    },
    // Anchor — точка ВНУТРИ элемента, от которой router строит путь. По дефолту
    // используем центр магнита (= позиция порта). Для cell_node порт стоит в
    // центре bbox'а (10,10) — внутри элемента, не на границе. rightAngle с
    // anchor'ом ВНУТРИ bbox'а всегда заходит в элемент с одной стороны
    // (визуально «провод приходит слева» независимо от направления source'а).
    // midSide динамически выбирает середину ближайшей стороны bbox'а — провод
    // заходит с естественного направления. `this` для anchors.* должен быть
    // linkView (внутри они дёргают this.paper.findView) — поэтому `apply`.
    defaultAnchor: function (view) {
      const stencilId = view?.model?.get?.('tms')?.stencilId
      const fn = stencilId === 'cell_node' ? anchors.midSide : anchors.center
      return fn.apply(this, arguments)
    },
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

  // ─── Pan vs Lasso + reset selection на blank-клике ───
  // Plain LMB-drag = pan + сброс выделения/подсветки (естественный «выход»).
  // Alt+LMB-drag = lasso (выделение рамкой), selection не трогаем — юзер
  // расширяет его рамкой.
  paper.on('blank:pointerdown', (evt) => {
    hideCellTooltip()
    if (evt.altKey) {
      startLasso(evt)
      return
    }
    onPanStart(evt)
    canvas.clearSelection()
    if (canvas.highlightedTag.value) canvas.clearHighlightedTag()
  })

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
  // ─── Multi-drag: при перетаскивании одной из multi-selected ячеек —
  // синхронно сдвигаем все остальные с тем же delta. opt.multiDrag блокирует
  // рекурсию при программном set('position') у соседей.
  graph.on('change:position', (cell, newPos, opt) => {
    if (opt?.multiDrag || opt?.uiNudge) return
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

  // Hover-tooltip: показываем над ячейкой при mouseenter, прячем при leave
  // и element:pointerdown. blank:pointerdown сам скрывает tooltip выше.
  paper.on('element:mouseenter', showCellTooltip)
  paper.on('element:mouseleave', hideCellTooltip)
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
    if (isPointerDownOnCell) return
    canvas.bumpVersion()
  })

  // Реконнект конца провода (arrowheadMove) меняет source/target — кладём в undo.
  // scheduleSnapshot сам пропускает во время restore, лишних снимков на загрузке нет.
  graph.on('change:source change:target', () => scheduleSnapshot())

  // Снап ручных изломов (linkTools.Vertices) к сетке: тул кладёт vertex в сырых
  // координатах, а линию gridRightAngleRouter держит на сетке — без снапа хэндл
  // отрывался бы от линии. vertexSnap-флаг гасит реентри (наш же set → событие).
  graph.on('change:vertices', (link, vertices, opt) => {
    if (opt?.vertexSnap || !paper || !vertices?.length) return
    const g = paper.options.gridSize || 10
    const snapped = vertices.map((v) => ({
      x: Math.round(v.x / g) * g,
      y: Math.round(v.y / g) * g,
    }))
    if (snapped.some((s, i) => s.x !== vertices[i].x || s.y !== vertices[i].y)) {
      link.vertices(snapped, { vertexSnap: true })
    }
  })

  // Линии — всегда за ячейками, чтобы порты не перекрывались линией в точке anchor.
  graph.on('add', (cell) => {
    if (cell.isLink && cell.isLink()) cell.toBack()
  })

  // Прокидываем graph/paper в composable ДО restoreProject — composable'ы
  // useAutosave / useUndoRedo читают их через canvas.graphRef.value.
  canvas.setCanvasRefs(graph, paper)

  // ─── Restore проекта из IndexedDB (активная форма → граф) ───
  const restored = await restoreProject()

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
  // Импорт проекта — ProjectActions дёргает через canvas.importProject.
  canvas.setImportProjectFn(guardedImportProject)
  // Экспорт проекта — ProjectActions дёргает через canvas.exportProjectToFolder.
  canvas.setProjectExportFn(guardedExport)
  // CRUD форм — FormTabs дёргает через canvas.createForm/deleteForm/renameForm.
  canvas.setFormCrudFns({
    createForm: guardedCreateForm,
    deleteForm: guardedDeleteForm,
    renameForm: guardedRenameForm,
  })

  // Сообщаем о восстановлении уже после монтирования (toast service готов)
  if (restored > 0) {
    notify.info(
      'Автосейв восстановлен',
      `${nplural(restored, 'ячейка', 'ячейки', 'ячеек')} с прошлой сессии`
    )
    // Центрируем viewport на bbox восстановленного контента — иначе ячейки,
    // нарисованные в прошлой сессии где-нибудь в (500, 800), окажутся за
    // пределами видимой области (paper стартует с translate(0,0)).
    // nextTick — чтобы paperContainer успел получить итоговые clientWidth/Height.
    await nextTick()
    fitToContent()
  }
})

// Ручки концов выделенного провода — кружок размером с порт (r=3), но
// контрастного цвета. Рендерятся в слое инструментов ПОВЕРХ порт-magnet'ов,
// поэтому перетаскивание конца не перебивается созданием нового провода (magnet
// иначе выигрывает). Тащим ручку → конец переанкерится к порту
// (arrowheadMove + validateConnection + linkPinning:false держат на валидном порту).
const ENDPOINT_HANDLE_ATTRS = {
  r: 3,
  fill: '#f97316', // orange-500 — отличать от cyan-порта, читается как «тащи меня»
  stroke: '#ffffff',
  'stroke-width': 1,
  cursor: 'move',
}
const SourceEndpointHandle = linkTools.SourceArrowhead.extend({
  tagName: 'circle',
  attributes: ENDPOINT_HANDLE_ATTRS,
})
const TargetEndpointHandle = linkTools.TargetArrowhead.extend({
  tagName: 'circle',
  attributes: ENDPOINT_HANDLE_ATTRS,
})
// Ручка излома (linkTools.Vertices) — дефолт r=6; ужимаем до размера порта (r=3),
// цвет/ободок стоковые (навигационный navy + белый ободок).
const VertexHandle = linkTools.Vertices.VertexHandle.extend({
  attributes: {
    r: 3,
    fill: '#33334f',
    stroke: '#ffffff',
    'stroke-width': 1,
    cursor: 'move',
  },
})

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
    // Снимаем arrowhead-ручки со всех проводов (навесим заново на выделенные).
    for (const link of graph?.getLinks() || []) paper.findViewByModel(link)?.removeTools()

    if (!Array.isArray(sel) || sel.length === 0) return
    for (const item of sel) {
      const cell = graph?.getCell(item.id)
      if (!cell) continue
      const view = paper.findViewByModel(cell)
      if (!view) continue
      view.el?.classList.add('tms-selected')
      // Провод: ручки концов для переанкеринга к другому порту + изломы
      // (Vertices) для ручной правки маршрута. Изломы снапятся к сетке
      // отдельным change:vertices-хендлером, чтобы хэндл не отрывался от линии,
      // которую gridRightAngleRouter держит на сетке. redundancyRemoval убирает
      // излом, легший на прямую между соседями; double-click по линии добавляет.
      // Порядок важен: Vertices первым → его vertex-adding обёртка (ловит клик
      // по всей линии для добавления излома) лежит НИЖЕ эндпоинт-ручек. Иначе
      // обёртка перебивает клик у конца и рисует излом вместо перемещения.
      if (cell.isLink?.()) {
        view.addTools(
          new dia.ToolsView({
            tools: [
              new linkTools.Vertices({
                snapRadius: 10,
                redundancyRemoval: true,
                handleClass: VertexHandle,
              }),
              new SourceEndpointHandle(),
              new TargetEndpointHandle(),
            ],
          })
        )
      }
    }
    // Inline-× — HTML-overlay (deleteBtnStyle в template). JointJS
    // elementTools.Remove кэширует bbox при addTools, не пересчитывает на
    // cell.resize → × застревал после ресайза cell_text / cell_bus.
  }
  // deep НЕ нужен: selection всегда ЗАМЕНЯЕТСЯ новым массивом (selectOnly/
  // setSelection/toggle/clear), ref-сравнения достаточно — дип-обход был впустую.
)

// ─── Подсветка элементов по тегу (кнопка «Подсветить на схеме»). ───
// Watch на canvas.highlightedTag: на set/change перерисовываем класс
// tms-tag-match у всех cells/links с любым tag-полем == tag (см. cellHasTag —
// slots, voltageSource.tag, switchSources, valueTag). Подсветка
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
  // useEventListener / useResizeObserver / composable'ы сами снимают свои
  // ресурсы — здесь только сбрасываем singleton-ссылки на graph/paper.
  hideCellTooltip() // pending hover-tooltip не должен стрелять после unmount
  canvas.clearCanvasRefs()
  canvas.setSelectFormFn(null)
  canvas.setImportProjectFn(null)
  canvas.setProjectExportFn(null)
  canvas.setFormCrudFns({ createForm: null, deleteForm: null, renameForm: null })
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

  // Нативный JointJS 4 fit-to-content: сам считает bbox, масштабирует И
  // центрирует через horizontalAlign/verticalAlign. maxScale: 1 — не
  // приближаем больше 100% (для маленького контента просто центрируется).
  paper.transformToFitContent({
    padding: 40,
    minScale: MIN_ZOOM,
    maxScale: 1,
    horizontalAlign: 'middle',
    verticalAlign: 'middle',
    useModelGeometry: false,
  })

  zoomPercent.value = Math.round(paper.scale().sx * 100)
  canvas.bumpPaperView()
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
  cancelPendingSnapshot()
  withRestoreGuard(restoringHistory, () => {
    graph.clear()
    canvas.bumpVersion()
  })
  clearActiveForm()
  // Сбрасываем history до текущего пустого состояния
  initHistory()
  canvas.clearSelection()

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
      class="min-h-16 px-4 py-3 border-b border-surface-200 bg-surface-0 flex items-center justify-between gap-2"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Холст</h2>
        <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>
        <TagListControl />
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

        <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>

        <Button
          v-tooltip.bottom="'Вписать в экран (до 100%)'"
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
          @click="toggleSimulation"
        />

        <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>

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

      <!-- Hover-tooltip над ячейкой: лейбл стенсила, его id и id в animations.json.
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
          <div class="text-[10px] opacity-75 mt-0.5 font-mono truncate">
            {{ cellHoverTooltip.stencilId }}
          </div>
          <div class="text-[10px] opacity-60 mt-0.5 font-mono truncate">
            {{ cellHoverTooltip.exportId }}
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

      <!-- Индикатор автосейва — слева-снизу (симметрично координатам справа). -->
      <SaveIndicator />

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
 когда теги загружены (без tag-list'а анимации стенсилов не работают). -->
      <div
        v-if="canvas.cellsCount.value === 0 && !ui.dragging"
        class="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div class="text-center text-surface-400 px-4">
          <div class="text-sm font-medium text-surface-500 mb-3">Пустой холст</div>
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
              <span class="text-surface-600">Перетащите стенсил из палитры слева</span>
            </li>
          </ul>
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
