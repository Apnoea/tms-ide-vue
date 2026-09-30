// Замер текста canvas-метрикой — для hit-area подписи и её bbox в редакторе. Семейство —
// через `normalizeFont` (constants/text), тот же whitelist, что уходит в font-family.
import { normalizeFont } from '../constants/text'

// Один canvas на модуль (а не detached canvas на каждый замер).
let ctx = null
function measureCtx() {
  if (!ctx && typeof document !== 'undefined') {
    ctx = document.createElement('canvas').getContext('2d')
  }
  return ctx
}

/** Ширина строки в px. `fallback` — когда canvas недоступен (SSR, jsdom). */
export function measureTextWidth(text, fontSize, bold = false, fallback = 0, font) {
  const c = measureCtx()
  if (!c) return fallback
  c.font = `${bold ? 'bold ' : ''}${fontSize}px ${normalizeFont(font)}`
  return c.measureText(text || '').width
}
