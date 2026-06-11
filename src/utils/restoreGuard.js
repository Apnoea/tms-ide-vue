/**
 * Выполняет `fn` под взведённым флагом `restoringHistory`: пока идёт массовая
 * мутация графа (fromJSON / clear / reinject), snapshot / autosave / undo не
 * должны срабатывать. try/finally гарантирует сброс флага даже если `fn` бросит —
 * без него флаг залип бы навсегда и заблокировал undo / snapshot / autosave.
 * Исключение пробрасывается дальше (caller сам решает, как реагировать).
 * Возвращает результат `fn`.
 *
 * @template T
 * @param {{ value: boolean }} flag — общий restoringHistory-ref
 * @param {() => T} fn — мутация графа под защитой
 * @returns {T}
 */
export function withRestoreGuard(flag, fn) {
  flag.value = true
  try {
    return fn()
  } finally {
    flag.value = false
  }
}
