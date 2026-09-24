// @vitest-environment jsdom
// Гейт мутирующих хоткеев по projectBusy: во время проектной операции
// (экспорт/импорт/переключение формы) undo/redo/paste/duplicate/delete/nudge
// не должны трогать граф — иначе JSON чужой формы уедет в store/IDB.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { withSetup } from './test-utils'

const mockCanvas = {
  graphRef: ref({ getCell: vi.fn() }),
  paperRef: ref({ options: { gridSize: 10 } }),
  selection: ref([{ kind: 'cell', id: 'c1' }]),
  highlightedTag: ref(null),
  deleteItems: vi.fn(),
  selectAllCells: vi.fn(),
  reorderCells: vi.fn(),
  clearSelection: vi.fn(),
  clearHighlightedTag: vi.fn(),
  cycleSearchMatch: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useHotkeys } from './useHotkeys'

const key = (code, opts = {}) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...opts })
  )

describe('useHotkeys — гейт мутирующих хоткеев по projectBusy', () => {
  let scope
  let deps
  let projectBusy

  beforeEach(() => {
    setActivePinia(createPinia())
    projectBusy = ref(false)
    deps = {
      undo: vi.fn(),
      redo: vi.fn(),
      scheduleSnapshot: vi.fn(),
      copySelection: vi.fn(),
      pasteClipboard: vi.fn(),
      duplicateSelection: vi.fn(),
      onExport: vi.fn(),
      projectBusy,
    }
    mockCanvas.deleteItems.mockClear()
    mockCanvas.selectAllCells.mockClear()
    mockCanvas.reorderCells.mockClear()
    ;[, scope] = withSetup(() => useHotkeys(deps))
  })

  afterEach(() => scope?.stop())

  it('busy=false → мутирующие хоткеи работают', () => {
    key('KeyV', { ctrlKey: true })
    key('KeyZ', { ctrlKey: true })
    key('Delete', { key: 'Delete' })
    key('ArrowLeft', { key: 'ArrowLeft' })
    expect(deps.pasteClipboard).toHaveBeenCalled()
    expect(deps.undo).toHaveBeenCalled()
    expect(mockCanvas.deleteItems).toHaveBeenCalled()
    expect(deps.scheduleSnapshot).toHaveBeenCalled()
  })

  it('busy=true → paste/undo/redo/duplicate/delete/nudge подавлены', () => {
    projectBusy.value = true
    key('KeyV', { ctrlKey: true })
    key('KeyZ', { ctrlKey: true })
    key('KeyY', { ctrlKey: true })
    key('KeyD', { ctrlKey: true })
    key('KeyA', { ctrlKey: true })
    key('Delete', { key: 'Delete' })
    key('ArrowLeft', { key: 'ArrowLeft' })
    expect(deps.pasteClipboard).not.toHaveBeenCalled()
    expect(deps.undo).not.toHaveBeenCalled()
    expect(deps.redo).not.toHaveBeenCalled()
    expect(deps.duplicateSelection).not.toHaveBeenCalled()
    expect(mockCanvas.selectAllCells).not.toHaveBeenCalled()
    expect(mockCanvas.deleteItems).not.toHaveBeenCalled()
    expect(deps.scheduleSnapshot).not.toHaveBeenCalled()
  })

  it('copy (read-only) работает даже под busy', () => {
    projectBusy.value = true
    key('KeyC', { ctrlKey: true })
    expect(deps.copySelection).toHaveBeenCalled()
  })

  it('выделен текст вне холста → Ctrl+C отдаём браузеру', () => {
    // Иначе копирование id символа или тега из инспектора отвечало бы тостом
    // «Нечего копировать» вместо копирования текста.
    const node = document.createElement('div')
    node.textContent = 'cell_qw'
    document.body.appendChild(node)
    const range = document.createRange()
    range.selectNodeContents(node)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)

    key('KeyC', { ctrlKey: true })
    expect(deps.copySelection).not.toHaveBeenCalled()

    sel.removeAllRanges()
    node.remove()
  })

  it('busy=true → порядок наложения подавлен', () => {
    projectBusy.value = true
    key('BracketRight', { ctrlKey: true })
    expect(mockCanvas.reorderCells).not.toHaveBeenCalled()
  })
})

