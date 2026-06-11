import { effectScope } from 'vue'

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
