// Обёртки массовой правки графа (fromJSON / clear / reinject): на время правки молчат
// история и автосейв, paper не перерисовывает каждую ячейку. Обе снимают своё
// состояние в finally — залипший флаг или freeze ломали бы редактор молча.

/**
 * Выполняет синхронную `fn` под взведённым `restoringHistory`: snapshot, autosave и undo
 * на это время молчат. Флаг сбрасывается к ПРЕДЫДУЩЕМУ значению — иначе вложенный вызов
 * снял бы его у внешнего. Исключение пробрасывается дальше.
 *
 * @template T
 * @param {{ value: boolean }} flag — общий restoringHistory-ref
 * @param {() => T} fn — мутация графа под защитой
 * @returns {T}
 */
export function withRestoreGuard(flag, fn) {
  const prev = flag.value
  flag.value = true
  try {
    return fn()
  } finally {
    flag.value = prev
  }
}

/**
 * Пакетная ЗАГРУЗКА графа: paper не перерисовывает view, пока в модель валятся сотни
 * ячеек (`graph.fromJSON`).
 *
 * ВНУТРЬ НЕЛЬЗЯ заворачивать инъекцию разметки (всё, что ходит через
 * `paper.findViewByModel`): у замороженного paper'а представлений новых ячеек нет,
 * инъекция молча пропускается, и ячейки остаются с пустым `body`. Порядок —
 * заморозка на `fromJSON`, инъекция после.
 *
 * `unfreeze` в finally: залипший freeze = правки идут в модель, на экране ничего.
 * Методы опциональны — в тестах paper это мок.
 */
export function withPaperFrozen(paper, fn) {
  paper?.freeze?.()
  try {
    return fn()
  } finally {
    paper?.unfreeze?.()
  }
}
