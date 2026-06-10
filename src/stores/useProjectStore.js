import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Хранит загруженный tag-list.
 * tagListHandle нужен чтобы перечитать файл без повторного выбора через picker.
 */
export const useProjectStore = defineStore('project', () => {
  const tags = ref([])
  const tagListHandle = ref(null)

  function setTags(newTags) {
    tags.value = newTags
  }

  function setTagListHandle(handle) {
    tagListHandle.value = handle
  }

  function clearTagList() {
    tags.value = []
    tagListHandle.value = null
  }

  return { tags, tagListHandle, setTags, setTagListHandle, clearTagList }
})
