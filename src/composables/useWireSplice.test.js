// Покрываем оркестрацию spliceCellIntoLink: split графа (seg1 переиспользуется,
// seg2 добавляется), наследование tms провода с приоритетом собственной конфигу-
// рации ячейки, распределение изломов по сегментам и сохранение их при недоступном
// linkView. JointJS Graph реальный; useCanvas singleton и registry mock'аем.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from '../stencils/tmsStencil'

// getStencilById → null отключает авто-поворот (rotate-гейт): порты ячейки
// остаются на предсказуемых местах, тест фокусируется на топологии split'а.
vi.mock('../stencils/registry', () => ({ getStencilById: () => null }))

const mockCanvas = {
  graphRef: ref(null),
  paperRef: ref(null),
  selectOnly: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useWireSplice } from './useWireSplice'

// Горизонтальный провод a(0,50) → b(200,50). linkView отдаёт геометрию так, будто
// длина вдоль пути = x-координата (провод прямой по y=50).
function makeScene({ withView = true, vertices = [] } = {}) {
  const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
  const a = new shapes.standard.Rectangle({
    position: { x: -10, y: 40 },
    size: { width: 20, height: 20 },
  })
  const b = new shapes.standard.Rectangle({
    position: { x: 190, y: 40 },
    size: { width: 20, height: 20 },
  })
  const cell = new TMSStencil({
    position: { x: 90, y: 90 },
    size: { width: 20, height: 20 },
    tms: { stencilId: 'cell_test_splice' },
    ports: {
      items: [
        { id: 'left', args: { x: 0, y: 10 } },
        { id: 'right', args: { x: 20, y: 10 } },
      ],
    },
  })
  const link = new shapes.standard.Link({
    source: { id: a.id },
    target: { id: b.id, port: 'tp' },
    vertices: vertices.map((v) => ({ ...v })),
  })
  link.set('tms', {
    voltageSource: { tag: 'V', ranges: [] },
    switchSources: { or: ['S'], and: [] },
  })
  graph.addCells([a, b, cell, link])

  const linkView = {
    getClosestPoint: (p) => ({ x: p.x, y: 50 }),
    getClosestPointLength: (p) => p.x,
    getPointAtLength: (len) => ({ x: len, y: 50 }),
  }
  const paper = {
    options: { gridSize: 10 },
    findViewsFromPoint: () => [],
    findViewByModel: (m) => (withView && m.id === link.id ? linkView : null),
  }
  mockCanvas.graphRef.value = graph
  mockCanvas.paperRef.value = paper
  return { graph, a, b, cell, link }
}

describe('spliceCellIntoLink', () => {
  beforeEach(() => {
    mockCanvas.selectOnly.mockClear()
  })

  it('разбивает провод: seg1 перецелен на cell.in, seg2 = cell.out→target', () => {
    const { graph, b, cell, link } = makeScene()
    useWireSplice().spliceCellIntoLink(link, cell, { x: 100, y: 50 })

    expect(graph.getLinks()).toHaveLength(2)
    // seg1 — тот же линк, перецелен на порт ячейки.
    expect(link.get('target').id).toBe(cell.id)
    const portIn = link.get('target').port
    expect(['left', 'right']).toContain(portIn)
    // seg2 — новый линк cell.out → исходный target (с сохранением порта 'tp').
    const seg2 = graph.getLinks().find((l) => l.id !== link.id)
    expect(seg2.get('source').id).toBe(cell.id)
    expect(seg2.get('source').port).not.toBe(portIn) // разные порты прохода
    expect(seg2.get('target')).toEqual({ id: b.id, port: 'tp' })
    expect(mockCanvas.selectOnly).toHaveBeenCalledWith('cell', cell.id)
  })

  it('ячейка наследует voltage/switch провода', () => {
    const { graph, cell, link } = makeScene()
    useWireSplice().spliceCellIntoLink(link, cell, { x: 100, y: 50 })

    expect(cell.get('tms').voltageSource).toEqual({ tag: 'V', ranges: [] })
    expect(cell.get('tms').switchSources).toEqual({ or: ['S'], and: [] })
    // seg2 получает собственный клон (не общая ссылка с ячейкой).
    const seg2 = graph.getLinks().find((l) => l.id !== link.id)
    expect(seg2.get('tms').voltageSource).not.toBe(cell.get('tms').voltageSource)
  })

  it('собственная конфигурация ячейки приоритетнее наследуемой от провода', () => {
    const { cell, link } = makeScene()
    cell.set('tms', { stencilId: 'cell_test_splice', voltageSource: { tag: 'OWN', ranges: [] } })
    useWireSplice().spliceCellIntoLink(link, cell, { x: 100, y: 50 })

    // voltage у ячейки был свой → не перетёрт проводом.
    expect(cell.get('tms').voltageSource).toEqual({ tag: 'OWN', ranges: [] })
    // switch ячейка не имела → наследует от провода.
    expect(cell.get('tms').switchSources).toEqual({ or: ['S'], and: [] })
  })

  it('распределяет изломы по сегментам относительно точки врезки', () => {
    const { graph, cell, link } = makeScene({
      vertices: [
        { x: 50, y: 50 }, // до врезки (x<100) → seg1
        { x: 150, y: 50 }, // после врезки → seg2
      ],
    })
    useWireSplice().spliceCellIntoLink(link, cell, { x: 100, y: 50 })

    expect(link.vertices()).toEqual([{ x: 50, y: 50 }])
    const seg2 = graph.getLinks().find((l) => l.id !== link.id)
    expect(seg2.vertices()).toEqual([{ x: 150, y: 50 }])
  })

  it('при недоступном linkView изломы не теряются (остаются на seg1)', () => {
    const { graph, cell, link } = makeScene({
      withView: false,
      vertices: [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
      ],
    })
    useWireSplice().spliceCellIntoLink(link, cell, { x: 100, y: 50 })

    expect(graph.getLinks()).toHaveLength(2)
    // Распределить нельзя (нет view) → исходные изломы сохранены на переиспользо-
    // ванном линке, а не стёрты.
    expect(link.vertices()).toHaveLength(2)
    const seg2 = graph.getLinks().find((l) => l.id !== link.id)
    expect(seg2.vertices()).toHaveLength(0)
  })
})
