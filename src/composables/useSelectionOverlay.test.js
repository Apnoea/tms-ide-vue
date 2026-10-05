// @vitest-environment jsdom
// Пунктирная рамка группы по ховеру: габарит всех членов в экранных координатах,
// у одиночной ячейки и во время drag'а рамки нет.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { dia, shapes } from '@joint/core'
import { withSetup } from './test-utils'

const mockCanvas = {
  graphRef: { value: null },
  paperRef: { value: { scale: () => ({ sx: 2 }), translate: () => ({ tx: 10, ty: 0 }) } },
  graphVersion: ref(0),
  paperViewTick: ref(0),
  selection: ref([]),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useSelectionOverlay } from './useSelectionOverlay'

function cell(id, x, y, groupId) {
  const c = new shapes.standard.Rectangle({
    id,
    position: { x, y },
    size: { width: 20, height: 10 },
  })
  c.set('tms', groupId ? { groupId } : {})
  return c
}

describe('useSelectionOverlay: рамка группы по ховеру', () => {
  let overlay
  const dragging = ref(false)

  beforeEach(() => {
    const graph = new dia.Graph({}, { cellNamespace: shapes })
    graph.addCells([cell('a', 0, 0, 'g1'), cell('b', 40, 20, 'g1'), cell('solo', 100, 100)])
    mockCanvas.graphRef.value = graph
    dragging.value = false
    ;[overlay] = withSetup(() => useSelectionOverlay({ scheduleSnapshot: vi.fn(), dragging }))
  })

  it('член группы под курсором — рамка по всем членам с отступом', () => {
    overlay.hoveredCellId.value = 'a'
    // Габарит членов: 0..60 × 0..30; экран: ×2 + сдвиг 10 по x, отступ 4px.
    expect(overlay.groupHoverRect.value).toEqual({
      left: '6px',
      top: '-4px',
      width: '128px',
      height: '68px',
    })
  })

  it('одиночная ячейка, пустой ховер и drag — без рамки', () => {
    overlay.hoveredCellId.value = 'solo'
    expect(overlay.groupHoverRect.value).toBeNull()
    overlay.hoveredCellId.value = null
    expect(overlay.groupHoverRect.value).toBeNull()
    overlay.hoveredCellId.value = 'a'
    dragging.value = true
    expect(overlay.groupHoverRect.value).toBeNull()
  })
})
