<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import InputNumber from 'primevue/inputnumber'
import AutoComplete from 'primevue/autocomplete'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'
import Checkbox from 'primevue/checkbox'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import {
  useAnimationClipboard,
  applyBoolClip,
  applyRangeClip,
} from '../composables/useAnimationClipboard'
import { useAlign } from '../composables/useAlign'
import { useBoolGroups } from '../composables/useBoolGroups'
import { useValueRanges } from '../composables/useValueRanges'
import { useTextCellProps, ALIGN_OPTIONS, BOLD_OPTIONS } from '../composables/useTextCellProps'
import { useNavigationField } from '../composables/useNavigationField'
import { useProjectStore } from '../stores/useProjectStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { getStencilById, hasBoolSlot } from '../stencils/registry'
import { injectStencilSvg } from '../stencils/svgInjector'
import { isShapeCell, shapeTypeLabel, applyShapePatch } from '../stencils/shapeElement'
import { TEXT_FONT_SIZE } from '../stencils/textCell'
import { VALUE_DECIMALS_DEFAULT, VALUE_TEXT_COLOR } from '../stencils/valueCell'
import { BUS_COLOR_DEFAULT, BUS_THICKNESS_MAX, setBusThickness } from '../stencils/busCell'
import { NODE_SIZE_DEFAULT, NODE_SIZE_MAX } from '../stencils/nodeCell'
import { nplural } from '../utils/plural'
import { normalizeBoolSource } from '../utils/boolSource'
import { FONT_FAMILIES, normalizeFont } from '../utils/textMetrics'
import { toPlain } from '../utils/plain'
import { isBooleanType } from '../services/parsers'
import TagPickerDialog from './TagPickerDialog.vue'
import TagField from './TagField.vue'
import RangeBlock from './RangeBlock.vue'
import BooleanBlock from './BooleanBlock.vue'
import WireStyleFields from './WireStyleFields.vue'
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
      isText: tms.stencilId === 'cell_text',
      text: tms.text ?? '',
      fontSize: tms.fontSize ?? TEXT_FONT_SIZE,
      bold: !!tms.bold,
      align: tms.align || 'left',
      fontFamily: normalizeFont(tms.fontFamily),
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
      isValue: tms.stencilId === 'cell_value',
      valueTag: tms.valueTag ?? '',
      // Явно выбранная пара «подпись + единица».
      valueLabel: tms.valueLabel ?? '',
      decimals: Number.isFinite(tms.decimals) ? tms.decimals : null,
      valueUnit: tms.valueUnit ?? '',
      // id outer-карточки в animations.json/SVG (тот же, что эмитит exporter).
      exportId: previewOuterKey(tms.stencilId, cell.id, tms.valueTag),
      // Символы с булевым слотом-драйвером (`onoff`, см. hasBoolSlot) рендерят его
      // первой строкой BooleanBlock вместе с зависимостями boolSource.
      hasBoolSlot: hasBoolSlot(stencil),
      // Тег основного булева слота (slot.onoff) — чтобы исключить его из boolSource.
      // Берётся из payload, а не по индексу slots[0].
      onoffTag: slotValues.onoff || '',
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

