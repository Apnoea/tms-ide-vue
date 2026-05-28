import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const DARK_MODE_KEY = 'tms-ide:dark-mode:v1'

function loadDarkMode() {
  try {
    const raw = localStorage.getItem(DARK_MODE_KEY)
    if (raw !== null) return raw === '1'
  } catch {
    /* ignore — приватный режим / quota */
  }
  // Если в localStorage ничего нет — берём системное предпочтение
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

export const useUiStore = defineStore('ui', () => {
  const darkMode = ref(loadDarkMode())

  watch(darkMode, (v) => {
    try {
      localStorage.setItem(DARK_MODE_KEY, v ? '1' : '0')
    } catch {
      /* ignore quota */
    }
  })

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
