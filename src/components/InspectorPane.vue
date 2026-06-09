<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import { useCanvas } from '../composables/useCanvas'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { getStencilById } from '../stencils/registry'
import {
  injectStencilSvg,
  TEXT_FONT_SIZE,
  TEXT_SIZE_PRESETS,
  textCellHeight,
  textCellWidth,
  resolveValueDisplay,
} from '../stencils/svgInjector'
import { buildLinkLabel } from '../stencils/linkDefaults'
import { nplural } from '../utils/plural'
import TagPickerDialog from './TagPickerDialog.vue'
import VoltageSourceBlock from './VoltageSourceBlock.vue'
import AlarmSourceBlock from './AlarmSourceBlock.vue'
import SwitchBlock from './SwitchBlock.vue'
import {
  ANIMATION_CLASS_COLORS,
  ANIMATION_CLASS_OPTIONS,
  ANIMATION_OFF_COLOR,
} from '../constants/animation'
import { TOAST_LIFE } from '../constants/toast'

// Дефолтные диапазоны voltage-source. .map(({...r})) на каждое использование —
// чтобы ячейки не делили один и тот же массив.
const VOLTAGE_RANGE_DEFAULTS = [
  { min: 0, max: 4, class: 'animation-low' },
  { min: 4, max: 7, class: 'animation-mid' },
  { min: 7, max: 10, class: 'animation-high' },
]

// Стенсилы без визуальной реакции на animation-классы — voltage/switch source
// на них бессмыслен, в multi-select их пропускаем.
const LAYOUT_ONLY_STENCILS = new Set(['cell_text', 'cell_value'])
function isLayoutOnly(stencilId) {
  return LAYOUT_ONLY_STENCILS.has(stencilId)
}

// Стенсилы с required-слотом .ONOFF, который семантически идентичен выключателю:
// рендерим в Inspector через SwitchBlock в intrinsic-режиме (с возможностью
// добавлять родительские switchSources поверх собственного onoff).
const SWITCH_STENCILS = new Set(['cell_qw', 'cell_qr', 'cell_qk'])

const canvas = useCanvas()
const project = useProjectStore()
const ui = useUiStore()
const toast = useToast()

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
      stencilLabel: stencil?.label || tms.stencilId || '—',
      isText: tms.stencilId === 'cell_text',
      text: tms.text ?? '',
      fontSize: tms.fontSize ?? TEXT_FONT_SIZE,
      bold: !!tms.bold,
      isValue: tms.stencilId === 'cell_value',
      valueTag: tms.valueTag ?? '',
      // cell_alr рендерит свой required-слот через AlarmSourceBlock (с описанием,
      // bell-иконкой, без отдельной строки в «Привязки тегов»). Switch-source для
      // тревоги бессмыслен — кнопку «Выключатель» прячем тоже.
      isAlarm: tms.stencilId === 'cell_alr',
      // cell_qw / cell_qr / cell_qk — slot.onoff рендерится через SwitchBlock
      // в intrinsic-режиме (общий «блок выключателя» вместо отдельной строки
      // в «Привязках тегов»). Switch-source-кнопка у такой ячейки дублировала
      // бы её собственный .ONOFF, поэтому общий add-flow тоже отдаём через
      // SwitchBlock (см. onAddSwitchTag).
      isSwitch: SWITCH_STENCILS.has(tms.stencilId),
      // Слоты для UI: декларация из стенсила + текущее значение из tms.slots.
      // tagSuffix — фильтр для picker'а (показывать только теги с .SUFFIX).
      // tooltip — встроенные правила анимации для этого слота (см. buildSlotTooltip),
      // показываем как HTML-tooltip на info-иконке рядом с лейблом слота.
      slots: slotsDef.map((s) => ({
        key: s.key,
        label: s.label,
        type: s.type,
        required: !!s.required,
        tagSuffix: s.tagSuffix || null,
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
      return (st && getStencilById(st)?.label) || '—'
    }
    return {
      kind: 'link',
      id: cell.id,
      sourceLabel: endpointLabel(sourceCell),
      sourcePort: source?.port || '—',
      targetLabel: endpointLabel(targetCell),
      targetPort: target?.port || '—',
      voltageSource: tms.voltageSource || null,
      switchSources: tms.switchSources || null,
      label: tms.label || '',
    }
  }

  return null
})

