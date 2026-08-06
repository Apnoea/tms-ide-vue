// Замер текста canvas-метрикой: SVG-рендер повторяет не точно, но достаточно для
// hit-area cell_text и bbox подписи в редакторе. Замер обязан идти ТЕМ ЖЕ
// семейством, что уходит в font-family, иначе габарит разойдётся с рендером.

/**
 * Только CSS-generic: конкретный шрифт панель WebScada может не найти и молча
 * подменить, сломав метрики. Расплата — гарнитуру под generic-именем выбирает ОС,
 * поэтому ширины IDE и панели расходятся на единицы процентов (для cell_text это
 * добито `textLength` в экспорте). Список — whitelist: значение из чужого архива.
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

// Один canvas на модуль — иначе detached canvas на каждый замер.
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
