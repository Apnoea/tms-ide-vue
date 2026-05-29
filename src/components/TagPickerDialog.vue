<script setup>
import { ref, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Listbox from 'primevue/listbox'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import { nplural } from '../utils/plural'

/**
 * Picker-диалог тега из tag-list'а. Модальный Dialog с поиском по name,
 * группировкой опций по prefix'у (всё до первой точки в имени), Listbox'ом
 * и dblclick'ом для быстрого выбора.
 *
 * Caller передаёт уже отфильтрованный массив `tags` (например только .ONOFF
 * для switch-picker'а — фильтр живёт в InspectorPane.onoffTags), и при
 * закрытии получает обратно строку-имя выбранного тега.
 */
const props = defineProps({
  visible: { type: Boolean, required: true },
  // { name, type }[] из tag-list. Caller предварительно фильтрует по типу/суффиксу.
  tags: { type: Array, default: () => [] },
  // Полное имя текущего тега — preselect'ит соответствующий option при открытии.
  selected: { type: String, default: '' },
  header: { type: String, default: 'Выберите тег' }
})

const emit = defineEmits(['select', 'cancel', 'update:visible'])

const search = ref('')
const picked = ref(null)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.tags
  return props.tags.filter((t) => t.name.toLowerCase().includes(q))
})

// Группировка по prefix'у — всё до первой точки. PS031VK001.ONOFF → "PS031VK001".
// PrimeVue Listbox требует структуру { name, items: [...] } для group-mode.
const grouped = computed(() => {
  const map = new Map()
  for (const t of filtered.value) {
    const i = t.name.indexOf('.')
    const g = i >= 0 ? t.name.slice(0, i) : t.name
    if (!map.has(g)) map.set(g, [])
    map.get(g).push(t)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => ({ name, items }))
})

const hasResults = computed(() => grouped.value.length > 0)

// При открытии: сброс поиска, preselect совпадения с `selected` (по имени).
watch(
  () => props.visible,
  (open) => {
    if (!open) return
    search.value = ''
    picked.value = props.selected
      ? props.tags.find((t) => t.name === props.selected) ?? null
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
    modal
    :header="header"
    :style="{ width: '420px' }"
    :close-on-escape="true"
    :dismissable-mask="true"
    :draggable="false"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="space-y-3">
      <p class="text-sm text-surface-500 dark:text-surface-400">
        Доступно: <strong>{{ nplural(tags.length, 'тег', 'тега', 'тегов') }}</strong>
      </p>

      <IconField v-if="tags.length">
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="search"
          size="small"
          class="w-full"
          placeholder="Поиск по имени..."
        />
      </IconField>

      <Listbox
        v-if="hasResults"
        v-model="picked"
        :options="grouped"
        option-label="name"
        option-group-label="name"
        option-group-children="items"
        class="w-full"
        list-style="max-height: 320px"
        @dblclick="confirm"
      >
        <template #option="{ option }">
          <span class="flex items-center justify-between w-full font-mono">
            <span class="text-sm text-surface-900 dark:text-surface-50">{{ option.name }}</span>
            <span class="text-[10px] text-surface-400 dark:text-surface-500 ml-2">{{ option.type }}</span>
          </span>
        </template>
        <template #optiongroup="{ option }">
          <span class="text-[10px] uppercase tracking-wider text-surface-500 dark:text-surface-400 font-mono">
            {{ option.name }}
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
