<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import {
  useAnimationClipboard,
  applyBoolClip,
  applyRangeClip,
} from '../composables/useAnimationClipboard'
import { useAlign } from '../composables/useAlign'
import { useProjectStore } from '../stores/useProjectStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { getStencilById, hasBoolSlot } from '../stencils/registry'
import {
  injectStencilSvg,
  TEXT_FONT_SIZE,
  textCellHeight,
  textCellWidth,
  resizeTextCell,
  resolveValueDisplay,
} from '../stencils/svgInjector'
import { nplural } from '../utils/plural'
import { normalizeSwitchSources } from '../utils/switchSources'
import { toPlain } from '../utils/plain'
import { isBooleanType, isFloatType } from '../services/parsers'
import TagPickerDialog from './TagPickerDialog.vue'
import TagField from './TagField.vue'
import RangeBlock from './RangeBlock.vue'
import BooleanBlock from './BooleanBlock.vue'
import { ANIMATION_CLASS_OPTIONS } from '../constants/animation'
import { previewOuterKey } from '../constants/ids'

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

// Статичные стенсилы (флаг `static: true` в stencil.json) — без визуальной
// реакции на animation-классы; voltage/switch source на них бессмыслен, в
// multi-select их пропускаем.
function isStatic(stencilId) {
  return !!getStencilById(stencilId)?.static
}

const canvas = useCanvas()
const animClip = useAnimationClipboard()
// Выравнивание + распределение выделенных ячеек (секция «Выравнивание» в мульти-режиме).
const { canAlign, canDistribute, alignCells, distributeCells } = useAlign()
const project = useProjectStore()
const workspace = useWorkspaceStore()
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
      locked: !!tms.locked,
      isText: tms.stencilId === 'cell_text',
      text: tms.text ?? '',
      fontSize: tms.fontSize ?? TEXT_FONT_SIZE,
      bold: !!tms.bold,
      align: tms.align || 'left',
      color: tms.color || '',
      isValue: tms.stencilId === 'cell_value',
      valueTag: tms.valueTag ?? '',
      // id outer-карточки в animations.json/SVG (тот же, что эмитит exporter).
      exportId: previewOuterKey(tms.stencilId, cell.id, tms.valueTag),
      // Стенсилы с булевым слотом-драйвером (key onoff — см. hasBoolSlot; это
      // cell_qw/qr/qk/qf, cell_alr, пользовательские) рендерят его через BooleanBlock
      // первой строкой (основной тег) вместе с зависимостями switchSources.
      hasBoolSlot: hasBoolSlot(stencil),
      // Тег основного булева слота (slot.onoff) — для исключения из switchSources.
      // Из payload (tms.slots.onoff), как и multi-select; не по индексу slots[0].
      onoffTag: slotValues.onoff || '',
      // Слоты для UI: декларация из стенсила + текущее значение из tms.slots.
      // Нужны BooleanBlock (slots[0]) и slot-picker'у; type — тип тега.
      slots: slotsDef.map((s) => ({
        key: s.key,
        type: s.type,
        value: slotValues[s.key] || '',
      })),
      voltageSource: tms.voltageSource || null,
      switchSources: tms.switchSources || null,
      navigation: tms.navigation || '',
    }
  }

  if (sel.kind === 'link') {
    const tms = cell.get('tms') || {}
    return {
      kind: 'link',
      id: cell.id,
      voltageSource: tms.voltageSource || null,
      switchSources: tms.switchSources || null,
    }
  }

  return null
})

// Слот-драйвер стенсила «по значению»: любой не-onoff слот (onoff рисует
// BooleanBlock). Значение сигнала выбирает активное состояние; на холсте нужна
// одна строка — привязать тег (сами состояния/вид уже в стенсиле).
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
    header: 'Выберите тег',
    onSelect: (tag) => patchSlotTag(slot.key, tag),
  })
}

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
// Выравнивание = якорь блока при росте текста (см. resizeTextCell), не раскладка
// строки внутри (блок обтягивает текст). Иконки — привычная тройка left/center/right.
const ALIGN_OPTIONS = [
  { value: 'left', icon: 'pi pi-align-left', tip: 'Растёт вправо (левый край на месте)' },
  { value: 'center', icon: 'pi pi-align-center', tip: 'Растёт симметрично (центр на месте)' },
  { value: 'right', icon: 'pi pi-align-right', tip: 'Растёт влево (правый край на месте)' },
]

