import { ref, computed } from 'vue'
import { useCanvas } from './useCanvas'
import { getStencilById, stencilEditLabel } from '../stencils/registry'
import { nplural } from '../utils/plural'

/**
 * Контекстное меню холста (ПКМ). ctxTarget — что под кликом ({kind,id} либо null для
 * пустого места), пункты зависят от таргета: у ячейки дублировать / скопировать /
 * править символ / такие же / порядок / группировка / замок / удалить, у провода
 * порядок и удалить, на пустом месте — вставить / выделить всё / вписать. Все действия
 * идут через selection (showContextMenu выделяет таргет), поэтому ПКМ по элементу из
 * выделения работает со всем выделением.
 *
 * `shortcut` у пункта — клавиша того же действия (рисует её ContextMenuItem): меню —
 * место, где хоткеи узнают.
 */
export function useContextMenu({
  hasClipboard,
  pasteClipboard,
  copySelection,
  duplicateSelection,
  detachFromBus = () => false,
  editStencil = () => {},
  notify = { success: () => {} },
}) {
  const canvas = useCanvas()
  const ctxMenuRef = ref(null)
  const ctxTarget = ref(null)

  const ctxItems = computed(() => {
    const t = ctxTarget.value
    if (!t) return blankItems()

    const cell = canvas.graphRef.value?.getCell(t.id)
    if (!cell) return []

    if (t.kind === 'cell') {
      const locked = !!cell.get('tms')?.locked
      const selCellCount = canvas.selection.value.filter((i) => i.kind === 'cell').length
      const inGroup = !!cell.get('tms')?.groupId
      // На члене группы — «Разгруппировать», при ≥2 выделенных без группы —
      // «Сгруппировать», иначе пункта нет.
      const groupItem = inGroup
        ? {
            label: 'Разгруппировать',
            icon: 'pi pi-table',
            shortcut: 'Ctrl+Shift+G',
            command: () => {
              const n = canvas.ungroupCells(canvas.selection.value)
              if (n) notify.success('Разгруппировано', nplural(n, 'символ', 'символа', 'символов'))
            },
          }
        : selCellCount >= 2
          ? {
              label: 'Сгруппировать',
              icon: 'pi pi-th-large',
              shortcut: 'Ctrl+G',
              command: () => {
                const n = canvas.groupCells(canvas.selection.value)
                if (n) notify.success('Сгруппировано', nplural(n, 'символ', 'символа', 'символов'))
              },
            }
          : null
      // Замок работает на всё выделение (хоть одна свободна → лочим все), поэтому
      // доступен и в мультивыделении, и на группе. Overlay-кнопка остаётся
      // одиночной: она позиционируется по AABB одной ячейки.
      const lockItem = lockMenuItem(t, locked, selCellCount)
      // «Снять с шины» — только на закреплённом символе: жест обратный присоединению
      // (см. useBusSnap.detachFromBus), сам символ остаётся на месте.
      const busItem = cell.get('tms')?.busId
        ? {
            label: 'Снять с шины',
            icon: 'pi pi-arrow-down-left',
            command: () =>
              runOnTarget(t, () => {
                let n = 0
                for (const item of canvas.selection.value) {
                  if (item.kind !== 'cell') continue
                  const c = canvas.graphRef.value?.getCell(item.id)
                  if (c && detachFromBus(c)) n += 1
                }
                if (n) notify.success('Снято с шины', nplural(n, 'символ', 'символа', 'символов'))
              }),
          }
        : null
      // Иконки дублирования и копирования — те же, что у палитры, дерева форм и блоков
      // анимаций: один жест — один знак во всём интерфейсе.
      const items = [
        {
          label: 'Дублировать',
          icon: 'pi pi-clone',
          shortcut: 'Ctrl+D',
          command: () => runOnTarget(t, duplicateSelection),
        },
        {
          label: 'Скопировать',
          icon: 'pi pi-copy',
          shortcut: 'Ctrl+C',
          command: () => runOnTarget(t, copySelection),
        },
      ]
      const stencil = stencilItems(cell)
      if (stencil.length) items.push({ separator: true }, ...stencil)
      const mid = [orderMenuItem(t), groupItem, busItem, lockItem].filter(Boolean)
      if (mid.length) items.push({ separator: true }, ...mid)
      items.push({ separator: true }, deleteItem(t))
      return items
    }
    if (t.kind === 'link') {
      // На пересечении мостик рисует верхний провод — так выбирают, кто поверх.
      const order = orderMenuItem(t)
      return [...(order ? [order, { separator: true }] : []), deleteItem(t)]
    }
    return []
  })

  /**
   * Подменю «Порядок» (z) — общее для символов и проводов: слои разведены. null, когда
   * двигать нечего: у заблокированных `z` не меняется (reorderCells их отсеивает), и
   * пункт вёл бы в никуда.
   */
  function orderMenuItem(target) {
    const targets = canvas.isSelected(target.id) ? canvas.selection.value : [target]
    if (!canvas.writableItems(targets).length) return null
    const cmd = (mode) => () =>
      runOnTarget(target, () => canvas.reorderCells(canvas.selection.value, mode))
    return {
      label: 'Порядок',
      icon: 'pi pi-sort-alt',
      items: [
        {
          label: 'На передний план',
          icon: 'pi pi-angle-double-up',
          shortcut: 'Ctrl+Shift+]',
          command: cmd('front'),
        },
        { label: 'Выше', icon: 'pi pi-angle-up', shortcut: 'Ctrl+]', command: cmd('forward') },
        { label: 'Ниже', icon: 'pi pi-angle-down', shortcut: 'Ctrl+[', command: cmd('backward') },
        {
          label: 'На задний план',
          icon: 'pi pi-angle-double-down',
          shortcut: 'Ctrl+Shift+[',
          command: cmd('back'),
        },
      ],
    }
  }

  /**
   * Пустое место: вставить (если в буфере что-то есть) и действия над всей формой.
   * Пустое меню не открывается вовсе (см. showContextMenu).
   */
  function blankItems() {
    const items = []
    if (hasClipboard()) {
      items.push({
        label: 'Вставить',
        icon: 'pi pi-clipboard',
        shortcut: 'Ctrl+V',
        command: pasteClipboard,
      })
    }
    if (canvas.graphRef.value?.getElements().length) {
      if (items.length) items.push({ separator: true })
      items.push(
        {
          label: 'Выделить всё',
          icon: 'pi pi-check-square',
          shortcut: 'Ctrl+A',
          command: () => canvas.selectAllCells(),
        },
        {
          label: 'Вписать в экран',
          icon: 'pi pi-expand',
          shortcut: 'Ctrl+0',
          command: () => canvas.fitToContent(),
        }
      )
    }
    return items
  }

  /**
   * Пункты про СИМВОЛ под курсором, а не про выделение: открыть его в редакторе (режим
   * и подпись — как у карандаша в палитре) и выделить все его экземпляры на форме. У
   * фигуры разметки символа нет — пунктов тоже.
   */
  function stencilItems(cell) {
    const stencil = getStencilById(cell.get('tms')?.stencilId)
    if (!stencil) return []
    const items = []
    const editLabel = stencilEditLabel(stencil)
    if (editLabel) {
      items.push({ label: editLabel, icon: 'pi pi-pencil', command: () => editStencil(stencil.id) })
    }
    const same = canvas.cellsOfStencil(stencil.id).length
    if (same > 1) {
      items.push({
        label: `Выделить такие же (${same})`,
        icon: 'pi pi-search-plus',
        command: () => canvas.selectSameStencil(stencil.id),
      })
    }
    return items
  }

  /**
   * Цели удаления: ПКМ по элементу ИЗ выделения удаляет всё выделение (как Del и
   * остальные пункты меню, работающие через selection); по невыделенному — только он.
   */
  function deleteTargets(target) {
    const sel = canvas.selection.value
    return sel.some((i) => i.id === target.id) ? sel : [target]
  }

  /**
   * Пункт замка. Направление — как у toggleLocked: есть свободная ячейка → лочим.
   * Счётчик в label показывает, что операция затронет всё выделение.
   */
  function lockMenuItem(target, targetLocked, selCellCount) {
    const graph = canvas.graphRef.value
    const cells = canvas.selection.value
      .filter((i) => i.kind === 'cell')
      .map((i) => graph?.getCell(i.id))
      .filter(Boolean)
    // Меню по невыделенной ячейке — решает её собственный замок (выделит runOnTarget).
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
      shortcut: 'Del',
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
