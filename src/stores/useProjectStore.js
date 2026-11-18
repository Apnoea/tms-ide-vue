import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isBooleanType, isNumericType, isStringType } from '../services/tagList'

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
  // берут booleanTags, пороги диапазонов — numericTags (булев, текстовый или бинарный
  // тег числом не сравнить), подпись со значением — valueTags: числа и строки (строка
  // печатается как есть; булев, бинарный тег и дата-время ей показать нечем).
  // Состояния «по значению» берут весь список: код состояния задаёт автор.
  const booleanTags = computed(() => tags.value.filter((t) => isBooleanType(t.type)))
  const numericTags = computed(() => tags.value.filter((t) => isNumericType(t.type)))
  const valueTags = computed(() =>
    tags.value.filter((t) => isNumericType(t.type) || isStringType(t.type))
  )
  // Имена Set'ом: чипы тегов проверяют «есть ли такой сигнал» на каждый рендер
  // (utils/tagHealth), а tag-list бывает на тысячи строк.
  const tagNames = computed(() => new Set(tags.value.map((t) => t.name)))
  // Строковые теги: у их подписи нет точности.
  const stringTagNames = computed(
    () => new Set(tags.value.filter((t) => isStringType(t.type)).map((t) => t.name))
  )

  return { tags, setTags, booleanTags, numericTags, valueTags, tagNames, stringTagNames }
})
