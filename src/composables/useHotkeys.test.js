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
})
