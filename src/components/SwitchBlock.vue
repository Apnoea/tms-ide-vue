<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'

/**
 * Блок «Булев источник». Два независимых источника:
 *  • `slotInfo` — required-слот стенсила (cell_qw slot.onoff): своё состояние
 *    элемента, рендерится первой строкой без ×.
 *  • Зависимости-теги в двух секциях:
 *     - `parallel` («Параллельно») — достаточно ЛЮБОГО = true (OR).
 *     - `series` («Последовательно») — нужны ВСЕ = true (AND).
 *    Активен = (любой parallel = true) ИЛИ (все series = true); иначе элемент
 *    тускнеет (animation-off).
 *
 * Эмиты (bucket = 'parallel' | 'series'):
 *   open-slot-picker          — клик по slot-row (свой тег стенсила)
 *   open-tag-picker(bucket)   — клик по пустому полю-тегу секции (добавить)
 *   edit-tag(bucket, idx)     — замена тега по индексу
 *   remove-tag(bucket, idx)   — × на строке
 *   remove                    — × в шапке: очистить все зависимости (виден при непустом)
 *   highlight-tag(t)          — подсветить тег на холсте
 */
const props = defineProps({
  slotInfo: { type: Object, default: null }, // { label, value }
  parallel: { type: Array, default: null },
  series: { type: Array, default: null },
  removable: { type: Boolean, default: false },
  tagsLoaded: { type: Boolean, default: false },
  title: { type: String, default: 'Булев источник' },
})

defineEmits([
  'open-slot-picker',
  'open-tag-picker',
  'edit-tag',
  'remove-tag',
  'remove',
  'highlight-tag',
])

// «Последовательно» выше «Параллельно»: последовательных условий обычно в разы
// меньше, держим компактный список наверху.
const sections = computed(() => [
  {
    key: 'series',
    label: 'Последовательно',
    hint: 'нужны все true (логическое И)',
    tags: props.series || [],
  },
  {
    key: 'parallel',
    label: 'Параллельно',
    hint: 'достаточно любого true (логическое ИЛИ)',
    tags: props.parallel || [],
  },
])
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i class="pi pi-power-off text-cyan-500" />
      <div class="text-xs font-medium text-surface-700">
        {{ title }}
      </div>
      <Button
        v-if="removable"
        v-tooltip.bottom="'Удалить все зависимости'"
        icon="pi pi-times"
        severity="secondary"
        text
        size="small"
        class="!p-1 !w-6 !h-6 ml-auto"
        @click="$emit('remove')"
      />
    </div>

    <p class="text-[11px] text-surface-500 mb-2 leading-snug">
      Активен, если все теги из «Последовательно» = true ИЛИ любой тег из «Параллельно» = true.
      Иначе элемент тускнеет (
      <code class="font-mono">animation-off</code>
      ).
    </p>

    <!-- Slot-row: свой тег стенсила (intrinsic), без × -->
    <div v-if="slotInfo" class="mb-2">
      <div class="text-[11px] text-surface-500 mb-1">
        {{ slotInfo.label || 'Состояние' }}
        <span class="text-surface-400">- тег для анимации самого элемента</span>
      </div>
      <div class="flex items-center gap-2">
        <code
          class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
          :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
          :title="tagsLoaded ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'"
          @click="tagsLoaded && $emit('open-slot-picker')"
        >
          {{ slotInfo.value || '- не выбран -' }}
        </code>
        <Button
          v-if="slotInfo.value"
          v-tooltip.bottom="'Подсветить на схеме'"
          icon="pi pi-search-plus"
          severity="secondary"
          text
          size="small"
          class="!p-1 !w-6 !h-6"
          @click="$emit('highlight-tag', slotInfo.value)"
        />
      </div>
    </div>

    <!-- Две секции зависимостей: Параллельно (OR) / Последовательно (AND) -->
    <div v-for="sec in sections" :key="sec.key" class="mb-2">
      <div class="text-[11px] text-surface-500 mb-1">
        {{ sec.label }}
        <span class="text-surface-400">- {{ sec.hint }}</span>
      </div>
      <div class="space-y-1.5">
        <div v-for="(t, idx) in sec.tags" :key="idx" class="flex items-center gap-2">
          <code
            class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
            :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
            :title="tagsLoaded ? 'Заменить тег' : 'Загрузи tag-list, чтобы выбрать тег'"
            @click="tagsLoaded && $emit('edit-tag', sec.key, idx)"
          >
            {{ t || '- пусто -' }}
          </code>
          <Button
            v-if="t"
            v-tooltip.bottom="'Подсветить на схеме'"
            icon="pi pi-search-plus"
            severity="secondary"
            text
            size="small"
            class="!p-1 !w-6 !h-6"
            @click="$emit('highlight-tag', t)"
          />
          <Button
            v-tooltip.bottom="'Убрать тег'"
            icon="pi pi-times"
            severity="secondary"
            text
            size="small"
            class="!p-1 !w-6 !h-6"
            @click="$emit('remove-tag', sec.key, idx)"
          />
        </div>
        <!-- Добавить тег: пустое поле-тег (как в «Диапазонах значений») —
             клик открывает picker для этой секции. -->
        <div class="flex items-center gap-2">
          <code
            class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
            :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
            :title="tagsLoaded ? 'Добавить тег' : 'Загрузи tag-list, чтобы выбрать тег'"
            @click="tagsLoaded && $emit('open-tag-picker', sec.key)"
          >
            - не выбран -
          </code>
        </div>
      </div>
    </div>

    <p v-if="!tagsLoaded" class="text-[11px] text-surface-400 leading-snug mt-1">
      Загрузи tag-list, чтобы выбрать тег.
    </p>
  </div>
</template>
