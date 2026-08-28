/**
 * Модель редактора символов. Хранит черновик: метаданные, список примитивов,
 * порты и анимацию состояния; отдаёт операции над ними + сборку артефактов на выход.
 *
 * Только состояние и чистая логика: привязка драга и ресайза живёт в компоненте
 * StencilEditor, где есть ref'ы на SVG-элементы. Синглтон — один черновик на холст
 * редактора и панель свойств; при входе reset() для нового символа либо loadStencil()
 * для правки. createStencilEditor — фабрика для тестов.
 *
 * Две сетки: вершины фигур снапятся к SHAPE_GRID (1px), порты и размер символа — к
 * PORT_GRID (5, сетка схемы). Визуальная сетка холста рисуется своим шагом и со
 * снапом не связана.
 */
import { computed, reactive, ref } from 'vue'
import { reorderIds } from '../utils/zOrder'
import { snapToGrid } from '../utils/grid'
import {
  serializeSvg,
  buildStencilJson,
  cropToContent,
  parseStencilSvg,
  translateShape,
  shapeBounds,
  shapesBounds,
  rotateShape90,
  flipShape,
  portSeqFrom,
} from '../utils/stencilSvg'
import { normalizeStateColor } from '../constants/animation'
import { normalizeDomains } from '../constants/domains'

export const SHAPE_GRID = 1
export const PORT_GRID = 5
/**
 * Шаг ГАБАРИТА символа при обрезке по контенту — 10, а не PORT_GRID: поворот на 90°
 * идёт вокруг (w/2, h/2), и при нечётной половине (ширина 15 → центр 7.5) порт,
 * снапнутый к 5, попадает на полуклетку. Кратность 10 держит центр на сетке, а сдвиг
 * контента при кропе кратен 10, поэтому порты остаются кратными 5.
 */
const BOX_GRID = 10

// Слот-драйвер внутренней анимации: булев режим → ключ `onoff` (hasBoolSlot), режим
// «по значению» → ключ `value` (тег, значение которого выбирает состояние).
// Обесточивание и цвет по диапазонам задаёт холст, в символе их нет.
const boolSlot = () => ({ key: 'onoff' })
const valueSlot = () => ({ key: 'value' })

// Пресет подписей состояний КА (СТО 56947007, табл. 6–8). Ключ (`key`) стабилен и
// идёт в суффикс группы `data-anim-suffix=".on"`; код (значение тега) проектно-зависим,
// его вписывает автор и в суффикс он не входит.
export const STATE_PRESETS = [
  { key: 'on', label: 'Включен' },
  { key: 'off', label: 'Отключен' },
  { key: 'intermediate', label: 'Промежуточное' },
  { key: 'invalid', label: 'Недостоверно' },
  { key: 'fault', label: 'Неисправность' },
]
// Быстрый шаблон «Сигнал положения» — 4 состояния. «Неисправность» не входит: её
// триггерит рантайм по таймауту, а не значение тега.
const POSITION_SIGNAL_KEYS = ['on', 'off', 'intermediate', 'invalid']

// Инкрементный id для v-for и выделения; в stencil.json и shape.svg внутренние id не
// попадают.
let seq = 0
const nextId = () => `s${++seq}`

