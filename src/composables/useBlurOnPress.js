import { useEventListener } from '@vueuse/core'

const FIELD = 'input, textarea, select, [contenteditable="true"]'

/**
 * Нажатие по холсту снимает фокус с поля ввода и выделение текста вне него. Холст гасит
 * действие браузера на нажатии (`preventDefault`), и без этого фокус остаётся в поле
 * инспектора: его blur-коммит не случается, а горячие клавиши холста уходят в поле.
 * Выделенный текст иначе забрал бы Ctrl+C после клика по фигуре. Слушаем в capture, до
 * обработчиков холста: поле коммитится в свой элемент раньше, чем клик сменит выделение.
 *
 * @param {import('vue').Ref<HTMLElement|null>} target — холст или стол редактора символов
 */
export function useBlurOnPress(target) {
  useEventListener(
    target,
    'pointerdown',
    () => {
      const el = document.activeElement
      if (el instanceof HTMLElement && el.matches(FIELD) && !target.value?.contains(el)) el.blur()
      const sel = window.getSelection?.()
      if (sel && !sel.isCollapsed && !target.value?.contains(sel.anchorNode)) sel.removeAllRanges()
    },
    { capture: true }
  )
}
