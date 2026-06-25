import { ref, computed } from 'vue'
import { useCanvas } from './useCanvas'

/**
 * Контекстное меню холста (ПКМ). ctxTarget — что под кликом ({kind,id} | null
 * для пустого места). Пункты вычисляются по таргету: ячейка — дублировать /
 * скопировать / удалить, провод — удалить, пустое место — вставить (если в
 * буфере что-то есть). showContextMenu выделяет таргет (если не выделен) и
 * показывает меню; вызывается из paper-contextmenu-событий в CanvasPane.
 * ctxMenuRef биндится на <ContextMenu ref> в шаблоне.
 */
export function useContextMenu({
  hasClipboard,
  pasteClipboard,
  copySelection,
  duplicateSelection,
}) {
  const canvas = useCanvas()
  const ctxMenuRef = ref(null)
  const ctxTarget = ref(null)

  const ctxItems = computed(() => {
    const t = ctxTarget.value
    // Пустое место: только paste, и только если в буфере что-то есть.
    if (!t) {
      if (!hasClipboard()) return []
      return [{ label: 'Вставить', icon: 'pi pi-clone', command: pasteClipboard }]
    }

    const cell = canvas.graphRef.value?.getCell(t.id)
    if (!cell) return []

    if (t.kind === 'cell') {
      return [
        {
          label: 'Дублировать',
          icon: 'pi pi-copy',
          command: () => runOnTarget(t, duplicateSelection),
        },
        { label: 'Скопировать', icon: 'pi pi-clone', command: () => runOnTarget(t, copySelection) },
        { separator: true },
        { label: 'Удалить', icon: 'pi pi-trash', command: () => canvas.deleteItems([t]) },
      ]
    }
    if (t.kind === 'link') {
      return [{ label: 'Удалить', icon: 'pi pi-trash', command: () => canvas.deleteItems([t]) }]
    }
    return []
  })

  /** Выделяет target (если не выделен) и запускает функцию, работающую через selection. */
  function runOnTarget(target, fn) {
    if (!canvas.isSelected(target.id)) canvas.selectOnly(target.kind, target.id)
    fn()
  }

  /** Показать меню для таргета. Выделяет его, если не был выделен (editor-pattern). */
  function showContextMenu(target, evt) {
    if (target && !canvas.isSelected(target.id)) canvas.selectOnly(target.kind, target.id)
    ctxTarget.value = target
    // Пустое меню (blank-клик с пустым буфером) не показываем — PrimeVue
    // ContextMenu при пустом items всё равно рисует контейнер.
    if (!ctxItems.value.length) return
    ctxMenuRef.value?.show(evt)
    // JointJS обычно сам preventDefault'ит, но дублируем на всякий случай.
    if (evt && typeof evt.preventDefault === 'function') evt.preventDefault()
  }

  return { ctxMenuRef, ctxItems, showContextMenu }
}
