<script setup>
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { useCanvas } from '../composables/useCanvas'
import { useProjectStore } from '../stores/useProjectStore'
import { getStencilById } from '../stencils/registry'
import {
  injectStencilSvg,
  TEXT_FONT_SIZE,
  TEXT_SIZE_PRESETS,
  textCellHeight,
  textCellWidth,
  resolveValueDisplay,
} from '../stencils/svgInjector'
import { getEligiblePrefixes, getUsedPrefixes } from '../stencils/tagMatching'
import { nplural } from '../utils/plural'
import PrefixPickerDialog from './PrefixPickerDialog.vue'
import TagPickerDialog from './TagPickerDialog.vue'
import VoltageSourceBlock from './VoltageSourceBlock.vue'
import {
  ANIMATION_CLASS_OPTIONS,
  createDefaultVoltageConfig,
} from '../constants/animation'
import { TOAST_LIFE } from '../constants/toast'

const canvas = useCanvas()
const project = useProjectStore()
const toast = useToast()
const confirm = useConfirm()


// Computed-и читают canvas.graphVersion, чтобы пересчитываться при изменениях графа
// (JointJS-модели не Vue-reactive, ловим через явный version-tick).
const details = computed(() => {
  // eslint-disable-next-line no-unused-expressions
  canvas.graphVersion.value
  const sel = canvas.singleSelection.value // мульти-режим обрабатывается отдельно
  const graph = canvas.graphRef.value
  if (!sel || !graph) return null
  const cell = graph.getCell(sel.id)
  if (!cell) return null

  if (sel.kind === 'cell') {
    const tms = cell.get('tms') || {}
    const stencil = tms.stencilId ? getStencilById(tms.stencilId) : null
    const tagSuffixes = stencil?.tagSuffixes || []

    return {
      kind: 'cell',
      id: cell.id,
      stencilId: tms.stencilId,
      stencilLabel: stencil?.label || tms.stencilId || '—',
      prefix: tms.prefix,
      isText: tms.stencilId === 'cell_text',
      text: tms.text ?? '',
      fontSize: tms.fontSize ?? TEXT_FONT_SIZE,
      bold: !!tms.bold,
      isValue: tms.stencilId === 'cell_value',
      valueTag: tms.valueTag ?? '',
      tags: tagSuffixes.map((s) => ({
        name: `${tms.prefix}${s.suffix}`,
        type: s.type,
        required: s.required,
      })),
      animationCount: stencil?.animationTemplate?.length || 0,
      voltageSource: tms.voltageSource || null,
    }
  }

  if (sel.kind === 'link') {
    const source = cell.get('source')
    const target = cell.get('target')
    const sourceCell = source?.id ? graph.getCell(source.id) : null
    const targetCell = target?.id ? graph.getCell(target.id) : null
    const tms = cell.get('tms') || {}
    return {
      kind: 'link',
      id: cell.id,
      sourcePrefix: sourceCell?.get('tms')?.prefix || '—',
      sourcePort: source?.port || '—',
      targetPrefix: targetCell?.get('tms')?.prefix || '—',
      targetPort: target?.port || '—',
      voltageSource: tms.voltageSource || null,
    }
  }

  return null
})

// ─── Добавить анимацию (заглушка) ───
function onAddAnimation() {
  // Пока без функционала — позже сюда подключим выбор типа анимации
  // (text/shape/complex/multi), привязку к тегу, маппинг bindings.
  toast.add({
    severity: 'info',
    summary: 'Анимации',
    detail: 'Редактирование анимаций в разработке',
    life: TOAST_LIFE.SHORT,
  })
}

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

// ─── Смена prefix'а ───
const pickerOpen = ref(false)
const pickerOptions = ref([])
const pickerLabel = ref('')
const pickerTagSuffixes = ref([])

function openPrefixPicker() {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d || d.kind !== 'cell' || !d.stencilId) return

  const stencil = getStencilById(d.stencilId)
  if (!stencil) return

  // Used фильтруем по stencilId, чтобы prefix'ы, занятые другими стенсилами,
  // оставались доступны (разные стенсилы могут сидеть на одном prefix'е).
  const used = getUsedPrefixes(graph, d.stencilId)
  used.delete(d.prefix)
  const eligible = getEligiblePrefixes(stencil, project.tags, used)

  pickerOptions.value = eligible
  pickerLabel.value = stencil.label
  pickerTagSuffixes.value = stencil.tagSuffixes || []
  pickerOpen.value = true
}

