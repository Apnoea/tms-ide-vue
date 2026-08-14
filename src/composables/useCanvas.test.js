// Замок (`tms.locked`) = read-only. `paper.interactive` его НЕ защищает: массовые
// операции пишут в модель программно, поэтому единая точка фильтра — writableItems.
import { describe, it, expect, beforeEach } from 'vitest'
import { dia, shapes } from '@joint/core'
import { TMSStencil, TMSShape, tmsNamespace } from '../stencils/tmsStencil'
import { isBackgroundZ } from '../utils/zOrder'
import { useCanvas } from './useCanvas'

function cell({ locked = false, groupId } = {}) {
  const tms = { stencilId: 'cell_qw' }
  if (locked) tms.locked = true
  if (groupId) tms.groupId = groupId
  return new TMSStencil({ position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, tms })
}

function shapeCell() {
  return new TMSShape({
    position: { x: 0, y: 0 },
    size: { width: 20, height: 20 },
    tms: { shape: { type: 'rect', x: 0, y: 0, w: 20, h: 20, stroke: '#000', fill: '#eee' } },
  })
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

  it('writableItems НЕ отбрасывает провода (замка у них нет, диапазоны/булево валидны)', () => {
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

// Порядок наложения. Символы и провода — разные слои: команда двигает только свой,
// и полосы z не пересекаются (иначе символ ушёл бы под провод или наоборот).
describe('useCanvas: reorderCells', () => {
  let canvas
  let graph

  beforeEach(() => {
    canvas = useCanvas()
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    canvas.setCanvasRefs(graph, { id: 'paper' })
  })

  function wire(a, b) {
    return new shapes.standard.Link({ source: { id: a.id }, target: { id: b.id } })
  }

  it('провод «на передний план» получает больший z — мостик рисует он', () => {
    const a = cell()
    const b = cell()
    const w1 = wire(a, b)
    const w2 = wire(a, b)
    graph.addCells([a, b, w1, w2])
    canvas.reorderCells([{ kind: 'link', id: w1.id }], 'front')
    expect(w1.get('z')).toBeGreaterThan(w2.get('z'))
  })

  it('провода остаются под символами, символы не падают ниже нуля', () => {
    const a = cell()
    const b = cell()
    const w = wire(a, b)
    graph.addCells([a, b, w])
    canvas.reorderCells([{ kind: 'link', id: w.id }], 'front')
    canvas.reorderCells([{ kind: 'cell', id: a.id }], 'back')
    expect(a.get('z')).toBeGreaterThanOrEqual(0)
    expect(w.get('z')).toBeLessThan(a.get('z'))
  })

  it('правки идут одним батчем — иначе jumpover не пересчитает соседний провод', () => {
    const a = cell()
    const b = cell()
    const w1 = wire(a, b)
    graph.addCells([a, b, w1, wire(a, b)])
    let stops = 0
    graph.on('batch:stop', () => stops++)
    canvas.reorderCells([{ kind: 'link', id: w1.id }], 'front')
    expect(stops).toBe(1)
  })

  it('команда без эффекта не пишет шаг истории', () => {
    const a = cell()
    const b = cell()
    graph.addCells([a, b])
    canvas.reorderCells([{ kind: 'cell', id: b.id }], 'front') // b и так сверху
    const tick = canvas.snapshotTick.value
    canvas.reorderCells([{ kind: 'cell', id: b.id }], 'front')
    expect(canvas.snapshotTick.value).toBe(tick)
  })
})

// Разметка может уйти НИЖЕ проводов: залитая плашка иначе закрывает их. Отдельной
// команды нет — те же четыре водят фигуру между слоями по краям.
describe('useCanvas: подложка под проводами', () => {
  let canvas
  let graph

  beforeEach(() => {
    canvas = useCanvas()
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    canvas.setCanvasRefs(graph, { id: 'paper' })
  })

  function scene() {
    const a = cell()
    const b = cell()
    const w = new shapes.standard.Link({ source: { id: a.id }, target: { id: b.id }, z: -1000 })
    const shape = shapeCell()
    graph.addCells([a, b, w, shape])
    return { a, b, w, shape }
  }

  it('«на задний план» уводит фигуру под провода', () => {
    const { w, shape } = scene()
    canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'back')
    expect(isBackgroundZ(shape.get('z'))).toBe(true)
    expect(shape.get('z')).toBeLessThan(w.get('z'))
  })

  it('«на передний план» возвращает её наверх, поверх символов', () => {
    const { a, shape } = scene()
    canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'back')
    canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'front')
    expect(isBackgroundZ(shape.get('z'))).toBe(false)
    expect(shape.get('z')).toBeGreaterThan(a.get('z'))
  })

  it('шаг «ниже» уводит в подложку только с дна слоя символов', () => {
    const { a, b, shape } = scene()
    // Сверху: символы ниже фигуры — первый шаг двигает её внутри слоя.
    canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'backward')
    expect(isBackgroundZ(shape.get('z'))).toBe(false)
    expect(shape.get('z')).toBeLessThan(Math.max(a.get('z'), b.get('z')))
    // Опускаем до дна и ещё на шаг — теперь под провода.
    for (let i = 0; i < 3; i++) canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'backward')
    expect(isBackgroundZ(shape.get('z'))).toBe(true)
  })

  it('шаг «выше» из подложки возвращает на дно слоя символов, не наверх', () => {
    const { a, b, shape } = scene()
    canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'back')
    canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'forward')
    expect(isBackgroundZ(shape.get('z'))).toBe(false)
    expect(shape.get('z')).toBeLessThan(Math.min(a.get('z'), b.get('z')))
  })

  it('символ в подложку не уходит: у оборудования дно — ноль', () => {
    const { a } = scene()
    for (let i = 0; i < 3; i++) canvas.reorderCells([{ kind: 'cell', id: a.id }], 'back')
    expect(a.get('z')).toBeGreaterThanOrEqual(0)
  })

  it('перенумерация слоя символов не вытягивает подложку наверх', () => {
    const { a, b, shape } = scene()
    canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'back')
    const bg = shape.get('z')
    canvas.reorderCells([{ kind: 'cell', id: a.id }], 'front')
    canvas.reorderCells([{ kind: 'cell', id: b.id }], 'back')
    expect(shape.get('z')).toBe(bg)
    expect(isBackgroundZ(shape.get('z'))).toBe(true)
  })

  it('перенос между слоями — один батч и один шаг истории', () => {
    const { shape } = scene()
    let stops = 0
    graph.on('batch:stop', () => stops++)
    const tick = canvas.snapshotTick.value
    canvas.reorderCells([{ kind: 'cell', id: shape.id }], 'back')
    expect(stops).toBe(1)
    expect(canvas.snapshotTick.value).toBe(tick + 1)
  })
})
