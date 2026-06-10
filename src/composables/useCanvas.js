import { shallowRef, ref, computed } from 'vue'
import { computeBridgeLinks } from '../utils/bridgeLinks'
import { cellMatchesQuery } from '../utils/cellSearch'

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
// Внешним компонентам (ProjectActions) удобно дёргать importFromSvg(text) без знания
// о деталях. Если CanvasPane не смонтирован — no-op.
const importFromSvgFn = shallowRef(null)

// Аналогично для экспорта — кнопка живёт в ProjectActions, но логика
// (graph+paper + download) в CanvasPane.
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
// Индикаторы для footer'а.
// recentlySaved — короткий «flash» на 1.5 сек после сохранения (зелёная галочка).
// lastSavedAt — timestamp последнего успешного autosave'а (для «N сек назад»).
const recentlySaved = ref(false)
const lastSavedAt = ref(0)
const canUndo = ref(false)
const canRedo = ref(false)

// Тик для внешних запросов snapshot'а (Inspector после правки слотов и т.п.).
// CanvasPane watch'ит изменения и вызывает свой scheduleSnapshot.
const snapshotTick = ref(0)

// Запрос «открыть picker первого пустого required-слота» — bump'ается клик'ом
// по жёлтому badge'у на холсте. Inspector watch'ит и сам открывает picker
// (Canvas не знает про устройство Inspector'а; Inspector не знает про badge).
// Ячейку Inspector берёт из текущего selection — onSlotBadgeClick перед bump'ом
// делает selectOnly, так что к моменту watcher'а нужный объект уже выделен.
const slotPickRequest = ref(0)

// Тег, по которому в данный момент подсвечены элементы. Матчит по любому
// tag-полю (slots, voltageSource.tag, switchSources.tags, valueTag —
// см. cellHasTag), не только voltageSource. null = подсветки нет.
// Кнопка «Подсветить на схеме» в VoltageSourceBlock / SwitchBlock
// включает/выключает это значение через toggle: тот же тег второй раз
// → снимает подсветку.
const highlightedTag = ref(null)

// ─── Ctrl+F поиск по схеме ───
// searchQuery — что юзер набрал в SearchBar (lower-case-normalize при матчинге).
// searchMatchIds — id'шники cells, у которых хоть одна tag-привязка содержит
// query как substring. Сортировка по позиции (y, x) — стабильный порядок цикла.
// searchCurrentIdx — индекс «текущего» match'а (на котором фокус, центрируется).
const searchQuery = ref('')
const searchMatchIds = ref([])
const searchCurrentIdx = ref(0)
// Debounce-задержка между keystroke и фактическим прогоном matcher'а.
// 120ms — input ощущается мгновенным, но при rapid typing N getCells'ов
// не запускаются на каждую букву.
const SEARCH_DEBOUNCE_MS = 120
let searchDebounceTimer = null

function performSearchMatch(query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  const graph = graphRef.value
  if (!q || !graph) {
    searchMatchIds.value = []
    searchCurrentIdx.value = 0
    return
  }
  const matched = []
  for (const cell of graph.getCells()) {
    if (cellMatchesQuery(cell, q)) matched.push(cell)
  }
  // bbox-кэш: comparator зовётся ~O(n log n) раз — без кэша N getBBox()
  // на каждое сравнение (cell.getBBox() в JointJS тащит size+position+rotate).
  const withBBox = matched.map((c) => ({ id: c.id, bbox: c.getBBox() }))
  withBBox.sort((a, b) => {
    if (a.bbox.y !== b.bbox.y) return a.bbox.y - b.bbox.y
    return a.bbox.x - b.bbox.x
  })
  searchMatchIds.value = withBBox.map((x) => x.id)
  searchCurrentIdx.value = 0
}

const cellsCount = computed(() => {
  graphVersion.value // touch для reactive-зависимости
  return graphRef.value?.getElements().length || 0
})

const linksCount = computed(() => {
  graphVersion.value // touch для reactive-зависимости
  return graphRef.value?.getLinks().length || 0
})

// Когда выделен ровно один элемент — удобно для Inspector'а в single-mode
const singleSelection = computed(() => (selection.value.length === 1 ? selection.value[0] : null))

// Краткое описание выделения для info-bar canvas'а
const selectionLabel = computed(() => {
  graphVersion.value // touch для reactive-зависимости
  const sel = selection.value
  if (sel.length === 0) return null
  if (sel.length > 1) return `выделено: ${sel.length}`
  const item = sel[0]
  const graph = graphRef.value
  const cell = graph?.getCell(item.id)
  if (!cell) return null
  if (item.kind === 'cell') {
    // В status-bar показываем первый заполненный slot как «идентификатор объекта».
    // Если слотов нет / все пустые — просто «ячейка».
    const tms = cell.get('tms') || {}
    const slots = tms.slots || {}
    const firstTag = Object.values(slots).find((v) => v)
    return firstTag ? `ячейка · ${firstTag}` : 'ячейка'
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
    lastSavedAt,
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
    setCursorLocal(point) {
      cursorLocal.value = point
    },
    setRecentlySaved(value) {
      recentlySaved.value = value
    },
    setLastSavedAt(ts) {
      lastSavedAt.value = ts
    },
    slotPickRequest,
    requestSlotPick() {
      slotPickRequest.value++
    },
    highlightedTag,
    /** Toggle подсветки тега на холсте. Тот же тег → выкл, новый → переключаем. */
    toggleHighlightedTag(tag) {
      if (!tag) return
      highlightedTag.value = highlightedTag.value === tag ? null : tag
    },
    clearHighlightedTag() {
      highlightedTag.value = null
    },
    searchQuery,
    searchMatchIds,
    searchCurrentIdx,
    /**
     * Прогнать query по всем cells графа. Перевычисляет matchIds и сбрасывает
     * currentIdx в 0. Пустой/whitespace-only query даёт пустой результат (без
     * подсветки). Порядок — top→bottom, left→right по bbox.
     */
    runSearch(query) {
      // searchQuery обновляем мгновенно — input v-model видит изменения сразу.
      // Фактический match-цикл по графу дебаунсим, чтобы не пускать его
      // на каждую букву при быстром наборе.
      searchQuery.value = query
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = setTimeout(() => performSearchMatch(query), SEARCH_DEBOUNCE_MS)
    },
    /** dir = +1 (next) или -1 (prev). Циклически. No-op если match'ей нет. */
    cycleSearchMatch(dir) {
      const n = searchMatchIds.value.length
      if (!n) return
      searchCurrentIdx.value = (searchCurrentIdx.value + dir + n) % n
    },
    clearSearch() {
      // Гасим pending debounce — иначе он бы дописал результат поверх очистки.
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
      searchQuery.value = ''
      searchMatchIds.value = []
      searchCurrentIdx.value = 0
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
