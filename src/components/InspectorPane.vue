<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleButton from 'primevue/togglebutton'
import ToggleSwitch from 'primevue/toggleswitch'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import { useProjectStore } from '../stores/useProjectStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useUiStore } from '../stores/useUiStore'
import { getStencilById, isSwitchStencil } from '../stencils/registry'
import {
  injectStencilSvg,
  TEXT_FONT_SIZE,
  TEXT_SIZE_PRESETS,
  textCellHeight,
  textCellWidth,
  resolveValueDisplay,
} from '../stencils/svgInjector'
import { nplural } from '../utils/plural'
import { normalizeSwitchSources } from '../utils/switchSources'
import TagPickerDialog from './TagPickerDialog.vue'
import VoltageSourceBlock from './VoltageSourceBlock.vue'
import AlarmSourceBlock from './AlarmSourceBlock.vue'
import SwitchBlock from './SwitchBlock.vue'
import {
  ANIMATION_CLASS_COLORS,
  ANIMATION_CLASS_OPTIONS,
  ANIMATION_OFF_COLOR,
  CLASS_OFF,
  CLASS_HIDDEN,
} from '../constants/animation'
import { hasSlotPlaceholder } from '../constants/ids'

// Дефолтные диапазоны voltage-source. .map(({...r})) на каждое использование —
// чтобы ячейки не делили один и тот же массив.
//
// max-границы укорочены на 0.01: WebScada condition-evaluator inclusive по
// обоим концам (`>=min && <=max`). При max=4/4/7 значение 4 матчило бы и low,
// и mid одновременно — итоговый цвет зависел бы от порядка CSS-правил, а не
// от данных. Та же логика что для quality `[0, 191]` (max=191, не 192).
const VOLTAGE_RANGE_DEFAULTS = [
  { min: 0, max: 3.99, class: 'animation-low' },
  { min: 4, max: 6.99, class: 'animation-mid' },
  { min: 7, max: 10, class: 'animation-high' },
]

// «Layout-only» стенсилы (флаг `layoutOnly: true` в stencil.json) — без
// визуальной реакции на animation-классы; voltage/switch source на них
// бессмыслен, в multi-select их пропускаем.
function isLayoutOnly(stencilId) {
  return !!getStencilById(stencilId)?.layoutOnly
}

// Bool-тег по типу из tag-list (Boolean/Bool, регистронезависимо). Булевы слоты
// (cell_qw / cell_alr / …) и switchSources выбирают только из таких: тип из
// tag-list'а надёжнее суффикса имени (.ONOFF / .ALR).
const isBooleanType = (type) => /^bool/i.test(type || '')

const canvas = useCanvas()
const project = useProjectStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()
const notify = useNotify()

// Computed-и читают canvas.graphVersion, чтобы пересчитываться при изменениях графа
// (JointJS-модели не Vue-reactive, ловим через явный version-tick).
const details = computed(() => {
  canvas.graphVersion.value // touch для reactive-зависимости
  const sel = canvas.singleSelection.value // мульти-режим обрабатывается отдельно
  const graph = canvas.graphRef.value
  if (!sel || !graph) return null
  const cell = graph.getCell(sel.id)
  if (!cell) return null

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
      isText: tms.stencilId === 'cell_text',
      text: tms.text ?? '',
      fontSize: tms.fontSize ?? TEXT_FONT_SIZE,
      bold: !!tms.bold,
      isValue: tms.stencilId === 'cell_value',
      valueTag: tms.valueTag ?? '',
      // cell_alr рендерит свой required-слот через AlarmSourceBlock (с описанием,
      // bell-иконкой, без отдельной строки в «Привязки тегов»). Булев источник для
      // тревоги бессмыслен — кнопку «Булев источник» прячем тоже.
      isAlarm: tms.stencilId === 'cell_alr',
      // Стенсилы со slot.onoff (cell_qw / qr / qk / qf — см. isSwitchStencil
      // convention в registry) рендерят слот через SwitchBlock первой строкой
      // (intrinsic), а не отдельной строкой в «Привязках тегов» — чтобы тег не
      // показывался дважды.
      isSwitch: isSwitchStencil(stencil),
      // Тег самого свитча (slot.onoff) — для исключения из switchSources-зависимостей.
      // Из payload (tms.slots.onoff), как и multi-select; не по индексу slots[0].
      onoffTag: slotValues.onoff || '',
      // Слоты для UI: декларация из стенсила + текущее значение из tms.slots.
      // type — тип тега (Boolean/Float/…); picker фильтрует bool-слоты по нему.
      // tooltip — встроенные правила анимации для этого слота (см. buildSlotTooltip),
      // показываем как HTML-tooltip на info-иконке рядом с лейблом слота.
      slots: slotsDef.map((s) => ({
        key: s.key,
        label: s.label,
        type: s.type,
        required: !!s.required,
        value: slotValues[s.key] || '',
        tooltip: buildSlotTooltip(s.key, stencil?.animationTemplate),
      })),
      voltageSource: tms.voltageSource || null,
      switchSources: tms.switchSources || null,
      navigation: tms.navigation || '',
    }
  }

  if (sel.kind === 'link') {
    const source = cell.get('source')
    const target = cell.get('target')
    const sourceCell = source?.id ? graph.getCell(source.id) : null
    const targetCell = target?.id ? graph.getCell(target.id) : null
    const tms = cell.get('tms') || {}
    // Label endpoint'а — стенсильный label, либо id ячейки в fallback.
    const endpointLabel = (c) => {
      const st = c?.get('tms')?.stencilId
      return (st && getStencilById(st)?.label) || '-'
    }
    return {
      kind: 'link',
      id: cell.id,
      sourceLabel: endpointLabel(sourceCell),
      sourcePort: source?.port || '-',
      targetLabel: endpointLabel(targetCell),
      targetPort: target?.port || '-',
      voltageSource: tms.voltageSource || null,
      switchSources: tms.switchSources || null,
    }
  }

  return null
})

