<script setup>
/**
 * Единое поле-тег (clickable-чип) инспектора: показывает выбранный тег или
 * плейсхолдер, по клику просит родителя открыть picker. Опционально — кнопки
 * «подсветить на схеме» (при значении) и «убрать». Единый источник стиля и
 * disabled-логики для VoltageSourceBlock / SwitchBlock / AlarmSourceBlock /
 * InspectorPane.
 *
 * Состоянием и действиями владеет родитель; отсюда только эмиты:
 *   pick      — клик по чипу (открыть picker)
 *   highlight — кнопка «подсветить на схеме»
 *   remove    — кнопка «убрать»
 */
import Button from 'primevue/button'

defineProps({
  value: { type: String, default: '' },
  // Можно ли выбирать тег (tag-list загружен). Иначе чип задизейблен.
  canPick: { type: Boolean, default: false },
  emptyLabel: { type: String, default: '- не выбран -' },
  pickLabel: { type: String, default: 'Выбрать тег' }, // tooltip активного чипа
  warn: { type: Boolean, default: false }, // required-слот пуст → янтарный бордер
  highlightable: { type: Boolean, default: false }, // кнопка «подсветить» при value
  removable: { type: Boolean, default: false }, // кнопка «убрать»
})

defineEmits(['pick', 'highlight', 'remove'])
</script>

<template>
  <div class="flex items-center gap-2">
    <code
      class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded border text-xs font-mono truncate transition-colors"
      :class="[
        canPick ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
        warn && !value ? 'border-amber-500/40' : 'border-surface-300 hover:border-primary-400',
      ]"
      v-tooltip.bottom="canPick ? pickLabel : 'Загрузи tag-list, чтобы выбрать тег'"
      @click="canPick && $emit('pick')"
    >
      {{ value || emptyLabel }}
    </code>
    <Button
      v-if="highlightable && value"
      v-tooltip.bottom="'Подсветить на схеме'"
      icon="pi pi-search-plus"
      severity="secondary"
      text
      size="small"
      class="!p-1 !w-6 !h-6"
      @click="$emit('highlight')"
    />
    <Button
      v-if="removable"
      v-tooltip.bottom="'Убрать тег'"
      icon="pi pi-times"
      severity="secondary"
      text
      size="small"
      class="!p-1 !w-6 !h-6"
      @click="$emit('remove')"
    />
  </div>
</template>
