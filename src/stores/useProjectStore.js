import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isBooleanType } from '../services/parsers'

/**
 * Загруженный tag-list проекта. File-handle для тихого обновления тегов на старте
 * живёт в IndexedDB (useTagList), в сторе его нет.
 */
export const useProjectStore = defineStore('project', () => {
  const tags = ref([])

  function setTags(newTags) {
    tags.value = newTags
  }

  // Булевы теги для picker'ов слотов и булева источника — фильтр в одном месте, а не
  // в каждом компоненте. Подпись со значением берёт теги без фильтра: показать можно
  // и число, и строку.
  const booleanTags = computed(() => tags.value.filter((t) => isBooleanType(t.type)))
  // Имена Set'ом: чипы тегов проверяют «есть ли такой сигнал» на каждый рендер
  // (utils/tagHealth), а tag-list бывает на тысячи строк.
  const tagNames = computed(() => new Set(tags.value.map((t) => t.name)))

  return { tags, setTags, booleanTags, tagNames }
})
