<script setup>
/**
 * Редактор стенсилов. Оверлей поверх холста: рисование примитивов
 * (rect/line/circle/polyline) + расстановка портов, цвет/скругление фигур и
 * анимация состояния (булев `.true`/`.false` или «по значению» с произвольными
 * состояниями), всё со снапом к сетке (вершины фигур → 1px,
 * порты/размер → шаг 10). Область стенсила — белый холст (opacity 1), весь экран
 * вокруг — та же подложка на .3; рисовать можно только в области стенсила.
 * Модель, операции
 * и undo/redo — в useStencilEditor; здесь DOM: SVG-холст, рисование жестами и
 * привязка перемещения/ресайза через interact.js (колбэки обновляют модель, Vue
 * перерисовывает — interact не мутирует DOM в обход Vue). Открывается на создание
 * (пустой черновик) либо правку существующего незалоченного стенсила (loadStencil по
 * ui.stencilEditorTargetId). Сохранение валидирует черновик, регистрирует стенсил
 * в реестре и пишет на диск (dev-плагин).
 */
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import interact from 'interactjs'
import Button from 'primevue/button'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import { useConfirm } from 'primevue/useconfirm'
import { useUiStore } from '../stores/useUiStore'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import { snapToGrid } from '../utils/grid'
import { stencilDraftIssues, isFillableShape } from '../utils/stencilSvg'
import { confirmDanger } from '../utils/confirmDanger'
import { range, rangeFromTo, gridLineColor, tickInset, rulerTicks } from '../utils/editorRulers'
import { normalizeStateColor } from '../constants/animation'
import { getAllStencils, getStencilById, registerStencil } from '../stencils/registry'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { persistStencilsToDisk } from '../services/stencilLibrary'
import { upsertStencilOverride } from '../services/stencilOverrides'
import { useStencilEditor, SHAPE_GRID, PORT_GRID } from '../composables/useStencilEditor'
import ShapePrimitive from './ShapePrimitive.vue'

const ui = useUiStore()
const notify = useNotify()
const confirm = useConfirm()
const canvas = useCanvas()
const ed = useStencilEditor()
const {
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
  addPort,
  movePort,
  removePort,
  commit,
  undo,
  redo,
} = ed

// Рисующие инструменты. Отдельного «выбора» в тулбаре нет — select фоновый
// дефолт (см. pickTool: повторный клик по активному возвращает к нему).
const DRAW_TOOLS = [
  { key: 'line', icon: 'pi pi-minus', tip: 'Линия' },
  { key: 'rect', icon: 'pi pi-stop', tip: 'Прямоугольник' },
  { key: 'circle', icon: 'pi pi-circle', tip: 'Окружность' },
  {
    key: 'polyline',
    icon: 'pi pi-chart-line',
    tip: 'Ломаная (клик по началу — замкнуть, двойной клик — завершить)',
  },
  { key: 'port', icon: 'pi pi-map-marker', tip: 'Порт (клик по порту — удалить)' },
]

// Тоггл рисующих инструментов: повторный клик по активному инструменту
// возвращает к select (дефолт). Select сам не «отжимается» — он и есть дефолт.
function pickTool(key) {
  setTool(tool.value === key ? 'select' : key)
}

// Превью внутренней анимации: эмулируем animation-hidden прямо в редакторе, чтобы
// автор видел каждое положение. Селектор — компактный Select в тулбаре (влезает при
// любом числе значений); previewState живёт в синглтоне useStencilEditor.
const previewOptions = computed(() => {
  const head = { label: 'Все', value: 'all' }
  if (meta.stateMode === 'value') {
    return [head, ...(meta.states || []).map((s) => ({ label: s.label || s.key, value: s.key }))]
  }
  return [head, { label: 'Вкл', value: 'true' }, { label: 'Выкл', value: 'false' }]
})
const renderShapes = computed(() => {
  if (!meta.stateful || previewState.value === 'all') return shapes.value
  const key = previewState.value
  const visible = shapes.value.filter((s) => {
    const st = s.state || 'always'
    return st === 'always' || st === key
  })
  // Превью цвета состояния: тонируем обводку видимых фигур; заливку — только у
  // фигур с авторским fill (как на экспорте: tms-state-fill). Совпадает с рантаймом.
  const { stroke, fill } = normalizeStateColor(meta.stateColors?.[key])
  if (!stroke && !fill) return visible
  return visible.map((s) => {
    const next = { ...s }
    if (stroke) next.stroke = stroke
    if (fill && isFillableShape(s)) next.fill = fill
    return next
  })
})

