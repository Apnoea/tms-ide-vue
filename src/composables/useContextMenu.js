import { ref, computed } from 'vue'
import { useCanvas } from './useCanvas'
import { nplural } from '../utils/plural'

/**
 * Контекстное меню холста (ПКМ). ctxTarget — что под кликом ({kind,id} | null
 * для пустого места). Пункты вычисляются по таргету: ячейка — дублировать /
 * скопировать / порядок / группировка / замок / удалить, провод — удалить, пустое
 * место — вставить (если в буфере что-то есть). Все действия идут через selection
 * (showContextMenu выделяет таргет, если тот не был выделен), поэтому ПКМ по
 * элементу из выделения работает со всем выделением. Вызывается из
 * paper-contextmenu-событий в CanvasPane; ctxMenuRef биндится на <ContextMenu ref>.
 */
export function useContextMenu({
  hasClipboard,
  pasteClipboard,
  copySelection,
  duplicateSelection,
  notify = { success: () => {} },
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
      const locked = !!cell.get('tms')?.locked
      const selCellCount = canvas.selection.value.filter((i) => i.kind === 'cell').length
      const inGroup = !!cell.get('tms')?.groupId
      // Группировка: на члене группы — «Разгруппировать»; при ≥2 выделенных без
      // группы — «Сгруппировать»; иначе пункт не показываем.
      const groupItem = inGroup
        ? {
            label: 'Разгруппировать',
            icon: 'pi pi-table',
            command: () => {
              const n = canvas.ungroupCells(canvas.selection.value)
              if (n) notify.success('Разгруппировано', nplural(n, 'символ', 'символа', 'символов'))
            },
          }
        : selCellCount >= 2
          ? {
              label: 'Сгруппировать',
              icon: 'pi pi-th-large',
              command: () => {
                const n = canvas.groupCells(canvas.selection.value)
                if (n) notify.success('Сгруппировано', nplural(n, 'символ', 'символа', 'символов'))
              },
            }
          : null
      // Замок работает на всё выделение (toggleLocked: хоть одна свободна → лочим
      // все), поэтому и в мультивыделении, и на группе пункт доступен — иначе
      // подложку из десятка символов пришлось бы лочить по одному. Overlay-кнопка
      // остаётся одиночной: она позиционируется по AABB одной ячейки.
      const lockItem = lockMenuItem(t, locked, selCellCount)
      // Порядок наложения (z): подменю для выделенных ячеек. Провода всегда сзади.
      const orderItem = {
        label: 'Порядок',
        icon: 'pi pi-clone',
        items: [
          {
            label: 'На передний план',
            icon: 'pi pi-angle-double-up',
            command: () =>
              runOnTarget(t, () => canvas.reorderCells(canvas.selection.value, 'front')),
          },
          {
            label: 'Выше',
            icon: 'pi pi-angle-up',
            command: () =>
              runOnTarget(t, () => canvas.reorderCells(canvas.selection.value, 'forward')),
          },
          {
            label: 'Ниже',
            icon: 'pi pi-angle-down',
            command: () =>
              runOnTarget(t, () => canvas.reorderCells(canvas.selection.value, 'backward')),
          },
          {
            label: 'На задний план',
            icon: 'pi pi-angle-double-down',
            command: () =>
              runOnTarget(t, () => canvas.reorderCells(canvas.selection.value, 'back')),
          },
        ],
      }
      const items = [
        {
          label: 'Дублировать',
          icon: 'pi pi-copy',
          command: () => runOnTarget(t, duplicateSelection),
        },
        { label: 'Скопировать', icon: 'pi pi-clone', command: () => runOnTarget(t, copySelection) },
      ]
      const mid = [orderItem, groupItem, lockItem].filter(Boolean)
      if (mid.length) items.push({ separator: true }, ...mid)
      items.push({ separator: true }, deleteItem(t))
      return items
    }
    if (t.kind === 'link') {
      return [deleteItem(t)]
    }
    return []
  })

  /**
   * Цели удаления: ПКМ по элементу ИЗ выделения удаляет всё выделение (как Del и как
   * остальные пункты этого меню, работающие через selection) — раньше удалялся один
   * элемент под курсором. По невыделенному — только он.
   */
  function deleteTargets(target) {
    const sel = canvas.selection.value
    return sel.some((i) => i.id === target.id) ? sel : [target]
  }

  /**
   * Пункт замка. Направление действия — как у toggleLocked: пока в выделении есть
   * хоть одна свободная ячейка, пункт лочит (а не разлочивает наполовину). Счётчик
   * в label при нескольких целях — видно, что операция затронет всех.
   */
  function lockMenuItem(target, targetLocked, selCellCount) {
    const graph = canvas.graphRef.value
    const cells = canvas.selection.value
      .filter((i) => i.kind === 'cell')
      .map((i) => graph?.getCell(i.id))
      .filter(Boolean)
    // Меню могли открыть по невыделенной ячейке — тогда решает её собственный замок
    // (выделит её runOnTarget уже на выполнении команды).
    const lock = cells.length ? cells.some((c) => !c.get('tms')?.locked) : !targetLocked
    const n = Math.max(selCellCount, 1)
    const suffix = n > 1 ? ` (${n})` : ''
    return {
      label: (lock ? 'Заблокировать' : 'Разблокировать') + suffix,
      icon: lock ? 'pi pi-lock' : 'pi pi-unlock',
      command: () => runOnTarget(target, () => canvas.toggleLocked(canvas.selection.value)),
    }
  }

  /** Пункт «Удалить»; счётчик в label при нескольких целях (locked не удаляются). */
  function deleteItem(target) {
    const targets = deleteTargets(target)
    const count = canvas.writableItems(targets).length
    return {
      label: count > 1 ? `Удалить (${count})` : 'Удалить',
      icon: 'pi pi-trash',
      command: () => canvas.deleteItems(targets),
    }
  }

  /** Выделяет target (если не выделен) и запускает функцию, работающую через selection. */
  function runOnTarget(target, fn) {
    if (!canvas.isSelected(target.id)) selectTarget(target)
    fn()
  }

  /** Выделить target; член группы — выделяем всю группу целиком (expandGroups). */
  function selectTarget(target) {
    if (target.kind === 'cell') {
      const grp = canvas.expandGroups([{ kind: 'cell', id: target.id }])
      if (grp.length > 1) {
        canvas.setSelection(grp)
        return
      }
    }
    canvas.selectOnly(target.kind, target.id)
  }

  /** Показать меню для таргета. Выделяет его, если не был выделен (editor-pattern). */
  function showContextMenu(target, evt) {
    if (target && !canvas.isSelected(target.id)) selectTarget(target)
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