// ─── Удаление ───
function onDelete() {
  canvas.deleteItems([...canvas.selection.value])
}

// ─── Единый tag-picker ───
// Все места открывают один диалог через openPicker(config). tags/selected/header
// снимаются в момент открытия (во время открытого диалога tag-list не меняется);
// onSelect — что делать с выбранным тегом. picker=null → диалог закрыт.
const picker = ref(null)

function openPicker(config) {
  picker.value = { selected: '', tags: [], header: 'Выберите тег', ...config }
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
    tags: isBooleanType(slot?.type) ? booleanTags.value : project.tags,
    selected: slot?.value || '',
    header: `Выберите тег: ${slot.label}`,
    onSelect: (tag) => patchSlotTag(slot.key, tag),
  })
}

// Внешний запрос на «открой picker первого пустого required-слота» — приходит
// от клика по slot-warning badge на холсте (см. CanvasPane.onSlotBadgeClick).
// К моменту срабатывания canvas.selection уже выставлен на нужную ячейку, и
// details.slots реактивно обновился — берём из него первый пустой required.
watch(
  () => canvas.slotPickRequest.value,
  () => {
    const d = details.value
    if (!d || d.kind !== 'cell') return
    const empty = (d.slots || []).find((s) => s.required && !s.value)
    if (empty && project.tags.length) openSlotPicker(empty)
  }
)

/**
 * Каркас правки выделенной ЯЧЕЙКИ (не линка): резолвит cell + её stencil и
 * отдаёт { cell, stencil, tms, d } в fn. fn сам мутирует cell (cell.set('tms',…),
 * при нужде resize). Вернул false → выходим без перерисовки и snapshot'а (нечего
 * менять). reinject:true — перерисовать SVG ячейки (новые bindings) после fn.
 * Финал — bumpVersion + requestSnapshot один раз.
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

/** Записывает тег в слот ячейки + перерисовывает SVG (новые bindings). */
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

// ─── Редактирование текста (стенсил cell_text) ───
function applyText(newText) {
  patchTextCell({ text: newText })
}

/** Общий апдейт tms текстового поля + ресайз cell'а под актуальный текст/шрифт/жирность. */
function patchTextCell(patch) {
  withSelectedCell(
    ({ cell, tms, d }) => {
      if (!d.isText) return false
      // Если ничего реально не меняется — выходим, чтобы не плодить snapshot'ы.
      const next = { ...tms, ...patch }
      const same =
        next.text === tms.text && next.fontSize === tms.fontSize && next.bold === tms.bold
      if (same) return false
      cell.set('tms', next)
      // Размер cell'а подгоняем и по ширине (под содержимое), и по высоте (под шрифт) —
      // hit-area тогда совпадает с реально отображаемым текстом, inline-X прижимается к нему.
      const fontSize = next.fontSize ?? TEXT_FONT_SIZE
      const bold = !!next.bold
      cell.resize(textCellWidth(next.text ?? '', fontSize, bold), textCellHeight(fontSize))
    },
    { reinject: true }
  )
}

function applyFontSize(size) {
  patchTextCell({ fontSize: size })
}

function applyBold(value) {
  patchTextCell({ bold: value })
}

// ─── Диапазоны значений (аналоговый источник: значение тега → класс по диапазону) ───
function openVoltagePicker() {
  openPicker({
    tags: project.tags,
    selected: details.value?.voltageSource?.tag || '',
    header: 'Выберите тег (диапазоны значений)',
    onSelect: onPickTag,
  })
}

function openMultiVoltagePicker() {
  openPicker({
    tags: project.tags,
    header: 'Тег диапазонов для всех выделенных элементов',
    onSelect: onPickMultiVoltageTag,
  })
}

// ─── Tag-picker для cell_value (отображаемый тег) ───
function openValueTagPicker() {
  openPicker({
    tags: project.tags,
    selected: details.value?.valueTag || '',
    header: 'Выберите тег для отображения значения',
    onSelect: onPickValueTag,
  })
}