// Multi-select breakdown: сводка по типам стенсилов в выделении («3 Выключатель
// + 2 Связь») — даёт контекст к чему применишь massive-операцию.
const selectionBreakdown = computed(() => {
  canvas.graphVersion.value // touch для reactive-зависимости
  const sel = canvas.selection.value
  const graph = canvas.graphRef.value
  if (!graph || sel.length < 2) return []

  const counts = new Map()
  for (const item of sel) {
    if (item.kind === 'link') {
      counts.set('Провода', (counts.get('Провода') || 0) + 1)
      continue
    }
    const cell = graph.getCell(item.id)
    if (!cell) continue
    const tms = cell.get('tms') || {}
    const stencil = tms.stencilId ? getStencilById(tms.stencilId) : null
    const label = stencil?.label || tms.stencilId || '—'
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }))
})

// ─── Удаление ───
function onDelete() {
  const graph = canvas.graphRef.value
  const sel = canvas.selection.value
  if (!graph || !sel.length) return
  for (const item of [...sel]) {
    graph.getCell(item.id)?.remove()
  }
  canvas.clearSelection()
}

// ─── Редактирование слотов (привязка тегов) ───
const slotPickerOpen = ref(false)
const activeSlot = ref(null) // { key, label, type, tagSuffix }

function openSlotPicker(slot) {
  activeSlot.value = slot
  slotPickerOpen.value = true
}

// Внешний запрос на «открой picker первого пустого required-слота» — приходит
// от клика по slot-warning badge на холсте (см. CanvasPane.onSlotBadgeClick).
// К моменту срабатывания canvas.selection уже выставлен на нужную ячейку, и
// details.slots реактивно обновился — берём из него первый пустой required.
watch(
  () => canvas.slotPickRequest.value.tick,
  () => {
    const d = details.value
    if (!d || d.kind !== 'cell') return
    const empty = (d.slots || []).find((s) => s.required && !s.value)
    if (empty && project.tags.length) openSlotPicker(empty)
  }
)

function onPickSlotTag(tag) {
  const slot = activeSlot.value
  if (!slot) return
  patchSlotTag(slot.key, tag)
  activeSlot.value = null
}

/** Записывает тег в слот ячейки + перерисовывает SVG (новые bindings). */
function patchSlotTag(key, tag) {
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  const d = details.value
  if (!graph || !paper || !d || d.kind !== 'cell') return

  const cell = graph.getCell(d.id)
  const stencil = getStencilById(d.stencilId)
  if (!cell || !stencil) return

  const tms = cell.get('tms') || {}
  const nextSlots = { ...(tms.slots || {}) }
  if (tag) nextSlots[key] = tag
  else delete nextSlots[key]
  cell.set('tms', { ...tms, slots: nextSlots })

  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil)

  canvas.bumpVersion()
  canvas.requestSnapshot()
}

// Фильтр тегов по slot.tagSuffix (например .ONOFF). Регистронезависимо.
const slotPickerTags = computed(() => {
  const sfx = activeSlot.value?.tagSuffix
  if (!sfx) return project.tags
  const re = new RegExp(`${sfx.replace(/\./g, '\\.')}$`, 'i')
  return project.tags.filter((t) => re.test(t.name))
})

// ─── Редактирование текста (стенсил cell_text) ───
function applyText(newText) {
  patchTextCell({ text: newText })
}

/** Общий апдейт tms текстового поля + ресайз cell'а под актуальный текст/шрифт/жирность. */
function patchTextCell(patch) {
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  const d = details.value
  if (!graph || !paper || !d || !d.isText) return

  const cell = graph.getCell(d.id)
  const stencil = getStencilById(d.stencilId)
  if (!cell || !stencil) return

  const tms = cell.get('tms') || {}
  // Если ничего реально не меняется — выходим, чтобы не плодить snapshot'ы.
  const next = { ...tms, ...patch }
  const same = next.text === tms.text && next.fontSize === tms.fontSize && next.bold === tms.bold
  if (same) return
  cell.set('tms', next)

  // Размер cell'а подгоняем и по ширине (под содержимое), и по высоте (под шрифт) —
  // hit-area тогда совпадает с реально отображаемым текстом, inline-X прижимается к нему.
  const fontSize = next.fontSize ?? TEXT_FONT_SIZE
  const bold = !!next.bold
  cell.resize(textCellWidth(next.text ?? '', fontSize, bold), textCellHeight(fontSize))

  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil)

  // bumpVersion реактивно перепозиционирует HTML × overlay (см. CanvasPane).
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

