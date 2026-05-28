import { shallowRef, ref, computed } from 'vue'
import { computeBridgeLinks } from '../utils/bridgeLinks'

/**
 * Shared singleton-доступ к JointJS-состоянию холста.
 *
 * CanvasPane при монтировании регистрирует graph/paper через setCanvasRefs,
 * остальные компоненты (Inspector, AppFooter) читают их через useCanvas().
 *
 * Selection — массив { kind: 'cell'|'link', id }. Пустой массив = ничего не выделено.
 * singleSelection — удобный computed для single-mode компонентов: возвращает item
 * если выделен ровно один, иначе null.
 */

// graph/paper — нереактивные объекты JointJS, shallowRef достаточно
const graphRef = shallowRef(null)
const paperRef = shallowRef(null)

// CanvasPane регистрирует свою функцию импорта SVG → граф через setImportFromSvgFn.
// Внешним компонентам (AppHeader) удобно дёргать importFromSvg(text) без знания
// о деталях. Если CanvasPane не смонтирован — no-op.
const importFromSvgFn = shallowRef(null)

// Аналогично для экспорта — кнопка живёт в AppHeader, но логика (graph+paper +
// download) в CanvasPane.
const exportFn = shallowRef(null)


const selection = ref([]) // Array<{ kind, id }>

const graphVersion = ref(0)
// Тик paper-view: bump'ается на pan/zoom/fit. Нужен для overlay'ев, чьё
// положение зависит от paper.translate()/scale() (× кнопка, hover-tooltip
// при будущем расширении). Отделён от graphVersion чтобы не дёргать Inspector
// и прочих consumer'ов graph-данных на каждый mousemove во время pan'а.
const paperViewTick = ref(0)

// ─── Status-bar метрики ───
const zoomPercent = ref(100)
// { x, y } в paper-локальных координатах либо null когда курсор вне холста
const cursorLocal = ref(null)
// Индикаторы для footer'а
const recentlySaved = ref(false)
const canUndo = ref(false)
const canRedo = ref(false)

// Тик для внешних запросов snapshot'а (Inspector после смены prefix'а).
// CanvasPane watch'ит изменения и вызывает свой scheduleSnapshot.
const snapshotTick = ref(0)

const cellsCount = computed(() => {
  // eslint-disable-next-line no-unused-expressions
  graphVersion.value
  return graphRef.value?.getElements().length || 0
})

const linksCount = computed(() => {
  // eslint-disable-next-line no-unused-expressions
  graphVersion.value
  return graphRef.value?.getLinks().length || 0
})

// Когда выделен ровно один элемент — удобно для Inspector'а в single-mode
const singleSelection = computed(() =>
  selection.value.length === 1 ? selection.value[0] : null
)

// Краткое описание выделения для info-bar canvas'а
const selectionLabel = computed(() => {
  // eslint-disable-next-line no-unused-expressions
  graphVersion.value
  const sel = selection.value
  if (sel.length === 0) return null
  if (sel.length > 1) return `выделено: ${sel.length}`
  const item = sel[0]
  const graph = graphRef.value
  const cell = graph?.getCell(item.id)
  if (!cell) return null
  if (item.kind === 'cell') {
    const prefix = cell.get('tms')?.prefix
    return prefix ? `ячейка · ${prefix}` : 'ячейка'
  }
  if (item.kind === 'link') return 'провод'
  return null
})

export function useCanvas() {
  return {
    graphRef,
    paperRef,
    selection,
    singleSelection,
    graphVersion,
    zoomPercent,
    cursorLocal,
    cellsCount,
    linksCount,
    recentlySaved,
    canUndo,
    canRedo,
    snapshotTick,
    selectionLabel,
    setCanvasRefs(graph, paper) {
      graphRef.value = graph
      paperRef.value = paper
    },
    setImportFromSvgFn(fn) {
      importFromSvgFn.value = fn
    },
    importFromSvg(text, sourceLabel) {
      return importFromSvgFn.value?.(text, sourceLabel) ?? false
    },
    setExportFn(fn) {
      exportFn.value = fn
    },
    exportProject() {
      return exportFn.value?.() ?? false
    },
    clearCanvasRefs() {
      graphRef.value = null
      paperRef.value = null
      selection.value = []
      cursorLocal.value = null
    },
    isSelected(id) {
      return selection.value.some((s) => s.id === id)
    },
    // Заменяет выделение на один элемент
    selectOnly(kind, id) {
      selection.value = [{ kind, id }]
    },
    // Toggle: добавляет если нет, убирает если есть
    toggleInSelection(kind, id) {
      if (selection.value.some((s) => s.id === id)) {
        selection.value = selection.value.filter((s) => s.id !== id)
      } else {
        selection.value = [...selection.value, { kind, id }]
      }
    },
    // Полная замена массива items
    setSelection(items) {
      selection.value = items.slice()
    },
    clearSelection() {
      selection.value = []
    },
    /** Выделить все ячейки на холсте + bridge-линии между ними. */
    selectAllCells() {
      const graph = graphRef.value
      if (!graph) return
      const cells = graph.getElements()
      const cellItems = cells.map((c) => ({ kind: 'cell', id: c.id }))
      const bridges = computeBridgeLinks(
        graph,
        cells.map((c) => c.id)
      )
      selection.value = [...cellItems, ...bridges]
    },
    setZoomPercent(value) {
      zoomPercent.value = value
    },
    setCursorLocal(point) {
      cursorLocal.value = point
    },
    setRecentlySaved(value) {
      recentlySaved.value = value
    },
    setUndoRedoAvail(undo, redo) {
      canUndo.value = undo
      canRedo.value = redo
    },
    requestSnapshot() {
      snapshotTick.value++
    },
    bumpVersion() {
      graphVersion.value++
    },
    paperViewTick,
    bumpPaperView() {
      paperViewTick.value++
    },
  }
}
