<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import AutoComplete from 'primevue/autocomplete'
import ToggleSwitch from 'primevue/toggleswitch'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import {
  useAnimationClipboard,
  applyStateClip,
  applyDepsClip,
  applyRangeClip,
  applyValueClip,
} from '../composables/useAnimationClipboard'
import { useAlign } from '../composables/useAlign'
import { useBoolGroups } from '../composables/useBoolGroups'
import { useValueRanges } from '../composables/useValueRanges'
import { ALIGN_OPTIONS, BOLD_OPTIONS, TEXT_FONT_SIZE } from '../constants/text'
import { useNavigationField } from '../composables/useNavigationField'
import { useProjectStore } from '../stores/useProjectStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { getStencilById, stateSlotOf, textSlotOf } from '../stencils/registry'
import { injectStencilSvg } from '../stencils/svgInjector'
import { isShapeCell, shapeTypeLabel, applyShapePatch } from '../stencils/shapeElement'
import { BUS_COLOR_DEFAULT, BUS_THICKNESS_MAX, setBusThickness } from '../stencils/busCell'
import { NODE_SIZE_DEFAULT, NODE_SIZE_MAX } from '../stencils/nodeCell'
import { nplural } from '../utils/plural'
import { normalizeBoolSource } from '../utils/boolSource'
import { normalizeFont } from '../utils/textMetrics'
import { toPlain } from '../utils/plain'
import { isBooleanType } from '../services/parsers'
import TagPickerDialog from './TagPickerDialog.vue'
import RangeBlock from './RangeBlock.vue'
import StateBlock from './StateBlock.vue'
import DependencyBlock from './DependencyBlock.vue'
import WireStyleFields from './WireStyleFields.vue'
import ShapeBlock from './ShapeBlock.vue'
import ValueBlock from './ValueBlock.vue'
import AlignBlock from './AlignBlock.vue'
import BodyStyleFields from './BodyStyleFields.vue'
import { previewOuterKey } from '../constants/ids'
import {
  isDefaultWireValue,
  syncLinkEndMarkers,
  WIRE_STYLE_DEFAULTS,
} from '../stencils/linkDefaults'

// Ячейки без анимаций: статичные символы (`static: true` в stencil.json) и
// фигуры-разметка. Диапазоны и булев источник к ним не применяются.
function isStatic(tms) {
  return !!tms?.shape || !!getStencilById(tms?.stencilId)?.static
}

/**
 * Ключ слота-драйвера символа по его payload: `onoff` у булевых, `value` у «по
 * значению», null у элементов без слотов (провод, шина, фигура-разметка). Нужен там, где символ
 * известен только через tms — вставка буфера и массовая привязка.
 */
function stateSlotKeyOf(tms) {
  return stateSlotOf(getStencilById(tms?.stencilId)?.slots)?.key || null
}

const canvas = useCanvas()
const animClip = useAnimationClipboard()
// Выравнивание + распределение выделенных ячеек (секция «Выравнивание» в мульти-режиме).
const { canAlign, canDistribute, alignCells, distributeCells } = useAlign()

// Тулбар выравнивания и распределения (мульти-режим): кнопки отличаются подсказкой,
// операцией и координатами прямоугольников иконки (viewBox 16×16), поэтому заданы
// конфигом. В rects — ось выравнивания и два «элемента» (o:0.8), у распределения три
// равных столбца.
const ALIGN_ROWS = [
  {
    label: 'По горизонтали',
    kind: 'align',
    buttons: [
      {
        op: 'left',
        tip: 'По левому краю',
        rects: [
          { x: 1, y: 2, w: 1.4, h: 12, rx: 0.5 },
          { x: 3.4, y: 4, w: 9, h: 3, rx: 1, o: 0.8 },
          { x: 3.4, y: 9, w: 5.5, h: 3, rx: 1, o: 0.8 },
        ],
      },
      {
        op: 'centerX',
        tip: 'По центру (горизонт.)',
        rects: [
          { x: 7.3, y: 2, w: 1.4, h: 12, rx: 0.5 },
          { x: 3.5, y: 4, w: 9, h: 3, rx: 1, o: 0.8 },
          { x: 5.25, y: 9, w: 5.5, h: 3, rx: 1, o: 0.8 },
        ],
      },
      {
        op: 'right',
        tip: 'По правому краю',
        rects: [
          { x: 13.2, y: 2, w: 1.4, h: 12, rx: 0.5 },
          { x: 4.2, y: 4, w: 9, h: 3, rx: 1, o: 0.8 },
          { x: 7.7, y: 9, w: 5.5, h: 3, rx: 1, o: 0.8 },
        ],
      },
    ],
  },
  {
    label: 'По вертикали',
    kind: 'align',
    buttons: [
      {
        op: 'top',
        tip: 'По верхнему краю',
        rects: [
          { x: 2, y: 1, w: 12, h: 1.4, rx: 0.5 },
          { x: 4, y: 3.4, w: 3, h: 9, rx: 1, o: 0.8 },
          { x: 9, y: 3.4, w: 3, h: 5.5, rx: 1, o: 0.8 },
        ],
      },
      {
        op: 'centerY',
        tip: 'По центру (вертик.)',
        rects: [
          { x: 2, y: 7.3, w: 12, h: 1.4, rx: 0.5 },
          { x: 4, y: 3.5, w: 3, h: 9, rx: 1, o: 0.8 },
          { x: 9, y: 5.25, w: 3, h: 5.5, rx: 1, o: 0.8 },
        ],
      },
      {
        op: 'bottom',
        tip: 'По нижнему краю',
        rects: [
          { x: 2, y: 13.2, w: 12, h: 1.4, rx: 0.5 },
          { x: 4, y: 4.2, w: 3, h: 9, rx: 1, o: 0.8 },
          { x: 9, y: 7.7, w: 3, h: 5.5, rx: 1, o: 0.8 },
        ],
      },
    ],
  },
  {
    // Распределение: равные интервалы. Нужно ≥3 ячеек (иначе disabled).
    label: 'Распределение',
    kind: 'distribute',
    buttons: [
      {
        op: 'x',
        tip: 'Распределить по горизонтали (равные интервалы)',
        rects: [
          { x: 2, y: 3, w: 2.6, h: 10, rx: 0.8 },
          { x: 6.7, y: 3, w: 2.6, h: 10, rx: 0.8 },
          { x: 11.4, y: 3, w: 2.6, h: 10, rx: 0.8 },
        ],
      },
      {
        op: 'y',
        tip: 'Распределить по вертикали (равные интервалы)',
        rects: [
          { x: 3, y: 2, w: 10, h: 2.6, rx: 0.8 },
          { x: 3, y: 6.7, w: 10, h: 2.6, rx: 0.8 },
          { x: 3, y: 11.4, w: 10, h: 2.6, rx: 0.8 },
        ],
      },
    ],
  },
]
const project = useProjectStore()
const workspace = useWorkspaceStore()
const notify = useNotify()

