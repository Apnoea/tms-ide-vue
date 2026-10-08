// @vitest-environment jsdom
// Дроп из палитры: брошенный символ сразу выделен — следующий шаг, привязка тега,
// идёт в инспекторе, и без выделения до него был лишний клик. Так же при посадке на
// шину и врезке в провод.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { makeMockCanvas } from './test-utils'
import { useUiStore } from '../stores/useUiStore'

const mockCanvas = makeMockCanvas({ setSelection: vi.fn(), zoomPercent: ref(100) })
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))
vi.mock('../stencils/registry', () => ({
  getStencilById: (id) => ({ id, width: 20, height: 20, ports: [{}, {}] }),
}))
let created = 0
vi.mock('../stencils/svgInjector', () => ({
  materializeStencil: vi.fn(() => ({ id: `new-${++created}` })),
}))

import { usePaletteDrag } from './usePaletteDrag'

describe('usePaletteDrag: дроп', () => {
  let scope
  let wireSplice
  let busSnap
  let ui

  const drop = (x, y) =>
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }))

  beforeEach(() => {
    setActivePinia(createPinia())
    ui = useUiStore()
    mockCanvas.graphRef.value = {}
    mockCanvas.paperRef.value = {
      options: { gridSize: 10 },
      clientToLocalPoint: (x, y) => ({ x, y }),
      scale: () => ({ sx: 1 }),
    }
    mockCanvas.setSelection.mockClear()
    wireSplice = {
      splicePreview: ref(null),
      findLinkAtPoint: vi.fn(() => null),
      spliceCellIntoLink: vi.fn(),
      updateSplicePreview: vi.fn(),
      clearSplicePreview: vi.fn(),
    }
    busSnap = {
      busSnapPreview: ref(null),
      findBusAtPoint: vi.fn(() => null),
      attachToBus: vi.fn(),
      updateBusSnapPreview: vi.fn(),
      clearBusSnapPreview: vi.fn(),
    }
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600 })
    scope = effectScope()
    scope.run(() => usePaletteDrag(ref(container), wireSplice, busSnap))
  })

  afterEach(() => scope.stop())

  const startDrag = async () => {
    ui.startDragging({ stencilId: 'cell_qw', width: 20, height: 20 })
    await Promise.resolve() // document-листенеры цепляются реактивно
  }

  it('брошенный на пустое место символ выделен', async () => {
    await startDrag()
    drop(100, 100)
    const id = mockCanvas.setSelection.mock.calls.at(-1)[0][0].id
    expect(mockCanvas.setSelection).toHaveBeenLastCalledWith([{ kind: 'cell', id }])
    expect(id).toMatch(/^new-/)
  })

  it('севший на шину и врезанный в провод — тоже', async () => {
    busSnap.findBusAtPoint.mockReturnValueOnce({ id: 'bus' })
    await startDrag()
    drop(100, 100)
    expect(busSnap.attachToBus).toHaveBeenCalled()
    expect(mockCanvas.setSelection).toHaveBeenCalledTimes(1)

    wireSplice.findLinkAtPoint.mockReturnValueOnce({ id: 'wire' })
    await startDrag()
    drop(200, 100)
    expect(wireSplice.spliceCellIntoLink).toHaveBeenCalled()
    expect(mockCanvas.setSelection).toHaveBeenCalledTimes(2)
  })

  it('отпустили вне холста — ничего не создано и выделение не тронуто', async () => {
    await startDrag()
    drop(900, 100)
    expect(mockCanvas.setSelection).not.toHaveBeenCalled()
  })
})
