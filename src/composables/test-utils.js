import { effectScope } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'

/**
 * Запускает composable в изолированном effectScope (вне Vue-компонента).
 * Возвращает [result, scope]; зови `scope.stop()` в afterEach для cleanup
 * вотчеров и onScopeDispose-хуков.
 */
export function withSetup(fn) {
  let result
  const scope = effectScope()
  scope.run(() => {
    result = fn()
  })
  return [result, scope]
}

/**
 * Заглушка singleton'а useCanvas: общие graphRef/paperRef + любые методы через
 * `extra`. Имя переменной у вызывающего ДОЛЖНО начинаться с `mock` — иначе vitest
 * не даст сослаться на неё в hoisted vi.mock-фабрике.
 */
export function makeMockCanvas(extra = {}) {
  return {
    graphRef: { value: null },
    paperRef: { value: null },
    ...extra,
  }
}

/**
 * Монтирует компонент с той же обвязкой, что даёт main.js: Pinia + PrimeVue
 * (config/Toast/Confirmation) + директива v-tooltip. Без неё любой наш компонент
 * падает на PrimeVue-инъекциях и неизвестной директиве. Тему не подключаем —
 * тестам нужен DOM и props, а не CSS-токены.
 *
 * `options` пробрасывается в mount; `options.global.*` мержится поверх базового
 * (можно добавить свои stubs/provide, не потеряв PrimeVue).
 */
export function mountWithApp(Component, options = {}) {
  const { global: g = {}, ...rest } = options
  // jsdom не реализует matchMedia, а PrimeVue Select подписывается на неё при
  // монтировании — без заглушки любой компонент с Select падает ещё до проверок.
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  }
  return mount(Component, {
    ...rest,
    global: {
      ...g,
      plugins: [createPinia(), PrimeVue, ToastService, ConfirmationService, ...(g.plugins || [])],
      directives: { tooltip: Tooltip, ...(g.directives || {}) },
      stubs: { teleport: true, ...(g.stubs || {}) },
    },
  })
}
