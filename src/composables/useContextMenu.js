import { ref, computed } from 'vue'
import { useCanvas } from './useCanvas'
import { nplural } from '../utils/plural'

/**
 * Контекстное меню холста (ПКМ). ctxTarget — что под кликом ({kind,id} либо null для
 * пустого места), пункты зависят от таргета: у ячейки дублировать / скопировать /
 * порядок / группировка / замок / удалить, у провода удалить, на пустом месте —
 * вставить. Все действия идут через selection (showContextMenu выделяет таргет),
 * поэтому ПКМ по элементу из выделения работает со всем выделением.
 */
export function useContextMenu({
  hasClipboard,
  pasteClipboard,
  copySelection,
  duplicateSelection,
  detachFromBus = () => false,
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
      // На члене группы — «Разгруппировать», при ≥2 выделенных без группы —
      // «Сгруппировать», иначе пункта нет.
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
      const items = [
        {
          label: 'Дублировать',
          icon: 'pi pi-copy',
          command: () => runOnTarget(t, duplicateSelection),
        },
        { label: 'Скопировать', icon: 'pi pi-clone', command: () => runOnTarget(t, copySelection) },
      ]
      const mid = [orderMenuItem(t), groupItem, busItem, lockItem].filter(Boolean)
      if (mid.length) items.push({ separator: true }, ...mid)
      items.push({ separator: true }, deleteItem(t))
      return items
    }
    if (t.kind === 'link') {
      // На пересечении мостик рисует верхний провод — так выбирают, кто поверх.
      return [orderMenuItem(t), { separator: true }, deleteItem(t)]
    }
    return []
  })

  /** Подменю «Порядок» (z) — общее для символов и проводов: слои разведены. */
  function orderMenuItem(target) {
    const cmd = (mode) => () =>
      runOnTarget(target, () => canvas.reorderCells(canvas.selection.value, mode))
    return {
      label: 'Порядок',
      icon: 'pi pi-clone',
      items: [
        { label: 'На передний план', icon: 'pi pi-angle-double-up', command: cmd('front') },
        { label: 'Выше', icon: 'pi pi-angle-up', command: cmd('forward') },
        { label: 'Ниже', icon: 'pi pi-angle-down', command: cmd('backward') },
        { label: 'На задний план', icon: 'pi pi-angle-double-down', command: cmd('back') },
      ],
    }
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
