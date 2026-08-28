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
  // Чтение с признаком успеха: restoreProject обязан отличать «нет записи»
  // (ok:true, value:undefined) от сбоя чтения (ok:false).
  idbTryGet: vi.fn(async (k) => ({ ok: true, value: idbStore.get(k) })),
  idbSet: vi.fn(async (k, v) => {
    idbStore.set(k, v)
    return true
  }),
  idbDel: vi.fn(async (k) => {
    idbStore.delete(k)
  }),
  idbKeys: vi.fn(async () => [...idbStore.keys()]),
}))

const mockCanvas = makeMockCanvas({
  setSaveError: vi.fn(),
  bumpVersion: vi.fn(),
})
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useAutosave } from './useAutosave'
import { idbSet, idbTryGet } from '../utils/idb'

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
    // Дефолт: всё читается. Тесты со сбоем подменяют реализацию ПО КЛЮЧУ —
    // restoreProject читает несколько ключей (оверрайды, мета, формы), и Once
    // ушёл бы не туда.
    idbTryGet.mockImplementation(async (k) => ({ ok: true, value: idbStore.get(k) }))
    restoringHistory = ref(false)
    mockCanvas.graphRef.value = null
    mockCanvas.paperRef.value = { id: 'paper', freeze() {}, unfreeze() {} }
    mockCanvas.setSaveError.mockClear()
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
      useWorkspaceStore().loadForms([{ id: 'main', graphJson: { cells: [] } }], 'main')
    }

    it('пишет graph.toJSON() в IndexedDB под ключом активной формы', async () => {
      seedActiveForm()
      const graph = makeMockGraph([{ id: 'c1' }])
      mockCanvas.graphRef.value = graph
      const { saveActiveForm } = setup()
      await saveActiveForm()
      expect(idbStore.get(formKey('main'))).toEqual({ cells: [{ id: 'c1' }] })
      expect(graph.toJSON).toHaveBeenCalledOnce()
      expect(mockCanvas.setSaveError).toHaveBeenCalledWith(false) // успех снимает ошибку
    })

    it('запись в IndexedDB упала → setSaveError(true), НЕ врёт «сохранено»', async () => {
      seedActiveForm()
      mockCanvas.graphRef.value = makeMockGraph([{ id: 'c1' }])
      idbSet.mockResolvedValueOnce(false) // квота / приватный режим
      const { saveActiveForm } = setup()
      await saveActiveForm()
      expect(mockCanvas.setSaveError).toHaveBeenCalledWith(true)
      expect(mockCanvas.setSaveError).not.toHaveBeenCalledWith(false)
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

    it('принимает готовый json/строку — graph.toJSON второй раз не зовётся', async () => {
      seedActiveForm()
      const graph = makeMockGraph([{ id: 'c1' }])
      mockCanvas.graphRef.value = graph
      const { saveActiveForm } = setup()
      const json = { cells: [{ id: 'c1' }] }
      await saveActiveForm(json, JSON.stringify(json))
      expect(graph.toJSON).not.toHaveBeenCalled()
      expect(idbStore.get(formKey('main'))).toEqual(json)
    })

    it('повторный сейв того же состояния не пишет в IndexedDB', async () => {
      seedActiveForm()
      mockCanvas.graphRef.value = makeMockGraph([{ id: 'c1' }])
      const { saveActiveForm } = setup()
      idbSet.mockClear()
      await saveActiveForm()
      await saveActiveForm() // граф не менялся — запись блоба ни к чему
      expect(idbSet).toHaveBeenCalledTimes(1)
    })

    it('неудачную запись не запоминает — следующий сейв пробует снова', async () => {
      seedActiveForm()
      mockCanvas.graphRef.value = makeMockGraph([{ id: 'c1' }])
      const { saveActiveForm } = setup()
      idbSet.mockClear()
      idbSet.mockResolvedValueOnce(false) // квота
      await saveActiveForm()
      await saveActiveForm()
      expect(idbSet).toHaveBeenCalledTimes(2)
    })

    it('после clearActiveForm тот же граф пишется заново (память о IDB сброшена)', async () => {
      seedActiveForm()
      mockCanvas.graphRef.value = makeMockGraph([{ id: 'c1' }])
      const { saveActiveForm, clearActiveForm } = setup()
      await saveActiveForm()
      await clearActiveForm() // в IDB теперь пусто, а не наш граф
      idbSet.mockClear()
      await saveActiveForm()
      expect(idbSet).toHaveBeenCalledTimes(1)
      expect(idbStore.get(formKey('main'))).toEqual({ cells: [{ id: 'c1' }] })
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
      expect(idbStore.get(META_KEY)).toEqual({
        formIds: ['main'],
        activeFormId: 'main',
        hierarchy: [{ id: 'main', children: [] }],
        projectName: null,
        formBg: {},
        wireStyle: {}, // вид нового провода — липкая настройка инструмента
      })
      expect(idbStore.get(formKey('main'))).toEqual({ cells: [] })
    })

    it('сбой чтения меты НЕ бутстрапит проект: read-only, -1, ни одной записи', async () => {
      // Сбой чтения не равен «проекта нет»: приняв одно за другое, бутстрап затрёт
      // существующий проект пустой формой.
      idbStore.set(META_KEY, { formIds: ['a'], activeFormId: 'a' })
      idbStore.set(formKey('a'), { cells: [{ id: 'a1' }] })
      idbTryGet.mockImplementation(async (k) =>
        k === META_KEY ? { ok: false, value: undefined } : { ok: true, value: idbStore.get(k) }
      )
      mockCanvas.graphRef.value = makeMockGraph()
      idbSet.mockClear()

      const { restoreProject } = setup()
      expect(await restoreProject()).toBe(-1)
      expect(idbSet).not.toHaveBeenCalled()
      expect(idbStore.get(formKey('a'))).toEqual({ cells: [{ id: 'a1' }] })
      expect(mockCanvas.setSaveError).toHaveBeenCalledWith(true)
    })

    it('сбой чтения ОДНОЙ формы тоже уводит в read-only (autosave не затрёт её)', async () => {
      idbStore.set(META_KEY, { formIds: ['a', 'b'], activeFormId: 'b' })
      idbStore.set(formKey('a'), { cells: [{ id: 'a1' }] })
      idbStore.set(formKey('b'), { cells: [{ id: 'b1' }] })
      // Мета прочиталась, форма «a» — нет.
      idbTryGet.mockImplementation(async (k) =>
        k === formKey('a') ? { ok: false, value: undefined } : { ok: true, value: idbStore.get(k) }
      )
      mockCanvas.graphRef.value = makeMockGraph()

      const { restoreProject } = setup()
      expect(await restoreProject()).toBe(-1)
    })

    it('после сбоя чтения записи заблокированы: saveActiveForm/persistForm молчат', async () => {
      idbTryGet.mockImplementation(async (k) =>
        k === META_KEY ? { ok: false, value: undefined } : { ok: true, value: idbStore.get(k) }
      )
      mockCanvas.graphRef.value = makeMockGraph([{ id: 'x' }])
      const { restoreProject, saveActiveForm, persistForm, persistMeta } = setup()
      await restoreProject()
      idbSet.mockClear()

      await saveActiveForm()
      expect(await persistForm('a', { cells: [] })).toBe(false)
      expect(await persistMeta()).toBe(false)
      expect(idbSet).not.toHaveBeenCalled()
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
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'b'
      )
      const { persistMeta } = setup()
      await persistMeta()
      expect(idbStore.get(META_KEY)).toEqual({
        formIds: ['a', 'b'],
        activeFormId: 'b',
        hierarchy: [],
        projectName: null,
        formBg: {},
        wireStyle: {}, // вид нового провода — липкая настройка инструмента
      })
    })

    it('правка вида нового провода сама уходит в мету (переживает reload)', async () => {
      // Мету пишут только операции с формами, поэтому у липкой настройки свой
      // отложенный вотчер: без него вид нового провода терялся на перезагрузке.
      vi.useFakeTimers()
      const ws = useWorkspaceStore()
      ws.loadForms([{ id: 'main', graphJson: { cells: [] } }], 'main')
      setup()
      ws.setWireStyle({ strokeColor: '#ff0000', strokeWidth: 4 })
      await vi.advanceTimersByTimeAsync(400)
      vi.useRealTimers()
      expect(idbStore.get(META_KEY).wireStyle).toEqual({
        strokeColor: '#ff0000',
        strokeWidth: 4,
      })
    })
  })

  describe('clearActiveForm', () => {
    it('обнуляет граф активной формы в IndexedDB', async () => {
      useWorkspaceStore().loadForms([{ id: 'main', graphJson: { cells: [{ id: 'c1' }] } }], 'main')
      const { clearActiveForm } = setup()
      await clearActiveForm()
      expect(idbStore.get(formKey('main'))).toEqual({ cells: [] })
    })
  })

  describe('replaceProject', () => {
    it('пишет формы + мету + теги в IDB и грузит стор (активна первая)', async () => {
      const { replaceProject } = setup()
      await replaceProject(
        [
          { id: 'a', graphJson: { cells: [{ id: 'x' }] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'TAG1;Bool'
      )
      expect(idbStore.get(formKey('a'))).toEqual({ cells: [{ id: 'x' }] })
      expect(idbStore.get(META_KEY)).toEqual({
        formIds: ['a', 'b'],
        activeFormId: 'a',
        hierarchy: [
          { id: 'a', children: [] },
          { id: 'b', children: [] },
        ],
        projectName: null,
        formBg: {},
        wireStyle: {}, // вид нового провода — липкая настройка инструмента
      })
      expect(idbStore.get('project:tags')).toBe('TAG1;Bool')
      expect(useWorkspaceStore().activeFormId).toBe('a')
    })

    it('возвращает true при полной записи', async () => {
      const { replaceProject } = setup()
      const ok = await replaceProject([{ id: 'a', graphJson: { cells: [] } }], null)
      expect(ok).toBe(true)
      expect(mockCanvas.setSaveError).not.toHaveBeenCalled()
    })

    it('GC осиротевших форм прежнего проекта (не в новом наборе)', async () => {
      idbStore.set(formKey('old1'), { cells: [] })
      idbStore.set(formKey('old2'), { cells: [] })
      const { replaceProject } = setup()
      await replaceProject([{ id: 'a', graphJson: { cells: [] } }], null)
      expect(idbStore.has(formKey('old1'))).toBe(false)
      expect(idbStore.has(formKey('old2'))).toBe(false)
      expect(idbStore.has(formKey('a'))).toBe(true)
    })

    it('запись формы упала (квота) → false + setSaveError, стор всё равно загружен', async () => {
      idbSet.mockResolvedValueOnce(false) // первая форма не записалась
      const { replaceProject } = setup()
      const ok = await replaceProject(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        null
      )
      expect(ok).toBe(false)
      expect(mockCanvas.setSaveError).toHaveBeenCalledWith(true)
      // Стор грузится для рабочей сессии несмотря на неполный IDB.
      expect(useWorkspaceStore().activeFormId).toBe('a')
    })
  })
})
