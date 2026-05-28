<script setup>
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { ANIMATION_CLASS_COLORS } from '../constants/animation'

/**
 * Блок инспектора «Источник напряжения для анимации». Один и тот же UI
 * показывается для выделенной ячейки И для выделенной линии — раньше эти 80+
 * строк дублировались в двух ветках InspectorPane. Теперь подкомпонент.
 *
 * Состоянием владеет родитель (InspectorPane), мы только рендерим и эмитим
 * intent'ы (toggle/openTagPicker/updateRange/applyToAll). Родитель решает,
 * как обновлять tms.voltageSource на текущем cell/link.
 */
defineProps({
  voltageSource: { type: Object, default: null }, // { tag, ranges } или null
  tagsLoaded: { type: Boolean, default: false },
  classOptions: { type: Array, default: () => [] },
})

defineEmits(['toggle', 'open-tag-picker', 'update-range', 'apply-to-all'])

// Цвета берём из единого модуля — те же значения попадают в CSS экспортируемого
// SVG, поэтому preview swatch'а точно совпадает с тем, как покрасится провод в рантайме.
const CLASS_COLORS = ANIMATION_CLASS_COLORS
</script>

<template>
  <div>
    <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1">
      Источник напряжения
    </div>
    <div class="flex items-center gap-2 text-sm">
      <ToggleSwitch
        :model-value="!!voltageSource"
        @update:model-value="$emit('toggle', $event)"
      />
      <span
        class="text-surface-700 dark:text-surface-200 cursor-pointer select-none"
        @click="$emit('toggle', !voltageSource)"
      >
        Использовать как источник
      </span>
    </div>

    <template v-if="voltageSource">
      <div class="mt-3 space-y-3">
        <div>
          <div class="text-[11px] text-surface-500 dark:text-surface-400 mb-1">Тег</div>
          <div class="flex items-center gap-2">
            <code
              class="flex-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded text-xs font-mono truncate transition-colors"
              :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
              :title="tagsLoaded ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'"
              @click="tagsLoaded && $emit('open-tag-picker')"
            >
              {{ voltageSource.tag || '— не выбран —' }}
            </code>
            <Button
              icon="pi pi-pencil"
              severity="secondary"
              text
              size="small"
              title="Выбрать тег"
              :disabled="!tagsLoaded"
              @click="$emit('open-tag-picker')"
            />
          </div>
          <div
            v-if="!tagsLoaded"
            class="text-[11px] text-surface-400 dark:text-surface-500 mt-1"
          >
            Загрузи tag-list, чтобы выбрать тег
          </div>
        </div>

        <div>
          <div class="text-[11px] text-surface-500 dark:text-surface-400 mb-1">Диапазоны</div>
          <div class="space-y-1">
            <div
              v-for="(r, idx) in voltageSource.ranges"
              :key="idx"
              class="flex items-center gap-1.5"
            >
              <InputText
                :model-value="String(r.min)"
                size="small"
                class="w-16 font-mono !text-xs"
                inputmode="decimal"
                @change="$emit('update-range', idx, 'min', $event.target.value)"
              />
              <span class="text-surface-400 text-xs">–</span>
              <InputText
                :model-value="String(r.max)"
                size="small"
                class="w-16 font-mono !text-xs"
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
                      class="w-3 h-3 rounded-sm flex-shrink-0 border border-surface-300 dark:border-surface-600"
                      :style="{ background: CLASS_COLORS[value] || 'transparent' }"
                      aria-hidden="true"
                    />
                    <span class="truncate">{{ value }}</span>
                  </span>
                </template>
                <template #option="{ option }">
                  <span class="flex items-center gap-1.5 text-xs">
                    <span
                      class="w-3 h-3 rounded-sm flex-shrink-0 border border-surface-300 dark:border-surface-600"
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
          label="Применить ко всей схеме"
          icon="pi pi-globe"
          severity="secondary"
          size="small"
          class="w-full"
          :disabled="!voltageSource.tag"
          @click="$emit('apply-to-all')"
        />
      </div>
    </template>
  </div>
</template>
