<script setup>
/**
 * Редактор символов — оверлей поверх холста: рисование примитивов, порты, стиль фигур
 * и анимация состояния со снапом к сетке (вершины 1px, порты и размер — PORT_GRID).
 *
 * Модель и undo/redo — в useStencilEditor, здесь SVG-стол и сборка его механик:
 * масштаб (useEditorZoom), рисование жестами (useEditorDraw), перенос и ресайз
 * (useEditorInteract), лассо (useEditorLasso), клавиши (useEditorHotkeys). Программный
 * символ (шина) открывается только ради зон диапазонов (`rangesOnly`). Сохранение
 * валидирует, регистрирует в реестре и пишет на диск dev-плагином.
 */
import { computed, ref, onMounted, watch } from 'vue'
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import InputNumber from 'primevue/inputnumber'
import Divider from 'primevue/divider'
import { useUiStore } from '../stores/useUiStore'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import {
  takesStateFill,
  radii,
  shapeBounds,
  shapesBounds,
  canRotateShapes,
  canFlipShapes,
} from '../utils/shapeSvg'
import { stencilDraftProblems, parseStencilSvg, shapeStateKeys } from '../utils/stencilSvg'
import { presetEditResult, sameShapeStates } from '../utils/presetPatch'
import { sanitizeSvgMarkup } from '../utils/sanitizeSvg'
import { overlayButtonPositions } from '../utils/paperGeom'
import { useConfirmDanger } from '../composables/useConfirmDanger'
import { GRID_PERIOD, gridPatternLines, tickInset, rulerTicks } from '../utils/editorRulers'
import { normalizeStateColor } from '../constants/animation'
import { TEXT_ICON, POLYLINE_ICON, ROTATE_ICON } from '../constants/icons'
import ContextMenuItem from './ContextMenuItem.vue'
import GlyphIcon from './GlyphIcon.vue'
import {
  getAllStencils,
  getStencilById,
  isPresetStencil,
  registerStencil,
} from '../stencils/registry'
import { syncStencilInstances } from '../stencils/svgInjector'
import { nplural } from '../utils/plural'
import { persistStencilsToDisk } from '../services/stencilLibrary'
import { removeStencilOverride, upsertStencilOverride } from '../services/stencilOverrides'
import { presetStencilBase } from '../services/presetLibrary'
import { useStencilEditor, BOX_GRID } from '../composables/useStencilEditor'
import { useEditorZoom, MIN_SCALE, MAX_SCALE } from '../composables/useEditorZoom'
import { useEditorDraw } from '../composables/useEditorDraw'
import { useEditorInteract } from '../composables/useEditorInteract'
import { useEditorHotkeys } from '../composables/useEditorHotkeys'
import { useEditorLasso } from '../composables/useEditorLasso'
import { useBlurOnPress } from '../composables/useBlurOnPress'
import ShapePrimitive from './ShapePrimitive.vue'

// Шаблон двухкорневой: кнопки сохранения уезжают Teleport'ом в шапку инспектора,
// поэтому класс позиции с места использования вешаем на окно редактора сами.
defineOptions({ inheritAttrs: false })

const ui = useUiStore()
const notify = useNotify()
const confirmDanger = useConfirmDanger()
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
  selectedPortSet,
  editingId,
  presetInfo,
  previewState,
  canUndo,
  hasChanges,
  canRedo,
  snapShapeX,
  snapShapeY,
  setTool,
  reset,
  loadStencil,
  select,
  toggleSelect,
  selectMany,
  removeShapes,
  selectPort,
  setCanvasSize,
  contentOverflow,
  savedBox,
  commit,
  undo,
  redo,
} = ed

// Рисующие инструменты; кнопки «выбор» в тулбаре нет — select это фоновый дефолт.
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
]

/**
 * Порт стоит отдельной группой: он не рисунок символа, а точка подключения провода —
 * то же деление, что на холсте, где симуляция отбита от инструментов схемы.
 */
const PORT_TOOL = {
  key: 'port',
  icon: 'pi pi-map-marker',
  tip: 'Порт (клик по существующему — выделить, Del — удалить)',
}

// Порядок кнопок в тулбаре = номера клавиш 1…6 (см. useEditorHotkeys).
const TOOL_KEYS = [...DRAW_TOOLS, PORT_TOOL].map((t) => t.key)

// Тогл инструментов: повторный клик по активному возвращает к select.
function pickTool(key) {
  setTool(tool.value === key ? 'select' : key)
}

// Метка состояния на столе — фиолетовая: cyan занят выделением, амбер —
// предупреждениями, чёрный сливается с рисунком.
const STATE_MARK_STROKE = '#a855f7' // purple-500

/** Подпись состояния: у булева — Вкл/Выкл, у «по значению» — заданная автором. */
function stateLabelOf(key) {
  if (meta.stateMode === 'value') return meta.states?.find((s) => s.key === key)?.label || key
  return key === 'true' ? 'Вкл' : 'Выкл'
}

/**
 * Показывать ли метки состояний: рисунок символа сам по себе не говорит, что линия
 * видна только во «Вкл». Пока включено превью, меток нет — там на столе и так только
 * фигуры выбранного состояния, а пунктир вокруг каждой был бы шумом.
 */
const showStateMarks = computed(() => meta.stateful && previewState.value === 'all')

/** Цвет метки фигуры: пусто — фигура статична, метки нет. */
function markStrokeFor(s) {
  return showStateMarks.value && s.state && s.state !== 'always' ? STATE_MARK_STROKE : ''
}

/**
 * Подписи состояний — по габариту фигуры, над её левым верхним углом. Фигура в нескольких
 * состояниях подписана всеми через точку.
 */
const stateLabels = computed(() => {
  if (!showStateMarks.value) return []
  return shapes.value
    .filter((s) => s.state && s.state !== 'always')
    .map((s) => {
      const box = shapeBounds(s)
      const label = shapeStateKeys(s.state).map(stateLabelOf).join(' · ')
      return { id: s.id, label, x: box.x, y: box.y }
    })
})

