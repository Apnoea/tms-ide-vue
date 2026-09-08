import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isBooleanType, isNumericType } from '../services/parsers'

/**
 * Загруженный tag-list проекта. File-handle для тихого обновления тегов на старте
 * живёт в IndexedDB (useTagList), в сторе его нет.
 */
export const useProjectStore = defineStore('project', () => {
  const tags = ref([])

  function setTags(newTags) {
    tags.value = newTags
  }

  // Фильтры пикеров живут здесь, а не в каждом компоненте: булевы слоты и условия
  // берут booleanTags, пороги диапазонов и подпись со значением — numericTags (булев,
  // текстовый или бинарный тег числом не сравнить и с точностью не напечатать).
  // Состояния «по значению» берут весь список: код состояния задаёт автор.
  const booleanTags = computed(() => tags.value.filter((t) => isBooleanType(t.type)))
  const numericTags = computed(() => tags.value.filter((t) => isNumericType(t.type)))
  // Имена Set'ом: чипы тегов проверяют «есть ли такой сигнал» на каждый рендер
  // (utils/tagHealth), а tag-list бывает на тысячи строк.
  const tagNames = computed(() => new Set(tags.value.map((t) => t.name)))

  return { tags, setTags, booleanTags, numericTags, tagNames }
})
