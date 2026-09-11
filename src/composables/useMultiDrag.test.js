// @vitest-environment jsdom
// Multi-drag двигает вместе с выделением изломы и СВОБОДНЫЕ концы проводов. Сдвиг
// ведущей кратным не бывает (направляющие притягивают её к краям и портам соседей),
// поэтому проверяем, что перенесённые точки садятся на сетку.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from '../stencils/tmsStencil'

const mockCanvas = {
  graphRef: { value: null },
  paperRef: { value: null },
  selection: ref([]),
  isSelected: (id) => mockCanvas.selection.value.some((s) => s.id === id),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useMultiDrag } from './useMultiDrag'

const cellAt = (x, y) =>
  new TMSStencil({ position: { x, y }, size: { width: 20, height: 20 }, tms: { stencilId: 'c' } })

describe('useMultiDrag: свободные концы и изломы', () => {
  let graph
  let cell
  let link

  beforeEach(() => {
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    mockCanvas.graphRef.value = graph
    mockCanvas.paperRef.value = { options: { gridSize: 5 } }
    cell = cellAt(100, 100)
    link = new shapes.standard.Link({
      source: { id: cell.id },
      target: { x: 200, y: 100 },
      vertices: [{ x: 150, y: 100 }],
    })
    graph.addCells([cell, link])
    // Провод с одним концом на символе и вторым на холсте попадает в выделение сам
    // (мостовые линии), поэтому в drag он входит вместе с ячейкой.
    mockCanvas.selection.value = [
      { kind: 'cell', id: cell.id },
      { kind: 'link', id: link.id },
    ]
  })

  it('некратный сдвиг: конец и излом садятся на сетку', () => {
    const { prepareMultiDrag, onPositionChange } = useMultiDrag()
    prepareMultiDrag(cell.id)
    // 12 по X — столько отдаёт направляющая, притянувшая символ к краю соседа.
    onPositionChange(cell, { x: 112, y: 103 }, {})

    expect(link.get('target')).toEqual({ x: 210, y: 105 })
    expect(link.vertices()).toEqual([{ x: 160, y: 105 }])
  })

  it('кратный сдвиг переносит точки без изменений', () => {
    const { prepareMultiDrag, onPositionChange } = useMultiDrag()
    prepareMultiDrag(cell.id)
    onPositionChange(cell, { x: 110, y: 100 }, {})

    expect(link.get('target')).toEqual({ x: 210, y: 100 })
    expect(link.vertices()).toEqual([{ x: 160, y: 100 }])
  })

  it('привязанный к чужой ячейке конец не двигаем: провод идёт за портом', () => {
    const other = cellAt(300, 100)
    const bound = new shapes.standard.Link({ source: { id: cell.id }, target: { id: other.id } })
    graph.addCells([other, bound])
    mockCanvas.selection.value = [
      { kind: 'cell', id: cell.id },
      { kind: 'link', id: bound.id },
    ]
    const { prepareMultiDrag, onPositionChange } = useMultiDrag()
    prepareMultiDrag(cell.id)
    onPositionChange(cell, { x: 112, y: 100 }, {})

    expect(bound.get('target')).toEqual({ id: other.id })
  })
})
