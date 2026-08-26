<script setup>
/**
 * Редактор символов — оверлей поверх холста: рисование примитивов, порты, стиль
 * фигур и анимация состояния, всё со снапом к сетке (вершины 1px, порты и размер
 * символа — PORT_GRID). Рисовать можно только в области символа (вокруг — та же
 * канва на .3).
 *
 * Модель и undo/redo — в useStencilEditor; здесь DOM: SVG-холст, жесты рисования
 * и привязка drag/resize через interact.js (колбэки пишут в модель, DOM обновляет
 * Vue). Открывается на создание или правку незалоченного символа
 * (ui.stencilEditorTargetId). Сохранение валидирует, регистрирует в реестре и
 * пишет на диск dev-плагином.
 */
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import interact from 'interactjs'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ContextMenu from 'primevue/contextmenu'
import InputNumber from 'primevue/inputnumber'
import { useConfirm } from 'primevue/useconfirm'
import { useUiStore } from '../stores/useUiStore'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import { snapToGrid } from '../utils/grid'
import {
  stencilDraftIssues,
  isFillableShape,
  radii,
  shapesBounds,
  canRotateShapes,
  canFlipShapes,
  TEXT_SHAPE_SIZE,
} from '../utils/stencilSvg'
import { overlayButtonPositions } from '../utils/paperGeom'
import { confirmDanger } from '../utils/confirmDanger'
import { range, rangeFromTo, gridLineColor, tickInset, rulerTicks } from '../utils/editorRulers'
import { normalizeStateColor } from '../constants/animation'
import { TEXT_ICON, POLYLINE_ICON } from '../constants/icons'
import { getAllStencils, getStencilById, registerStencil } from '../stencils/registry'
import { syncStencilInstances } from '../stencils/svgInjector'
import { nplural } from '../utils/plural'
import { persistStencilsToDisk } from '../services/stencilLibrary'
import { upsertStencilOverride } from '../services/stencilOverrides'
import { useStencilEditor, SHAPE_GRID, PORT_GRID } from '../composables/useStencilEditor'
import { useEditorLasso } from '../composables/useEditorLasso'
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
  removeShapes,
  addPort,
  movePort,
  removePorts,
  selectPort,
  commit,
  undo,
  redo,
} = ed

