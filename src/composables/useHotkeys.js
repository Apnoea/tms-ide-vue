import { nextTick } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from './useCanvas'

function isFocusInInput(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/**
 * Все горячие клавиши IDE через единый raw-keydown handler на window.
 *
 * Используем `event.code` (физическая клавиша), а НЕ `event.key` (символ) —
 * иначе на нелатинских раскладках (русская/немецкая/...) Ctrl+S, Ctrl+Z и т.п.
 * не срабатывают (event.key вернёт 'Ы', 'я', и map по литералу 'KeyS' не сойдётся).
 * Исключение — стрелки и Del/Backspace: они одинаковы во всех раскладках,
 * там event.key безопасен.
 *
 * Раскладка:
 *  Ctrl+F      — открыть/перезапустить поиск (работает даже в инпутах:
 *                перехватываем стандартный браузерный find-in-page)
 *  F3          — листать совпадения поиска (Shift = назад)
 *  Escape      — снять highlight тега → снять выделение
 *  Ctrl+Z/Y    — undo/redo (Shift+Z = redo как альтернатива)
 *  Ctrl+S      — экспорт проекта (через переданный onExport)
 *  Ctrl+O      — диспатч `tms-open-project` (ловит ProjectActions)
 *  Ctrl+C/V/D  — copy/paste/duplicate выделения
 *  Ctrl+A      — выделить все ячейки
 *  Стрелки     — сдвиг выделенных ячеек на gridSize (Shift = ×5)
 *  Del/Bksp    — удалить выделение
 *
 * Поведение при фокусе в input/textarea/contenteditable:
 *  • Ctrl+S / Ctrl+O — глобальные команды приложения, работают из любого
 *    фокуса (как Ctrl+S в десктоп-редакторе). preventDefault обязателен — иначе
 *    браузер перехватит: Ctrl+S → «Сохранить страницу», Ctrl+O → диалог файла.
 *  • Ctrl+D — дублировать ячейку из инпута бессмысленно, но браузерную закладку
 *    давим: preventDefault всегда, сам duplicate — только вне инпута.
 *  • Ctrl+Z/Y/C/V/A — НЕ перехватываем: это штатная правка текста в поле
 *    (undo/redo/copy/paste/select-all), ломать её нельзя.
 *  • Стрелки / Del — не трогаем ввод текста.
 *
 * Зависимости передаются опциями (приходят из composables, которые держит
 * CanvasPane): undo/redo/scheduleSnapshot из useUndoRedo, copy/paste/duplicate
 * из useClipboard, onExport — локальная функция CanvasPane.
 */
export function useHotkeys({
  undo,
  redo,
  scheduleSnapshot,
  copySelection,
  pasteClipboard,
  duplicateSelection,
  onExport,
}) {
  const canvas = useCanvas()
  const ui = useUiStore()

  function onKeyDown(event) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    const cmd = event.ctrlKey || event.metaKey
    const code = event.code
    const inInput = isFocusInInput(event.target)

    if (cmd && !event.shiftKey && code === 'KeyF') {
      event.preventDefault()
      event.stopPropagation()
      if (ui.searchOpen) {
        ui.closeSearch()
        nextTick(() => ui.openSearch())
      } else {
        ui.openSearch()
      }
      return
    }

    if (code === 'F3') {
      if (!ui.searchOpen) return
      event.preventDefault()
      event.stopPropagation()
      canvas.cycleSearchMatch(event.shiftKey ? -1 : 1)
      return
    }

    if (code === 'Escape') {
      if (inInput) return
      if (canvas.highlightedTag.value) canvas.clearHighlightedTag()
      if (canvas.selection.value.length) canvas.clearSelection()
      return
    }

    // Глобальные команды приложения — до гварда !inInput, работают из любого
    // фокуса. preventDefault давит браузерный page-action (Сохранить страницу /
    // открыть файл), который иначе перехватил бы комбо в инпуте.
    if (cmd && code === 'KeyS') {
      event.preventDefault()
      event.stopPropagation()
      onExport()
      return
    }
    if (cmd && code === 'KeyO') {
      event.preventDefault()
      event.stopPropagation()
      window.dispatchEvent(new CustomEvent('tms-open-project'))
      return
    }
    // Ctrl+D: браузерную закладку давим всегда, дублируем — только вне инпута.
    if (cmd && code === 'KeyD') {
      event.preventDefault()
      event.stopPropagation()
      if (!inInput) duplicateSelection()
      return
    }

    if (cmd && !inInput) {
      if (code === 'KeyZ') {
        event.preventDefault()
        event.stopPropagation()
        event.shiftKey ? redo() : undo()
        return
      }
      if (code === 'KeyY') {
        event.preventDefault()
        event.stopPropagation()
        redo()
        return
      }
      if (code === 'KeyC' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        copySelection()
        return
      }
      if (code === 'KeyV' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        pasteClipboard()
        return
      }
      if (code === 'KeyA') {
        if (!graph) return
        event.preventDefault()
        event.stopPropagation()
        canvas.selectAllCells()
        return
      }
    }

    const isArrow =
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight'
    if (isArrow) {
      if (inInput || !graph || !paper) return
      const cellSel = canvas.selection.value.filter((s) => s.kind === 'cell')
      if (!cellSel.length) return
      event.preventDefault()
      event.stopPropagation()
      const grid = paper.options.gridSize || 10
      const step = (event.shiftKey ? 5 : 1) * grid
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      for (const item of cellSel) graph.getCell(item.id)?.translate(dx, dy)
      scheduleSnapshot()
      return
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (inInput) return
    const sel = canvas.selection.value
    if (!sel.length || !graph) return
    event.preventDefault()
    event.stopPropagation()
    for (const item of [...sel]) graph.getCell(item.id)?.remove()
    canvas.clearSelection()
    // PrimeVue Splitter gutter ловит keydown и оставляет фокус на gutter'е —
    // явно blurим, иначе следующий Del «съест» ячейку, по которой кликнул юзер.
    const active = document.activeElement
    if (active && active !== document.body && typeof active.blur === 'function') active.blur()
  }

  useEventListener(window, 'keydown', onKeyDown)
}
