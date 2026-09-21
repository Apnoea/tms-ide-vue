// @vitest-environment jsdom
// Ручки ресайза заканчивают жест своим document-pointerup, мимо `element:pointerup`
// холста — значит закрепление на шине сверяется здесь.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

const mockCanvas = {
  graphRef: ref(null),
  paperRef: ref(null),
  selection: ref([]),
  graphVersion: ref(0),
  paperViewTick: ref(0),
  bumpVersion: vi.fn(),
  markDirty: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))
vi.mock('../stencils/shapeElement', () => ({
  isShapeResizable: () => true,
  resizeShapeCell: () => true,
  moveShapePoint: vi.fn(),
}))

import { useCanvasResize } from './useCanvasResize'
import { withSetup } from './test-utils'

function makeCell() {
  return {
    id: 'c1',
    angle: () => 0,
    get: (key) => (key === 'position' ? { x: 0, y: 0 } : { width: 20, height: 20 }),
  }
}

describe('useCanvasResize — конец жеста', () => {
  let cell
  let scope
  let api
  let syncBusAttachment

  beforeEach(() => {
    cell = makeCell()
    mockCanvas.graphRef.value = { getCell: () => cell }
    mockCanvas.paperRef.value = {
      options: { gridSize: 5 },
      clientToLocalPoint: (x, y) => ({ x, y }),
    }
    mockCanvas.selection.value = [{ id: 'c1', kind: 'cell' }]
    syncBusAttachment = vi.fn()
    ;[api, scope] = withSetup(() =>
      useCanvasResize({ scheduleSnapshot: vi.fn(), dragging: ref(false), syncBusAttachment })
    )
  })

  afterEach(() => scope.stop())

  const down = () => api.onHandleDown({ preventDefault() {}, stopPropagation() {} }, 'se')
  const move = (x, y) =>
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
  const up = () => document.dispatchEvent(new MouseEvent('pointerup'))

  it('сверяет закрепление на шине: габарит изменился — центр символа уехал', () => {
    down()
    move(60, 60)
    up()
    expect(syncBusAttachment).toHaveBeenCalledWith(cell)
  })

  it('жест без изменения габарита шину не трогает', () => {
    down()
    up()
    expect(syncBusAttachment).not.toHaveBeenCalled()
  })
})