// Computed'ы читают canvas.graphVersion: JointJS-модели не Vue-reactive, изменения
// ловятся явным version-тиком.
const details = computed(() => {
  canvas.graphVersion.value // touch для reactive-зависимости
  const sel = canvas.singleSelection.value // мульти-режим обрабатывается отдельно
  const graph = canvas.graphRef.value
  if (!sel || !graph) return null
  const cell = graph.getCell(sel.id)
  if (!cell) return null

  if (sel.kind === 'cell' && isShapeCell(cell)) {
    // Фигура-разметка: ни символа, ни портов, ни анимаций — только вид и содержимое
    // подписи. Геометрия правится жестами на холсте.
    const shape = cell.get('tms')?.shape || {}
    return {
      kind: 'cell',
      id: cell.id,
      isShape: true,
      shapeType: shape.type,
      shapeLabel: shapeTypeLabel(shape),
      locked: !!cell.get('tms')?.locked,
      stroke: shape.stroke || '#000000',
      strokeWidth: shape.strokeWidth ?? 2,
      // У линии и подписи заливки нет (у подписи цвет живёт в stroke).
      isShapeFillable: shape.type !== 'line' && shape.type !== 'text',
      fill: shape.fill && shape.fill !== 'none' ? shape.fill : '',
      isShapeText: shape.type === 'text',
      text: shape.text ?? '',
      fontSize: shape.fontSize ?? TEXT_FONT_SIZE,
      bold: !!shape.bold,
      fontFamily: normalizeFont(shape.fontFamily),
      shapeAlign: shape.align || 'center',
    }
  }

  if (sel.kind === 'cell') {
    const tms = cell.get('tms') || {}
    const stencil = tms.stencilId ? getStencilById(tms.stencilId) : null
    const slotsDef = stencil?.slots || []
    const slotValues = tms.slots || {}

    return {
      kind: 'cell',
      id: cell.id,
      stencilId: tms.stencilId,
      stencilLabel: stencil?.label || tms.stencilId || '-',
      locked: !!tms.locked,
      color: tms.color || '',
      isBus: tms.stencilId === 'cell_bus',
      isNode: tms.stencilId === 'cell_node',
      // Толщина: у шины это высота ячейки, у точки — диаметр в tms (габарит держит
      // hit-area и порт).
      thickness:
        tms.stencilId === 'cell_node'
          ? (tms.dotSize ?? NODE_SIZE_DEFAULT)
          : cell.get('size').height,
      thicknessMin: tms.stencilId === 'cell_node' ? NODE_SIZE_DEFAULT : (stencil?.height ?? 1),
      thicknessMax: tms.stencilId === 'cell_node' ? NODE_SIZE_MAX : BUS_THICKNESS_MAX,
      decimals: Number.isFinite(tms.decimals) ? tms.decimals : null,
      // id outer-карточки в animations.json/SVG (тот же, что эмитит exporter).
      exportId: previewOuterKey(tms.stencilId, cell.id),
      // Символ показывает значение тега подписью (слот Text) — у него есть точность.
      hasTextSlot: !!textSlotOf(slotsDef),
      // Состояния «по значению» из определения символа: показываем справкой в
      // StateBlock — коды значений тега иначе видны только в редакторе символов.
      states: (stencil?.states || []).map((s) => ({
        key: s.key,
        label: s.label || '',
        code: s.code ?? '',
      })),
      // Правимые подписи символа: подпись поля — текст из определения (он же
      // значение по умолчанию). Пустой по умолчанию подписи заголовок не рисуем —
      // называть её нечем, а выдуманное имя врало бы.
      params: (stencil?.params || []).map((p) => ({
        key: p.key,
        label: p.default || '',
        value: tms.params?.[p.key] ?? '',
      })),
      // Тег слота-драйвера (`onoff` либо `value`) — чтобы исключить его из зависимостей:
      // от собственного тега элемент зависеть не должен. Берётся из payload, а не по
      // индексу slots[0].
      stateTag: slotValues[stateSlotOf(slotsDef)?.key] || '',
      // Слоты для UI: декларация из символа плюс текущее значение из tms.slots.
      slots: slotsDef.map((s) => ({
        key: s.key,
        type: s.type,
        value: slotValues[s.key] || '',
      })),
      rangeSource: tms.rangeSource || null,
      boolSource: tms.boolSource || null,
      navigation: tms.navigation || '',
    }
  }

  if (sel.kind === 'link') {
    const tms = cell.get('tms') || {}
    return {
      kind: 'link',
      id: cell.id,
      // Толщина и цвет линии — из JointJS-attr, то есть реально отрисованные.
      strokeWidth: cell.attr('line/strokeWidth') ?? 2,
      strokeColor: cell.attr('line/stroke') || '#000000',
      arrowStart: cell.get('tms')?.arrowStart || null,
      arrowEnd: cell.get('tms')?.arrowEnd || null,
      rangeSource: tms.rangeSource || null,
      boolSource: tms.boolSource || null,
    }
  }

  return null
})

// Слот-драйвер состояния символа: единственный не-Text слот (`onoff` у булевых, `value`
// у «по значению»). Режим задан в определении символа, на холсте привязывают только тег —
// состояния и их вид запечены в символе.
const stateSlot = computed(() => {
  const d = details.value
  if (!d || d.kind !== 'cell') return null
  return stateSlotOf(d.slots)
})

// Слот подписи, показывающей значение тега: тег + точность, состояний у неё нет.
const valueTextSlot = computed(() => {
  const d = details.value
  if (!d || d.kind !== 'cell') return null
  return textSlotOf(d.slots)
})

// Копировать карточку значения имеет смысл, когда в ней что-то задано: тег, точность
// (в `tms` пишется только своя) или подпись. У пустой копировался бы шаблон, который
// вставкой лишь снимал бы настройки у цели.
const valueCopyable = computed(() => {
  const slot = valueTextSlot.value
  const d = details.value
  if (!slot || !d) return false
  return !!(slot.value || d.decimals !== null || d.params.some((p) => p.value))
})

