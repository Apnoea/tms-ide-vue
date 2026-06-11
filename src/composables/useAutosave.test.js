// Покрываем save/restore инварианты localStorage'а: запись, считывание,
// игнор битых данных, restoringHistory-флаг во время restore, no-op при
// его взведённости, clear. Mock'аем JointJS Graph + canvas-singleton.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { withSetup, makeMockCanvas } from './test-utils'

vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return { ...actual, onBeforeUnmount: vi.fn() }
})

vi.mock('../stencils/svgInjector', () => ({ reinjectAllStencils: vi.fn() }))

const mockCanvas = makeMockCanvas({
  setRecentlySaved: vi.fn(),
  setLastSavedAt: vi.fn(),
  bumpVersion: vi.fn(),
})
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useAutosave } from './useAutosave'

const AUTOSAVE_KEY = 'tms-ide:graph:v1'

function makeMockGraph(cells = []) {
  const state = { cells: cells.map((c) => ({ ...c })) }
  return {
    toJSON: vi.fn(() => state),
    fromJSON: vi.fn(),
    getElements: vi.fn(() => cells),
  }
}

describe('useAutosave', () => {
  let restoringHistory
  let scope

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    restoringHistory = ref(false)
    mockCanvas.graphRef.value = null
    mockCanvas.paperRef.value = { id: 'paper' }
    mockCanvas.setRecentlySaved.mockClear()
    mockCanvas.setLastSavedAt.mockClear()
    mockCanvas.bumpVersion.mockClear()
  })

  afterEach(() => {
    scope?.stop()
    vi.useRealTimers()
  })

  function setup() {
    const [api, s] = withSetup(() => useAutosave({ restoringHistory }))
    scope = s
    return api
  }

  describe('saveAutosave', () => {
    it('пишет graph.toJSON() в localStorage под версионированным ключом', () => {
      const graph = makeMockGraph([{ id: 'c1' }])
      mockCanvas.graphRef.value = graph
      const { saveAutosave } = setup()
      saveAutosave()
      const stored = JSON.parse(localStorage.getItem(AUTOSAVE_KEY))
      expect(stored).toEqual({ cells: [{ id: 'c1' }] })
      expect(graph.toJSON).toHaveBeenCalledOnce()
    })

    it('взводит recentlySaved=true и снимает через 1500ms', () => {
      mockCanvas.graphRef.value = makeMockGraph()
      const { saveAutosave } = setup()
      saveAutosave()
      expect(mockCanvas.setRecentlySaved).toHaveBeenCalledWith(true)
      vi.advanceTimersByTime(1499)
      expect(mockCanvas.setRecentlySaved).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(2)
      expect(mockCanvas.setRecentlySaved).toHaveBeenLastCalledWith(false)
    })

    it('no-op при restoringHistory=true (не задваиваем restore)', () => {
      mockCanvas.graphRef.value = makeMockGraph()
      restoringHistory.value = true
      const { saveAutosave } = setup()
      saveAutosave()
      expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull()
    })

    it('no-op если graphRef.value=null', () => {
      const { saveAutosave } = setup()
      saveAutosave()
      expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull()
    })
  })

  describe('tryRestoreAutosave', () => {
    it('возвращает 0 если localStorage пуст', () => {
      mockCanvas.graphRef.value = makeMockGraph()
      const { tryRestoreAutosave } = setup()
      expect(tryRestoreAutosave()).toBe(0)
    })

    it('возвращает 0 на битом JSON, не падая', () => {
      localStorage.setItem(AUTOSAVE_KEY, '{not-json')
      mockCanvas.graphRef.value = makeMockGraph()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { tryRestoreAutosave } = setup()
      expect(tryRestoreAutosave()).toBe(0)
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('возвращает 0 на JSON без поля cells (не наш формат)', () => {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ foo: 'bar' }))
      mockCanvas.graphRef.value = makeMockGraph()
      const { tryRestoreAutosave } = setup()
      expect(tryRestoreAutosave()).toBe(0)
    })

    it('восстанавливает граф, возвращает кол-во элементов, бампает version', () => {
      const cells = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ cells }))
      const graph = makeMockGraph(cells)
      mockCanvas.graphRef.value = graph
      const { tryRestoreAutosave } = setup()
      const count = tryRestoreAutosave()
      expect(count).toBe(3)
      expect(graph.fromJSON).toHaveBeenCalledWith({ cells })
      expect(mockCanvas.bumpVersion).toHaveBeenCalledOnce()
    })

    it('взводит restoringHistory=true на время fromJSON, снимает после', () => {
      const cells = [{ id: 'c1' }]
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ cells }))
      let flagDuringFromJSON
      const graph = makeMockGraph(cells)
      graph.fromJSON = vi.fn(() => {
        flagDuringFromJSON = restoringHistory.value
      })
      mockCanvas.graphRef.value = graph
      const { tryRestoreAutosave } = setup()
      tryRestoreAutosave()
      expect(flagDuringFromJSON).toBe(true)
      expect(restoringHistory.value).toBe(false)
    })

    it('возвращает 0 если paper не готов', () => {
      mockCanvas.paperRef.value = null
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ cells: [{ id: 'x' }] }))
      mockCanvas.graphRef.value = makeMockGraph()
      const { tryRestoreAutosave } = setup()
      expect(tryRestoreAutosave()).toBe(0)
    })
  })

  describe('clearAutosave', () => {
    it('удаляет ключ из localStorage', () => {
      localStorage.setItem(AUTOSAVE_KEY, '{"cells":[]}')
      const { clearAutosave } = setup()
      clearAutosave()
      expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull()
    })
  })
})
