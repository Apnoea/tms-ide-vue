import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useLocalStorage, usePreferredDark } from '@vueuse/core'

// Кастомный serializer чтобы сохранить обратную совместимость со старым
// форматом ключа ('1'/'0' вместо JSON).
const BOOL_01 = {
  read: (v) => v === '1',
  write: (v) => (v ? '1' : '0'),
}

export const useUiStore = defineStore('ui', () => {
  // Дефолт = системное предпочтение; после первого toggle — из localStorage.
  const darkMode = useLocalStorage('tms-ide:dark-mode:v1', usePreferredDark().value, {
    serializer: BOOL_01,
  })

  const lastTagListPickerStartIn = ref(null)

  // Текущий drag из палитры. Заполняется в PalettePane на pointerdown,
  // читается в CanvasPane для отрисовки preview-плейсхолдера на холсте.
  // { stencilId, width, height, label } | null
  const dragging = ref(null)

  // Модалка справки по хоткеям
  const helpOpen = ref(false)

  // Видимость поискового виджета (Ctrl+F). Открывается из CanvasPane по хоткею,
  // закрывается из самого SearchBar (Esc / ✕). Состояние поиска (query, matches)
  // живёт в useCanvas — там же graph, по которому ищем.
  const searchOpen = ref(false)

  // Счётчик-сигнал для запроса диалога выбора tag-list'а из не-header контекста
  // (например, кнопки «Загрузить tag-list…» в инспекторе, когда юзер видит
  // empty-state и хочет загрузить прямо отсюда). AppHeader watch'ит счётчик и
  // вызывает свой pickTagList. Счётчик, а не boolean — чтобы повторный запрос
  // подряд тоже триггерился (boolean застрял бы в true).
  const tagListLoadRequest = ref(0)
  function requestTagListLoad() {
    tagListLoadRequest.value++
  }

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

  function openSearch() {
    searchOpen.value = true
  }

  function closeSearch() {
    searchOpen.value = false
  }

  return {
    darkMode,
    lastTagListPickerStartIn,
    dragging,
    helpOpen,
    searchOpen,
    tagListLoadRequest,
    toggleDarkMode,
    setLastTagListPickerStartIn,
    startDragging,
    stopDragging,
    openHelp,
    closeHelp,
    openSearch,
    closeSearch,
    requestTagListLoad,
  }
})
