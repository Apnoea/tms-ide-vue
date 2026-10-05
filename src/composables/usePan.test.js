// @vitest-environment jsdom
// Pan холста: средняя кнопка или Space+ЛКМ двигают paper, Space работает только над
// холстом и не из поля ввода; курсор grab / grabbing ведёт сам композабл.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { withSetup } from './test-utils'

const paper = {
  t: { tx: 0, ty: 0 },
  translate(tx, ty) {
    if (tx === undefined) return this.t
    this.t = { tx, ty }
  },
}
const mockCanvas = { paperRef: { value: paper }, bumpPaperView: vi.fn() }
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { usePan } from './usePan'

let scope = null
let el = null

const mouse = (target, type, opts = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...opts }))
const keyOn = (target, type, code) =>
  target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }))

describe('usePan', () => {
  beforeEach(() => {
    paper.t = { tx: 0, ty: 0 }
    el = document.createElement('div')
    document.body.append(el)
    ;[, scope] = withSetup(() => usePan(ref(el)))
  })
  afterEach(() => {
    scope?.stop()
    document.body.innerHTML = ''
  })

  it('средняя кнопка двигает холст, курсор grabbing до отпускания', () => {
    mouse(el, 'mousedown', { button: 1, clientX: 10, clientY: 10 })
    expect(el.style.cursor).toBe('grabbing')
    mouse(document, 'mousemove', { clientX: 40, clientY: 25 })
    expect(paper.t).toEqual({ tx: 30, ty: 15 })
    expect(mockCanvas.bumpPaperView).toHaveBeenCalled()
    mouse(document, 'mouseup')
    expect(el.style.cursor).toBe('')
    mouse(document, 'mousemove', { clientX: 90, clientY: 90 })
    expect(paper.t).toEqual({ tx: 30, ty: 15 })
  })

  it('обычный ЛКМ — не pan (это лассо)', () => {
    mouse(el, 'mousedown', { button: 0, clientX: 0, clientY: 0 })
    mouse(document, 'mousemove', { clientX: 50, clientY: 50 })
    expect(paper.t).toEqual({ tx: 0, ty: 0 })
  })

  it('Space над холстом: курсор grab, ЛКМ двигает холст', () => {
    mouse(el, 'mouseenter')
    keyOn(window, 'keydown', 'Space')
    expect(el.style.cursor).toBe('grab')
    mouse(el, 'mousedown', { button: 0, clientX: 0, clientY: 0 })
    mouse(document, 'mousemove', { clientX: 5, clientY: 7 })
    expect(paper.t).toEqual({ tx: 5, ty: 7 })
    mouse(document, 'mouseup')
    expect(el.style.cursor).toBe('grab') // Space ещё зажат
    keyOn(window, 'keyup', 'Space')
    expect(el.style.cursor).toBe('')
  })

  it('Space вне холста и в поле ввода — не наш', () => {
    keyOn(window, 'keydown', 'Space')
    expect(el.style.cursor).toBe('')

    mouse(el, 'mouseenter')
    const input = document.createElement('input')
    document.body.append(input)
    keyOn(input, 'keydown', 'Space')
    expect(el.style.cursor).toBe('')
  })
})
