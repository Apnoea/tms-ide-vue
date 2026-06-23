// Покрываем copy/paste-инварианты: bridge-link рефы через oldToNew, angle
// rotated-ячеек, round-trip tms линка (switchSources). Plus
// pair тестов для toast-веток (empty selection / skipped по unknown stencil).
// JointJS Graph + TMSStencil реальные; useCanvas singleton / useToast / registry
// mock'аем чтобы не таскать palette-загрузку и tag-list.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withSetup, makeMockCanvas } from './test-utils'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from '../stencils/tmsStencil'

const mockToast = { add: vi.fn() }
vi.mock('primevue/usetoast', () => ({ useToast: () => mockToast }))

// Фейковый стенсил для getStencilById — useClipboard сверяется только с
// наличием объекта + ports (для buildPortItems). 'unknown' → null чтобы
// триггерить skipped-ветку в pasteSnapshots.
vi.mock('../stencils/registry', () => ({
  getStencilById: vi.fn((id) => {
    if (!id || id === 'unknown') return null
    return {
      id,
      label: 'Test',
      category: 'Test',
      width: 20,
      height: 20,
      ports: [{ name: 'p1', x: 10, y: 0 }],
    }
  }),
}))

vi.mock('../stencils/svgInjector', () => ({
  buildPortItems: vi.fn(() => [{ id: 'p1', group: 'port' }]),
  injectStencilSvg: vi.fn(),
}))

const mockCanvas = makeMockCanvas({
  selection: { value: [] },
  setSelection: vi.fn((items) => {
    mockCanvas.selection.value = items
  }),
})
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useClipboard } from './useClipboard'

function makeCell({ x = 0, y = 0, stencilId = 'cell_qw', angle = 0, tms = {} } = {}) {
  return new TMSStencil({
    position: { x, y },
    size: { width: 20, height: 20 },
    angle,
    tms: { stencilId, ...tms },
  })
}

describe('useClipboard', () => {
  let scope
  let scheduleSnapshot
  let graph
  let paper

  beforeEach(() => {
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    // findViewByModel → null отключает injectStencilSvg-ветку (мы её замочили в no-op).
    paper = { options: { gridSize: 1 }, findViewByModel: () => null }
    mockCanvas.graphRef.value = graph
    mockCanvas.paperRef.value = paper
    mockCanvas.selection.value = []
    mockCanvas.setSelection.mockClear()
    mockToast.add.mockClear()
    scheduleSnapshot = vi.fn()
  })

  afterEach(() => {
    scope?.stop()
  })

  function setup() {
    const [api, s] = withSetup(() => useClipboard({ scheduleSnapshot }))
    scope = s
    return api
  }

  it('paste: bridge-link перевешивает source/target на новые ячейки (oldToNew)', () => {
    const a = makeCell({ x: 0 })
    const b = makeCell({ x: 100 })
    const link = new shapes.standard.Link({
      source: { id: a.id, port: 'p1' },
      target: { id: b.id, port: 'p1' },
    })
    graph.addCells([a, b, link])
    mockCanvas.selection.value = [
      { kind: 'cell', id: a.id },
      { kind: 'cell', id: b.id },
    ]

    const { copySelection, pasteClipboard } = setup()
    copySelection()
    pasteClipboard()

    const links = graph.getLinks()
    expect(links).toHaveLength(2) // оригинал + новый
    const newLink = links.find((l) => l.id !== link.id)
    // Новый линк ссылается НЕ на оригиналы, а на клоны ячеек — суть теста
    expect(newLink.get('source').id).not.toBe(a.id)
    expect(newLink.get('target').id).not.toBe(b.id)
    // Порты сохраняются (oldToNew переписывает только cell-id)
    expect(newLink.get('source').port).toBe('p1')
    expect(newLink.get('target').port).toBe('p1')
    // Новые cell-id'ы реально присутствуют в графе
    const newCellIds = graph
      .getElements()
      .filter((c) => c.id !== a.id && c.id !== b.id)
      .map((c) => c.id)
    expect(newCellIds).toContain(newLink.get('source').id)
    expect(newCellIds).toContain(newLink.get('target').id)
    expect(scheduleSnapshot).toHaveBeenCalledOnce()
  })

  it('paste: rotated cell сохраняет angle', () => {
    const rotated = makeCell({ angle: 90 })
    graph.addCell(rotated)
    mockCanvas.selection.value = [{ kind: 'cell', id: rotated.id }]

    const { copySelection, pasteClipboard } = setup()
    copySelection()
    pasteClipboard()

    const newCell = graph.getElements().find((c) => c.id !== rotated.id)
    expect(newCell).toBeDefined()
    expect(newCell.angle()).toBe(90)
  })

  it('paste: tms линка round-trip переносит switchSources на новый линк', () => {
    const a = makeCell({ x: 0 })
    const b = makeCell({ x: 100 })
    const link = new shapes.standard.Link({
      source: { id: a.id },
      target: { id: b.id },
      tms: { switchSources: { or: ['BR1.ONOFF'], and: [] } },
    })
    graph.addCells([a, b, link])
    mockCanvas.selection.value = [
      { kind: 'cell', id: a.id },
      { kind: 'cell', id: b.id },
    ]

    const { copySelection, pasteClipboard } = setup()
    copySelection()
    pasteClipboard()

    const newLink = graph.getLinks().find((l) => l.id !== link.id)
    expect(newLink.get('tms')?.switchSources).toEqual({ or: ['BR1.ONOFF'], and: [] })
  })

  it('copySelection: пустое выделение → info-toast, буфер не меняется', () => {
    mockCanvas.selection.value = []
    const { copySelection, hasClipboard } = setup()
    copySelection()
    expect(hasClipboard()).toBe(false)
    expect(mockToast.add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'info', summary: 'Нечего копировать' })
    )
  })

  it('paste: ячейка с unknown stencilId → skipped, в граф не добавлена', () => {
    const ghost = makeCell({ stencilId: 'unknown' })
    graph.addCell(ghost)
    mockCanvas.selection.value = [{ kind: 'cell', id: ghost.id }]

    const { copySelection, pasteClipboard } = setup()
    copySelection()
    pasteClipboard()

    expect(graph.getElements()).toHaveLength(1) // только оригинал
    expect(scheduleSnapshot).not.toHaveBeenCalled() // newCellIds.length === 0
    expect(mockToast.add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warn', summary: 'Не удалось вставить' })
    )
  })

  it('duplicateSelection: одним вызовом snapshot + paste новых ячеек', () => {
    const a = makeCell({ x: 50 })
    graph.addCell(a)
    mockCanvas.selection.value = [{ kind: 'cell', id: a.id }]

    const { duplicateSelection } = setup()
    duplicateSelection()

    expect(graph.getElements()).toHaveLength(2)
    expect(mockToast.add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Дублировано' })
    )
  })
})
