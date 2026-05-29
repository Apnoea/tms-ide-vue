<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
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
  resolveValueDisplay
} from '../stencils/svgInjector'
import { nplural } from '../utils/plural'
import TagPickerDialog from './TagPickerDialog.vue'
import VoltageSourceBlock from './VoltageSourceBlock.vue'
import AlarmSourceBlock from './AlarmSourceBlock.vue'
import SwitchBlock from './SwitchBlock.vue'
import {
  ANIMATION_CLASS_COLORS,
  ANIMATION_CLASS_OPTIONS,
  ANIMATION_OFF_COLOR
} from '../constants/animation'
import { TOAST_LIFE } from '../constants/toast'

// Дефолтные диапазоны voltage-source при первом включении / применении тега
// через picker. Юзер дальше правит вручную. .map(r => ({...r})) на каждое
// использование — чтобы каждый элемент получил свой массив (правка ranges на
// одной ячейке не задевала другие, у которых ссылка на тот же массив).
const VOLTAGE_RANGE_DEFAULTS = [
  { min: 0, max: 4,  class: 'animation-low' },
  { min: 4, max: 7,  class: 'animation-mid' },
  { min: 7, max: 10, class: 'animation-high' }
]

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
      // cell_vk — аналогично, через тот же SwitchBlock но в intrinsic-режиме
      // (removable=false, обёртывает slot.onoff). Switch-source-кнопка
      // у выключателя дублировала бы тот же .ONOFF, который уже выбран в слоте,
      // поэтому тоже скрываем (для проводов и других ячеек она остаётся доступной).
      isSwitch: tms.stencilId === 'cell_vk',
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
        tooltip: buildSlotTooltip(s.key, stencil?.animationTemplate)
      })),
      voltageSource: tms.voltageSource || null,
      switchSource: tms.switchSource || null
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
      switchSource: tms.switchSource || null
    }
  }

  return null
})

// Multi-select breakdown: сводка по типам стенсилов в выделении.
// «3 Выключатель + 2 Связь» — даёт контекст к чему применишь massive-операцию,
// иначе ты видишь только число «5 элементов» и не понимаешь содержимого.
// Сортировка по убыванию count'а — самые частые первыми.
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

// ─── Редактирование слотов (привязка тегов к слотам стенсила) ───
// Picker для одного слота. activeSlotKey хранит ключ слота, в который
// записывается выбранный тег. typeFilter — для фильтрации tag-list'а
// (например только .ONOFF для Boolean-слота — TagPickerDialog принимает
// уже отфильтрованный массив).
const slotPickerOpen = ref(false)
const activeSlot = ref(null) // { key, label, type } или null

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

  // Перерисовываем содержимое cell-view'а — на этапе экспорта новые slots
  // подставятся в animationTemplate. SVG-id'шники остаются те же (cell.id),
  // но reinject нужен чтобы svgInjector подхватил новый расклад если стенсил
  // в будущем будет рендерить что-то по слотам напрямую.
  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil)

  canvas.bumpVersion()
  canvas.requestSnapshot()
}

// Фильтр тегов для текущего слота. Если у слота задан tagSuffix
// (например ".ONOFF" для cell_vk), показываем только теги с этим суффиксом.
// Иначе — весь tag-list. Регистронезависимо (tag-list иногда .OnOff).
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
// Отдельный picker для multi-select: один тег раздаётся на всё выделение сразу
// (lasso-сценарий). Дефолтные диапазоны, ranges правятся потом по одному элементу.
const multiVoltageTagPickerOpen = ref(false)

// ─── Tag-picker для cell_value (выбор отображаемого тега) ───
// Используем тот же TagPickerDialog, но с отдельным флагом — иначе оба
// диалога делили бы видимость и пересекались по логике @select.
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

/** Базовый патч tms.voltageSource у текущей выделенной ячейки/линии. */
function patchVoltageSource(patch) {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d) return

  const cell = graph.getCell(d.id)
  if (!cell) return

  const tms = cell.get('tms') || {}
  const current = tms.voltageSource || null
  const next = patch === null ? null : { ...(current || {}), ...patch }
  cell.set('tms', { ...tms, voltageSource: next })

  canvas.bumpVersion()
  canvas.requestSnapshot()
}