function applyNewPrefix(newPrefix) {
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  const d = details.value
  if (!graph || !paper || !d || d.kind !== 'cell') return
  if (!newPrefix || newPrefix === d.prefix) return

  const cell = graph.getCell(d.id)
  const stencil = getStencilById(d.stencilId)
  if (!cell || !stencil) return

  const tms = cell.get('tms') || {}
  cell.set('tms', { ...tms, prefix: newPrefix })

  // Перерисовываем содержимое cell-view'а с новым prefix'ом —
  // меняются id="animation-{prefix}*" внутри SVG.
  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil, newPrefix)

  canvas.bumpVersion()
  // CanvasPane снимает snapshot только на pointerup/add/remove — нужно
  // явно попросить его сохранить состояние после изменения через Inspector.
  canvas.requestSnapshot()
}

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
  const same =
    next.text === tms.text &&
    next.fontSize === tms.fontSize &&
    next.bold === tms.bold
  if (same) return
  cell.set('tms', next)

  // Размер cell'а подгоняем и по ширине (под содержимое), и по высоте (под шрифт) —
  // hit-area тогда совпадает с реально отображаемым текстом, inline-X прижимается к нему.
  const fontSize = next.fontSize ?? TEXT_FONT_SIZE
  const bold = !!next.bold
  cell.resize(textCellWidth(next.text ?? '', fontSize, bold), textCellHeight(fontSize))

  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil, tms.prefix)

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
  if (cellView) injectStencilSvg(cellView, stencil, tms.prefix)

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

function toggleVoltageSource(checked) {
  if (checked) {
    // Включение: ставим дефолтные диапазоны и пустой тег (юзер выберет через picker)
    patchVoltageSource(createDefaultVoltageConfig(''))
  } else {
    patchVoltageSource(null)
  }
}

function onPickTag(tag) {
  patchVoltageSource({ tag })
}

function updateRange(idx, field, value) {
  const vs = details.value?.voltageSource
  if (!vs) return
  const ranges = vs.ranges.map((r, i) =>
    i === idx ? { ...r, [field]: field === 'class' ? value : Number(value) } : r
  )
  patchVoltageSource({ ranges })
}

/** Раздать текущий voltageSource на ВСЕ ячейки + линки графа (с подтверждением). */
function applyVoltageSourceToAll() {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d?.voltageSource) return
  if (!d.voltageSource.tag) {
    toast.add({
      severity: 'warn',
      summary: 'Тег не выбран',
      detail: 'Выберите тег источника, прежде чем раздавать конфиг на схему',
      life: TOAST_LIFE.NORMAL,
    })
    return
  }

  // Cell_text — статичная подпись, cell_value — дисплей значения тега.
  // Ни тот, ни другой не реагируют на voltage-классы визуально → нет смысла
  // раздавать им конфиг (засоряет model + animations.json при экспорте).
  const cells = graph.getElements().filter((c) => {
    const sid = c.get('tms')?.stencilId
    return sid !== 'cell_text' && sid !== 'cell_value'
  })
  const links = graph.getLinks()
  const total = cells.length + links.length

  confirm.require({
    header: 'Применить ко всей схеме?',
    message: `Конфиг источника будет перезаписан у ${nplural(total, 'элемент', 'элемента', 'элементов')} (${cells.length} ячеек + ${links.length} линий). Текстовые поля и поля значений пропускаются. Прежние настройки voltageSource у других элементов будут затёрты.`,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Применить',
    rejectLabel: 'Отмена',
    acceptProps: { severity: 'primary', size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    accept: () => {
      const tag = d.voltageSource.tag
      const ranges = d.voltageSource.ranges
      for (const c of [...cells, ...links]) {
        const tms = c.get('tms') || {}
        c.set('tms', {
          ...tms,
          voltageSource: { tag, ranges: ranges.map((r) => ({ ...r })) },
        })
      }
      canvas.bumpVersion()
      canvas.requestSnapshot()
      toast.add({
        severity: 'success',
        summary: 'Применено',
        detail: `Источник раздан на ${nplural(total, 'элемент', 'элемента', 'элементов')}`,
        life: TOAST_LIFE.SHORT,
      })
    },
  })
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
    // Каждой ячейке — свежая deep-копия, чтобы правка ranges на одной не задевала других
    cell.set('tms', { ...tms, voltageSource: createDefaultVoltageConfig(tag) })
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
    life: TOAST_LIFE.SHORT,
  })
}
</script>

