import { computed } from 'vue'
import { useLocalStorage } from '@vueuse/core'

/**
 * Недавно выбранные цвета — быстрый возврат к тому, чем красили только что.
 *
 * Настройка ОКРУЖЕНИЯ, не проекта: это привычка автора, а не свойство схемы, поэтому
 * localStorage (как раскрытые категории палитры), а не мета проекта. Список общий на
 * все поля цвета: цвет подбирают в одном месте, а применяют в нескольких.
 */

/** Свотчей ровно столько, сколько влезает в ряд рядом с полем кода. */
export const RECENT_MAX = 4
const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** Годные значения: хранилище правится руками и переживает смену версий. */
export function sanitizeRecentColors(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => typeof c === 'string' && HEX_RE.test(c))
    .map((c) => c.toLowerCase())
    .slice(0, RECENT_MAX)
}

/** Цвет встаёт первым, повтор поднимается, лишние вытесняются. Не hex — список как был. */
export function withRecentColor(list, color) {
  const clean = sanitizeRecentColors(list)
  if (typeof color !== 'string' || !HEX_RE.test(color)) return clean
  const hex = color.toLowerCase()
  return [hex, ...clean.filter((c) => c !== hex)].slice(0, RECENT_MAX)
}

const stored = useLocalStorage('tms.recentColors', [])

export function useRecentColors() {
  const recentColors = computed(() => sanitizeRecentColors(stored.value))

  function pushRecentColor(color) {
    stored.value = withRecentColor(stored.value, color)
  }

  return { recentColors, pushRecentColor }
}
