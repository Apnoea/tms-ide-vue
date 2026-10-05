import { nextTick } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from './useCanvas'
import {
  zoomKeyOf,
  toolDigitOf,
  isFocusInInput,
  isInListWidget,
  hasTextSelectionOutside,
  runKey,
  ARROW_DIRS,
} from '../utils/viewKeys'
import { isFreeEnd } from '../stencils/linkDefaults'
import { DRAW_TOOLS } from '../constants/icons'

/**
 * Все горячие клавиши IDE через единый raw-keydown handler на window.
 *
 * Читается `event.code` (физическая клавиша), а не `event.key`: на нелатинской
 * раскладке key вернёт 'Ы' вместо 'KeyS'. Исключение — стрелки и Del/Backspace, они
 * одинаковы во всех раскладках.
 *
 * Полный список сочетаний — в F1 (HelpDialog), здесь только неочевидное.
 *
 * При фокусе в поле ввода:
 *  • Ctrl+S / Ctrl+O работают из любого фокуса (глобальные команды приложения);
 *    preventDefault обязателен, иначе браузер откроет «Сохранить страницу»/файл.
 *  • Ctrl+D давит браузерную закладку всегда, дублирует — только вне поля.
 *  • Ctrl+Z/Y/C/V/A и стрелки/Del не перехватываем: это штатная правка текста.
 *
 * Мутирующие граф хоткеи гейтятся `projectBusy`: во время экспорта и импорта живой
 * граф между await'ами держит ЧУЖУЮ форму. Copy и поиск read-only.
 *
 * Зум (Ctrl+= / Ctrl+− / Ctrl+0) — только с курсором над холстом (`pointerOverCanvas`):
 * в остальном UI это браузерный зум страницы, и отбирать его незачем. Цифра выбирает
 * инструмент рисования по номеру в тулбаре (`DRAW_TOOLS`).
 */
