import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Хранит загруженный tag-list (теги проекта). Сам файл-handle для авто-
 * восстановления тегов на старте живёт в IndexedDB (см.
 * TagListControl.tryRestoreTagListHandle), в сторе его держать незачем.
 */
export const useProjectStore = defineStore('project', () => {
  const tags = ref([])

  function setTags(newTags) {
    tags.value = newTags
  }

  return { tags, setTags }
})
