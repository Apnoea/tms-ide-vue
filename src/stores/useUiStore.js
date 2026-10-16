import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'

/** Ширина боковых колонок по умолчанию (px). */
export const PANE_WIDTH_DEFAULT = { left: 420, right: 420 }
export const PANE_WIDTH_MIN = 260
export const PANE_WIDTH_MAX = 640

const clampPaneWidth = (value) =>
  Math.round(Math.min(PANE_WIDTH_MAX, Math.max(PANE_WIDTH_MIN, Number(value) || 0)))

/** Ширина окна выбора тега (px): по умолчанию — прежняя фиксированная, уже не бывает. */
export const TAG_PICKER_WIDTH_DEFAULT = 420
export const TAG_PICKER_WIDTH_MAX = 1200

const clampTagPickerWidth = (value) =>
  Math.round(Math.min(TAG_PICKER_WIDTH_MAX, Math.max(TAG_PICKER_WIDTH_DEFAULT, Number(value) || 0)))

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

  // Ширина окна выбора тега — тоже рабочее место: длинные имена тегов не влезали в
  // прежние 420px, а растянутое окно нужно и в следующий раз. Уже 420 не сжимается.
  const tagPickerWidth = useLocalStorage('tms.tagPickerWidth', TAG_PICKER_WIDTH_DEFAULT)
  tagPickerWidth.value = clampTagPickerWidth(tagPickerWidth.value)

  function setTagPickerWidth(value) {
    tagPickerWidth.value = clampTagPickerWidth(value)
  }

  function resetTagPickerWidth() {
    tagPickerWidth.value = TAG_PICKER_WIDTH_DEFAULT
  }

  function toggleLeftPane() {
    leftPaneOpen.value = !leftPaneOpen.value
  }

  // С открытым редактором символов правая колонка не сворачивается: в ней его свойства
  // и «Сохранить/Закрыть» (телепорт в шапку StencilInspector). Свёрнутая колонка
  // размонтировала бы цель телепорта, и после разворота кнопки уже не вернулись бы.
  function toggleRightPane() {
    if (stencilEditorOpen.value) return
    rightPaneOpen.value = !rightPaneOpen.value
  }

  // Текущий drag из палитры: пишет PalettePane на pointerdown, читает CanvasPane для
  // preview-плейсхолдера.
  const dragging = ref(null)

  const helpOpen = ref(false)

  // Диалог наборов символов (установка/удаление). Наборы — свойство приложения, а не
  // проекта, поэтому от projectBusy не зависят.
  const presetsOpen = ref(false)

  // Видимость SearchBar (Ctrl+F). Состояние поиска (query, matches) — в useCanvas.
  const searchOpen = ref(false)

  // Открыт ли редактор символов (оверлей поверх холста). Пока открыт, хоткеи холста
  // гейтятся (useHotkeys) — у редактора своя обработка клавиш.
  const stencilEditorOpen = ref(false)
  // id символа, открытого на правку (null = создание нового): редактор читает его при
  // монтировании и грузит модель через loadStencil.
  const stencilEditorTargetId = ref(null)
  // Таргет открыт на ДУБЛИРОВАНИЕ: модель берётся из него, но сохраняется новым
  // символом (`loadStencil(def, { asCopy: true })`).
  const stencilEditorDuplicate = ref(false)

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

  function openPresets() {
    presetsOpen.value = true
  }

  function closePresets() {
    presetsOpen.value = false
  }

  function openSearch() {
    searchOpen.value = true
  }

  function closeSearch() {
    searchOpen.value = false
  }

  function openStencilEditor(id = null, { duplicate = false } = {}) {
    stencilEditorTargetId.value = id
    stencilEditorDuplicate.value = !!id && duplicate
    stencilEditorOpen.value = true
    // Свойства символа живут в ПРАВОЙ колонке (InspectorPane → StencilInspector): со
    // свёрнутой колонкой редактор открылся бы без единственной панели правки.
    rightPaneOpen.value = true
  }

  function closeStencilEditor() {
    stencilEditorOpen.value = false
    stencilEditorTargetId.value = null
    stencilEditorDuplicate.value = false
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
    tagPickerWidth,
    setTagPickerWidth,
    resetTagPickerWidth,
    lastTagListPickerStartIn,
    dragging,
    helpOpen,
    presetsOpen,
    searchOpen,
    stencilEditorOpen,
    stencilEditorTargetId,
    stencilEditorDuplicate,
    projectBusy,
    setProjectBusy,
    setLastTagListPickerStartIn,
    startDragging,
    stopDragging,
    openHelp,
    closeHelp,
    openPresets,
    closePresets,
    openSearch,
    closeSearch,
    openStencilEditor,
    closeStencilEditor,
  }
})