const previewLabel = computed(() => stateLabelOf(previewState.value))
const renderShapes = computed(() => {
  if (!meta.stateful || previewState.value === 'all') return shapes.value
  const key = previewState.value
  const visible = shapes.value.filter((s) => {
    const keys = shapeStateKeys(s.state)
    return !keys.length || keys.includes(key)
  })
  // Превью цвета состояния: тонируется обводка видимых фигур, заливка — только у
  // замкнутых без своей заливки (как в экспорте). Подпись не тонируется: в CSS
  // экспорта текст исключён.
  const { stroke, fill } = normalizeStateColor(meta.stateColors?.[key])
  if (!stroke && !fill) return visible
  return visible.map((s) => {
    if (s.type === 'text') return s
    const next = { ...s }
    if (stroke) next.stroke = stroke
    if (fill && takesStateFill(s)) next.fill = fill
    return next
  })
})

/**
 * Подсветка контента, вылезшего за границу символа: торчащие части фигур штрихуются,
 * будущий габарит (`cropToContent`) обводится пунктиром.
 *
 * Штрих, а не полупрозрачная заливка: alpha смешала бы цвет с рисунком, и по фигуре
 * уже не сказать, что нарисовано. Слой паттерна режется дважды — clip-path'ом «всё,
 * кроме холста» (дыра через evenodd) и МАСКОЙ из копий фигур, чтобы ложился на их
 * чернила. Маска, а не заливка копий: у контурной фигуры `fill: none`, красить
 * паттерном нечего, а обводка в маске участвует своей толщиной. Шаг штриха делится на
 * масштаб — на экране он постоянный.
 */
// Розовый: амбер занят предупреждениями формы, cyan — выделением, purple — метками
// состояний.
const OVERFLOW_STROKE = '#f43f5e' // rose-500
const OVERFLOW_CLIP_ID = 'tms-se-overflow-clip'
const OVERFLOW_HATCH_ID = 'tms-se-overflow-hatch'
const OVERFLOW_MASK_ID = 'tms-se-overflow-mask'
const hatchStep = computed(() => 7 / scale.value)
// Копии фигур для маски: белое = сюда штрих ложится. Обводка своей толщины, заливка
// только у заливаемых — пустое нутро контурной фигуры штриховать не за что. В маску
// идут ТОЛЬКО вылезшие фигуры: остальные всё равно отрезал бы clip-path.
const overflowMaskShapes = computed(() => {
  if (!contentOverflow.value) return []
  return renderShapes.value
    .filter((s) => {
      const b = shapeBounds(s)
      if (!b) return false
      // Запас в половину обводки: bbox считается по геометрии, а рисуется линия шире.
      const pad = (s.strokeWidth ?? 2) / 2
      return (
        b.x - pad < 0 ||
        b.y - pad < 0 ||
        b.x + b.w + pad > meta.width ||
        b.y + b.h + pad > meta.height
      )
    })
    .map((s) => ({
      ...s,
      stroke: '#fff',
      fill: s.type === 'text' || (s.fill && s.fill !== 'none') ? '#fff' : 'none',
    }))
})
// Габарит выступа с запасом: обводка фигуры выходит за bbox на половину толщины.
const overflowArea = computed(() => {
  const b = contentOverflow.value
  if (!b) return null
  const pad = 20
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }
})
const overflowClip = computed(() => {
  const a = overflowArea.value
  if (!a) return null
  const [x1, y1] = [a.x + a.w, a.y + a.h]
  return `M ${a.x} ${a.y} H ${x1} V ${y1} H ${a.x} Z M 0 0 H ${meta.width} V ${meta.height} H 0 Z`
})

// При активном инструменте рисования фигуры прозрачны для указателя: pointerdown
// уходит на холст, перенос фигуры не стартует. В режиме select они
// интерактивны; порты и ручки не трогаются.
const shapePointerEvents = computed(() => (tool.value === 'select' ? null : 'none'))

// Снап и перенос портов держит модель (`setCanvasSize`), здесь только кнопки. Через
// watch за `meta` нельзя: `loadStencil` ставит размер и порты одной операцией, и
// хендлер переклеил бы загруженные порты. Размер меняется только степперами шагом
// BOX_GRID; шаг дискретный, поэтому коммитим сразу.
function setSize(axis, value) {
  if (
    setCanvasSize(axis === 'width' ? value : meta.width, axis === 'height' ? value : meta.height)
  ) {
    commit()
  }
}

// Поле степпера — только табло: курсор в него не ставится (`pointer-events: none` на
// самом input, кнопки при этом кликаются), клавиатурный ввод глушится. `readonly`
// не подходит — он гасит и кнопки InputNumber.
function blockSizeTyping(e) {
  e.preventDefault()
}

// Цвет halo выделения и превью рисования — primary темы через токен
// var(--p-primary-500), а не литерал. Применяется через :style: SVG-АТРИБУТ stroke
// значение var() не резолвит, CSS-свойство — резолвит и наследуется.
const SEL_STROKE = 'var(--p-primary-500)'

// Режим задаёт таргет из стора: id — правка либо ДУБЛИРОВАНИЕ (та же модель, символ
// новый), иначе создание с префиллом `cell_`. Синглтон переживает закрытие редактора,
// поэтому на входе состояние всегда перезаписывается loadStencil или reset.
const editTarget = ui.stencilEditorTargetId ? getStencilById(ui.stencilEditorTargetId) : null
const isDuplicate = !!editTarget && ui.stencilEditorDuplicate
if (editTarget) {
  loadStencil(editTarget, { asCopy: isDuplicate })
} else {
  reset()
  meta.id = 'cell_'
}
// Программный символ (шина): тело и порты считает код, здесь правятся только зоны
// диапазонов — стол и инструменты скрыты, сохранение не пересобирает определение.
const rangesOnly = !isDuplicate && !!editTarget?.locked

// Символ поставляемого набора: правятся только анимации, поэтому стол виден (фигурам
// раздают состояния), а геометрия на нём заперта.
const animationOnly = !rangesOnly && !!presetInfo.value

// Единый гейт правки фигур и портов: рисование, drag, ручки, стрелки, Delete,
// поворот/отражение, порядок наложения, размер холста.
const shapesLocked = rangesOnly || animationOnly