// Жирность как одиночный toggle-сегмент SelectButton (allow-empty → повторный
// клик снимает). Единый визуальный язык с выравниванием.
const BOLD_OPTIONS = [{ value: 'bold' }]

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
        next.text === tms.text &&
        next.fontSize === tms.fontSize &&
        next.bold === tms.bold &&
        next.color === tms.color &&
        (next.align || 'left') === (tms.align || 'left')
      if (same) return false
      cell.set('tms', next)
      // Размер cell'а подгоняем и по ширине (под содержимое), и по высоте (под шрифт) —
      // hit-area тогда совпадает с реально отображаемым текстом, inline-X прижимается к нему.
      // resizeTextCell держит якорь (align): смена шрифта/жирности сдвигает блок от
      // выбранного края. Смена только align ширину не меняет — блок остаётся на месте,
      // якорь применится при следующем росте текста.
      const fontSize = next.fontSize ?? TEXT_FONT_SIZE
      const bold = !!next.bold
      resizeTextCell(
        cell,
        textCellWidth(next.text ?? '', fontSize, bold),
        textCellHeight(fontSize),
        next.align || 'left'
      )
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

function applyColor(color) {
  patchTextCell({ color })
}

function applyAlign(align) {
  patchTextCell({ align })
}

// ─── Замок ячейки ───
function applyLockToggle() {
  const d = details.value
  if (!d || d.kind !== 'cell') return
  canvas.toggleLocked([{ kind: 'cell', id: d.id }])
}

