/**
 * Выполняет синхронную `fn` под взведённым `restoringHistory`: на время массовой
 * мутации графа (fromJSON / clear / reinject) snapshot, autosave и undo молчат.
 * Флаг сбрасывается в finally к ПРЕДЫДУЩЕМУ значению — иначе вложенный вызов снял
 * бы его у внешнего. Исключение пробрасывается дальше.
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