// Несохранённое считаем разницей с исходным состоянием (`hasChanges`), а не шагами
// истории: правка, отменённая руками, разницы не даёт. Копия «грязная» с самого
// начала — она ещё не существует, и молча терять её на Esc нельзя.
const isDirty = computed(() => isDuplicate || hasChanges.value)

// Закрытие с подтверждением, если черновик непустой. Попап якорится на кнопку
// «Закрыть» — для Esc, где DOM-таргета нет, через closeBtn-реф.
const closeBtn = ref(null)
function requestClose(event) {
  if (!isDirty.value) {
    ui.closeStencilEditor()
    return
  }
  confirmDanger({
    target: event?.currentTarget || closeBtn.value?.$el,
    message: 'Закрыть редактор? Несохранённый символ будет потерян.',
    acceptLabel: 'Закрыть',
    accept: () => ui.closeStencilEditor(),
  })
}

// Поля черновика, которые подсвечивает панель символа (StencilInspector, `problemOf`).
const SYMBOL_FIELDS = new Set(['id', 'label', 'category'])

// Сохранение: валидация → регистрация в реестре → персист на диск (в проде плагина
// нет, символ уедет в library/ проекта). При правке id исключается из проверки
// уникальности, а после сохранения активная форма переинжектится: расставленные
// экземпляры подхватывают новый рисунок, при смене портов идёт предупреждение.
async function save() {
  const editing = editingId.value
  const existingIds = getAllStencils()
    .map((s) => s.id)
    .filter((id) => id !== editing)
  // Проверки черновика — про фигуры и поля, которых у программного символа не правят.
  const problems = rangesOnly ? [] : stencilDraftProblems(meta, shapes.value, existingIds)
  if (problems.length) {
    notify.warn('Проверь символ', problems.map((p) => p.message).join('; '))
    // Поля символа подсвечены в его панели, а её не видно, пока выделены фигуры.
    if (problems.some((p) => SYMBOL_FIELDS.has(p.field))) select(null)
    return
  }
  const prev = editing ? getStencilById(editing) : null
  const out = rangesOnly ? ed.outputRangesOnly(prev) : ed.output({ keepBox: animationOnly })
  const { json, svg, pristine } = animationOnly ? presetEdit(out) : { ...out, pristine: false }
  registerStencil(json, svg)
  // Оверрайд в IDB даёт правке пережить reload и в prod. Символ, совпавший с набором,
  // оверрайда не держит: иначе он перекрывал бы обновления набора.
  const idbOk = pristine
    ? await removeStencilOverride(json.id)
    : await upsertStencilOverride({ id: json.id, stencilJson: json, shapeSvg: svg })
  // Файл в src/library/ попадает под git как встроенный символ — символу набора туда нельзя.
  const ok = isPresetStencil(json)
    ? false
    : await persistStencilsToDisk([{ id: json.id, stencilJson: json, shapeSvg: svg }])
  // Символ уходит в .zip (library/) — проект разошёлся с последним экспортом.
  canvas.markDirty()
  // Оверрайд не записался (квота, приватный режим) — правка живёт только до reload:
  // сообщаем и поднимаем saveError.
  if (!idbOk) {
    canvas.setSaveError(true)
    notify.error(
      'Символ не сохранён локально',
      'Браузер отклонил запись в хранилище — правка потеряется после перезагрузки'
    )
  }

  if (editing) await syncInstancesAndReport(json.id, prev, 'Символ обновлён')
  else if (ok) notify.success('Символ создан', json.id)
  else {
    notify.success(
      'Символ создан',
      'Переживёт перезагрузку; файл в src/library/ появится только в dev-режиме'
    )
  }
  ui.closeStencilEditor()
}

/**
 * Правка символа набора: отличия от установленной версии (utils/presetPatch). Рисунок
 * свой, только если видимость фигур по состояниям разошлась с набором. Набора нет
 * (символ пришёл со старым архивом) — сохраняем снимком, как свой символ.
 */
function presetEdit({ json, svg }) {
  const base = presetStencilBase(json.id)
  if (!base) return { json, svg, pristine: false }
  const baseShapes = parseStencilSvg(sanitizeSvgMarkup(base.shapeSvg).svg)
  return presetEditResult(base, json, {
    editedSvg: svg,
    drawing: !sameShapeStates(baseShapes, shapes.value),
  })
}

// «Сбросить к набору» — только у символа набора, у которого есть правки проекта.
const canResetToPreset =
  animationOnly && !!editTarget?.presetPatch && !!presetStencilBase(editTarget.id)

function confirmResetToPreset(event) {
  confirmDanger({
    target: event?.currentTarget,
    message: 'Вернуть символ к виду из набора? Настройки проекта у него сбросятся.',
    acceptLabel: 'Сбросить',
    accept: resetToPreset,
  })
}

async function resetToPreset() {
  const base = presetStencilBase(editTarget.id)
  if (!base) return
  const prev = getStencilById(base.id)
  registerStencil(base.stencilJson, base.shapeSvg)
  if (!(await removeStencilOverride(base.id))) {
    canvas.setSaveError(true)
    notify.error(
      'Сброс не сохранён',
      'Браузер отклонил запись в хранилище — после перезагрузки правки вернутся'
    )
  }
  canvas.markDirty()
  await syncInstancesAndReport(base.id, prev, 'Символ возвращён к набору')
  ui.closeStencilEditor()
}

/**
 * Расставленные экземпляры — к новой версии символа во ВСЕХ формах, с итогом в тосте.
 * Закрытые формы правятся сразу, а не при своём открытии: иначе провод, потерявший порт,
 * отваливался через дни и без связи с этой правкой.
 */
