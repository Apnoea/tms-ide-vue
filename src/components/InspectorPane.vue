<script setup>
import { computed, ref } from 'vue'
import Button from 'primevue/button'
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
  resolveValueDisplay,
} from '../stencils/svgInjector'
import { getEligiblePrefixes, getUsedPrefixes } from '../stencils/tagMatching'
import { nplural } from '../utils/plural'
import PrefixPickerDialog from './PrefixPickerDialog.vue'
import TagPickerDialog from './TagPickerDialog.vue'

const canvas = useCanvas()
const project = useProjectStore()
const toast = useToast()
const confirm = useConfirm()

// ─── Источник напряжения для анимации ───
// Дефолтные диапазоны при первом включении на ячейке/проводе.
const VOLTAGE_RANGE_DEFAULTS = [
  { min: 0, max: 4,  class: 'animation-low' },
  { min: 4, max: 7,  class: 'animation-mid' },
  { min: 7, max: 10, class: 'animation-high' },
]
const VOLTAGE_CLASS_OPTIONS = ['animation-low', 'animation-mid', 'animation-high']

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
    const pos = cell.get('position')
    const size = cell.get('size')
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
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      width: size.width,
      height: size.height,
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
    life: 2500,
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
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  const d = details.value
  if (!graph || !paper || !d || !d.isText) return

  const cell = graph.getCell(d.id)
  const stencil = getStencilById(d.stencilId)
  if (!cell || !stencil) return

  const tms = cell.get('tms') || {}
  if ((tms.text ?? '') === newText) return
  cell.set('tms', { ...tms, text: newText })

  // Перерисовываем — buildTextContent читает свежий tms.text
  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil, tms.prefix)

  canvas.bumpVersion()
  canvas.requestSnapshot()
}

