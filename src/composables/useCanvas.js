import { shallowRef, ref, computed } from 'vue'
import { computeBridgeLinks } from '../utils/bridgeLinks'
import { cellMatchesQuery } from '../utils/cellSearch'
import { planWireBridge } from '../utils/wireSplice'

// Уникальный id логической группы ячеек (`tms.groupId`). Короткий, но глобально
// уникальный — round-trip'ится в data-tms-meta.
export function genGroupId() {
  const rnd = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  return `grp-${rnd.replace(/[^a-z0-9]/gi, '').slice(0, 10)}`
}

/**
 * Shared singleton-доступ к JointJS-состоянию холста.
 *
 * CanvasPane при монтировании регистрирует graph/paper через setCanvasRefs,
 * остальные компоненты (Inspector, StatusBar) читают их через useCanvas().
 *
 * Selection — массив { kind: 'cell'|'link', id }. Пустой массив = ничего не выделено.
 * singleSelection — удобный computed для single-mode компонентов: возвращает item
 * если выделен ровно один, иначе null.
 */

// graph/paper — нереактивные объекты JointJS, shallowRef достаточно
const graphRef = shallowRef(null)
const paperRef = shallowRef(null)

// Переключение формы: панель форм (сосед по layout) дёргает selectForm(id), а
// оркестрацию (сохранить текущую → загрузить выбранную + сброс undo) держит
// useProject (смонтирован в CanvasPane, там graph/paper/undo).
const selectFormFn = shallowRef(null)

// Импорт из .zip + экспорт проекта в .zip (единственный формат ввода-вывода):
// кнопки в ProjectActions дёргают эти fn, оркестрацию (распаковка / прогон форм
// через paper → бандл → download) держит useProject (смонтирован в CanvasPane).
const importArchiveFn = shallowRef(null)
const exportArchiveFn = shallowRef(null)

// Вписать контент в область видимости (fit-to-content). Реализация в CanvasPane
// (у неё paper + размеры контейнера); зовётся после импорта/переключения.
const fitViewFn = shallowRef(null)

// CRUD форм + DnD-перенос узла дерева (панель форм дёргает). Оркестрацию (стор +
// IDB + перезагрузка холста) держит useProject в CanvasPane.
const createFormFn = shallowRef(null)
const deleteFormFn = shallowRef(null)
const renameFormFn = shallowRef(null)
const moveFormFn = shallowRef(null)

const selection = ref([]) // Array<{ kind, id }>

const graphVersion = ref(0)
// Тик paper-view: bump'ается на pan/zoom/fit. Нужен для overlay'ев, чьё
// положение зависит от paper.translate()/scale() (кнопки выделенной ячейки —
// useSelectionOverlay). Отделён от graphVersion чтобы не дёргать Inspector
// и прочих consumer'ов graph-данных на каждый mousemove во время pan'а.
const paperViewTick = ref(0)

// ─── Status-bar метрики ───
const zoomPercent = ref(100)
// { x, y } в paper-локальных координатах либо null когда курсор вне холста
const cursorLocal = ref(null)
// saveError — последняя запись в IndexedDB упала (квота / приватный режим):
// статус-полоса показывает «не сохранено», чтобы юзер не закрыл вкладку с потерей
// данных. Успех автосейва отдельно не индицируем (это ожидаемое поведение).
const saveError = ref(false)
const canUndo = ref(false)
const canRedo = ref(false)

// Есть ли изменения, не попавшие в экспортированный .zip. Автосейв пишет только в
// IndexedDB — файл проекта на диске при этом устаревает. Флаг разводит две модели:
// «сохранено в браузере» ≠ «выгружено в .zip». true — любое изменение графа после
// последнего экспорта/импорта; false — состояние совпадает с последним доставленным
// архивом. Стартуем с false (свежая сессия = как в IDB, т.е. как последний импорт/экспорт).
const dirtySinceExport = ref(false)

// Тик для внешних запросов snapshot'а (Inspector после правки слотов и т.п.).
// CanvasPane watch'ит изменения и вызывает свой scheduleSnapshot.
const snapshotTick = ref(0)