async function syncInstancesAndReport(stencilId, prev, title) {
  // Идёт в теневом графе, живой холст не трогает (см. syncStencilInClosedForms).
  const closed = await canvas.syncStencilInClosedForms(stencilId, prev)
  // Экземпляры на холсте подтягивают новую версию символа целиком (рисунок, порты,
  // габарит) одной операцией — значит один шаг undo.
  const { changed, detached } = syncStencilInstances(
    canvas.graphRef.value,
    canvas.paperRef.value,
    getStencilById(stencilId),
    prev
  )
  canvas.bumpVersion()
  if (changed || detached.length) canvas.requestSnapshot()
  // Отцепленные концы выделяются: иначе их пришлось бы искать по схеме глазами.
  if (detached.length) canvas.setSelection(detached.map((id) => ({ kind: 'link', id })))
  const what = []
  const total = changed + closed.changed
  if (total) what.push(`обновлено ${nplural(total, 'символ', 'символа', 'символов')}`)
  // Активную считаем, только если правка её задела: символ мог стоять лишь в закрытых.
  const forms = closed.forms + (changed ? 1 : 0)
  if (forms > 1) what.push(`на ${nplural(forms, 'форме', 'формах', 'формах')}`)
  const detachedTotal = detached.length + closed.detached
  if (detachedTotal) {
    what.push(`отцеплено ${nplural(detachedTotal, 'провод', 'провода', 'проводов')}`)
  }
  // Отцепленный провод — потеря соединения, поэтому warn, а не success. На активной
  // форме концы выделены, на остальных их придётся искать — об этом и говорим.
  const detail = what.length ? what.join(', ') : stencilId
  if (detachedTotal) {
    const where = closed.detached
      ? ' — порт удалён, проверь другие формы'
      : ' — порт удалён, перецепи'
    notify.warn(title, detail + where)
  } else notify.success(title, detail)
}

// ─── Масштаб стола ───
const stageEl = ref(null)
const svgEl = ref(null)
const { stageW, stageH, scale, pxW, pxH, zoomPercent, zoomIn, zoomOut, fitView } = useEditorZoom({
  stageEl,
  svgEl,
  meta,
})
// Нажатие по столу снимает фокус с поля инспектора, как на холсте.
useBlurOnPress(stageEl)
// Ручки константного размера на экране (в user-единицах = px/scale).
const hr = computed(() => 4 / scale.value)
// Запас hit-обводки фигуры — 8 экранных px (в user-координатах, отсюда деление).
const hitWidth = computed(() => 8 / scale.value)
// Порт — в МОДЕЛЬНЫХ единицах, как на холсте: автор видит вывод той величины, что
// получит на схеме.
const PORT_R = 1.5
// Обводка порта тоже модельная, без non-scaling-stroke: на холсте она масштабируется
// зумом вместе с кружком.
const PORT_STROKE = 0.5

// ─── Сетка ───
// Один паттерн (линии тайла — utils/editorRulers), браузер тиражирует его сам. Толщина
// — 1 экранный px в user-единицах: `vector-effect` внутри паттерна не работает.
const GRID_PATTERN_ID = 'tms-se-grid'
const GRID_LINES = gridPatternLines()
const gridStroke = computed(() => 1 / scale.value)

// Расширенная сетка: та же сетка продолжается за границы символа в нередактируемую
// зону. Отступ — видимая область вокруг карточки в user-единицах, при скролле и
// большом символе она вырождается в 0.
const gridPadX = computed(() =>
  Math.max(0, Math.ceil((stageW.value - pxW.value) / 2 / scale.value))
)
const gridPadY = computed(() =>
  Math.max(0, Math.ceil((stageH.value - pxH.value) / 2 / scale.value))
)

// ─── Пиксель события → user-координаты символа ───
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
// Экранная позиция точки (0,0) SVG относительно stage с учётом центрирования и
// скролла: тик юнита u стоит в origin + u*scale. Origin — сдвиг ВСЕЙ группы делений
// (`transform`), сами деления от него не зависят и на скролле не пересобираются.
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
// Деления и подписи считает rulerTicks: major (÷10, с подписью), medium (÷5) и minor
// (1, только при достаточном зуме).
const rulerTicksX = computed(() => rulerTicks(meta.width, scale.value))
const rulerTicksY = computed(() => rulerTicks(meta.height, scale.value))
// Пересчёт при зуме, ресайзе и смене размера — после DOM-патча (flush: post); скролл
// холста приходит через @scroll в шаблоне.
watch([pxW, pxH, stageW, stageH], updateRuler, { flush: 'post' })

// ─── Рисование жестами (rect/line/circle — drag, polyline — клики) ───
const {
  drawing,
  draftRect,
  draftEllipse,
  polyPreview,
  onDrawDown,
  onStageMove,
  finishPolyline,
  cancelDraw,
} = useEditorDraw({ ed, scale, unitsFromEvent, snappedShape })

// Клик по фигуре: Ctrl/Cmd — добавить или убрать из выделения, иначе выделить одну.
// Перемещение пачки стартует в useEditorInteract.
function onShapeSelect(id, e) {
  if (tool.value !== 'select') return
  if (e?.ctrlKey || e?.metaKey) toggleSelect(id)
  else if (!selectedSet.value.has(id)) select(id)
}

// ─── Лассо (рамка выделения по пустому месту) ───
/**
 * Старт рамки слушается на всей области просмотра, а не на SVG: у фигуры, прижатой к
 * краю холста, пустого места внутри нет. За границами viewBox координаты выходят за
 * 0..W/H — для рамки это нормально, в модель они не пишутся.
 */
function onStageDown(e) {
  if (e.button !== 0) return
  // Кнопки поворота и отражения лежат НАД stage: без гейта их pointerdown читается как
  // клик по пустому месту и снимает выделение раньше, чем сработает @click.
  if (e.target.closest('[data-se-overlay]')) return
  if (tool.value !== 'select') {
    onDrawDown(e)
    return
  }
  // Клик по фигуре, ручке или порту — их собственный жест (useEditorInteract).
  if (e.target.closest('[data-se-move]')) return
  startLasso(e)
}

const { lassoRect, startLasso } = useEditorLasso({
  shapes,
  unitsFromEvent,
  onSelect: (ids, additive) => selectMany(ids, additive),
  onClear: () => select(null),
})

// Рамка вокруг всего выделения при N>1: у фигур halo своё, но общий габарит
// показывает, что drag и Delete применятся ко всей пачке. При одной фигуре не нужна —
// там есть halo и ручки.
/** Габарит выделения в user-координатах — общий якорь рамки и overlay-кнопок. */
const selectedBounds = computed(() =>
  shapesBounds(shapes.value.filter((s) => selectedSet.value.has(s.id)))
)
const selectionBox = computed(() => (selectedIds.value.length < 2 ? null : selectedBounds.value))