// ─── Удаление ───
function onDelete() {
  canvas.deleteItems([...canvas.selection.value])
}

// ─── Единый tag-picker ───
// Один диалог на все места: `openPicker(config)` снимает selected и header при
// открытии, а `tags` передаётся ГЕТТЕРОМ — пустой picker сам грузит tag-list, и список
// должен наполниться, не закрывая диалог. picker=null — закрыт.
const picker = ref(null)
const pickerTags = computed(() => picker.value?.tags?.() ?? [])

function openPicker(config) {
  picker.value = { selected: '', tags: () => [], header: 'Выберите тег', ...config }
}

function onPickerSelect(tag) {
  const cb = picker.value?.onSelect
  picker.value = null
  cb?.(tag)
}

// ─── Редактирование слотов (привязка тегов) ───
/**
 * Теги, подходящие слоту по типу: булев слот берёт bool-теги, подпись со значением
 * (`Text`) — числовые (она печатает число с точностью, булев и текстовый тег ей нечего
 * показать), состояния «по значению» — весь список: код состояния автор задаёт сам, и
 * у булевых символов это как раз `true`/`false`.
 */
function slotPickerTags(slot) {
  if (isBooleanType(slot?.type)) return project.booleanTags
  if (slot?.type === 'Text') return project.numericTags
  return project.tags
}

function openSlotPicker(slot) {
  openPicker({
    tags: () => slotPickerTags(slot),
    selected: slot?.value || '',
    header: 'Выберите тег',
    onSelect: (tag) => patchSlotTag(slot.key, tag),
  })
}

/**
 * Каркас правки выделенной ЯЧЕЙКИ (не линка): резолвит cell и её stencil, отдаёт
 * { cell, stencil, tms, d } в fn, а мутирует cell сама fn. Вернула false — выходим без
 * перерисовки и снимка. reinject:true — перерисовать SVG ячейки после fn. В конце один
 * bumpVersion и requestSnapshot.
 */
