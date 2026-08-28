import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const lastTagListPickerStartIn = ref(null)

  // Текущий drag из палитры: пишет PalettePane на pointerdown, читает CanvasPane для
  // preview-плейсхолдера.
  const dragging = ref(null)

  const helpOpen = ref(false)

  // Видимость SearchBar (Ctrl+F). Состояние поиска (query, matches) — в useCanvas.
  const searchOpen = ref(false)

  // Открыт ли редактор символов (оверлей поверх холста). Пока открыт, хоткеи холста
  // гейтятся (useHotkeys) — у редактора своя обработка клавиш.
  const stencilEditorOpen = ref(false)
  // id символа, открытого на правку (null = создание нового): редактор читает его при
  // монтировании и грузит модель через loadStencil.
  const stencilEditorTargetId = ref(null)

  // Идёт проектная операция (экспорт/импорт/переключение формы/CRUD): живой граф
  // между await'ами держит ЧУЖУЮ форму, поэтому App гейтит область редактирования
  // (`inert`). Зеркало `projectBusy` из useProject — там источник.
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

  // Активный инструмент рисования фигур ('select' = обычная работа с холстом; тогл,
  // как в редакторе символов). Пока инструмент активен, ЛКМ-drag рисует, а не тянет
  // рамку выделения.
  const canvasTool = ref('select')

  function setCanvasTool(tool) {
    canvasTool.value = canvasTool.value === tool ? 'select' : tool
  }

  function resetCanvasTool() {
    canvasTool.value = 'select'
  }

  return {
    canvasTool,
    setCanvasTool,
    resetCanvasTool,
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