const valueDisplay = computed(() => {
  if (!details.value?.isValue) return null
  return resolveValueDisplay(details.value.valueTag)
})

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

/**
 * Патч tms-поля (voltageSource / switchSources) выделенной ячейки.
 * patch=null — удаляет источник целиком; иначе мержит в существующий объект.
 */
function patchTmsField(field, patch) {
  mutateSelectedTms((tms) => ({
    ...tms,
    [field]: patch === null ? null : { ...(tms[field] || {}), ...patch },
  }))
}

const patchVoltageSource = (patch) => patchTmsField('voltageSource', patch)

function removeVoltageSource() {
  patchVoltageSource(null)
}

function onPickTag(tag) {
  // Если voltageSource ещё не существует (add-flow без созданной карточки),
  // создаём её с дефолтными диапазонами; иначе обновляем только тег.
  const d = details.value
  if (d?.voltageSource) {
    patchVoltageSource({ tag })
  } else {
    patchVoltageSource({
      tag,
      ranges: VOLTAGE_RANGE_DEFAULTS.map((r) => ({ ...r })),
    })
  }
}

// Правка одного порога: возвращает новый массив ranges либо null, если ввод
// невалиден. min/max — числа; нечисловой ввод (пустая строка, '3,99', буквы)
// дал бы NaN, который молча сломал бы диапазон при экспорте → правку игнорируем.
function editRanges(ranges, idx, field, value) {
  let parsed = value
  if (field !== 'class') {
    parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
  }
  return ranges.map((r, i) => (i === idx ? { ...r, [field]: parsed } : r))
}

function updateRange(idx, field, value) {
  const vs = details.value?.voltageSource
  if (!vs?.ranges) return
  const ranges = editRanges(vs.ranges, idx, field, value)
  if (ranges) patchVoltageSource({ ranges })
}

/** «Подсветить на схеме»: toggle подсветки элементов с тем же voltageSource.tag. */
function toggleVoltageHighlight() {
  const tag = details.value?.voltageSource?.tag
  if (!tag) {
    notify.warn('Тег не выбран', 'Выберите тег источника, чтобы подсветить элементы с тем же тегом')
    return
  }
  canvas.toggleHighlightedTag(tag)
}

// ─── Multi-select voltage: локальный шаблон (тег + пороги) ───
// У выделения нет общего voltageSource, поэтому держим шаблон здесь и раздаём
// его на все выделенные при каждой правке («применить ко всем»). Сброс при смене
// состава выделения — новое выделение начинает с чистого блока.
const multiVoltage = ref(null) // { tag, ranges } | null

watch(
  () => canvas.selection.value.map((i) => i.id).join('|'),
  () => {
    multiVoltage.value = null
  }
)

/** Прогон по выделению: резолвит ячейки, пропускает layoutOnly (текст/значение),
 *  зовёт fn(cell, tms), затем один bumpVersion + requestSnapshot. */