// При активном инструменте рисования фигуры «прозрачны» для указателя: pointerdown
// уходит на холст (рисуем поверх), interact-драг над фигурой не стартует. В select
// — интерактивны (выделение/перемещение). Порты/ручки не трогаем (у них своя роль).
const shapePointerEvents = computed(() => (tool.value === 'select' ? null : 'none'))

// Размер холста стенсила кратен шагу сетки схемы (PORT_GRID) — порты и сам стенсил
// садятся на неё. Инпуты размера — в тулбаре; снап держим здесь.
watch(
  () => [meta.width, meta.height],
  () => {
    meta.width = Math.max(PORT_GRID, snapToGrid(meta.width, PORT_GRID))
    meta.height = Math.max(PORT_GRID, snapToGrid(meta.height, PORT_GRID))
  }
)

// Цвет подсветки выделения (halo) и превью рисования = primary темы. Берём токен
// var(--p-primary-500), а не литерал, — при смене primary редактор поедет за темой
// (иначе останется старый cyan). Применяем через :style (CSS-свойство stroke), т.к.
// SVG-АТРИБУТ stroke значение var() не резолвит; CSS-свойство — резолвит и наследуется.
const SEL_STROKE = 'var(--p-primary-500)'

// Режим определяется таргетом из store: задан id → правка (грузим стенсил в
// модель, id блокируется), иначе создание нового (префилл `cell_` в поле id).
// Правку открываем только у незалоченных (см. гейт в палитре) — их SVG в нашем
// формате и разбирается обратно однозначно.
// Синглтон-стейт переживает закрытие редактора → при входе чистим/грузим заново:
// правка → loadStencil (перезаписывает всё), создание → reset + префилл `cell_`.
const editTarget = ui.stencilEditorTargetId ? getStencilById(ui.stencilEditorTargetId) : null
if (editTarget) {
  loadStencil(editTarget)
} else {
  reset()
  meta.id = 'cell_'
}

// Есть ли несохранённые изменения = были ли правки относительно исходного
// состояния (пустой холст при создании / загруженный стенсил при правке).
// Берём canUndo: после открытия история = базовый снимок (canUndo=false), любая
// правка делает его true, откат к базе — снова false. Так режим правки не
// переспрашивает, если ничего не меняли (в отличие от «есть ли фигуры вообще»).
const isDirty = computed(() => canUndo.value)

// Закрытие с подтверждением, если черновик непустой. Попап якорим на кнопку
// «Закрыть» (для Esc, где нет DOM-таргета события, — через closeBtn-реф).
const closeBtn = ref(null)
function requestClose(event) {
  if (!isDirty.value) {
    ui.closeStencilEditor()
    return
  }
  confirmDanger(confirm, {
    target: event?.currentTarget || closeBtn.value?.$el,
    message: 'Закрыть редактор? Несохранённый символ будет потерян.',
    acceptLabel: 'Закрыть',
    accept: () => ui.closeStencilEditor(),
  })
}

// Сохранение: валидация → регистрация в реестре (появится в палитре) → персист
// на диск (в проде плагина нет → стенсил уедет в library/ проекта). В режиме
// правки id исключаем из проверки уникальности (он и есть редактируемый) и после
// сохранения переинжектим активную форму — расставленные экземпляры подхватят
// новый рисунок; при смене портов у расставленных экземпляров предупреждаем.
async function save() {
  const editing = editingId.value
  const existingIds = getAllStencils()
    .map((s) => s.id)
    .filter((id) => id !== editing)
  const issues = stencilDraftIssues(meta, shapes.value, existingIds)
  if (issues.length) {
    notify.warn('Проверьте символ', issues.join('; '))
    return
  }
  const prev = editing ? getStencilById(editing) : null
  const { json, svg } = ed.output()
  registerStencil(json, svg)
  // Оверрайд в IDB — правка (новый стенсил / изменённая заливка встроенного)
  // переживёт reload и в prod. persistStencilsToDisk ниже — dev-бонус: пишет файл
  // в definitions/, чтобы стенсил попал в кодовую базу под git.
  const idbOk = await upsertStencilOverride({ id: json.id, stencilJson: json, shapeSvg: svg })
  const ok = await persistStencilsToDisk([{ id: json.id, stencilJson: json, shapeSvg: svg }])
  // Символ уходит в .zip (library/) → проект разошёлся с последним экспортом.
  canvas.markDirty()
  // Оверрайд не записался (квота / приватный режим) — правка живёт только до reload.
  // Говорим прямо и поднимаем saveError: обещать «переживёт перезагрузку» нельзя.
  if (!idbOk) {
    canvas.setSaveError(true)
    notify.error(
      'Символ не сохранён локально',
      'Браузер отклонил запись в хранилище — правка потеряется после перезагрузки'
    )
  }

  if (editing) {
    reinjectAllStencils(canvas.graphRef.value, canvas.paperRef.value)
    canvas.bumpVersion()
    // Размер/порты у уже расставленных экземпляров не пересоздаются (они baked в
    // graphJson формы) — предупреждаем КОНКРЕТНО, что разошлось. Размер мог
    // измениться и без правки полей: `output()` обрезает холст до bbox контента.
    const sizeChanged = prev && (prev.width !== json.width || prev.height !== json.height)
    const portsChanged =
      prev && JSON.stringify(prev.ports || []) !== JSON.stringify(json.ports || [])
    if (sizeChanged || portsChanged) {
      const what = [
        sizeChanged ? `размер ${prev.width}×${prev.height} → ${json.width}×${json.height}` : null,
        portsChanged ? 'порты' : null,
      ]
        .filter(Boolean)
        .join(', ')
      notify.warn(
        'Символ обновлён',
        `Изменилось: ${what}. У расставленных экземпляров прежняя геометрия — переставьте при необходимости`
      )
    } else {
      notify.success('Символ обновлён', json.id)
    }
  } else if (ok) {
    notify.success('Символ создан', json.id)
  } else {
    notify.success(
      'Символ создан',
      'Переживёт перезагрузку; файл в definitions/ появится только в dev-режиме'
    )
  }
  ui.closeStencilEditor()
}

