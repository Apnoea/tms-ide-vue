<script setup>
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import TagField from './TagField.vue'
import { RANGE_COLOR_PRESETS, rangeRowColor } from '../constants/animation'

/**
 * Карточка анимации «Значение тега → цвет по диапазону» в инспекторе. Виден всегда;
 * `rangeSource === null` — пустое состояние (тег не выбран, строк нет). Объект создаётся
 * лениво в родителе при выборе тега, очищается через × (× виден только при непустом).
 *
 * Сравнение в рантайме inclusive по обоим концам, поэтому одинаковые границы задают
 * точное значение — так настраиваются целочисленные теги (режим оборудования).
 *
 * Эмитит intent'ы (open-tag-picker / update-range / add-range / remove-range /
 * highlight / remove / copy / paste). Состоянием
 * (объектом rangeSource) владеет родитель — мы только рендерим и зовём.
 */
defineProps({
  rangeSource: { type: Object, default: null }, // { tag, ranges } | null
  tagsLoaded: { type: Boolean, default: false },
  // copyable — есть что копировать (задан rangeSource); pasteable — в буфере
  // анимаций лежат диапазоны, кнопку «вставить» показываем на любом выделении.
  copyable: { type: Boolean, default: false },
  pasteable: { type: Boolean, default: false },
})

defineEmits([
  'open-tag-picker',
  'update-range',
  'add-range',
  'remove-range',
  'highlight',
  'remove',
  'copy',
  'paste',
])

// Быстрые свотчи под пикером: прежняя палитра диапазонов как отправная точка.
const PRESETS = RANGE_COLOR_PRESETS
const rowColor = rangeRowColor

/** Пустая ячейка — строка без порога: в экспорт она не попадёт. */
const cellText = (v) => (Number.isFinite(v) ? String(v) : '')
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i class="pi pi-chart-bar text-yellow-500" />
      <div class="text-xs font-medium text-surface-700">Диапазоны значений</div>
      <div class="ml-auto flex items-center">
        <Button
          v-if="pasteable"
          v-tooltip.bottom="'Вставить свойства'"
          icon="pi pi-clipboard"
          severity="secondary"
          text
          size="small"
          class="p-1! w-6! h-6!"
          @click="$emit('paste')"
        />
        <Button
          v-if="copyable"
          v-tooltip.bottom="'Копировать свойства'"
          icon="pi pi-copy"
          severity="secondary"
          text
          size="small"
          class="p-1! w-6! h-6!"
          @click="$emit('copy')"
        />
        <Button
          v-if="rangeSource"
          v-tooltip.bottom="'Очистить'"
          icon="pi pi-times"
          severity="secondary"
          text
          size="small"
          class="p-1! w-6! h-6!"
          @click="$emit('remove')"
        />
      </div>
    </div>

    <p class="text-[11px] text-surface-500 mb-2 leading-snug">
      Цвет по диапазону значения. Одинаковые границы - точное значение: «3 - 3» сработает только на
      3.
    </p>

    <div class="space-y-3">
      <div>
        <div class="text-[11px] text-surface-500 mb-1">
          Тег
          <span class="text-surface-400">для анимации элемента</span>
        </div>
        <TagField
          :value="rangeSource?.tag || ''"
          :can-pick="tagsLoaded"
          highlightable
          @pick="$emit('open-tag-picker')"
          @highlight="$emit('highlight')"
        />
      </div>

      <div v-if="rangeSource?.tag">
        <div class="text-[11px] text-surface-500 mb-1">Диапазоны</div>
        <div class="space-y-1">
          <div v-for="(r, idx) in rangeSource.ranges" :key="idx" class="flex items-center gap-1.5">
            <!-- Границы забирают остаток строки: свотчи, пикер и удаление фиксированы,
                 поэтому во всех строках стоят на одном месте. -->
            <div class="flex flex-1 min-w-0 items-center gap-1.5">
              <InputText
                :model-value="cellText(r.min)"
                size="small"
                class="flex-1 min-w-0 font-mono text-xs!"
                inputmode="decimal"
                @change="$emit('update-range', idx, 'min', $event.target.value)"
              />
              <span class="text-surface-400 text-xs">–</span>
              <InputText
                :model-value="cellText(r.max)"
                size="small"
                class="flex-1 min-w-0 font-mono text-xs!"
                inputmode="decimal"
                @change="$emit('update-range', idx, 'max', $event.target.value)"
              />
            </div>
            <!-- Пресеты прежней палитры первыми: типовой цвет ставится одним кликом,
                 пикер нужен только для своего. -->
            <div class="flex items-center gap-1 shrink-0">
              <button
                v-for="preset in PRESETS"
                :key="preset"
                type="button"
                class="h-5 w-5 rounded-sm border border-surface-300 cursor-pointer"
                :class="rowColor(r) === preset ? 'ring-2 ring-primary-400' : ''"
                :style="{ background: preset }"
                @click="$emit('update-range', idx, 'color', preset)"
              />
            </div>
            <!-- Тот же размер, что у пикеров цвета в остальных блоках инспектора. -->
            <input
              type="color"
              :value="rowColor(r) || '#10b981'"
              class="h-8 w-10 shrink-0 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
              @input="$emit('update-range', idx, 'color', $event.target.value)"
            />
            <Button
              v-tooltip.bottom="'Удалить строку'"
              icon="pi pi-times"
              severity="secondary"
              text
              size="small"
              class="p-1! w-6! h-6! shrink-0"
              @click="$emit('remove-range', idx)"
            />
          </div>
        </div>
        <Button
          label="Добавить диапазон"
          icon="pi pi-plus"
          severity="secondary"
          text
          size="small"
          class="mt-1 p-1! text-xs!"
          @click="$emit('add-range')"
        />
      </div>
    </div>
  </div>
</template>
