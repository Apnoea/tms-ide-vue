/**
 * Модель редактора стенсилов (v1, статика). Хранит черновик: метаданные, список
 * примитивов и порты; отдаёт операции над ними + сборку артефактов на выход.
 *
 * Только состояние и чистая логика — без DOM и без interact.js: привязка драга/
 * ресайза живёт в компоненте StencilEditor, где есть ref'ы на SVG-элементы.
 * Фабрика (не singleton): на каждое открытие редактора — свежий черновик.
 *
 * Две сетки: вершины фигур снапятся к SHAPE_GRID, а порты и размер самого
 * стенсила — к PORT_GRID. Строго-10 для всего не дало бы даже cell_qw-подобный
 * символ (там линии на x=5).
 */
import { computed, reactive, ref } from 'vue'
import { snapToGrid } from '../utils/grid'
import { serializeSvg, buildStencilJson, cropToContent, parseStencilSvg } from '../utils/stencilSvg'

export const SHAPE_GRID = 5
export const PORT_GRID = 10

// Инкрементный id для v-for/selection — детерминированнее Math.random и не течёт
// в выход (в stencil.json/shape.svg внутренние id не попадают, см. stencilSvg).
let seq = 0
const nextId = () => `s${++seq}`

export function useStencilEditor() {
  const meta = reactive({ id: '', label: '', category: '', width: 40, height: 40 })
  const shapes = ref([])
  const ports = ref([])
  const tool = ref('select') // 'select' | 'rect' | 'line' | 'circle' | 'polyline' | 'port'
  const selectedId = ref(null)
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
    const withId = { id: nextId(), stroke: '#000', strokeWidth: 2, fill: 'none', ...shape }
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

  // Порт по координате: снап к PORT_GRID, дедуп по совпадающим x/y (два порта в
  // одной точке бессмысленны), авто-имя p1/p2/…; имя правится позже в UI.
  function addPort(x, y) {
    const px = snapPortX(x)
    const py = snapPortY(y)
    if (ports.value.some((p) => p.x === px && p.y === py)) return null
    const port = { id: nextId(), name: `p${ports.value.length + 1}`, x: px, y: py }
    ports.value = [...ports.value, port]
    commit()
    return port
  }

  // Как updateShape — идёт во время drag'а порта, историю коммитит компонент.
  function movePort(id, x, y) {
    const px = snapPortX(x)
    const py = snapPortY(y)
    ports.value = ports.value.map((p) => (p.id === id ? { ...p, x: px, y: py } : p))
  }

  function removePort(id) {
    ports.value = ports.value.filter((p) => p.id !== id)
    commit()
  }

  // Загрузка существующего стенсила на правку (только userCreated — их SVG в
  // нашем формате, парсится обратно однозначно). История сбрасывается: загруженное
  // состояние = базовая точка (первый undo вернёт к нему, не к пустому холсту).
  function loadStencil(def) {
    editingId.value = def.id
    meta.id = def.id
    meta.label = def.label || ''
    meta.category = def.category || ''
    meta.width = def.width || 40
    meta.height = def.height || 40
    // Присваиваем внутренние id — без них не работают выделение/ручки/удаление.
    shapes.value = parseStencilSvg(def.svgText).map((s) => ({ id: nextId(), ...s }))
    ports.value = (def.ports || []).map((p) => ({ id: nextId(), name: p.name, x: p.x, y: p.y }))
    selectedId.value = null
    tool.value = 'select'
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
      json: buildStencilJson(croppedMeta, cropped.ports),
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
    canUndo,
    canRedo,
    snapShapeX,
    snapShapeY,
    setTool,
    loadStencil,
    select,
    addShape,
    updateShape,
    removeShape,
    addPort,
    movePort,
    removePort,
    commit,
    undo,
    redo,
    output,
  }
}