function withSelectedCell(fn, { reinject = false } = {}) {
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  const d = details.value
  if (!graph || !d || d.kind !== 'cell') return
  const cell = graph.getCell(d.id)
  const stencil = getStencilById(d.stencilId)
  if (!cell || !stencil) return
  if (fn({ cell, stencil, tms: cell.get('tms') || {}, d }) === false) return
  if (reinject) {
    const cellView = paper?.findViewByModel(cell)
    if (cellView) injectStencilSvg(cellView, stencil)
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

/**
 * Записывает тег в слот ячейки и перерисовывает её SVG (новые bindings). Пустой тег
 * снимает привязку, а опустевший набор слотов удаляется целиком: пустой объект уехал бы
 * в `data-tms-meta` мусором (`keep: Boolean` считает `{}` значением).
 */
function patchSlotTag(key, tag) {
  withSelectedCell(
    ({ cell, tms }) => {
      const nextSlots = { ...(tms.slots || {}) }
      if (tag) nextSlots[key] = tag
      else delete nextSlots[key]
      const next = { ...tms }
      if (Object.keys(nextSlots).length) next.slots = nextSlots
      else delete next.slots
      cell.set('tms', next)
    },
    { reinject: true }
  )
}

// ─── Фигура-разметка: вид и содержимое подписи ───
// Патч уходит в `tms.shape` через applyShapePatch, он же пересчитывает габарит ячейки
// (у подписи он зависит от текста и шрифта). Правка идёт на ВСЁ выделение фигур.
function patchShape(patch) {
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  if (!graph) return
  const ids = canvas
    .writableItems(canvas.selection.value.filter((s) => s.kind === 'cell'))
    .map((s) => s.id)
  if (!applyShapePatch(graph, paper, ids, patch)) return
  canvas.bumpVersion()
  canvas.requestSnapshot()
  canvas.markDirty()
}

/**
 * Толщина тела: у шины — высота ячейки (порты едут следом, busCell), у точки
 * соединения — диаметр в tms.
 */
function applyThickness(v) {
  if (!Number.isFinite(v)) return
  withSelectedCell(
    ({ cell, stencil, tms, d }) => {
      // У точки диаметр живёт в tms; дефолт не пишем — отсутствие поля и есть он.
      if (d.isNode) {
        const next = { ...tms }
        if (v !== NODE_SIZE_DEFAULT) next.dotSize = v
        else delete next.dotSize
        if (next.dotSize === tms.dotSize) return false
        cell.set('tms', next)
        return true
      }
      if (!d.isBus) return false
      return setBusThickness(cell, canvas.paperRef.value, v, stencil.height)
    },
    { reinject: true }
  )
}

/** Цвет тела шины и точки соединения: дефолт в tms не пишем (отсутствие = он же). */
function applyBodyColor(value) {
  withSelectedCell(
    ({ cell, tms, d }) => {
      if (!d.isBus && !d.isNode) return false
      const next = { ...tms }
      // Дефолт в tms не пишем — отсутствие поля и есть он.
      if (value && value !== BUS_COLOR_DEFAULT) next.color = value
      else delete next.color
      if (next.color === tms.color) return false
      cell.set('tms', next)
    },
    { reinject: true }
  )
}

// Текст подписи-разметки: непустое пишется живьём, пустое держится только в поле —
// фигуру без текста на холсте не найти, поэтому по коммиту она удаляется.
const shapeTextDraft = ref(null)
const shapeText = computed(() => shapeTextDraft.value ?? details.value?.text ?? '')

function onShapeTextInput(v) {
  const next = v ?? ''
  shapeTextDraft.value = next
  if (next) patchShape({ text: next })
}

// Смена выделения не должна тащить черновик текста на другую фигуру.
watch(
  () => details.value?.id,
  () => (shapeTextDraft.value = null)
)

function commitShapeText() {
  const draft = shapeTextDraft.value
  shapeTextDraft.value = null
  if (draft === null || draft) return
  const id = details.value?.id
  if (id) canvas.deleteItems([{ kind: 'cell', id }])
}

// Свитч наконечника (`solid` — треугольник, `open` — две линии под 45°, нет поля —
// без стрелки): миниатюра вместо подписи, глиф в формате иконок холста ([{ d, mode }] в
// системе 16×16). В значении `'none'`, а не null: SelectButton сравнивает значения, и
// null конфликтует с «ничего не выбрано»; в tms он снова становится отсутствием поля.
const ARROW_OPTIONS = [
  // У «нет» просто линия, у остальных короткий хвост и крупный наконечник.
  { value: 'none', tip: 'Без стрелки', glyph: [{ d: 'M 3 8 L 13 8', mode: 'stroke' }] },
  {
    value: 'open',
    tip: 'Стрелка линиями',
    // Раствор 90°, как у настоящего наконечника (arrowSize): длина равна полуширине,
    // хвост доводится до вершины — иначе между ними разрыв.
    glyph: [{ d: 'M 3 8 L 14 8 M 8 2.5 L 14 8 L 8 13.5', mode: 'stroke' }],
  },
  {
    value: 'solid',
    tip: 'Стрелка треугольником',
    // Тот же раствор 90°: миниатюра показывает то, что получится на схеме.
    glyph: [
      { d: 'M 3 8 L 8 8', mode: 'stroke' },
      { d: 'M 14 8 L 8 2 L 8 14 Z', mode: 'fill' },
    ],
  },
]
const ARROW_ENDS = [
  { key: 'arrowStart', label: 'Стрелки в начале' },
  { key: 'arrowEnd', label: 'Стрелки в конце' },
]

// ─── Провод: стиль линии (толщина / цвет / наконечники) ───
//
// Один блок на два случая: выделен один провод и выделено несколько. Правка
// запоминается как «липкая» (workspace.wireStyle) и достаётся следующему нарисованному
// проводу. Толщина и цвет живут ещё и в attrs (по ним рисует JointJS), наконечники —
// только в tms, маркеры пересобирает syncLinkEndMarkers.
const LINK_STYLE_ATTR = { strokeWidth: 'line/strokeWidth', strokeColor: 'line/stroke' }

/** Выделенные провода (заблокированные не правим — замок read-only). */
const linkTargets = computed(() => {
  canvas.graphVersion.value
  const graph = canvas.graphRef.value
  if (!graph) return []
  return canvas
    .writableItems(canvas.selection.value.filter((s) => s.kind === 'link'))
    .map((s) => graph.getCell(s.id))
    .filter(Boolean)
})

/** Блок стиля показываем, когда в выделении нет символов: иначе непонятно, к чему он. */
const linkStyleVisible = computed(() => {
  const sel = canvas.selection.value
  return sel.length > 0 && sel.every((s) => s.kind === 'link')
})

/** Значения для полей: общее у всех целей либо `undefined` при расхождении («разные»). */
const linkStyle = computed(() => {
  const out = {}
  const targets = linkTargets.value
  for (const key of Object.keys(WIRE_STYLE_DEFAULTS)) {
    const values = targets.map((l) => l.get('tms')?.[key] ?? WIRE_STYLE_DEFAULTS[key])
    out[key] = values.every((v) => v === values[0]) ? values[0] : undefined
  }
  return out
})

/**
 * Патч стиля применяется ко ВСЕМ выделенным проводам и запоминается как «липкий»:
 * следующий нарисованный провод получит тот же вид.
 */
function applyLinkStyle(key, value) {
  // У наконечников `null` — штатное «нет стрелки»; у толщины и цвета пустой ввод
  // игнорируется (InputNumber отдаёт null при очистке поля).
  const isArrow = key === 'arrowStart' || key === 'arrowEnd'
  if (value == null && !isArrow) return
  const isDefault = isDefaultWireValue(key, value)
  workspace.setWireStyle({ [key]: isDefault ? null : value })
  const targets = linkTargets.value
  if (!targets.length) return
  for (const link of targets) {
    const attrPath = LINK_STYLE_ATTR[key]
    if (attrPath) link.attr(attrPath, value)
    const next = { ...(link.get('tms') || {}) }
    if (isDefault) delete next[key]
    else next[key] = value
    link.set('tms', next)
    // Наконечник зависит от толщины и цвета линии, а точка — от привязки конца:
    // маркеры пересобираются тем же билдером, что и при загрузке формы.
    syncLinkEndMarkers(link, canvas.paperRef.value)
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

// ─── Замок ячейки ───
function applyLockToggle() {
  const d = details.value
  if (!d || d.kind !== 'cell') return
  canvas.toggleLocked([{ kind: 'cell', id: d.id }])
}

// Замок для ЦЕЛЬНОЙ группы (у произвольного мультивыделения его нет): тумблер включён,
// когда все члены группы locked, клик блокирует или снимает всю группу.
const multiLock = computed(() => {
  canvas.graphVersion.value
  const graph = canvas.graphRef.value
  if (!graph) return { allLocked: false }
  const cells = canvas.selection.value
    .filter((s) => s.kind === 'cell')
    .map((s) => graph.getCell(s.id))
    .filter(Boolean)
  return { allLocked: cells.length > 0 && cells.every((c) => c.get('tms')?.locked) }
})

function applyMultiLockToggle() {
  canvas.toggleLocked(canvas.selection.value)
}

// Состав выделения: символы и провода считаются РАЗДЕЛЬНО — в выделение авто-попадают
// мостовые провода, и лассо по двум связанным символам дало бы «3 символа».
// `deletable` — сколько реально удалится, чтобы кнопка «Удалить (N)» не обещала больше.
const selectionSummary = computed(() => {
  canvas.graphVersion.value
  const sel = canvas.selection.value
  const cells = sel.filter((s) => s.kind === 'cell')
  const links = sel.filter((s) => s.kind === 'link')
  const graph = canvas.graphRef.value
  const lockedCells = graph
    ? cells.filter((s) => graph.getCell(s.id)?.get('tms')?.locked).length
    : 0
  const parts = []
  if (cells.length) parts.push(nplural(cells.length, 'символ', 'символа', 'символов'))
  if (links.length) parts.push(nplural(links.length, 'провод', 'провода', 'проводов'))
  return {
    label: parts.join(' + ') || 'ничего',
    // Тот же фильтр, что у deleteItems и пункта «Удалить» контекст-меню.
    deletable: canvas.writableItems(sel).length,
    locked: lockedCells,
  }
})

// Группировка выделения. `ungroup`=true, когда все выделенные — члены ОДНОЙ группы
// (клик по группе выделяет её целиком → показываем «Разгруппировать»); иначе при
// ≥2 ячейках — «Сгруппировать» (объединит, в т.ч. слив разные группы в одну).
const multiGroup = computed(() => {
  canvas.graphVersion.value
  const graph = canvas.graphRef.value
  if (!graph) return { show: false, ungroup: false }
  const cells = canvas.selection.value
    .filter((s) => s.kind === 'cell')
    .map((s) => graph.getCell(s.id))
    .filter(Boolean)
  if (cells.length < 2) return { show: false, ungroup: false }
  const gids = cells.map((c) => c.get('tms')?.groupId)
  const sameGroup = gids.every((g) => g && g === gids[0])
  return { show: true, ungroup: sameGroup }
})

function applyGroupToggle() {
  if (multiGroup.value.ungroup) {
    const n = canvas.ungroupCells(canvas.selection.value)
    if (n) notify.success('Разгруппировано', nplural(n, 'символ', 'символа', 'символов'))
  } else {
    const n = canvas.groupCells(canvas.selection.value)
    if (n) notify.success('Сгруппировано', nplural(n, 'символ', 'символа', 'символов'))
  }
}

// Кнопка-замок в шапке инспектора: доступна для одиночной ячейки и для цельной
// группы (единый объект); у произвольного мультивыделения замка нет.
const lockState = computed(() => {
  const d = details.value
  if (d && d.kind === 'cell') return { show: true, locked: d.locked }
  if (multiGroup.value.ungroup) return { show: true, locked: multiLock.value.allLocked }
  return { show: false, locked: false }
})

function onToggleLock() {
  const d = details.value
  if (d && d.kind === 'cell') applyLockToggle()
  else if (multiGroup.value.ungroup) applyMultiLockToggle()
}

/**
 * Точность значения. Пустое поле = дефолт протокола, поэтому не пишем 0, а удаляем
 * ключ — иначе «вернуть как было» стало бы невозможно.
 */
function applyValueDecimals(v) {
  withSelectedCell(
    ({ cell, tms, d }) => {
      if (!d.hasTextSlot) return false
      const next = { ...tms }
      if (Number.isFinite(v)) next.decimals = v
      else delete next.decimals
      if (next.decimals === tms.decimals) return false
      cell.set('tms', next)
    },
    { reinject: true }
  )
}

/**
 * Значение правимой подписи. Пустое поле возвращает текст из определения, поэтому
 * ключ удаляется, а не пишется пустой строкой.
 */
function applyParam(key, value) {
  withSelectedCell(
    ({ cell, tms }) => {
      const text = (value ?? '').replace(/\s+/g, ' ').trim()
      const params = { ...(tms.params || {}) }
      if (text) params[key] = text
      else delete params[key]
      if ((tms.params?.[key] ?? '') === (params[key] ?? '')) return false
      const next = { ...tms }
      if (Object.keys(params).length) next.params = params
      else delete next.params
      cell.set('tms', next)
    },
    { reinject: true }
  )
}

/**
 * Резолвит выделенную ячейку/линк, отдаёт её tms в `updater(tms)` → новый tms,
 * пишет его + bumpVersion + requestSnapshot. `updater` возвращает `undefined`,
 * чтобы ничего не менять (no-op).
 */
function mutateSelectedTms(updater) {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d) return
  const cell = graph.getCell(d.id)
  if (!cell) return
  const next = updater(cell.get('tms') || {})
  if (next === undefined) return
  cell.set('tms', next)
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

// ─── Диапазоны значений (rangeSource) ───
// Секция целиком в useValueRanges: одиночный режим + мульти-шаблон.
const {
  openRangePicker,
  updateRange,
  addRange,
  removeRange,
  removeRangeSource,
  toggleRangeHighlight,
  multiRange,
  openMultiRangePicker,
  updateMultiRange,
  addMultiRange,
  removeMultiRangeRow,
  removeMultiRange,
  toggleMultiRangeHighlight,
} = useValueRanges({ details, mutateSelectedTms, openPicker })

// ─── boolSource: зависимости-теги ГРУППАМИ (DNF) ───
// Секция целиком в useBoolGroups (форма { groups }, picker, add/edit/remove).
const {
  boolGroups,
  boolRemovable,
  onAddGroup,
  onAddBoolTag,
  editBoolTagAt,
  removeBoolTagAt,
  removeBoolGroup,
  clearBoolGroups,
} = useBoolGroups({ details, mutateSelectedTms, openPicker })

/** Открыть picker массовой привязки булева тега (multi-select). */
function openMultiBoolPicker() {
  openPicker({
    tags: () => project.booleanTags,
    header: 'Булев тег для всех выделенных символов',
    onSelect: onPickMultiBoolTag,
  })
}

/** Multi-select: добавить тег НОВОЙ группой [tag] в boolSource всех
 * выделенных (у выделения нет общего состояния → каждому — своя новая группа,
 * не дублируя уже существующую одиночную группу с этим тегом). */
function onPickMultiBoolTag(tag) {
  if (!tag) return
  const sel = canvas.selection.value
  if (!sel.length) return
  // writableItems отсекает заблокированные (замок read-only) — их считаем в skipped.
  const writable = canvas.writableItems(sel)
  let applied = 0
  let skipped = sel.length - writable.length
  for (const cell of writable) {
    const tms = cell.get('tms') || {}
    if (isStatic(tms)) {
      skipped++
      continue
    }
    // Элемент не должен зависеть от своего же тега — слот-драйвер уже отвечает за
    // состояние, дубль в boolSource бессмыслен.
    const slotKey = stateSlotKeyOf(tms)
    if (slotKey && tms.slots?.[slotKey] === tag) {
      skipped++
      continue
    }
    const groups = normalizeBoolSource(tms.boolSource).groups
    // Уже есть одиночная группа ровно с этим тегом → не плодим дубль.
    if (groups.some((g) => g.length === 1 && g[0] === tag)) {
      applied++
      continue
    }
    cell.set('tms', { ...tms, boolSource: { groups: [...groups, [tag]] } })
    applied++
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
  const count = nplural(applied, 'символ', 'символа', 'символов')
  const detail =
    skipped > 0
      ? `Привязано к ${count} · пропущено: ${skipped} (заблокировано / текст / свой тег)`
      : `Привязано к ${count}`
  // applied === 0 — успеха не было: зелёный тост врал бы про результат.
  if (applied === 0) notify.warn('Тег не привязан', detail)
  else notify.success('Булев тег привязан', detail)
}

// ─── Копирование настроек анимаций между элементами ───
// Буфер (useAnimationClipboard) держит четыре независимых слота — тег состояния,
// карточку значения, зависимости и диапазоны, — копируются/вставляются раздельно
// кнопками в шапке своего блока. Копируем ЦЕЛИКОМ, включая тег (предсказуемый «тот же источник»); тег при нужде
// меняют вручную после вставки. toPlain снимает reactive-прокси — иначе вставка
// делила бы одну ссылку между ячейками. Вставка идёт на ВСЁ текущее выделение
// (одиночное и мульти), со счётчиком пропущенных (несовместимые цели).

/** Копировать тег состояния выделенного вместе с ключом слота: вставка проверит, что у
 *  цели слот тот же (булев тег в символ «по значению» не годится). */
function copyState() {
  const slot = stateSlot.value
  if (!slot?.value) return
  animClip.copyState({ slotKey: slot.key, tag: slot.value })
  notify.success('Скопировано', 'Тег состояния')
}

/** Копировать карточку значения ЦЕЛИКОМ: тег подписи, точность и правимые подписи. */
function copyValue() {
  const slot = valueTextSlot.value
  const d = details.value
  if (!slot || !d) return
  animClip.copyValue(
    toPlain({
      slotKey: slot.key,
      tag: slot.value || '',
      decimals: d.decimals,
      params: Object.fromEntries(d.params.filter((p) => p.value).map((p) => [p.key, p.value])),
    })
  )
  notify.success('Скопировано', 'Карточка значения')
}

/** Копировать группы-зависимости выделенного (boolSource). */
function copyDeps() {
  if (!boolGroups.value.length) return
  animClip.copyDeps(toPlain({ groups: boolGroups.value }))
  notify.success('Скопировано', 'Зависимости от других элементов')
}

/** Копировать диапазоны выделенного (rangeSource целиком: тег + пороги). */
function copyRange() {
  const d = details.value
  if (!d?.rangeSource) return
  animClip.copyRange(toPlain(d.rangeSource))
  notify.success('Скопировано', 'Диапазоны значений')
}

/**
 * Вставить тег состояния на всё выделение — только символам с ТЕМ ЖЕ ключом слота
 * (`onoff` или `value`): режимы анимации разные, а тег булев либо числовой. Остальные
 * цели идут в пропущенные.
 */
function pasteState() {
  const clip = animClip.stateClip.value
  pasteClip(
    clip,
    (tms) => applyStateClip(tms, clip, { isStatic: isStatic(tms), slotKey: stateSlotKeyOf(tms) }),
    { reinject: true }
  )('Тег состояния вставлен')
}

/**
 * Вставить карточку значения на всё выделение — символам с Text-слотом того же ключа.
 * Подписи раздаём только по ключам, объявленным у цели: у другого символа они свои.
 */
function pasteValue() {
  const clip = animClip.valueClip.value
  pasteClip(
    clip,
    (tms) => {
      const stencil = getStencilById(tms.stencilId)
      return applyValueClip(tms, clip, {
        isStatic: isStatic(tms),
        slotKey: textSlotOf(stencil?.slots)?.key || null,
        paramKeys: (stencil?.params || []).map((p) => p.key),
      })
    },
    { reinject: true }
  )('Карточка значения вставлена')
}

/** Вставить зависимости из буфера на всё выделение (замена групп целиком). Применимы к
 *  любому не-static элементу, включая провод. */
function pasteDeps() {
  pasteClip(animClip.depsClip.value, (tms) =>
    applyDepsClip(tms, animClip.depsClip.value, { isStatic: isStatic(tms) })
  )('Зависимости вставлены')
}

/** Вставить диапазоны из буфера на всё текущее выделение (rangeSource целиком,
 *  свежий клон на ячейку). Статичные символы пропускаем. */
function pasteRange() {
  pasteClip(animClip.rangeClip.value, (tms) =>
    applyRangeClip(tms, animClip.rangeClip.value, { isStatic: isStatic(tms) })
  )('Диапазоны вставлены')
}

/**
 * Общий каркас вставки буфера на всё выделение: для каждой цели зовёт apply(tms) →
 * новый tms либо null (несовместимо → пропуск со счётчиком). Заблокированные
 * отсекает `writableItems`. Пустой буфер — no-op.
 *
 * `reinject: true` перерисовывает SVG цели — обязателен, когда вставка меняет слоты:
 * тег уходит в bindings разметки, и без перерисовки они остались бы от прежнего тега
 * (то же делает `withSelectedCell` при правке слота из инспектора).
 *
 * Возвращает функцию-финализатор (принимает заголовок тоста).
 */
function pasteClip(clip, apply, { reinject = false } = {}) {
  return (title) => {
    if (!clip) return
    const paper = canvas.paperRef.value
    const sel = canvas.selection.value
    const writable = canvas.writableItems(sel)
    let applied = 0
    let skipped = sel.length - writable.length // заблокированные
    for (const cell of writable) {
      const next = apply(cell.get('tms') || {})
      if (!next) {
        skipped++
        continue
      }
      cell.set('tms', next)
      if (reinject) {
        const stencil = getStencilById(next.stencilId)
        const cellView = stencil && paper?.findViewByModel(cell)
        if (cellView) injectStencilSvg(cellView, stencil)
      }
      applied++
    }
    canvas.bumpVersion()
    canvas.requestSnapshot()
    const parts = [`Применено к ${nplural(applied, 'символ', 'символа', 'символов')}`]
    if (skipped) parts.push(`пропущено: ${skipped}`)
    const detail = parts.join(' · ')
    // Нулевой результат — не «успех».
    if (applied === 0) notify.warn('Настройки не применены', detail)
    else notify.success(title, detail)
  }
}

// ─── Hyperlink-навигация: клик в рантайме открывает другую view ───
// Секция целиком в useNavigationField (черновик + коммит по blur/Enter/выбору).
const {
  navigationEnabled,
  navInput,
  navSuggestions,
  otherFormIds,
  navBroken,
  toggleNavigationEnabled,
  onNavComplete,
  commitNav,
} = useNavigationField({ details, mutateSelectedTms })
</script>

<template>
  <aside class="h-full flex flex-col bg-surface-50">
    <div class="relative min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center">
      <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Инспектор</h2>
      <!-- Замок выделенного (одиночная ячейка или цельная группа) — абсолютом
           справа-сверху, единая точка во всех случаях. -->
      <Button
        v-if="lockState.show"
        v-tooltip.bottom="lockState.locked ? 'Разблокировать' : 'Заблокировать'"
        :icon="lockState.locked ? 'pi pi-lock' : 'pi pi-unlock'"
        :severity="lockState.locked ? 'primary' : 'secondary'"
        text
        rounded
        size="small"
        class="absolute! right-2! top-1/2! !-translate-y-1/2 w-8! h-8! p-0!"
        @click="onToggleLock"
      />
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm">
      <!-- Multi-select: больше одного символа — показываем сводку + удаление -->
      <template v-if="canvas.selection.value.length > 1">
        <div class="[&>*+*]:border-t [&>*+*]:border-surface-200 [&>*+*]:pt-4 [&>*+*]:mt-4">
          <div>
            <div class="text-[11px] text-surface-500 mb-1">
              {{ multiGroup.ungroup ? 'Группа' : 'Выделено' }}
            </div>
            <div class="font-medium text-surface-900">
              {{ selectionSummary.label }}
              <span v-if="selectionSummary.locked" class="text-[11px] font-normal text-surface-500">
                · {{ selectionSummary.locked }} заблокировано
              </span>
            </div>
            <p v-if="multiGroup.ungroup" class="text-[11px] text-surface-500 mt-2">
              Группа ведёт себя как один символ. Анимации применяются ко всем членам.
            </p>
          </div>

          <!-- Вид проводов правится на ВСЁ выделение (как анимации ниже): выделил
               серию линий — задал цвет и толщину один раз. Показываем, только когда
               в выделении нет символов, иначе непонятно, к чему относятся поля. -->
          <WireStyleFields
            v-if="linkStyleVisible"
            :values="linkStyle"
            :arrow-options="ARROW_OPTIONS"
            :arrow-ends="ARROW_ENDS"
            @apply="applyLinkStyle"
          />

          <!-- Группировка: объединить выделенное в группу (клик по члену выделяет
               всю группу) либо разгруппировать. -->
          <div v-if="multiGroup.show">
            <Button
              :label="multiGroup.ungroup ? 'Разгруппировать' : 'Сгруппировать'"
              :icon="multiGroup.ungroup ? 'pi pi-table' : 'pi pi-th-large'"
              severity="secondary"
              outlined
              size="small"
              class="w-full"
              @click="applyGroupToggle"
            />
          </div>

          <!-- Выравнивание ячеек по рамке выделения. Только для ПРОИЗВОЛЬНОГО
               мультивыделения (≥2 ячеек), НЕ для цельной группы — та единый объект,
               внутреннюю раскладку не трогаем. Три категории: гориз./верт.
               выравнивание, распределение; центры снапятся к сетке. -->
          <AlignBlock
            v-if="canAlign && !multiGroup.ungroup"
            :rows="ALIGN_ROWS"
            :can-distribute="canDistribute"
            @align="alignCells"
            @distribute="distributeCells"
          />

          <!-- Multi-select: те же блоки, что в single, как «применить ко всем»
               (общего состояния у выделения нет → списки пустые/шаблон, выбор тега
               и порогов раздаётся на всё выделение). Зависимости — DependencyBlock без
               групп: «+ группа» раздаёт тег новой группой на всё выделение. Тега
               состояния тут нет: слоты у выделенных символов бывают разного типа.
               Range — шаблон multiRange: задаёшь тег → правишь пороги → на все. -->
          <div class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>
            <DependencyBlock
              :groups="[]"
              :removable="false"
              :tags-loaded="!!project.tags.length"
              :pasteable="animClip.hasDeps.value"
              @add-group="openMultiBoolPicker"
              @paste="pasteDeps"
            />
            <RangeBlock
              :range-source="multiRange"
              :tags-loaded="!!project.tags.length"
              :pasteable="animClip.hasRange.value"
              @open-tag-picker="openMultiRangePicker"
              @update-range="updateMultiRange"
              @add-range="addMultiRange"
              @remove-range="removeMultiRangeRow"
              @highlight="toggleMultiRangeHighlight"
              @remove="removeMultiRange"
              @paste="pasteRange"
            />
          </div>

          <div class="pt-2 border-t border-surface-200">
            <Button
              :label="`Удалить (${selectionSummary.deletable})`"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              @click="onDelete"
            />
          </div>
        </div>
      </template>

      <template v-else-if="!details">
        <div>
          <div class="flex flex-col items-center text-center text-surface-400 pb-6 pt-8">
            <i class="pi pi-mouse text-3xl mb-3 opacity-60" />
            <div class="text-sm font-medium text-surface-500 mb-1">Ничего не выделено</div>
            <p class="text-[11px] leading-relaxed max-w-[180px]">
              Кликните по символу или проводу на холсте — здесь появятся свойства
            </p>
          </div>

          <!-- Холостой инспектор не простаивает: сводка активной формы сразу под
               подсказкой. -->
          <div class="space-y-4 border-t border-surface-200 pt-4 text-[11px]">
            <div>
              <div class="mb-2 uppercase tracking-wider text-surface-500">Сводка формы</div>
              <div class="flex flex-col gap-1 text-surface-600">
                <div class="flex justify-between">
                  <span>Символы</span>
                  <span class="font-mono">{{ canvas.cellsCount.value }}</span>
                </div>
                <div class="flex justify-between">
                  <span>Провода</span>
                  <span class="font-mono">{{ canvas.linksCount.value }}</span>
                </div>
                <div class="flex justify-between">
                  <span>Теги в tag-list</span>
                  <span class="font-mono">{{ project.tags.length }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="details">
        <!-- Замок ячейки — кнопка в шапке инспектора (см. выше), не строкой. При
             locked свойства блокируются inert'ом; кнопка-замок вне его — снять можно. -->
        <div
          :inert="!!details.locked"
          :class="{ 'opacity-60': details.locked }"
          class="[&>*+*]:border-t [&>*+*]:border-surface-200 [&>*+*]:pt-4 [&>*+*]:mt-4"
        >
          <!-- Фигура-разметка: только вид (и содержимое подписи). Анимаций, навигации
               и тегов у неё нет — блоки ниже не рендерим, геометрия правится на
               холсте жестами. -->
          <ShapeBlock
            v-if="details.isShape"
            :values="details"
            :text="shapeText"
            :align-options="ALIGN_OPTIONS"
            :bold-options="BOLD_OPTIONS"
            @patch="patchShape"
            @text-input="onShapeTextInput"
            @text-commit="commitShapeText"
          />

          <template v-else-if="details.kind === 'cell'">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Символ</div>
              <div class="font-medium text-surface-900">
                {{ details.stencilLabel }}
              </div>
              <div class="text-[11px] text-surface-500 font-mono">
                {{ details.stencilId }}
              </div>
              <!-- id outer-карточки в animations.json / экспортном SVG (тот же, что
                   эмитит exporter; точная подстановка short-id см. constants/ids). -->
              <div class="text-[11px] text-surface-500 font-mono break-all">
                {{ details.exportId }}
              </div>
            </div>

            <!-- Вид тела шины / точки соединения одним блоком. Цвет БАЗОВЫЙ:
                 привязанные диапазоны и обесточивание заливают его поверх, поэтому в
                 рантайме свой цвет виден, пока ни один animation-класс не активен.
                 Толщина: у шины = высота ячейки, у точки = диаметр; минимум ОН ЖЕ дефолт
                 (тоньше тело сливается с проводами, точка — с их пересечением), поэтому
                 крестик сброса ведёт к нему. -->
            <BodyStyleFields
              v-if="details.isBus || details.isNode"
              :color="details.color || BUS_COLOR_DEFAULT"
              :color-default="BUS_COLOR_DEFAULT"
              :thickness="details.thickness"
              :thickness-min="details.thicknessMin"
              :thickness-max="details.thicknessMax"
              :thickness-default="details.thicknessMin"
              @update-color="applyBodyColor"
              @update-thickness="applyThickness"
            />

            <!-- Навигация (hyperlink на другую форму при клике в рантайме). Цель —
                 id формы проекта (= view-id рантайма): можно выбрать из списка форм ИЛИ
                 ввести view-id вручную (editable) — напр. для view, которой ещё нет в
                 проекте. Свич справа от заголовка показывает/скрывает поле; выключение
                 очищает значение. -->
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-surface-500">Навигация</div>
                  <div class="text-[11px] text-surface-500">переход при клике</div>
                </div>
                <ToggleSwitch
                  :model-value="navigationEnabled"
                  @update:model-value="toggleNavigationEnabled"
                />
              </div>
              <template v-if="navigationEnabled">
                <AutoComplete
                  :model-value="navInput"
                  :suggestions="navSuggestions"
                  dropdown
                  complete-on-focus
                  size="small"
                  placeholder="Форма или view-id"
                  class="w-full"
                  input-class="w-full text-xs!"
                  @update:model-value="(v) => (navInput = v)"
                  @complete="onNavComplete"
                  @item-select="commitNav"
                  @blur="commitNav"
                  @keyup.enter="commitNav"
                />
                <div v-if="navBroken" class="text-[11px] text-surface-500">
                  Внешняя view (не среди загруженных форм) — сработает, если она есть в рантайме
                </div>
                <div v-else-if="!otherFormIds.length" class="text-[11px] text-surface-500">
                  Загруженных форм нет — введите view-id вручную
                </div>
              </template>
            </div>
          </template>

          <template v-else>
            <div class="[&>*+*]:border-t [&>*+*]:border-surface-200 [&>*+*]:pt-4 [&>*+*]:mt-4">
              <div>
                <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                  Элемент
                </div>
                <div class="font-medium text-surface-900">Провод</div>
              </div>

              <WireStyleFields
                :values="linkStyle"
                :arrow-options="ARROW_OPTIONS"
                :arrow-ends="ARROW_ENDS"
                @apply="applyLinkStyle"
              />
            </div>
          </template>

          <!-- Анимации: не у подписи и не у фигуры-разметки (у последней их
               нет вовсе — exporter не эмитит для неё карточек, привязка вела бы в никуда). -->
          <div v-if="!details.isShape" class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>

            <!-- Состояние символа: тег слота-драйвера. Заголовок и справка следуют типу
                 слота («Булево значение» либо «Состояние по значению») — режим задан в
                 определении символа, здесь привязывают только тег. -->
            <StateBlock
              v-if="stateSlot"
              :slot-info="stateSlot"
              :states="details.states"
              :tags-loaded="!!project.tags.length"
              :copyable="!!stateSlot.value"
              :pasteable="animClip.hasState.value"
              @pick-tag="openSlotPicker(stateSlot)"
              @highlight-tag="canvas.toggleHighlightedTag"
              @clear="patchSlotTag(stateSlot.key, '')"
              @copy="copyState"
              @paste="pasteState"
            />

            <!-- Карточка значения одним блоком: тег, точность и правимые подписи. -->
            <ValueBlock
              v-if="valueTextSlot"
              :slot-info="valueTextSlot"
              :params="details.params"
              :decimals="details.decimals"
              :tags-loaded="!!project.tags.length"
              :copyable="valueCopyable"
              :pasteable="animClip.hasValue.value"
              @copy="copyValue"
              @paste="pasteValue"
              @pick-tag="openSlotPicker(valueTextSlot)"
              @highlight-tag="canvas.toggleHighlightedTag"
              @clear="patchSlotTag(valueTextSlot.key, '')"
              @update-decimals="applyValueDecimals"
              @update-param="applyParam"
            />

            <!-- Зависимости (boolSource) — виден ВСЕГДА, в том числе у провода и шины:
                 гашение не привязано к слоту символа. Теги пишутся лениво через
                 «Добавить»; × очищает все группы (boolRemovable). -->
            <DependencyBlock
              :groups="boolGroups"
              :removable="boolRemovable"
              :tags-loaded="!!project.tags.length"
              :copyable="!!boolGroups.length"
              :pasteable="animClip.hasDeps.value"
              @add-group="onAddGroup"
              @add-tag="onAddBoolTag"
              @edit-tag="editBoolTagAt"
              @remove-tag="removeBoolTagAt"
              @remove-group="removeBoolGroup"
              @remove="clearBoolGroups"
              @highlight-tag="canvas.toggleHighlightedTag"
              @copy="copyDeps"
              @paste="pasteDeps"
            />

            <!-- Значение тега → класс: диапазоны либо точные значения (свитч в блоке).
                 rangeSource создаётся лениво при выборе тега (onPickTag),
                 очищается через × (виден при непустом). -->
            <RangeBlock
              :range-source="details.rangeSource"
              :tags-loaded="!!project.tags.length"
              :copyable="!!details.rangeSource"
              :pasteable="animClip.hasRange.value"
              @open-tag-picker="openRangePicker"
              @update-range="updateRange"
              @add-range="addRange"
              @remove-range="removeRange"
              @highlight="toggleRangeHighlight"
              @remove="removeRangeSource"
              @copy="copyRange"
              @paste="pasteRange"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- Единый tag-picker для всех мест инспектора (слот / диапазоны / значение /
         булев / multi-select) — открывается через openPicker, см. picker-ref. -->
    <TagPickerDialog
      :visible="!!picker"
      :tags="pickerTags"
      :selected="picker?.selected || ''"
      :header="picker?.header || 'Выберите тег'"
      @update:visible="(v) => !v && (picker = null)"
      @select="onPickerSelect"
    />
  </aside>
</template>
