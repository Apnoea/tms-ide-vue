<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import TagField from './TagField.vue'
import ColorField from './ColorField.vue'
import { rangeRowColor } from '../constants/animation'
import { rangeBarSegments } from '../utils/rangeBar'

/**
 * Карточка анимации «Значение тега → цвет по диапазону» в инспекторе. Виден всегда;
 * `rangeSource === null` — пустое состояние (тег не выбран, строк нет). Объект создаётся
 * лениво в родителе при выборе тега, очищается через × (× виден только при непустом).
 *
 * Сравнение в рантайме inclusive по обоим концам, поэтому одинаковые границы задают
 * точное значение — так настраиваются целочисленные теги.
 *
 * Эмитит intent'ы (open-tag-picker / update-range / add-range / remove-range /
 * highlight / remove / copy / paste). Состоянием
 * (объектом rangeSource) владеет родитель — мы только рендерим и зовём.
 */
const props = defineProps({
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

const rowColor = rangeRowColor

/** Сегменты полоски-превью; `null` — рисовать нечего (нет годных строк). */
const bar = computed(() => rangeBarSegments(props.rangeSource?.ranges))

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
      Цвет по диапазону значения. Одинаковые границы — точное значение: «3 — 3» сработает только на
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
        <!-- Полоска-превью: в столбике чисел не видно ни порядка, ни пропусков, ни
             того, какая полоса шире. Фон под сегментами остаётся там, где значения
             цвета не получат. -->
        <template v-if="bar">
          <div class="relative mb-1 h-2 w-full overflow-hidden rounded-sm bg-surface-200">
            <span
              v-for="(s, i) in bar.segments"
              :key="i"
              v-tooltip.top="`${s.from} – ${s.to}`"
              class="absolute inset-y-0"
              :style="{ left: `${s.left}%`, width: `${s.width}%`, background: s.color }"
            />
          </div>
          <div class="mb-2 flex justify-between font-mono text-[10px] text-surface-400">
            <span>{{ bar.from }}</span>
            <span>{{ bar.to }}</span>
          </div>
        </template>
        <div class="space-y-1">
          <div v-for="(r, idx) in rangeSource.ranges" :key="idx" class="flex items-center gap-1.5">
            <!-- Цвет ПЕРВЫМ: он метка строки, а не настройка в конце — глаз связывает
                 его с числами. Границы по содержимому (пять знаков), удаление справа. -->
            <ColorField
              :model-value="rowColor(r) || '#10b981'"
              class="shrink-0"
              @update:model-value="$emit('update-range', idx, 'color', $event)"
            />
            <!-- Низ ПЕРВОЙ строки не правится и всегда показывает нуль: шкала
                 начинается с него (пустое поле читалось бы как «порог не задан»). -->
            <InputText
              :model-value="idx === 0 ? cellText(r.min) || '0' : cellText(r.min)"
              :disabled="idx === 0"
              size="small"
              class="w-14! font-mono text-xs!"
              inputmode="decimal"
              @change="$emit('update-range', idx, 'min', $event.target.value)"
            />
            <span class="text-surface-400 text-xs">–</span>
            <InputText
              :model-value="cellText(r.max)"
              size="small"
              class="w-14! font-mono text-xs!"
              inputmode="decimal"
              @change="$emit('update-range', idx, 'max', $event.target.value)"
            />
            <Button
              v-tooltip.bottom="'Удалить строку'"
              icon="pi pi-times"
              severity="secondary"
              text
              size="small"
              class="ml-auto p-1! w-6! h-6! shrink-0"
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