function applyFontSize(size) {
  patchTextCell({ fontSize: size })
}

function toggleBold() {
  patchTextCell({ bold: !details.value?.bold })
}

// ─── Источник напряжения ───
const tagPickerOpen = ref(false)
const multiVoltageTagPickerOpen = ref(false) // для multi-select на lasso

// ─── Tag-picker для cell_value (отображаемый тег) ───
const valueTagPickerOpen = ref(false)

function openValueTagPicker() {
  valueTagPickerOpen.value = true
}

const valueDisplay = computed(() => {
  if (!details.value?.isValue) return null
  return resolveValueDisplay(details.value.valueTag)
})

function onPickValueTag(tag) {
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  const d = details.value
  if (!graph || !paper || !d || !d.isValue) return

  const cell = graph.getCell(d.id)
  const stencil = getStencilById(d.stencilId)
  if (!cell || !stencil) return

  const tms = cell.get('tms') || {}
  if ((tms.valueTag ?? '') === tag) return
  cell.set('tms', { ...tms, valueTag: tag })

  // Перерисовываем — buildValueContent читает свежий tms.valueTag и обновляет label/unit
  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil)

  canvas.bumpVersion()
  canvas.requestSnapshot()
}

/**
 * Базовый патч tms-поля (voltageSource / switchSources) у выделенной ячейки.
 * patch=null — удаляет источник целиком; иначе мержит в существующий объект.
 */
function patchTmsField(field, patch) {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d) return
  const cell = graph.getCell(d.id)
  if (!cell) return
  const tms = cell.get('tms') || {}
  const next = patch === null ? null : { ...(tms[field] || {}), ...patch }
  cell.set('tms', { ...tms, [field]: next })
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

const patchVoltageSource = (patch) => patchTmsField('voltageSource', patch)
const patchSwitchSources = (patch) => patchTmsField('switchSources', patch)

function addVoltageSource() {
  // Сразу picker — onPickTag создаст voltageSource с тегом и дефолтными
  // диапазонами. Раньше тут была пустая карточка, юзер потом отдельно кликал
  // «выбрать тег» — лишний шаг.
  tagPickerOpen.value = true
}

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

function updateRange(idx, field, value) {
  const vs = details.value?.voltageSource
  if (!vs) return
  const ranges = vs.ranges.map((r, i) =>
    i === idx ? { ...r, [field]: field === 'class' ? value : Number(value) } : r
  )
  patchVoltageSource({ ranges })
}

/** «Подсветить на схеме»: toggle подсветки элементов с тем же voltageSource.tag. */
function toggleVoltageHighlight() {
  const tag = details.value?.voltageSource?.tag
  if (!tag) {
    toast.add({
      severity: 'warn',
      summary: 'Тег не выбран',
      detail: 'Выберите тег источника, чтобы подсветить элементы с тем же тегом',
      life: TOAST_LIFE.NORMAL,
    })
    return
  }
  canvas.toggleHighlightedTag(tag)
}

/**
 * Раздаёт значение tms[field] на всё выделение; cell_text/cell_value
 * пропускает (см. isLayoutOnly). valueFactory(tag) формирует записываемый объект.
 */
function applyTagToSelection({ field, tag, valueFactory, summary, verb }) {
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
    cell.set('tms', { ...tms, [field]: valueFactory(tag) })
    applied++
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
  const count = nplural(applied, 'элемент', 'элемента', 'элементов')
  toast.add({
    severity: 'success',
    summary,
    detail:
      skipped > 0
        ? `${verb} ${count} · пропущено: ${skipped} (текст/значение)`
        : `${verb} ${count}`,
    life: TOAST_LIFE.SHORT,
  })
}

function onPickMultiVoltageTag(tag) {
  applyTagToSelection({
    field: 'voltageSource',
    tag,
    valueFactory: (t) => ({ tag: t, ranges: VOLTAGE_RANGE_DEFAULTS.map((r) => ({ ...r })) }),
    summary: 'Источник применён',
    verb: 'Тег привязан к',
  })
}

