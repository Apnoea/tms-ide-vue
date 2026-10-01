// @vitest-environment jsdom
// Проявление панели/формы при смене: класс анимации ставится заново и снимается по концу.
import { it, expect } from 'vitest'
import { replayClass } from './replayClass'

it('replayClass: класс на время анимации, повтор ставит его заново', () => {
  const el = document.createElement('div')
  replayClass(el, 'tms-panel-in')
  expect(el.classList.contains('tms-panel-in')).toBe(true)
  el.dispatchEvent(new Event('animationend'))
  expect(el.classList.contains('tms-panel-in')).toBe(false)
  replayClass(el, 'tms-panel-in')
  expect(el.classList.contains('tms-panel-in')).toBe(true)
  expect(() => replayClass(null, 'tms-panel-in')).not.toThrow()
})
