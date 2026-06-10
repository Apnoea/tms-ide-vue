// Длительности toast-уведомлений. Конвенция:
//   SHORT  — короткое подтверждение действия (скопировано, вставлено, autosave-flash)
//   NORMAL — информация (tag-list загружен, экспорт готов, схема очищена)
//   LONG   — ошибки и предупреждения, требующие внимания (permission, parse-fail)

export const TOAST_LIFE = {
  SHORT: 2000,
  NORMAL: 3000,
  LONG: 5000,
}