// ─── switchSources: массив bool-тегов → класс animation-off на любой false ───
// AND-семантика: любой тег false → элемент серый. Под капотом — N независимых
// биндингов в animations.json, runtime сам применяет «любой false → класс».

const switchTagPickerOpen = ref(false)
const multiSwitchTagPickerOpen = ref(false)
// null = режим «добавить новый», число = «заменить тег по индексу».
// Сбрасываем явно во всех точках открытия picker'а (add-flow); при cancel
// флаг остаётся протухшим, но следующий open всегда его перезапишет.
const editingSwitchTagIdx = ref(null)

function addSwitchSources() {
  // Сразу picker — onPickSwitchTag создаст switchSources с выбранным тегом
  // (через patchTmsField, который при отсутствии поля создаёт его на лету).
  editingSwitchTagIdx.value = null
  switchTagPickerOpen.value = true
}

/**
 * «+ Добавить тег» из SwitchBlock: для cell_qw smart-flow — если slot.onoff
 * ещё пуст, открываем slot picker (фильтр по .ONOFF из stencil-схемы),
 * иначе — switch-tags picker. Для остальных всегда switch-picker.
 */
function onAddSwitchTag() {
  editingSwitchTagIdx.value = null
  const d = details.value
  if (d?.isSwitch) {
    const slot = d.slots?.[0]
    if (slot && !slot.value) {
      openSlotPicker(slot)
      return
    }
  }
  switchTagPickerOpen.value = true
}

/** Клик по тегу-зависимости → открыть picker для замены тега по индексу. */
function editSwitchTagAt(idx) {
  editingSwitchTagIdx.value = idx
  switchTagPickerOpen.value = true
}

function removeSwitchSources() {
  patchSwitchSources(null)
}

/**
 * Picker вернул тег. Режим:
 *  • add (editingIdx=null) — append, skip если дубль
 *  • edit (editingIdx=N)   — replace at N, дедупим (если выбран тег равный
 *    другому — оставляем только одну копию, тот же тег = no-op)
 * Дополнительно блокируем выбор основного тега (slot.onoff) в качестве
 * зависимости — picker уже фильтрует, но защищаемся защитно.
 */
function onPickSwitchTag(tag) {
  const d = details.value
  if (d?.isSwitch && d.slots?.[0]?.value === tag) {
    editingSwitchTagIdx.value = null
    return
  }
  const current = d?.switchSources?.tags || []
  const idx = editingSwitchTagIdx.value
  if (idx !== null) {
    editingSwitchTagIdx.value = null
    if (current[idx] === tag) return
    const next = current.map((t, i) => (i === idx ? tag : t))
    // dedupe сохраняя порядок (если выбранный тег уже был — оставляем первое вхождение)
    const seen = new Set()
    patchSwitchSources({
      tags: next.filter((t) => (seen.has(t) ? false : (seen.add(t), true))),
    })
    return
  }
  if (current.includes(tag)) return
  patchSwitchSources({ tags: [...current, tag] })
}

function removeSwitchTagAt(idx) {
  const current = details.value?.switchSources?.tags || []
  const next = current.filter((_, i) => i !== idx)
  if (next.length === 0) patchSwitchSources(null)
  else patchSwitchSources({ tags: next })
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
    // cell_qw / cell_qr / cell_qk не должны зависеть от своего же тега — slot.onoff
    // уже отвечает за переключение позиции, дубль в switchSources бессмыслен.
    if (SWITCH_STENCILS.has(tms.stencilId) && tms.slots?.onoff === tag) {
      skipped++
      continue
    }
    const current = tms.switchSources?.tags || []
    if (current.includes(tag)) {
      applied++
      continue
    }
    cell.set('tms', { ...tms, switchSources: { tags: [...current, tag] } })
    applied++
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
  const count = nplural(applied, 'элемент', 'элемента', 'элементов')
  toast.add({
    severity: 'success',
    summary: 'Выключатель привязан',
    detail:
      skipped > 0
        ? `Привязано к ${count} · пропущено: ${skipped} (текст/значение/свой тег)`
        : `Привязано к ${count}`,
    life: TOAST_LIFE.SHORT,
  })
}

