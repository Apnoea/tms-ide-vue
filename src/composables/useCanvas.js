import { shallowRef, ref, computed } from 'vue'
import { computeBridgeLinks } from '../utils/bridgeLinks'
import { cellMatchesQuery } from '../utils/cellSearch'
import { planWireBridge } from '../utils/wireSplice'
import {
  planZOrder,
  ELEMENT_Z_BOUNDS,
  BACKGROUND_Z_BOUNDS,
  BACKGROUND_Z_TOP,
  isBackgroundZ,
} from '../utils/zOrder'
import { LINK_Z_BOUNDS } from '../stencils/linkDefaults'
import { isShapeCell } from '../stencils/shapeElement'

// Уникальный id логической группы ячеек (`tms.groupId`). Короткий, но глобально
// уникальный — round-trip'ится в data-tms-meta.
export function genGroupId() {
  const rnd = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  return `grp-${rnd.replace(/[^a-z0-9]/gi, '').slice(0, 10)}`
}

/**
 * Shared singleton-доступ к JointJS-состоянию холста.
 *
 * CanvasPane при монтировании регистрирует graph/paper через setCanvasRefs, остальные
 * компоненты читают их через useCanvas().
 *
 * Selection — массив { kind: 'cell'|'link', id }; singleSelection отдаёт item, только
 * если выделен ровно один.
 */

// graph/paper — нереактивные объекты JointJS, shallowRef достаточно
const graphRef = shallowRef(null)
const paperRef = shallowRef(null)

// Переключение формы: панель форм дёргает selectForm(id), оркестрацию (сохранить
// текущую → загрузить выбранную + сброс undo) держит useProject.
const selectFormFn = shallowRef(null)

// Импорт и экспорт .zip: кнопки в ProjectActions дёргают эти fn, оркестрацию
// (распаковка, прогон форм через paper, бандл) держит useProject.
const importArchiveFn = shallowRef(null)
const exportArchiveFn = shallowRef(null)

// Вписать контент в область видимости: реализация в CanvasPane (у неё paper и размеры
// контейнера), зовётся после импорта и переключения формы.
const fitViewFn = shallowRef(null)

// CRUD форм и DnD-перенос узла дерева; оркестрацию (стор, IDB, перезагрузка холста)
// держит useProject.
const createFormFn = shallowRef(null)
const duplicateFormFn = shallowRef(null)
const deleteFormFn = shallowRef(null)
const restoreFormFn = shallowRef(null)
// Корзина удалённых форм: данные держит useProject, здесь — ссылка на его ref, чтобы
// кнопка возврата над деревом видела список. Наружу отдаём развёрнутый массив.
const formTrashSource = shallowRef(null)
const formTrash = computed(() => formTrashSource.value?.value ?? [])
const renameFormFn = shallowRef(null)
const moveFormFn = shallowRef(null)

const selection = ref([]) // Array<{ kind, id }>

const graphVersion = ref(0)
// Тик paper-view: bump'ается на pan/zoom/fit — по нему пересчитываются overlay'и,
// зависящие от paper.translate()/scale(). Отделён от graphVersion, чтобы не дёргать
// инспектор на каждый mousemove во время pan'а.
const paperViewTick = ref(0)

// ─── Status-bar метрики ───
const zoomPercent = ref(100)
// { x, y } в paper-локальных координатах либо null когда курсор вне холста
const cursorLocal = ref(null)
// saveError — последняя запись в IndexedDB упала (квота / приватный режим):
// статус-полоса показывает «не сохранено». Успех автосейва не индицируется.
const saveError = ref(false)
const canUndo = ref(false)
const canRedo = ref(false)

// Есть ли изменения, не попавшие в .zip: автосейв пишет только в IndexedDB, файл
// проекта при этом устаревает. true — граф менялся после последнего экспорта или
// импорта. Старт с false: свежая сессия совпадает с тем, что в IDB.
const dirtySinceExport = ref(false)

// Тик для внешних запросов snapshot'а (инспектор после правки слотов): CanvasPane
// watch'ит его и зовёт свой scheduleSnapshot.
const snapshotTick = ref(0)

// Тег, по которому подсвечены элементы: матч по любому tag-полю (cellHasTag), null =
// подсветки нет. Кнопка «Подсветить на схеме» тоглит значение.
const highlightedTag = ref(null)

// ─── Ctrl+F поиск по схеме ───
// searchQuery — запрос из SearchBar (матчинг по lower-case). searchMatchIds — id
// ячеек, у которых совпала хоть одна строка поиска; порядок по позиции (y, x).
// searchCurrentIdx — индекс текущего совпадения (оно центрируется).
const searchQuery = ref('')
const searchMatchIds = ref([])
const searchCurrentIdx = ref(0)
// Debounce между нажатием и прогоном matcher'а: 120ms ощущаются мгновенно, но обход
// графа не идёт на каждую букву.
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
  // bbox-кэш: comparator зовётся ~O(n log n) раз, а getBBox() тащит
  // size+position+rotate на каждый вызов.
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

