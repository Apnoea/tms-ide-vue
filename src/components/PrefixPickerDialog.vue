<script setup>
import { ref, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Listbox from 'primevue/listbox'
import Button from 'primevue/button'
import { nplural } from '../utils/plural'

const props = defineProps({
  visible: { type: Boolean, required: true },
  options: { type: Array, default: () => [] },
  stencilLabel: { type: String, default: '' },
  // Список { suffix, type, required } из stencil.tagSuffixes — нужен только
  // для подсказки в опциях picker'а (показываем какой тег будет привязан).
  tagSuffixes: { type: Array, default: () => [] },
})

const emit = defineEmits(['select', 'cancel', 'update:visible'])

const selected = ref(null)

// Хинт суффиксов для рендера опций. Если у стенсила ровно один required-суффикс
// (как у cell_vk → ".ONOFF"), показываем его явно рядом с prefix'ом. Иначе —
// небольшая сводка количеством тегов.
const suffixHint = computed(() => {
  const required = props.tagSuffixes.filter((s) => s.required)
  if (required.length === 1) return required[0].suffix
  if (required.length > 1) return `· ${nplural(required.length, 'тег', 'тега', 'тегов')}`
  return ''
})

const singleSuffixMode = computed(
  () => props.tagSuffixes.filter((s) => s.required).length === 1
)

// Сбрасываем выбор при каждом новом открытии диалога
watch(
  () => props.visible,
  (open) => {
    if (open) selected.value = null
  }
)

function confirm() {
  if (!selected.value) return
  emit('select', selected.value)
  emit('update:visible', false)
}

function cancel() {
  emit('cancel')
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    :header="`Выберите объект${stencilLabel ? ' · ' + stencilLabel : ''}`"
    :style="{ width: '420px' }"
    :close-on-escape="true"
    :dismissable-mask="true"
    :draggable="false"
  >
    <div class="space-y-3">
      <p class="text-sm text-surface-500 dark:text-surface-400">
        Доступно из tag-list:
        <strong>{{ nplural(options.length, 'объект', 'объекта', 'объектов') }}</strong>
      </p>

      <Listbox
        v-if="options.length"
        v-model="selected"
        :options="options"
        class="w-full"
        list-style="max-height: 320px"
        @dblclick="confirm"
      >
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
      </Listbox>

      <div v-else class="text-sm text-surface-400 dark:text-surface-500 py-4 text-center">
        Нет подходящих объектов
      </div>
    </div>

    <template #footer>
      <Button label="Отмена" severity="secondary" text @click="cancel" />
      <Button
        label="Создать"
        icon="pi pi-check"
        :disabled="!selected"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
