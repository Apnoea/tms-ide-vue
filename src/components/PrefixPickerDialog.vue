<script setup>
import { computed } from 'vue'
import BasePickerDialog from './BasePickerDialog.vue'
import { nplural } from '../utils/plural'

const props = defineProps({
  visible: { type: Boolean, required: true },
  options: { type: Array, default: () => [] },
  stencilLabel: { type: String, default: '' },
  // Из stencil.tagSuffixes — нужен только для подсказки в опциях picker'а
  // (показываем какой тег будет привязан к prefix'у).
  tagSuffixes: { type: Array, default: () => [] },
})

const emit = defineEmits(['select', 'cancel', 'update:visible'])

// Хинт суффиксов в опциях. У стенсилов с одним required-суффиксом (cell_vk → .ONOFF)
// показываем его inline; иначе — сводку количества.
const suffixHint = computed(() => {
  const required = props.tagSuffixes.filter((s) => s.required)
  if (required.length === 1) return required[0].suffix
  if (required.length > 1) return `· ${nplural(required.length, 'тег', 'тега', 'тегов')}`
  return ''
})

const singleSuffixMode = computed(
  () => props.tagSuffixes.filter((s) => s.required).length === 1
)

const header = computed(
  () => `Выберите объект${props.stencilLabel ? ' · ' + props.stencilLabel : ''}`
)
</script>

<template>
  <BasePickerDialog
    :visible="visible"
    :options="options"
    :header="header"
    select-label="Создать"
    @select="emit('select', $event)"
    @cancel="emit('cancel')"
    @update:visible="emit('update:visible', $event)"
  >
    <template #header>
      <p class="text-sm text-surface-500 dark:text-surface-400">
        Доступно из tag-list:
        <strong>{{ nplural(options.length, 'объект', 'объекта', 'объектов') }}</strong>
      </p>
    </template>
    <template #option="{ option }">
      <span class="font-mono">
        <span class="text-surface-900 dark:text-surface-50">{{ option }}</span>
        <span
          v-if="singleSuffixMode"
          class="text-primary-600 dark:text-primary-300 font-semibold"
          >{{ suffixHint }}</span
        >
        <span
          v-else-if="suffixHint"
          class="text-surface-400 dark:text-surface-500 ml-2 text-xs"
          >{{ suffixHint }}</span
        >
      </span>
    </template>
    <template #empty>Нет подходящих объектов</template>
  </BasePickerDialog>
</template>
