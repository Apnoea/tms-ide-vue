// @vitest-environment jsdom
// Лист заголовка-пути правой колонки: одно правило на инспектор и панель симуляции.
import { describe, it, expect, beforeEach } from 'vitest'
import { dia, shapes } from '@joint/core'
import { createPinia, setActivePinia } from 'pinia'
import { TMSStencil, TMSShape, tmsNamespace } from '../stencils/tmsStencil'
import { useCanvas } from './useCanvas'
import { useSelectionHeading } from './useSelectionHeading'

describe('useSelectionHeading', () => {
  let canvas
  let graph
  const cell = (tms) =>
    new TMSStencil({ position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, tms })

  beforeEach(() => {
    setActivePinia(createPinia())
    canvas = useCanvas()
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    canvas.setCanvasRefs(graph, { options: { gridSize: 5 }, findViewByModel: () => null })
    canvas.clearSelection()
  })

  it('ничего, символ, шина, провод, фигура-разметка', () => {
    const leaf = useSelectionHeading()
    expect(leaf.value).toBeNull()
    const qw = cell({ stencilId: 'cell_qw' })
    const bus = cell({ stencilId: 'cell_bus' })
    const link = new shapes.standard.Link({ source: { id: qw.id }, target: { id: bus.id } })
    const rect = new TMSShape({
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
      tms: { shape: { type: 'rect', x: 0, y: 0, w: 10, h: 10 } },
    })
    graph.addCells([qw, bus, link, rect])
    canvas.selectOnly('cell', qw.id)
    expect(leaf.value).toBe('Символ')
    canvas.selectOnly('cell', bus.id)
    expect(leaf.value).toBe('Шина')
    canvas.selectOnly('link', link.id)
    expect(leaf.value).toBe('Провод')
    canvas.selectOnly('cell', rect.id)
    expect(leaf.value).toBe('Прямоугольник')
  })

  it('несколько: члены одной группы — «Группа», иначе «Выделение»', () => {
    const leaf = useSelectionHeading()
    const a = cell({ stencilId: 'cell_qw', groupId: 'g1' })
    const b = cell({ stencilId: 'cell_qw', groupId: 'g1' })
    const c = cell({ stencilId: 'cell_qw' })
    graph.addCells([a, b, c])
    canvas.setSelection([
      { kind: 'cell', id: a.id },
      { kind: 'cell', id: b.id },
    ])
    expect(leaf.value).toBe('Группа')
    canvas.setSelection([
      { kind: 'cell', id: a.id },
      { kind: 'cell', id: c.id },
    ])
    expect(leaf.value).toBe('Выделение')
  })
})
