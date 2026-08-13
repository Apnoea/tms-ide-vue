import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { CANVAS_BG_DEFAULT } from '../stencils/canvasPaper'
import { cssColor } from '../constants/animation'

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

  // Активный инструмент рисования фигур ('select' = обычная работа с холстом).
  // Тогл как в редакторе символов: повторный клик по кнопке возвращает 'select'.
  // Пока инструмент активен, ЛКМ-drag по холсту рисует, а не тянет рамку выделения.
  const canvasTool = ref('select')

  function setCanvasTool(tool) {
    canvasTool.value = canvasTool.value === tool ? 'select' : tool
  }

  function resetCanvasTool() {
    canvasTool.value = 'select'
  }

  // Фон холста — настройка ОКРУЖЕНИЯ, а не проекта: живёт в localStorage (как
  // раскрытые категории палитры), в `.zip` не уезжает и на `view.svg` не влияет —
  // фон схемы в рантайме даёт панель. Цвет точек сетки считается от него
  // (`gridColorFor`), отдельной настройки нет.
  const canvasBg = useLocalStorage('tms-ide:canvas-bg', CANVAS_BG_DEFAULT)

  /** Мусор (правка localStorage руками) откатываем к дефолту, а не красим им холст. */
  function setCanvasBg(color) {
    canvasBg.value = cssColor(color) || CANVAS_BG_DEFAULT
  }

  function resetCanvasBg() {
    canvasBg.value = CANVAS_BG_DEFAULT
  }

  return {
    canvasTool,
    setCanvasTool,
    resetCanvasTool,
    canvasBg,
    setCanvasBg,
    resetCanvasBg,
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