// Рисующие инструменты. Отдельного «выбора» в тулбаре нет — select фоновый
// дефолт (см. pickTool: повторный клик по активному возвращает к нему).
const DRAW_TOOLS = [
  { key: 'line', icon: 'pi pi-minus', tip: 'Линия' },
  { key: 'rect', icon: 'pi pi-stop', tip: 'Прямоугольник' },
  { key: 'circle', icon: 'pi pi-circle', tip: 'Эллипс (Shift — ровный круг)' },
  {
    key: 'polyline',
    glyph: POLYLINE_ICON,
    tip: 'Ломаная (клик по началу — замкнуть, по последней точке или двойной клик — завершить)',
  },
  {
    key: 'text',
    glyph: TEXT_ICON,
    tip: 'Подпись (клик — поставить, текст правится в инспекторе)',
  },
  {
    key: 'port',
    icon: 'pi pi-map-marker',
    tip: 'Порт (клик по существующему — выделить, Del — удалить)',
  },
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
  // заливаемых (как на экспорте: tms-state-fill). Подпись не тонируем — в CSS
  // экспорта текст исключён селектором, иначе превью врало бы про рантайм.
  const { stroke, fill } = normalizeStateColor(meta.stateColors?.[key])
  if (!stroke && !fill) return visible
  return visible.map((s) => {
    if (s.type === 'text') return s
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

// Размер холста символа кратен шагу сетки схемы (PORT_GRID) — порты и сам символ
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

// Режим определяется таргетом из store: задан id → правка (грузим символ в
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
// состояния (пустой холст при создании / загруженный символ при правке).
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
// на диск (в проде плагина нет → символ уедет в library/ проекта). В режиме
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
  // Оверрайд в IDB — правка (новый символ / изменённая заливка встроенного)
  // переживёт reload и в prod. persistStencilsToDisk ниже — dev-бонус: пишет файл
  // в definitions/, чтобы символ попал в кодовую базу под git.
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
    // Экземпляры на холсте подтягивают новую версию символа целиком: рисунок,
    // порты, габарит. Одной операцией → один шаг undo (Ctrl+Z откатывает правку у
    // всех сразу). Закрытые формы сверяются при открытии (reinjectAllStencils
    // с `sync`) — их порты лежат в сохранённом graphJson.
    const { changed, detached } = syncStencilInstances(
      canvas.graphRef.value,
      canvas.paperRef.value,
      getStencilById(json.id),
      prev
    )
    canvas.bumpVersion()
    if (changed || detached.length) canvas.requestSnapshot()
    // Отцепленные концы выделяем — иначе искать их по схеме глазами.
    if (detached.length) canvas.setSelection(detached.map((id) => ({ kind: 'link', id })))
    const what = []
    if (changed) what.push(`обновлено ${nplural(changed, 'символ', 'символа', 'символов')}`)
    if (detached.length) {
      what.push(`отцеплено ${nplural(detached.length, 'провод', 'провода', 'проводов')}`)
    }
    // Отцепленный провод — потеря соединения, это warn, а не success.
    const detail = what.length ? what.join(', ') : json.id
    if (detached.length) notify.warn('Символ обновлён', `${detail} — порт удалён, перецепите`)
    else notify.success('Символ обновлён', detail)
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
// Вписываем bbox символа в доступную область с запасом; клампим, чтобы мелкие
// символы не раздувались до пикселизации, а крупные помещались.
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
// Ручки — константного размера на экране (в user-единицах = px/scale).
const hr = computed(() => 4 / scale.value)
// Порт — в МОДЕЛЬНЫХ единицах, как на холсте (там `r: 3` в координатах символа):
// автор видит вывод той же величины, что получит на схеме. Экранно-постоянный размер
// врал: в редакторе зум крупный, и порт казался мелкой точкой на фоне символа.
const PORT_R = 1.5
// Обводка порта тоже модельная (без non-scaling-stroke): на холсте она масштабируется
// зумом вместе с кружком, и «экранный» 1px в редакторе выглядел волоском.
const PORT_STROKE = 0.5

// ─── Сетка ───
// Расчёты (шаг/уровни яркости/диапазоны) — в utils/editorRulers; здесь только
// привязка к reactive-размерам и зуму.
const gridX = computed(() => range(meta.width))
const gridY = computed(() => range(meta.height))
const lineColor = gridLineColor

// Расширенная сетка: холст (та же сетка) продолжается за границы символа в зону
// .5 (не редактируется). Отступ = видимая область вокруг карточки в user-единицах
// ((stage − card) / 2 / scale); при скролле/большом символе → 0 (нечего показывать).
const gridPadX = computed(() =>
  Math.max(0, Math.ceil((stageW.value - pxW.value) / 2 / scale.value))
)
const gridPadY = computed(() =>
  Math.max(0, Math.ceil((stageH.value - pxH.value) / 2 / scale.value))
)
const gridXFull = computed(() => rangeFromTo(-gridPadX.value, meta.width + gridPadX.value))
const gridYFull = computed(() => rangeFromTo(-gridPadY.value, meta.height + gridPadY.value))

// ─── Пиксель события → user-координаты символа ───
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
// Зажат ли Shift: у эллипса он держит равные полуоси (ровный круг) и при
// рисовании, и при ресайзе ручкой — в interact-колбэке самого события нет.
const shiftHeld = ref(false)
useEventListener(document, 'keydown', (e) => {
  if (e.key === 'Shift') shiftHeld.value = true
})
useEventListener(document, 'keyup', (e) => {
  if (e.key === 'Shift') shiftHeld.value = false
})

const drawing = ref(null) // { type, sx, sy, cx, cy } — тянущаяся фигура
const polyPoints = ref([]) // накопленные вершины ломаной
const polyCursor = ref(null) // «резинка» до курсора

/**
 * Жест рисующего инструмента. Зовётся со STAGE, а не с SVG символа: начинать штрих и
 * ставить порт можно за пределами холста — так же, как рамку выделения. Координаты
 * считает `unitsFromEvent` (функция линейная, за границами viewBox работает так же), а
 * прижимает их к области символа снап: `snapShapeX/Y` и `portOnEdge` клампят в
 * 0..width/height, поэтому фигура не уедет за габарит, а порт сядет на ближнюю границу.
 */
function onDrawDown(e) {
  if (e.button !== 0) return
  if (tool.value === 'port') {
    if (e.target.closest('[data-se-move="port"]')) return // клик по порту — его хендлер
    const u = unitsFromEvent(e)
    addPort(u.x, u.y)
    return
  }
  // Подпись ставится одним кликом (не drag'ом): габарит задаёт шрифт, а не рамка.
  // Якорь — по левому краю (клик = начало текста), как на холсте; центр остаётся
  // дефолтом для фигур БЕЗ поля `align`, поэтому нарисованные ранее символы целы.
  if (tool.value === 'text') {
    const u = snappedShape(e)
    addShape({
      type: 'text',
      x: u.x,
      y: u.y,
      text: 'Текст',
      fontSize: TEXT_SHAPE_SIZE,
      align: 'left',
    })
    return
  }
  if (tool.value === 'polyline') {
    const u = snappedShape(e)
    const pts = polyPoints.value
    // Клик рядом с вершиной (при ≥2 точках): по стартовой — замыкаем в polygon (дубль
    // стартовой точки не добавляем, помечаем closed), по последней — заканчиваем
    // открытую ломаную, иначе правка последней точки ставила бы новую вершину.
    // Порог ~10 экранных px.
    if (pts.length >= 2) {
      const near = (pt) => Math.hypot(u.x - pt[0], u.y - pt[1]) <= 10 / scale.value
      if (near(pts[0]) || near(pts[pts.length - 1])) {
        addShape({ type: 'polyline', points: [...pts], closed: near(pts[0]) })
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

function onStageMove(e) {
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
    // Радиусы = полуоси габарита от центра (курсор идёт по границе), с Shift —
    // равные: так один инструмент даёт и эллипс, и ровный круг.
    const { rx, ry } = draftRadii(d)
    if (rx < SHAPE_GRID || ry < SHAPE_GRID) return
    addShape({ type: 'circle', cx: d.sx, cy: d.sy, rx, ry })
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
/** Полуоси тянущегося эллипса от центра; Shift — равные (ровный круг). */
function draftRadii(d) {
  const rx = snapToGrid(Math.abs(d.cx - d.sx), SHAPE_GRID)
  const ry = snapToGrid(Math.abs(d.cy - d.sy), SHAPE_GRID)
  if (!shiftHeld.value) return { rx, ry }
  const r = Math.max(rx, ry)
  return { rx: r, ry: r }
}
const draftEllipse = computed(() => {
  const d = drawing.value
  if (d?.type !== 'circle') return null
  const { rx, ry } = draftRadii(d)
  return rx > 0 && ry > 0 ? { cx: d.sx, cy: d.sy, rx, ry } : null
})
const polyPreview = computed(() => {
  if (!polyPoints.value.length) return ''
  const pts = polyCursor.value ? [...polyPoints.value, polyCursor.value] : polyPoints.value
  return pts.map(([x, y]) => `${x},${y}`).join(' ')
})

// Клик по фигуре: Ctrl/Cmd — добавить/убрать из выделения (как на холсте), иначе
// выделить одну. Перемещение пачки стартует в interact-хендлере ниже — он и решает,
// тащить ли всё выделение.
function onShapeSelect(id, e) {
  if (tool.value !== 'select') return
  if (e?.ctrlKey || e?.metaKey) toggleSelect(id)
  else if (!selectedSet.value.has(id)) select(id)
}

// ─── Лассо (рамка выделения по пустому месту) ───
/**
 * Старт рамки. Слушаем не сам SVG, а всю область просмотра (stage): выделение
 * логично начинать с пустого поля вокруг символа, когда фигура прижата к краю
 * холста и «пустого места» внутри просто нет. Координаты считает unitsFromEvent —
 * функция линейная, за границами viewBox работает так же (значения выходят за
 * 0..W/H, для рамки это нормально: в модель они не пишутся).
 */
function onStageDown(e) {
  if (e.button !== 0) return
  // Кнопки поворота/отражения лежат НАД stage: без этого гейта их pointerdown
  // трактуется как клик по пустому месту и снимает выделение раньше, чем сработает
  // @click, — кнопка получала бы пустой список и ничего не делала.
  if (e.target.closest('[data-se-overlay]')) return
  if (tool.value !== 'select') {
    onDrawDown(e)
    return
  }
  // Клик по фигуре/ручке/порту — их жест (drag через interact.js).
  if (e.target.closest('[data-se-move]')) return
  startLasso(e)
}

const { lassoRect, startLasso } = useEditorLasso({
  shapes,
  unitsFromEvent,
  onSelect: (ids, additive) => selectMany(ids, additive),
  onClear: () => select(null),
})

// Рамка вокруг всего выделения при N>1: у отдельных фигур halo своё, но общий
// габарит показывает, что жест drag/Delete применится ко всей пачке. При одной
// фигуре не рисуем — там есть halo и ручки.
/** Габарит выделения в user-координатах — общий якорь рамки и overlay-кнопок. */
const selectedBounds = computed(() =>
  shapesBounds(shapes.value.filter((s) => selectedSet.value.has(s.id)))
)
const selectionBox = computed(() => (selectedIds.value.length < 2 ? null : selectedBounds.value))

// ─── Ручки выделенной фигуры ───
// Только при ОДНОЙ выделенной (selectedId при N>1 — null): групповой ресайз по
// общему bbox — отдельная механика, а ручки одной фигуры посреди пачки врут.
const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null)
// Толщина halo-подсветки = обводка САМОЙ фигуры + запас в несколько экранных px.
// Считаем на каждую фигуру, а не на выделение: с общим значением у тонкой линии
// halo раздувался в широкую полосу, а у толстой прятался под её же обводкой.
const haloWidthFor = (s) => (s.strokeWidth || 2) + 4 / scale.value
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
  if (s.type === 'circle') {
    // Две ручки: правая тянет rx, нижняя ry (с Shift — обе, см. onHandleMove).
    const { rx, ry } = radii(s)
    return [
      { h: 'rx', x: s.cx + rx, y: s.cy },
      { h: 'ry', x: s.cx, y: s.cy + ry },
    ]
  }
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
  // text — как rect: точка привязки лежит в x/y. Без этой ветки drag падал в
  // polyline-случай и читал `points[0]`, которого у подписи нет.
  if (s.type === 'rect' || s.type === 'text') return { x: s.x, y: s.y }
  if (s.type === 'circle') return { x: s.cx, y: s.cy }
  if (s.type === 'line') return { x: s.x1, y: s.y1 }
  return { x: s.points[0][0], y: s.points[0][1] }
}
function translated(s, dx, dy) {
  if (s.type === 'rect' || s.type === 'text') return { x: s.x + dx, y: s.y + dy }
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
    const along = hKey === 'rx' ? Math.abs(p.x - snap.cx) : Math.abs(p.y - snap.cy)
    const value = Math.max(SHAPE_GRID, snapToGrid(along, SHAPE_GRID))
    // Shift — держим круг: тянем обе полуоси разом.
    const both = shiftHeld.value
    updateShape(
      snap.id,
      both ? { rx: value, ry: value } : hKey === 'rx' ? { rx: value } : { ry: value }
    )
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
          // Ведущая фигура: по ней считаем сдвиг и снап. Тащим всё выделение, если
          // ведущая в него входит; клик по фигуре вне выделения — переключаемся на
          // неё (иначе drag увёз бы невидимо выделенную пачку).
          if (!selectedSet.value.has(id)) select(id)
          dragCtx.snapshot = clone(shapes.value.find((s) => s.id === id))
          dragCtx.group = clone(shapes.value.filter((s) => selectedSet.value.has(s.id)))
          dragCtx.start = unitsFromEvent(e)
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
          // Снап считаем ОДИН раз по ведущей фигуре и применяем общий dx/dy ко всей
          // пачке: если снапить каждую отдельно, фигуры разъедутся друг относительно
          // друга (у каждой своя дробная часть координат).
          const a = anchorOf(dragCtx.snapshot)
          const dx = snapShapeX(a.x + (cur.x - dragCtx.start.x)) - a.x
          const dy = snapShapeY(a.y + (cur.y - dragCtx.start.y)) - a.y
          const byId = new Map(dragCtx.group.map((s) => [s.id, s]))
          updateShapes(
            dragCtx.group.map((s) => s.id),
            (s) => translated(byId.get(s.id), dx, dy)
          )
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

/**
 * Клик по порту ВЫДЕЛЯЕТ его (Ctrl/Cmd — добавляет к выделению), удаляет — `Del`, как у
 * фигур. Раньше удалением был повторный клик в режиме «Порт»: жест не совпадал ни с чем
 * другим в редакторе и срабатывал мимоходом при попытке порт подвинуть.
 *
 * stopPropagation обязателен: в режиме «Порт» pointerdown по холсту создаёт новый порт,
 * и без него клик по существующему тут же добавлял бы второй рядом.
 */
function onPortDown(e, id) {
  e.stopPropagation()
  selectPort(id, e.ctrlKey || e.metaKey)
}

const ARROW_DIRS = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

// Клавиши редактора: Del — удалить выделенную фигуру, Esc — отменить рисование
// или закрыть редактор (не трогаем при фокусе в полях размера).
function isInInput(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

// Стрелки в фокусе Select'а (превью состояния) листают его опции — сдвиг фигур там
// был бы вторым, невидимым эффектом одного нажатия.
function isInListWidget(t) {
  return !!t?.closest?.('[role="combobox"], [role="listbox"]')
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
    // Ctrl+C / Ctrl+V — копировать/вставить выделенное (со свойствами).
    if (e.code === 'KeyC') {
      e.preventDefault()
      ed.copyShapes()
      return
    }
    if (e.code === 'KeyV') {
      e.preventDefault()
      ed.pasteShapes()
      return
    }
    // Ctrl+A — все фигуры (порты в выделение не входят, у них свой режим).
    if (e.code === 'KeyA') {
      e.preventDefault()
      setTool('select')
      selectAll()
      return
    }
  }
  if (e.key === 'Escape') {
    // Открыт модальный диалог (справка / confirm) поверх редактора — Esc закрывает
    // его сам (PrimeVue close-on-escape); редактор не трогаем, иначе один Esc закрыл
    // бы и диалог, и сам редактор.
    if (document.querySelector('.p-dialog-mask')) return
    // Порядок как на холсте: сначала отменяем активный жест, потом снимаем
    // выделение, и только «пустым» Esc закрываем редактор — иначе Esc после
    // выделения рамкой уводил бы из редактора целиком.
    if (drawing.value || polyPoints.value.length) {
      drawing.value = null
      polyPoints.value = []
      polyCursor.value = null
    } else if (selectedIds.value.length || selectedPortIds.value.length) {
      select(null)
    } else {
      requestClose()
    }
    return
  }
  // Стрелки — сдвиг выделения, как на холсте: шаг сетки, с Shift — впятеро крупнее
  // (у фигур сетка 1px, у портов и размера символа — 5). В полях ввода не
  // перехватываем: там стрелки правят значение степпера.
  const arrow = ARROW_DIRS[e.key]
  if (arrow && !isInInput(e.target) && !isInListWidget(e.target)) {
    // Порт живёт на сетке символа, поэтому у него шаг всегда PORT_GRID: пиксельный
    // сдвиг увёл бы вывод с клетки, и провод на схеме перестал бы попадать в порт.
    if (selectedPortIds.value.length) {
      e.preventDefault()
      ed.nudgePorts(arrow.x * PORT_GRID, arrow.y * PORT_GRID)
      return
    }
    if (selectedIds.value.length) {
      e.preventDefault()
      const step = e.shiftKey ? PORT_GRID : SHAPE_GRID
      ed.nudgeShapes(arrow.x * step, arrow.y * step)
      return
    }
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInInput(e.target)) {
    // Выделение взаимно исключающее (см. selectPort), поэтому порядок проверок не спорит.
    if (selectedPortIds.value.length) {
      e.preventDefault()
      removePorts(selectedPortIds.value)
      return
    }
    if (selectedIds.value.length) {
      e.preventDefault()
      removeShapes(selectedIds.value)
      return
    }
  }
  // Поворот и отражение — те же клавиши, что на холсте (см. useHotkeys). Без Ctrl,
  // поэтому проверяем поля ввода: R посреди набора подписи не должен крутить фигуру.
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !isInInput(e.target) && selectedIds.value.length) {
    if (e.code === 'KeyR') {
      e.preventDefault()
      rotateSelectedBy(e.shiftKey ? -90 : 90)
      return
    }
    if (e.shiftKey && (e.code === 'KeyH' || e.code === 'KeyV')) {
      e.preventDefault()
      flipSelected(e.code === 'KeyH' ? 'h' : 'v')
      return
    }
  }
  // Порядок наложения — те же аккорды, что на холсте (см. useHotkeys): Ctrl+] / Ctrl+[,
  // с Shift — до края. У фигур слой задаёт позиция в массиве, а не z.
  if ((e.ctrlKey || e.metaKey) && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
    if (!selectedIds.value.length) return
    e.preventDefault()
    const up = e.code === 'BracketRight'
    ed.reorderShapes(
      selectedIds.value,
      e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward'
    )
  }
})

// Overlay-кнопки выделения: поворот на 90°, отражение и удаление — те же иконки,
// позиции и клавиши, что на холсте (раскладку считает общая overlayButtonPositions).
// Рамку берём из МОДЕЛИ и переводим в пиксели сами: у фигур нет своего DOM-узла с
// габаритом, а у SVG свой масштаб (scale = px на единицу модели).

/** Выделенные фигуры в порядке отрисовки — вход предикатов доступности операций. */
const selectedShapes = computed(() => shapes.value.filter((s) => selectedSet.value.has(s.id)))

// Операцию предлагаем только там, где она реально меняет картинку: у круга и квадрата
// поворот, у прямоугольника и ортогональной линии отражение — no-op, и «мёртвая»
// кнопка (или пункт меню) читается как поломка. Один источник для кнопок, ПКМ-меню и
// хоткеев — иначе клавиша делала бы то, чего кнопка не предлагает.
const canRotateSel = computed(() => canRotateShapes(selectedShapes.value))
const canFlipSelH = computed(() => canFlipShapes(selectedShapes.value, 'h'))
const canFlipSelV = computed(() => canFlipShapes(selectedShapes.value, 'v'))

const shapeOverlay = computed(() => {
  if (!selectedIds.value.length || tool.value !== 'select') return null
  const bbox = selectedBounds.value
  if (!bbox) return null
  const k = scale.value
  return {
    canRotate: canRotateSel.value,
    canFlipH: canFlipSelH.value,
    canFlipV: canFlipSelV.value,
    ...overlayButtonPositions({
      left: bbox.x * k,
      top: bbox.y * k,
      right: (bbox.x + bbox.w) * k,
      bottom: (bbox.y + bbox.h) * k,
    }),
  }
})

// Гейт держим здесь, а не только в разметке: через него проходят и кнопка, и пункт
// меню, и хоткей — иначе клавиша делала бы «преобразование», которого не видно.
function rotateSelectedBy(deg) {
  if (!canRotateSel.value) return
  ed.rotateShapes(selectedIds.value, deg < 0 ? -1 : 1)
}
function flipSelected(axis) {
  if (!(axis === 'h' ? canFlipSelH.value : canFlipSelV.value)) return
  ed.flipShapes(selectedIds.value, axis)
}

// ПКМ по фигуре: порядок наложения и удаление — те же операции, что в меню холста.
// Клик по невыделенной фигуре сначала выделяет её (как на холсте), поэтому команда
// всегда работает с тем, на что нажали.
const ctxMenu = ref(null)
const ctxItems = computed(() => {
  // Пункты преобразований — под теми же предикатами, что кнопки: у симметричной
  // фигуры подменю целиком не показываем, а не отдаём пункт-пустышку.
  const flips = [
    canFlipSelH.value && {
      label: 'По горизонтали · Shift+H',
      icon: 'pi pi-arrows-h',
      command: () => flipSelected('h'),
    },
    canFlipSelV.value && {
      label: 'По вертикали · Shift+V',
      icon: 'pi pi-arrows-v',
      command: () => flipSelected('v'),
    },
  ].filter(Boolean)
  return [
    {
      label: 'Порядок',
      icon: 'pi pi-sort-alt',
      items: [
        { label: 'На передний план', icon: 'pi pi-angle-double-up', command: () => order('front') },
        { label: 'Выше', icon: 'pi pi-angle-up', command: () => order('forward') },
        { label: 'Ниже', icon: 'pi pi-angle-down', command: () => order('backward') },
        { label: 'На задний план', icon: 'pi pi-angle-double-down', command: () => order('back') },
      ],
    },
    ...(canRotateSel.value
      ? [
          {
            label: 'Повернуть',
            icon: 'pi pi-refresh',
            items: [
              { label: 'По часовой · R', icon: 'pi pi-undo', command: () => rotateSelectedBy(90) },
              {
                label: 'Против часовой · Shift+R',
                icon: 'pi pi-undo',
                command: () => rotateSelectedBy(-90),
              },
            ],
          },
        ]
      : []),
    ...(flips.length ? [{ label: 'Отразить', icon: 'pi pi-arrows-h', items: flips }] : []),
    { separator: true },
    {
      label: 'Удалить',
      icon: 'pi pi-trash',
      command: () => removeShapes(selectedIds.value),
    },
  ]
})

function order(mode) {
  ed.reorderShapes(selectedIds.value, mode)
}

function onShapeContextMenu(event) {
  const el = event.target.closest('[data-se-move="shape"]')
  const id = el?.dataset?.id
  if (!id) return
  event.preventDefault()
  if (!selectedSet.value.has(id)) select(id)
  ctxMenu.value?.show(event)
}

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
      <h2 class="text-sm font-semibold uppercase tracking-wide text-surface-900">Редактор</h2>
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
        >
          <template v-if="t.glyph" #icon>
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true">
              <path
                v-for="(el, i) in t.glyph"
                :key="i"
                :d="el.d"
                :fill="el.mode === 'fill' ? 'currentColor' : 'none'"
                :stroke="el.mode === 'stroke' ? 'currentColor' : 'none'"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </template>
        </Button>
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
          input-class="w-14! text-center"
          @blur="commit"
        />
        <span class="text-surface-400">×</span>
        <InputNumber
          v-model="meta.height"
          :min="10"
          :step="10"
          :use-grouping="false"
          size="small"
          input-class="w-14! text-center"
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
        :disabled="!selectedIds.length"
        @click="removeShapes(selectedIds)"
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
          @pointerdown="onStageDown"
          @pointermove="onStageMove"
        >
          <div class="relative">
            <svg
              ref="svgEl"
              :width="pxW"
              :height="pxH"
              :viewBox="`0 0 ${meta.width} ${meta.height}`"
              class="shadow-sm overflow-visible"
              :class="tool === 'select' ? 'cursor-default' : 'cursor-crosshair'"
              @dblclick="finishPolyline"
              @contextmenu="onShapeContextMenu"
            >
              <!-- Холст: та же канва (белый фон + сетка) продолжается за границы
                 символа, но на opacity .3 и без редактирования (pointer-events
                 none — рисуем только в области символа). Порядок: сначала вся
                 канва на .3, поверх — область символа 0..W/0..H на opacity 1. -->
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
                :selected="selectedSet.has(s.id)"
                :halo-width="haloWidthFor(s)"
                :halo-stroke="SEL_STROKE"
                :pointer-events="shapePointerEvents"
                @select="onShapeSelect(s.id, $event)"
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
              <ellipse
                v-if="draftEllipse"
                :cx="draftEllipse.cx"
                :cy="draftEllipse.cy"
                :rx="draftEllipse.rx"
                :ry="draftEllipse.ry"
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

              <!-- Рамка лассо + общий габарит выделения (при N>1). Обе в user-
                 координатах, поэтому зум/скролл их не сдвигают. -->
              <rect
                v-if="lassoRect"
                pointer-events="none"
                :x="lassoRect.x"
                :y="lassoRect.y"
                :width="lassoRect.w"
                :height="lassoRect.h"
                fill="none"
                :style="{ stroke: SEL_STROKE }"
                stroke-width="1"
                stroke-dasharray="4 2"
                vector-effect="non-scaling-stroke"
              />
              <rect
                v-if="selectionBox"
                pointer-events="none"
                :x="selectionBox.x"
                :y="selectionBox.y"
                :width="selectionBox.w"
                :height="selectionBox.h"
                fill="none"
                :style="{ stroke: SEL_STROKE }"
                stroke-width="1"
                stroke-dasharray="2 2"
                opacity="0.7"
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
                :r="PORT_R"
                fill="#ffffff"
                :style="selectedPortSet.has(p.id) ? { stroke: SEL_STROKE } : null"
                stroke="#000000"
                :stroke-width="PORT_STROKE"
                :class="tool === 'port' ? 'cursor-pointer' : 'cursor-move'"
                @pointerdown="onPortDown($event, p.id)"
              />
            </svg>
            <!-- Кнопки поворота и отражения выделения — те же иконки, позиции и клавиши,
               что на холсте (см. useSelectionOverlay). Якорь — bbox выделения из МОДЕЛИ,
               поэтому при перемещении фигуры кнопки едут вместе с ней. -->
            <template v-if="shapeOverlay">
              <Button
                v-if="shapeOverlay.canRotate"
                v-tooltip.top="'Повернуть против часовой · Shift+R'"
                icon="pi pi-undo"
                severity="secondary"
                rounded
                size="small"
                data-se-overlay="1"
                class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
                :style="shapeOverlay.rotateCcw"
                @click="rotateSelectedBy(-90)"
              />
              <Button
                v-if="shapeOverlay.canRotate"
                v-tooltip.top="'Повернуть по часовой · R'"
                icon="pi pi-undo -scale-x-100"
                severity="secondary"
                rounded
                size="small"
                data-se-overlay="1"
                class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
                :style="shapeOverlay.rotateCw"
                @click="rotateSelectedBy(90)"
              />
              <Button
                v-if="shapeOverlay.canFlipH"
                v-tooltip.top="'Отразить по горизонтали · Shift+H'"
                icon="pi pi-arrows-h"
                severity="secondary"
                rounded
                size="small"
                data-se-overlay="1"
                class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
                :style="shapeOverlay.flipH"
                @click="flipSelected('h')"
              />
              <Button
                v-if="shapeOverlay.canFlipV"
                v-tooltip.top="'Отразить по вертикали · Shift+V'"
                icon="pi pi-arrows-v"
                severity="secondary"
                rounded
                size="small"
                data-se-overlay="1"
                class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
                :style="shapeOverlay.flipV"
                @click="flipSelected('v')"
              />
              <Button
                v-tooltip.top="'Удалить · Del'"
                icon="pi pi-trash"
                severity="secondary"
                rounded
                size="small"
                data-se-overlay="1"
                class="absolute! z-20! w-8! h-8! p-0! min-w-0! border! border-surface-300! hover:!border-surface-400"
                :style="shapeOverlay.delete"
                @click="removeShapes(selectedIds)"
              />
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ПКМ по фигуре: порядок наложения + удаление (как в меню холста). -->
    <ContextMenu ref="ctxMenu" :model="ctxItems" />
  </div>
</template>
