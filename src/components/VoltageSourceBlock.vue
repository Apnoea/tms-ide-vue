<script setup>
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import TagField from './TagField.vue'
import { ANIMATION_CLASS_COLORS } from '../constants/animation'

/**
 * Карточка анимации «Диапазоны значений» в инспекторе (аналоговый источник:
 * значение тега → класс по диапазону). Виден всегда; `voltageSource === null` —
 * пустое состояние (тег не выбран, порогов нет). Объект создаётся лениво в
 * родителе при выборе тега, очищается через × (× виден только при непустом).
 *
 * Эмитит intent'ы (openTagPicker/updateRange/highlight/remove). Состоянием
 * (объектом voltageSource) владеет родитель — мы только рендерим и зовём.
 */
defineProps({
  voltageSource: { type: Object, default: null }, // { tag, ranges } | null
  tagsLoaded: { type: Boolean, default: false },
  classOptions: { type: Array, default: () => [] },
})

defineEmits(['open-tag-picker', 'update-range', 'highlight', 'remove'])

const CLASS_COLORS = ANIMATION_CLASS_COLORS
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i class="pi pi-chart-bar text-yellow-500" />
      <div class="text-xs font-medium text-surface-700">Диапазоны значений</div>
      <Button
        v-if="voltageSource"
        v-tooltip.bottom="'Очистить'"
        icon="pi pi-times"
        severity="secondary"
        text
        size="small"
        class="!p-1 !w-6 !h-6 ml-auto"
        @click="$emit('remove')"
      />
    </div>

    <p class="text-[11px] text-surface-500 mb-2 leading-snug">
      Класс анимации зависит от диапазона значения тега - задайте границы и соответствующие цвета
      ниже.
    </p>

    <div class="space-y-3">
      <div>
        <div class="text-[11px] text-surface-500 mb-1">Тег</div>
        <TagField
          :value="voltageSource?.tag || ''"
          :can-pick="tagsLoaded"
          highlightable
          @pick="$emit('open-tag-picker')"
          @highlight="$emit('highlight')"
        />
      </div>

      <div v-if="voltageSource?.tag">
        <div class="text-[11px] text-surface-500 mb-1">Диапазоны</div>
        <div class="space-y-1">
          <div
            v-for="(r, idx) in voltageSource.ranges"
            :key="idx"
            class="flex items-center gap-1.5"
          >
            <InputText
              :model-value="String(r.min)"
              size="small"
              class="w-20 font-mono !text-xs"
              inputmode="decimal"
              @change="$emit('update-range', idx, 'min', $event.target.value)"
            />
            <span class="text-surface-400 text-xs">–</span>
            <InputText
              :model-value="String(r.max)"
              size="small"
              class="w-20 font-mono !text-xs"
              inputmode="decimal"
              @change="$emit('update-range', idx, 'max', $event.target.value)"
            />
            <Select
              :model-value="r.class"
              :options="classOptions"
              size="small"
              class="flex-1 min-w-0 font-mono"
              @update:model-value="$emit('update-range', idx, 'class', $event)"
            >
              <template #value="{ value }">
                <span class="flex items-center gap-1.5 text-xs">
                  <span
                    class="w-3 h-3 rounded-sm flex-shrink-0 border border-surface-300"
                    :style="{ background: CLASS_COLORS[value] || 'transparent' }"
                  />
                  <span class="truncate">{{ value }}</span>
                </span>
              </template>
              <template #option="{ option }">
                <span class="flex items-center gap-1.5 text-xs">
                  <span
                    class="w-3 h-3 rounded-sm flex-shrink-0 border border-surface-300"
                    :style="{ background: CLASS_COLORS[option] || 'transparent' }"
                  />
                  {{ option }}
                </span>
              </template>
            </Select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