// Замок для ЦЕЛЬНОЙ группы (не произвольного мультивыделения — там замка нет).
// Тумблер «включён» = все члены группы locked; клик лочит/снимает всю группу.
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
    if (n) notify.success('Разгруппировано', nplural(n, 'элемент', 'элемента', 'элементов'))
  } else {
    const n = canvas.groupCells(canvas.selection.value)
    if (n) notify.success('Сгруппировано', nplural(n, 'элемент', 'элемента', 'элементов'))
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
    tags: floatTags.value,
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
// невалиден. min/max — числа; нечисловой ввод (пустая строка, буквы) дал бы NaN,
// который молча сломал бы диапазон при экспорте → правку игнорируем. Русская
// десятичная запятая («3,99») — самый частый «съеденный» ввод у инженеров с ru-
// раскладкой: нормализуем в точку до Number(), иначе тоже NaN → тихий откат.
function editRanges(ranges, idx, field, value) {
  let parsed = value
  if (field !== 'class') {
    parsed = Number(String(value).trim().replace(',', '.'))
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

/** Прогон по выделению: резолвит ячейки, пропускает статичные (текст/значение),
 *  зовёт fn(cell, tms), затем один bumpVersion + requestSnapshot. */
function forEachSelectedCell(fn) {
  const graph = canvas.graphRef.value
  if (!graph) return
  for (const item of canvas.selection.value) {
    const cell = graph.getCell(item.id)
    if (!cell) continue
    const tms = cell.get('tms') || {}
    if (isStatic(tms.stencilId)) continue
    fn(cell, tms)
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

/** Раздать текущий шаблон диапазонов на всё выделение (клон на ячейку, без общих
 *  ссылок). toPlain, не structuredClone: multiVoltage.value — Vue reactive-прокси,
 *  structuredClone на нём бросает DataCloneError. */
function applyMultiVoltage() {
  if (!multiVoltage.value) return
  forEachSelectedCell((cell, tms) =>
    cell.set('tms', { ...tms, voltageSource: toPlain(multiVoltage.value) })
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

// ─── switchSources: зависимости-теги ГРУППАМИ (DNF) ───
// Каноническая форма — { groups: [[tag,…],…] }: внутри группы теги через И,
// группы между собой через ИЛИ. Элемент активен, если выполнена ЛЮБАЯ группа
// целиком; иначе тускнеет. Экспорт: одна группа → дешёвый shape, ≥2 → multi.

// Цель добавления/замены тега: { groupIdx, tagIdx }.
//   groupIdx=null           — новая группа (picker создаёт [tag]);
//   groupIdx=число, tagIdx=null    — добавить тег в группу gi;
//   groupIdx=число, tagIdx=число   — заменить тег по индексу.
// groupIdx=undefined — пасс (cancel).
const editingSwitch = ref({ groupIdx: undefined, tagIdx: null })

// Канонические группы switchSources текущей ячейки (нормализует/чистит форму).
const switchGroups = computed(() => normalizeSwitchSources(details.value?.switchSources).groups)

// Показывать × «Удалить все зависимости» в шапке блока. У intrinsic-свитча
// (cell_qw) блок виден всегда из-за slot.onoff — × имеет смысл ТОЛЬКО когда есть
// группы-зависимости (иначе чистить нечего, клик был бы no-op'ом: slot.onoff им
// не удаляется). У не-свитча блок появляется лишь при наличии switchSources, и ×
// убирает его целиком (в т.ч. пустой) — там достаточно самого факта присутствия.
const switchRemovable = computed(() =>
  details.value?.hasBoolSlot ? switchGroups.value.length > 0 : !!details.value?.switchSources
)

/** Полная замена switchSources на { groups }; нет групп → удаляем источник. */
function writeSwitchGroups(groups) {
  const clean = groups.map((g) => [...new Set(g.filter(Boolean))]).filter((g) => g.length)
  mutateSelectedTms((tms) => ({
    ...tms,
    switchSources: clean.length ? { groups: clean } : null,
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

/** «+ группа» — новая группа, рождается первым выбранным тегом (пустых нет). */
function onAddGroup() {
  editingSwitch.value = { groupIdx: null, tagIdx: null }
  openSwitchPicker()
}

/** «+ тег (И)» внутри группы gi. */
function onAddSwitchTag(gi) {
  editingSwitch.value = { groupIdx: gi, tagIdx: null }
  openSwitchPicker()
}

/** Клик по тегу-зависимости → замена по индексу (gi, ti). */
function editSwitchTagAt(gi, ti) {
  editingSwitch.value = { groupIdx: gi, tagIdx: ti }
  openSwitchPicker()
}

function removeSwitchSources() {
  writeSwitchGroups([])
}

/**
 * Picker вернул тег. groupIdx=null → новая группа [tag]; иначе add (tagIdx=null)
 * или replace (tagIdx=число) внутри группы gi. Дубли ВНУТРИ группы игнорируем
 * (между группами тег повторяется свободно). Основной тег стенсила (slot.onoff)
 * в зависимости не допускаем.
 */
function onPickSwitchTag(tag) {
  const d = details.value
  const { groupIdx, tagIdx } = editingSwitch.value
  editingSwitch.value = { groupIdx: undefined, tagIdx: null }
  if (groupIdx === undefined || !tag) return
  if (d?.hasBoolSlot && d.onoffTag === tag) return

  const groups = normalizeSwitchSources(d?.switchSources).groups
  if (groupIdx === null) {
    writeSwitchGroups([...groups, [tag]])
    return
  }
  const group = [...(groups[groupIdx] || [])]
  if (tagIdx !== null) {
    if (group[tagIdx] === tag) return
    group[tagIdx] = tag
  } else {
    if (group.includes(tag)) return
    group.push(tag)
  }
  const next = groups.map((g, i) => (i === groupIdx ? group : g))
  writeSwitchGroups(next)
}

/** × на строке тега (gi, ti). Опустевшая группа отбрасывается (в writeSwitchGroups). */
function removeSwitchTagAt(gi, ti) {
  const groups = normalizeSwitchSources(details.value?.switchSources).groups
  const next = groups.map((g, i) => (i === gi ? g.filter((_, j) => j !== ti) : g))
  writeSwitchGroups(next)
}

/** × в шапке группы — удалить группу целиком. */
function removeSwitchGroup(gi) {
  const groups = normalizeSwitchSources(details.value?.switchSources).groups
  writeSwitchGroups(groups.filter((_, i) => i !== gi))
}

/** Открыть picker массовой привязки булева тега (multi-select). */
function openMultiSwitchPicker() {
  openPicker({
    tags: booleanTags.value,
    header: 'Булев тег для всех выделенных элементов',
    onSelect: onPickMultiSwitchTag,
  })
}

/** Multi-select: добавить тег НОВОЙ группой [tag] в switchSources всех
 * выделенных (у выделения нет общего состояния → каждому — своя новая группа,
 * не дублируя уже существующую одиночную группу с этим тегом). */
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
    if (isStatic(tms.stencilId)) {
      skipped++
      continue
    }
    // Свитчи (стенсилы с slot.onoff) не должны зависеть от своего же тега —
    // slot.onoff уже отвечает за переключение, дубль в switchSources бессмыслен.
    if (hasBoolSlot(getStencilById(tms.stencilId)) && tms.slots?.onoff === tag) {
      skipped++
      continue
    }
    const groups = normalizeSwitchSources(tms.switchSources).groups
    // Уже есть одиночная группа ровно с этим тегом → не плодим дубль.
    if (groups.some((g) => g.length === 1 && g[0] === tag)) {
      applied++
      continue
    }
    cell.set('tms', { ...tms, switchSources: { groups: [...groups, [tag]] } })
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
  animClip.copyBool(toPlain({ onoffTag: d.onoffTag || null, groups: switchGroups.value }))
  notify.success('Скопировано', 'Булевые настройки анимации')
}

/** Копировать диапазоны выделенного (voltageSource целиком: тег + пороги). */
function copyRange() {
  const d = details.value
  if (!d?.voltageSource) return
  animClip.copyRange(toPlain(d.voltageSource))
  notify.success('Скопировано', 'Диапазоны значений')
}

/**
 * Вставить булев блок из буфера на всё текущее выделение. Группы-зависимости
 * (switchSources) раздаём любому не-static элементу/проводу; свой булев тег
 * (onoff) — только стенсилам с булевым слотом (иначе некуда его писать). Статичные
 * стенсилы (текст/значение) пропускаем со счётчиком.
 */
function pasteBool() {
  pasteClip(animClip.boolClip.value, (tms) =>
    applyBoolClip(tms, animClip.boolClip.value, {
      isStatic: isStatic(tms.stencilId),
      hasBoolSlot: hasBoolSlot(getStencilById(tms.stencilId)),
    })
  )('Булевые настройки вставлены')
}

/** Вставить диапазоны из буфера на всё текущее выделение (voltageSource целиком,
 *  свежий клон на ячейку). Статичные стенсилы пропускаем. */
function pasteRange() {
  pasteClip(animClip.rangeClip.value, (tms) =>
    applyRangeClip(tms, animClip.rangeClip.value, { isStatic: isStatic(tms.stencilId) })
  )('Диапазоны вставлены')
}

/**
 * Общий каркас вставки буфера на всё выделение: для каждой ячейки зовёт
 * apply(tms) → новый tms либо null (несовместимо → пропуск со счётчиком). Пустой
 * буфер — no-op. Возвращает функцию-финализатор (принимает заголовок тоста), чтобы
 * pasteBool/pasteRange отличались только apply'ем и текстом.
 */
function pasteClip(clip, apply) {
  return (title) => {
    const graph = canvas.graphRef.value
    if (!clip || !graph) return
    let applied = 0
    let skipped = 0
    for (const item of canvas.selection.value) {
      const cell = graph.getCell(item.id)
      if (!cell) continue
      const next = apply(cell.get('tms') || {})
      if (!next) {
        skipped++
        continue
      }
      cell.set('tms', next)
      applied++
    }
    canvas.bumpVersion()
    canvas.requestSnapshot()
    const count = nplural(applied, 'элемент', 'элемента', 'элементов')
    notify.success(
      title,
      skipped ? `Применено к ${count} · пропущено: ${skipped}` : `Применено к ${count}`
    )
  }
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

// switchSources принимает только bool-теги — эффект «false → затемнение»,
// для аналогового значения бессмыслен. Фильтр по типу из tag-list'а.
const booleanTags = computed(() => project.tags.filter((t) => isBooleanType(t.type)))
// cell_value отображает аналоговое значение → picker только по float-тегам.
const floatTags = computed(() => project.tags.filter((t) => isFloatType(t.type)))

// Picker для switch-зависимостей исключает: основной тег ячейки (slot.onoff у
// cell_qw) + теги ТЕКУЩЕЙ редактируемой группы (внутри группы тег уникален),
// кроме редактируемого по индексу (его оставляем, чтобы юзер видел значение).
// Теги других групп НЕ исключаем — тег свободно повторяется между группами.
// Для новой группы (groupIdx=null) фильтруем только onoff-тег.
const switchPickerTags = computed(() => {
  const d = details.value
  if (!d) return booleanTags.value
  const excluded = new Set()
  if (d.hasBoolSlot && d.onoffTag) excluded.add(d.onoffTag)
  const { groupIdx, tagIdx } = editingSwitch.value
  if (typeof groupIdx === 'number') {
    const group = normalizeSwitchSources(d.switchSources).groups[groupIdx] || []
    group.forEach((t, i) => {
      if (t && i !== tagIdx) excluded.add(t)
    })
  }
  return booleanTags.value.filter((t) => !excluded.has(t.name))
})
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
        class="!absolute !right-2 !top-1/2 !-translate-y-1/2 !w-8 !h-8 !p-0"
        @click="onToggleLock"
      />
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm">
      <!-- Multi-select: больше одного элемента — показываем сводку + удаление -->
      <template v-if="canvas.selection.value.length > 1">
        <div class="[&>*+*]:border-t [&>*+*]:border-surface-200 [&>*+*]:pt-4 [&>*+*]:mt-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
              {{ multiGroup.ungroup ? 'Группа' : 'Выделено' }}
            </div>
            <div class="font-medium text-surface-900">
              {{ nplural(canvas.selection.value.length, 'элемент', 'элемента', 'элементов') }}
            </div>
            <p class="text-[11px] text-surface-500 mt-2">
              {{
                multiGroup.ungroup
                  ? 'Группа ведёт себя как один элемент. Анимации применяются ко всем членам.'
                  : 'Ячейки можно тащить группой, удалить клавишей Del. Анимации ниже применяются ко всему выделению; остальные свойства — при одном выделенном.'
              }}
            </p>
          </div>

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
            <div class="flex items-center gap-3">
              <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                По горизонтали
              </span>
              <div class="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  v-tooltip.bottom="'По левому краю'"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900"
                  @click="alignCells('left')"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect x="1" y="2" width="1.4" height="12" rx="0.5" />
                    <rect x="3.4" y="4" width="9" height="3" rx="1" opacity="0.8" />
                    <rect x="3.4" y="9" width="5.5" height="3" rx="1" opacity="0.8" />
                  </svg>
                </button>
                <button
                  type="button"
                  v-tooltip.bottom="'По центру (горизонт.)'"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900"
                  @click="alignCells('centerX')"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect x="7.3" y="2" width="1.4" height="12" rx="0.5" />
                    <rect x="3.5" y="4" width="9" height="3" rx="1" opacity="0.8" />
                    <rect x="5.25" y="9" width="5.5" height="3" rx="1" opacity="0.8" />
                  </svg>
                </button>
                <button
                  type="button"
                  v-tooltip.bottom="'По правому краю'"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900"
                  @click="alignCells('right')"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect x="13.2" y="2" width="1.4" height="12" rx="0.5" />
                    <rect x="4.2" y="4" width="9" height="3" rx="1" opacity="0.8" />
                    <rect x="7.7" y="9" width="5.5" height="3" rx="1" opacity="0.8" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                По вертикали
              </span>
              <div class="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  v-tooltip.bottom="'По верхнему краю'"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900"
                  @click="alignCells('top')"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect x="2" y="1" width="12" height="1.4" rx="0.5" />
                    <rect x="4" y="3.4" width="3" height="9" rx="1" opacity="0.8" />
                    <rect x="9" y="3.4" width="3" height="5.5" rx="1" opacity="0.8" />
                  </svg>
                </button>
                <button
                  type="button"
                  v-tooltip.bottom="'По центру (вертик.)'"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900"
                  @click="alignCells('centerY')"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect x="2" y="7.3" width="12" height="1.4" rx="0.5" />
                    <rect x="4" y="3.5" width="3" height="9" rx="1" opacity="0.8" />
                    <rect x="9" y="5.25" width="3" height="5.5" rx="1" opacity="0.8" />
                  </svg>
                </button>
                <button
                  type="button"
                  v-tooltip.bottom="'По нижнему краю'"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900"
                  @click="alignCells('bottom')"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect x="2" y="13.2" width="12" height="1.4" rx="0.5" />
                    <rect x="4" y="4.2" width="3" height="9" rx="1" opacity="0.8" />
                    <rect x="9" y="7.7" width="3" height="5.5" rx="1" opacity="0.8" />
                  </svg>
                </button>
              </div>
            </div>
            <!-- Распределение: равные интервалы. Нужно ≥3 ячеек (иначе disabled). -->
            <div class="flex items-center gap-3">
              <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                Распределение
              </span>
              <div class="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  v-tooltip.bottom="'Распределить по горизонтали (равные интервалы)'"
                  :disabled="!canDistribute"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900 disabled:cursor-not-allowed disabled:opacity-40"
                  @click="distributeCells('x')"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect x="2" y="3" width="2.6" height="10" rx="0.8" />
                    <rect x="6.7" y="3" width="2.6" height="10" rx="0.8" />
                    <rect x="11.4" y="3" width="2.6" height="10" rx="0.8" />
                  </svg>
                </button>
                <button
                  type="button"
                  v-tooltip.bottom="'Распределить по вертикали (равные интервалы)'"
                  :disabled="!canDistribute"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900 disabled:cursor-not-allowed disabled:opacity-40"
                  @click="distributeCells('y')"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect x="3" y="2" width="10" height="2.6" rx="0.8" />
                    <rect x="3" y="6.7" width="10" height="2.6" rx="0.8" />
                    <rect x="3" y="11.4" width="10" height="2.6" rx="0.8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Multi-select: те же блоки, что в single, как «применить ко всем»
               (общего состояния у выделения нет → списки пустые/шаблон, выбор тега
               и порогов раздаётся на всё выделение). Булев — BooleanBlock без групп:
               «+ группа» раздаёт тег новой группой на всё выделение. Range — шаблон
               multiVoltage: задаёшь тег → правишь пороги → на все выделенные. -->
          <div class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>
            <BooleanBlock
              :slot-info="null"
              :groups="[]"
              :removable="false"
              :tags-loaded="!!project.tags.length"
              :pasteable="animClip.hasBool.value"
              title="Булево значение"
              @add-group="openMultiSwitchPicker"
              @paste="pasteBool"
            />
            <RangeBlock
              :voltage-source="multiVoltage"
              :tags-loaded="!!project.tags.length"
              :class-options="ANIMATION_CLASS_OPTIONS"
              :pasteable="animClip.hasRange.value"
              @open-tag-picker="openMultiVoltagePicker"
              @update-range="updateMultiVoltageRange"
              @highlight="toggleMultiVoltageHighlight"
              @remove="removeMultiVoltage"
              @paste="pasteRange"
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
        <div>
          <div class="flex flex-col items-center text-center text-surface-400 pb-6 pt-8">
            <i class="pi pi-mouse text-3xl mb-3 opacity-60" />
            <div class="text-sm font-medium text-surface-500 mb-1">Ничего не выделено</div>
            <p class="text-[11px] leading-relaxed max-w-[180px]">
              Кликни по ячейке или проводу на холсте — здесь появятся свойства
            </p>
          </div>

          <!-- Холостой инспектор не простаивает: сводка активной формы + базовые
               хоткеи сразу под подсказкой; свободное место уходит вниз. -->
          <div class="space-y-4 border-t border-surface-200 pt-4 text-[11px]">
            <div>
              <div class="mb-2 uppercase tracking-wider text-surface-500">Сводка формы</div>
              <div class="flex flex-col gap-1 text-surface-600">
                <div class="flex justify-between">
                  <span>Ячейки</span>
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
            <div>
              <div class="mb-2 uppercase tracking-wider text-surface-500">Подсказки</div>
              <ul class="flex flex-col gap-2 text-surface-500">
                <li class="flex items-center gap-2">
                  <i class="pi pi-arrows-alt !text-[10px] text-surface-400" />
                  Перетащи стенсил из палитры на холст
                </li>
                <li class="flex items-center gap-2">
                  <kbd class="rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px]">Ctrl+F</kbd>
                  поиск по тегам
                </li>
                <li class="flex items-center gap-2">
                  <kbd class="rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px]">?</kbd>
                  справка по хоткеям
                </li>
              </ul>
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
          <template v-if="details.kind === 'cell'">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Элемент</div>
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
                  input-class="!w-12 text-center"
                  class="ml-auto"
                  @update:model-value="applyFontSize"
                />
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
          </template>

          <template v-else>
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Элемент</div>
              <div class="font-medium text-surface-900">Провод</div>
            </div>
          </template>

          <div v-if="!details.isText && !details.isValue" class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>

            <!-- Стенсил «по значению»: привязка тега сигнала (состояния и их вид
                 запечены в стенсиле, здесь только тег-драйвер). -->
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

            <!-- Булево значение — виден ВСЕГДА. У стенсила с булевым слотом
                 (onoff, в т.ч. cell_alr) первой строкой идёт этот слот (основной
                 тег), ниже — зависимости switchSources. Теги пишутся лениво через
                 «Добавить»; × очищает (switchRemovable). -->
            <BooleanBlock
              :slot-info="details.hasBoolSlot ? details.slots[0] : null"
              :groups="switchGroups"
              :removable="switchRemovable"
              :tags-loaded="!!project.tags.length"
              :copyable="!!(details.onoffTag || switchGroups.length)"
              :pasteable="animClip.hasBool.value"
              title="Булево значение"
              @open-slot-picker="openSlotPicker(details.slots[0])"
              @add-group="onAddGroup"
              @add-tag="onAddSwitchTag"
              @edit-tag="editSwitchTagAt"
              @remove-tag="removeSwitchTagAt"
              @remove-group="removeSwitchGroup"
              @remove="removeSwitchSources"
              @highlight-tag="canvas.toggleHighlightedTag"
              @copy="copyBool"
              @paste="pasteBool"
            />

            <!-- Диапазоны значений (аналоговое значение) — виден всегда.
                 voltageSource создаётся лениво при выборе тега (onPickTag),
                 очищается через × (виден при непустом). -->
            <RangeBlock
              :voltage-source="details.voltageSource"
              :tags-loaded="!!project.tags.length"
              :class-options="ANIMATION_CLASS_OPTIONS"
              :copyable="!!details.voltageSource"
              :pasteable="animClip.hasRange.value"
              @open-tag-picker="openVoltagePicker"
              @update-range="updateRange"
              @highlight="toggleVoltageHighlight"
              @remove="removeVoltageSource"
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
      :tags="picker?.tags || []"
      :selected="picker?.selected || ''"
      :header="picker?.header || 'Выберите тег'"
      @update:visible="(v) => !v && (picker = null)"
      @select="onPickerSelect"
    />
  </aside>
</template>
