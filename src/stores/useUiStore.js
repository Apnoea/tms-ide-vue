import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const darkMode = ref(false)

  const lastTagListPickerStartIn = ref(null)

  // Текущий drag из палитры. Заполняется в PalettePane на pointerdown,
  // читается в CanvasPane для отрисовки preview-плейсхолдера на холсте.
  // { stencilId, width, height, label } | null
  const dragging = ref(null)

  // Модалка справки по хоткеям
  const helpOpen = ref(false)

  function toggleDarkMode() {
    darkMode.value = !darkMode.value
  }

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

  return {
    darkMode,
    lastTagListPickerStartIn,
    dragging,
    helpOpen,
    toggleDarkMode,
    setLastTagListPickerStartIn,
    startDragging,
    stopDragging,
    openHelp,
    closeHelp,
  }
})
