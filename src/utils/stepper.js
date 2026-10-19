/**
 * Шаг степпера InputNumber для правки пачки с «разными» значениями: там «+»/«−» и ↑/↓
 * сдвигают КАЖДЫЙ элемент (10 и 20 → 11 и 21), а не ставят всем одно число.
 *
 * Зовётся из capture-обработчика обёртки поля — раньше PrimeVue: её спин на пустом поле
 * считает от нуля и клампит к минимуму. Шаг степпера гасится и отдаётся сдвигом, прочие
 * события (ввод числа, клик в поле) идут дальше. Кнопки у PrimeVue с `tabindex="-1"`,
 * поэтому с клавиатуры шаг — только стрелки в поле.
 *
 * @param {MouseEvent|KeyboardEvent} event — mousedown по кнопке или keydown в поле
 * @param {number} step — шаг поля
 * @returns {number} ±step либо 0, если это не шаг
 */
export function takeStep(event, step) {
  const dir = stepDir(event)
  if (!dir) return 0
  event.preventDefault()
  event.stopPropagation()
  return dir * step
}

function stepDir(event) {
  if (event.type === 'keydown') return { ArrowUp: 1, ArrowDown: -1 }[event.key] ?? 0
  const button = event.target?.closest?.('.p-inputnumber-button')
  if (!button) return 0
  return button.classList.contains('p-inputnumber-increment-button') ? 1 : -1
}
