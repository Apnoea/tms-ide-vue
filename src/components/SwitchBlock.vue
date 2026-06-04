<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'

/**
 * Унифицированный блок «выключатель». Принимает два независимых источника тегов:
 *  • `slotInfo` — required-слот стенсила (cell_qw's slot.onoff из tms.slots).
 *    Рендерится первой строкой без × (слот обязательный для стенсила).
 *    Назван `slotInfo` (не `slot`) — vue/no-deprecated-slot-attribute.
 *  • `tags` — массив switchSources.tags. Optional. Каждая строка с ×.
 *
 * Можно передавать одно или оба. В runtime семантика идентична: каждый тег =
 * независимый bool-биндинг (false → addClass animation-off). N тегов = AND.
 *
 * Эмиты:
 *   open-slot-picker — клик по slot-row code-инпуту (intrinsic)
 *   open-tag-picker  — «+ Добавить зависимость» (parent решает куда писать)
 *   edit-tag(idx)    — клик по source-row code-инпуту (замена тега по индексу)
 *   remove-tag(idx)  — × на source-row
 *   remove           — × в шапке (удалить switchSources, slot остаётся)
 *   highlight-tag(t) — eye-иконка → подсветить тег на холсте
 */
const props = defineProps({
  slotInfo: { type: Object, default: null }, // { label, value, tagSuffix, tooltip }
  tags: { type: Array, default: null },
  tagSuffix: { type: String, default: null },
  removable: { type: Boolean, default: false },
  tagsLoaded: { type: Boolean, default: false },
  title: { type: String, default: 'Выключатель' },
})

defineEmits([
  'open-slot-picker',
  'open-tag-picker',
  'remove-tag',
  'remove',
  'highlight-tag',
  'edit-tag',
])

// Единый лейбл — добавление работает одинаково для cell_qw и проводов:
// одна кнопка «Добавить зависимость», порождает picker switchSources.tags.
// Кнопка скрывается когда добавлять не от чего (slot пустой + tags пусто).
const addButtonVisible = computed(() => {
  if (!props.slotInfo) return true // wire / standalone switchSources
  if (props.slotInfo.value) return true // slot заполнен → можно добавлять зависимости
  return !!(props.tags && props.tags.length) // sources уже есть
})

// AND-подсказка показываем если совокупно > 1 тега.
const totalTags = computed(() => (props.slotInfo?.value ? 1 : 0) + (props.tags?.length || 0))
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2">
      <i class="pi pi-power-off text-cyan-500" aria-hidden="true" />
      <div class="text-xs font-medium text-surface-700">
        {{ title }}
      </div>
      <Tag
        v-if="tagSuffix"
        v-tooltip.bottom="`Ожидается тег с суффиксом ${tagSuffix}`"
        :value="tagSuffix"
        severity="secondary"
        rounded
        class="ml-auto !font-mono !text-[10px] !py-0"
      />
      <Button
        v-if="removable"
        v-tooltip.bottom="'Удалить внешние теги'"
        icon="pi pi-times"
        severity="secondary"
        text
        size="small"
        :class="['!p-1 !w-6 !h-6', tagSuffix ? '' : 'ml-auto']"
        @click="$emit('remove')"
      />
    </div>

    <p class="text-[11px] text-surface-500 mb-2 leading-snug">
      Когда значение тега =
      <code class="font-mono">false</code>
      — элемент тускнеет (
      <code class="font-mono">animation-off</code>
      ).
      <template v-if="totalTags > 1">
        Все теги работают как AND: любой
        <code class="font-mono">false</code>
        → элемент серый.
      </template>
    </p>

    <!-- Slot-row: intrinsic, без × и без info-tooltip — лейбла «Основной
         выключатель» достаточно, тултип с правилами стенсильного шаблона
         не нужен (юзеру важен сам тег, не CSS-классы). -->
    <div v-if="slotInfo" class="mb-2">
      <div class="text-[11px] text-surface-500 mb-1">
        {{ slotInfo.label || 'Состояние' }}
      </div>
      <div class="flex items-center gap-2">
        <code
          class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
          :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
          :title="tagsLoaded ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'"
          @click="tagsLoaded && $emit('open-slot-picker')"
        >
          {{
            slotInfo.value ||
            (slotInfo.tagSuffix ? `— выбрать тег ${slotInfo.tagSuffix} —` : '— не выбран —')
          }}
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

    <!-- Source-теги (с ×) -->
    <div v-if="tags && tags.length" class="space-y-1.5">
      <div v-if="slotInfo" class="text-[11px] text-surface-500">Зависит также от</div>
      <div v-for="(t, idx) in tags" :key="idx" class="flex items-center gap-2">
        <code
          class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
          :class="tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
          :title="tagsLoaded ? 'Заменить тег' : 'Загрузи tag-list, чтобы выбрать тег'"
          @click="tagsLoaded && $emit('edit-tag', idx)"
        >
          {{ t || '— пусто —' }}
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
          @click="$emit('remove-tag', idx)"
        />
      </div>
    </div>

    <!-- Add-button -->
    <Button
      v-if="addButtonVisible"
      label="Добавить зависимость"
      icon="pi pi-plus"
      severity="secondary"
      size="small"
      outlined
      class="w-full !mt-2"
      :disabled="!tagsLoaded"
      @click="$emit('open-tag-picker')"
    />
    <p
      v-if="addButtonVisible && !tagsLoaded"
      class="text-[11px] text-surface-400 leading-snug mt-1"
    >
      Загрузи tag-list, чтобы выбрать тег.
    </p>
  </div>
</template>
