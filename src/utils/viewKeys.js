// Клавиши вида и инструментов, общие для холста схемы и стола редактора символов. По
// `event.code` (физическая клавиша), как все хоткеи IDE: на русской раскладке `key` у
// тех же кнопок другой.

const ZOOM_CODES = {
  Equal: 'in',
  NumpadAdd: 'in',
  Minus: 'out',
  NumpadSubtract: 'out',
  Digit0: 'fit',
  Numpad0: 'fit',
}

/**
 * Ctrl/Cmd + `=` / `−` / `0` → 'in' | 'out' | 'fit', иначе null. Shift не мешает:
 * `+` на основной клавиатуре — это Shift+`=`.
 */
export function zoomKeyOf(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  return ZOOM_CODES[event.code] || null
}

/**
 * Голая цифра 1–9 (верхний ряд или цифровой блок) → индекс инструмента по порядку в
 * тулбаре, иначе -1. С модификаторами — не наша: Ctrl+1 у браузера переключает вкладки.
 */
export function toolDigitOf(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return -1
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || '')
  return m ? Number(m[1]) - 1 : -1
}
