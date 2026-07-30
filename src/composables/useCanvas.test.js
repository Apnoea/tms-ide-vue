// Замок (`tms.locked`) = read-only. `paper.interactive` его НЕ защищает: массовые
// операции пишут в модель программно, поэтому единая точка фильтра — writableItems.
import { describe, it, expect, beforeEach } from 'vitest'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from '../stencils/tmsStencil'
import { useCanvas } from './useCanvas'

function cell({ locked = false, groupId } = {}) {
  const tms = { stencilId: 'cell_qw' }
  if (locked) tms.locked = true
  if (groupId) tms.groupId = groupId
  return new TMSStencil({ position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, tms })
}

describe('useCanvas: замок в массовых операциях', () => {
  let canvas
  let graph

  beforeEach(() => {
    canvas = useCanvas()
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    canvas.setCanvasRefs(graph, { id: 'paper' })
  })

  it('writableItems отбрасывает locked и оставляет обычные ячейки', () => {
    const free = cell()
    const locked = cell({ locked: true })
    graph.addCells([free, locked])
    const out = canvas.writableItems([
      { kind: 'cell', id: free.id },
      { kind: 'cell', id: locked.id },
    ])
    expect(out.map((c) => c.id)).toEqual([free.id])
  })

  it('writableItems НЕ отбрасывает провода (замка у них нет, диапазоны/switch валидны)', () => {
    const a = cell()
    const b = cell()
    const link = new shapes.standard.Link({ source: { id: a.id }, target: { id: b.id } })
    graph.addCells([a, b, link])
    const out = canvas.writableItems([
      { kind: 'cell', id: a.id },
      { kind: 'link', id: link.id },
    ])
    expect(out).toHaveLength(2)
  })

  it('ungroupCells не снимает groupId с заблокированной ячейки', () => {
    const free = cell({ groupId: 'grp-1' })
    const locked = cell({ groupId: 'grp-1', locked: true })
    graph.addCells([free, locked])
    const n = canvas.ungroupCells([
      { kind: 'cell', id: free.id },
      { kind: 'cell', id: locked.id },
    ])
    expect(n).toBe(1)
    expect(free.get('tms').groupId).toBeUndefined()
    expect(locked.get('tms').groupId).toBe('grp-1')
  })
})
