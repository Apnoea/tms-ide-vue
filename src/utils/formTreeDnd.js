// Чистые хелперы drag-and-drop для дерева форм (FormTree). Без DOM — вся геометрия
// (какая строка под курсором, доля по высоте) считается в компоненте, сюда приходят
// уже числа. Логика цели/зоны и guard циклов тестируются в изоляции.

/**
 * id узла + все его потомки (Set). Для DnD: цель drop'а не может лежать внутри
 * перетаскиваемого поддерева (иначе цикл). Орфан (формы нет в дереве) → {id}.
 *
 * @param {{ id: string, children?: any[] }[]} tree
 * @param {string} id
 * @returns {Set<string>}
 */
export function subtreeIds(tree, id) {
  const ids = new Set()
  const collect = (n) => {
    ids.add(n.id)
    ;(n.children || []).forEach(collect)
  }
  const find = (list) => {
    for (const n of list) {
      if (n.id === id) return n
      const f = find(n.children || [])
      if (f) return f
    }
    return null
  }
  const node = find(tree || [])
  if (node) collect(node)
  else ids.add(id) // орфан — сам себе поддерево
  return ids
}

/**
 * Цель и зона drop'а по строке под курсором. Зоны по трети высоты строки:
 * before / inside / after. null — бросать сюда нельзя (мимо строк, заголовок
 * группы, либо строка из перетаскиваемого поддерева).
 *
 * @param {{ kind: string, id?: string }[]} rows — плоский список строк дерева
 * @param {number} overIndex — индекс строки под курсором
 * @param {number} fraction — позиция курсора внутри строки: 0 (верх) … 1 (низ)
 * @param {Set<string>} invalidIds — куда нельзя (перетаскиваемый узел + его поддерево)
 * @returns {{ targetId: string, zone: 'before'|'inside'|'after' } | null}
 */
export function computeDrop(rows, overIndex, fraction, invalidIds) {
  const row = rows[overIndex]
  if (!row || row.kind !== 'form') return null // мимо / заголовок «Без иерархии»
  if (invalidIds.has(row.id)) return null // своё же поддерево
  const zone = fraction < 1 / 3 ? 'before' : fraction > 2 / 3 ? 'after' : 'inside'
  return { targetId: row.id, zone }
}