function addVoltageSource() {
  // Включение: ставим дефолтные диапазоны и пустой тег (юзер выберет через picker).
  patchVoltageSource({
    tag: '',
    ranges: VOLTAGE_RANGE_DEFAULTS.map((r) => ({ ...r }))
  })
}

function removeVoltageSource() {
  patchVoltageSource(null)
}

function onPickTag(tag) {
  patchVoltageSource({ tag })
}

function updateRange(idx, field, value) {
  const vs = details.value?.voltageSource
  if (!vs) return
  const ranges = vs.ranges.map((r, i) => (i === idx ? { ...r, [field]: field === 'class' ? value : Number(value) } : r))
  patchVoltageSource({ ranges })
}

/**
 * «Подсветить на схеме» — переключатель подсветки всех элементов с тем же
 * voltageSource.tag, что у текущего выделенного. Toggle: тот же тег второй
 * раз — снимает; новый тег — переключает на него. Гасится Escape'ом или
 * сменой кнопки в инспекторе.
 */
function toggleVoltageHighlight() {
  const tag = details.value?.voltageSource?.tag
  if (!tag) {
    toast.add({
      severity: 'warn',
      summary: 'Тег не выбран',
      detail: 'Выберите тег источника, чтобы подсветить элементы с тем же тегом',
      life: TOAST_LIFE.NORMAL
    })
    return
  }
  canvas.toggleHighlightedTag(tag)
}

/** Раздать voltageSource с выбранным тегом + дефолтными диапазонами на всё текущее выделение. */
function onPickMultiVoltageTag(tag) {
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
    // Пропускаем cell_text и cell_value — у них нет визуальной реакции
    // на voltage-классы, и в animations.json карточка только засоряет.
    if (tms.stencilId === 'cell_text' || tms.stencilId === 'cell_value') {
      skipped++
      continue
    }
    // Каждой ячейке — свежая deep-копия ranges, чтобы правка на одной не задевала других
    cell.set('tms', {
      ...tms,
      voltageSource: {
        tag,
        ranges: VOLTAGE_RANGE_DEFAULTS.map((r) => ({ ...r }))
      }
    })
    applied++
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
  toast.add({
    severity: 'success',
    summary: 'Источник применён',
    detail:
      skipped > 0
        ? `Тег привязан к ${nplural(applied, 'элемент', 'элемента', 'элементов')} · пропущено: ${skipped} (текст/значение)`
        : `Тег привязан к ${nplural(applied, 'элемент', 'элемента', 'элементов')}`,
    life: TOAST_LIFE.SHORT
  })
}

// ─── SwitchSource: bool-тег → класс animation-off (затемнение группы) ───
// По аналогии с voltageSource, но без ranges/classes — эффект захардкожен
// (single-purpose: «выключатель погас → группа потускнела»).

/** Базовый патч tms.switchSource у текущей выделенной ячейки/линии. */
function patchSwitchSource(patch) {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d) return

  const cell = graph.getCell(d.id)
  if (!cell) return

  const tms = cell.get('tms') || {}
  const current = tms.switchSource || null
  const next = patch === null ? null : { ...(current || {}), ...patch }
  cell.set('tms', { ...tms, switchSource: next })

  canvas.bumpVersion()
  canvas.requestSnapshot()
}

function addSwitchSource() {
  patchSwitchSource({ tag: '' })
}

function removeSwitchSource() {
  patchSwitchSource(null)
}

function onPickSwitchTag(tag) {
  patchSwitchSource({ tag })
}

/** Раздать switchSource с выбранным тегом на всё текущее выделение. */
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
    // Cell_text / cell_value — без визуальной реакции на animation-off:
    // у текста и value-дисплея opacity-фильтр выглядит странно, толку нет.
    if (tms.stencilId === 'cell_text' || tms.stencilId === 'cell_value') {
      skipped++
      continue
    }
    cell.set('tms', { ...tms, switchSource: { tag } })
    applied++
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
  toast.add({
    severity: 'success',
    summary: 'Выключатель привязан',
    detail:
      skipped > 0
        ? `Привязано к ${nplural(applied, 'элемент', 'элемента', 'элементов')} · пропущено: ${skipped} (текст/значение)`
        : `Привязано к ${nplural(applied, 'элемент', 'элемента', 'элементов')}`,
    life: TOAST_LIFE.SHORT
  })
}