// ─── Hyperlink-навигация: клик в рантайме открывает другую view ───
// Свич управляет видимостью инпута; пустое значение не пишется, при OFF — чистим.
const navigationEnabled = ref(false)
watch(
  () => details.value?.id,
  () => {
    navigationEnabled.value = !!details.value?.navigation
  },
  { immediate: true }
)
function toggleNavigationEnabled(value) {
  navigationEnabled.value = value
  if (!value) patchNavigation('')
}

/**
 * Лейбл провода — текст вдоль линии (например «Фаза A», номер кабеля).
 * tms.label — источник правды, link.labels([...]) — derived visual (JointJS
 * рендерит лейбл в позиции 0.5 по длине пути). Пустая строка стирает оба.
 */
function patchLinkLabel(value) {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d || d.kind !== 'link') return
  const link = graph.getCell(d.id)
  if (!link) return
  const tms = link.get('tms') || {}
  const trimmed = String(value || '').trim()
  if ((tms.label || '') === trimmed) return
  const next = { ...tms }
  if (trimmed) next.label = trimmed
  else delete next.label
  link.set('tms', next)
  if (trimmed) link.labels([buildLinkLabel(trimmed)])
  else link.labels([])
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

function patchNavigation(value) {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d || d.kind !== 'cell') return
  const cell = graph.getCell(d.id)
  if (!cell) return
  const tms = cell.get('tms') || {}
  const trimmed = String(value || '').trim()
  if ((tms.navigation || '') === trimmed) return
  const next = { ...tms }
  if (trimmed) next.navigation = trimmed
  else delete next.navigation
  cell.set('tms', next)
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

// Цветовая карта для swatch'ей в подсказке-тултипе слота.
// Voltage-палитра + off — те же значения попадают в CSS экспорта/симуляции.
const BINDING_CLASS_COLORS = {
  ...ANIMATION_CLASS_COLORS,
  'animation-off': ANIMATION_OFF_COLOR,
}

/**
 * Правила animationTemplate для конкретного слота — для info-tooltip'а
 * рядом со слотом. Дубликаты схлопываются.
 */