// Ровно один выделенный элемент — для одиночного режима инспектора.
const singleSelection = computed(() => (selection.value.length === 1 ? selection.value[0] : null))

// Краткое описание выделения для статус-полосы.
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
    // Первый заполненный слот работает как идентификатор объекта; слотов нет —
    // просто «символ».
    const tms = cell.get('tms') || {}
    const slots = tms.slots || {}
    const firstTag = Object.values(slots).find((v) => v)
    return firstTag ? `символ · ${firstTag}` : 'символ'
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
    setFormCrudFns({
      createForm,
      duplicateForm,
      deleteForm,
      restoreForm,
      renameForm,
      moveForm,
      trash,
    }) {
      createFormFn.value = createForm
      duplicateFormFn.value = duplicateForm
      deleteFormFn.value = deleteForm
      restoreFormFn.value = restoreForm
      formTrashSource.value = trash || null
      renameFormFn.value = renameForm
      moveFormFn.value = moveForm
    },
    createForm() {
      return createFormFn.value?.()
    },
    duplicateForm(id) {
      return duplicateFormFn.value?.(id)
    },
    deleteForm(id) {
      return deleteFormFn.value?.(id)
    },
    restoreForm(id) {
      return restoreFormFn.value?.(id)
    },
    formTrash,
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
    // Заменяет выделение одним элементом.
    selectOnly(kind, id) {
      selection.value = [{ kind, id }]
    },
    // Тогл: добавить, если нет; убрать, если есть.
    toggleInSelection(kind, id) {
      if (selection.value.some((s) => s.id === id)) {
        selection.value = selection.value.filter((s) => s.id !== id)
      } else {
        selection.value = [...selection.value, { kind, id }]
      }
    },
    // Полная замена набора выделенных.
    setSelection(items) {
      selection.value = items.slice()
    },
    clearSelection() {
      selection.value = []
    },
    /**
     * Удаляет items ({kind,id}) с холста. При удалении РОВНО одного символа-прохода
     * (ровно 2 провода к 2 разным соседям) провода сращиваются в один: выживший линк
     * перецеливается на дальний конец второго ДО удаления, иначе каскад JointJS снёс бы
     * оба. В мульти-выделении срастания нет — туда авто-попадают мостовые провода.
     * Снимок и версию дают graph-листенеры CanvasPane.
     */
    deleteItems(items) {
      const graph = graphRef.value
      if (!graph || !items?.length) return
      // Заблокированные ячейки (`tms.locked`) не удаляются, их провода тоже остаются.
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
            // Изломы обоих проводов сшиваются в один список — считаем ДО перецеливания
            // и удаления, пока пути сегментов на месте. Центр элемента не вставляем: он
            // лежит на прямом участке, и round-trip врезка→срастание сломался бы.
            // Последовательность a→b: сначала изломы выжившего в порядке a→элемент
            // (реверс, если элемент был его source), потом изломы удаляемого в порядке
            // элемент→b (реверс, если элемент был его target).
            const sv = survivor.vertices() || []
            const dv = dropped.vertices() || []
            const aSide = plan.survivorEnd === 'target' ? sv : [...sv].reverse()
            const dropElemEnd = dropped.get('source')?.id === items[0].id ? 'source' : 'target'
            const bSide = dropElemEnd === 'source' ? dv : [...dv].reverse()
            const seq = [...aSide, ...bSide].map((v) => ({ ...v }))
            // Порядок vertices в линке — source→target: при survivorEnd='target'
            // финальный source=a (последовательность как есть), иначе реверс.
            survivor.vertices(plan.survivorEnd === 'target' ? seq : seq.reverse())
          }
          survivor?.set(plan.survivorEnd, plan.endpoint)
        }
      }
      // Группы удаляемых: после remove с одиночного остатка снимается `groupId`.
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
    /**
     * Выделить все ячейки на холсте + bridge-линии между ними.
     *
     * Заблокированные (`tms.locked`) не берём — как их не берёт лассо: замок ставят,
     * чтобы объект (подложка, рамка схемы) не попадал в массовые операции.
     */
    selectAllCells() {
      const graph = graphRef.value
      if (!graph) return
      const cells = graph.getElements().filter((c) => !c.get('tms')?.locked)
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
     * Прогнать query по всем ячейкам графа: пересчитывает matchIds и сбрасывает
     * currentIdx. Пустой запрос даёт пустой результат; порядок — сверху вниз, слева
     * направо по bbox.
     */
    runSearch(query) {
      // searchQuery обновляется мгновенно (его видит v-model), а обход графа
      // дебаунсится.
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
      // Pending debounce гасим: иначе он дописал бы результат поверх очистки.
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
     * Тогл «замка» ячеек (`tms.locked`): есть хоть одна свободная — блокируем все,
     * иначе снимаем. Класс `tms-locked` на view.el правится точечно (индикатор и
     * скрытие хэндлов), при пересборке DOM его вернёт injectStencilSvg. У проводов
     * замка нет.
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
     * Дополняет список cell-items до ЦЕЛЫХ групп: затронут член — добавляются все.
     * Единая точка «выделять группу целиком» для клика и лассо.
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
      // locked-ячейки не группируем: groupId — правка tms.
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
    /**
     * Модели выделения, доступные на ЗАПИСЬ: всё кроме заблокированных (у линков замка
     * нет). Единая точка для массовых операций: `paper.interactive` их не защищает,
     * правки идут программно.
     */
    writableItems(items) {
      const graph = graphRef.value
      if (!graph) return []
      return (items || []).map((i) => graph.getCell(i.id)).filter((c) => c && !c.get('tms')?.locked)
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
        // locked не разгруппировываем: groupId — правка tms.
        if (!tms?.groupId || tms.locked) continue
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
    /**
     * Порядок наложения (z): 'front' / 'back' / 'forward' / 'backward'. У слоёв
     * (символы, провода, подложка) свои полосы, поэтому команда двигает только свой
     * слой и перенумеровывает его целиком (utils/zOrder). У проводов порядок виден на
     * пересечении: мостик рисует тот, кто выше.
     *
     * РАЗМЕТКА — исключение: фигура может уйти в подложку, ниже проводов. Отдельной
     * команды нет, те же четыре водят её между слоями по краям: «на задний план» кладёт
     * в подложку сразу, «ниже» — когда фигура уже на дне слоя символов.
     *
     * Всё одним батчем: `jumpover` пересчитывает пути по `batch:stop`, иначе мостик
     * залипает на прежнем проводе.
     */
    reorderCells(items, mode) {
      const graph = graphRef.value
      if (!graph) return
      const ids = new Set((items || []).map((i) => i.id))
      const zOf = (c) => c.get('z') ?? 0
      const byZ = (a, b) => zOf(a) - zOf(b)
      const elements = graph.getElements()

      graph.startBatch('reorder')

      // Переход между подложкой и слоем символов: значения промежуточные, слои
      // перенумеровываются ниже.
      const crossed = new Set()
      const down = mode === 'back' || mode === 'backward'
      const up = mode === 'front' || mode === 'forward'
      if (down || up) {
        const bg = elements.filter((c) => isBackgroundZ(zOf(c))).sort(byZ)
        const front = elements.filter((c) => !isBackgroundZ(zOf(c))).sort(byZ)
        const topZ = front.length ? zOf(front[front.length - 1]) : 0
        for (const cell of elements) {
          if (!ids.has(cell.id) || !isShapeCell(cell)) continue
          const inBg = isBackgroundZ(zOf(cell))
          if (down && !inBg && (mode === 'back' || front[0]?.id === cell.id)) {
            // 'back' — сразу на дно подложки, шаг «ниже» — на её верх.
            cell.set('z', mode === 'back' ? BACKGROUND_Z_BOUNDS.min - 1 : BACKGROUND_Z_TOP)
            crossed.add(cell.id)
          } else if (up && inBg && (mode === 'front' || bg[bg.length - 1]?.id === cell.id)) {
            // 'front' — на самый верх, шаг «выше» — на дно слоя символов.
            cell.set('z', mode === 'front' ? topZ + 1 : ELEMENT_Z_BOUNDS.min - 0.5)
            crossed.add(cell.id)
          }
        }
      }

      // Слои считаем ПОСЛЕ переходов: фигура уже в новом.
      const layers = [
        {
          cells: elements.filter((c) => isBackgroundZ(zOf(c))).sort(byZ),
          bounds: BACKGROUND_Z_BOUNDS,
        },
        {
          cells: elements.filter((c) => !isBackgroundZ(zOf(c))).sort(byZ),
          bounds: ELEMENT_Z_BOUNDS,
        },
        { cells: graph.getLinks(), bounds: LINK_Z_BOUNDS },
      ]
      let changed = crossed.size > 0
      for (const { cells, bounds } of layers) {
        const targets = cells.filter((c) => ids.has(c.id)).map((c) => c.id)
        if (!targets.length) continue
        // Перешедшую фигуру двигать вторым шагом нельзя — она уже в крайнем
        // положении нового слоя, поэтому слой только перенумеровываем.
        const layerMode = targets.some((id) => crossed.has(id)) ? 'keep' : mode
        const plan = planZOrder(
          cells.map((c) => ({ id: c.id, z: zOf(c) })),
          targets,
          layerMode,
          bounds
        )
        for (const { id, z } of plan) graph.getCell(id)?.set('z', z)
        changed = changed || plan.length > 0
      }
      graph.stopBatch('reorder')
      if (!changed) return
      graphVersion.value++
      snapshotTick.value++
    },
    paperViewTick,
    bumpPaperView() {
      paperViewTick.value++
    },
  }
}