// Слот-драйвер символа «по значению»: любой не-onoff слот (onoff рисует BooleanBlock).
// На холсте нужна одна строка — привязать тег, состояния и вид заданы в символе.
const valueStateSlot = computed(() => {
  const d = details.value
  if (!d || d.kind !== 'cell') return null
  return (d.slots || []).find((s) => s.key !== 'onoff') || null
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
// Булев слот → только bool-теги; остальные — весь tag-list.
function openSlotPicker(slot) {
  openPicker({
    tags: () => (isBooleanType(slot?.type) ? project.booleanTags : project.tags),
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

/** Записывает тег в слот ячейки и перерисовывает её SVG (новые bindings). */
function patchSlotTag(key, tag) {
  withSelectedCell(
    ({ cell, tms }) => {
      const nextSlots = { ...(tms.slots || {}) }
      if (tag) nextSlots[key] = tag
      else delete nextSlots[key]
      cell.set('tms', { ...tms, slots: nextSlots })
    },
    { reinject: true }
  )
}

// ─── Редактирование текста (символ cell_text) ───
// Секция целиком в useTextCellProps (patch + ресайз под текст; ALIGN/BOLD-опции там же).
const { applyText, applyFontSize, applyBold, applyColor, applyAlign, applyFontFamily } =
  useTextCellProps({
    withSelectedCell,
  })

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
      if (!d.isBus && !d.isNode && !d.isValue) return false
      const next = { ...tms }
      // Дефолт зависит от символа: у карточки значения это цвет текста, у шины и точки —
      // цвет тела. Значение, равное дефолту, в tms не пишем.
      const fallback = d.isValue ? VALUE_TEXT_COLOR : BUS_COLOR_DEFAULT
      if (value && value !== fallback) next.color = value
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

/** Тумблер заливки фигуры: включаем последним цветом (или белым), выключаем в `none`. */
function toggleShapeFill(on) {
  patchShape({ fill: on ? details.value?.fill || '#ffffff' : 'none' })
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
    syncLinkEndMarkers(link)
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

// ─── Tag-picker для cell_value (отображаемый тег) ───
function openValueTagPicker() {
  openPicker({
    tags: () => project.floatTags,
    selected: details.value?.valueTag || '',
    header: 'Выберите тег для отображения значения',
    onSelect: onPickValueTag,
  })
}

/** Подпись и единица cell_value — свободный ввод, без справочника величин. */
function applyValueText(key, raw) {
  withSelectedCell(
    ({ cell, tms, d }) => {
      if (!d.isValue) return false
      const value = (raw ?? '').trim()
      const next = { ...tms }
      if (value) next[key] = value
      else delete next[key]
      if (next[key] === tms[key]) return false
      cell.set('tms', next)
    },
    { reinject: true }
  )
}

/**
 * Точность значения. Пустое поле = «как в пресете величины», поэтому не пишем 0,
 * а удаляем ключ — иначе «сбросить к пресету» стало бы невозможно.
 */
function applyValueDecimals(v) {
  withSelectedCell(
    ({ cell, tms, d }) => {
      if (!d.isValue) return false
      const next = { ...tms }
      if (Number.isFinite(v)) next.decimals = v
      else delete next.decimals
      if (next.decimals === tms.decimals) return false
      cell.set('tms', next)
    },
    { reinject: true }
  )
}

function onPickValueTag(tag) {
  // Перерисовка — buildValueContent читает свежий tms.valueTag и обновляет label/unit.
  withSelectedCell(
    ({ cell, tms, d }) => {
      if (!d.isValue) return false
      if ((tms.valueTag ?? '') === tag) return false
      cell.set('tms', { ...tms, valueTag: tag })
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
    // Свитчи (символы с slot.onoff) не должны зависеть от своего же тега —
    // slot.onoff уже отвечает за переключение, дубль в boolSource бессмыслен.
    if (hasBoolSlot(getStencilById(tms.stencilId)) && tms.slots?.onoff === tag) {
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
// Буфер (useAnimationClipboard) держит два независимых слота — булев блок и
// диапазоны, — копируются/вставляются раздельно кнопками в шапке своего блока.
// Копируем ЦЕЛИКОМ, включая тег (предсказуемый «тот же источник»); тег при нужде
// меняют вручную после вставки. toPlain снимает reactive-прокси — иначе вставка
// делила бы одну ссылку между ячейками. Вставка идёт на ВСЁ текущее выделение
// (одиночное и мульти), со счётчиком пропущенных (несовместимые цели).

/** Копировать булев блок выделенного: свой тег (slot.onoff) + группы-зависимости. */
function copyBool() {
  const d = details.value
  if (!d) return
  animClip.copyBool(toPlain({ onoffTag: d.onoffTag || null, groups: boolGroups.value }))
  notify.success('Скопировано', 'Булевые настройки анимации')
}

/** Копировать диапазоны выделенного (rangeSource целиком: тег + пороги). */
function copyRange() {
  const d = details.value
  if (!d?.rangeSource) return
  animClip.copyRange(toPlain(d.rangeSource))
  notify.success('Скопировано', 'Диапазоны значений')
}

/**
 * Вставить булев блок из буфера на всё текущее выделение. Группы-зависимости
 * (boolSource) раздаём любому не-static элементу/проводу; свой булев тег
 * (onoff) — только символам с булевым слотом (иначе некуда его писать). Статичные
 * символы (текст/значение) пропускаем со счётчиком.
 */
function pasteBool() {
  const clip = animClip.boolClip.value
  // Вставка ЗАМЕНЯЕТ блок целиком: буфер без групп снимает boolSource у цели.
  // Считаем такие случаи, чтобы не стереть зависимости молча (тост станет warn).
  const clipHasGroups = !!(clip?.groups || []).some((g) => g.length)
  pasteClip(
    clip,
    (tms) =>
      applyBoolClip(tms, clip, {
        isStatic: isStatic(tms),
        hasBoolSlot: hasBoolSlot(getStencilById(tms.stencilId)),
      }),
    (tms) => !clipHasGroups && !!tms.boolSource
  )('Булевые настройки вставлены')
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
 * отсекает `writableItems`. Пустой буфер — no-op. `wasCleared(tmsBefore)` (опц.)
 * помечает цели, у которых вставка СНЯЛА настройку — такие считаем отдельно и
 * выводим warn, чтобы данные не исчезали молча под зелёным тостом.
 * Возвращает функцию-финализатор (принимает заголовок тоста).
 */
function pasteClip(clip, apply, wasCleared = null) {
  return (title) => {
    if (!clip) return
    const sel = canvas.selection.value
    const writable = canvas.writableItems(sel)
    let applied = 0
    let skipped = sel.length - writable.length // заблокированные
    let cleared = 0
    for (const cell of writable) {
      const before = cell.get('tms') || {}
      const next = apply(before)
      if (!next) {
        skipped++
        continue
      }
      if (wasCleared?.(before)) cleared++
      cell.set('tms', next)
      applied++
    }
    canvas.bumpVersion()
    canvas.requestSnapshot()
    const parts = [`Применено к ${nplural(applied, 'символ', 'символа', 'символов')}`]
    if (skipped) parts.push(`пропущено: ${skipped}`)
    if (cleared) parts.push(`зависимости очищены: ${cleared}`)
    const detail = parts.join(' · ')
    // Нулевой результат или снятые настройки — не «успех».
    if (applied === 0) notify.warn('Настройки не применены', detail)
    else if (cleared) notify.warn(title, detail)
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
            <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
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
          <div v-if="canAlign && !multiGroup.ungroup" class="space-y-2.5">
            <div v-for="row in ALIGN_ROWS" :key="row.label" class="flex items-center gap-3">
              <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                {{ row.label }}
              </span>
              <div class="ml-auto flex items-center gap-1">
                <button
                  v-for="btn in row.buttons"
                  :key="btn.op"
                  type="button"
                  v-tooltip.bottom="btn.tip"
                  :disabled="row.kind === 'distribute' && !canDistribute"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900 disabled:cursor-not-allowed disabled:opacity-40"
                  @click="row.kind === 'distribute' ? distributeCells(btn.op) : alignCells(btn.op)"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect
                      v-for="(r, i) in btn.rects"
                      :key="i"
                      :x="r.x"
                      :y="r.y"
                      :width="r.w"
                      :height="r.h"
                      :rx="r.rx"
                      :opacity="r.o"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Multi-select: те же блоки, что в single, как «применить ко всем»
               (общего состояния у выделения нет → списки пустые/шаблон, выбор тега
               и порогов раздаётся на всё выделение). Булев — BooleanBlock без групп:
               «+ группа» раздаёт тег новой группой на всё выделение. Range — шаблон
               multiRange: задаёшь тег → правишь пороги → на все выделенные. -->
          <div class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>
            <BooleanBlock
              :slot-info="null"
              :groups="[]"
              :removable="false"
              :tags-loaded="!!project.tags.length"
              :pasteable="animClip.hasBool.value"
              title="Булево значение"
              @add-group="openMultiBoolPicker"
              @paste="pasteBool"
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
          <template v-if="details.isShape">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Фигура</div>
              <div class="font-medium text-surface-900">{{ details.shapeLabel }}</div>
            </div>

            <div class="space-y-2.5">
              <div v-if="details.isShapeText">
                <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Текст</div>
                <!-- Пустое поле = удалить подпись (по коммиту, не на каждый символ:
                     иначе стирание текста «под новый» сносило бы фигуру). Textarea, а
                     не InputText: подпись многострочная, Enter добавляет строку —
                     поэтому шаг истории пишется по blur, а не по Enter. -->
                <Textarea
                  :model-value="shapeText"
                  rows="3"
                  size="small"
                  class="w-full"
                  placeholder="Пустое поле удалит подпись"
                  @update:model-value="onShapeTextInput"
                  @blur="commitShapeText"
                />
              </div>

              <div v-if="!details.isShapeText" class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  {{ details.isShapeFillable ? 'Цвет линии' : 'Цвет' }}
                </span>
                <input
                  type="color"
                  :value="details.stroke"
                  class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                  @input="patchShape({ stroke: $event.target.value })"
                />
              </div>

              <div v-if="!details.isShapeText" class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Толщина, px
                </span>
                <InputNumber
                  :model-value="details.strokeWidth"
                  :min="0.5"
                  :max="40"
                  :step="0.5"
                  :max-fraction-digits="1"
                  show-buttons
                  button-layout="horizontal"
                  size="small"
                  input-class="w-12! text-center"
                  class="ml-auto"
                  @update:model-value="(v) => v != null && patchShape({ strokeWidth: v })"
                />
              </div>

              <!-- Заливка — как в редакторе символов: галка «есть/нет» + свотч при
                   включённой (`<input type="color">` состояния «нет цвета» не имеет).
                   Выключение пишет `none`, а не удаляет поле: отсутствие и `none` для
                   отрисовки одно и то же, но патч мержится, а не заменяет фигуру. -->
              <div v-if="details.isShapeFillable" class="flex min-h-8 items-center gap-3">
                <label class="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    :model-value="!!details.fill"
                    binary
                    input-id="shape-fill"
                    @update:model-value="toggleShapeFill"
                  />
                  <span class="text-[11px] uppercase tracking-wider text-surface-500">Заливка</span>
                </label>
                <input
                  v-if="details.fill"
                  type="color"
                  :value="details.fill"
                  class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                  @input="patchShape({ fill: $event.target.value })"
                />
              </div>

              <template v-if="details.isShapeText">
                <div class="flex items-center gap-3">
                  <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                    Размер, pt
                  </span>
                  <InputNumber
                    :model-value="details.fontSize"
                    :min="6"
                    :max="72"
                    :step="1"
                    show-buttons
                    button-layout="horizontal"
                    size="small"
                    input-class="w-12! text-center"
                    class="ml-auto"
                    @update:model-value="(v) => v != null && patchShape({ fontSize: v })"
                  />
                </div>

                <div class="flex items-center gap-3">
                  <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                    Шрифт
                  </span>
                  <Select
                    :model-value="details.fontFamily"
                    :options="FONT_FAMILIES"
                    option-label="label"
                    option-value="value"
                    size="small"
                    class="ml-auto w-40"
                    @update:model-value="(v) => patchShape({ fontFamily: v })"
                  >
                    <template #option="{ option }">
                      <span :style="{ fontFamily: option.value }">{{ option.label }}</span>
                    </template>
                  </Select>
                </div>

                <div class="flex items-center gap-3">
                  <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                    Жирность
                  </span>
                  <SelectButton
                    :model-value="details.bold ? 'bold' : null"
                    :options="BOLD_OPTIONS"
                    option-value="value"
                    data-key="value"
                    size="small"
                    class="ml-auto"
                    @update:model-value="(v) => patchShape({ bold: v === 'bold' })"
                  >
                    <template #option>
                      <span class="font-bold" v-tooltip.top="'Жирный'">B</span>
                    </template>
                  </SelectButton>
                </div>

                <div class="flex items-center gap-3">
                  <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                    Цвет
                  </span>
                  <input
                    type="color"
                    :value="details.stroke"
                    class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                    @input="patchShape({ stroke: $event.target.value })"
                  />
                </div>

                <!-- Выравнивание = якорь роста (как у cell_text): точка привязки
                     стоит на месте, текст растёт от неё. -->
                <div class="flex items-center gap-3">
                  <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                    Выравнивание
                  </span>
                  <SelectButton
                    :model-value="details.shapeAlign"
                    :options="ALIGN_OPTIONS"
                    option-value="value"
                    data-key="value"
                    size="small"
                    class="ml-auto"
                    @update:model-value="(v) => v && patchShape({ align: v })"
                  >
                    <template #option="{ option }">
                      <i :class="option.icon" v-tooltip.top="option.tip" />
                    </template>
                  </SelectButton>
                </div>
              </template>
            </div>
          </template>

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

            <!-- Текстовое поле: редактирование содержимого + стиль. Параметры —
                 строкой «подпись слева, контрол справа» (как в редакторе). Само поле
                 ввода текста — исключение: подпись сверху, инпут во всю ширину. -->
            <div v-if="details.isText" class="space-y-2.5">
              <div>
                <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Текст</div>
                <InputText
                  :model-value="details.text"
                  size="small"
                  class="w-full"
                  placeholder="Введите текст"
                  @update:model-value="applyText"
                />
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Размер, pt
                </span>
                <InputNumber
                  :model-value="details.fontSize"
                  :min="6"
                  :max="72"
                  :step="1"
                  show-buttons
                  button-layout="horizontal"
                  size="small"
                  input-class="w-12! text-center"
                  class="ml-auto"
                  @update:model-value="applyFontSize"
                />
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Шрифт
                </span>
                <!-- Пункты рисуются своим же семейством — выбор виден до применения. -->
                <Select
                  :model-value="details.fontFamily"
                  :options="FONT_FAMILIES"
                  option-label="label"
                  option-value="value"
                  size="small"
                  class="ml-auto w-40"
                  @update:model-value="applyFontFamily"
                >
                  <template #option="{ option }">
                    <span :style="{ fontFamily: option.value }">{{ option.label }}</span>
                  </template>
                </Select>
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Жирность
                </span>
                <SelectButton
                  :model-value="details.bold ? 'bold' : null"
                  :options="BOLD_OPTIONS"
                  option-value="value"
                  data-key="value"
                  size="small"
                  class="ml-auto"
                  @update:model-value="(v) => applyBold(v === 'bold')"
                >
                  <template #option>
                    <span class="font-bold" v-tooltip.top="'Жирный'">B</span>
                  </template>
                </SelectButton>
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Цвет
                </span>
                <input
                  type="color"
                  :value="details.color || '#000000'"
                  class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                  @input="applyColor($event.target.value)"
                />
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Выравнивание
                </span>
                <SelectButton
                  :model-value="details.align"
                  :options="ALIGN_OPTIONS"
                  option-value="value"
                  data-key="value"
                  :allow-empty="false"
                  size="small"
                  class="ml-auto"
                  @update:model-value="applyAlign"
                >
                  <template #option="{ option }">
                    <i :class="option.icon" v-tooltip.top="option.tip" />
                  </template>
                </SelectButton>
              </div>
            </div>

            <!-- cell_value: picker одного полного тега для отображения значения -->
            <div v-else-if="details.isValue">
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                Тег значения
              </div>
              <TagField
                :value="details.valueTag || ''"
                :can-pick="!!project.tags.length"
                @pick="openValueTagPicker"
              />
              <!-- Подпись и единица — свободный ввод: имена тегов в проектах не
                   следуют единой конвенции, угадывать величину по суффиксу нечем. -->
              <div class="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                    Подпись
                  </div>
                  <InputText
                    :model-value="details.valueLabel"
                    size="small"
                    class="w-full"
                    placeholder="Ua"
                    @update:model-value="(v) => applyValueText('valueLabel', v)"
                  />
                </div>
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                    Единица
                  </div>
                  <InputText
                    :model-value="details.valueUnit"
                    size="small"
                    class="w-full"
                    placeholder="В"
                    @update:model-value="(v) => applyValueText('valueUnit', v)"
                  />
                </div>
              </div>
              <!-- Точность значения: уезжает в output.decimals карточки, формат
                   считает рантайм. Пусто = взять из пресета величины/дефолт. -->
              <div class="mt-2 flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Знаков после запятой
                </span>
                <InputNumber
                  :model-value="details.decimals"
                  :min="0"
                  :max="6"
                  :step="1"
                  show-buttons
                  button-layout="horizontal"
                  size="small"
                  input-class="w-12! text-center"
                  class="ml-auto"
                  :placeholder="String(VALUE_DECIMALS_DEFAULT)"
                  @update:model-value="applyValueDecimals"
                />
              </div>
              <!-- Цвет ЗНАЧЕНИЯ: подпись и единица остаются служебно-серыми, иначе
                   карточка теряет различимость. Диапазоны, если привязаны, красят
                   поверх — как у тела шины. -->
              <div class="mt-2 flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Цвет значения
                </span>
                <input
                  type="color"
                  :value="details.color || VALUE_TEXT_COLOR"
                  class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                  @input="applyBodyColor($event.target.value)"
                />
              </div>
            </div>

            <!-- Вид тела шины / точки соединения одним блоком. Цвет БАЗОВЫЙ:
                 привязанные диапазоны и обесточивание заливают его поверх, поэтому в
                 рантайме свой цвет виден, пока ни один animation-класс не активен.
                 Толщина: у шины = высота ячейки, у точки = диаметр; минимум — дефолт
                 (тоньше тело сливается с проводами, точка — с их пересечением). -->
            <div v-if="details.isBus || details.isNode" class="space-y-2.5">
              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Цвет
                </span>
                <input
                  type="color"
                  :value="details.color || BUS_COLOR_DEFAULT"
                  class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                  @input="applyBodyColor($event.target.value)"
                />
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Толщина, px
                </span>
                <InputNumber
                  :model-value="details.thickness"
                  :min="details.thicknessMin"
                  :max="details.thicknessMax"
                  :step="1"
                  show-buttons
                  button-layout="horizontal"
                  size="small"
                  input-class="w-12! text-center"
                  class="ml-auto"
                  @update:model-value="applyThickness"
                />
              </div>
            </div>

            <!-- Навигация (hyperlink на другую форму при клике в рантайме). Цель —
                 id формы проекта (= view-id рантайма): можно выбрать из списка форм ИЛИ
                 ввести view-id вручную (editable) — напр. для view, которой ещё нет в
                 проекте. Свич справа от заголовка показывает/скрывает поле; выключение
                 очищает значение. -->
            <div v-if="!details.isText" class="space-y-2">
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

          <!-- Анимации: не у подписи/значения и не у фигуры-разметки (у последней их
               нет вовсе — exporter не эмитит для неё карточек, привязка вела бы в никуда). -->
          <div v-if="!details.isText && !details.isValue && !details.isShape" class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>

            <!-- Символ «по значению»: привязка тега сигнала (состояния и их вид
                 запечены в символе, здесь только тег-драйвер). -->
            <div v-if="valueStateSlot" class="border border-surface-200 rounded p-3 bg-surface-0">
              <div class="flex items-center gap-2 mb-2 min-h-6">
                <i class="pi pi-sitemap text-purple-500" />
                <div class="text-xs font-medium text-surface-700">Состояние по значению</div>
              </div>
              <div class="text-[11px] text-surface-500 mb-1">
                Тег
                <span class="text-surface-400">- сигнал, значение выбирает состояние</span>
              </div>
              <TagField
                :value="valueStateSlot.value"
                :can-pick="!!project.tags.length"
                highlightable
                @pick="openSlotPicker(valueStateSlot)"
                @highlight="canvas.toggleHighlightedTag(valueStateSlot.value)"
              />
            </div>

            <!-- Булево значение — виден ВСЕГДА. У символа с булевым слотом
                 (onoff, в т.ч. cell_alr) первой строкой идёт этот слот (основной
                 тег), ниже — зависимости boolSource. Теги пишутся лениво через
                 «Добавить»; × очищает (boolRemovable). -->
            <BooleanBlock
              :slot-info="details.hasBoolSlot ? details.slots[0] : null"
              :groups="boolGroups"
              :removable="boolRemovable"
              :tags-loaded="!!project.tags.length"
              :copyable="!!(details.onoffTag || boolGroups.length)"
              :pasteable="animClip.hasBool.value"
              title="Булево значение"
              @open-slot-picker="openSlotPicker(details.slots[0])"
              @add-group="onAddGroup"
              @add-tag="onAddBoolTag"
              @edit-tag="editBoolTagAt"
              @remove-tag="removeBoolTagAt"
              @remove-group="removeBoolGroup"
              @remove="clearBoolGroups"
              @highlight-tag="canvas.toggleHighlightedTag"
              @copy="copyBool"
              @paste="pasteBool"
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