// ─── Ручки выделенной фигуры ───
// Только при ОДНОЙ выделенной (selectedId при N>1 — null): группового ресайза по общему
// bbox нет, а ручки одной фигуры посреди пачки врут.
const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null)
// Толщина halo — обводка САМОЙ фигуры плюс запас в несколько экранных px, поэтому
// считается пофигурно: с общим значением у тонкой линии halo раздувается в полосу, а у
// толстой прячется под её же обводкой.
const haloWidthFor = (s) => (s.strokeWidth || 2) + 4 / scale.value
/** Стиль порта: выделение красит обводку, курсор зависит от активного инструмента. */
function portStyle(id) {
  return {
    ...(selectedPortSet.value.has(id) ? { stroke: SEL_STROKE } : {}),
    cursor: tool.value === 'port' ? 'pointer' : 'move',
  }
}

/**
 * Курсор ручки по ключу: угол габарита — диагональ растягивания, полуось эллипса —
 * своя ось, вершина линии/ломаной — перемещение точки.
 */
function handleCursor(key) {
  if (key === 'nw' || key === 'se') return 'nwse-resize'
  if (key === 'ne' || key === 'sw') return 'nesw-resize'
  if (key === 'rx') return 'ew-resize'
  if (key === 'ry') return 'ns-resize'
  return 'move'
}