function forEachSelectedCell(fn) {
  const graph = canvas.graphRef.value
  if (!graph) return
  for (const item of canvas.selection.value) {
    const cell = graph.getCell(item.id)
    if (!cell) continue
    const tms = cell.get('tms') || {}
    if (isLayoutOnly(tms.stencilId)) continue
    fn(cell, tms)
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

/** Раздать текущий шаблон диапазонов на всё выделение (клон на ячейку, без общих ссылок). */
function applyMultiVoltage() {
  if (!multiVoltage.value) return
  forEachSelectedCell((cell, tms) =>
    cell.set('tms', { ...tms, voltageSource: structuredClone(multiVoltage.value) })
  )
}

function onPickMultiVoltageTag(tag) {
  if (!tag) return
  const prev = multiVoltage.value
  multiVoltage.value = {
    tag,
    ranges: prev?.ranges ?? VOLTAGE_RANGE_DEFAULTS.map((r) => ({ ...r })),
  }
  applyMultiVoltage()
}

/** Правка порога в шаблоне → перераздача на всё выделение. */
function updateMultiVoltageRange(idx, field, value) {
  const vs = multiVoltage.value
  if (!vs?.ranges) return
  const ranges = editRanges(vs.ranges, idx, field, value)
  if (!ranges) return
  multiVoltage.value = { ...vs, ranges }
  applyMultiVoltage()
}

/** × — снять диапазоны со всех выделенных и очистить шаблон. */
function removeMultiVoltage() {
  multiVoltage.value = null
  forEachSelectedCell((cell, tms) => {
    if (!tms.voltageSource) return
    const next = { ...tms }
    delete next.voltageSource
    cell.set('tms', next)
  })
}

function toggleMultiVoltageHighlight() {
  const tag = multiVoltage.value?.tag
  if (tag) canvas.toggleHighlightedTag(tag)
}

// ─── switchSources: два списка булевых зависимостей ───
// `or` («Параллельно») — достаточно любого = true; `and` («Последовательно») —
// нужны все = true. Активен = (любой or = true) ИЛИ (все and = true). Экспорт:
// чистый and → дешёвый shape, иначе → multi-карточка.

// В какую секцию кладёт массовая привязка: 'or' (Параллельно) | 'and' (Последовательно).
// Выставляется кнопкой перед открытием picker'а.
const multiSwitchBucket = ref('or')
// Цель добавления/замены: { bucket: 'parallel'|'series', idx }. idx=null —
// добавить новый, число — заменить по индексу. bucket=null — пасс (cancel).
const editingSwitch = ref({ bucket: null, idx: null })

// Канонические списки switchSources текущей ячейки (нормализует старую форму).
const switchBuckets = computed(() => normalizeSwitchSources(details.value?.switchSources))

// Показывать × «Удалить все зависимости» в шапке блока. У intrinsic-свитча
// (cell_qw) блок виден всегда из-за slot.onoff — × имеет смысл ТОЛЬКО когда есть
// теги-зависимости (иначе чистить нечего, клик был бы no-op'ом: slot.onoff им не
// удаляется). У не-свитча блок появляется лишь при наличии switchSources, и ×
// убирает его целиком (в т.ч. пустой) — там достаточно самого факта присутствия.
const switchRemovable = computed(() =>
  details.value?.isSwitch
    ? switchBuckets.value.or.length > 0 || switchBuckets.value.and.length > 0
    : !!details.value?.switchSources
)

const bucketField = (bucket) => (bucket === 'parallel' ? 'or' : 'and')

/** Полная замена switchSources на { or, and }; оба пусты → удаляем источник. */
function writeSwitchBuckets(buckets) {
  mutateSelectedTms((tms) => ({
    ...tms,
    switchSources:
      buckets.or.length || buckets.and.length ? { or: buckets.or, and: buckets.and } : null,
  }))
}

/** Открыть picker switch-зависимости. editingSwitch уже выставлен (add/replace);
 *  switchPickerTags читаем ПОСЛЕ этого — picker берёт актуальный фильтр исключений. */
function openSwitchPicker() {
  openPicker({
    tags: switchPickerTags.value,
    header: 'Добавить булев тег',
    onSelect: onPickSwitchTag,
  })
}

/** «Добавить» в секцию bucket. */
function onAddSwitchTag(bucket) {
  editingSwitch.value = { bucket, idx: null }
  openSwitchPicker()
}

/** Клик по тегу-зависимости → замена по индексу в секции bucket. */
function editSwitchTagAt(bucket, idx) {
  editingSwitch.value = { bucket, idx }
  openSwitchPicker()
}

function removeSwitchSources() {
  writeSwitchBuckets({ or: [], and: [] })
}

/**
 * Picker вернул тег → пишем в editingSwitch.bucket (add при idx=null, replace
 * при числе). Дубли в любой из секций игнорируем — один выключатель не может
 * быть и параллельным, и последовательным вводом. Основной тег стенсила
 * (slot.onoff) в зависимости не допускаем.
 */
function onPickSwitchTag(tag) {
  const d = details.value
  const { bucket, idx } = editingSwitch.value
  editingSwitch.value = { bucket: null, idx: null }
  if (!bucket || !tag) return
  if (d?.isSwitch && d.onoffTag === tag) return

  const buckets = normalizeSwitchSources(d?.switchSources)
  const field = bucketField(bucket)
  const list = [...buckets[field]]
  if (idx !== null) {
    if (list[idx] === tag) return
    list[idx] = tag
  } else {
    if (buckets.or.includes(tag) || buckets.and.includes(tag)) return
    list.push(tag)
  }
  writeSwitchBuckets({ ...buckets, [field]: [...new Set(list)] })
}

function removeSwitchTagAt(bucket, idx) {
  const buckets = normalizeSwitchSources(details.value?.switchSources)
  const field = bucketField(bucket)
  writeSwitchBuckets({ ...buckets, [field]: buckets[field].filter((_, i) => i !== idx) })
}

/** Открыть picker массовой привязки булева тега. `bucket` — ключ секции
 * SwitchBlock ('series'|'parallel'), маппим в поле switchSources ('and'|'or'). */
function openMultiSwitchPicker(bucket) {
  multiSwitchBucket.value = bucketField(bucket)
  openPicker({
    tags: booleanTags.value,
    header: 'Булев тег для всех выделенных элементов',
    onSelect: onPickMultiSwitchTag,
  })
}

/** Multi-select: добавить тег в switchSources всех выделенных (не дублируя). */
function onPickMultiSwitchTag(tag) {
  const graph = canvas.graphRef.value
  if (!graph || !tag) return
  const sel = canvas.selection.value
  if (!sel.length) return
  let applied = 0
  let skipped = 0
  for (const item of sel) {
    const cell = graph.getCell(item.id)
    if (!cell) continue
    const tms = cell.get('tms') || {}
    if (isLayoutOnly(tms.stencilId)) {
      skipped++
      continue
    }
    // Свитчи (стенсилы с slot.onoff) не должны зависеть от своего же тега —
    // slot.onoff уже отвечает за переключение, дубль в switchSources бессмыслен.
    if (isSwitchStencil(getStencilById(tms.stencilId)) && tms.slots?.onoff === tag) {
      skipped++
      continue
    }
    // Кладём в секцию, выбранную кнопкой (or = Параллельно, and = Последовательно).
    // Тег уже в любой из секций → пропускаем (в обеих сразу он бессмыслен).
    const buckets = normalizeSwitchSources(tms.switchSources)
    if (buckets.or.includes(tag) || buckets.and.includes(tag)) {
      applied++
      continue
    }
    const field = multiSwitchBucket.value
    const next = { or: [...buckets.or], and: [...buckets.and] }
    next[field].push(tag)
    cell.set('tms', { ...tms, switchSources: next })
    applied++
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
  const count = nplural(applied, 'элемент', 'элемента', 'элементов')
  notify.success(
    'Булев тег привязан',
    skipped > 0
      ? `Привязано к ${count} · пропущено: ${skipped} (текст/значение/свой тег)`
      : `Привязано к ${count}`
  )
}

// ─── Hyperlink-навигация: клик в рантайме открывает другую view ───
// Свич управляет видимостью инпута; пустое значение не пишется, при OFF — чистим.
const navigationEnabled = ref(false)
// Источник watch'а — МАССИВ ГЕТТЕРОВ [id, navigation], а не один getter,
// возвращающий [id, navigation]: одиночный getter отдаёт новый массив каждый
// раз → Object.is всегда false → callback стрелял бы на каждый bumpVersion
// (тумблер сбрасывался бы при любом движении ячейки). Массив геттеров даёт
// поэлементный diff: ресинк только когда реально сменился id (другая ячейка)
// или navigation (undo/redo на той же ячейке).
watch(
  [() => details.value?.id, () => details.value?.navigation],
  () => {
    navigationEnabled.value = !!details.value?.navigation
  },
  { immediate: true }
)
function toggleNavigationEnabled(value) {
  navigationEnabled.value = value
  if (!value) patchNavigation('')
}

function patchNavigation(value) {
  if (details.value?.kind !== 'cell') return
  mutateSelectedTms((tms) => {
    const trimmed = String(value || '').trim()
    if ((tms.navigation || '') === trimmed) return undefined
    const next = { ...tms }
    if (trimmed) next.navigation = trimmed
    else delete next.navigation
    return next
  })
}

// Цель навигации — форма проекта (id формы = имя папки = view-id рантайма).
// Себя в список не кладём (переход на текущую форму бессмыслен). Если у ячейки
// сохранена цель, которой больше нет в проекте (импорт/переименование/удаление),
// держим её первой опцией с пометкой — чтобы не потерять значение молча и дать
// перевыбрать. navBroken подсвечивает такую ссылку как нерабочую.
const navTargets = computed(() => {
  const ids = workspace.formIds.filter((id) => id !== workspace.activeFormId)
  const opts = ids.map((id) => ({ label: id, value: id }))
  const cur = details.value?.navigation
  if (cur && !workspace.formIds.includes(cur)) {
    opts.unshift({ label: `${cur} — нет в проекте`, value: cur })
  }
  return opts
})
const navBroken = computed(() => {
  const cur = details.value?.navigation
  return !!cur && !workspace.formIds.includes(cur)
})

// Цветовая карта для swatch'ей в подсказке-тултипе слота.
// Voltage-палитра + off — те же значения попадают в CSS экспорта/симуляции.
const BINDING_CLASS_COLORS = {
  ...ANIMATION_CLASS_COLORS,
  [CLASS_OFF]: ANIMATION_OFF_COLOR,
}

/**
 * Правила animationTemplate для конкретного слота — для info-tooltip'а
 * рядом со слотом. Дубликаты схлопываются.
 */
function slotBindingRules(slotKey, animationTemplate) {
  const rules = []
  for (const tpl of animationTemplate || []) {
    for (const binding of tpl.bindings || []) {
      if (!hasSlotPlaceholder(binding.tag, slotKey)) continue
      const when = binding.when || {}
      if (when.type === 'map' && when.cases) {
        for (const [value, action] of Object.entries(when.cases)) {
          const cls = action?.apply?.addClass
          if (!cls) continue
          rules.push({
            condition: `= ${value}`,
            applyClass: cls,
            color: BINDING_CLASS_COLORS[cls] || null,
            hidden: cls === CLASS_HIDDEN,
          })
        }
      } else if (when.type === 'range' && Array.isArray(when.cases)) {
        for (const range of when.cases) {
          const cls = range.apply?.addClass
          if (!cls) continue
          rules.push({
            condition: `в [${range.min}, ${range.max})`,
            applyClass: cls,
            color: BINDING_CLASS_COLORS[cls] || null,
            hidden: cls === CLASS_HIDDEN,
          })
        }
      }
    }
  }
  const seen = new Set()
  return rules.filter((r) => {
    const k = `${r.condition}→${r.applyClass}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** HTML-объект для v-tooltip: правила со swatch'ами. null = иконку не рендерить. */
function buildSlotTooltip(slotKey, animationTemplate) {
  const rules = slotBindingRules(slotKey, animationTemplate)
  if (!rules.length) return null
  const items = rules
    .map((r) => {
      const swatch = r.color
        ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${r.color};vertical-align:middle;margin-right:4px;border:1px solid rgba(0,0,0,0.15)"></span>`
        : r.hidden
          ? `<i class="pi pi-eye-slash" style="font-size:10px;margin-right:4px;opacity:0.7"></i>`
          : ''
      return `<li style="margin-bottom:2px">тег ${r.condition} → ${swatch}<code style="font-size:10px">${r.applyClass}</code></li>`
    })
    .join('')
  return {
    value: `<div style="min-width:160px"><div style="margin-bottom:4px;font-weight:600;font-size:11px">Поведение анимации:</div><ul style="margin:0;padding-left:14px;font-size:11px;list-style:disc">${items}</ul></div>`,
    escape: false,
    showDelay: 300,
  }
}

// switchSources принимает только bool-теги — эффект «false → затемнение»,
// для аналогового значения бессмыслен. Фильтр по типу из tag-list'а.
const booleanTags = computed(() => project.tags.filter((t) => isBooleanType(t.type)))

// Picker для switch-зависимостей исключает уже привязанные теги: основной
// тег ячейки (slot.onoff у cell_qw) + все теги из обеих секций switchSources
// (or/and), кроме редактируемого по индексу (его оставляем, чтобы юзер видел
// текущее значение).
const switchPickerTags = computed(() => {
  const d = details.value
  if (!d) return booleanTags.value
  const excluded = new Set()
  if (d.isSwitch && d.onoffTag) excluded.add(d.onoffTag)
  // Исключаем уже привязанные теги (из обеих секций), КРОМЕ редактируемого
  // сейчас по индексу — его оставляем, чтобы юзер видел текущее значение.
  const { or, and } = normalizeSwitchSources(d.switchSources)
  const { bucket, idx } = editingSwitch.value
  const editField = bucket === 'parallel' ? 'or' : bucket === 'series' ? 'and' : null
  const excludeList = (list, field) =>
    list.forEach((t, i) => {
      if (t && !(field === editField && i === idx)) excluded.add(t)
    })
  excludeList(or, 'or')
  excludeList(and, 'and')
  return booleanTags.value.filter((t) => !excluded.has(t.name))
})
</script>

<template>
  <aside class="h-full flex flex-col bg-surface-50 border-l border-surface-200">
    <div class="min-h-16 px-4 py-3 border-b border-surface-200 flex items-center">
      <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Инспектор</h2>
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm">
      <!-- Multi-select: больше одного элемента — показываем сводку + удаление -->
      <template v-if="canvas.selection.value.length > 1">
        <div class="[&>*+*]:border-t [&>*+*]:border-surface-200 [&>*+*]:pt-4 [&>*+*]:mt-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Выделено</div>
            <div class="font-medium text-surface-900">
              {{ nplural(canvas.selection.value.length, 'элемент', 'элемента', 'элементов') }}
            </div>
            <p class="text-[11px] text-surface-500 mt-2">
              Ячейки можно тащить группой, удалить клавишей Del. Анимации ниже применяются ко всему
              выделению; остальные свойства — при одном выделенном.
            </p>
          </div>

          <!-- Multi-select: те же блоки, что в single, как «применить ко всем»
               (общего состояния у выделения нет → списки пустые/шаблон, выбор тега
               и порогов раздаётся на всё выделение). Булев — SwitchBlock с пустыми
               секциями (поле «- не выбран -» → во все). Voltage — шаблон multiVoltage:
               задаёшь тег → правишь пороги → раздаётся на все выделенные. -->
          <div class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>
            <SwitchBlock
              :slot-info="null"
              :parallel="[]"
              :series="[]"
              :removable="false"
              :tags-loaded="!!project.tags.length"
              title="Булев источник"
              @open-tag-picker="openMultiSwitchPicker"
            />
            <VoltageSourceBlock
              :voltage-source="multiVoltage"
              :tags-loaded="!!project.tags.length"
              :class-options="ANIMATION_CLASS_OPTIONS"
              @open-tag-picker="openMultiVoltagePicker"
              @update-range="updateMultiVoltageRange"
              @highlight="toggleMultiVoltageHighlight"
              @remove="removeMultiVoltage"
            />
          </div>

          <div class="pt-2 border-t border-surface-200">
            <Button
              :label="`Удалить (${canvas.selection.value.length})`"
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
        <div class="flex flex-col items-center text-center text-surface-400 py-10">
          <i class="pi pi-mouse text-3xl mb-3 opacity-60" />
          <div class="text-sm font-medium text-surface-500 mb-1">Ничего не выделено</div>
          <p class="text-[11px] leading-relaxed max-w-[180px]">
            Кликни по ячейке или проводу на холсте - здесь появятся свойства
          </p>
          <!-- CTA когда tag-list ещё не загружен — без него анимации стенсилов
 не работают, юзеру полезно увидеть кнопку сразу при пустом инспекторе. -->
          <Button
            v-if="!project.tags.length"
            label="Загрузить tag-list…"
            icon="pi pi-upload"
            severity="secondary"
            size="small"
            outlined
            class="mt-4"
            @click="ui.requestTagListLoad"
          />
        </div>
      </template>

      <template v-else-if="details">
        <div class="[&>*+*]:border-t [&>*+*]:border-surface-200 [&>*+*]:pt-4 [&>*+*]:mt-4">
          <template v-if="details.kind === 'cell'">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Стенсил</div>
              <div class="font-medium text-surface-900">
                {{ details.stencilLabel }}
              </div>
              <div class="text-[11px] text-surface-500 font-mono">
                {{ details.stencilId }}
              </div>
            </div>

            <!-- Текстовое поле: редактирование содержимого + стиль -->
            <div v-if="details.isText" class="space-y-3">
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

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                    Размер
                  </div>
                  <!-- allow-empty=false — один размер всегда активен; клик по
                       выбранному не снимает выделение (иначе fontSize → undefined). -->
                  <SelectButton
                    :model-value="details.fontSize"
                    :options="TEXT_SIZE_PRESETS"
                    option-label="label"
                    option-value="size"
                    :allow-empty="false"
                    size="small"
                    @update:model-value="applyFontSize"
                  />
                </div>
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                    Жирность
                  </div>
                  <ToggleButton
                    :model-value="details.bold"
                    on-label="B"
                    off-label="B"
                    size="small"
                    class="!font-bold"
                    v-tooltip.top="'Жирный'"
                    @update:model-value="applyBold"
                  />
                </div>
              </div>
            </div>

            <!-- cell_value: picker одного полного тега для отображения значения -->
            <div v-else-if="details.isValue">
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                Тег значения
              </div>
              <div class="flex items-center gap-2">
                <code
                  class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
                  :class="project.tags.length ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
                  :title="
                    project.tags.length ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'
                  "
                  @click="project.tags.length && openValueTagPicker()"
                >
                  {{ details.valueTag || '- не выбран -' }}
                </code>
              </div>
              <Button
                v-if="!project.tags.length"
                label="Загрузить tag-list…"
                icon="pi pi-upload"
                severity="secondary"
                size="small"
                text
                class="!p-1 mt-1 !text-[11px]"
                @click="ui.requestTagListLoad"
              />
              <div
                v-if="details.valueTag && valueDisplay"
                class="text-[11px] text-surface-500 mt-2 font-mono"
              >
                Подпись:
                <span class="text-surface-700">{{ valueDisplay.label }}</span>
                <template v-if="valueDisplay.unit">
                  · единица:
                  <span class="text-surface-700">{{ valueDisplay.unit }}</span>
                </template>
              </div>
            </div>

            <!-- Навигация (hyperlink на другую форму при клике в рантайме). Цель —
 форма проекта (её id = view-id рантайма), поэтому выбор из списка форм,
 а не свободный ввод: исключает опечатки и битые ссылки. Свич справа от
 заголовка показывает/скрывает селект; выключение очищает значение. -->
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
                <Select
                  :model-value="details.navigation"
                  :options="navTargets"
                  option-label="label"
                  option-value="value"
                  size="small"
                  placeholder="Выберите форму"
                  class="w-full !text-xs"
                  :class="navBroken ? '!border-red-400' : ''"
                  @update:model-value="patchNavigation"
                />
                <div v-if="navBroken" class="text-[11px] text-red-500">
                  Формы нет в проекте — ссылка не сработает
                </div>
                <div v-else-if="!navTargets.length" class="text-[11px] text-surface-500">
                  В проекте нет других форм
                </div>
              </template>
            </div>

            <!-- Слоты стенсила: каждый слот = один тег, который попадёт в
 соответствующие bindings шаблона при экспорте.
 cell_alr / switch-стенсилы (isSwitch) рендерят свой единственный required-слот в
 специальном Alarm/Switch-блоке внутри секции «Анимации» — поэтому
 общий slot-row для них скрываем, чтобы тег не показывался дважды. -->
            <div
              v-if="details.slots.length && !details.isAlarm && !details.isSwitch"
              class="space-y-2"
            >
              <div class="text-[11px] uppercase tracking-wider text-surface-500">
                Привязки тегов
              </div>
              <div v-for="slot in details.slots" :key="slot.key" class="space-y-1">
                <div class="flex items-center gap-2 text-[11px] text-surface-500">
                  <span>{{ slot.label }}</span>
                  <span
                    v-if="slot.required && !slot.value"
                    class="text-amber-500"
                    title="Обязательно для работы анимации"
                  >
                    *
                  </span>
                  <!-- info-иконка с тултипом: правила встроенной анимации стенсила,
 реагирующие на этот слот (описание по наведению, чтобы не засорять панель).
 Если у слота нет реактивных правил — иконку не рендерим. -->
                  <i
                    v-if="slot.tooltip"
                    v-tooltip.bottom="slot.tooltip"
                    class="pi pi-info-circle text-surface-400 cursor-help text-[11px]"
                  />
                  <!-- Тип тега, ожидаемого слотом (Boolean/Float/…) — справа от лейбла. -->
                  <span v-if="slot.type" class="text-surface-400 ml-auto font-mono">
                    {{ slot.type }}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <code
                    class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
                    :class="[
                      project.tags.length ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                      slot.required && !slot.value ? 'border border-amber-500/40' : '',
                    ]"
                    :title="
                      project.tags.length ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'
                    "
                    @click="project.tags.length && openSlotPicker(slot)"
                  >
                    {{ slot.value || '- не выбран -' }}
                  </code>
                  <Button
                    v-if="slot.value"
                    icon="pi pi-times"
                    severity="secondary"
                    text
                    size="small"
                    title="Очистить"
                    @click="patchSlotTag(slot.key, '')"
                  />
                </div>
              </div>
              <Button
                v-if="!project.tags.length"
                label="Загрузить tag-list…"
                icon="pi pi-upload"
                severity="secondary"
                size="small"
                text
                class="!p-1 !text-[11px]"
                @click="ui.requestTagListLoad"
              />
            </div>
          </template>

          <template v-else>
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Связь</div>
              <div class="font-medium text-surface-900">Провод</div>
            </div>

            <div
              class="grid gap-x-2 gap-y-1 items-center"
              style="grid-template-columns: 1fr auto 1fr"
            >
              <div class="text-[11px] uppercase tracking-wider text-surface-500">Источник</div>
              <div></div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500">Цель</div>
              <code class="px-2 py-1 bg-surface-100 rounded text-xs font-mono truncate">
                {{ details.sourceLabel }} · {{ details.sourcePort }}
              </code>
              <i class="pi pi-arrow-right text-surface-400 text-[10px]" />
              <code class="px-2 py-1 bg-surface-100 rounded text-xs font-mono truncate">
                {{ details.targetLabel }} · {{ details.targetPort }}
              </code>
            </div>
          </template>

          <div v-if="!details.isText && !details.isValue" class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>

            <!-- Встроенные анимации стенсила показываются в tooltip'е у иконки
 каждого слота (см. info-icon выше). -->

            <!-- A. cell_alr — обёртка required-слота .alr. Интринсик-анимация
                 шаблона, не отдельная tms-сущность. -->
            <AlarmSourceBlock
              v-if="details.isAlarm && details.slots[0]"
              :alarm-slot="details.slots[0]"
              :tags-loaded="!!project.tags.length"
              @open-tag-picker="openSlotPicker(details.slots[0])"
            />

            <!-- B. Булев источник — виден всегда (кроме cell_alr: у тревоги свой
                 слот). Для switch-стенсила включает slot.onoff (intrinsic). Теги
                 пишутся лениво через «Добавить» внутри блока; × очищает (виден при
                 непустом, switchRemovable). -->
            <SwitchBlock
              v-if="!details.isAlarm"
              :slot-info="details.isSwitch ? details.slots[0] : null"
              :parallel="switchBuckets.or"
              :series="switchBuckets.and"
              :removable="switchRemovable"
              :tags-loaded="!!project.tags.length"
              title="Булев источник"
              @open-slot-picker="openSlotPicker(details.slots[0])"
              @open-tag-picker="onAddSwitchTag"
              @remove-tag="removeSwitchTagAt"
              @remove="removeSwitchSources"
              @highlight-tag="canvas.toggleHighlightedTag"
              @edit-tag="editSwitchTagAt"
            />

            <!-- C. Диапазоны значений (аналоговый источник) — виден всегда.
                 voltageSource создаётся лениво при выборе тега (onPickTag),
                 очищается через × (виден при непустом). -->
            <VoltageSourceBlock
              :voltage-source="details.voltageSource"
              :tags-loaded="!!project.tags.length"
              :class-options="ANIMATION_CLASS_OPTIONS"
              @open-tag-picker="openVoltagePicker"
              @update-range="updateRange"
              @highlight="toggleVoltageHighlight"
              @remove="removeVoltageSource"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- Единый tag-picker для всех мест инспектора (слот / диапазоны / значение /
         булев / multi-select) — открывается через openPicker, см. picker-ref. -->
    <TagPickerDialog
      :visible="!!picker"
      :tags="picker?.tags || []"
      :selected="picker?.selected || ''"
      :header="picker?.header || 'Выберите тег'"
      @update:visible="(v) => !v && (picker = null)"
      @select="onPickerSelect"
    />
  </aside>
</template>
