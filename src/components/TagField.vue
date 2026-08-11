<script setup>
/**
 * Поле-тег (чип) инспектора: показывает тег или плейсхолдер, по клику просит
 * родителя открыть picker; опционально — «подсветить на схеме» и «убрать». Единый
 * источник стиля и disabled-логики для RangeBlock / BooleanBlock / CanvasInspector.
 * Состояние у родителя, отсюда только эмиты.
 */
import { computed } from 'vue'
import Button from 'primevue/button'
import { useProjectStore } from '../stores/useProjectStore'
import { tagIssue, tagIssueLabel } from '../utils/tagHealth'

const props = defineProps({
  value: { type: String, default: '' },
  // Можно ли выбирать тег (tag-list загружен). Иначе чип задизейблен.
  canPick: { type: Boolean, default: false },
  pickLabel: { type: String, default: 'Выбрать тег' }, // tooltip активного чипа
  highlightable: { type: Boolean, default: false }, // кнопка «подсветить» при value
  removable: { type: Boolean, default: false }, // кнопка «убрать»
})

defineEmits(['pick', 'highlight', 'remove'])

// Проблему тега (нет в tag-list / пробел в имени) показываем здесь, а не у каждого
// вызывающего: чип — единственное место, где тег видно, и стор доступен напрямую.
const project = useProjectStore()
const issue = computed(() => tagIssue(props.value, project.tagNames))
const issueLabel = computed(() => tagIssueLabel(issue.value))
</script>

<template>
  <div class="flex items-center gap-2">
    <code
      class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded border text-xs font-mono truncate transition-colors"
      :class="[
        canPick ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
        'border-surface-300 hover:border-primary-400',
      ]"
      v-tooltip.bottom="canPick ? pickLabel : 'Загрузи tag-list, чтобы выбрать тег'"
      @click="canPick && $emit('pick')"
    >
      {{ value || '- не выбран -' }}
    </code>
    <!-- Предупреждение, не ошибка: тег может быть валиден, а tag-list — устареть.
         Иконка без кнопки — действий тут нет, только сигнал «проверь привязку». -->
    <i
      v-if="issue"
      v-tooltip.bottom="issueLabel"
      class="pi pi-exclamation-triangle text-amber-500 text-xs shrink-0"
      :aria-label="issueLabel"
    />
    <Button
      v-if="highlightable && value"
      v-tooltip.bottom="'Подсветить на схеме'"
      icon="pi pi-search-plus"
      severity="secondary"
      text
      size="small"
      class="p-1! w-6! h-6!"
      @click="$emit('highlight')"
    />
    <Button
      v-if="removable"
      v-tooltip.bottom="'Убрать тег'"
      icon="pi pi-times"
      severity="secondary"
      text
      size="small"
      class="p-1! w-6! h-6!"
      @click="$emit('remove')"
    />
  </div>
</template>
