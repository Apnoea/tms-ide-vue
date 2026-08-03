<script setup>
/**
 * Контрол tag-list'а (в тулбаре холста, рядом с заголовком): загрузка/замена
 * файла тегов + счётчик. Сама загрузка — в `useTagList` (её же зовёт пустой
 * tag-picker). Здесь только вид кнопки и восстановление на старте.
 */
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '../stores/useProjectStore'
import { useTagList } from '../composables/useTagList'
import { idbGet } from '../utils/idb'

const project = useProjectStore()
const { tags } = storeToRefs(project)
const { pickTagList, tryRestoreTagListHandle } = useTagList()

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
  </div>
</template>
