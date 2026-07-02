import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const lastTagListPickerStartIn = ref(null)

  // Текущий drag из палитры. Заполняется в PalettePane на pointerdown,
  // читается в CanvasPane для отрисовки preview-плейсхолдера.
  const dragging = ref(null)

  const helpOpen = ref(false)

  // Видимость SearchBar (Ctrl+F). Состояние поиска (query, matches) — в useCanvas.
  const searchOpen = ref(false)

  function setLastTagListPickerStartIn(handle) {
    lastTagListPickerStartIn.value = handle
  }

  function startDragging(payload) {
    dragging.value = payload
  }

  function stopDragging() {
    dragging.value = null
  }

  function openHelp() {
    helpOpen.value = true
  }

  function closeHelp() {
    helpOpen.value = false
  }

  function openSearch() {
    searchOpen.value = true
  }

  function closeSearch() {
    searchOpen.value = false
  }

  return {
    lastTagListPickerStartIn,
    dragging,
    helpOpen,
    searchOpen,
    setLastTagListPickerStartIn,
    startDragging,
    stopDragging,
    openHelp,
    closeHelp,
    openSearch,
    closeSearch,
  }
})
