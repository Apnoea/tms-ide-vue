/**
 * Модель редактора стенсилов. Хранит черновик: метаданные, список примитивов,
 * порты и анимацию состояния; отдаёт операции над ними + сборку артефактов на выход.
 *
 * Только состояние и чистая логика — без DOM и без interact.js: привязка драга/
 * ресайза живёт в компоненте StencilEditor, где есть ref'ы на SVG-элементы.
 * useStencilEditor — синглтон: один черновик на холст редактора (центр) и панель
 * свойств (StencilInspector, справа). При входе: reset() для нового / loadStencil()
 * для правки. createStencilEditor — фабрика для тестов (изолированный инстанс).
 *
 * Две сетки: вершины фигур снапятся к SHAPE_GRID (1px — фактически свободно,
 * пиксельная точность), а порты и размер самого стенсила — к PORT_GRID (5,
 * садятся на сетку схемы). Визуальная сетка холста рисуется отдельным читаемым
 * шагом (см. StencilEditor) и со snap'ом не связана.
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

export const SHAPE_GRID = 1
export const PORT_GRID = 5

// Слот-драйвер внутренней анимации. Булев режим → ключ `onoff` (hasBoolSlot,
// на холсте рисуется блоком «Булево значение»). Режим «по значению» → ключ
// `value` (тег сигнала, значение которого выбирает активное состояние).
// Переключение даёт наш animationTemplate; серость/цвет — задача холста
// (boolSource/диапазоны), в стенсиле не объявляем.
const boolSlot = () => ({ key: 'onoff' })
const valueSlot = () => ({ key: 'value' })

// Пресет подписей состояний КА (СТО 56947007, табл. 6–8) — чтобы автор не
// перепечатывал стандартные названия. Ключ (`key`) стабилен и идёт в суффикс
// группы `data-anim-suffix=".on"`; код (значение тега) автор вписывает сам —
// он проектно-зависим и в суффикс НЕ входит (см. buildStencilJson).
export const STATE_PRESETS = [
  { key: 'on', label: 'Включен' },
  { key: 'off', label: 'Отключен' },
  { key: 'intermediate', label: 'Промежуточное' },
  { key: 'invalid', label: 'Недостоверно' },
  { key: 'fault', label: 'Неисправность' },
]
// Быстрый шаблон «Сигнал положения» — 4 основных состояния (без «Неисправность»:
// она производная по таймауту, триггерится рантаймом, а не значением тега).
const POSITION_SIGNAL_KEYS = ['on', 'off', 'intermediate', 'invalid']

// Инкрементный id для v-for/selection — детерминированнее Math.random и не течёт
// в выход (в stencil.json/shape.svg внутренние id не попадают, см. stencilSvg).
let seq = 0
const nextId = () => `s${++seq}`

export function createStencilEditor() {
  // noRotate/quality — декл-флаги стенсила, моделируем как поля (уезжают в json).
  // `static` в редакторе не задаётся: его несут только встроенные text/value.
  // stateful — мастер-тумблер анимации; выключен = в json нет slots и
  // animationTemplate. Включён — stateMode решает форму: `boolean` (слот onoff,
  // видимость по true/false) или `value` (слот value + states). Один режим за раз.
  const meta = reactive({
    id: '',
    label: '',
    category: '',
    width: 40,
    height: 40,
    noRotate: false,
    quality: false,
    stateful: false,
    stateMode: 'boolean', // 'boolean' | 'value'
    stateSlot: boolSlot(),
    // Режим «по значению»: [{ key (стабильный, → суффикс), label, code }].
    states: [],
    // Цвет перекраса ВСЕГО символа по состоянию: { <ключ состояния>: '#rrggbb' }.
    // Ключи булева — 'true'/'false', режима значения — key из states. Пусто =
    // состояние меняет только видимость. Обесточивание (серый) остаётся на холсте
    // и бьёт этот цвет (см. CSS-приоритет в exporter).
    stateColors: {},
    // Сколько имён портов уже выдано. Имя порта — ВЕЧНЫЙ ключ: по нему провод
    // держится за порт, и оно уезжает в `data-tms-meta` экспорта. Поэтому имена
    // не переиспользуются: удалил последний порт и добавил новый — он получит
    // следующее имя, а не освободившееся. Иначе провод, оставшийся на прежнем
    // имени в другой форме, сел бы на новый порт в другом месте символа.
    portSeq: 0,
  })
  const shapes = ref([])
  const ports = ref([])
  const tool = ref('select') // 'select' | 'rect' | 'line' | 'circle' | 'polyline' | 'port'
  // Выделение множественное (клик, Ctrl+клик, лассо). Порты в него не входят.
  const selectedIds = ref([])
  const selectedSet = computed(() => new Set(selectedIds.value))
  // «Ровно одна» — гейт ручек ресайза и полей геометрии/текста. При N>1 null.
  const selectedId = computed(() => (selectedIds.value.length === 1 ? selectedIds.value[0] : null))
  // Превью состояния (эмуляция animation-hidden на холсте): 'all' — все фигуры,
  // иначе ключ состояния. В синглтоне, т.к. селектор рисуется в инспекторе, а
  // фильтрация фигур — в StencilEditor. Выключение анимации → сброс на 'all'.
  const previewState = ref('all')
  // Выключение анимации сбрасывает превью и quality (quality завязан на драйвящий
  // тег анимации: без анимации бессмыслен, чекбокс живёт внутри её блока) — это
  // делает setAnimationMode синхронно, ДО снимка истории, а не watch'ем после.

  // id редактируемого стенсила (null = создание нового). В режиме правки id
  // заблокирован (= имя папки), проверка уникальности его исключает.
  const editingId = ref(null)

  // ─── Undo/redo ───
  // Снимки {meta, shapes, ports}: мета — такие же данные символа, как фигуры (всё
  // уезжает в stencil.json), поэтому Ctrl+Z обязан откатывать и её — иначе смена
  // режима анимации откатывалась бы наполовину. Дискретные операции коммитят сами,
  // правки «живьём» (drag, ввод, пипетка) — вызывающий на конце жеста.
  // previewState в снимок не входит: это выбор просмотра, не данные символа.
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const history = ref([])
  const histIndex = ref(-1)
  const canUndo = computed(() => histIndex.value > 0)
  const canRedo = computed(() => histIndex.value < history.value.length - 1)

  function commit() {
    const snap = { meta: clone(meta), shapes: clone(shapes.value), ports: clone(ports.value) }
    const last = history.value[histIndex.value]
    // Дедуп no-op'ов (клик без протяжки, drag без сдвига) — не плодим пустые шаги.
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return
    history.value = history.value.slice(0, histIndex.value + 1)
    history.value.push(snap)
    histIndex.value = history.value.length - 1
  }
  function restore(snap) {
    // meta — reactive-объект, на который смотрят инспектор и холст: мутируем его
    // поля, а не подменяем ссылку (иначе оба потеряли бы реактивность).
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

  // Снап координаты к сетке фигур/портов, с зажимом в bbox стенсила (0..W/0..H).
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

  // Добавить фигуру: присваиваем id, кладём в список, сразу выделяем и
  // возвращаемся в режим выбора (нарисовал → правь).
  function addShape(shape) {
    const withId = makeShape(shape)
    shapes.value = [...shapes.value, withId]
    selectedIds.value = [withId.id]
    tool.value = 'select'
    commit()
    return withId
  }

  // Точечная правка (используется во время drag/resize) — историю НЕ трогает,
  // компонент коммитит один снимок на конце жеста.
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
   * Сдвиг выделения на dx/dy (стрелки; шаг задаёт вызывающий — как на холсте
   * обычный и крупный с Shift). Пачка едет ОДНИМ смещением, без снапа каждой
   * фигуры: у них своя дробная часть координат, и поштучный снап развалил бы
   * взаимное расположение. Габарит выделения за пределы символа не выпускаем —
   * тот же инвариант, что держит снап при drag'е; упор в край обрезает шаг, а не
   * отменяет его целиком (иначе у края стрелки просто «не работают»).
   * История — один шаг на нажатие, `commit` сам дедупит упор в край.
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
  // Свойство есть не у каждого примитива (у линии нет заливки, у круга —
  // скругления, у подписи ни того ни другого), поэтому и правка, и чтение общего
  // значения фильтруются одним и тем же предикатом применимости: контрол показан,
  // если применим хоть к одной выделенной, и трогает только применимые.

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
   * Применить патч ко всем применимым выделенным. Историю не коммитит — как
   * updateShape: цветовая пипетка/спиннер шлют правку «живьём», снимок ставит
   * вызывающий на конце жеста (@change/@blur).
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
   * поэтому «выше/ниже» — это перестановка списка. Правила те же, что на холсте, и
   * считает их та же чистая функция (`reorderIds`): выделенное едет как целое.
   *
   * Нужно потому, что иначе порядок задаётся только очерёдностью рисования: залил
   * фигуру после контура — перекрыл его, и лечилось это лишь перерисовкой.
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
    // Порядок не изменился (уже на краю) — не плодим шаг истории.
    if (next.every((s, i) => s === shapes.value[i])) return
    shapes.value = next
    commit()
  }

  /**
   * Поворот на 90° и отражение выделенного — вокруг центра его общего bbox, как на
   * холсте вокруг центра ячейки. Угла у фигур нет (модель осе-выровненная), поэтому
   * преобразование «запекается» в координаты: прямоугольник остаётся прямоугольником,
   * эллипс — эллипсом, у ломаной едут точки (см. mapShapePoints).
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

  // Буфер копирования без внутренних id (paste присвоит новые), на сессию
  // редактора. Массив — Ctrl+C берёт всё выделение.
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
   * Мимо addShape — иначе снимок истории на каждую фигуру вместо одного.
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
  // ключи состояний в булевом (true/false) и value-режиме разные, оставлять
  // старые назначения нельзя — повисли бы на несуществующем состоянии.
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
   * Единый контрол инспектора «Выкл / Булево / По значению»: мастер-тумблер и режим
   * одной операцией — в истории ОДИН шаг, а не два (иначе Ctrl+Z возвращал бы
   * промежуточное состояние «анимация включена, но режим ещё старый»).
   */
  function setAnimationMode(mode) {
    const wasOff = !meta.stateful
    if (mode === 'off') {
      if (wasOff) return
      meta.stateful = false
      // Без анимации quality-биндингу не за что цепляться, а превью нечего
      // показывать. Сбрасываем ДО снимка, чтобы undo вернул целостное состояние.
      meta.quality = false
      previewState.value = 'all'
      commit()
      return
    }
    meta.stateful = true
    const modeChanged = applyStateMode(mode)
    if (wasOff || modeChanged) commit()
  }

  // Цвет перекраса символа для состояния. which — 'stroke' (контур) | 'fill'
  // (заливка). Пустой color = снять этот канал. Компактно: только контур →
  // строка; есть заливка → объект { stroke?, fill }; ничего → удаляем ключ
  // (состояние снова только по видимости). Переприсваиваем целиком — reactive.
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

  // Стабильный ключ нового состояния (s1/s2/…) — идёт в суффикс группы, не зависит
  // от подписи/кода (их автор меняет свободно, назначения фигур не рвутся).
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

  // Шаблон «Сигнал положения»: 4 основных состояния с пресет-подписями, коды пустые.
  // Заменяет набор состояний целиком, поэтому — как в removeState — снимаем цвета и
  // возвращаем осиротевшие фигуры в `always`: иначе фигура осталась бы на ключе, которого
  // нет в meta.states, и serializeSvg молча выбросил бы её из shape.svg.
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

  // Порт живёт на границе: снапим к PORT_GRID и проецируем на ближайшую сторону
  // bbox, поэтому клик «примерно туда» сажает порт на край.
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

  // Порт по координате: проекция на границу + дедуп по совпадающим x/y (два порта
  // в одной точке бессмысленны), авто-имя p1/p2/…; имя правится позже в UI.
  function addPort(x, y) {
    const { x: px, y: py } = portOnEdge(x, y)
    if (ports.value.some((p) => p.x === px && p.y === py)) return null
    meta.portSeq += 1
    const port = { id: nextId(), name: `p${meta.portSeq}`, x: px, y: py }
    ports.value = [...ports.value, port]
    commit()
    return port
  }

  // Как updateShape — идёт во время drag'а порта, историю коммитит компонент.
  function movePort(id, x, y) {
    const { x: px, y: py } = portOnEdge(x, y)
    ports.value = ports.value.map((p) => (p.id === id ? { ...p, x: px, y: py } : p))
  }

  function removePort(id) {
    ports.value = ports.value.filter((p) => p.id !== id)
    commit()
  }

  // Правка существующего стенсила (только незалоченные — их SVG в нашем формате).
  // История сбрасывается: загруженное состояние = базовая точка для undo.
  function loadStencil(def) {
    editingId.value = def.id
    meta.id = def.id
    meta.label = def.label || ''
    meta.category = def.category || ''
    meta.width = def.width || 40
    meta.height = def.height || 40
    meta.noRotate = !!def.noRotate
    meta.quality = !!def.quality
    // Режим «по значению» опознаём по полю `states` в json, иначе булев. Ключ слота
    // сохраняем как есть — переименование сломало бы привязку у расставленных.
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
    // У символов, сохранённых до появления счётчика, поля нет — стартуем от
    // наибольшего выданного имени, чтобы не отдать занятое.
    meta.portSeq = Math.max(def.portSeq || 0, portSeqFrom(def.ports))
    selectedIds.value = []
    tool.value = 'select'
    previewState.value = 'all' // превью прошлого черновика ссылалось на чужие состояния
    history.value = []
    histIndex.value = -1
    commit()
  }

  // Сброс к пустому черновику. Нужен синглтону: при открытии редактора на
  // «создание» состояние от прошлой сессии надо очистить (правка идёт через
  // loadStencil, который перезаписывает всё сам).
  function reset() {
    meta.id = ''
    meta.label = ''
    meta.category = ''
    meta.width = 40
    meta.height = 40
    meta.noRotate = false
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

  // Черновик → артефакты проекта. Перед сериализацией обрезаем пустые поля (bbox,
  // кратно PORT_GRID) и сдвигаем в (0,0): символ = ровно нарисованное.
  function output() {
    const cropped = cropToContent(shapes.value, ports.value, PORT_GRID)
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
    removePort,
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
