import { nextTick } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from './useCanvas'
import { nplural } from '../utils/plural'
import { isFreeEnd } from '../stencils/linkDefaults'

function isFocusInInput(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/**
 * Выделен текст ВНЕ холста (id символа, тег в инспекторе) — такой Ctrl+C принадлежит
 * браузеру. Выделение внутри paper'а не считается: подписи на схеме это `<text>` в
 * SVG, их легко зацепить мышью, и Ctrl+C перестал бы копировать символы.
 */
function hasTextSelectionOutsideCanvas() {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
  if (!sel || sel.isCollapsed || !String(sel).trim()) return false
  const node = sel.anchorNode
  const el = node?.nodeType === 1 ? node : node?.parentElement
  return !el?.closest?.('.joint-paper')
}

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
    // Ctrl+D: браузерную закладку давим всегда, дублируем — только вне инпута и не под busy.
    if (cmd && code === 'KeyD') {
      event.preventDefault()
      event.stopPropagation()
      if (!inInput && !projectBusy.value) duplicateSelection()
      return
    }

    if (cmd && !inInput) {
      // Мутирующие граф/стор — не под busy (см. docstring). preventDefault всё
      // равно давим, чтобы не сработал браузерный дефолт комбо.
      if (code === 'KeyZ') {
        event.preventDefault()
        event.stopPropagation()
        if (!projectBusy.value) (event.shiftKey ? redo : undo)()
        return
      }
      if (code === 'KeyY') {
        event.preventDefault()
        event.stopPropagation()
        if (!projectBusy.value) redo()
        return
      }
      if (code === 'KeyC' && !event.shiftKey) {
        // Выделен ТЕКСТ вне холста (id символа в инспекторе, подпись в панели) — это
        // штатное копирование браузером: перехват отдавал бы Ctrl+C нашему буферу и
        // отвечал тостом «Нечего копировать» вместо копирования выделенного текста.
        if (hasTextSelectionOutsideCanvas()) return
        event.preventDefault()
        event.stopPropagation()
        copySelection() // read-only, безопасно под busy
        return
      }
      if (code === 'KeyV' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        if (!projectBusy.value) pasteClipboard()
        return
      }
      if (code === 'KeyA') {
        if (!graph || projectBusy.value) return
        event.preventDefault()
        event.stopPropagation()
        canvas.selectAllCells()
        return
      }
      // Ctrl+] / Ctrl+[ — выше / ниже, с Shift — на передний / задний план.
      // Работает и на проводах (у них порядок виден на пересечении).
      if (code === 'BracketRight' || code === 'BracketLeft') {
        event.preventDefault()
        event.stopPropagation()
        if (projectBusy.value) return
        const up = code === 'BracketRight'
        const mode = event.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward'
        canvas.reorderCells(canvas.selection.value, mode)
        return
      }
      // Ctrl+G — сгруппировать выделенное, Ctrl+Shift+G — разгруппировать.
      if (code === 'KeyG') {
        event.preventDefault()
        event.stopPropagation()
        if (!projectBusy.value) {
          if (event.shiftKey) {
            const n = canvas.ungroupCells(canvas.selection.value)
            if (n) notify.success('Разгруппировано', nplural(n, 'символ', 'символа', 'символов'))
          } else {
            const n = canvas.groupCells(canvas.selection.value)
            if (n) notify.success('Сгруппировано', nplural(n, 'символ', 'символа', 'символов'))
          }
        }
        return
      }
    }

    // R / Shift+R — поворот выделенных ячеек. Без cmd: Ctrl+R отдаём браузеру
    // (перезагрузка). rotateSelected сам фильтрует noRotate-символы и снапшотит.
    if (code === 'KeyR' && !cmd && !event.altKey) {
      if (inInput || projectBusy.value) return
      event.preventDefault()
      event.stopPropagation()
      rotateSelected?.(event.shiftKey ? -90 : 90)
      return
    }

    // Shift+H / Shift+V — отразить выделенные ячейки по горизонтали / вертикали.
    // Без cmd (Ctrl+H — браузерная история). flipSelected сам фильтрует
    // noRotate/locked-символы и снапшотит.
    if ((code === 'KeyH' || code === 'KeyV') && event.shiftKey && !cmd && !event.altKey) {
      if (inInput || projectBusy.value) return
      event.preventDefault()
      event.stopPropagation()
      flipSelected?.(code === 'KeyH' ? 'h' : 'v')
      return
    }

    const isArrow =
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight'
    if (isArrow) {
      if (inInput || !graph || !paper || projectBusy.value) return
      const cellSel = canvas.selection.value.filter((s) => s.kind === 'cell')
      if (!cellSel.length) return
      event.preventDefault()
      event.stopPropagation()
      const grid = paper.options.gridSize || 10
      const step = (event.shiftKey ? 5 : 1) * grid
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      // uiNudge — стрелки сами двигают ВСЁ выделение; помечаем, чтобы multi-drag
      // change:position-хендлер (CanvasPane) не сдвинул соседей повторно, если в
      // этот момент зажата ЛКМ на ячейке (activeDragCellId выставлен без drag'а).
      // locked-ячейки пропускаем — read-only не двигаем даже стрелками.
      for (const item of cellSel) {
        const c = graph.getCell(item.id)
        if (c && !c.get('tms')?.locked) c.translate(dx, dy, { uiNudge: true })
      }
      // Свободные концы выделенных проводов (точки на холсте) ни за чем не следуют —
      // сдвигаем их тем же шагом, иначе провод растянулся бы, а точка осталась.
      for (const item of canvas.selection.value) {
        if (item.kind !== 'link') continue
        const link = graph.getCell(item.id)
        if (!link) continue
        for (const key of ['source', 'target']) {
          const end = link.get(key)
          if (isFreeEnd(end)) link.set(key, { x: end.x + dx, y: end.y + dy }, { uiNudge: true })
        }
      }
      scheduleSnapshot()
      return
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (inInput || projectBusy.value) return
    const sel = canvas.selection.value
    if (!sel.length || !graph) return
    event.preventDefault()
    event.stopPropagation()
    canvas.deleteItems([...sel])
  }

  useEventListener(window, 'keydown', onKeyDown)
}