const switchTagPickerOpen = ref(false)
const multiSwitchTagPickerOpen = ref(false)

// Цветовая карта для swatch'ей в подсказке-тултипе слота.
// Voltage-палитра + off — те же значения попадают в CSS экспорта/симуляции.
const BINDING_CLASS_COLORS = {
  ...ANIMATION_CLASS_COLORS,
  'animation-off': ANIMATION_OFF_COLOR
}

/**
 * Собирает встроенные правила анимации, реагирующие на конкретный slot.
 * Используется для тултипа у слота — «что произойдёт когда привязанный тег
 * примет такое-то значение». Полностью описано в stencil.animationTemplate;
 * показываем юзеру в человеко-читаемом виде (условие → swatch + класс).
 *
 * Дубликаты схлопываются: один и тот же `когда=false → animation-off` может
 * прийти из .VK и .VK-cross одновременно, юзеру это не важно.
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
            hidden: cls === 'animation-hidden'
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
            hidden: cls === 'animation-hidden'
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

/**
 * HTML-объект для PrimeVue v-tooltip: список правил из slotBindingRules
 * со swatch-индикаторами цвета. Возвращает null если правил нет — тогда
 * иконка-инфо у слота не рендерится.
 */
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
    showDelay: 300
  }
}

// SwitchSource привязывается ТОЛЬКО к bool-тегам с суффиксом .ONOFF —
// switchSource даёт эффект «выключатель = false → затемнение», аналоговый
// тег .UA/.IA тут бессмысленен. В picker'е скрываем не-ONOFF чтобы не
// поощрять типичную ошибку. Регистронезависимо (tag-list иногда .OnOff).
const onoffTags = computed(() =>
  project.tags.filter((t) => /\.ONOFF$/i.test(t.name))
)
</script>

