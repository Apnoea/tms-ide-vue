import Tooltip from 'primevue/tooltip'

/**
 * Задержка показа подсказки, мс. Без неё тултип всплывал через ~45 мс: мышь, идущая
 * через тулбар, зажигала подсказки одну за другой. 400 — та же задержка, что была у
 * превью символа в палитре.
 */
export const TOOLTIP_SHOW_DELAY = 400

/**
 * Значение директивы с задержкой. Строка становится объектной формой PrimeVue;
 * явный `showDelay` у вызывающего не трогаем. Пустое значение (подсказки нет) — как есть.
 */
export function withShowDelay(value) {
  if (!value) return value
  if (typeof value === 'string') return { value, showDelay: TOOLTIP_SHOW_DELAY }
  return value.showDelay === undefined ? { ...value, showDelay: TOOLTIP_SHOW_DELAY } : value
}

const HOOKS = [
  'created',
  'beforeMount',
  'mounted',
  'beforeUpdate',
  'updated',
  'beforeUnmount',
  'unmounted',
]

/**
 * `v-tooltip` приложения: штатная директива PrimeVue, но с задержкой по умолчанию. Обёртка
 * над хуками, а не правка каждого места: подсказок больше сотни, и новая получает
 * задержку сама.
 */
export const DelayedTooltip = Object.fromEntries(
  HOOKS.filter((hook) => Tooltip[hook]).map((hook) => [
    hook,
    (el, binding, ...rest) =>
      Tooltip[hook](el, { ...binding, value: withShowDelay(binding.value) }, ...rest),
  ])
)
