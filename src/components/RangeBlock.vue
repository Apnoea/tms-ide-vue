<script setup>
import TagField from './TagField.vue'
import RangeRows from './RangeRows.vue'
import AnimationCard from './AnimationCard.vue'

/**
 * Карточка анимации «Значение тега → цвет по диапазону» в инспекторе холста. Строки
 * здесь НЕ правятся никогда: границы и цвета живут в определении символа (редактор
 * символов; шина — тоже символ), на холсте видно шкалу и привязку тега.
 *
 * Три состояния:
 * - зоны символа: тег выбирается (`pickable`), × снимает тег;
 * - унаследовано (`inheritedFrom` — провод от шины или символа): только показ;
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
  // Можно ли выбрать тег: у символа с зонами — да; у провода и элемента без зон в
  // определении — нет (первый наследует, у второго сначала задают зоны в редакторе).
  pickable: { type: Boolean, default: true },
  // Подпись «от шины» / «от символа»: источник унаследован — только показ, без ×.
  inheritedFrom: { type: String, default: '' },
  // Пояснение для пустого состояния без выбора тега.
  hint: { type: String, default: '' },
})

defineEmits(['open-tag-picker', 'highlight', 'remove'])
</script>

<template>
  <AnimationCard
    icon="pi pi-chart-bar text-yellow-500"
    title="Цвет"
    hint="по диапазону тега"
    :clear-tip="!!rangeSource && !inheritedFrom && (pickable ? 'Очистить тег' : 'Убрать настройку')"
    @clear="$emit('remove')"
  >
    <p v-if="pickable || rangeSource" class="tms-hint mb-2">
      Цвет по диапазону значения. Одинаковые границы — точное значение: «3 — 3» сработает только на
      3.
    </p>
    <p v-else class="tms-hint">{{ hint }}</p>

    <div v-if="pickable || rangeSource" class="space-y-3">
      <div>
        <!-- Строка над полем только у наследования: откуда пришёл источник, по самому
             чипу не видно. Свой тег в подписи не нуждается — его видно в чипе. -->
        <div v-if="inheritedFrom" class="tms-hint mb-1">наследуется {{ inheritedFrom }}</div>
        <TagField
          :value="rangeSource?.tag || ''"
          :can-pick="tagsLoaded && pickable"
          highlightable
          @pick="$emit('open-tag-picker')"
          @highlight="$emit('highlight')"
        />
      </div>

      <div v-if="rangeSource?.tag">
        <div class="tms-hint mb-1">
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
  </AnimationCard>
</template>
