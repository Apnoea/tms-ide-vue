import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isBooleanType, isFloatType } from '../services/parsers'

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

  // Подмножества по типу для tag-picker'ов: булевы (слоты/switch — эффект «false →
  // затемнение»), float (аналоговое значение cell_value). Держим в сторе, чтобы
  // не дублировать фильтр в компонентах.
  const booleanTags = computed(() => tags.value.filter((t) => isBooleanType(t.type)))
  const floatTags = computed(() => tags.value.filter((t) => isFloatType(t.type)))

  return { tags, setTags, booleanTags, floatTags }
})
