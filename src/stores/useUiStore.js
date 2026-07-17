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

  // Открыт ли редактор стенсилов (оверлей поверх холста). Пока открыт — глобальные
  // хоткеи холста гейтятся (см. useHotkeys), у редактора своя обработка клавиш.
  const stencilEditorOpen = ref(false)
  // id стенсила, открытого на правку (null = создание нового). Редактор читает
  // при монтировании и префиллит модель через loadStencil.
  const stencilEditorTargetId = ref(null)

  // Идёт проектная операция (экспорт/импорт/переключение формы/CRUD) — живой граф
  // между await'ами держит ЧУЖУЮ форму, поэтому App гейтит всю область
  // редактирования (`inert`), чтобы клики/правки не уехали под чужой ключ.
  // Зеркалит `projectBusy` из useProject (там источник, тут — глобальный доступ).
  const projectBusy = ref(false)

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

  function openStencilEditor(id = null) {
    stencilEditorTargetId.value = id
    stencilEditorOpen.value = true
  }

  function closeStencilEditor() {
    stencilEditorOpen.value = false
    stencilEditorTargetId.value = null
  }

  function setProjectBusy(value) {
    projectBusy.value = value
  }

  return {
    lastTagListPickerStartIn,
    dragging,
    helpOpen,
    searchOpen,
    stencilEditorOpen,
    stencilEditorTargetId,
    projectBusy,
    setProjectBusy,
    setLastTagListPickerStartIn,
    startDragging,
    stopDragging,
    openHelp,
    closeHelp,
    openSearch,
    closeSearch,
    openStencilEditor,
    closeStencilEditor,
  }
})