// Ctrl+]/[ — порядок наложения. `event.code` (физическая клавиша), поэтому
// сочетание живёт и на нелатинской раскладке, где на этих клавишах «ъ»/«х».
describe('useHotkeys — порядок наложения', () => {
  let scope

  beforeEach(() => {
    setActivePinia(createPinia())
    mockCanvas.reorderCells.mockClear()
    ;[, scope] = withSetup(() =>
      useHotkeys({
        undo: vi.fn(),
        redo: vi.fn(),
        scheduleSnapshot: vi.fn(),
        copySelection: vi.fn(),
        pasteClipboard: vi.fn(),
        duplicateSelection: vi.fn(),
        onExport: vi.fn(),
        projectBusy: ref(false),
      })
    )
  })

  afterEach(() => scope?.stop())

  it.each([
    ['BracketRight', false, 'forward'],
    ['BracketLeft', false, 'backward'],
    ['BracketRight', true, 'front'],
    ['BracketLeft', true, 'back'],
  ])('%s (shift=%s) → %s', (code, shiftKey, mode) => {
    key(code, { ctrlKey: true, shiftKey })
    expect(mockCanvas.reorderCells).toHaveBeenCalledWith(mockCanvas.selection.value, mode)
  })

  it('без Ctrl — не наша команда (скобка идёт в ввод)', () => {
    key('BracketRight')
    expect(mockCanvas.reorderCells).not.toHaveBeenCalled()
  })
})

// Зум с клавиатуры — только над холстом: в остальном UI Ctrl+= / Ctrl+− это браузерный
// зум страницы, и его не отбираем. Цифры 1…5 выбирают инструмент по номеру в тулбаре.
describe('useHotkeys — зум и инструменты', () => {
  let scope
  let deps
  let over

  beforeEach(() => {
    setActivePinia(createPinia())
    over = true
    deps = {
      undo: vi.fn(),
      redo: vi.fn(),
      scheduleSnapshot: vi.fn(),
      copySelection: vi.fn(),
      pasteClipboard: vi.fn(),
      duplicateSelection: vi.fn(),
      onExport: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitView: vi.fn(),
      pointerOverCanvas: () => over,
      drawTools: () => ['line', 'rect', 'circle', 'polyline', 'text'],
      projectBusy: ref(false),
    }
    ;[, scope] = withSetup(() => useHotkeys(deps))
  })

  afterEach(() => scope?.stop())

  it('над холстом Ctrl+= / Ctrl+− / Ctrl+0 зумят схему, браузерный зум погашен', () => {
    const ev = new KeyboardEvent('keydown', { code: 'Equal', ctrlKey: true, cancelable: true })
    window.dispatchEvent(ev)
    key('Minus', { ctrlKey: true })
    key('Digit0', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(deps.zoomIn).toHaveBeenCalledTimes(1)
    expect(deps.zoomOut).toHaveBeenCalledTimes(1)
    expect(deps.fitView).toHaveBeenCalledTimes(1)
  })

  it('курсор не над холстом — клавиша остаётся браузеру', () => {
    over = false
    const ev = new KeyboardEvent('keydown', { code: 'Equal', ctrlKey: true, cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(deps.zoomIn).not.toHaveBeenCalled()
  })

  it('цифра выбирает инструмент по номеру, та же цифра — обратно к выбору', async () => {
    const { useUiStore } = await import('../stores/useUiStore')
    const ui = useUiStore()
    key('Digit2')
    expect(ui.canvasTool).toBe('rect')
    key('Digit2')
    expect(ui.canvasTool).toBe('select')
    key('Digit9') // инструмента с таким номером нет
    expect(ui.canvasTool).toBe('select')
  })

  it('в поле ввода цифра — это ввод, а не инструмент', async () => {
    const { useUiStore } = await import('../stores/useUiStore')
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', bubbles: true }))
    expect(useUiStore().canvasTool).toBe('select')
    input.remove()
  })

  it('в выпадающем списке цифра тоже его, а не инструмент', async () => {
    const { useUiStore } = await import('../stores/useUiStore')
    const select = document.createElement('div')
    select.setAttribute('role', 'combobox')
    document.body.appendChild(select)
    select.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', bubbles: true }))
    expect(useUiStore().canvasTool).toBe('select')
    select.remove()
  })
})
