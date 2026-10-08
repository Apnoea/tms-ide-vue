/**
 * Длительности движения интерфейса, мс — те же три, что CSS-токены `--tms-dur-*` в
 * style.css (менять парой): fast — ховер, нажатие, проявление; move — перемещение;
 * slow — сворачивание и сдвиг камеры холста.
 */
export const MOTION_MS = { fast: 120, move: 160, slow: 200 }

/**
 * Система просит обходиться без анимации — движение заменяется мгновенным переходом
 * (в CSS тот же запрос обслуживает блок `prefers-reduced-motion` в style.css).
 */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}
