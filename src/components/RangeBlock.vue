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
      <div class="text-xs font-medium text-surface-700">Диапазоны значений</div>
      <div class="ml-auto flex items-center">
        <Button
          v-if="rangeSource && !inheritedFrom"
          v-tooltip.bottom="pickable ? 'Очистить тег' : 'Убрать настройку'"
          icon="pi pi-times"
          severity="secondary"
          text
          size="small"
          class="p-1! w-6! h-6!"
          @click="$emit('remove')"
        />
      </div>
    </div>

    <p v-if="pickable || rangeSource" class="text-[11px] text-surface-500 mb-2 leading-snug">
      Цвет по диапазону значения. Одинаковые границы — точное значение: «3 — 3» сработает только на
      3.
    </p>
    <p v-else class="text-[11px] text-surface-500 leading-snug">{{ hint }}</p>

    <div v-if="pickable || rangeSource" class="space-y-3">
      <div>
        <div class="text-[11px] text-surface-500 mb-1">
          Тег
          <span class="text-surface-400">
            {{ inheritedFrom ? `наследуется ${inheritedFrom}` : 'для анимации элемента' }}
          </span>
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
