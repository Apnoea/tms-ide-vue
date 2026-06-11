import { useToast } from 'primevue/usetoast'

/**
 * Длительности toast-уведомлений. Конвенция:
 *   SHORT  — короткое подтверждение действия (скопировано, вставлено, autosave-flash)
 *   NORMAL — информация (tag-list загружен, экспорт готов, схема очищена)
 *   LONG   — ошибки и предупреждения, требующие внимания (permission, parse-fail)
 *
 * Используются как override 3-м аргументом notify.* когда дефолт по severity
 * не подходит (сами дефолты по severity — в DEFAULT_LIFE ниже).
 */
export const TOAST_LIFE = {
  SHORT: 2000,
  NORMAL: 3000,
  LONG: 5000,
}

/**
 * Тонкая обёртка над PrimeVue `useToast` со стандартными default-длительностями
 * по severity. Если life не подходит — передаётся 3-м аргументом.
 *
 *   notify.warn('Tag-list', 'Файл пуст')                  // default NORMAL
 *   notify.success('Готово', 'детали', TOAST_LIFE.LONG)   // override
 */
const DEFAULT_LIFE = {
  success: TOAST_LIFE.SHORT,
  info: TOAST_LIFE.NORMAL,
  warn: TOAST_LIFE.NORMAL,
  error: TOAST_LIFE.LONG,
}

export function useNotify() {
  const toast = useToast()
  const make = (severity) => (summary, detail, life) =>
    toast.add({ severity, summary, detail, life: life ?? DEFAULT_LIFE[severity] })
  return {
    success: make('success'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
  }
}
