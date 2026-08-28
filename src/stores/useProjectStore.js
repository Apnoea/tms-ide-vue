import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isBooleanType, isFloatType } from '../services/parsers'

/**
 * Загруженный tag-list проекта. File-handle для тихого обновления тегов на старте
 * живёт в IndexedDB (useTagList), в сторе его нет.
 */
export const useProjectStore = defineStore('project', () => {
  const tags = ref([])

  function setTags(newTags) {
    tags.value = newTags
  }

  // Подмножества по типу для tag-picker'ов: булевы (слоты и булев источник), float
  // (значение cell_value) — фильтр в одном месте, а не в каждом компоненте.
  const booleanTags = computed(() => tags.value.filter((t) => isBooleanType(t.type)))
  const floatTags = computed(() => tags.value.filter((t) => isFloatType(t.type)))
  // Имена Set'ом: чипы тегов проверяют «есть ли такой сигнал» на каждый рендер
  // (utils/tagHealth), а tag-list бывает на тысячи строк.
  const tagNames = computed(() => new Set(tags.value.map((t) => t.name)))

  return { tags, setTags, booleanTags, floatTags, tagNames }
})