<template>
  <aside
    class="h-full flex flex-col bg-surface-50 dark:bg-surface-900 border-l border-surface-200 dark:border-surface-700 select-none"
  >
    <div class="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50 uppercase tracking-wide">Инспектор</h2>
      <p class="text-xs text-surface-500 dark:text-surface-400">Свойства выделенного объекта</p>
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm">
      <!-- Multi-select: больше одного элемента — показываем сводку + удаление -->
      <template v-if="canvas.selection.value.length > 1">
        <div class="space-y-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">Выделено</div>
            <div class="font-medium text-surface-900 dark:text-surface-50">
              {{ nplural(canvas.selection.value.length, 'элемент', 'элемента', 'элементов') }}
            </div>
            <ul class="mt-2 space-y-0.5 text-[11px]">
              <li
                v-for="entry in selectionBreakdown"
                :key="entry.label"
                class="flex items-center justify-between gap-2"
              >
                <span class="text-surface-700 dark:text-surface-200 truncate">{{ entry.label }}</span>
                <Tag :value="String(entry.count)" severity="secondary" rounded class="!text-[10px] !py-0" />
              </li>
            </ul>
            <p class="text-[11px] text-surface-500 dark:text-surface-400 mt-2">
              Ячейки можно тащить группой, удалить клавишей Del. Редактирование свойств — только при одном выделенном.
            </p>
          </div>

          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
              Источник напряжения
            </div>
            <Button
              label="Привязать тег к выделению…"
              icon="pi pi-bolt"
              severity="secondary"
              size="small"
              class="w-full"
              :disabled="!project.tags.length"
              @click="multiVoltageTagPickerOpen = true"
            />
            <p v-if="!project.tags.length" class="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
              Загрузи tag-list, чтобы выбрать тег
            </p>
            <p v-else class="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
              Привяжет тег и дефолтные диапазоны ко всем выделенным элементам
            </p>
          </div>

          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
              Привязка к выключателю
            </div>
            <Button
              label="Привязать выключатель к выделению…"
              icon="pi pi-power-off"
              severity="secondary"
              size="small"
              class="w-full"
              :disabled="!project.tags.length"
              @click="multiSwitchTagPickerOpen = true"
            />
            <p v-if="!project.tags.length" class="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
              Загрузи tag-list, чтобы выбрать тег
            </p>
            <p v-else class="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
              При значении тега = false элементы окрасятся в серый (animation-off)
            </p>
          </div>

          <div class="pt-2 border-t border-surface-200 dark:border-surface-700">
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
        <div class="flex flex-col items-center text-center text-surface-400 dark:text-surface-500 py-10">
          <i class="pi pi-mouse text-3xl mb-3 opacity-60" />
          <div class="text-sm font-medium text-surface-500 dark:text-surface-400 mb-1">Ничего не выделено</div>
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

      <template v-else-if="details.kind === 'cell'">
        <div class="space-y-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">Стенсил</div>
            <div class="font-medium text-surface-900 dark:text-surface-50">
              {{ details.stencilLabel }}
            </div>
            <div class="text-[11px] text-surface-500 dark:text-surface-400 font-mono">
              {{ details.stencilId }}
            </div>
          </div>

          <!-- Текстовое поле: редактирование содержимого + стиль -->
          <div v-if="details.isText" class="space-y-3">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">Текст</div>
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
                <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
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
                <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
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
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Тег значения
            </div>
            <div class="flex items-center gap-2">
              <code
                class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded text-xs font-mono truncate transition-colors"
                :class="project.tags.length ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
                :title="project.tags.length ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'"
                @click="project.tags.length && openValueTagPicker()"
              >
                {{ details.valueTag || '— не выбран —' }}
              </code>
              <Button
                icon="pi pi-pencil"
                severity="secondary"
                text
                size="small"
                title="Выбрать тег"
                :disabled="!project.tags.length"
                @click="openValueTagPicker"
              />
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
              class="text-[11px] text-surface-500 dark:text-surface-400 mt-2 font-mono"
            >
              Подпись: <span class="text-surface-700 dark:text-surface-200">{{ valueDisplay.label }}</span>
              <template v-if="valueDisplay.unit">
                · единица: <span class="text-surface-700 dark:text-surface-200">{{ valueDisplay.unit }}</span>
              </template>
            </div>
          </div>

          <!-- Слоты стенсила: каждый слот = один тег, который попадёт в
               соответствующие bindings шаблона при экспорте.
               cell_alr / cell_vk рендерят свой единственный required-слот в
               специальном Alarm/Switch-блоке внутри секции «Анимации» — поэтому
               общий slot-row для них скрываем, чтобы тег не показывался дважды. -->
          <div v-else-if="details.slots.length && !details.isAlarm && !details.isSwitch" class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400">
              Привязки тегов
            </div>
            <div
              v-for="slot in details.slots"
              :key="slot.key"
              class="space-y-1"
            >
              <div class="flex items-center gap-2 text-[11px] text-surface-500 dark:text-surface-400">
                <span>{{ slot.label }}</span>
                <span
                  v-if="slot.required && !slot.value"
                  class="text-amber-500"
                  title="Обязательно для работы анимации"
                >*</span>
                <!-- info-иконка с тултипом: правила встроенной анимации стенсила,
                     реагирующие на этот слот. Заменяет прежний read-only блок
                     «Встроенные анимации» — теперь юзер видит описание только при наведении,
                     панель не засоряется. Если у слота нет реактивных правил — иконку не рендерим. -->
                <i
                  v-if="slot.tooltip"
                  v-tooltip.bottom="slot.tooltip"
                  class="pi pi-info-circle text-surface-400 dark:text-surface-500 cursor-help text-[11px]"
                  aria-label="Поведение анимации этого слота"
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
                <span
                  v-else-if="slot.type"
                  class="text-surface-400 dark:text-surface-500 ml-auto font-mono"
                >{{ slot.type }}</span>
              </div>
              <div class="flex items-center gap-2">
                <code
                  class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded text-xs font-mono truncate transition-colors"
                  :class="[
                    project.tags.length ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                    slot.required && !slot.value
                      ? 'border border-amber-500/40'
                      : ''
                  ]"
                  :title="project.tags.length ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'"
                  @click="project.tags.length && openSlotPicker(slot)"
                >
                  {{ slot.value || (slot.tagSuffix ? `— выбрать тег ${slot.tagSuffix} —` : '— не выбран —') }}
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
                <Button
                  icon="pi pi-pencil"
                  severity="secondary"
                  text
                  size="small"
                  title="Выбрать тег"
                  :disabled="!project.tags.length"
                  @click="openSlotPicker(slot)"
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

          <div v-if="!details.isText && !details.isValue" class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400">
              Анимации
            </div>

            <!-- Встроенные анимации стенсила теперь живут в tooltip'е у иконки
                 каждого слота (см. info-icon выше) — read-only блок убран,
                 чтобы не засорять панель повторением декларативного поведения. -->

            <!-- A. Аварийный сигнал (cell_alr) / Выключатель (cell_vk):
                 обёртки для required-слотов стенсилов (.alr / .onoff). Это
                 интрисик-анимация шаблона, не отдельная tms-сущность. -->
            <AlarmSourceBlock
              v-if="details.isAlarm && details.slots[0]"
              :alarm-slot="details.slots[0]"
              :tags-loaded="!!project.tags.length"
              @open-tag-picker="openSlotPicker(details.slots[0])"
            />
            <SwitchBlock
              v-if="details.isSwitch && details.slots[0]"
              :tag="details.slots[0].value"
              :tag-suffix="details.slots[0].tagSuffix"
              :required="details.slots[0].required"
              :removable="false"
              :tags-loaded="!!project.tags.length"
              @open-tag-picker="openSlotPicker(details.slots[0])"
            />

            <!-- B. Источник напряжения -->
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

            <!-- C. Привязка к выключателю -->
            <SwitchBlock
              v-if="details.switchSource"
              :tag="details.switchSource.tag"
              tag-suffix=".ONOFF"
              :removable="true"
              :tags-loaded="!!project.tags.length"
              title="Привязка к выключателю"
              @open-tag-picker="switchTagPickerOpen = true"
              @remove="removeSwitchSource"
            />

            <!-- Add buttons. Скрываем целиком, если соответствующий источник уже
                 привязан (юзеру не нужна disabled-кнопка-памятник). Дополнительно:
                 у cell_alr switch-source бессмыслен (тревога — не поток);
                 у cell_vk он дублирует тег, уже выбранный в SwitchBlock. -->
            <div
              v-if="!details.voltageSource || (!details.switchSource && !details.isAlarm && !details.isSwitch)"
              class="flex flex-wrap gap-2 pt-1"
            >
              <Button
                v-if="!details.voltageSource"
                label="Источник"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                outlined
                class="flex-1 min-w-[120px]"
                @click="addVoltageSource"
              />
              <Button
                v-if="!details.switchSource && !details.isAlarm && !details.isSwitch"
                label="Выключатель"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                outlined
                class="flex-1 min-w-[120px]"
                @click="addSwitchSource"
              />
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="details.kind === 'link'">
        <div class="space-y-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">Связь</div>
            <div class="font-medium text-surface-900 dark:text-surface-50">Провод</div>
          </div>

          <div class="grid gap-x-2 gap-y-1 items-center" style="grid-template-columns: 1fr auto 1fr">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400">Источник</div>
            <div></div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400">Цель</div>
            <code class="px-2 py-1 bg-surface-100 dark:bg-surface-800 rounded text-xs font-mono truncate">
              {{ details.sourceLabel }} · {{ details.sourcePort }}
            </code>
            <i class="pi pi-arrow-right text-surface-400 dark:text-surface-500 text-[10px]" aria-hidden="true" />
            <code class="px-2 py-1 bg-surface-100 dark:bg-surface-800 rounded text-xs font-mono truncate">
              {{ details.targetLabel }} · {{ details.targetPort }}
            </code>
          </div>

          <div class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400">
              Анимации
            </div>

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

            <SwitchBlock
              v-if="details.switchSource"
              :tag="details.switchSource.tag"
              tag-suffix=".ONOFF"
              :removable="true"
              :tags-loaded="!!project.tags.length"
              title="Привязка к выключателю"
              @open-tag-picker="switchTagPickerOpen = true"
              @remove="removeSwitchSource"
            />

            <div
              v-if="!details.voltageSource || !details.switchSource"
              class="flex flex-wrap gap-2 pt-1"
            >
              <Button
                v-if="!details.voltageSource"
                label="Источник"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                outlined
                class="flex-1 min-w-[120px]"
                @click="addVoltageSource"
              />
              <Button
                v-if="!details.switchSource"
                label="Выключатель"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                outlined
                class="flex-1 min-w-[120px]"
                @click="addSwitchSource"
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
      :tags="onoffTags"
      :selected="details?.switchSource?.tag || ''"
      header="Выберите тег выключателя (.ONOFF)"
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
