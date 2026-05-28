<script setup>
import BasePickerDialog from './BasePickerDialog.vue'
import { nplural } from '../utils/plural'

const props = defineProps({
  visible: { type: Boolean, required: true },
  // { name, type }[] из tag-list. Каллер может предварительно отфильтровать по типу.
  tags: { type: Array, default: () => [] },
  // Текущий полный тег для preselect при открытии.
  selected: { type: String, default: '' },
  header: { type: String, default: 'Выберите тег' },
})

const emit = defineEmits(['select', 'cancel', 'update:visible'])

// Группировка по prefix'у (всё до первой точки).
function tagPrefix(tag) {
  const i = tag.name.indexOf('.')
  return i >= 0 ? tag.name.slice(0, i) : tag.name
}

// BasePicker эмитит полную опцию (объект), а нам нужно отдать только string-name.
function onSelect(tag) {
  emit('select', tag.name)
}
</script>

<template>
  <BasePickerDialog
    :visible="visible"
    :options="tags"
    option-label="name"
    :selected="selected"
    :header="header"
    searchable
    search-placeholder="Поиск по имени..."
    :group-by="tagPrefix"
    @select="onSelect"
    @cancel="emit('cancel')"
    @update:visible="emit('update:visible', $event)"
  >
    <template #header>
      <p class="text-sm text-surface-500 dark:text-surface-400">
        Доступно: <strong>{{ nplural(tags.length, 'тег', 'тега', 'тегов') }}</strong>
      </p>
    </template>
    <template #option="{ option }">
      <span class="flex items-center justify-between w-full font-mono">
        <span class="text-sm text-surface-900 dark:text-surface-50">{{ option.name }}</span>
        <span class="text-[10px] text-surface-400 dark:text-surface-500 ml-2">{{ option.type }}</span>
      </span>
    </template>
    <template #empty>
      <template v-if="!tags.length">Tag-list не загружен</template>
      <template v-else>Нет тегов по запросу</template>
    </template>
  </BasePickerDialog>
</template>
