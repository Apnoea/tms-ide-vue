import { ref, watch, nextTick } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { getStencilById } from '../stencils/registry'
import { injectStencilSvg } from '../stencils/svgInjector'
import { TEXT_FONT_SIZE, TEXT_PADDING_X, textCellSize, resizeTextCell } from '../stencils/textCell'
import { normalizeFont } from '../utils/textMetrics'
import { useCanvas } from './useCanvas'

/**
 * Edit-in-place для cell_text: double-click открывает HTML-overlay поверх
 * SVG-text'а (тот прячется на время правки), ширина ячейки ресайзится под
 * печатаемый текст.
 *
 * Коммит на клик-вне ловим через `onClickOutside` — у <input> @blur не приходит
 * из-за JointJS preventDefault на pointerdown.
 *
 * `textEditing` (null | { id, original, style }) читают и другие места, чтобы
 * подавить свой UI на время правки.
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
    const { width: newCellW, height: newCellH } = textCellSize(tms, val)
    const currentW = cell.get('size').width
    if (newCellW !== currentW) {
      // resizeTextCell держит якорь (align): при center/right блок при печати
      // «уезжает» от выбранного края — поэтому ниже пересчитываем и left overlay.
      resizeTextCell(cell, newCellW, newCellH, tms.align)
      // bumpVersion реактивно перепозиционирует HTML × overlay.
      canvas.bumpVersion()
    }
    const scale = paper.scale().sx
    const tr = paper.translate()
    const pos = cell.get('position')
    textEditing.value = {
      ...editing,
      style: {
        ...editing.style,
        left: `${pos.x * scale + tr.tx + TEXT_PADDING_X * scale}px`,
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
    // Замок = read-only: inline-правка текста тоже под запретом (dblclick приходит
    // мимо paper.interactive, поэтому фильтруем здесь).
    if (tms.locked) return

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
        // Шрифт и цвет — как у подписи: ширину инпута мы считаем своей метрикой,
        // и под системным шрифтом текст в поле «прыгал» бы на коммите.
        fontFamily: normalizeFont(tms.fontFamily),
        color: tms.color || '#000',
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
    // Ресайз под новый текст — ширина адаптивная, высота под шрифт; якорь по align.
    const size = textCellSize(tms, newText)
    resizeTextCell(cell, size.width, size.height, tms.align)
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
