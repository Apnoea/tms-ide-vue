// Замер текста canvas-метрикой — для hit-area подписи и её bbox в редакторе. Замер
// обязан идти ТЕМ ЖЕ семейством, что уходит в font-family, иначе габарит разойдётся
// с рендером.

/**
 * Только CSS-generic: конкретный шрифт панель WebScada может не найти и подменить,
 * сломав метрики. Цена — гарнитуру под generic-именем выбирает ОС, поэтому ширины
 * IDE и панели расходятся на единицы процентов. Список — whitelist (значение
 * приходит из чужого архива).
 */
export const FONT_FAMILIES = [
  { value: 'sans-serif', label: 'Без засечек' },
  { value: 'serif', label: 'С засечками' },
  { value: 'monospace', label: 'Моноширинный' },
]

/** Шрифт по умолчанию (и он же — fallback для чужих значений). */
export const SVG_FONT = 'sans-serif'

/** Значение из whitelist или дефолт. Единая точка проверки для рендера и замера. */
export function normalizeFont(font) {
  return FONT_FAMILIES.some((f) => f.value === font) ? font : SVG_FONT
}

// Один canvas на модуль (а не detached canvas на каждый замер).
let ctx = null
function measureCtx() {
  if (!ctx && typeof document !== 'undefined') {
    ctx = document.createElement('canvas').getContext('2d')
  }
  return ctx
}

/** Ширина строки в px. `fallback` — когда canvas недоступен (SSR, jsdom). */
export function measureTextWidth(text, fontSize, bold = false, fallback = 0, font = SVG_FONT) {
  const c = measureCtx()
  if (!c) return fallback
  c.font = `${bold ? 'bold ' : ''}${fontSize}px ${normalizeFont(font)}`
  return c.measureText(text || '').width
}