export function createStencilEditor() {
  // noRotate/noFlip/quality — декл-флаги символа, уезжают в json. `static` в редакторе
  // не задаётся (его несут только встроенные text/value). stateful — мастер-тумблер
  // анимации: выключен = в json нет slots и animationTemplate; включён — режим задаёт
  // stateMode (`boolean`: слот onoff и видимость по true/false, либо `value`: слот value
  // + states).
  const meta = reactive({
    id: '',
    label: '',
    category: '',
    // Области применения (см. constants/domains) — фильтр палитры, не подкатегории.
    domains: [],
    width: 40,
    height: 40,
    noRotate: false,
    noFlip: false,
    quality: false,
    stateful: false,
    stateMode: 'boolean', // 'boolean' | 'value'
    stateSlot: boolSlot(),
    // Режим «по значению»: [{ key (стабильный, → суффикс), label, code }].
    states: [],
    // Цвет перекраса ВСЕГО символа по состоянию: { <ключ состояния>: '#rrggbb' }; ключи
    // булева — 'true'/'false', режима значения — key из states. Пусто = состояние
    // меняет только видимость. Обесточивание с холста бьёт этот цвет.
    stateColors: {},
    // Сколько имён портов выдано. Имя порта — ВЕЧНЫЙ ключ: по нему провод держится за
    // порт и оно уезжает в `data-tms-meta`, поэтому имена не переиспользуются. Иначе
    // провод, оставшийся на прежнем имени в другой форме, сядет на новый порт.
    portSeq: 0,
  })
  const shapes = ref([])
  const ports = ref([])
  const tool = ref('select') // 'select' | 'rect' | 'line' | 'circle' | 'polyline' | 'port'
  // Выделение множественное (клик, Ctrl+клик, лассо).
  const selectedIds = ref([])
  // Порты выделяются СВОИМ списком, а не общим с фигурами: у них нет ни свойств
  // (инспектор рисует «Фигуру»), ни порядка наложения, ни копирования — общее
  // выделение пришлось бы фильтровать в каждом потребителе. Взаимно исключающее:
  // клик по фигуре снимает выделение портов и наоборот, поэтому Del всегда очевиден.
  const selectedPortIds = ref([])
  const selectedPortSet = computed(() => new Set(selectedPortIds.value))
  const selectedSet = computed(() => new Set(selectedIds.value))
  // «Ровно одна» — гейт ручек ресайза и полей геометрии/текста. При N>1 null.
  const selectedId = computed(() => (selectedIds.value.length === 1 ? selectedIds.value[0] : null))
  // Превью состояния (эмуляция animation-hidden): 'all' — все фигуры, иначе ключ
  // состояния. В синглтоне, потому что селектор рисует инспектор, а фильтрует фигуры
  // StencilEditor.
  const previewState = ref('all')
  // Выключение анимации сбрасывает превью и quality (он завязан на драйвящий тег):
  // это делает setAnimationMode синхронно, ДО снимка истории, а не watch'ем после.

  // id редактируемого символа (null = создание нового). При правке id заблокирован
  // (= имя папки) и исключён из проверки уникальности.
  const editingId = ref(null)

  // ─── Undo/redo ───
  // Снимки {meta, shapes, ports}: мета — такие же данные символа, как фигуры, поэтому
  // Ctrl+Z откатывает и её. Дискретные операции коммитят сами, правки «живьём» (drag,
  // ввод, пипетка) — вызывающий на конце жеста. previewState в снимок не входит.
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const history = ref([])
  const histIndex = ref(-1)
  const canUndo = computed(() => histIndex.value > 0)
  const canRedo = computed(() => histIndex.value < history.value.length - 1)

  function commit() {
    const snap = { meta: clone(meta), shapes: clone(shapes.value), ports: clone(ports.value) }
    const last = history.value[histIndex.value]
    // Дедуп no-op'ов (клик без протяжки, drag без сдвига).
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return
    history.value = history.value.slice(0, histIndex.value + 1)
    history.value.push(snap)
    histIndex.value = history.value.length - 1
  }
  function restore(snap) {
    // meta — reactive-объект, на который смотрят инспектор и холст: правим поля, а не
    // подменяем ссылку.
    Object.assign(meta, clone(snap.meta))
    shapes.value = clone(snap.shapes)
    ports.value = clone(snap.ports)
    selectedIds.value = []
    // Превью могло смотреть на состояние, которого в восстановленной мете нет.
    if (previewState.value !== 'all' && !stateKeyExists(previewState.value)) {
      previewState.value = 'all'
    }
  }
  /** Есть ли такой ключ состояния в текущей мете (для валидации превью). */
  function stateKeyExists(key) {
    if (!meta.stateful) return false
    if (meta.stateMode === 'boolean') return key === 'true' || key === 'false'
    return meta.states.some((s) => s.key === key)
  }
  function undo() {
    if (!canUndo.value) return
    histIndex.value--
    restore(history.value[histIndex.value])
  }
  function redo() {
    if (!canRedo.value) return
    histIndex.value++
    restore(history.value[histIndex.value])
  }

  // Снап координаты к сетке фигур/портов, с зажимом в bbox символа (0..W/0..H).
  const clamp = (v, max) => Math.max(0, Math.min(max, v))
  const snapShapeX = (x) => clamp(snapToGrid(x, SHAPE_GRID), meta.width)
  const snapShapeY = (y) => clamp(snapToGrid(y, SHAPE_GRID), meta.height)
  const snapPortX = (x) => clamp(snapToGrid(x, PORT_GRID), meta.width)
  const snapPortY = (y) => clamp(snapToGrid(y, PORT_GRID), meta.height)

  function setTool(t) {
    tool.value = t
    if (t !== 'select') selectedIds.value = []
  }

  /** Выделить ровно одну фигуру (null — снять выделение). */
  function select(id) {
    selectedIds.value = id ? [id] : []
    selectedPortIds.value = []
  }

  /** Клик по порту. additive (Ctrl/Cmd) — добавить/убрать, не теряя остальные. */
  function selectPort(id, additive = false) {
    selectedIds.value = []
    if (!id) {
      selectedPortIds.value = []
      return
    }
    if (!additive) {
      selectedPortIds.value = [id]
      return
    }
    selectedPortIds.value = selectedPortSet.value.has(id)
      ? selectedPortIds.value.filter((x) => x !== id)
      : [...selectedPortIds.value, id]
  }

  /** Удалить выделенные порты — одним шагом истории на пачку. */
  function removePorts(ids) {
    const set = new Set(ids || [])
    if (!set.size) return 0
    const before = ports.value.length
    ports.value = ports.value.filter((p) => !set.has(p.id))
    const removed = before - ports.value.length
    if (!removed) return 0
    selectedPortIds.value = selectedPortIds.value.filter((id) => !set.has(id))
    commit()
    return removed
  }

  /**
   * Сдвиг выделенных портов стрелками шагом сетки схемы. Порт живёт на границе
   * символа, поэтому каждый проецируется на ближайшую сторону (portOnEdge): общий
   * сдвиг, как у фигур, увёл бы их внутрь тела.
   */
  function nudgePorts(dx, dy) {
    if (!selectedPortIds.value.length || (!dx && !dy)) return false
    const set = selectedPortSet.value
    let changed = false
    ports.value = ports.value.map((p) => {
      if (!set.has(p.id)) return p
      const next = portOnEdge(p.x + dx, p.y + dy)
      if (next.x === p.x && next.y === p.y) return p
      changed = true
      return { ...p, ...next }
    })
    if (changed) commit()
    return changed
  }

  /** Ctrl/Cmd+клик: добавить/убрать фигуру, не теряя остальные. */
  function toggleSelect(id) {
    if (!id) return
    selectedIds.value = selectedSet.value.has(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id]
  }

  /** Результат лассо. additive (Ctrl/Cmd) — объединяем с текущим, иначе заменяем. */
  function selectMany(ids, additive = false) {
    if (ids.length) selectedPortIds.value = []
    if (!additive) {
      selectedIds.value = [...ids]
      return
    }
    const seen = new Set(selectedIds.value)
    selectedIds.value = [...selectedIds.value, ...ids.filter((id) => !seen.has(id))]
  }

  function selectAll() {
    selectedIds.value = shapes.value.map((s) => s.id)
  }

  // Фигура + внутренний id и дефолты стиля (общее для рисования и вставки).
  const makeShape = (shape) => ({
    id: nextId(),
    stroke: '#000',
    strokeWidth: 2,
    fill: 'none',
    state: 'always',
    ...shape,
  })

  // Добавить фигуру: id, список, выделение и возврат в режим выбора.
  function addShape(shape) {
    const withId = makeShape(shape)
    shapes.value = [...shapes.value, withId]
    selectedIds.value = [withId.id]
    tool.value = 'select'
    commit()
    return withId
  }

  // Точечная правка (во время drag/resize): историю не трогает, снимок ставит
  // компонент на конце жеста.
  function updateShape(id, patch) {
    shapes.value = shapes.value.map((s) => (s.id === id ? { ...s, ...patch } : s))
  }

  /**
   * Как updateShape, но по нескольким id: патч у каждой фигуры свой (координаты
   * при групповом drag). История — на вызывающем.
   *
   * @param {(shape: object) => object|null} patchOf — патч (null — не менять)
   */
  function updateShapes(ids, patchOf) {
    const set = new Set(ids)
    shapes.value = shapes.value.map((s) => {
      if (!set.has(s.id)) return s
      const patch = patchOf(s)
      return patch ? { ...s, ...patch } : s
    })
  }

  /**
   * Сдвиг выделения на dx/dy (шаг задаёт вызывающий). Пачка едет ОДНИМ смещением, без
   * снапа каждой фигуры: у них своя дробная часть координат, и поштучный снап развалил
   * бы взаимное расположение. Габарит выделения за пределы символа не выходит, а упор в
   * край обрезает шаг, а не отменяет его. История — один шаг на нажатие.
   */
  function nudgeShapes(dx, dy) {
    if (!selectedIds.value.length || (!dx && !dy)) return
    const boxes = shapes.value
      .filter((s) => selectedSet.value.has(s.id))
      .map(shapeBounds)
      .filter(Boolean)
    if (boxes.length) {
      const lo = (get) => Math.min(...boxes.map(get))
      const hi = (get) => Math.max(...boxes.map(get))
      if (dx < 0)
        dx = -Math.min(
          -dx,
          lo((b) => b.x)
        )
      else if (dx > 0) dx = Math.min(dx, meta.width - hi((b) => b.x + b.w))
      if (dy < 0)
        dy = -Math.min(
          -dy,
          lo((b) => b.y)
        )
      else if (dy > 0) dy = Math.min(dy, meta.height - hi((b) => b.y + b.h))
    }
    if (!dx && !dy) return
    updateShapes(selectedIds.value, (s) => translateShape(s, dx, dy))
    commit()
  }

  // ─── Групповая правка свойств (инспектор при мультивыделении) ───
  // Свойство есть не у каждого примитива (у линии нет заливки, у круга — скругления, у
  // подписи ни того ни другого), поэтому правка и чтение общего значения фильтруются
  // ОДНИМ предикатом применимости: контрол показан, если применим хоть к одной.

  /** Выделенные фигуры, к которым применимо свойство (filter — предикат по типу). */
  function selectedFor(filter) {
    return shapes.value.filter((s) => selectedSet.value.has(s.id) && (!filter || filter(s)))
  }

  /**
   * Общее значение свойства у выделения: `undefined` — свойство расходится
   * (инспектор показывает «разные»/пустое поле) либо применимых фигур нет.
   */
  function commonValue(getter, filter) {
    const picked = selectedFor(filter)
    if (!picked.length) return undefined
    const first = getter(picked[0])
    return picked.every((s) => getter(s) === first) ? first : undefined
  }

  /**
   * Применить патч ко всем применимым выделенным. Историю не коммитит: пипетка и
   * спиннер шлют правку «живьём», снимок ставит вызывающий на @change/@blur.
   */
  function applyToSelected(patch, filter) {
    const ids = selectedFor(filter).map((s) => s.id)
    if (!ids.length) return
    updateShapes(ids, () => patch)
  }

  /** Удалить выделенное — один снимок истории на всю пачку. */
  function removeShapes(ids) {
    const set = new Set(ids)
    if (!set.size) return
    shapes.value = shapes.value.filter((s) => !set.has(s.id))
    selectedIds.value = selectedIds.value.filter((id) => !set.has(id))
    commit()
  }

  /**
   * Порядок наложения фигур = порядок в массиве (он же порядок в экспортном SVG),
   * поэтому «выше/ниже» — перестановка списка той же чистой функцией, что на холсте
   * (`reorderIds`): выделенное едет как целое.
   *
   *
   * @param {Array<string>} ids — что двигаем
   * @param {'front'|'back'|'forward'|'backward'} mode
   */
  function reorderShapes(ids, mode) {
    const targets = (ids || []).filter((id) => shapes.value.some((s) => s.id === id))
    if (!targets.length) return
    const order = reorderIds(
      shapes.value.map((s) => s.id),
      targets,
      mode
    )
    const byId = new Map(shapes.value.map((s) => [s.id, s]))
    const next = order.map((id) => byId.get(id))
    // Порядок не изменился (уже на краю) — шаг истории не пишем.
    if (next.every((s, i) => s === shapes.value[i])) return
    shapes.value = next
    commit()
  }

  /**
   * Поворот на 90° и отражение выделенного — вокруг центра его общего bbox. Угла у
   * фигур нет (модель осе-выровненная), поэтому преобразование запекается в координаты
   * (mapShapePoints).
   *
   * @param {Array<string>} ids
   * @param {(shape: object, center: {x: number, y: number}) => object} apply
   */
  function transformShapes(ids, apply) {
    const set = new Set(ids || [])
    const targets = shapes.value.filter((s) => set.has(s.id))
    if (!targets.length) return
    const bbox = shapesBounds(targets)
    if (!bbox) return
    const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }
    shapes.value = shapes.value.map((s) => (set.has(s.id) ? apply(s, center) : s))
    commit()
  }

  /** `dir > 0` — по часовой, как кнопка «повернуть по часовой» на холсте. */
  function rotateShapes(ids, dir = 1) {
    transformShapes(ids, (s, center) => rotateShape90(s, center, dir))
  }

  /** Ось 'h' — отражение по горизонтали, 'v' — по вертикали. */
  function flipShapes(ids, axis) {
    transformShapes(ids, (s, center) => flipShape(s, center, axis))
  }

  // Буфер копирования без внутренних id (paste присвоит новые), на сессию редактора.
  const clipboardShapes = ref([])

  function copyShapes() {
    const picked = shapes.value.filter((s) => selectedSet.value.has(s.id))
    if (!picked.length) return false
    clipboardShapes.value = picked.map((s) => {
      const rest = { ...s }
      delete rest.id
      return JSON.parse(JSON.stringify(rest))
    })
    return true
  }

  /**
   * Вставка буфера: пачка сдвигается на шаг сетки целиком и становится выделением.
   * Мимо addShape, иначе снимок истории пришёлся бы на каждую фигуру.
   */
  function pasteShapes() {
    if (!clipboardShapes.value.length) return []
    const added = clipboardShapes.value.map((s) =>
      makeShape(translateShape(JSON.parse(JSON.stringify(s)), SHAPE_GRID, SHAPE_GRID))
    )
    shapes.value = [...shapes.value, ...added]
    selectedIds.value = added.map((s) => s.id)
    tool.value = 'select'
    commit()
    return added
  }

  // ─── Режим «по значению»: список состояний {key, label, code} ───
  // Смена режима переустанавливает слот и сбрасывает видимость фигур на `always`:
  // ключи состояний в булевом (true/false) и value-режиме разные, старые назначения
  // повисли бы на несуществующем состоянии.
  function applyStateMode(mode) {
    if (meta.stateMode === mode) return false
    meta.stateMode = mode
    meta.stateSlot = mode === 'value' ? valueSlot() : boolSlot()
    meta.stateColors = {} // ключи состояний между режимами разные — цвета не переносим
    previewState.value = 'all' // ключи состояний между режимами разные
    shapes.value = shapes.value.map((s) =>
      s.state && s.state !== 'always' ? { ...s, state: 'always' } : s
    )
    return true
  }

  /**
   * Единый контрол инспектора «Выкл / Булево / По значению»: тумблер и режим одной
   * операцией, поэтому в истории ОДИН шаг — Ctrl+Z не оставит состояние «анимация
   * включена, режим старый».
   */
  function setAnimationMode(mode) {
    const wasOff = !meta.stateful
    if (mode === 'off') {
      if (wasOff) return
      meta.stateful = false
      // Без анимации quality-биндингу не за что цепляться, а превью нечего показывать:
      // сброс идёт ДО снимка, чтобы undo вернул целостное состояние.
      meta.quality = false
      previewState.value = 'all'
      commit()
      return
    }
    meta.stateful = true
    const modeChanged = applyStateMode(mode)
    if (wasOff || modeChanged) commit()
  }

  // Цвет перекраса символа для состояния: which — 'stroke' (контур) либо 'fill'.
  // Пустой color снимает канал. Форма компактная: только контур → строка, с заливкой →
  // { stroke?, fill }, ничего → ключ удаляется. Объект переприсваивается целиком.
  function setStateColor(key, color, which = 'stroke') {
    const cur = normalizeStateColor(meta.stateColors[key])
    const val = { ...cur, [which]: color || '' }
    const next = { ...meta.stateColors }
    if (val.stroke && val.fill) next[key] = { stroke: val.stroke, fill: val.fill }
    else if (val.fill) next[key] = { fill: val.fill }
    else if (val.stroke) next[key] = val.stroke
    else delete next[key]
    meta.stateColors = next
  }

  // Стабильный ключ нового состояния (s1/s2/…) идёт в суффикс группы и не зависит от
  // подписи и кода — их автор меняет свободно, назначения фигур не рвутся.
  function uniqueStateKey() {
    let n = meta.states.length + 1
    let key = `s${n}`
    while (meta.states.some((s) => s.key === key)) key = `s${++n}`
    return key
  }

  function addState() {
    meta.states = [...meta.states, { key: uniqueStateKey(), label: '', code: '' }]
    commit() // дискретная операция (кнопка «+ состояние»), не ввод в поле
  }

  function updateState(key, patch) {
    meta.states = meta.states.map((s) => (s.key === key ? { ...s, ...patch } : s))
  }

  function removeState(key) {
    meta.states = meta.states.filter((s) => s.key !== key)
    setStateColor(key, '') // снять цвет удалённого состояния
    // Осиротевшие фигуры (были в этом состоянии) → снова always.
    shapes.value = shapes.value.map((s) => (s.state === key ? { ...s, state: 'always' } : s))
    commit()
  }

  // Шаблон «Сигнал положения»: 4 состояния с пресет-подписями, коды пустые. Набор
  // заменяется целиком, поэтому цвета снимаются, а осиротевшие фигуры возвращаются в
  // `always` — иначе они остались бы на ключе, которого нет в meta.states.
  function applyPositionPreset() {
    const nextKeys = new Set(POSITION_SIGNAL_KEYS)
    for (const s of meta.states) if (!nextKeys.has(s.key)) setStateColor(s.key, '')
    meta.states = POSITION_SIGNAL_KEYS.map((k) => ({
      key: k,
      label: STATE_PRESETS.find((p) => p.key === k)?.label || k,
      code: '',
    }))
    shapes.value = shapes.value.map((s) =>
      s.state && s.state !== 'always' && !nextKeys.has(s.state) ? { ...s, state: 'always' } : s
    )
    commit()
  }

  // Порт живёт на границе: снап к PORT_GRID + проекция на ближайшую сторону bbox,
  // поэтому клик «примерно туда» сажает порт на край.
  function portOnEdge(x, y) {
    const px = snapPortX(x)
    const py = snapPortY(y)
    const dist = { left: px, right: meta.width - px, top: py, bottom: meta.height - py }
    const side = Object.keys(dist).reduce((a, b) => (dist[b] < dist[a] ? b : a))
    if (side === 'left') return { x: 0, y: py }
    if (side === 'right') return { x: meta.width, y: py }
    if (side === 'top') return { x: px, y: 0 }
    return { x: px, y: meta.height }
  }

  // Порт по координате: проекция на границу, дедуп по совпадающим x/y, авто-имя p1/p2/…
  function addPort(x, y) {
    const { x: px, y: py } = portOnEdge(x, y)
    if (ports.value.some((p) => p.x === px && p.y === py)) return null
    meta.portSeq += 1
    const port = { id: nextId(), name: `p${meta.portSeq}`, x: px, y: py }
    ports.value = [...ports.value, port]
    commit()
    return port
  }

  // Как updateShape: идёт во время drag'а порта, историю коммитит компонент.
  function movePort(id, x, y) {
    const { x: px, y: py } = portOnEdge(x, y)
    ports.value = ports.value.map((p) => (p.id === id ? { ...p, x: px, y: py } : p))
  }

  // Правка существующего символа (только незалоченные — их SVG в нашем формате).
  // История сбрасывается: загруженное состояние = базовая точка для undo.
  function loadStencil(def) {
    editingId.value = def.id
    meta.id = def.id
    meta.label = def.label || ''
    meta.category = def.category || ''
    meta.domains = normalizeDomains(def.domains)
    meta.width = def.width || 40
    meta.height = def.height || 40
    meta.noRotate = !!def.noRotate
    meta.noFlip = !!def.noFlip
    meta.quality = !!def.quality
    // Режим «по значению» опознаётся по полю `states` в json, иначе булев. Ключ слота
    // сохраняется как есть: переименование сломает привязку у расставленных экземпляров.
    const hasValueStates = Array.isArray(def.states) && def.states.length > 0
    meta.stateMode = hasValueStates ? 'value' : 'boolean'
    meta.states = hasValueStates
      ? def.states.map((s) => ({ key: s.key, label: s.label || '', code: s.code ?? '' }))
      : []
    meta.stateColors = def.stateColors ? { ...def.stateColors } : {}
    meta.stateful = hasValueStates || !!(def.slots?.length && def.animationTemplate?.length)
    const loadedKey = def.slots?.[0]?.key
    const fallbackKey = hasValueStates ? 'value' : 'onoff'
    meta.stateSlot = { key: loadedKey && loadedKey !== 'state' ? loadedKey : fallbackKey }
    // Присваиваем внутренние id — без них не работают выделение/ручки/удаление.
    shapes.value = parseStencilSvg(def.svgText).map((s) => ({ id: nextId(), ...s }))
    ports.value = (def.ports || []).map((p) => ({ id: nextId(), name: p.name, x: p.x, y: p.y }))
    // Без поля-счётчика в json нумерация продолжается от наибольшего выданного имени,
    // чтобы не отдать занятое.
    meta.portSeq = Math.max(def.portSeq || 0, portSeqFrom(def.ports))
    selectedIds.value = []
    tool.value = 'select'
    previewState.value = 'all' // превью прошлого черновика ссылалось на чужие состояния
    history.value = []
    histIndex.value = -1
    commit()
  }

  // Сброс к пустому черновику: синглтон переживает закрытие редактора, поэтому при
  // «создании» состояние прошлой сессии надо очистить (правка идёт через loadStencil).
  function reset() {
    meta.id = ''
    meta.label = ''
    meta.category = ''
    meta.domains = []
    meta.width = 40
    meta.height = 40
    meta.noRotate = false
    meta.noFlip = false
    meta.quality = false
    meta.stateful = false
    meta.stateMode = 'boolean'
    meta.stateSlot = boolSlot()
    meta.states = []
    meta.stateColors = {}
    meta.portSeq = 0
    previewState.value = 'all'
    shapes.value = []
    ports.value = []
    tool.value = 'select'
    selectedIds.value = []
    editingId.value = null
    history.value = []
    histIndex.value = -1
    commit()
  }

  // Черновик → артефакты проекта: перед сериализацией пустые поля обрезаются (bbox
  // кратно BOX_GRID) и контент сдвигается в (0,0).
  function output() {
    const cropped = cropToContent(shapes.value, ports.value, BOX_GRID)
    const croppedMeta = { ...meta, width: cropped.width, height: cropped.height }
    return {
      json: buildStencilJson(croppedMeta, cropped.ports, cropped.shapes),
      svg: serializeSvg(cropped.shapes, croppedMeta),
    }
  }

  // Затравка истории — пустой черновик (первый undo возвращает к чистому холсту).
  commit()

  return {
    meta,
    shapes,
    ports,
    tool,
    selectedId,
    selectedIds,
    selectedSet,
    selectedPortIds,
    selectedPortSet,
    editingId,
    previewState,
    canUndo,
    canRedo,
    snapShapeX,
    snapShapeY,
    setTool,
    reset,
    loadStencil,
    select,
    toggleSelect,
    selectMany,
    selectAll,
    addShape,
    updateShape,
    updateShapes,
    nudgeShapes,
    selectedFor,
    commonValue,
    applyToSelected,
    removeShapes,
    reorderShapes,
    rotateShapes,
    flipShapes,
    copyShapes,
    pasteShapes,
    setAnimationMode,
    addState,
    updateState,
    removeState,
    setStateColor,
    applyPositionPreset,
    addPort,
    movePort,
    removePorts,
    selectPort,
    nudgePorts,
    commit,
    undo,
    redo,
    output,
  }
}

// Синглтон: холст редактора и панель свойств делят один инстанс; при входе
// вызывается reset() либо loadStencil().
let instance = null
export function useStencilEditor() {
  if (!instance) instance = createStencilEditor()
  return instance
}
