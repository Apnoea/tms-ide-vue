// Покрываем history-stack инварианты: push'ы, отрезание «будущего» после undo,
// HISTORY_LIMIT, debounce snapshotTimer'а, restoringHistory-флаг, no-op'ы на
// границах. JointJS Graph/Paper мокаем — нам нужны только toJSON/fromJSON +
// несколько no-op методов.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, effectScope } from 'vue'

// onBeforeUnmount вне Vue-component'а ругается warning'ом. effectScope.stop()
// в нашем тесте делает cleanup сам — Vue-хук не нужен.
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return { ...actual, onBeforeUnmount: vi.fn() }
})

vi.mock('../stencils/svgInjector', () => ({ reinjectAllStencils: vi.fn() }))

// useCanvas — singleton. Стейт переопределяем перед каждым тестом, чтобы
// не было утечек между case'ами.
const mockCanvas = {
  graphRef: { value: null },
  paperRef: { value: null },
  setUndoRedoAvail: vi.fn(),
  bumpVersion: vi.fn(),
  clearSelection: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useUndoRedo } from './useUndoRedo'

// Минимальный mock JointJS graph. toJSON просто возвращает inkrement'ируемый
// маркер чтобы каждый snapshot отличался; fromJSON фиксирует «применённое»
// состояние для проверок в тестах.
function makeMockGraph() {
  let stateMarker = 0
  let lastApplied = null
  return {
    toJSON: vi.fn(() => ({ marker: ++stateMarker })),
    fromJSON: vi.fn((state) => {
      lastApplied = state
    }),
    getLastApplied: () => lastApplied,
  }
}

function withSetup(composableFn) {
  let result
  const scope = effectScope()
  scope.run(() => {
    result = composableFn()
  })
  return [result, scope]
}

describe('useUndoRedo', () => {
  let restoringHistory
  let saveAutosave
  let mockGraph
  let scope

  beforeEach(() => {
    vi.useFakeTimers()
    restoringHistory = ref(false)
    saveAutosave = vi.fn()
    mockGraph = makeMockGraph()
    mockCanvas.graphRef.value = mockGraph
    mockCanvas.paperRef.value = { id: 'mock-paper' }
    mockCanvas.setUndoRedoAvail.mockClear()
    mockCanvas.bumpVersion.mockClear()
    mockCanvas.clearSelection.mockClear()
  })

  afterEach(() => {
    scope?.stop()
    vi.useRealTimers()
  })

  function init() {
    const [api, s] = withSetup(() => useUndoRedo({ restoringHistory, saveAutosave }))
    scope = s
    api.initHistory()
    return api
  }

  it('initHistory сохраняет стартовое состояние и обновляет avail', () => {
    init()
    expect(mockGraph.toJSON).toHaveBeenCalledTimes(1)
    // На старте undo недоступно (index=0), redo тоже (один элемент)
    expect(mockCanvas.setUndoRedoAvail).toHaveBeenLastCalledWith(false, false)
  })

  it('scheduleSnapshot дебаунсится 200ms и зовёт snapshot ОДИН раз', () => {
    const api = init()
    api.scheduleSnapshot()
    api.scheduleSnapshot()
    api.scheduleSnapshot()
    vi.advanceTimersByTime(199)
    expect(mockGraph.toJSON).toHaveBeenCalledTimes(1) // только initHistory
    vi.advanceTimersByTime(2)
    expect(mockGraph.toJSON).toHaveBeenCalledTimes(2) // +1 snapshot
    expect(saveAutosave).toHaveBeenCalledOnce()
  })

  it('после snapshot undo доступно, redo — нет', () => {
    const api = init()
    api.scheduleSnapshot()
    vi.runAllTimers()
    expect(mockCanvas.setUndoRedoAvail).toHaveBeenLastCalledWith(true, false)
  })

  it('undo восстанавливает предыдущее состояние, redo возвращает обратно', () => {
    const api = init()
    api.scheduleSnapshot()
    vi.runAllTimers()
    // 2 состояния в стеке (initial + 1 snapshot). undo вернёт initial.
    api.undo()
    expect(mockGraph.fromJSON).toHaveBeenCalledTimes(1)
    const afterUndo = mockGraph.getLastApplied()
    expect(afterUndo.marker).toBe(1) // первое сохранённое toJSON
    api.redo()
    expect(mockGraph.fromJSON).toHaveBeenCalledTimes(2)
    expect(mockGraph.getLastApplied().marker).toBe(2)
  })

  it('undo на границе (index=0) — no-op', () => {
    const api = init()
    api.undo()
    api.undo()
    expect(mockGraph.fromJSON).not.toHaveBeenCalled()
  })

  it('redo на границе (последний index) — no-op', () => {
    const api = init()
    api.redo()
    expect(mockGraph.fromJSON).not.toHaveBeenCalled()
  })

  it('новое действие после undo отрезает «будущее»', () => {
    const api = init()
    api.scheduleSnapshot()
    vi.runAllTimers() // index=1
    api.scheduleSnapshot()
    vi.runAllTimers() // index=2
    api.undo() // index=1
    // Новое действие → отрезаем index 2, добавляем новый
    api.scheduleSnapshot()
    vi.runAllTimers()
    // redo должен быть недоступен — «будущее» отрезано
    expect(mockCanvas.setUndoRedoAvail).toHaveBeenLastCalledWith(true, false)
  })

  it('restoringHistory=true блокирует snapshot', () => {
    const api = init()
    restoringHistory.value = true
    api.scheduleSnapshot()
    vi.runAllTimers()
    expect(mockGraph.toJSON).toHaveBeenCalledTimes(1) // только initial
    expect(saveAutosave).not.toHaveBeenCalled()
  })

  it('restoreFromHistory ставит restoringHistory=true на время операции', () => {
    const api = init()
    api.scheduleSnapshot()
    vi.runAllTimers()
    // Подсматриваем что fromJSON вызвался ВНУТРИ window'а restoringHistory=true
    let flagDuringFromJSON
    mockGraph.fromJSON = vi.fn(() => {
      flagDuringFromJSON = restoringHistory.value
    })
    api.undo()
    expect(flagDuringFromJSON).toBe(true)
    expect(restoringHistory.value).toBe(false) // снят после
  })

  it('cancelPendingSnapshot гасит отложенный таймер', () => {
    const api = init()
    api.scheduleSnapshot()
    api.cancelPendingSnapshot()
    vi.runAllTimers()
    expect(mockGraph.toJSON).toHaveBeenCalledTimes(1) // только initial
  })

  it('HISTORY_LIMIT=50: при превышении самый старый snapshot вытесняется', () => {
    const api = init()
    // initial = 1, ещё 60 snapshot'ов = 61. Должно остаться 50.
    for (let i = 0; i < 60; i++) {
      api.scheduleSnapshot()
      vi.runAllTimers()
    }
    // После shift'ов historyIndex остаётся в пределах 49 (last index)
    api.undo()
    expect(mockGraph.fromJSON).toHaveBeenCalledTimes(1)
    // Не должно крашнуть — внутренняя инвариантность стека держится
  })

  it('graph отсутствует (graphRef.value=null) — все операции no-op', () => {
    mockCanvas.graphRef.value = null
    const [api, s] = withSetup(() => useUndoRedo({ restoringHistory, saveAutosave }))
    scope = s
    api.initHistory()
    api.scheduleSnapshot()
    vi.runAllTimers()
    api.undo()
    api.redo()
    // Никаких ошибок — просто no-op'ы
    expect(saveAutosave).not.toHaveBeenCalled()
  })
})
