import { useToast } from 'primevue/usetoast'

/**
 * Длительности toast-уведомлений. Конвенция:
 *   SHORT  — короткое подтверждение действия (скопировано, вставлено)
 *   NORMAL — информация (tag-list загружен, экспорт готов, схема очищена)
 *   LONG   — предупреждения, требующие внимания (permission, parse-fail)
 *
 * Используются как override 3-м аргументом notify.* когда дефолт по severity
 * не подходит (сами дефолты по severity — в DEFAULT_LIFE ниже). У ошибок срока нет.
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
 *
 * Ошибка не скрывается сама, висит до крестика: почти все они про потерю данных или
 * сорванную операцию, и пропустить такую нельзя. Поэтому `life` у error не читается —
 * тост PrimeVue без срока сам не закрывается.
 */
const DEFAULT_LIFE = {
  success: TOAST_LIFE.SHORT,
  info: TOAST_LIFE.NORMAL,
  warn: TOAST_LIFE.NORMAL,
}

export function useNotify() {
  const toast = useToast()
  const make = (severity) => (summary, detail, life) =>
    toast.add({
      severity,
      summary,
      detail,
      life: severity === 'error' ? undefined : (life ?? DEFAULT_LIFE[severity]),
    })
  return {
    success: make('success'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
  }
}
