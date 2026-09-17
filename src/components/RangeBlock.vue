<script setup>
import Button from 'primevue/button'
import TagField from './TagField.vue'
import RangeRows from './RangeRows.vue'

/**
 * Карточка анимации «Значение тега → цвет по диапазону» в инспекторе холста. Строки
 * здесь НЕ правятся никогда: границы и цвета живут в определении символа (редактор
 * символов; шина — тоже символ), на холсте видно шкалу и привязку тега.
 *
 * Три состояния:
 * - зоны символа: тег выбирается (`pickable`), × снимает тег;
 * - унаследовано (`inheritedFrom` — провод/точка от шины или символа): только показ;
 * - настройка прошлых схем на элементе: показ и × «убрать» — заново её не создать.
 * Пусто и выбирать нечего — `hint` объясняет, где задаются диапазоны.
 *
 * Сравнение в рантайме inclusive по обоим концам, поэтому одинаковые границы задают
 * точное значение — так настраиваются целочисленные теги.
 *
 * Эмитит intent'ы (open-tag-picker / highlight / remove); состоянием владеет родитель.
 */
defineProps({
  rangeSource: { type: Object, default: null }, // { tag, ranges } | null
  tagsLoaded: { type: Boolean, default: false },
  // Можно ли выбрать тег: у символа с зонами — да; у провода, точки и элемента без зон
  // в определении — нет (первые наследуют, у вторых сначала задают зоны в редакторе).
  pickable: { type: Boolean, default: true },
  // Подпись «от шины» / «от символа»: источник унаследован — только показ, без ×.
  inheritedFrom: { type: String, default: '' },
  // Пояснение для пустого состояния без выбора тега.
  hint: { type: String, default: '' },
})

defineEmits(['open-tag-picker', 'highlight', 'remove'])
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i class="pi pi-chart-bar text-yellow-500" />
      <div class="flex items-baseline gap-1.5 min-w-0">
        <span class="text-xs font-medium text-surface-700">Цвет</span>
        <span class="tms-hint truncate">по диапазону тега</span>
      </div>
      <div class="ml-auto flex items-center">
        <Button
          v-if="rangeSource && !inheritedFrom"
          v-tooltip.bottom="pickable ? 'Очистить тег' : 'Убрать настройку'"
          icon="pi pi-times"
          severity="secondary"
          text
          size="small"
          class="tms-row-btn"
          @click="$emit('remove')"
        />
      </div>
    </div>

    <p v-if="pickable || rangeSource" class="tms-hint mb-2">
      Цвет по диапазону значения. Одинаковые границы — точное значение: «3 — 3» сработает только на
      3.
    </p>
    <p v-else class="tms-hint">{{ hint }}</p>

    <div v-if="pickable || rangeSource" class="space-y-3">
      <div>
        <!-- Строка над полем только у наследования: откуда пришёл источник, по самому
             чипу не видно. Свой тег в подписи не нуждается — его видно в чипе. -->
        <div v-if="inheritedFrom" class="text-[11px] text-surface-400 mb-1">
          наследуется {{ inheritedFrom }}
        </div>
        <TagField
          :value="rangeSource?.tag || ''"
          :can-pick="tagsLoaded && pickable"
          highlightable
          @pick="$emit('open-tag-picker')"
          @highlight="$emit('highlight')"
        />
      </div>

      <div v-if="rangeSource?.tag">
        <div class="text-[11px] text-surface-500 mb-1">
          Диапазоны
          <span class="text-surface-400">
            {{
              inheritedFrom
                ? `наследуются ${inheritedFrom}`
                : pickable
                  ? 'заданы в символе'
                  : 'настройка прошлых схем'
            }}
          </span>
        </div>
        <RangeRows :ranges="rangeSource.ranges || []" readonly />
      </div>
    </div>
  </div>
</template>
