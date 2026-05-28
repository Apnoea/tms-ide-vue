<script setup>
import { ref, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Listbox from 'primevue/listbox'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'

/**
 * Универсальный picker-диалог: модальный Dialog с поиском, опциональной
 * группировкой и Listbox'ом. Тонкие специализированные обёртки (PrefixPicker,
 * TagPicker) задают header / per-option рендер через слоты.
 *
 * Options могут быть массивом строк ИЛИ массивом объектов.
 * - Для объектов задаётся optionLabel — какое поле использовать как лейбл/key
 *   для поиска/preselect.
 * - groupBy — функция (option) => groupName для группировки по prefix'у / типу.
 *
 * При открытии: сбрасывает поиск, пред-выделяет опцию совпадающую с props.selected
 * (сравнивается labelOf(option) с selected).
 *
 * @emits select(option) — выбранная опция (string или объект). Обёртки сами
 *   разворачивают object → string если нужно (см. TagPickerDialog: tag.name).
 */
const props = defineProps({
  visible: { type: Boolean, required: true },
  header: { type: String, default: 'Выберите' },
  options: { type: Array, default: () => [] },
  optionLabel: { type: String, default: null },
  selected: { default: null },
  searchable: { type: Boolean, default: false },
  searchPlaceholder: { type: String, default: 'Поиск...' },
  groupBy: { type: Function, default: null },
  selectLabel: { type: String, default: 'Выбрать' },
  cancelLabel: { type: String, default: 'Отмена' },
  width: { type: String, default: '420px' },
})

const emit = defineEmits(['select', 'cancel', 'update:visible'])

const search = ref('')
const picked = ref(null)

function labelOf(option) {
  if (option == null) return ''
  if (typeof option === 'string') return option
  return props.optionLabel ? (option[props.optionLabel] ?? '') : String(option)
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((o) => labelOf(o).toLowerCase().includes(q))
})

// null — группировка выключена; иначе массив { name, items: [...] }, сортировка по name
const grouped = computed(() => {
  if (!props.groupBy) return null
  const map = new Map()
  for (const o of filtered.value) {
    const g = props.groupBy(o)
    if (!map.has(g)) map.set(g, [])
    map.get(g).push(o)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => ({ name, items }))
})

const hasResults = computed(() =>
  grouped.value ? grouped.value.length > 0 : filtered.value.length > 0
)

watch(
  () => props.visible,
  (open) => {
    if (!open) return
    search.value = ''
    picked.value = props.selected
      ? props.options.find((o) => labelOf(o) === props.selected) ?? null
      : null
  }
)

function confirm() {
  if (!picked.value) return
  emit('select', picked.value)
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
    :style="{ width }"
    :close-on-escape="true"
    :dismissable-mask="true"
    :draggable="false"
  >
    <div class="space-y-3">
      <slot name="header" />

      <IconField v-if="searchable && options.length">
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="search"
          size="small"
          class="w-full"
          :placeholder="searchPlaceholder"
        />
      </IconField>

      <Listbox
        v-if="hasResults"
        v-model="picked"
        :options="grouped || filtered"
        :option-label="optionLabel || undefined"
        :option-group-label="grouped ? 'name' : undefined"
        :option-group-children="grouped ? 'items' : undefined"
        class="w-full"
        list-style="max-height: 320px"
        @dblclick="confirm"
      >
        <template #option="slotProps">
          <slot name="option" v-bind="slotProps">
            {{ labelOf(slotProps.option) }}
          </slot>
        </template>
        <template v-if="grouped" #optiongroup="slotProps">
          <slot name="optiongroup" v-bind="slotProps">
            <span class="text-[10px] uppercase tracking-wider text-surface-500 dark:text-surface-400 font-mono">
              {{ slotProps.option.name }}
            </span>
          </slot>
        </template>
      </Listbox>

      <div v-else class="text-sm text-surface-400 dark:text-surface-500 py-4 text-center">
        <slot name="empty">
          <template v-if="!options.length">Список пуст</template>
          <template v-else>Нет результатов</template>
        </slot>
      </div>
    </div>

    <template #footer>
      <Button :label="cancelLabel" severity="secondary" text @click="cancel" />
      <Button
        :label="selectLabel"
        icon="pi pi-check"
        :disabled="!picked"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
