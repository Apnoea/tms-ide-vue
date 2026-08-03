<script setup>
import { ref, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Listbox from 'primevue/listbox'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import { useTagList } from '../composables/useTagList'
import { nplural } from '../utils/plural'

/**
 * Picker тега: поиск по name + Listbox с группировкой по prefix'у (до первой
 * точки). Одинарный клик СРАЗУ подтверждает (кнопки «Выбрать» нет) — привязка
 * тегов самая частая операция, второй клик на каждый тег лишний.
 *
 * `tags` приходят уже отфильтрованными (например только bool-теги), наружу
 * отдаём имя выбранного.
 */
const props = defineProps({
  visible: { type: Boolean, required: true },
  // { name, type }[] из tag-list. Caller предварительно фильтрует по типу.
  tags: { type: Array, default: () => [] },
  // Полное имя текущего тега — preselect'ит соответствующий option при открытии.
  selected: { type: String, default: '' },
  header: { type: String, default: 'Выберите тег' },
})

const emit = defineEmits(['select', 'cancel', 'update:visible'])

const search = ref('')
const picked = ref(null)
const searchRef = ref(null)

const { pickTagList } = useTagList()

// Автофокус поиска после появления диалога (@show — уже отрисован/анимирован).
function onShow() {
  searchRef.value?.$el?.focus()
}

function confirmTag(name) {
  if (!name) return
  emit('select', name)
  emit('update:visible', false)
}

// Enter из поля поиска подтверждает «активный» тег: текущий picked, если он ещё
// в результатах, иначе — первый из отфильтрованных (кейс «набрал → Enter»).
function confirmActive() {
  const t = picked.value && filtered.value.includes(picked.value) ? picked.value : filtered.value[0]
  confirmTag(t?.name)
}

// Клик по опции = подтверждение. Listbox тоглит выбор, поэтому клик по уже
// preselect'нутому тегу приходит с null — это тот же тег, а не сброс.
function onPick(e) {
  confirmTag(e.value?.name ?? props.selected)
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.tags
  return props.tags.filter((t) => t.name.toLowerCase().includes(q))
})

// Группировка по prefix'у — всё до первой точки. PS031VK001.ONOFF →"PS031VK001".
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
      ? (props.tags.find((t) => t.name === props.selected) ?? null)
      : null
  }
)

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
    @show="onShow"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="space-y-3">
      <p class="text-sm text-surface-500">
        Доступно:
        <strong>{{ nplural(tags.length, 'тег', 'тега', 'тегов') }}</strong>
      </p>

      <IconField v-if="tags.length">
        <InputIcon class="pi pi-search" />
        <InputText
          ref="searchRef"
          v-model="search"
          autofocus
          size="small"
          class="w-full"
          placeholder="Поиск по имени..."
          @keydown.enter.prevent="confirmActive"
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
        @change="onPick"
      >
        <template #option="{ option }">
          <span class="flex items-center justify-between w-full font-mono">
            <span class="text-sm text-surface-900">{{ option.name }}</span>
            <span class="text-[10px] text-surface-400 ml-2">
              {{ option.type }}
            </span>
          </span>
        </template>
        <template #optiongroup="{ option }">
          <span class="text-[10px] uppercase tracking-wider text-surface-500 font-mono">
            {{ option.name }}
          </span>
        </template>
      </Listbox>

      <!-- Без файла тегов привязывать нечего — даём загрузку здесь же, диалог
           остаётся открытым и наполняется. -->
      <div v-else-if="!tags.length" class="py-4 text-center space-y-3">
        <p class="text-sm text-surface-400">Tag-list не загружен</p>
        <Button label="Загрузить tag-list" icon="pi pi-tags" size="small" @click="pickTagList()" />
      </div>

      <div v-else class="text-sm text-surface-400 py-4 text-center">Нет тегов по запросу</div>
    </div>

    <template #footer>
      <Button label="Отмена" severity="secondary" text @click="cancel" />
    </template>
  </Dialog>
</template>