const handles = computed(() => {
  const s = selectedShape.value
  if (!s || shapesLocked) return []
  if (s.type === 'rect') {
    return [
      { h: 'nw', x: s.x, y: s.y },
      { h: 'ne', x: s.x + s.w, y: s.y },
      { h: 'sw', x: s.x, y: s.y + s.h },
      { h: 'se', x: s.x + s.w, y: s.y + s.h },
    ]
  }
  if (s.type === 'circle') {
    // Две ручки: правая тянет rx, нижняя — ry (с Shift обе, см. useEditorInteract).
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

// ─── Перемещение фигур и портов, ресайз ручками ───
useEditorInteract({ ed, unitsFromEvent, locked: shapesLocked })

/**
 * Клик по порту ВЫДЕЛЯЕТ его (Ctrl/Cmd — добавляет к выделению), удаляет `Del`, как у
 * фигур. Всплытие НЕ гасим: useEditorInteract слушает pointerdown на документе, и с
 * `stopPropagation` перетаскивание порта не стартует. Чужие обработчики порт
 * пропускают сами — по `[data-se-move="port"]` и `[data-se-move]`.
 */
function onPortDown(e, id) {
  // Порты символа из набора не двигаются и не удаляются — выделять их незачем.
  if (shapesLocked) return
  const additive = e.ctrlKey || e.metaKey
  // Клик по порту ИЗ выделения набор не трогает (как у фигур): схлопнув группу здесь,
  // до старта переноса, групповой drag тащил бы один порт.
  if (!additive && selectedPortSet.value.has(id)) return
  selectPort(id, additive)
}

useEditorHotkeys({
  ed,
  stageEl,
  locked: shapesLocked,
  animationOnly,
  toolKeys: TOOL_KEYS,
  pickTool,
  zoomIn,
  zoomOut,
  fitView,
  cancelDraw,
  save,
  requestClose,
  rotateSelected,
  flipSelected,
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
  // Поворот, отражение и удаление правят рисунок — у символа из набора их нет.
  if (!selectedIds.value.length || tool.value !== 'select' || shapesLocked) return null
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

// Гейт держим здесь, а не только в разметке: через него проходят и кнопка, и хоткей —
// иначе клавиша делала бы «преобразование», которого не видно.
function rotateSelected(dir) {
  if (!canRotateSel.value) return
  ed.rotateShapes(selectedIds.value, dir < 0 ? -1 : 1)
}
function flipSelected(axis) {
  if (!(axis === 'h' ? canFlipSelH.value : canFlipSelV.value)) return
  ed.flipShapes(selectedIds.value, axis)
}

// ПКМ по фигуре: порядок наложения и удаление — те же операции, что в меню холста.
// Поворот и отражение сюда не входят: у них кнопки над выделением и клавиши (R,
// Shift+H/V). Клик по невыделенной фигуре сначала выделяет её (как на холсте), поэтому
// команда всегда работает с тем, на что нажали.
const ctxMenu = ref(null)
const ctxItems = [
  {
    label: 'Порядок',
    icon: 'pi pi-sort-alt',
    items: [
      {
        label: 'На передний план',
        icon: 'pi pi-angle-double-up',
        shortcut: 'Ctrl+Shift+]',
        command: () => order('front'),
      },
      {
        label: 'Выше',
        icon: 'pi pi-angle-up',
        shortcut: 'Ctrl+]',
        command: () => order('forward'),
      },
      {
        label: 'Ниже',
        icon: 'pi pi-angle-down',
        shortcut: 'Ctrl+[',
        command: () => order('backward'),
      },
      {
        label: 'На задний план',
        icon: 'pi pi-angle-double-down',
        shortcut: 'Ctrl+Shift+[',
        command: () => order('back'),
      },
    ],
  },
  { separator: true },
  {
    label: 'Удалить',
    icon: 'pi pi-trash',
    shortcut: 'Del',
    command: () => removeShapes(selectedIds.value),
  },
]

function order(mode) {
  ed.reorderShapes(selectedIds.value, mode)
}

function onShapeContextMenu(event) {
  const el = event.target.closest('[data-se-move="shape"]')
  const id = el?.dataset?.id
  if (!id) return
  event.preventDefault()
  // Все пункты меню правят рисунок, а у символа набора его задаёт набор. Del, R и
  // Ctrl+[ ] там гасит тот же `shapesLocked` — меню не должно быть обходом.
  if (shapesLocked) return
  if (!selectedSet.value.has(id)) select(id)
  ctxMenu.value?.show(event)
}

onMounted(updateRuler)
</script>

<template>
  <!-- `relative` на корне НЕ ставить: оверлею с места использования приходит
       `absolute inset-0`, а в Tailwind `.relative` объявлен позже `.absolute` и
       перебил бы его — редактор выпал бы из позиционирования. -->
  <div v-bind="$attrs" class="flex flex-col bg-surface-0">
    <!-- Сохранение и закрытие — в шапке инспектора «Символ»: это действия над символом
         целиком, там же автор заполняет его поля. В тулбаре они читались как ещё одна
         кнопка рисования, а поверх стола закрывали рисунок. Места в шапке мало, поэтому
         все три — иконками с подсказкой. «Сохранить» залита цветом, только когда есть
         правки, — по ней видно несохранённое (тот же `isDirty`, которым закрытие
         решает, переспрашивать ли). -->
    <Teleport to="#tms-editor-actions" defer>
      <!-- Только у символа набора с правками проекта: возвращает поставочный вид. -->
      <Button
        v-if="canResetToPreset"
        v-tooltip.bottom="'Сбросить к набору'"
        icon="pi pi-replay"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        @click="confirmResetToPreset"
      />
      <Button
        v-tooltip.bottom="'Сохранить · Ctrl+S'"
        icon="pi pi-save"
        size="small"
        :severity="isDirty ? 'primary' : 'secondary'"
        :text="!isDirty"
        class="tms-icon-btn"
        @click="save"
      />
      <Button
        ref="closeBtn"
        v-tooltip.bottom="'Закрыть · Esc'"
        icon="pi pi-times"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        @click="requestClose"
      />
    </Teleport>
    <!-- Тулбар -->
    <!-- Поля и высота — как в тулбаре холста (min-h-14, px-4): тулбары стоят один под
         другим при открытии редактора, и разный отступ у крайних кнопок бросался в
         глаза. -->
    <div class="flex min-h-14 items-center gap-2 border-b border-surface-200 px-4">
      <!-- Ширина фиксирована: от длины заголовка зависело, откуда начинается ряд
         инструментов. У режима зон инструментов нет, там заголовок занимает место по
         тексту. -->
      <h2
        class="text-sm font-semibold uppercase tracking-wide text-surface-900"
        :class="shapesLocked ? '' : 'w-[75px] shrink-0 truncate'"
      >
        {{ rangesOnly ? 'Диапазоны символа' : animationOnly ? 'Анимации символа' : 'Редактор' }}
      </h2>
      <!-- Инструменты рисования, размер и удаление — только у рисуемого символа; у
           программного (шина) правятся лишь зоны, у символа из набора — анимации. -->
      <template v-if="!shapesLocked">
        <!-- Инструменты рисования (тогл). Отдельной кнопки «выбор» нет: select —
           фоновый дефолт (повторный клик по активному инструменту или авто после
           добавления фигуры возвращают к нему). -->
        <div class="flex items-center gap-1">
          <!-- Номер в тултипе = клавиша инструмента (TOOL_KEYS). -->
          <Button
            v-for="(t, i) in DRAW_TOOLS"
            :key="t.key"
            v-tooltip.bottom="`${t.tip} · ${i + 1}`"
            :icon="t.icon"
            :severity="tool === t.key ? 'primary' : 'secondary'"
            :text="tool !== t.key"
            size="small"
            class="tms-icon-btn"
            @click="pickTool(t.key)"
          >
            <template v-if="t.glyph" #icon>
              <GlyphIcon :glyph="t.glyph" />
            </template>
          </Button>
        </div>

        <Divider layout="vertical" class="tms-toolbar-divider" />

        <!-- Порт — не рисунок, а точка подключения провода, поэтому своей группой. -->
        <Button
          v-tooltip.bottom="`${PORT_TOOL.tip} · ${TOOL_KEYS.length}`"
          :icon="PORT_TOOL.icon"
          :severity="tool === PORT_TOOL.key ? 'primary' : 'secondary'"
          :text="tool !== PORT_TOOL.key"
          size="small"
          class="tms-icon-btn"
          @click="pickTool(PORT_TOOL.key)"
        />

        <Divider layout="vertical" class="tms-toolbar-divider" />

        <!-- Размер символа (словом «холст» в UI зовётся холст СХЕМЫ). Меняется только
           шагом сетки портов: вручную набранная 31 всё равно снапится, и автор видел
           бы «обрезание» без объяснений. На сохранении контент обрезается до bbox
           (cropToContent), поэтому итог может отличаться и от заданного размера. -->
        <div class="flex items-center gap-1.5 text-xs text-surface-500">
          <span>Символ</span>
          <InputNumber
            v-tooltip.bottom="`Ширина символа, шаг ${BOX_GRID}`"
            :model-value="meta.width"
            :min="BOX_GRID"
            :step="BOX_GRID"
            show-buttons
            button-layout="horizontal"
            size="small"
            input-class="w-10! text-center pointer-events-none select-none"
            @update:model-value="setSize('width', $event)"
            @keydown="blockSizeTyping"
            @paste.prevent
          />
          <span class="text-surface-400">×</span>
          <InputNumber
            v-tooltip.bottom="`Высота символа, шаг ${BOX_GRID}`"
            :model-value="meta.height"
            :min="BOX_GRID"
            :step="BOX_GRID"
            show-buttons
            button-layout="horizontal"
            size="small"
            input-class="w-10! text-center pointer-events-none select-none"
            @update:model-value="setSize('height', $event)"
            @keydown="blockSizeTyping"
            @paste.prevent
          />
          <!-- Подпись к подсветке на столе: показывает, во что размер превратится на
             сохранении, пока автор не уберёт выступающие фигуры. -->
          <span
            v-if="contentOverflow && savedBox"
            v-tooltip.bottom="
              'Фигуры выходят за границу: такой размер символ получит при сохранении'
            "
            class="flex items-center gap-1 font-medium"
            :style="{ color: OVERFLOW_STROKE }"
          >
            <i class="pi pi-exclamation-triangle text-xs" />
            {{ savedBox.w }}×{{ savedBox.h }}
          </span>
        </div>
      </template>

      <!-- Инструменты рисования и размер прижаты влево, история │ вид — к правому краю,
         как в тулбаре холста. -->
      <div class="flex-1"></div>

      <Button
        v-tooltip.bottom="'Отменить · Ctrl+Z'"
        icon="pi pi-undo"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        :disabled="!canUndo"
        @click="undo"
      />
      <Button
        v-tooltip.bottom="'Повторить · Ctrl+Y'"
        icon="pi pi-undo -scale-x-100"
        severity="secondary"
        text
        size="small"
        class="tms-icon-btn"
        :disabled="!canRedo"
        @click="redo"
      />

      <Divider v-if="!rangesOnly" layout="vertical" class="tms-toolbar-divider" />

      <!-- Зум стола — та же группа и то же место, что на холсте схемы (история │ вид │
         удаление): ±, центр показывает масштаб и по клику вписывает символ. -->
      <div v-if="!rangesOnly" class="flex items-center">
        <Button
          v-tooltip.bottom="'Уменьшить · Ctrl+−'"
          icon="pi pi-minus"
          severity="secondary"
          text
          size="small"
          class="tms-icon-btn"
          :disabled="scale <= MIN_SCALE"
          @click="zoomOut"
        />
        <Button
          v-tooltip.bottom="'Вписать символ · Ctrl+0; зум — Ctrl+колесо'"
          :label="`${zoomPercent}%`"
          severity="secondary"
          text
          size="small"
          class="font-mono! min-w-[3.25rem]! justify-center!"
          @click="fitView"
        />
        <Button
          v-tooltip.bottom="'Увеличить · Ctrl+='"
          icon="pi pi-plus"
          severity="secondary"
          text
          size="small"
          class="tms-icon-btn"
          :disabled="scale >= MAX_SCALE"
          @click="zoomIn"
        />
      </div>
    </div>

    <!-- Программный символ: вместо стола — его рисунок и пояснение, что правится. -->
    <div
      v-if="rangesOnly"
      class="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 bg-surface-100 p-8 text-center"
    >
      <div
        class="flex h-24 w-64 items-center justify-center rounded border border-surface-200 bg-white p-3 [&>svg]:h-full [&>svg]:w-full"
        v-html="editTarget.svgText"
      ></div>
      <div class="max-w-md text-xs leading-relaxed text-surface-500">
        <div class="mb-1 text-sm font-medium text-surface-700">{{ editTarget.label }}</div>
        Программный символ: тело и порты задаёт код, рисунок здесь не правится. В этом режиме
        редактируются только диапазоны значений (в панели справа); тег к ним привязывается на холсте
        у каждого экземпляра.
      </div>
    </div>
    <!-- Холст с линейками по краям -->
    <div v-else class="flex flex-1 min-h-0 flex-col">
      <!-- Символ из набора: стол нужен, чтобы выделять фигуры и раздавать им состояния,
           но рисунок принадлежит набору. Полоска объясняет, почему инструменты пропали. -->
      <div
        v-if="animationOnly"
        class="flex shrink-0 items-center gap-2 border-b border-surface-200 bg-surface-100 px-3 py-1.5 text-xs text-surface-600"
      >
        <i class="pi pi-box text-surface-400" />
        <span>
          Символ из набора «{{ presetInfo.name }}» {{ presetInfo.version }}: правятся анимации —
          состояния, диапазоны и видимость фигур. Рисунок, порты и размер задаёт набор.
        </span>
      </div>
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
            <g :transform="`translate(${originX} 0)`">
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
            </g>
          </svg>
        </div>
      </div>
      <!-- Левая линейка (Y) + холст -->
      <div class="relative flex flex-1 min-h-0">
        <!-- Превью состояния выбирается в СТРОКЕ состояния (StencilAnimationFields): «какая
             строка ↔ что видно на столе» — одна и та же вещь, отдельный контрол над
             столом эту связь разрывал. Плашка-напоминание висит, пока превью включено:
             иначе «часть фигур пропала» читается как баг. -->
        <div
          v-if="meta.stateful && previewState !== 'all'"
          class="absolute top-2 z-10 flex items-center gap-2 rounded border border-primary-200 bg-primary-50/90 px-2 py-1 text-xs text-primary-700 shadow-sm backdrop-blur-sm"
          :style="{ left: `${RULER + 8}px` }"
        >
          <i class="pi pi-eye text-[11px]!" />
          <span>Превью: {{ previewLabel }}</span>
          <button
            type="button"
            v-tooltip.bottom="'Показать все фигуры'"
            class="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-primary-400 hover:text-primary-700"
            @click="previewState = 'all'"
          >
            <i class="pi pi-times text-[10px]!" />
          </button>
        </div>
        <div
          class="shrink-0 overflow-hidden border-r border-surface-200 bg-surface-0"
          :style="{ width: `${RULER}px` }"
        >
          <svg :width="RULER" :height="stageH" class="block">
            <g :transform="`translate(0 ${originY})`">
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
            </g>
          </svg>
        </div>
        <!-- select-none: стол — рисунок, а не текст. Без запрета протяжка рамкой или
           новым примитивом поверх подписи выделяет её глифы, и жест превращается в
           «синее выделение» вместо фигуры. -->
        <div
          ref="stageEl"
          data-se-stage
          class="flex flex-1 items-center justify-center overflow-auto bg-surface-100 select-none"
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
              <!-- Сетка — один паттерн с тайлом GRID_PERIOD (userSpaceOnUse: тайлы
                 привязаны к началу координат символа, в том числе за его границами). -->
              <defs>
                <pattern
                  :id="GRID_PATTERN_ID"
                  patternUnits="userSpaceOnUse"
                  :width="GRID_PERIOD"
                  :height="GRID_PERIOD"
                >
                  <template v-for="l in GRID_LINES" :key="l.p">
                    <line
                      :x1="l.p"
                      y1="0"
                      :x2="l.p"
                      :y2="GRID_PERIOD"
                      :stroke="l.color"
                      :stroke-width="gridStroke"
                    />
                    <line
                      x1="0"
                      :y1="l.p"
                      :x2="GRID_PERIOD"
                      :y2="l.p"
                      :stroke="l.color"
                      :stroke-width="gridStroke"
                    />
                  </template>
                </pattern>
              </defs>
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
                <rect
                  :x="-gridPadX"
                  :y="-gridPadY"
                  :width="meta.width + gridPadX * 2"
                  :height="meta.height + gridPadY * 2"
                  :fill="`url(#${GRID_PATTERN_ID})`"
                />
              </g>
              <!-- Сетка символа шире его на толщину линии: иначе крайние линии (0 и
                 W/H) обрезались бы пополам по границе прямоугольника. -->
              <g pointer-events="none">
                <rect x="0" y="0" :width="meta.width" :height="meta.height" fill="#fff" />
                <rect
                  :x="-gridStroke / 2"
                  :y="-gridStroke / 2"
                  :width="meta.width + gridStroke"
                  :height="meta.height + gridStroke"
                  :fill="`url(#${GRID_PATTERN_ID})`"
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
                :cursor="tool === 'select' ? 'move' : null"
                :hit-width="hitWidth"
                :mark-stroke="markStrokeFor(s)"
                :mark-width="haloWidthFor(s)"
                :mark-dash="3 / scale"
                @select="onShapeSelect(s.id, $event)"
              />

              <!-- Выступ за границу символа: штрих по чернилам фигур (маска), обрезанный
                 областью ВНЕ холста, и пунктир по габариту, до которого символ
                 раздуется на сохранении. -->
              <template v-if="contentOverflow">
                <defs>
                  <clipPath :id="OVERFLOW_CLIP_ID">
                    <path :d="overflowClip" clip-rule="evenodd" />
                  </clipPath>
                  <pattern
                    :id="OVERFLOW_HATCH_ID"
                    patternUnits="userSpaceOnUse"
                    :width="hatchStep"
                    :height="hatchStep"
                    patternTransform="rotate(45)"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      :y2="hatchStep"
                      :stroke="OVERFLOW_STROKE"
                      :stroke-width="hatchStep / 3.5"
                    />
                  </pattern>
                  <!-- Область маски задаём явно: по умолчанию она равна 120% viewport'а,
                     а выступ лежит как раз ЗА ним и обрезался бы. -->
                  <mask
                    :id="OVERFLOW_MASK_ID"
                    maskUnits="userSpaceOnUse"
                    :x="overflowArea.x"
                    :y="overflowArea.y"
                    :width="overflowArea.w"
                    :height="overflowArea.h"
                  >
                    <ShapePrimitive
                      v-for="s in overflowMaskShapes"
                      :key="`ovm${s.id}`"
                      :shape="s"
                      decorative
                    />
                  </mask>
                </defs>
                <rect
                  pointer-events="none"
                  :clip-path="`url(#${OVERFLOW_CLIP_ID})`"
                  :mask="`url(#${OVERFLOW_MASK_ID})`"
                  :x="overflowArea.x"
                  :y="overflowArea.y"
                  :width="overflowArea.w"
                  :height="overflowArea.h"
                  :fill="`url(#${OVERFLOW_HATCH_ID})`"
                />
                <rect
                  pointer-events="none"
                  :x="contentOverflow.x"
                  :y="contentOverflow.y"
                  :width="contentOverflow.w"
                  :height="contentOverflow.h"
                  fill="none"
                  :stroke="OVERFLOW_STROKE"
                  stroke-width="1"
                  stroke-dasharray="4 3"
                  vector-effect="non-scaling-stroke"
                />
              </template>

              <!-- Подписи состояний — отдельным слоем поверх фигур: сама пометка
                   (пунктир по контуру) живёт в ShapePrimitive, здесь только ключ, и он
                   не должен уходить под соседние фигуры. -->
              <text
                v-for="l in stateLabels"
                :key="`sl${l.id}`"
                pointer-events="none"
                :x="l.x"
                :y="l.y - 3 / scale"
                :font-size="10 / scale"
                font-family="monospace"
                :fill="STATE_MARK_STROKE"
              >
                {{ l.label }}
              </text>

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

              <!-- Ручки выделенной фигуры: вид как у ручек габарита на холсте
                   (залитый primary круг в белой рамке), курсор — по роли ручки. -->
              <circle
                v-for="hnd in handles"
                :key="`${selectedId}-${hnd.h}`"
                data-se-move="handle"
                :data-id="selectedId"
                :data-h="hnd.h"
                :cx="hnd.x"
                :cy="hnd.y"
                :r="hr"
                stroke="#fff"
                :style="{ fill: SEL_STROKE, cursor: handleCursor(hnd.h) }"
                stroke-width="1.5"
                vector-effect="non-scaling-stroke"
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
                :style="portStyle(p.id)"
                stroke="#000000"
                :stroke-width="PORT_STROKE"
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
                severity="secondary"
                rounded
                size="small"
                data-se-overlay="1"
                class="tms-overlay-btn"
                :style="shapeOverlay.rotateCcw"
                @click="rotateSelected(-1)"
              >
                <template #icon><GlyphIcon :glyph="ROTATE_ICON" mirror /></template>
              </Button>
              <Button
                v-if="shapeOverlay.canRotate"
                v-tooltip.top="'Повернуть по часовой · R'"
                severity="secondary"
                rounded
                size="small"
                data-se-overlay="1"
                class="tms-overlay-btn"
                :style="shapeOverlay.rotateCw"
                @click="rotateSelected(1)"
              >
                <template #icon><GlyphIcon :glyph="ROTATE_ICON" /></template>
              </Button>
              <Button
                v-if="shapeOverlay.canFlipH"
                v-tooltip.top="'Отразить по горизонтали · Shift+H'"
                icon="pi pi-arrows-h"
                severity="secondary"
                rounded
                size="small"
                data-se-overlay="1"
                class="tms-overlay-btn"
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
                class="tms-overlay-btn"
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
                class="tms-overlay-btn"
                :style="shapeOverlay.delete"
                @click="removeShapes(selectedIds)"
              />
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ПКМ по фигуре: порядок наложения + удаление (как в меню холста). -->
    <ContextMenu ref="ctxMenu" :model="ctxItems">
      <template #item="{ item, props, hasSubmenu }">
        <ContextMenuItem :item="item" :bind="props" :has-submenu="hasSubmenu" />
      </template>
    </ContextMenu>
  </div>
</template>
