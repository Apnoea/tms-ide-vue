<script setup>
/**
 * Контрол tag-list'а (в шапке, рядом с действиями проекта): загрузка/замена
 * файла тегов + счётчик. Сама загрузка — в `useTagList` (её же зовёт пустой
 * tag-picker). Здесь только вид кнопки и восстановление на старте.
 */
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '../stores/useProjectStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useTagList } from '../composables/useTagList'
import { useCanvas } from '../composables/useCanvas'
import { useConfirmDanger } from '../composables/useConfirmDanger'
import { idbGet } from '../services/idb'
import { TAG_CHECK_FORM_ID, TAG_CHECK_TITLE } from '../services/tagCheckForm'

const project = useProjectStore()
const workspace = useWorkspaceStore()
const canvas = useCanvas()
const confirmDanger = useConfirmDanger()
const { tags } = storeToRefs(project)
const { pickTagList, tryRestoreTagListHandle } = useTagList()

/**
 * Форма проверки тегов: символ на каждый тег. Форма генерируется, а не правится руками,
 * поэтому повторный запуск строит её заново — но если она уже есть, сначала спрашиваем:
 * в ней могли что-то подвинуть.
 */
function onTagCheck(event) {
  const run = () => canvas.generateTagCheckForm(tags.value)
  if (!workspace.hasForm(TAG_CHECK_FORM_ID)) return run()
  confirmDanger({
    target: event.currentTarget,
    message: `Форма «${TAG_CHECK_TITLE}» будет построена заново — правки в ней пропадут`,
    acceptLabel: 'Перестроить',
    accept: run,
  })
}

// Есть ли сохранённый tag-list. Реактивный `tags` на маунте пуст (restore
// асинхронный), и кнопка мигала бы filled(primary)→text — стартуем с «есть»
// и уточняем по IDB; для общего случая (теги были) перехода нет.
const hasPersistedTags = ref(true)
const tagListPresent = computed(() => tags.value.length > 0 || hasPersistedTags.value)

onMounted(async () => {
  hasPersistedTags.value = !!(await idbGet('project:tags'))
  tryRestoreTagListHandle()
})
</script>

<template>
  <div class="flex items-center gap-1">
    <Button
      v-tooltip.bottom="tagListPresent ? 'Заменить tag-list' : 'Загрузить tag-list'"
      icon="pi pi-tags"
      :severity="tagListPresent ? 'secondary' : 'primary'"
      :text="tagListPresent"
      label="Tag-list"
      size="small"
      @click="pickTagList"
    />
    <Badge
      v-if="tags.length"
      :value="tags.length"
      size="small"
      class="bg-surface-200! text-surface-600!"
    />
    <Button
      v-if="tags.length"
      v-tooltip.bottom="'Форма проверки тегов: символ с привязкой на каждый тег'"
      icon="pi pi-list-check"
      severity="secondary"
      text
      size="small"
      @click="onTagCheck"
    />
  </div>
</template>
