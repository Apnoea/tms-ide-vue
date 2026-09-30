import { useEventListener } from '@vueuse/core'
import { useUiStore } from '../stores/useUiStore'
import { zoomKeyOf, toolDigitOf, isFocusInInput, isInListWidget } from '../utils/viewKeys'
import { PORT_GRID, SHAPE_GRID } from './useStencilEditor'

const ARROW_DIRS = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

// Открыт модальный диалог (справка / confirm) поверх редактора: клавиши — его.
const dialogOpen = () => !!document.querySelector('.p-dialog-mask')

/**
 * Клавиши редактора символов. Где операция та же, что на холсте, та же и клавиша
 * (см. useHotkeys): зум, undo/redo, Ctrl+C/V/D/A, стрелки, Del, R и Shift+H/V, порядок
 * Ctrl+[ ]. Undo/redo и прочие аккорды — по физической клавише (`event.code`): на
 * русской раскладке `key` для Z/Y возвращает «Я»/«Н». В полях ввода правку текста не
 * перехватываем — там нативный undo и стрелки степпера.
 *
 * @param {object} deps
 * @param {object} deps.ed — модель редактора (useStencilEditor)
 * @param {import('vue').Ref<HTMLElement|null>} deps.stageEl — стол: зум только над ним
 * @param {boolean} deps.locked — рисунок заперт (символ набора, программный символ)
 * @param {boolean} deps.animationOnly — символ набора: выделять фигуры можно
 * @param {string[]} deps.toolKeys — инструменты в порядке тулбара (цифра = номер)
 */
export function useEditorHotkeys({
  ed,
  stageEl,
  locked,
  animationOnly,
  toolKeys,
  pickTool,
  zoomIn,
  zoomOut,
  fitView,
  cancelDraw,
  save,
  requestClose,
  rotateSelected,
  flipSelected,
}) {
  const ui = useUiStore()
  const { selectedIds, selectedPortIds, select, selectAll, setTool } = ed

  function onKeyDown(e) {
    if (!ui.stencilEditorOpen) return
    const inInput = isFocusInInput(e.target)
    // Зум стола — только с курсором над столом (иначе это браузерный зум страницы).
    const zoom = zoomKeyOf(e)
    if (zoom && stageEl.value?.matches(':hover') && !dialogOpen()) {
      e.preventDefault()
      if (zoom === 'fit') fitView()
      else if (zoom === 'in') zoomIn()
      else zoomOut()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !inInput) {
      if (e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) ed.redo()
        else ed.undo()
        return
      }
      if (e.code === 'KeyY') {
        e.preventDefault()
        ed.redo()
        return
      }
      // Ctrl+S — сохранить символ (у браузера это «сохранить страницу», перехватываем).
      // Доступен и программному символу: его зоны тоже сохраняются.
      if (e.code === 'KeyS') {
        e.preventDefault()
        save()
        return
      }
      // Ctrl+A остаётся и под замком: выделение нужно, чтобы задать фигурам состояние.
      if (locked) {
        if (e.code === 'KeyA' && animationOnly) {
          e.preventDefault()
          selectAll()
        }
        return
      }
      // Ctrl+C / Ctrl+V — копировать/вставить выделенное (со свойствами).
      if (e.code === 'KeyC') {
        e.preventDefault()
        ed.copyShapes()
        return
      }
      if (e.code === 'KeyV') {
        e.preventDefault()
        ed.pasteShapes()
        return
      }
      // Ctrl+D — дублировать выделенное, как на холсте; буфер при этом не трогается.
      if (e.code === 'KeyD') {
        e.preventDefault()
        ed.duplicateShapes()
        return
      }
      // Ctrl+A — все фигуры (порты в выделение не входят, у них свой режим).
      if (e.code === 'KeyA') {
        e.preventDefault()
        setTool('select')
        selectAll()
        return
      }
    }
    if (e.key === 'Escape') {
      // Поверх редактора открыт диалог — Esc закрывает его сам (PrimeVue
      // close-on-escape); иначе один Esc закрыл бы и диалог, и редактор.
      if (dialogOpen()) return
      // Порядок как на холсте: сначала бросаем активный жест, потом снимаем
      // выделение, и только «пустым» Esc закрываем редактор — иначе Esc после
      // выделения рамкой уводил бы из редактора целиком.
      if (cancelDraw()) return
      if (selectedIds.value.length || selectedPortIds.value.length) select(null)
      else requestClose()
      return
    }
    // Дальше — правка фигур и портов.
    if (locked) return
    // Стрелки в фокусе Select'а (подпись состояния, шрифт, категория) листают его опции,
    // а цифра в поле — это ввод: сдвиг фигур или смена инструмента там были бы вторым,
    // невидимым эффектом одного нажатия.
    const ownKeys = !inInput && !isInListWidget(e.target)
    // 1…6 — инструмент по номеру в тулбаре (рисование, затем порт); та же цифра — к
    // выбору, как повторный клик.
    const toolKey = toolKeys[toolDigitOf(e)]
    if (toolKey && ownKeys) {
      e.preventDefault()
      pickTool(toolKey)
      return
    }
    // Стрелки — сдвиг выделения, как на холсте: шаг сетки, с Shift — впятеро крупнее
    // (у фигур сетка 1px, у портов и размера символа — 5).
    const arrow = ARROW_DIRS[e.key]
    if (arrow && ownKeys) {
      // Порт живёт на сетке символа, поэтому у него шаг всегда PORT_GRID: пиксельный
      // сдвиг увёл бы вывод с клетки, и провод на схеме перестал бы попадать в порт.
      if (selectedPortIds.value.length) {
        e.preventDefault()
        ed.nudgePorts(arrow.x * PORT_GRID, arrow.y * PORT_GRID)
        return
      }
      if (selectedIds.value.length) {
        e.preventDefault()
        const step = e.shiftKey ? PORT_GRID : SHAPE_GRID
        ed.nudgeShapes(arrow.x * step, arrow.y * step)
        return
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
      // Выделение взаимно исключающее (см. selectPort), поэтому порядок проверок не спорит.
      if (selectedPortIds.value.length) {
        e.preventDefault()
        ed.removePorts(selectedPortIds.value)
        return
      }
      if (selectedIds.value.length) {
        e.preventDefault()
        ed.removeShapes(selectedIds.value)
        return
      }
    }
    // Поворот и отражение без Ctrl, поэтому проверяем поля ввода: R посреди набора
    // подписи не должен крутить фигуру.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !inInput && selectedIds.value.length) {
      if (e.code === 'KeyR') {
        e.preventDefault()
        rotateSelected(e.shiftKey ? -1 : 1)
        return
      }
      if (e.shiftKey && (e.code === 'KeyH' || e.code === 'KeyV')) {
        e.preventDefault()
        flipSelected(e.code === 'KeyH' ? 'h' : 'v')
        return
      }
    }
    // Порядок наложения: Ctrl+] / Ctrl+[, с Shift — до края. У фигур слой задаёт
    // позиция в массиве, а не z.
    if ((e.ctrlKey || e.metaKey) && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      if (!selectedIds.value.length) return
      e.preventDefault()
      const up = e.code === 'BracketRight'
      ed.reorderShapes(
        selectedIds.value,
        e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward'
      )
    }
  }

  useEventListener(window, 'keydown', onKeyDown)
}
