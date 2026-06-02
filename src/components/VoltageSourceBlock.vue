<script setup>
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { ANIMATION_CLASS_COLORS } from '../constants/animation'

/**
 * Карточка анимации «Источник напряжения» в инспекторе. Рендерится только когда
 * voltageSource установлен (родитель проверяет !== null). Сам компонент НЕ
 * управляет включением/выключением — это делает родитель через кнопки add/remove
 * на уровне unified-блока «АНИМАЦИИ».
 *
 * Эмитит intent'ы (openTagPicker/updateRange/applyToAll/remove). Состоянием
 * (объектом voltageSource) владеет родитель — мы только рендерим и зовём.
 */
defineProps({
  voltageSource: { type: Object, required: true }, // { tag, ranges }
  tagsLoaded: { type: Boolean, default: false },
  classOptions: { type: Array, default: () => [] },
})

defineEmits(['open-tag-picker', 'update-range', 'highlight', 'remove'])

const CLASS_COLORS = ANIMATION_CLASS_COLORS
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2">
      <i class="pi pi-bolt text-yellow-500" aria-hidden="true" />
      <div class="text-xs font-medium text-surface-700">Источник напряжения</div>
      <Button
        v-tooltip.bottom="'Удалить анимацию'"
        icon="pi pi-times"
        severity="secondary"
        text
        size="small"
        class="!p-1 !w-6 !h-6 ml-auto"
        @click="$emit('remove')"
      />
    </div>

    <p class="text-[11px] text-surface-500 mb-2 leading-snug">
      Класс анимации зависит от диапазона значения тега — задайте границы и соответствующие цвета
      ниже.
    </p>

    <div class="space-y-3">
      <div>
        <div class="text-[11px] text-surface-500 mb-1">Тег</div>
        <div class="flex items-center gap-2">
          <code
            class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
            :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
            :title="tagsLoaded ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'"
            @click="tagsLoaded && $emit('open-tag-picker')"
          >
            {{ voltageSource.tag || '— не выбран —' }}
          </code>
        </div>
      </div>

      <div>
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
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ value }}</span>
                </span>
              </template>
              <template #option="{ option }">
                <span class="flex items-center gap-1.5 text-xs">
                  <span
                    class="w-3 h-3 rounded-sm flex-shrink-0 border border-surface-300"
                    :style="{ background: CLASS_COLORS[option] || 'transparent' }"
                    aria-hidden="true"
                  />
                  {{ option }}
                </span>
              </template>
            </Select>
          </div>
        </div>
      </div>

      <Button
        label="Подсветить на схеме"
        icon="pi pi-search-plus"
        severity="secondary"
        size="small"
        class="w-full"
        :disabled="!voltageSource.tag"
        @click="$emit('highlight')"
      />
    </div>
  </div>
</template>