function slotBindingRules(slotKey, animationTemplate) {
  const rules = []
  for (const tpl of animationTemplate || []) {
    for (const binding of tpl.bindings || []) {
      if (!binding.tag?.includes(`{slot.${slotKey}}`)) continue
      const when = binding.when || {}
      if (when.type === 'map' && when.cases) {
        for (const [value, action] of Object.entries(when.cases)) {
          const cls = action?.apply?.addClass
          if (!cls) continue
          rules.push({
            condition: `= ${value}`,
            applyClass: cls,
            color: BINDING_CLASS_COLORS[cls] || null,
            hidden: cls === 'animation-hidden',
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
            hidden: cls === 'animation-hidden',
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

// switchSources принимает только bool-теги .ONOFF — эффект «false → затемнение»,
// аналоговый .UA/.IA бессмысленен. Регистронезависимо (tag-list иногда .OnOff).
const onoffTags = computed(() => project.tags.filter((t) => /\.ONOFF$/i.test(t.name)))

// Picker для switch-зависимостей исключает уже привязанные теги: основной
// тег ячейки (slot.onoff у cell_qw) + все теги из switchSources.tags, кроме
// редактируемого по индексу (его оставляем, чтобы юзер видел текущее значение).
const switchPickerTags = computed(() => {
  const d = details.value
  if (!d) return onoffTags.value
  const excluded = new Set()
  if (d.isSwitch && d.slots?.[0]?.value) excluded.add(d.slots[0].value)
  const currentTags = d.switchSources?.tags || []
  const editIdx = editingSwitchTagIdx.value
  currentTags.forEach((t, i) => {
    if (i !== editIdx && t) excluded.add(t)
  })
  return onoffTags.value.filter((t) => !excluded.has(t.name))
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
            <ul class="mt-2 space-y-0.5 text-[11px]">
              <li
                v-for="entry in selectionBreakdown"
                :key="entry.label"
                class="flex items-center justify-between gap-2"
              >
                <span class="text-surface-700 truncate">
                  {{ entry.label }}
                </span>
                <Tag
                  :value="String(entry.count)"
                  severity="secondary"
                  rounded
                  class="!text-[10px] !py-0"
                />
              </li>
            </ul>
            <p class="text-[11px] text-surface-500 mt-2">
              Ячейки можно тащить группой, удалить клавишей Del. Редактирование свойств — только при
              одном выделенном.
            </p>
          </div>

          <!-- Multi-select: голые add-кнопки в том же стиле что single Inspector
               add-секция. Карточка не рисуется — у выделения нет общего состояния
               (тег / диапазоны), показывать в карточке нечего. -->
          <div class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>
            <div class="flex flex-col gap-2">
              <Button
                label="Выключатель"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                outlined
                :disabled="!project.tags.length"
                @click="multiSwitchTagPickerOpen = true"
              />
              <Button
                label="Источник напряжения"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                outlined
                :disabled="!project.tags.length"
                @click="multiVoltageTagPickerOpen = true"
              />
            </div>
            <p v-if="!project.tags.length" class="text-[11px] text-surface-400">
              Загрузи tag-list, чтобы выбрать тег
            </p>
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
            Кликни по ячейке или проводу на холсте — здесь появятся свойства
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
                  <div class="flex items-center gap-1">
                    <Button
                      v-for="preset in TEXT_SIZE_PRESETS"
                      :key="preset.size"
                      :label="preset.label"
                      size="small"
                      :severity="details.fontSize === preset.size ? 'primary' : 'secondary'"
                      :outlined="details.fontSize !== preset.size"
                      @click="applyFontSize(preset.size)"
                    />
                  </div>
                </div>
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                    Жирность
                  </div>
                  <Button
                    label="B"
                    size="small"
                    class="!font-bold"
                    :severity="details.bold ? 'primary' : 'secondary'"
                    :outlined="!details.bold"
                    title="Жирный"
                    @click="toggleBold"
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
                  {{ details.valueTag || '— не выбран —' }}
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

            <!-- Навигация (hyperlink на другую view при клике в рантайме). Юзер
 вводит имя view строкой — IDE про другие view не знает, проверка
 по факту в рантайме (как `<a href>` в HTML). Свич справа от
 заголовка показывает/скрывает инпут; выключение очищает значение. -->
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
              <InputText
                v-if="navigationEnabled"
                :model-value="details.navigation"
                size="small"
                placeholder="view_id"
                class="w-full !text-xs font-mono"
                @update:model-value="patchNavigation"
              />
            </div>

            <!-- Слоты стенсила: каждый слот = один тег, который попадёт в
 соответствующие bindings шаблона при экспорте.
 cell_alr / cell_qw рендерят свой единственный required-слот в
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
 реагирующие на этот слот. Заменяет прежний read-only блок
 «Встроенные анимации» — теперь юзер видит описание только при наведении,
 панель не засоряется. Если у слота нет реактивных правил — иконку не рендерим. -->
                  <i
                    v-if="slot.tooltip"
                    v-tooltip.bottom="slot.tooltip"
                    class="pi pi-info-circle text-surface-400 cursor-help text-[11px]"
                  />
                  <!-- tagSuffix-чип — даёт юзеру понимание «этот слот ждёт тег с
 суффиксом .ONOFF» сразу, без открытия picker'а. type
 показываем только если суффикса нет (иначе суффикс
 информативнее: type=Boolean без контекста менее полезен). -->
                  <Tag
                    v-if="slot.tagSuffix"
                    v-tooltip.bottom="`Ожидается тег с суффиксом ${slot.tagSuffix}`"
                    :value="slot.tagSuffix"
                    severity="secondary"
                    rounded
                    class="ml-auto !font-mono !text-[10px] !py-0"
                  />
                  <span v-else-if="slot.type" class="text-surface-400 ml-auto font-mono">
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
                    {{
                      slot.value ||
                      (slot.tagSuffix ? `— выбрать тег ${slot.tagSuffix} —` : '— не выбран —')
                    }}
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

            <div class="space-y-2">
              <div>
                <div class="text-[11px] uppercase tracking-wider text-surface-500">Лейбл</div>
                <div class="text-[11px] text-surface-500">текст вдоль провода</div>
              </div>
              <InputText
                :model-value="details.label"
                size="small"
                placeholder="Фаза A"
                class="w-full !text-xs"
                @update:model-value="patchLinkLabel"
              />
            </div>
          </template>

          <div v-if="!details.isText && !details.isValue" class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>

            <!-- Встроенные анимации стенсила теперь живут в tooltip'е у иконки
 каждого слота (см. info-icon выше) — read-only блок убран,
 чтобы не засорять панель повторением декларативного поведения. -->

            <!-- A. Аварийный сигнал (cell_alr) / Выключатель (cell_qw):
 обёртки для required-слотов стенсилов (.alr / .onoff). Это
 интрисик-анимация шаблона, не отдельная tms-сущность. -->
            <!-- A. cell_alr — обёртка required-слота .alr. -->
            <AlarmSourceBlock
              v-if="details.isAlarm && details.slots[0]"
              :alarm-slot="details.slots[0]"
              :tags-loaded="!!project.tags.length"
              @open-tag-picker="openSlotPicker(details.slots[0])"
            />

            <!-- B. Привязка к выключателю(ям). Unified block: для cell_qw
                 включает slot.onoff (intrinsic) + switchSources.tags;
                 для остальных — только switchSources.tags. -->
            <SwitchBlock
              v-if="details.isSwitch || details.switchSources"
              :slot-info="details.isSwitch ? details.slots[0] : null"
              :tags="details.switchSources?.tags || null"
              tag-suffix=".ONOFF"
              :removable="!!details.switchSources"
              :tags-loaded="!!project.tags.length"
              title="Привязка к выключателю"
              @open-slot-picker="openSlotPicker(details.slots[0])"
              @open-tag-picker="onAddSwitchTag"
              @remove-tag="removeSwitchTagAt"
              @remove="removeSwitchSources"
              @highlight-tag="canvas.toggleHighlightedTag"
              @edit-tag="editSwitchTagAt"
            />

            <!-- C. Источник напряжения. -->
            <VoltageSourceBlock
              v-if="details.voltageSource"
              :voltage-source="details.voltageSource"
              :tags-loaded="!!project.tags.length"
              :class-options="ANIMATION_CLASS_OPTIONS"
              @open-tag-picker="tagPickerOpen = true"
              @update-range="updateRange"
              @highlight="toggleVoltageHighlight"
              @remove="removeVoltageSource"
            />

            <!-- Add-кнопки. Выключатель — везде кроме cell_alr (тревога не
                 поток) и cell_qw (блок уже виден через slot.onoff, add-кнопка
                 встроена в сам блок). Voltage — везде где нет. -->
            <div
              v-if="
                (!details.switchSources && !details.isAlarm && !details.isSwitch) ||
                !details.voltageSource
              "
              class="flex flex-col gap-2 pt-1"
            >
              <Button
                v-if="!details.switchSources && !details.isAlarm && !details.isSwitch"
                label="Выключатель"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                outlined
                @click="addSwitchSources"
              />
              <Button
                v-if="!details.voltageSource"
                label="Источник напряжения"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                outlined
                @click="addVoltageSource"
              />
            </div>
          </div>
        </div>
      </template>
    </div>

    <TagPickerDialog
      v-model:visible="slotPickerOpen"
      :tags="slotPickerTags"
      :selected="activeSlot?.value || ''"
      :header="activeSlot ? `Выберите тег: ${activeSlot.label}` : 'Выберите тег'"
      @select="onPickSlotTag"
    />

    <TagPickerDialog
      v-model:visible="tagPickerOpen"
      :tags="project.tags"
      :selected="details?.voltageSource?.tag || ''"
      header="Выберите тег источника напряжения"
      @select="onPickTag"
    />

    <TagPickerDialog
      v-model:visible="valueTagPickerOpen"
      :tags="project.tags"
      :selected="details?.valueTag || ''"
      header="Выберите тег для отображения значения"
      @select="onPickValueTag"
    />

    <TagPickerDialog
      v-model:visible="multiVoltageTagPickerOpen"
      :tags="project.tags"
      header="Тег источника для всех выделенных элементов"
      @select="onPickMultiVoltageTag"
    />

    <TagPickerDialog
      v-model:visible="switchTagPickerOpen"
      :tags="switchPickerTags"
      selected=""
      header="Добавить тег выключателя (.ONOFF)"
      @select="onPickSwitchTag"
    />

    <TagPickerDialog
      v-model:visible="multiSwitchTagPickerOpen"
      :tags="onoffTags"
      header="Тег выключателя для всех выделенных элементов (.ONOFF)"
      @select="onPickMultiSwitchTag"
    />
  </aside>
</template>
