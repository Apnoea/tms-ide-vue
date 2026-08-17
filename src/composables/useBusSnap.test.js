import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { dia } from '@joint/core'
import { TMSStencil, tmsNamespace } from '../stencils/tmsStencil'
import { computeBusPorts } from '../stencils/busCell'
import { getStencilById } from '../stencils/registry'
import { useCanvas } from './useCanvas'
import { useBusSnap } from './useBusSnap'

function makeBus(graph, { x = 100, y = 200, width = 200, height = 20, z = 5 } = {}) {
  const cell = new TMSStencil({
    position: { x, y },
    size: { width, height },
    z,
    tms: { stencilId: 'cell_bus' },
    ports: { items: computeBusPorts(width, height) },
  })
  graph.addCell(cell)
  return cell
}

/** Ячейка символа по определению из реестра (габарит как при drop'е из палитры). */
function makeSymbol(graph, stencilId, { x = 0, y = 0, z = 10 } = {}) {
  const stencil = getStencilById(stencilId)
  const cell = new TMSStencil({
    position: { x, y },
    size: { width: stencil.width, height: stencil.height },
    z,
    tms: { stencilId },
  })
  graph.addCell(cell)
  return cell
}

describe('useBusSnap', () => {
  let graph
  let snap

  beforeEach(() => {
    setActivePinia(createPinia())
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    useCanvas().setCanvasRefs(graph, null)
    snap = useBusSnap()
  })

  it('находит шину в зоне подноса и игнорирует далёкую точку', () => {
    const bus = makeBus(graph)
    // Линия шины на y=210, допуск — 20 плюс полтолщины.
    expect(snap.findBusAtPoint({ x: 140, y: 235 })?.id).toBe(bus.id)
    expect(snap.findBusAtPoint({ x: 140, y: 400 })).toBeNull()
    // По X — только в пределах тела.
    expect(snap.findBusAtPoint({ x: 50, y: 210 })).toBeNull()
  })

  it('замок шины запрещает приём символов', () => {
    const bus = makeBus(graph)
    bus.set('tms', { ...bus.get('tms'), locked: true })
    expect(snap.findBusAtPoint({ x: 140, y: 210 })).toBeNull()
  })

  it('символ ложится центром на шину, закрепляется и оказывается поверх тела', () => {
    const bus = makeBus(graph)
    // z ниже шины: перетащить на неё могли и тот символ, что лежал под ней.
    const cell = makeSymbol(graph, 'cell_qr', { x: 500, y: 500, z: 1 })
    expect(snap.attachToBus(bus, cell, { x: 143, y: 260 })).toBe(true)

    const pos = cell.get('position')
    const size = cell.get('size')
    expect(pos.y + size.height / 2).toBe(210) // центр на линии шины
    expect(pos.x).toBe(130) // снап вдоль: 143 - 10 → 130
    expect(cell.get('tms').busId).toBe(bus.id)
    expect(cell.get('z')).toBeGreaterThan(bus.get('z'))
    // Проводов не появляется: символ на шине не соединяется, он на ней лежит.
    expect(graph.getLinks()).toHaveLength(0)
  })

  it('поднесли сверху — символ разворачивается на 180°', () => {
    const bus = makeBus(graph)
    const cell = makeSymbol(graph, 'cell_qr')
    snap.attachToBus(bus, cell, { x: 140, y: 100 })
    expect(cell.angle()).toBe(180)
    // Центр всё равно на линии — поворот идёт вокруг него.
    expect(cell.get('position').y + cell.get('size').height / 2).toBe(210)
  })

  it('noRotate-символ на шину ложится, но не разворачивается', () => {
    const bus = makeBus(graph)
    const cell = makeSymbol(graph, 'cell_pi') // noRotate в определении
    snap.attachToBus(bus, cell, { x: 140, y: 100 })
    expect(cell.angle()).toBe(0)
    expect(cell.get('tms').busId).toBe(bus.id)
  })

  it('шина тянет закреплённые за собой, кроме тех, что двигаются сами', () => {
    const bus = makeBus(graph)
    const a = makeSymbol(graph, 'cell_qr')
    const b = makeSymbol(graph, 'cell_qr')
    snap.attachToBus(bus, a, { x: 140, y: 260 })
    snap.attachToBus(bus, b, { x: 200, y: 260 })
    const aPos = { ...a.get('position') }
    const bPos = { ...b.get('position') }

    // b «уже сдвинут своим жестом» (multi-drag) — иначе уехал бы на двойную дельту.
    snap.followBus(bus, 30, -10, new Set([b.id]))
    expect(a.get('position')).toEqual({ x: aPos.x + 30, y: aPos.y - 10 })
    expect(b.get('position')).toEqual(bPos)
  })

  it('снятие с шины убирает закрепление, но символ не двигает', () => {
    const bus = makeBus(graph)
    const cell = makeSymbol(graph, 'cell_qr')
    snap.attachToBus(bus, cell, { x: 140, y: 260 })
    const pos = { ...cell.get('position') }

    expect(snap.detachFromBus(cell)).toBe(true)
    expect(cell.get('tms').busId).toBeUndefined()
    expect(cell.get('position')).toEqual(pos)
    // Второй раз снимать нечего.
    expect(snap.detachFromBus(cell)).toBe(false)
  })

  it('удаление шины снимает закрепление — иначе ссылка в пустоту', () => {
    const bus = makeBus(graph)
    const cell = makeSymbol(graph, 'cell_qr')
    snap.attachToBus(bus, cell, { x: 140, y: 260 })
    snap.releaseBus(bus)
    expect(cell.get('tms').busId).toBeUndefined()
  })

  it('syncBusAttachment кладёт символ, отпущенный на шине, и не трогает далёкий', () => {
    const bus = makeBus(graph)
    const near = makeSymbol(graph, 'cell_qr', { x: 130, y: 195 }) // центр (140, 215)
    expect(snap.syncBusAttachment(near)).toBe(true)
    expect(near.get('tms').busId).toBe(bus.id)

    const far = makeSymbol(graph, 'cell_qr', { x: 130, y: 500 })
    expect(snap.syncBusAttachment(far)).toBe(false)
    expect(far.get('tms').busId).toBeUndefined()
  })

  it('символ, уведённый с шины, теряет закрепление и за ней больше не едет', () => {
    const bus = makeBus(graph)
    const cell = makeSymbol(graph, 'cell_qr')
    snap.attachToBus(bus, cell, { x: 140, y: 230 })
    expect(cell.get('tms').busId).toBe(bus.id)

    // Утащили мышью в сторону — жест «убрал с шины», меню тут не при чём.
    cell.position(600, 600)
    expect(snap.syncBusAttachment(cell)).toBe(true)
    expect(cell.get('tms').busId).toBeUndefined()

    const pos = { ...cell.get('position') }
    snap.followBus(bus, 50, 50)
    expect(cell.get('position')).toEqual(pos)
  })

  it('перетащили на другую шину — закрепление переезжает', () => {
    const first = makeBus(graph)
    const second = makeBus(graph, { y: 600 })
    const cell = makeSymbol(graph, 'cell_qr')
    snap.attachToBus(first, cell, { x: 140, y: 230 })

    cell.position(130, 590) // центр (140, 610) — зона второй шины
    expect(snap.syncBusAttachment(cell)).toBe(true)
    expect(cell.get('tms').busId).toBe(second.id)
  })

  it('шину на шину и заблокированный символ не кладём', () => {
    makeBus(graph)
    const otherBus = makeBus(graph, { x: 100, y: 205 })
    expect(snap.syncBusAttachment(otherBus)).toBe(false)
    const locked = makeSymbol(graph, 'cell_qr', { x: 130, y: 195 })
    locked.set('tms', { ...locked.get('tms'), locked: true })
    expect(snap.syncBusAttachment(locked)).toBe(false)
  })

  it('превью совпадает с раскладкой drop’а, вне шины его нет', () => {
    makeBus(graph)
    // Точка в зоне шины (линия 210, допуск 30) — иначе превью и не должно быть.
    snap.updateBusSnapPreview('cell_qr', { x: 143, y: 230 })
    const stencil = getStencilById('cell_qr')
    expect(snap.busSnapPreview.value).toEqual({ angle: 0, cx: 140, cy: 210 })
    expect(stencil.height).toBeGreaterThan(0)

    snap.updateBusSnapPreview('cell_qr', { x: 143, y: 500 })
    expect(snap.busSnapPreview.value).toBeNull()
  })
})