// Тег, по которому в данный момент подсвечены элементы. Матчит по любому
// tag-полю (slots, voltageSource.tag, switchSources, valueTag —
// см. cellHasTag), не только voltageSource. null = подсветки нет.
// Кнопка «Подсветить на схеме» в RangeBlock / BooleanBlock
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
    saveError,
    dirtySinceExport,
    canUndo,
    canRedo,
    snapshotTick,
    selectionLabel,
    setCanvasRefs(graph, paper) {
      graphRef.value = graph
      paperRef.value = paper
    },
    setSelectFormFn(fn) {
      selectFormFn.value = fn
    },
    selectForm(id) {
      return selectFormFn.value?.(id)
    },
    setArchiveFns({ importFromArchive, exportToArchive }) {
      importArchiveFn.value = importFromArchive
      exportArchiveFn.value = exportToArchive
    },
    importProjectFromArchive() {
      return importArchiveFn.value?.()
    },
    exportProjectToArchive() {
      return exportArchiveFn.value?.()
    },
    setFitViewFn(fn) {
      fitViewFn.value = fn
    },
    fitToContent() {
      return fitViewFn.value?.()
    },
    setFormCrudFns({ createForm, deleteForm, renameForm, moveForm }) {
      createFormFn.value = createForm
      deleteFormFn.value = deleteForm
      renameFormFn.value = renameForm
      moveFormFn.value = moveForm
    },
    createForm() {
      return createFormFn.value?.()
    },
    deleteForm(id) {
      return deleteFormFn.value?.(id)
    },
    renameForm(oldId, newId) {
      return renameFormFn.value?.(oldId, newId)
    },
    moveFormNode(dragId, targetId, zone) {
      return moveFormFn.value?.(dragId, targetId, zone)
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
    /**
     * Удаляет items ({kind,id}) с холста. При удалении РОВНО одного стенсила-
     * прохода (ровно 2 провода к 2 разным соседям) сращивает провода в один
     * вместо разрыва: выживший линк перецеливается на дальний конец второго ДО
     * удаления — иначе каскад JointJS снёс бы оба сегмента. В multi-select
     * срастание не делаем: туда авто-попадают мостовые провода между ячейками
     * (computeBridgeLinks), и сохранять нечего. Снапшот/версию дают graph-
     * листенеры CanvasPane (один debounced шаг undo).
     */
    deleteItems(items) {
      const graph = graphRef.value
      if (!graph || !items?.length) return
      // Заблокированные ячейки (`tms.locked`) не удаляем — «замок» read-only.
      // Их связанные провода тоже остаются (ячейка на месте). Тихо пропускаем.
      items = items.filter((it) => it.kind !== 'cell' || !graph.getCell(it.id)?.get('tms')?.locked)
      if (!items.length) return
      if (items.length === 1 && items[0].kind === 'cell') {
        const el = graph.getCell(items[0].id)
        const links = el
          ? graph.getConnectedLinks(el).map((l) => ({
              id: l.id,
              source: l.get('source'),
              target: l.get('target'),
            }))
          : []
        const plan = planWireBridge(links, items[0].id)
        if (plan) {
          const survivor = graph.getCell(plan.survivorId)
          const dropped = graph.getCell(plan.dropId)
          if (survivor && dropped) {
            // Сращиваем изломы обоих проводов: иначе выживший линк сохранил бы
            // только свои, а изломы второго сегмента пропали бы (провод
            // «спрямлялся» в новый маршрут). Считаем ДО перецеливания/удаления —
            // пути сегментов ещё на месте. Центр элемента НЕ вставляем: при врезке
            // элемент садится на ПРЯМОЙ участок (между изломами), его центр лежит
            // на прямой → лишняя точка, и round-trip врезка→срастание ломался бы.
            // Геометрическая последовательность a→b:
            //  • a-сторона = изломы выжившего в порядке a→элемент (реверс, если
            //    элемент был его source);
            //  • b-сторона = изломы удаляемого в порядке элемент→b (реверс, если
            //    элемент был его target).
            const sv = survivor.vertices() || []
            const dv = dropped.vertices() || []
            const aSide = plan.survivorEnd === 'target' ? sv : [...sv].reverse()
            const dropElemEnd = dropped.get('source')?.id === items[0].id ? 'source' : 'target'
            const bSide = dropElemEnd === 'source' ? dv : [...dv].reverse()
            const seq = [...aSide, ...bSide].map((v) => ({ ...v }))
            // Порядок vertices в линке — source→target. survivorEnd='target' даёт
            // финальный source=a → последовательность как есть; 'source' даёт
            // source=b → реверс.
            survivor.vertices(plan.survivorEnd === 'target' ? seq : seq.reverse())
          }
          survivor?.set(plan.survivorEnd, plan.endpoint)
        }
      }
      // Группы удаляемых — чтобы после remove снять `groupId` с одиночного
      // остатка (группа из одной ячейки бессмысленна).
      const affectedGroups = new Set(
        items
          .filter((it) => it.kind === 'cell')
          .map((it) => graph.getCell(it.id)?.get('tms')?.groupId)
          .filter(Boolean)
      )
      for (const item of items) graph.getCell(item.id)?.remove()
      for (const gid of affectedGroups) {
        const members = graph.getElements().filter((e) => e.get('tms')?.groupId === gid)
        if (members.length === 1) {
          const m = members[0]
          const next = { ...m.get('tms') }
          delete next.groupId
          m.set('tms', next)
        }
      }
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
    setSaveError(value) {
      saveError.value = value
    },
    /** Помечает наличие невыгруженных в .zip изменений (любая правка графа). */
    markDirty() {
      dirtySinceExport.value = true
    },
    /** Состояние совпало с доставленным архивом (успешный экспорт / импорт). */
    markExported() {
      dirtySinceExport.value = false
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
    /**
     * Тоггл «замка» ячеек (`tms.locked`). Смешанное выделение → лочим все (если
     * хоть одна свободна), иначе снимаем. Класс `tms-locked` на view.el правим
     * точечно (индикатор/скрытие хэндлов); при пересборке DOM его восстановит
     * injectStencilSvg. Провода/линки — без замка (нет геометрии для блокировки).
     */
    toggleLocked(items) {
      const graph = graphRef.value
      const paper = paperRef.value
      if (!graph) return
      const cells = (items || [])
        .filter((i) => i.kind === 'cell')
        .map((i) => graph.getCell(i.id))
        .filter(Boolean)
      if (!cells.length) return
      const lock = cells.some((c) => !c.get('tms')?.locked) // хоть одна свободна → лочим все
      for (const c of cells) {
        const tms = c.get('tms') || {}
        const next = { ...tms }
        if (lock) next.locked = true
        else delete next.locked
        c.set('tms', next)
        paper?.findViewByModel(c)?.el?.classList.toggle('tms-locked', lock)
      }
      graphVersion.value++
      snapshotTick.value++
    },
    /**
     * Дополняет список cell-items до ЦЕЛЫХ групп: если затронут член группы —
     * добавляет всех её членов. Единая точка «выделять группу целиком» для клика
     * и лассо. Линки/не-члены не трогает.
     */
    expandGroups(cellItems) {
      const graph = graphRef.value
      if (!graph) return cellItems
      const groupIds = new Set()
      for (const it of cellItems) {
        if (it.kind !== 'cell') continue
        const g = graph.getCell(it.id)?.get('tms')?.groupId
        if (g) groupIds.add(g)
      }
      if (!groupIds.size) return cellItems
      const seen = new Set(cellItems.filter((i) => i.kind === 'cell').map((i) => i.id))
      const result = [...cellItems]
      for (const el of graph.getElements()) {
        const g = el.get('tms')?.groupId
        if (g && groupIds.has(g) && !seen.has(el.id)) {
          result.push({ kind: 'cell', id: el.id })
          seen.add(el.id)
        }
      }
      return result
    },
    /** Объединить выделенные ячейки (≥2) в новую группу (общий `groupId`).
     *  Возвращает число сгруппированных ячеек (0 — если группировать нечего). */
    groupCells(items) {
      const graph = graphRef.value
      if (!graph) return 0
      // locked-ячейки не группируем — groupId это правка tms, а замок read-only.
      const cells = (items || [])
        .filter((i) => i.kind === 'cell')
        .map((i) => graph.getCell(i.id))
        .filter((c) => c && !c.get('tms')?.locked)
      if (cells.length < 2) return 0
      const gid = genGroupId()
      for (const c of cells) c.set('tms', { ...(c.get('tms') || {}), groupId: gid })
      graphVersion.value++
      snapshotTick.value++
      return cells.length
    },
    /** Снять группировку с выделенных ячеек. Возвращает число разгруппированных. */
    ungroupCells(items) {
      const graph = graphRef.value
      if (!graph) return 0
      let count = 0
      for (const i of items || []) {
        if (i.kind !== 'cell') continue
        const c = graph.getCell(i.id)
        const tms = c?.get('tms')
        if (!tms?.groupId) continue
        const next = { ...tms }
        delete next.groupId
        c.set('tms', next)
        count++
      }
      if (count) {
        graphVersion.value++
        snapshotTick.value++
      }
      return count
    },
    paperViewTick,
    bumpPaperView() {
      paperViewTick.value++
    },
  }
}
