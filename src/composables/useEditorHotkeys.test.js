// @vitest-environment jsdom
// Клавиши редактора символов: порядок Esc, замок рисунка, цифры инструментов, поворот.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { withSetup } from './test-utils'
import { createStencilEditor } from './useStencilEditor'
import { useEditorHotkeys } from './useEditorHotkeys'
import { useUiStore } from '../stores/useUiStore'

let scope = null
beforeEach(() => {
  setActivePinia(createPinia())
  useUiStore().stencilEditorOpen = true
})
afterEach(() => scope?.stop())

const key = (init) => window.dispatchEvent(new KeyboardEvent('keydown', init))

function setup({ locked = false, animationOnly = false } = {}) {
  const ed = createStencilEditor()
  ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
  const deps = {
    cancelDraw: vi.fn(() => false),
    requestClose: vi.fn(),
    pickTool: vi.fn(),
    rotateSelected: vi.fn(),
    flipSelected: vi.fn(),
  }
  const [, s] = withSetup(() =>
    useEditorHotkeys({
      ed,
      stageEl: ref(null),
      locked,
      animationOnly,
      toolKeys: ['line', 'rect'],
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitView: vi.fn(),
      save: vi.fn(),
      ...deps,
    })
  )
  scope = s
  return { ed, ...deps }
}

describe('useEditorHotkeys', () => {
  it('Esc: сначала бросает жест, затем снимает выделение, пустым — закрывает', () => {
    const { ed, cancelDraw, requestClose } = setup()
    cancelDraw.mockReturnValueOnce(true)
    key({ key: 'Escape' })
    expect(ed.selectedIds.value).toHaveLength(1)
    key({ key: 'Escape' })
    expect(ed.selectedIds.value).toHaveLength(0)
    expect(requestClose).not.toHaveBeenCalled()
    key({ key: 'Escape' })
    expect(requestClose).toHaveBeenCalledOnce()
  })

  it('цифра выбирает инструмент по номеру в тулбаре, R и Shift+R крутят выделение', () => {
    const { pickTool, rotateSelected } = setup()
    key({ code: 'Digit2' })
    expect(pickTool).toHaveBeenCalledWith('rect')
    key({ code: 'KeyR' })
    key({ code: 'KeyR', shiftKey: true })
    expect(rotateSelected.mock.calls).toEqual([[1], [-1]])
  })

  it('Ctrl+C при выделенном тексте вне стола — копирование браузера, не фигур', () => {
    const { ed } = setup()
    const copy = vi.spyOn(ed, 'copyShapes')
    const hint = document.createElement('p')
    hint.textContent = 'Подсказка инспектора'
    document.body.append(hint)
    const range = document.createRange()
    range.selectNodeContents(hint)
    window.getSelection().addRange(range)
    key({ code: 'KeyC', ctrlKey: true })
    expect(copy).not.toHaveBeenCalled()
    window.getSelection().removeAllRanges()
    key({ code: 'KeyC', ctrlKey: true })
    expect(copy).toHaveBeenCalledOnce()
    hint.remove()
  })

  it('под замком рисунок не правится, но выделить всё у символа набора можно', () => {
    const { ed, pickTool } = setup({ locked: true, animationOnly: true })
    ed.select(null)
    key({ key: 'Delete' })
    key({ code: 'Digit1' })
    expect(ed.shapes.value).toHaveLength(1)
    expect(pickTool).not.toHaveBeenCalled()
    key({ code: 'KeyA', ctrlKey: true })
    expect(ed.selectedIds.value).toHaveLength(1)
  })
})
