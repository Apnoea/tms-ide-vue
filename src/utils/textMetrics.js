// Замер текста canvas-метрикой: SVG-рендер она повторяет не точно, но достаточно,
// чтобы обтягивать подпись hit-area (cell_text) и считать bbox текста в редакторе
// символов. Шрифт задаётся ОДНОЙ константой и обязан совпадать с тем, что уходит в
// `font-family` экспортного SVG, — иначе замер разойдётся с реальным рендером.

/** Шрифт SVG-текста (подписи символов, cell_text, cell_value) — один на проект. */
export const SVG_FONT = 'sans-serif'

// Один canvas на модуль — иначе detached canvas на каждый замер.
let ctx = null
function measureCtx() {
  if (!ctx && typeof document !== 'undefined') {
    ctx = document.createElement('canvas').getContext('2d')
  }
  return ctx
}

/** Ширина строки в px. `fallback` — когда canvas недоступен (SSR, jsdom). */
export function measureTextWidth(text, fontSize, bold = false, fallback = 0) {
  const c = measureCtx()
  if (!c) return fallback
  c.font = `${bold ? 'bold ' : ''}${fontSize}px ${SVG_FONT}`
  return c.measureText(text || '').width
}