// ─── Масштаб холста ───
// Вписываем bbox стенсила в доступную область с запасом; клампим, чтобы мелкие
// стенсилы не раздувались до пикселизации, а крупные помещались.
const stageEl = ref(null)
const { width: stageW, height: stageH } = useElementSize(stageEl)
const scale = computed(() => {
  const availW = Math.max(1, stageW.value - 48)
  const availH = Math.max(1, stageH.value - 48)
  const fit = Math.min(availW / meta.width, availH / meta.height)
  return Math.max(3, Math.min(24, fit))
})
const pxW = computed(() => meta.width * scale.value)
const pxH = computed(() => meta.height * scale.value)
// Ручки/порты — константного размера на экране (в user-единицах = px/scale).
const hr = computed(() => 4 / scale.value)

// ─── Сетка ───
// Расчёты (шаг/уровни яркости/диапазоны) — в utils/editorRulers; здесь только
// привязка к reactive-размерам и зуму.
const gridX = computed(() => range(meta.width))
const gridY = computed(() => range(meta.height))
const lineColor = gridLineColor

// Расширенная сетка: холст (та же сетка) продолжается за границы стенсила в зону
// .5 (не редактируется). Отступ = видимая область вокруг карточки в user-единицах
// ((stage − card) / 2 / scale); при скролле/большом стенсиле → 0 (нечего показывать).
const gridPadX = computed(() =>
  Math.max(0, Math.ceil((stageW.value - pxW.value) / 2 / scale.value))
)
const gridPadY = computed(() =>
  Math.max(0, Math.ceil((stageH.value - pxH.value) / 2 / scale.value))
)
const gridXFull = computed(() => rangeFromTo(-gridPadX.value, meta.width + gridPadX.value))
const gridYFull = computed(() => rangeFromTo(-gridPadY.value, meta.height + gridPadY.value))

// ─── Пиксель события → user-координаты стенсила ───
const svgEl = ref(null)
function unitsFromEvent(e) {
  const r = svgEl.value.getBoundingClientRect()
  return {
    x: ((e.clientX - r.left) / r.width) * meta.width,
    y: ((e.clientY - r.top) / r.height) * meta.height,
  }
}
function snappedShape(e) {
  const u = unitsFromEvent(e)
  return { x: snapShapeX(u.x), y: snapShapeY(u.y) }
}

// ─── Линейка (координаты по краям холста) ───
const RULER = 22 // px — толщина полос
// Экранная позиция точки (0,0) SVG относительно stage: учитывает центрирование
// холста и скролл. Тик юнита u → origin + u*scale.
const originX = ref(0)
const originY = ref(0)
function updateRuler() {
  const stage = stageEl.value
  const svg = svgEl.value
  if (!stage || !svg) return
  const sr = stage.getBoundingClientRect()
  const vr = svg.getBoundingClientRect()
  originX.value = vr.left - sr.left
  originY.value = vr.top - sr.top
}
// Деления/подписи считает rulerTicks (utils/editorRulers): major (÷10, с подписью),
// medium (÷5), minor (1, только при достаточном зуме).
const rulerTicksX = computed(() => rulerTicks(meta.width, originX.value, scale.value))
const rulerTicksY = computed(() => rulerTicks(meta.height, originY.value, scale.value))
// Пересчёт при зуме/ресайзе/смене размера — после DOM-патча (flush: post).
// Скролл холста — отдельно, через @scroll в шаблоне.
watch([pxW, pxH, stageW, stageH], updateRuler, { flush: 'post' })