export function useHotkeys({
  undo,
  redo,
  scheduleSnapshot,
  copySelection,
  pasteClipboard,
  duplicateSelection,
  rotateSelected,
  flipSelected,
  cancelDraw,
  onExport,
  zoomIn = () => {},
  zoomOut = () => {},
  fitView = () => {},
  pointerOverCanvas = () => false,
  projectBusy = { value: false },
  notify = { success: () => {} },
}) {
  const canvas = useCanvas()
  const ui = useUiStore()

  function onKeyDown(event) {
    // Открыт редактор символов — хоткеи холста молчат: он под оверлеем не виден, а
    // undo/delete/paste писали бы в невидимый граф. У редактора свои клавиши.
    if (ui.stencilEditorOpen) return

    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    const cmd = event.ctrlKey || event.metaKey
    const code = event.code
    const inInput = isFocusInInput(event.target)
    const busy = projectBusy.value
    // Мутирующая команда: браузерный дефолт комбо гасим всегда, а саму команду — не под
    // busy (см. docstring).
    const runMutating = (action) => runKey(event, () => !busy && action())

    if (cmd && !event.shiftKey && code === 'KeyF') {
      return runKey(event, () => {
        if (!ui.searchOpen) return ui.openSearch()
        ui.closeSearch()
        nextTick(() => ui.openSearch())
      })
    }

    if (code === 'F3') {
      if (!ui.searchOpen) return
      return runKey(event, () => canvas.cycleSearchMatch(event.shiftKey ? -1 : 1))
    }

    if (code === 'Escape') {
      if (inInput) return
      // Открыт модальный диалог (tag-picker, справка) — Esc закрывает его сам, а
      // выделение на холсте не трогаем: одно нажатие не должно делать две вещи.
      if (document.querySelector('.p-dialog-mask')) return
      // Рисование первым: незаконченная ломаная / активный инструмент отменяются
      // раньше выделения — как в редакторе символов.
      if (cancelDraw?.()) return
      if (canvas.highlightedTag.value) canvas.clearHighlightedTag()
      if (canvas.selection.value.length) canvas.clearSelection()
      return
    }

    // Глобальные команды приложения — до гварда !inInput, работают из любого
    // фокуса. preventDefault давит браузерный page-action (Сохранить страницу /
    // открыть файл), который иначе перехватил бы комбо в инпуте.
    if (cmd && code === 'KeyS') return runKey(event, onExport)
    if (cmd && code === 'KeyO') {
      return runKey(event, () => window.dispatchEvent(new CustomEvent('tms-open-project')))
    }
    // Ctrl+D: браузерную закладку давим всегда, дублируем — только вне инпута.
    if (cmd && code === 'KeyD') return runMutating(() => !inInput && duplicateSelection())

    // Зум вида — из любого фокуса, но только над холстом (см. docstring). Открытый
    // диалог накрывает холст маской — тогда клавиша остаётся браузеру.
    const zoom = zoomKeyOf(event)
    if (zoom && pointerOverCanvas() && !document.querySelector('.p-dialog-mask')) {
      return runMutating({ in: zoomIn, out: zoomOut, fit: fitView }[zoom])
    }

    // 1…5 — инструмент рисования по номеру в тулбаре; та же цифра возвращает к выбору,
    // как повторный клик по активной кнопке. Цифры, а не буквы: R, H и V заняты
    // поворотом и отражением. В поле и в списке (Select инспектора ищет по первой
    // букве) цифра — это ввод.
    const toolKey = DRAW_TOOLS[toolDigitOf(event)]?.key
    if (toolKey) {
      if (inInput || isInListWidget(event.target) || busy) return
      return runKey(event, () => ui.setCanvasTool(toolKey))
    }

    if (cmd && !inInput) {
      if (code === 'KeyZ') return runMutating(event.shiftKey ? redo : undo)
      if (code === 'KeyY') return runMutating(redo)
      if (code === 'KeyC' && !event.shiftKey) {
        // Выделен ТЕКСТ вне холста (id символа в инспекторе, подпись в панели) — это
        // штатное копирование браузером: перехват отдавал бы Ctrl+C нашему буферу и
        // отвечал тостом «Нечего копировать» вместо копирования выделенного текста.
        // Выделение внутри paper'а не считается: подписи на схеме — `<text>` в SVG, их
        // легко зацепить мышью, и Ctrl+C перестал бы копировать символы.
        if (hasTextSelectionOutside('.joint-paper')) return
        return runKey(event, copySelection) // read-only, безопасно под busy
      }
      if (code === 'KeyV' && !event.shiftKey) return runMutating(pasteClipboard)
      if (code === 'KeyA') {
        if (!graph || busy) return
        return runKey(event, canvas.selectAllCells)
      }
      // Ctrl+] / Ctrl+[ — выше / ниже, с Shift — на передний / задний план.
      // Работает и на проводах (у них порядок виден на пересечении).
      if (code === 'BracketRight' || code === 'BracketLeft') {
        const up = code === 'BracketRight'
        const mode = event.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward'
        return runMutating(() => canvas.reorderCells(canvas.selection.value, mode))
      }
      // Ctrl+G — сгруппировать выделенное, Ctrl+Shift+G — разгруппировать.
      if (code === 'KeyG') {
        return runMutating(() => canvas.toggleGroupSelection(event.shiftKey, notify))
      }
    }

    // Поворот и отражение без cmd: Ctrl+R (перезагрузка) и Ctrl+H (история) — браузерные.
    // rotateSelected / flipSelected сами фильтруют noRotate/locked и снапшотят.
    const bare = !cmd && !event.altKey && !inInput && !busy
    if (code === 'KeyR' && bare) {
      return runKey(event, () => rotateSelected?.(event.shiftKey ? -90 : 90))
    }
    if ((code === 'KeyH' || code === 'KeyV') && event.shiftKey && bare) {
      return runKey(event, () => flipSelected?.(code === 'KeyH' ? 'h' : 'v'))
    }

    const arrow = ARROW_DIRS[event.key]
    if (arrow) {
      if (inInput || !graph || !paper || busy) return
      if (!canvas.selection.value.some((s) => s.kind === 'cell')) return
      const step = (event.shiftKey ? 5 : 1) * (paper.options.gridSize || 10)
      return runKey(event, () => nudgeSelection(graph, arrow.x * step, arrow.y * step))
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (inInput || busy || !graph || !canvas.selection.value.length) return
    runKey(event, () => canvas.deleteItems([...canvas.selection.value]))
  }

  /**
   * Сдвиг выделения стрелками. uiNudge — стрелки сами двигают ВСЁ выделение: помечаем,
   * чтобы multi-drag change:position-хендлер (CanvasPane) не сдвинул соседей повторно,
   * если в этот момент зажата ЛКМ на ячейке. locked-ячейки не двигаем даже стрелками.
   */
  function nudgeSelection(graph, dx, dy) {
    for (const item of canvas.selection.value) {
      const cell = graph.getCell(item.id)
      if (!cell) continue
      if (item.kind === 'cell') {
        if (!cell.get('tms')?.locked) cell.translate(dx, dy, { uiNudge: true })
        continue
      }
      // Свободные концы выделенных проводов (точки на холсте) ни за чем не следуют —
      // сдвигаем их тем же шагом, иначе провод растянулся бы, а точка осталась.
      for (const key of ['source', 'target']) {
        const end = cell.get(key)
        if (isFreeEnd(end)) cell.set(key, { x: end.x + dx, y: end.y + dy }, { uiNudge: true })
      }
    }
    scheduleSnapshot()
  }

  useEventListener(window, 'keydown', onKeyDown)
}
