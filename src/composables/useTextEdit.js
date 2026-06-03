import { ref, watch, nextTick } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { getStencilById } from '../stencils/registry'
import {
  injectStencilSvg,
  TEXT_FONT_SIZE,
  TEXT_PADDING_X,
  textCellHeight,
  textCellWidth,
} from '../stencils/svgInjector'
import { useCanvas } from './useCanvas'

/**
 * Edit-in-place для cell_text: double-click открывает HTML-overlay
 * <input type="text"> поверх SVG-text'а. На время edit'а SVG-text прячется
 * (visibility:hidden), на commit/cancel — восстанавливается. Ширина ячейки
 * адаптивно ресайзится под печатаемый текст в реальном времени.
 *
 * Коммит на клик-вне ловим через `onClickOutside(textEditorRef)` — у самого
 * <input> @blur не срабатывает из-за JointJS preventDefault на pointerdown.
 *
 * Возвращает:
 *  • `textEditing` (Ref) — `null` либо `{ id, original, style }`. Шаблон
 *    рендерит overlay по `v-if="textEditing"`. Другие места (hover-tooltip,
 *    delete-button) читают для подавления своих UI на время edit'а.
 *  • `textEditValue` (Ref<string>) — `v-model` overlay-инпута.
 *  • `textEditorRef` (Ref) — template ref на overlay-инпут (нужен для focus
 *    + onClickOutside).
 *  • `startTextEdit(cellId)` — открывает overlay (зовётся из paper.on dblclick).
 *  • `commitTextEdit` / `cancelTextEdit` — @keydown.enter / @keydown.esc.
 */
export function useTextEdit({ scheduleSnapshot }) {
  const canvas = useCanvas()
  const textEditing = ref(null) // { id, original, style }
  const textEditValue = ref('')
  const textEditorRef = ref(null)

  // Live-resize ячейки пока юзер печатает. cell.resize не дёргает snapshot —
  // финальный snapshot снимется на commit.
  watch(textEditValue, (val) => {
    const editing = textEditing.value
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!editing || !paper) return
    const cell = graph?.getCell(editing.id)
    if (!cell) return
    const tms = cell.get('tms') || {}
    const fz = tms.fontSize ?? TEXT_FONT_SIZE
    const newCellW = textCellWidth(val, fz, !!tms.bold)
    const currentW = cell.get('size').width
    if (newCellW !== currentW) {
      cell.resize(newCellW, textCellHeight(fz))
      // bumpVersion реактивно перепозиционирует HTML × overlay.
      canvas.bumpVersion()
    }
    const scale = paper.scale().sx
    textEditing.value = {
      ...editing,
      style: {
        ...editing.style,
        width: `${Math.max(40, newCellW * scale - TEXT_PADDING_X * scale)}px`,
      },
    }
  })

  function findCellTextEl(cellId) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    const cell = graph?.getCell(cellId)
    if (!cell || !paper) return null
    const cellView = paper.findViewByModel(cell)
    return cellView?.el?.querySelector('text') ?? null
  }

  function startTextEdit(cellId) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return
    const cell = graph.getCell(cellId)
    if (!cell) return
    const tms = cell.get('tms') || {}
    if (tms.stencilId !== 'cell_text') return

    const pos = cell.get('position')
    const size = cell.get('size')
    const scale = paper.scale().sx
    const tr = paper.translate()
    const fontSize = tms.fontSize ?? TEXT_FONT_SIZE

    textEditValue.value = tms.text ?? ''
    textEditing.value = {
      id: cellId,
      original: tms.text ?? '',
      style: {
        left: `${pos.x * scale + tr.tx + TEXT_PADDING_X * scale}px`,
        top: `${pos.y * scale + tr.ty}px`,
        width: `${Math.max(40, size.width * scale - TEXT_PADDING_X * scale)}px`,
        height: `${size.height * scale}px`,
        fontSize: `${fontSize * scale}px`,
        fontWeight: tms.bold ? 'bold' : 'normal',
      },
    }

    // Прячем SVG-текст, чтобы не просвечивал сквозь прозрачный input.
    findCellTextEl(cellId)?.style.setProperty('visibility', 'hidden')

    nextTick(() => textEditorRef.value?.focus())
  }

  function commitTextEdit() {
    const editing = textEditing.value
    if (!editing) return
    textEditing.value = null

    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    const cell = graph?.getCell(editing.id)
    // Восстановить видимость SVG-текста независимо от того, был ли изменён текст:
    // при re-inject ниже элемент пересоздаётся, и атрибут визуально сбрасывается;
    // если re-inject не происходит — без restore остался бы скрытым.
    findCellTextEl(editing.id)?.style.removeProperty('visibility')
    if (!cell) return

    const tms = cell.get('tms') || {}
    const stencil = getStencilById(tms.stencilId)
    const newText = textEditValue.value
    if (!stencil || newText === editing.original) return

    cell.set('tms', { ...tms, text: newText })
    // Ресайз под новый текст — ширина адаптивная, высота под шрифт.
    const fz = tms.fontSize ?? TEXT_FONT_SIZE
    cell.resize(textCellWidth(newText, fz, !!tms.bold), textCellHeight(fz))
    const cellView = paper?.findViewByModel(cell)
    if (cellView) injectStencilSvg(cellView, stencil)
    canvas.bumpVersion()
    scheduleSnapshot()
  }

  function cancelTextEdit() {
    const editing = textEditing.value
    if (!editing) return
    textEditing.value = null
    findCellTextEl(editing.id)?.style.removeProperty('visibility')
  }

  // Коммит текста при клике мимо input'а. JointJS preventDefault'ит pointerdown,
  // поэтому @blur не срабатывает — ловим клик через onClickOutside.
  onClickOutside(textEditorRef, () => {
    if (textEditing.value) commitTextEdit()
  })

  return {
    textEditing,
    textEditValue,
    textEditorRef,
    startTextEdit,
    commitTextEdit,
    cancelTextEdit,
  }
}
