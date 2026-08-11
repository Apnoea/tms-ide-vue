// Покрываем copy/paste-инварианты: bridge-link рефы через oldToNew, angle
// rotated-ячеек, round-trip tms линка (boolSource). Plus
// pair тестов для toast-веток (empty selection / skipped по unknown stencil).
// JointJS Graph + TMSStencil реальные; useCanvas singleton / useToast / registry
// mock'аем чтобы не таскать palette-загрузку и tag-list.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withSetup, makeMockCanvas } from './test-utils'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from '../stencils/tmsStencil'
import { LINK_Z } from '../stencils/linkDefaults'

const mockToast = { add: vi.fn() }
vi.mock('primevue/usetoast', () => ({ useToast: () => mockToast }))

// Фейковый стенсил для getStencilById — materializeStencil сверяется с наличием
// объекта + ports. 'unknown' → null чтобы триггерить skipped-ветку в pasteSnapshots.
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

// Реальные materializeStencil/buildPortItems (тест проверяет настоящие ячейки:
// angle, bridge-рефы), no-op только для injectStencilSvg (DOM-инъекция не нужна,
// paper.findViewByModel → null в тесте и так её пропускает).
vi.mock('../stencils/svgInjector', async (importActual) => ({
  ...(await importActual()),
  injectStencilSvg: vi.fn(),
}))

const mockCanvas = makeMockCanvas({
  selection: { value: [] },
  setSelection: vi.fn((items) => {
    mockCanvas.selection.value = items
  }),
})
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas, genGroupId: () => 'grp-new' }))

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

  it('paste: группа копий получает новый общий groupId; одиночный член разгруппировывается', () => {
    const a = makeCell({ x: 0, tms: { groupId: 'grp-src' } })
    const b = makeCell({ x: 40, tms: { groupId: 'grp-src' } })
    const solo = makeCell({ x: 80, tms: { groupId: 'grp-other' } })
    graph.addCells([a, b, solo])
    mockCanvas.selection.value = [
      { kind: 'cell', id: a.id },
      { kind: 'cell', id: b.id },
      { kind: 'cell', id: solo.id },
    ]

    const { copySelection, pasteClipboard } = setup()
    copySelection()
    pasteClipboard()

    const originals = new Set([a.id, b.id, solo.id])
    const copies = graph.getElements().filter((e) => !originals.has(e.id))
    const byX = (x) => copies.find((c) => c.get('position').x === x)
    // grp-src скопирован целиком (2 члена) → общий НОВЫЙ groupId, не исходный.
    expect(byX(20).get('tms').groupId).toBe('grp-new')
    expect(byX(60).get('tms').groupId).toBe('grp-new')
    // grp-other скопирован одним членом → копия разгруппирована.
    expect(byX(100).get('tms').groupId).toBeUndefined()
  })

  it('paste: изломы bridge-провода сохраняются (сдвинуты на offset)', () => {
    const a = makeCell({ x: 0 })
    const b = makeCell({ x: 100 })
    const link = new shapes.standard.Link({
      source: { id: a.id, port: 'p1' },
      target: { id: b.id, port: 'p1' },
      vertices: [{ x: 50, y: 30 }],
    })
    graph.addCells([a, b, link])
    mockCanvas.selection.value = [
      { kind: 'cell', id: a.id },
      { kind: 'cell', id: b.id },
    ]

    const { copySelection, pasteClipboard } = setup()
    copySelection()
    pasteClipboard() // первый paste → offset = 20

    const newLink = graph.getLinks().find((l) => l.id !== link.id)
    expect(newLink.get('vertices')).toEqual([{ x: 70, y: 50 }])
  })

  it('paste: место bridge-провода в полосе z сохраняется', () => {
    // Провод поднимают ради мостика над соседом (jumpover рисует его тому, кто в
    // коллекции позже). Копия обязана огибать так же, иначе «поднял и продублировал»
    // молча теряет выбор автора.
    const a = makeCell({ x: 0 })
    const b = makeCell({ x: 100 })
    const link = new shapes.standard.Link({
      source: { id: a.id, port: 'p1' },
      target: { id: b.id, port: 'p1' },
    })
    graph.addCells([a, b, link])
    link.set('z', LINK_Z + 5)
    mockCanvas.selection.value = [
      { kind: 'cell', id: a.id },
      { kind: 'cell', id: b.id },
    ]

    const { copySelection, pasteClipboard } = setup()
    copySelection()
    pasteClipboard()

    const newLink = graph.getLinks().find((l) => l.id !== link.id)
    expect(newLink.get('z')).toBe(LINK_Z + 5)
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

  it('paste: tms линка round-trip переносит boolSource на новый линк', () => {
    const a = makeCell({ x: 0 })
    const b = makeCell({ x: 100 })
    const link = new shapes.standard.Link({
      source: { id: a.id },
      target: { id: b.id },
      tms: { boolSource: { groups: [['BR1.ONOFF']] } },
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
    expect(newLink.get('tms')?.boolSource).toEqual({ groups: [['BR1.ONOFF']] })
  })

  it('paste: стиль линка (толщина/цвет) попадает и в tms, и в attrs.line', () => {
    const a = makeCell({ x: 0 })
    const b = makeCell({ x: 100 })
    const link = new shapes.standard.Link({
      source: { id: a.id },
      target: { id: b.id },
      tms: { strokeWidth: 4, strokeColor: '#ff0000' },
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
    expect(newLink.get('tms')).toMatchObject({ strokeWidth: 4, strokeColor: '#ff0000' })
    // Без attrs копия рисовалась бы дефолтной, а после reload «внезапно» цветной.
    expect(newLink.attr('line/strokeWidth')).toBe(4)
    expect(newLink.attr('line/stroke')).toBe('#ff0000')
  })

  // Порядок наложения копий = z оригиналов, а не порядок выделения: выделяют часто
  // рамкой/Ctrl-кликами, и без сортировки «символ поверх шины» переворачивался.
  it('paste: взаимный z-порядок копий повторяет оригиналы (выделение в обратном порядке)', () => {
    const back = makeCell({ x: 0 })
    const front = makeCell({ x: 40 })
    graph.addCells([back, front])
    back.set('z', 1)
    front.set('z', 9)
    // Выделение перечисляет верхнюю ПЕРВОЙ — обход буфера обязан это проигнорировать.
    mockCanvas.selection.value = [
      { kind: 'cell', id: front.id },
      { kind: 'cell', id: back.id },
    ]

    const { copySelection, pasteClipboard } = setup()
    copySelection()
    pasteClipboard()

    const originals = new Set([back.id, front.id])
    const copies = graph.getElements().filter((e) => !originals.has(e.id))
    const copyOf = (x) => copies.find((c) => c.get('position').x === x)
    expect(copyOf(20).get('z')).toBeLessThan(copyOf(60).get('z'))
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
