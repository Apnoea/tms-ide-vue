// Покрываем project-persist инварианты: save активной формы в IndexedDB,
// restore проекта (бутстрап пустой формы + чтение существующего проекта),
// restoringHistory-флаг во время fromJSON, no-op'ы, clear активной формы.
// Mock'аем JointJS Graph, canvas-singleton и idb (in-memory).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { withSetup, makeMockCanvas } from './test-utils'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return { ...actual, onBeforeUnmount: vi.fn() }
})

vi.mock('../stencils/svgInjector', () => ({ reinjectAllStencils: vi.fn() }))

// In-memory idb. vi.hoisted — фабрика vi.mock поднимается выше импортов.
const { idbStore } = vi.hoisted(() => ({ idbStore: new Map() }))
vi.mock('../utils/idb', () => ({
  idbGet: vi.fn(async (k) => idbStore.get(k)),
  idbSet: vi.fn(async (k, v) => {
    idbStore.set(k, v)
  }),
  idbDel: vi.fn(async (k) => {
    idbStore.delete(k)
  }),
}))

const mockCanvas = makeMockCanvas({
  setRecentlySaved: vi.fn(),
  setLastSavedAt: vi.fn(),
  bumpVersion: vi.fn(),
})
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useAutosave } from './useAutosave'

const META_KEY = 'project:meta'
const formKey = (id) => `project:form:${id}`

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
    setActivePinia(createPinia())
    idbStore.clear()
    restoringHistory = ref(false)
    mockCanvas.graphRef.value = null
    mockCanvas.paperRef.value = { id: 'paper' }
    mockCanvas.setRecentlySaved.mockClear()
    mockCanvas.setLastSavedAt.mockClear()
    mockCanvas.bumpVersion.mockClear()
  })

  afterEach(() => {
    scope?.stop()
  })

  function setup() {
    const [api, s] = withSetup(() => useAutosave({ restoringHistory }))
    scope = s
    return api
  }

  describe('saveActiveForm', () => {
    function seedActiveForm() {
      useWorkspaceStore().loadForms(
        [{ id: 'main', name: 'main', graphJson: { cells: [] } }],
        'main'
      )
    }

    it('пишет graph.toJSON() в IndexedDB под ключом активной формы', async () => {
      seedActiveForm()
      const graph = makeMockGraph([{ id: 'c1' }])
      mockCanvas.graphRef.value = graph
      const { saveActiveForm } = setup()
      await saveActiveForm()
      expect(idbStore.get(formKey('main'))).toEqual({ cells: [{ id: 'c1' }] })
      expect(graph.toJSON).toHaveBeenCalledOnce()
      expect(mockCanvas.setRecentlySaved).toHaveBeenCalledWith(true)
    })

    it('no-op при restoringHistory=true', async () => {
      seedActiveForm()
      mockCanvas.graphRef.value = makeMockGraph()
      restoringHistory.value = true
      const { saveActiveForm } = setup()
      await saveActiveForm()
      expect(idbStore.has(formKey('main'))).toBe(false)
    })

    it('no-op если graphRef.value=null', async () => {
      seedActiveForm()
      const { saveActiveForm } = setup()
      await saveActiveForm()
      expect(idbStore.has(formKey('main'))).toBe(false)
    })

    it('no-op если нет активной формы', async () => {
      mockCanvas.graphRef.value = makeMockGraph([{ id: 'c1' }])
      const { saveActiveForm } = setup()
      await saveActiveForm()
      expect([...idbStore.keys()]).toEqual([])
    })
  })

  describe('restoreProject', () => {
    it('пустой старт → бутстрап формы main, возвращает 0, пишет meta+форму', async () => {
      mockCanvas.graphRef.value = makeMockGraph()
      const { restoreProject } = setup()
      const count = await restoreProject()
      expect(count).toBe(0)
      expect(idbStore.get(META_KEY)).toEqual({ formIds: ['main'], activeFormId: 'main' })
      expect(idbStore.get(formKey('main'))).toEqual({ cells: [] })
    })

    it('существующий проект: грузит активную форму, бампает version', async () => {
      const cellsB = [{ id: 'b1' }]
      idbStore.set(META_KEY, { formIds: ['a', 'b'], activeFormId: 'b' })
      idbStore.set(formKey('a'), { cells: [{ id: 'a1' }] })
      idbStore.set(formKey('b'), { cells: cellsB })
      const graph = makeMockGraph(cellsB)
      mockCanvas.graphRef.value = graph
      const { restoreProject } = setup()
      const count = await restoreProject()
      expect(count).toBe(1)
      expect(graph.fromJSON).toHaveBeenCalledWith({ cells: cellsB })
      expect(mockCanvas.bumpVersion).toHaveBeenCalledOnce()
    })

    it('взводит restoringHistory на время fromJSON, снимает после', async () => {
      idbStore.set(META_KEY, { formIds: ['main'], activeFormId: 'main' })
      idbStore.set(formKey('main'), { cells: [{ id: 'c1' }] })
      let flagDuring
      const graph = makeMockGraph([{ id: 'c1' }])
      graph.fromJSON = vi.fn(() => {
        flagDuring = restoringHistory.value
      })
      mockCanvas.graphRef.value = graph
      const { restoreProject } = setup()
      await restoreProject()
      expect(flagDuring).toBe(true)
      expect(restoringHistory.value).toBe(false)
    })

    it('возвращает 0 если paper не готов', async () => {
      mockCanvas.paperRef.value = null
      mockCanvas.graphRef.value = makeMockGraph()
      const { restoreProject } = setup()
      expect(await restoreProject()).toBe(0)
    })
  })

  describe('persistMeta', () => {
    it('пишет порядок форм и активную в project:meta', async () => {
      useWorkspaceStore().loadForms(
        [
          { id: 'a', name: 'a', graphJson: { cells: [] } },
          { id: 'b', name: 'b', graphJson: { cells: [] } },
        ],
        'b'
      )
      const { persistMeta } = setup()
      await persistMeta()
      expect(idbStore.get(META_KEY)).toEqual({ formIds: ['a', 'b'], activeFormId: 'b' })
    })
  })

  describe('clearActiveForm', () => {
    it('обнуляет граф активной формы в IndexedDB', async () => {
      useWorkspaceStore().loadForms(
        [{ id: 'main', name: 'main', graphJson: { cells: [{ id: 'c1' }] } }],
        'main'
      )
      const { clearActiveForm } = setup()
      await clearActiveForm()
      expect(idbStore.get(formKey('main'))).toEqual({ cells: [] })
    })
  })
})