// ─── Рисование жестами (rect/line/circle — drag; polyline — клики) ───
const drawing = ref(null) // { type, sx, sy, cx, cy } — тянущаяся фигура
const polyPoints = ref([]) // накопленные вершины ломаной
const polyCursor = ref(null) // «резинка» до курсора

function onSurfaceDown(e) {
  if (e.button !== 0) return
  if (tool.value === 'select') {
    if (!e.target.closest('[data-se-move]')) select(null)
    return
  }
  if (tool.value === 'port') {
    if (e.target.closest('[data-se-move="port"]')) return // клик по порту — его хендлер
    const u = unitsFromEvent(e)
    addPort(u.x, u.y)
    return
  }
  if (tool.value === 'polyline') {
    const u = snappedShape(e)
    const pts = polyPoints.value
    // Клик рядом со стартовой вершиной (при ≥2 точках) — замыкаем в polygon:
    // дубль стартовой точки не добавляем, помечаем closed. Порог ~10 экранных px.
    if (pts.length >= 2) {
      const [fx, fy] = pts[0]
      if (Math.hypot(u.x - fx, u.y - fy) <= 10 / scale.value) {
        addShape({ type: 'polyline', points: [...pts], closed: true })
        polyPoints.value = []
        polyCursor.value = null
        return
      }
    }
    polyPoints.value = [...pts, [u.x, u.y]]
    return
  }
  const u = snappedShape(e)
  drawing.value = { type: tool.value, sx: u.x, sy: u.y, cx: u.x, cy: u.y }
  window.addEventListener('pointermove', onDrawMove)
  window.addEventListener('pointerup', onDrawUp)
}

function onSurfaceMove(e) {
  if (tool.value === 'polyline' && polyPoints.value.length) {
    const u = snappedShape(e)
    polyCursor.value = [u.x, u.y]
  }
}

function onDrawMove(e) {
  if (!drawing.value) return
  const u = snappedShape(e)
  drawing.value = { ...drawing.value, cx: u.x, cy: u.y }
}
function onDrawUp() {
  window.removeEventListener('pointermove', onDrawMove)
  window.removeEventListener('pointerup', onDrawUp)
  commitDrawing()
}
function commitDrawing() {
  const d = drawing.value
  drawing.value = null
  if (!d) return
  if (d.type === 'rect') {
    const w = Math.abs(d.cx - d.sx)
    const h = Math.abs(d.cy - d.sy)
    if (w < SHAPE_GRID || h < SHAPE_GRID) return // клик без протяжки — не фигура
    addShape({ type: 'rect', x: Math.min(d.sx, d.cx), y: Math.min(d.sy, d.cy), w, h })
  } else if (d.type === 'line') {
    if (d.sx === d.cx && d.sy === d.cy) return
    addShape({ type: 'line', x1: d.sx, y1: d.sy, x2: d.cx, y2: d.cy })
  } else if (d.type === 'circle') {
    const r = snapToGrid(Math.hypot(d.cx - d.sx, d.cy - d.sy), SHAPE_GRID)
    if (r < SHAPE_GRID) return
    addShape({ type: 'circle', cx: d.sx, cy: d.sy, r })
  }
}

function finishPolyline() {
  if (tool.value !== 'polyline') return
  // Дедуп подряд идущих совпадающих точек (двойной клик добавляет лишнюю).
  const pts = polyPoints.value.filter(
    (p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1]
  )
  if (pts.length >= 2) addShape({ type: 'polyline', points: pts })
  polyPoints.value = []
  polyCursor.value = null
}

// Превью тянущейся фигуры (пунктиром) — считаем из drawing.
const draftRect = computed(() => {
  const d = drawing.value
  if (d?.type !== 'rect') return null
  return {
    x: Math.min(d.sx, d.cx),
    y: Math.min(d.sy, d.cy),
    w: Math.abs(d.cx - d.sx),
    h: Math.abs(d.cy - d.sy),
  }
})
const draftCircleR = computed(() => {
  const d = drawing.value
  if (d?.type !== 'circle') return 0
  return Math.hypot(d.cx - d.sx, d.cy - d.sy)
})
const polyPreview = computed(() => {
  if (!polyPoints.value.length) return ''
  const pts = polyCursor.value ? [...polyPoints.value, polyCursor.value] : polyPoints.value
  return pts.map(([x, y]) => `${x},${y}`).join(' ')
})