<template>
  <aside
    class="h-full flex flex-col bg-surface-50 dark:bg-surface-900 border-l border-surface-200 dark:border-surface-700"
  >
    <div class="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
      <h2
        class="text-sm font-semibold text-surface-900 dark:text-surface-50 uppercase tracking-wide"
      >
        Инспектор
      </h2>
      <p class="text-xs text-surface-500 dark:text-surface-400">
        Свойства выделенного объекта
      </p>
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm">
      <!-- Multi-select: больше одного элемента — показываем сводку + удаление -->
      <template v-if="canvas.selection.value.length > 1">
        <div class="space-y-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Выделено
            </div>
            <div class="font-medium text-surface-900 dark:text-surface-50">
              {{ nplural(canvas.selection.value.length, 'элемент', 'элемента', 'элементов') }}
            </div>
            <p class="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
              Ячейки можно тащить группой, удалить клавишей Del.
              Редактирование свойств — только при одном выделенном.
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
            <p
              v-if="!project.tags.length"
              class="text-[11px] text-surface-400 dark:text-surface-500 mt-1"
            >
              Загрузи tag-list, чтобы выбрать тег
            </p>
            <p
              v-else
              class="text-[11px] text-surface-500 dark:text-surface-400 mt-1"
            >
              Привяжет тег и дефолтные диапазоны ко всем выделенным элементам
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
        <div
          class="flex flex-col items-center text-center text-surface-400 dark:text-surface-500 py-10"
        >
          <i class="pi pi-mouse text-3xl mb-3 opacity-60" />
          <div class="text-sm font-medium text-surface-500 dark:text-surface-400 mb-1">
            Ничего не выделено
          </div>
          <p class="text-[11px] leading-relaxed max-w-[180px]">
            Кликни по ячейке или проводу на холсте — здесь появятся свойства
          </p>
        </div>
      </template>

      <template v-else-if="details.kind === 'cell'">
        <div class="space-y-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Стенсил
            </div>
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
              <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
                Текст
              </div>
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
            <div
              v-if="!project.tags.length"
              class="text-[11px] text-surface-400 dark:text-surface-500 mt-1"
            >
              Загрузи tag-list, чтобы выбрать тег
            </div>
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

          <div v-else>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Префикс объекта
            </div>
            <div class="flex items-center gap-2">
              <code
                class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded text-xs font-mono transition-colors"
                :class="project.tags.length ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
                :title="project.tags.length ? 'Сменить prefix' : 'Загрузи tag-list, чтобы менять prefix'"
                @click="project.tags.length && openPrefixPicker()"
              >
                {{ details.prefix }}
              </code>
              <Button
                icon="pi pi-pencil"
                severity="secondary"
                text
                size="small"
                title="Сменить prefix"
                :disabled="!project.tags.length"
                @click="openPrefixPicker"
              />
            </div>
            <div
              v-if="!project.tags.length"
              class="text-[11px] text-surface-400 dark:text-surface-500 mt-1"
            >
              Загрузи tag-list, чтобы менять prefix
            </div>
          </div>

          <div v-if="details.tags.length">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Теги ({{ details.tags.length }})
            </div>
            <ul class="space-y-0.5">
              <li
                v-for="t in details.tags"
                :key="t.name"
                class="flex items-center justify-between text-xs"
              >
                <code class="font-mono text-surface-700 dark:text-surface-200">
                  {{ t.name }}
                </code>
                <span class="text-[10px] text-surface-400 dark:text-surface-500">
                  {{ t.type }}
                </span>
              </li>
            </ul>
          </div>

          <div v-if="!details.isText && !details.isValue">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Анимации ({{ details.animationCount }})
            </div>
            <p class="text-[11px] text-surface-500 dark:text-surface-400 mb-2">
              Карточки определены стенсилом и регенерируются при экспорте
            </p>
            <Button
              label="Добавить анимацию"
              icon="pi pi-plus"
              severity="secondary"
              text
              size="small"
              class="w-full !justify-start"
              @click="onAddAnimation"
            />
          </div>

          <VoltageSourceBlock
            :voltage-source="details.voltageSource"
            :tags-loaded="!!project.tags.length"
            :class-options="ANIMATION_CLASS_OPTIONS"
            @toggle="toggleVoltageSource"
            @open-tag-picker="tagPickerOpen = true"
            @update-range="updateRange"
            @apply-to-all="applyVoltageSourceToAll"
          />
        </div>
      </template>

      <template v-else-if="details.kind === 'link'">
        <div class="space-y-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Связь
            </div>
            <div class="font-medium text-surface-900 dark:text-surface-50">Провод</div>
          </div>

          <div
            class="grid gap-x-2 gap-y-1 items-center"
            style="grid-template-columns: 1fr auto 1fr"
          >
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400">
              Источник
            </div>
            <div></div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400">
              Цель
            </div>
            <code class="px-2 py-1 bg-surface-100 dark:bg-surface-800 rounded text-xs font-mono truncate">
              {{ details.sourcePrefix }} · {{ details.sourcePort }}
            </code>
            <i class="pi pi-arrow-right text-surface-400 dark:text-surface-500 text-[10px]" aria-hidden="true" />
            <code class="px-2 py-1 bg-surface-100 dark:bg-surface-800 rounded text-xs font-mono truncate">
              {{ details.targetPrefix }} · {{ details.targetPort }}
            </code>
          </div>

          <VoltageSourceBlock
            :voltage-source="details.voltageSource"
            :tags-loaded="!!project.tags.length"
            :class-options="ANIMATION_CLASS_OPTIONS"
            @toggle="toggleVoltageSource"
            @open-tag-picker="tagPickerOpen = true"
            @update-range="updateRange"
            @apply-to-all="applyVoltageSourceToAll"
          />
        </div>
      </template>
    </div>

    <PrefixPickerDialog
      v-model:visible="pickerOpen"
      :options="pickerOptions"
      :stencil-label="pickerLabel"
      :tag-suffixes="pickerTagSuffixes"
      @select="applyNewPrefix"
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
  </aside>
</template>