/** Общий апдейт tms текстового поля + перерисовка + ресайз высоты под шрифт. */
function patchTextCell(patch) {
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  const d = details.value
  if (!graph || !paper || !d || !d.isText) return

  const cell = graph.getCell(d.id)
  const stencil = getStencilById(d.stencilId)
  if (!cell || !stencil) return

  const tms = cell.get('tms') || {}
  cell.set('tms', { ...tms, ...patch })

  // Высоту cell'а подгоняем под размер шрифта, чтобы hit-area совпадала с текстом
  const fontSize = patch.fontSize ?? tms.fontSize ?? TEXT_FONT_SIZE
  cell.resize(cell.get('size').width, textCellHeight(fontSize))

  const cellView = paper.findViewByModel(cell)
  if (cellView) injectStencilSvg(cellView, stencil, tms.prefix)

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

function toggleVoltageSource(event) {
  if (event.target.checked) {
    // Включение: ставим дефолтные диапазоны и пустой тег (юзер выберет через picker)
    patchVoltageSource({ tag: '', ranges: VOLTAGE_RANGE_DEFAULTS.map((r) => ({ ...r })) })
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
      life: 3000,
    })
    return
  }

  const cells = graph.getElements()
  const links = graph.getLinks()
  const total = cells.length + links.length

  confirm.require({
    header: 'Применить ко всей схеме?',
    message: `Конфиг источника будет перезаписан у ${nplural(total, 'элемент', 'элемента', 'элементов')} (${cells.length} ячеек + ${links.length} линий). Прежние настройки voltageSource у других элементов будут затёрты.`,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Применить',
    rejectLabel: 'Отмена',
    acceptProps: { severity: 'primary', size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    accept: () => {
      const cfg = {
        tag: d.voltageSource.tag,
        ranges: d.voltageSource.ranges.map((r) => ({ ...r })),
      }
      for (const c of [...cells, ...links]) {
        const tms = c.get('tms') || {}
        c.set('tms', { ...tms, voltageSource: { ...cfg, ranges: cfg.ranges.map((r) => ({ ...r })) } })
      }
      canvas.bumpVersion()
      canvas.requestSnapshot()
      toast.add({
        severity: 'success',
        summary: 'Применено',
        detail: `Источник раздан на ${nplural(total, 'элемент', 'элемента', 'элементов')}`,
        life: 2500,
      })
    },
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
            Кликни по ячейке или линии на холсте — здесь появятся её свойства
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
              <input
                type="text"
                :value="details.text"
                class="w-full px-2 py-1.5 text-sm rounded border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-800 text-surface-900 dark:text-surface-50 focus:outline-none focus:border-primary-500"
                placeholder="Введите текст"
                @input="applyText($event.target.value)"
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
                class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 rounded text-xs font-mono truncate"
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
                class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 rounded text-xs font-mono"
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

          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
                Позиция
              </div>
              <div class="font-mono text-xs">{{ details.x }}, {{ details.y }}</div>
            </div>
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
                Размер
              </div>
              <div class="font-mono text-xs">{{ details.width }} × {{ details.height }}</div>
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

          <!-- Источник напряжения для анимации -->
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Источник напряжения
            </div>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                :checked="!!details.voltageSource"
                class="accent-primary-500"
                @change="toggleVoltageSource"
              />
              <span class="text-surface-700 dark:text-surface-200">Использовать как источник</span>
            </label>

            <template v-if="details.voltageSource">
              <div class="mt-3 space-y-3">
                <div>
                  <div class="text-[11px] text-surface-500 dark:text-surface-400 mb-1">Тег</div>
                  <div class="flex items-center gap-2">
                    <code class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 rounded text-xs font-mono truncate">
                      {{ details.voltageSource.tag || '— не выбран —' }}
                    </code>
                    <Button
                      icon="pi pi-pencil"
                      severity="secondary"
                      text
                      size="small"
                      title="Выбрать тег"
                      :disabled="!project.tags.length"
                      @click="tagPickerOpen = true"
                    />
                  </div>
                  <div
                    v-if="!project.tags.length"
                    class="text-[11px] text-surface-400 dark:text-surface-500 mt-1"
                  >
                    Загрузи tag-list, чтобы выбрать тег
                  </div>
                </div>

                <div>
                  <div class="text-[11px] text-surface-500 dark:text-surface-400 mb-1">Диапазоны</div>
                  <div class="space-y-1">
                    <div
                      v-for="(r, idx) in details.voltageSource.ranges"
                      :key="idx"
                      class="flex items-center gap-1.5"
                    >
                      <input
                        type="number"
                        :value="r.min"
                        step="0.1"
                        class="w-14 px-1 py-0.5 text-xs rounded border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-800 text-surface-900 dark:text-surface-50 font-mono focus:outline-none focus:border-primary-500"
                        @change="updateRange(idx, 'min', $event.target.value)"
                      />
                      <span class="text-surface-400 text-xs">–</span>
                      <input
                        type="number"
                        :value="r.max"
                        step="0.1"
                        class="w-14 px-1 py-0.5 text-xs rounded border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-800 text-surface-900 dark:text-surface-50 font-mono focus:outline-none focus:border-primary-500"
                        @change="updateRange(idx, 'max', $event.target.value)"
                      />
                      <select
                        :value="r.class"
                        class="flex-1 px-1 py-0.5 text-xs rounded border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-800 text-surface-900 dark:text-surface-50 font-mono focus:outline-none focus:border-primary-500"
                        @change="updateRange(idx, 'class', $event.target.value)"
                      >
                        <option v-for="c in VOLTAGE_CLASS_OPTIONS" :key="c" :value="c">{{ c }}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <Button
                  label="Применить ко всей схеме"
                  icon="pi pi-globe"
                  severity="secondary"
                  size="small"
                  class="w-full"
                  :disabled="!details.voltageSource.tag"
                  @click="applyVoltageSourceToAll"
                />
              </div>
            </template>
          </div>

          <div class="pt-2 border-t border-surface-200 dark:border-surface-700">
            <Button
              label="Удалить ячейку"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              @click="onDelete"
            />
          </div>
        </div>
      </template>

      <template v-else-if="details.kind === 'link'">
        <div class="space-y-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Связь
            </div>
            <div class="font-medium text-surface-900 dark:text-surface-50">Линия</div>
          </div>

          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Источник
            </div>
            <code class="font-mono text-xs">
              {{ details.sourcePrefix }} · {{ details.sourcePort }}
            </code>
          </div>

          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Цель
            </div>
            <code class="font-mono text-xs">
              {{ details.targetPrefix }} · {{ details.targetPort }}
            </code>
          </div>

          <!-- Источник напряжения для анимации (та же логика, что у ячейки) -->
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
              Источник напряжения
            </div>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                :checked="!!details.voltageSource"
                class="accent-primary-500"
                @change="toggleVoltageSource"
              />
              <span class="text-surface-700 dark:text-surface-200">Использовать как источник</span>
            </label>

            <template v-if="details.voltageSource">
              <div class="mt-3 space-y-3">
                <div>
                  <div class="text-[11px] text-surface-500 dark:text-surface-400 mb-1">Тег</div>
                  <div class="flex items-center gap-2">
                    <code class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 rounded text-xs font-mono truncate">
                      {{ details.voltageSource.tag || '— не выбран —' }}
                    </code>
                    <Button
                      icon="pi pi-pencil"
                      severity="secondary"
                      text
                      size="small"
                      title="Выбрать тег"
                      :disabled="!project.tags.length"
                      @click="tagPickerOpen = true"
                    />
                  </div>
                  <div
                    v-if="!project.tags.length"
                    class="text-[11px] text-surface-400 dark:text-surface-500 mt-1"
                  >
                    Загрузи tag-list, чтобы выбрать тег
                  </div>
                </div>

                <div>
                  <div class="text-[11px] text-surface-500 dark:text-surface-400 mb-1">Диапазоны</div>
                  <div class="space-y-1">
                    <div
                      v-for="(r, idx) in details.voltageSource.ranges"
                      :key="idx"
                      class="flex items-center gap-1.5"
                    >
                      <input
                        type="number"
                        :value="r.min"
                        step="0.1"
                        class="w-14 px-1 py-0.5 text-xs rounded border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-800 text-surface-900 dark:text-surface-50 font-mono focus:outline-none focus:border-primary-500"
                        @change="updateRange(idx, 'min', $event.target.value)"
                      />
                      <span class="text-surface-400 text-xs">–</span>
                      <input
                        type="number"
                        :value="r.max"
                        step="0.1"
                        class="w-14 px-1 py-0.5 text-xs rounded border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-800 text-surface-900 dark:text-surface-50 font-mono focus:outline-none focus:border-primary-500"
                        @change="updateRange(idx, 'max', $event.target.value)"
                      />
                      <select
                        :value="r.class"
                        class="flex-1 px-1 py-0.5 text-xs rounded border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-800 text-surface-900 dark:text-surface-50 font-mono focus:outline-none focus:border-primary-500"
                        @change="updateRange(idx, 'class', $event.target.value)"
                      >
                        <option v-for="c in VOLTAGE_CLASS_OPTIONS" :key="c" :value="c">{{ c }}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <Button
                  label="Применить ко всей схеме"
                  icon="pi pi-globe"
                  severity="secondary"
                  size="small"
                  class="w-full"
                  :disabled="!details.voltageSource.tag"
                  @click="applyVoltageSourceToAll"
                />
              </div>
            </template>
          </div>

          <div class="pt-2 border-t border-surface-200 dark:border-surface-700">
            <Button
              label="Удалить линию"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              @click="onDelete"
            />
          </div>
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
  </aside>
</template>
