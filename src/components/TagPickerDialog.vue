<script setup>
import { ref, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Listbox from 'primevue/listbox'
import Button from 'primevue/button'
import { nplural } from '../utils/plural'

const props = defineProps({
  visible: { type: Boolean, required: true },
  // Список тегов из tag-list, формат { name, type }. Каллер фильтрует по типу
  // (напр. только Float) если нужно.
  tags: { type: Array, default: () => [] },
  // Текущий выбранный полный тег — подсвечивается при открытии.
  selected: { type: String, default: '' },
  // Опциональный заголовок (для контекста: «выберите тег источника напряжения»).
  header: { type: String, default: 'Выберите тег' },
})

const emit = defineEmits(['select', 'cancel', 'update:visible'])

const search = ref('')
const picked = ref(null)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.tags
  return props.tags.filter((t) => t.name.toLowerCase().includes(q))
})

// Группируем по prefix'у (всё до первой точки) для группированного отображения.
// PrimeVue Listbox умеет группированные options через optionGroupLabel/Children.
const grouped = computed(() => {
  const map = new Map()
  for (const t of filtered.value) {
    const dotIdx = t.name.indexOf('.')
    const prefix = dotIdx >= 0 ? t.name.slice(0, dotIdx) : t.name
    if (!map.has(prefix)) map.set(prefix, [])
    map.get(prefix).push(t)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => ({ name, items }))
})

// При открытии: сбрасываем поиск, пред-выделяем `selected` если он есть в списке
watch(
  () => props.visible,
  (open) => {
    if (!open) return
    search.value = ''
    picked.value = props.selected
      ? props.tags.find((t) => t.name === props.selected) || null
      : null
  }
)

function confirm() {
  if (!picked.value) return
  emit('select', picked.value.name)
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
    :header="header"
    :style="{ width: '440px' }"
    :close-on-escape="true"
    :dismissable-mask="true"
    :draggable="false"
  >
    <div class="space-y-3">
      <p class="text-sm text-surface-500 dark:text-surface-400">
        Доступно: <strong>{{ nplural(tags.length, 'тег', 'тега', 'тегов') }}</strong>
      </p>

      <input
        v-if="tags.length"
        v-model="search"
        type="text"
        placeholder="Поиск по имени..."
        class="w-full px-2 py-1.5 text-sm rounded border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-800 text-surface-900 dark:text-surface-50 focus:outline-none focus:border-primary-500"
      />

      <Listbox
        v-if="filtered.length"
        v-model="picked"
        :options="grouped"
        option-label="name"
        option-group-label="name"
        option-group-children="items"
        class="w-full"
        list-style="max-height: 320px"
        @dblclick="confirm"
      >
        <template #optiongroup="{ option }">
          <span class="text-[10px] uppercase tracking-wider text-surface-500 dark:text-surface-400 font-mono">
            {{ option.name }}
          </span>
        </template>
        <template #option="{ option }">
          <span class="flex items-center justify-between w-full font-mono">
            <span class="text-sm text-surface-900 dark:text-surface-50">{{ option.name }}</span>
            <span class="text-[10px] text-surface-400 dark:text-surface-500 ml-2">{{ option.type }}</span>
          </span>
        </template>
      </Listbox>

      <div v-else class="text-sm text-surface-400 dark:text-surface-500 py-4 text-center">
        <template v-if="!tags.length">Tag-list не загружен</template>
        <template v-else>Нет тегов по запросу</template>
      </div>
    </div>

    <template #footer>
      <Button label="Отмена" severity="secondary" text @click="cancel" />
      <Button
        label="Выбрать"
        icon="pi pi-check"
        :disabled="!picked"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