// ─── Ручки выделенной фигуры ───
const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null)
// Толщина halo-подсветки = реальная обводка + запас в несколько экранных px.
const haloWidth = computed(() => (selectedShape.value?.strokeWidth || 2) + 4 / scale.value)
const handles = computed(() => {
  const s = selectedShape.value
  if (!s) return []
  if (s.type === 'rect') {
    return [
      { h: 'nw', x: s.x, y: s.y },
      { h: 'ne', x: s.x + s.w, y: s.y },
      { h: 'sw', x: s.x, y: s.y + s.h },
      { h: 'se', x: s.x + s.w, y: s.y + s.h },
    ]
  }
  if (s.type === 'circle') return [{ h: 'r', x: s.cx + s.r, y: s.cy }]
  if (s.type === 'line') {
    return [
      { h: 'v0', x: s.x1, y: s.y1 },
      { h: 'v1', x: s.x2, y: s.y2 },
    ]
  }
  if (s.type === 'polyline') return s.points.map(([x, y], i) => ({ h: `v${i}`, x, y }))
  return []
})

// ─── interact.js: перемещение фигур/портов и ресайз ручками ───
// Селектор [data-se-move] существует только внутри редактора. Колбэки берут
// абсолютную позицию курсора → user-координаты → снап → пишут в модель.
let dragCtx = null
const clone = (v) => JSON.parse(JSON.stringify(v))

function anchorOf(s) {
  if (s.type === 'rect') return { x: s.x, y: s.y }
  if (s.type === 'circle') return { x: s.cx, y: s.cy }
  if (s.type === 'line') return { x: s.x1, y: s.y1 }
  return { x: s.points[0][0], y: s.points[0][1] }
}
function translated(s, dx, dy) {
  if (s.type === 'rect') return { x: s.x + dx, y: s.y + dy }
  if (s.type === 'circle') return { cx: s.cx + dx, cy: s.cy + dy }
  if (s.type === 'line') return { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
  return { points: s.points.map(([x, y]) => [x + dx, y + dy]) }
}

function reshape(snap, hKey, cur) {
  const p = { x: snapShapeX(cur.x), y: snapShapeY(cur.y) }
  if (snap.type === 'rect') {
    const fixed = {
      nw: { x: snap.x + snap.w, y: snap.y + snap.h },
      ne: { x: snap.x, y: snap.y + snap.h },
      sw: { x: snap.x + snap.w, y: snap.y },
      se: { x: snap.x, y: snap.y },
    }[hKey]
    updateShape(snap.id, {
      x: Math.min(p.x, fixed.x),
      y: Math.min(p.y, fixed.y),
      w: Math.max(SHAPE_GRID, Math.abs(fixed.x - p.x)),
      h: Math.max(SHAPE_GRID, Math.abs(fixed.y - p.y)),
    })
  } else if (snap.type === 'circle') {
    const r = Math.max(SHAPE_GRID, snapToGrid(Math.hypot(p.x - snap.cx, p.y - snap.cy), SHAPE_GRID))
    updateShape(snap.id, { r })
  } else if (snap.type === 'line') {
    updateShape(snap.id, hKey === 'v0' ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y })
  } else if (snap.type === 'polyline') {
    const i = Number(hKey.slice(1))
    updateShape(snap.id, { points: snap.points.map((pt, idx) => (idx === i ? [p.x, p.y] : pt)) })
  }
}

function setupInteract() {
  interact('[data-se-move]').draggable({
    listeners: {
      start(e) {
        // Перетаскивание существующих объектов — только в режиме выбора; при
        // активном инструменте рисования клик по фигуре должен рисовать поверх.
        if (tool.value !== 'select') {
          e.interaction.stop()
          return
        }
        const el = e.target
        const role = el.dataset.seMove
        const id = el.dataset.id
        dragCtx = { role, id, hKey: el.dataset.h }
        if (role === 'shape') {
          dragCtx.snapshot = clone(shapes.value.find((s) => s.id === id))
          dragCtx.start = unitsFromEvent(e)
          select(id)
        } else if (role === 'handle') {
          dragCtx.snapshot = clone(shapes.value.find((s) => s.id === id))
        }
      },
      move(e) {
        if (!dragCtx) return
        const cur = unitsFromEvent(e)
        if (dragCtx.role === 'port') {
          movePort(dragCtx.id, cur.x, cur.y)
        } else if (dragCtx.role === 'handle') {
          reshape(dragCtx.snapshot, dragCtx.hKey, cur)
        } else if (dragCtx.role === 'shape') {
          const a = anchorOf(dragCtx.snapshot)
          const dx = snapShapeX(a.x + (cur.x - dragCtx.start.x)) - a.x
          const dy = snapShapeY(a.y + (cur.y - dragCtx.start.y)) - a.y
          updateShape(dragCtx.id, translated(dragCtx.snapshot, dx, dy))
        }
      },
      end() {
        // Один снимок истории на весь жест (move'ы шли без коммита); commit
        // сам дедупит, если фигуру/порт по факту не сдвинули.
        if (dragCtx) commit()
        dragCtx = null
      },
    },
  })
}

