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
import { computed, reactive, ref, watch } from 'vue'
import { snapToGrid } from '../utils/grid'
import { serializeSvg, buildStencilJson, cropToContent, parseStencilSvg } from '../utils/stencilSvg'
import { normalizeStateColor } from '../constants/animation'

export const SHAPE_GRID = 1
export const PORT_GRID = 5

// Слот-драйвер внутренней анимации. Булев режим → ключ `onoff` (hasBoolSlot,
// на холсте рисуется блоком «Булево значение»). Режим «по значению» → ключ
// `value` (тег сигнала, значение которого выбирает активное состояние).
// Переключение даёт наш animationTemplate; серость/цвет — задача холста
// (switchSources/voltage), в стенсиле не объявляем.
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
  // noRotate/quality — декл-флаги стенсила, моделируем как поля (генератор их
  // пишет в json, не теряются при пересохранении). Флаг `static` в редакторе не
  // редактируется: его несут только встроенные text/value (locked), а на холсте
  // он гейтит bulk-apply/detailTags (см. CanvasInspector.isStatic / exporter).
  // stateful — мастер-тумблер внутренней анимации: пока выключен, стенсил по
  // всем следам статичен (в json нет slots/animationTemplate). Включён — режим
  // (stateMode) решает форму: `boolean` (частный случай, слот onoff, фигуры
  // видимы при true/false) или `value` (слот value + список states: фигуры
  // видимы при своём значении сигнала). Один режим за раз.
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
  })
  const shapes = ref([])
  const ports = ref([])
  const tool = ref('select') // 'select' | 'rect' | 'line' | 'circle' | 'polyline' | 'port'
  const selectedId = ref(null)
  // Превью состояния (эмуляция animation-hidden на холсте): 'all' — все фигуры,
  // иначе ключ состояния. В синглтоне, т.к. селектор рисуется в инспекторе, а
  // фильтрация фигур — в StencilEditor. Выключение анимации → сброс на 'all'.
  const previewState = ref('all')
  // Выключение анимации → сброс превью и quality (quality завязан на драйвящий
  // тег анимации: без анимации бессмыслен, чекбокс живёт внутри её блока).
  watch(
    () => meta.stateful,
    (on) => {
      if (!on) {
        previewState.value = 'all'
        meta.quality = false
      }
    }
  )
  // id редактируемого стенсила (null = создание нового). В режиме правки id
  // заблокирован (= имя папки), проверка уникальности его исключает.
  const editingId = ref(null)

  // ─── Undo/redo ───
  // Стек полных снимков {shapes, ports} (meta/размер в историю не входит —
  // это отдельный контрол, не «действие рисования»). Дискретные операции
  // (добавить/удалить фигуру/порт) коммитят сами; drag/resize — много мелких
  // updateShape/movePort, поэтому их коммитит компонент один раз на конце жеста.
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const history = ref([])
  const histIndex = ref(-1)
  const canUndo = computed(() => histIndex.value > 0)
  const canRedo = computed(() => histIndex.value < history.value.length - 1)

  function commit() {
    const snap = { shapes: clone(shapes.value), ports: clone(ports.value) }
    const last = history.value[histIndex.value]
    // Дедуп no-op'ов (клик без протяжки, drag без сдвига) — не плодим пустые шаги.
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return
    history.value = history.value.slice(0, histIndex.value + 1)
    history.value.push(snap)
    histIndex.value = history.value.length - 1
  }
  function restore(snap) {
    shapes.value = clone(snap.shapes)
    ports.value = clone(snap.ports)
    selectedId.value = null
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
    if (t !== 'select') selectedId.value = null
  }

  function select(id) {
    selectedId.value = id
  }

  // Добавить фигуру: присваиваем id, кладём в список, сразу выделяем и
  // возвращаемся в режим выбора (нарисовал → правь).
  function addShape(shape) {
    const withId = {
      id: nextId(),
      stroke: '#000',
      strokeWidth: 2,
      fill: 'none',
      state: 'always',
      ...shape,
    }
    shapes.value = [...shapes.value, withId]
    selectedId.value = withId.id
    tool.value = 'select'
    commit()
    return withId
  }

  // Точечная правка (используется во время drag/resize) — историю НЕ трогает,
  // компонент коммитит один снимок на конце жеста.
  function updateShape(id, patch) {
    shapes.value = shapes.value.map((s) => (s.id === id ? { ...s, ...patch } : s))
  }

  function removeShape(id) {
    shapes.value = shapes.value.filter((s) => s.id !== id)
    if (selectedId.value === id) selectedId.value = null
    commit()
  }

  // Состояние видимости фигуры (внутренняя анимация): always | <ключ состояния>.
  // Булев режим: always | true | false. Режим значения: always | key из meta.states.
  // Дискретная операция → коммитим сразу (в отличие от updateShape в жесте).
  function setShapeState(id, state) {
    shapes.value = shapes.value.map((s) => (s.id === id ? { ...s, state } : s))
    commit()
  }

  // ─── Режим «по значению»: список состояний {key, label, code} ───
  // Смена режима переустанавливает слот и сбрасывает видимость фигур на `always`:
  // ключи состояний в булевом (true/false) и value-режиме разные, оставлять
  // старые назначения нельзя — повисли бы на несуществующем состоянии.
  function setStateMode(mode) {
    if (meta.stateMode === mode) return
    meta.stateMode = mode
    meta.stateSlot = mode === 'value' ? valueSlot() : boolSlot()
    meta.stateColors = {} // ключи состояний между режимами разные — цвета не переносим
    previewState.value = 'all' // ключи состояний между режимами разные
    shapes.value = shapes.value.map((s) =>
      s.state && s.state !== 'always' ? { ...s, state: 'always' } : s
    )
    commit()
  }

  // Цвет перекраса символа для состояния. which — 'stroke' (контур) | 'fill'
  // (заливка). Пустой color = снять этот канал. Компактно: только контур →
  // строка (legacy); есть заливка → объект { stroke?, fill }; ничего → удаляем
  // ключ (состояние снова только по видимости). Переприсваиваем целиком — reactive.
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
  function applyPositionPreset() {
    meta.states = POSITION_SIGNAL_KEYS.map((k) => ({
      key: k,
      label: STATE_PRESETS.find((p) => p.key === k)?.label || k,
      code: '',
    }))
  }

  // Порт живёт на ГРАНИЦЕ стенсила: снапим к PORT_GRID и проецируем на ближайшую
  // сторону bbox (порт — точка подключения провода, логично по краю). Клик/драг
  // «примерно туда» → порт садится на край.
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
    const port = { id: nextId(), name: `p${ports.value.length + 1}`, x: px, y: py }
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

  // Загрузка существующего стенсила на правку (только незалоченные — их SVG в
  // нашем формате, парсится обратно однозначно). История сбрасывается: загруженное
  // состояние = базовая точка (первый undo вернёт к нему, не к пустому холсту).
  function loadStencil(def) {
    editingId.value = def.id
    meta.id = def.id
    meta.label = def.label || ''
    meta.category = def.category || ''
    meta.width = def.width || 40
    meta.height = def.height || 40
    meta.noRotate = !!def.noRotate
    meta.quality = !!def.quality
    // Анимация состояния. Режим «по значению» опознаём по полю `states` в json
    // (редакторные подписи/коды, рантайм их игнорит); иначе — булев (slots +
    // animationTemplate). Ключ слота СОХРАНЯЕМ как есть (иначе правка переименовала
    // бы его и сломала привязку у расставленных). Транзитный `state` → onoff.
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
    selectedId.value = null
    tool.value = 'select'
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
    previewState.value = 'all'
    shapes.value = []
    ports.value = []
    tool.value = 'select'
    selectedId.value = null
    editingId.value = null
    history.value = []
    histIndex.value = -1
    commit()
  }

  // Черновик → артефакты формата проекта. Перед сериализацией обрезаем пустые
  // поля (bbox контента, кратно PORT_GRID) и сдвигаем в (0,0): итоговый стенсил =
  // ровно нарисованное, без «воздуха» от размера холста. Внутренние id отбрасываются.
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
    addShape,
    updateShape,
    removeShape,
    setShapeState,
    setStateMode,
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

// Синглтон для приложения: центр (StencilEditor) и панель свойств
// (StencilInspector) делят один инстанс. Пересоздавать на каждое открытие не
// нужно — при входе вызывается reset() (новый) либо loadStencil() (правка).
let instance = null
export function useStencilEditor() {
  if (!instance) instance = createStencilEditor()
  return instance
}
