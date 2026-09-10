import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'

/** Ширина боковых колонок по умолчанию (px) — с ней IDE и жила до ресайза. */
export const PANE_WIDTH_DEFAULT = { left: 380, right: 420 }
export const PANE_WIDTH_MIN = 260
export const PANE_WIDTH_MAX = 640

const clampPaneWidth = (value) =>
  Math.round(Math.min(PANE_WIDTH_MAX, Math.max(PANE_WIDTH_MIN, Number(value) || 0)))

export const useUiStore = defineStore('ui', () => {
  const lastTagListPickerStartIn = ref(null)

  // Видимость боковых колонок (формы+палитра слева, инспектор справа). Это настройка
  // РАБОЧЕГО МЕСТА, а не проекта: живёт в localStorage, чтобы переживать перезагрузку
  // и не уезжать в архив. Скрытая колонка размонтируется — инспектор пересчитывает
  // свойства выделенного на каждый тик графа, и в свёрнутом виде это была бы работа
  // впустую.
  const leftPaneOpen = useLocalStorage('tms.leftPaneOpen', true)
  const rightPaneOpen = useLocalStorage('tms.rightPaneOpen', true)

  // Ширина колонок — тоже рабочее место. Пределы держат читаемость: уже минимума
  // палитра идёт в один столбец с обрезанными подписями, шире максимума холст
  // перестаёт быть главным. Значение из localStorage прогоняем через кламп: там мог
  // остаться размер от другого монитора.
  const leftPaneWidth = useLocalStorage('tms.leftPaneWidth', PANE_WIDTH_DEFAULT.left)
  const rightPaneWidth = useLocalStorage('tms.rightPaneWidth', PANE_WIDTH_DEFAULT.right)
  leftPaneWidth.value = clampPaneWidth(leftPaneWidth.value)
  rightPaneWidth.value = clampPaneWidth(rightPaneWidth.value)

  function setLeftPaneWidth(value) {
    leftPaneWidth.value = clampPaneWidth(value)
  }

  function setRightPaneWidth(value) {
    rightPaneWidth.value = clampPaneWidth(value)
  }

  /** Двойной клик по разделителю — вернуть колонке ширину по умолчанию. */
  function resetPaneWidth(side) {
    if (side === 'left') leftPaneWidth.value = PANE_WIDTH_DEFAULT.left
    else rightPaneWidth.value = PANE_WIDTH_DEFAULT.right
  }

  function toggleLeftPane() {
    leftPaneOpen.value = !leftPaneOpen.value
  }

  function toggleRightPane() {
    rightPaneOpen.value = !rightPaneOpen.value
  }

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
    // Свойства символа живут в ПРАВОЙ колонке (InspectorPane → StencilInspector): со
    // свёрнутой колонкой редактор открылся бы без единственной панели правки.
    rightPaneOpen.value = true
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
    leftPaneOpen,
    rightPaneOpen,
    toggleLeftPane,
    toggleRightPane,
    leftPaneWidth,
    rightPaneWidth,
    setLeftPaneWidth,
    setRightPaneWidth,
    resetPaneWidth,
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