// Порт: в режиме порта клик удаляет его (add идёт по фону, см. onSurfaceDown).
function onPortDown(e, id) {
  if (tool.value === 'port') {
    e.stopPropagation()
    removePort(id)
  }
}

// Клавиши редактора: Del — удалить выделенную фигуру, Esc — отменить рисование
// или закрыть редактор (не трогаем при фокусе в полях размера).
function isInInput(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
useEventListener(window, 'keydown', (e) => {
  if (!ui.stencilEditorOpen) return
  // Undo/redo — по физической клавише (event.code): на русской раскладке
  // e.key для Z/Y возвращает «Я»/«Н», литеральное сравнение сломалось бы.
  // В полях ввода (id/название/размер) не перехватываем — там нативный undo.
  if ((e.ctrlKey || e.metaKey) && !isInInput(e.target)) {
    if (e.code === 'KeyZ') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (e.code === 'KeyY') {
      e.preventDefault()
      redo()
      return
    }
    // Ctrl+C / Ctrl+V — копировать/вставить выделенную фигуру (со свойствами).
    if (e.code === 'KeyC') {
      e.preventDefault()
      ed.copyShape()
      return
    }
    if (e.code === 'KeyV') {
      e.preventDefault()
      ed.pasteShape()
      return
    }
  }
  if (e.key === 'Escape') {
    // Открыт модальный диалог (справка / confirm) поверх редактора — Esc закрывает
    // его сам (PrimeVue close-on-escape); редактор не трогаем, иначе один Esc закрыл
    // бы и диалог, и сам редактор.
    if (document.querySelector('.p-dialog-mask')) return
    if (drawing.value || polyPoints.value.length) {
      drawing.value = null
      polyPoints.value = []
      polyCursor.value = null
    } else {
      requestClose()
    }
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInInput(e.target) && selectedId.value) {
    e.preventDefault()
    removeShape(selectedId.value)
  }
})

onMounted(() => {
  setupInteract()
  updateRuler()
})
onBeforeUnmount(() => {
  interact('[data-se-move]').unset()
  window.removeEventListener('pointermove', onDrawMove)
  window.removeEventListener('pointerup', onDrawUp)
})
</script>

<template>
  <div class="flex flex-col bg-surface-0">
    <!-- Тулбар -->
    <div class="flex min-h-14 items-center gap-2 border-b border-surface-200 px-3">
      <h2 class="mr-2 text-sm font-semibold uppercase tracking-wide text-surface-900">Редактор</h2>
      <!-- Инструменты рисования (тогл). Отдельной кнопки «выбор» нет: select —
           фоновый дефолт (повторный клик по активному инструменту или авто после
           добавления фигуры возвращают к нему). -->
      <div class="flex items-center gap-1">
        <Button
          v-for="t in DRAW_TOOLS"
          :key="t.key"
          v-tooltip.bottom="t.tip"
          :icon="t.icon"
          :severity="tool === t.key ? 'primary' : 'secondary'"
          :text="tool !== t.key"
          size="small"
          class="tms-icon-btn"
          @click="pickTool(t.key)"
        />
      </div>

      <div class="mx-1 h-5 w-px bg-surface-200" aria-hidden="true"></div>

      <!-- Размер холста символа — рядом с инструментами рисования. На сохранении
           контент всё равно обрезается до bbox (cropToContent), поэтому итоговый
           размер может отличаться от заданного здесь. -->
      <div class="flex items-center gap-1.5 text-xs text-surface-500">
        <span>Холст</span>
        <InputNumber
          v-model="meta.width"
          :min="10"
          :step="10"
          :use-grouping="false"
          size="small"
          input-class="!w-14 text-center"
          @blur="commit"
        />
        <span class="text-surface-400">×</span>
        <InputNumber
          v-model="meta.height"
          :min="10"
          :step="10"
          :use-grouping="false"
          size="small"
          input-class="!w-14 text-center"
          @blur="commit"
        />
      </div>

      <div class="mx-1 h-5 w-px bg-surface-200" aria-hidden="true"></div>

      <Button
        v-tooltip.bottom="'Отменить (Ctrl+Z)'"
        icon="pi pi-undo"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        :disabled="!canUndo"
        @click="undo"
      />
      <Button
        v-tooltip.bottom="'Вернуть (Ctrl+Shift+Z)'"
        icon="pi pi-refresh"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        :disabled="!canRedo"
        @click="redo"
      />

      <div class="mx-1 h-5 w-px bg-surface-200" aria-hidden="true"></div>

      <Button
        v-tooltip.bottom="'Удалить выделенное'"
        icon="pi pi-trash"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        :disabled="!selectedId"
        @click="selectedId && removeShape(selectedId)"
      />

      <div class="flex-1"></div>

      <Button label="Сохранить" icon="pi pi-check" size="small" @click="save" />
      <Button
        ref="closeBtn"
        label="Закрыть"
        severity="secondary"
        text
        size="small"
        @click="requestClose"
      />
    </div>

    <!-- Холст с линейками по краям -->
    <div class="flex flex-1 min-h-0 flex-col">
      <!-- Уголок + верхняя линейка (X) -->
      <div class="flex shrink-0">
        <div
          class="shrink-0 border-b border-r border-surface-200 bg-surface-0"
          :style="{ width: `${RULER}px`, height: `${RULER}px` }"
        ></div>
        <div
          class="flex-1 overflow-hidden border-b border-surface-200 bg-surface-0"
          :style="{ height: `${RULER}px` }"
        >
          <svg :width="stageW" :height="RULER" class="block">
            <g v-for="t in rulerTicksX" :key="`rx${t.u}`">
              <line
                :x1="t.p"
                :y1="RULER - tickInset(t.level)"
                :x2="t.p"
                :y2="RULER"
                stroke="#94a3b8"
                stroke-width="1"
              />
              <text
                v-if="t.level === 'major'"
                :x="t.p + 2"
                y="9"
                fill="#64748b"
                font-size="9"
                font-family="monospace"
              >
                {{ t.u }}
              </text>
            </g>
          </svg>
        </div>
      </div>
      <!-- Левая линейка (Y) + холст -->
      <div class="relative flex flex-1 min-h-0">
        <!-- Превью состояния — плавающий контрол слева-сверху НА холсте (эмуляция
             видимости состояния; на экспорт не влияет). Виден при включённой анимации. -->
        <div
          v-if="meta.stateful"
          class="absolute top-2 z-10 flex items-center gap-2 rounded border border-surface-200 bg-surface-0/90 px-2 py-1 shadow-sm backdrop-blur-sm"
          :style="{ left: `${RULER + 8}px` }"
        >
          <span
            v-tooltip.bottom="'Эмуляция: как символ выглядит в состоянии (только превью)'"
            class="text-xs text-surface-500"
          >
            Превью
          </span>
          <Select
            v-model="previewState"
            :options="previewOptions"
            option-label="label"
            option-value="value"
            size="small"
            class="w-32"
          />
        </div>
        <div
          class="shrink-0 overflow-hidden border-r border-surface-200 bg-surface-0"
          :style="{ width: `${RULER}px` }"
        >
          <svg :width="RULER" :height="stageH" class="block">
            <g v-for="t in rulerTicksY" :key="`ry${t.u}`">
              <line
                :x1="RULER - tickInset(t.level)"
                :y1="t.p"
                :x2="RULER"
                :y2="t.p"
                stroke="#94a3b8"
                stroke-width="1"
              />
              <text
                v-if="t.level === 'major'"
                :x="RULER - 6"
                :y="t.p - 2"
                text-anchor="end"
                fill="#64748b"
                font-size="9"
                font-family="monospace"
              >
                {{ t.u }}
              </text>
            </g>
          </svg>
        </div>
        <div
          ref="stageEl"
          class="flex flex-1 items-center justify-center overflow-auto bg-surface-100"
          @scroll="updateRuler"
        >
          <svg
            ref="svgEl"
            :width="pxW"
            :height="pxH"
            :viewBox="`0 0 ${meta.width} ${meta.height}`"
            class="shadow-sm overflow-visible"
            :class="tool === 'select' ? 'cursor-default' : 'cursor-crosshair'"
            @pointerdown="onSurfaceDown"
            @pointermove="onSurfaceMove"
            @dblclick="finishPolyline"
          >
            <!-- Холст: та же канва (белый фон + сетка) продолжается за границы
                 стенсила, но на opacity .3 и без редактирования (pointer-events
                 none — рисуем только в области стенсила). Порядок: сначала вся
                 канва на .3, поверх — область стенсила 0..W/0..H на opacity 1. -->
            <g opacity="0.3" pointer-events="none">
              <rect
                :x="-gridPadX"
                :y="-gridPadY"
                :width="meta.width + gridPadX * 2"
                :height="meta.height + gridPadY * 2"
                fill="#fff"
              />
              <line
                v-for="x in gridXFull"
                :key="`fvx${x}`"
                :x1="x"
                :y1="-gridPadY"
                :x2="x"
                :y2="meta.height + gridPadY"
                :stroke="lineColor(x)"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
              <line
                v-for="y in gridYFull"
                :key="`fhy${y}`"
                :x1="-gridPadX"
                :y1="y"
                :x2="meta.width + gridPadX"
                :y2="y"
                :stroke="lineColor(y)"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            </g>
            <g pointer-events="none">
              <rect x="0" y="0" :width="meta.width" :height="meta.height" fill="#fff" />
              <line
                v-for="x in gridX"
                :key="`vx${x}`"
                :x1="x"
                :y1="0"
                :x2="x"
                :y2="meta.height"
                :stroke="lineColor(x)"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
              <line
                v-for="y in gridY"
                :key="`hy${y}`"
                :x1="0"
                :y1="y"
                :x2="meta.width"
                :y2="y"
                :stroke="lineColor(y)"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            </g>

            <!-- Фигуры в натуральном z-порядке (= порядок экспорта). Выделенную
                 НЕ выносим вперёд: её заливка перекрыла бы фигуры, лежащие выше.
                 Halo рисуем прямо перед выделенной фигурой, в её же слое — реальные
                 цвет линии/заливка видны поверх; выделение всё равно читается по
                 halo вокруг обводки и ручкам (ручки рисуются последними, сверху).
                 renderShapes фильтрует по превью состояния (эмуляция animation-hidden). -->
            <ShapePrimitive
              v-for="s in renderShapes"
              :key="s.id"
              :shape="s"
              :selected="s.id === selectedId"
              :halo-width="haloWidth"
              :halo-stroke="SEL_STROKE"
              :pointer-events="shapePointerEvents"
              @select="tool === 'select' && select(s.id)"
            />

            <!-- Превью тянущейся фигуры -->
            <rect
              v-if="draftRect"
              :x="draftRect.x"
              :y="draftRect.y"
              :width="draftRect.w"
              :height="draftRect.h"
              fill="none"
              :style="{ stroke: SEL_STROKE }"
              stroke-width="1"
              stroke-dasharray="3 2"
              vector-effect="non-scaling-stroke"
            />
            <line
              v-if="drawing?.type === 'line'"
              :x1="drawing.sx"
              :y1="drawing.sy"
              :x2="drawing.cx"
              :y2="drawing.cy"
              :style="{ stroke: SEL_STROKE }"
              stroke-width="1"
              stroke-dasharray="3 2"
              vector-effect="non-scaling-stroke"
            />
            <circle
              v-if="drawing?.type === 'circle' && draftCircleR > 0"
              :cx="drawing.sx"
              :cy="drawing.sy"
              :r="draftCircleR"
              fill="none"
              :style="{ stroke: SEL_STROKE }"
              stroke-width="1"
              stroke-dasharray="3 2"
              vector-effect="non-scaling-stroke"
            />
            <polyline
              v-if="polyPreview"
              :points="polyPreview"
              fill="none"
              :style="{ stroke: SEL_STROKE }"
              stroke-width="1"
              stroke-dasharray="3 2"
              vector-effect="non-scaling-stroke"
            />

            <!-- Ручки выделенной фигуры -->
            <circle
              v-for="hnd in handles"
              :key="`${selectedId}-${hnd.h}`"
              data-se-move="handle"
              :data-id="selectedId"
              :data-h="hnd.h"
              :cx="hnd.x"
              :cy="hnd.y"
              :r="hr"
              fill="#fff"
              :style="{ stroke: SEL_STROKE }"
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
              class="cursor-pointer"
            />

            <!-- Порты -->
            <circle
              v-for="p in ports"
              :key="p.id"
              data-se-move="port"
              :data-id="p.id"
              :cx="p.x"
              :cy="p.y"
              :r="hr * 1.2"
              fill="#f59e0b"
              stroke="#78350f"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
              :class="tool === 'port' ? 'cursor-pointer' : 'cursor-move'"
              @pointerdown="onPortDown($event, p.id)"
            />
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>
