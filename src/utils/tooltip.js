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

/**
 * Значение директивы не изменилось: та же строка или объект с теми же полями (объект в шаблоне
 * создаётся заново при каждой перерисовке).
 */
function sameValue(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
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
 *
 * `updated` с прежним значением пропускаем: Vue зовёт его при каждой перерисовке компонента,
 * а PrimeVue в нём снимает показанную подсказку, и до нового наведения её нет — инспектор и
 * панели перерисовываются на каждый шаг симуляции и правку графа. Копия — в tms-web-lib
 * (`src/utils/tooltip.js`), менять парой.
 */
export const DelayedTooltip = Object.fromEntries(
  HOOKS.filter((hook) => Tooltip[hook]).map((hook) => [
    hook,
    (el, binding, ...rest) => {
      if (hook === 'updated' && sameValue(binding.value, binding.oldValue)) return
      Tooltip[hook](el, { ...binding, value: withShowDelay(binding.value) }, ...rest)
    },
  ])
)
