import { describe, it, expect } from 'vitest'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from './tmsStencil'
import { LINK_Z, LINK_Z_TOP, normalizeLinkZ } from './linkDefaults'
import { getStencilById } from './registry'
import {
  reinjectAllStencils,
  syncStencilInstances,
  flipTransform,
  buildPortItems,
  widthResizeMin,
  resizeStencilWidth,
} from './svgInjector'

describe('reinjectAllStencils: z проводов', () => {
  // Мок-paper: без view инъекция SVG пропускается, z-часть выполняется.
  const paper = { findViewByModel: () => null }

  function graphWithLinks() {
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const a = new shapes.standard.Link({ source: { x: 0, y: 0 }, target: { x: 10, y: 0 } })
    const b = new shapes.standard.Link({ source: { x: 0, y: 10 }, target: { x: 10, y: 10 } })
    graph.addCells([a, b])
    return { graph, a, b }
  }

  it('ставит фиксированный LINK_Z и не дрейфит при повторных прогонах', () => {
    const { graph, a, b } = graphWithLinks()
    reinjectAllStencils(graph, paper)
    expect([a.get('z'), b.get('z')]).toEqual([LINK_Z, LINK_Z])
    // Повтор идемпотентен: toBack() здесь уводил бы z в min-1 на каждый вызов —
    // граф расходился бы с undo-снимком и плодил фантомные шаги истории.
    const before = JSON.stringify(graph.toJSON())
    reinjectAllStencils(graph, paper)
    reinjectAllStencils(graph, paper)
    expect(JSON.stringify(graph.toJSON())).toBe(before)
  })

  it('провода уходят под символы (LINK_Z ниже дефолтного z ячеек)', () => {
    const { graph } = graphWithLinks()
    reinjectAllStencils(graph, paper)
    const links = graph.getLinks()
    expect(links.every((l) => l.get('z') < 0)).toBe(true)
  })

  it('порядок внутри полосы сохраняется — reinject не сбрасывает выбор «кто сверху»', () => {
    const { graph, a, b } = graphWithLinks()
    a.set('z', LINK_Z)
    b.set('z', LINK_Z + 3)
    reinjectAllStencils(graph, paper)
    expect([a.get('z'), b.get('z')]).toEqual([LINK_Z, LINK_Z + 3])
  })
})

describe('normalizeLinkZ', () => {
  it('значение из полосы — как есть', () => {
    expect(normalizeLinkZ(LINK_Z + 5)).toBe(LINK_Z + 5)
    expect(normalizeLinkZ(LINK_Z_TOP)).toBe(LINK_Z_TOP)
  })
  it('чужое значение падает на ДНО полосы, а не прижимается к ближайшей границе', () => {
    // Авто-z от JointJS (1) прижался бы к потолку — новый провод оказался бы
    // поверх всех, а несколько таких слиплись бы на одном уровне.
    expect(normalizeLinkZ(1)).toBe(LINK_Z)
    expect(normalizeLinkZ(-5000)).toBe(LINK_Z)
    expect(normalizeLinkZ(undefined)).toBe(LINK_Z)
  })
})

describe('flipTransform', () => {
  it('null без flip', () => {
    expect(flipTransform(40, 20, false, false)).toBeNull()
  })
  it('flipH: зеркало по X в пределах width', () => {
    expect(flipTransform(40, 20, true, false)).toBe('translate(40 0) scale(-1 1)')
  })
  it('flipV: зеркало по Y в пределах height', () => {
    expect(flipTransform(40, 20, false, true)).toBe('translate(0 20) scale(1 -1)')
  })
  it('оба: зеркало по обеим осям', () => {
    expect(flipTransform(40, 20, true, true)).toBe('translate(40 20) scale(-1 -1)')
  })
})

describe('buildPortItems flip', () => {
  const stencil = {
    id: 'cell_x',
    ports: [
      { name: 'p1', x: 5, y: 0 },
      { name: 'p2', x: 35, y: 20 },
    ],
  }
  it('без flip — исходные позиции', () => {
    const items = buildPortItems(stencil, 40, 20)
    expect(items.map((i) => i.args)).toEqual([
      { x: 5, y: 0 },
      { x: 35, y: 20 },
    ])
  })
  it('flipH: x → W-x, y без изменений', () => {
    const items = buildPortItems(stencil, 40, 20, { flipH: true })
    expect(items.map((i) => i.args)).toEqual([
      { x: 35, y: 0 },
      { x: 5, y: 20 },
    ])
  })
  it('flipV: y → H-y, x без изменений', () => {
    const items = buildPortItems(stencil, 40, 20, { flipV: true })
    expect(items.map((i) => i.args)).toEqual([
      { x: 5, y: 20 },
      { x: 35, y: 0 },
    ])
  })
})

describe('syncStencilInstances', () => {
  // Правка символа в редакторе → расставленные экземпляры. Без paper (view = null)
  // инъекция SVG пропускается, модельная часть — порты/размер/провода — работает.
  const paper = { findViewByModel: () => null }
  const PREV = {
    id: 'cell_x',
    width: 40,
    height: 20,
    ports: [
      { name: 'p1', x: 0, y: 10 },
      { name: 'p2', x: 40, y: 10 },
    ],
  }

  function graphWith(cellOpts = {}) {
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const cell = new TMSStencil({
      position: { x: 100, y: 100 },
      size: { width: PREV.width, height: PREV.height },
      tms: { stencilId: 'cell_x' },
      ports: { items: buildPortItems(PREV, PREV.width, PREV.height) },
      ...cellOpts,
    })
    graph.addCell(cell)
    return { graph, cell }
  }

  it('сдвинутый порт: провод остаётся привязанным, позиция берётся из новой версии', () => {
    const { graph, cell } = graphWith()
    const link = new shapes.standard.Link({
      source: { id: cell.id, port: 'p2' },
      target: { x: 300, y: 100 },
    })
    graph.addCell(link)
    const next = { ...PREV, ports: [PREV.ports[0], { name: 'p2', x: 40, y: 0 }] }

    const report = syncStencilInstances(graph, paper, next, PREV)
    expect(report).toEqual({ changed: 1, detached: [] })
    // Ссылка по имени цела — провод сам поедет за портом.
    expect(link.get('source')).toEqual({ id: cell.id, port: 'p2' })
    expect(cell.getPortsPositions('port').p2).toMatchObject({ x: 40, y: 0 })
  })

  it('новый порт появляется у расставленных экземпляров и остаётся рабочим', () => {
    const { graph, cell } = graphWith()
    const next = { ...PREV, ports: [...PREV.ports, { name: 'p3', x: 20, y: 0 }] }
    syncStencilInstances(graph, paper, next, PREV)
    expect(cell.getPorts().map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    // `set('ports', {items})` заменил бы объект целиком и снёс `groups` из
    // defaults TMSStencil: порт остался бы в items, но JointJS падал бы на
    // расчёте позиций (нет layout-колбэка группы) — порты не рисуются.
    expect(Object.keys(cell.get('ports').groups || {})).toEqual(['port'])
    expect(cell.getPortsPositions('port')).toMatchObject({
      p1: { x: 0, y: 10 },
      p2: { x: 40, y: 10 },
      p3: { x: 20, y: 0 },
    })
  })

  it('удалённый порт: конец провода отцепляется в точку, где порт был', () => {
    const { graph, cell } = graphWith()
    const link = new shapes.standard.Link({
      source: { id: cell.id, port: 'p2' },
      target: { x: 300, y: 100 },
    })
    graph.addCell(link)
    const next = { ...PREV, ports: [PREV.ports[0]] }

    const report = syncStencilInstances(graph, paper, next, PREV)
    expect(report.detached).toEqual([link.id])
    // Провод не исчез и не переехал: конец стоит там, где был порт (100+40, 100+10).
    expect(link.get('source')).toEqual({ x: 140, y: 110 })
    expect(cell.getPorts().map((p) => p.id)).toEqual(['p1'])
  })

  it('отцепление учитывает поворот экземпляра', () => {
    const { graph, cell } = graphWith({ angle: 90 })
    const link = new shapes.standard.Link({
      source: { id: cell.id, port: 'p2' },
      target: { x: 300, y: 100 },
    })
    graph.addCell(link)
    syncStencilInstances(graph, paper, { ...PREV, ports: [PREV.ports[0]] }, PREV)
    // Центр 120,110; порт (140,110) при 90° уходит вниз от центра.
    const pt = link.get('source')
    expect(pt.x).toBeCloseTo(120)
    expect(pt.y).toBeCloseTo(130)
  })

  it('габарит подтягивается у экземпляров с дефолтным размером', () => {
    const { graph, cell } = graphWith()
    const next = { ...PREV, height: 30, ports: [{ name: 'p1', x: 0, y: 30 }, PREV.ports[1]] }
    syncStencilInstances(graph, paper, next, PREV)
    expect(cell.get('size')).toEqual({ width: 40, height: 30 })
    // Позиции портов считаются от НОВОГО габарита.
    expect(cell.getPortsPositions('port').p1).toMatchObject({ x: 0, y: 30 })
  })

  it('ресайзнутый экземпляр габарит сохраняет (размер задан пользователем)', () => {
    const { graph, cell } = graphWith({ size: { width: 120, height: 20 } })
    syncStencilInstances(graph, paper, { ...PREV, height: 30 }, PREV)
    expect(cell.get('size')).toEqual({ width: 120, height: 20 })
  })

  it('чужие символы и провода между ними не трогает', () => {
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const other = new TMSStencil({
      position: { x: 0, y: 0 },
      size: { width: 20, height: 20 },
      tms: { stencilId: 'cell_other' },
      ports: { items: [{ id: 'p9', group: 'port', args: { x: 0, y: 10 } }] },
    })
    graph.addCell(other)
    const link = new shapes.standard.Link({
      source: { id: other.id, port: 'p9' },
      target: { x: 50, y: 50 },
    })
    graph.addCell(link)

    const report = syncStencilInstances(graph, paper, { ...PREV, ports: [] }, PREV)
    expect(report).toEqual({ changed: 0, detached: [] })
    expect(link.get('source')).toEqual({ id: other.id, port: 'p9' })
    expect(other.getPorts().map((p) => p.id)).toEqual(['p9'])
  })
})

describe('reinjectAllStencils({ sync: true }): сверка формы с реестром', () => {
  // Форма хранит порты той версии символа, что была на момент сохранения. Символ
  // могли править, пока форма была закрыта, — на её открытии порты обязаны стать
  // такими, как в реестре, иначе новый порт не появился бы никогда. Реестр здесь
  // настоящий (cell_qw из definitions).
  const paper = { findViewByModel: () => null }

  function formWithStaleCell(items) {
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const cell = new TMSStencil({
      position: { x: 100, y: 100 },
      size: { width: 20, height: 20 },
      tms: { stencilId: 'cell_qw' },
      ports: { items },
    })
    graph.addCell(cell)
    return { graph, cell }
  }

  it('порт, добавленный в символ после сохранения формы, появляется на открытии', () => {
    const { graph, cell } = formWithStaleCell([{ id: 'top', group: 'port', args: { x: 10, y: 0 } }])
    const report = reinjectAllStencils(graph, paper, { sync: true })
    expect(report.changed).toBe(1)
    expect(
      cell
        .getPorts()
        .map((p) => p.id)
        .sort()
    ).toEqual(
      getStencilById('cell_qw')
        .ports.map((p) => p.name)
        .sort()
    )
    expect(cell.getPortsPositions('port').top).toMatchObject({ x: 10, y: 0 })
  })

  it('порт, удалённый из символа, отцепляет провод в точку, где порт был', () => {
    const { graph, cell } = formWithStaleCell([
      { id: 'top', group: 'port', args: { x: 10, y: 0 } },
      { id: 'gone', group: 'port', args: { x: 0, y: 5 } },
    ])
    const link = new shapes.standard.Link({
      source: { id: cell.id, port: 'gone' },
      target: { x: 300, y: 100 },
    })
    graph.addCell(link)

    const report = reinjectAllStencils(graph, paper, { sync: true })
    expect(report.detached).toEqual([link.id])
    expect(link.get('source')).toEqual({ x: 100, y: 105 })
    expect(cell.hasPort('gone')).toBe(false)
  })

  it('без sync форма остаётся как есть — undo обязан получить ровно снимок', () => {
    const stale = [{ id: 'top', group: 'port', args: { x: 10, y: 0 } }]
    const { graph, cell } = formWithStaleCell(stale)
    const report = reinjectAllStencils(graph, paper)
    expect(report).toEqual({ changed: 0, detached: [] })
    expect(cell.getPorts().map((p) => p.id)).toEqual(['top'])
  })

  it('повторная сверка ничего не меняет (идемпотентна — не плодит шаги истории)', () => {
    const { graph } = formWithStaleCell([{ id: 'top', group: 'port', args: { x: 10, y: 0 } }])
    reinjectAllStencils(graph, paper, { sync: true })
    const after = JSON.stringify(graph.toJSON())
    expect(reinjectAllStencils(graph, paper, { sync: true })).toEqual({ changed: 0, detached: [] })
    expect(JSON.stringify(graph.toJSON())).toBe(after)
  })
})

describe('syncStencilInstances: программные порты (шина)', () => {
  // У cell_bus портов в stencil.json НЕТ — их строит computeBusPorts по ширине
  // экземпляра. Сверка по определению считала бы все слоты удалёнными и отцепляла
  // ВСЕ провода шины: на загрузке формы схема разъезжалась, маршруты пересчитывались
  // от свободных концов.
  const paper = { findViewByModel: () => null }

  function busForm() {
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const busDef = getStencilById('cell_bus')
    const width = 200
    const bus = new TMSStencil({
      position: { x: 0, y: 400 },
      size: { width, height: busDef.height },
      tms: { stencilId: 'cell_bus' },
      ports: { items: buildPortItems(busDef, width, busDef.height) },
    })
    graph.addCell(bus)
    const link = new shapes.standard.Link({
      source: { id: bus.id, port: 'top_0' },
      target: { x: 300, y: 100 },
      vertices: [{ x: 20, y: 300 }],
    })
    graph.addCell(link)
    return { graph, bus, link, busDef }
  }

  it('провода шины остаются на своих слотах, изломы целы', () => {
    const { graph, bus, link, busDef } = busForm()
    const before = bus.getPorts().length
    const report = syncStencilInstances(graph, paper, busDef)
    expect(report).toEqual({ changed: 0, detached: [] })
    expect(link.get('source')).toEqual({ id: bus.id, port: 'top_0' })
    expect(link.get('vertices')).toEqual([{ x: 20, y: 300 }])
    expect(bus.getPorts()).toHaveLength(before)
  })

  it('слот за краем сжатой шины не сносится (набор портов держит useBusResize)', () => {
    // Такой слот существует именно потому, что на нём висит линия: после сжатия
    // clampBusLinkPorts перенёс провод, а порт остался. Сверка это не её дело.
    const { graph, bus, busDef } = busForm()
    bus.addPort({ id: 'top_99', group: 'port', args: { x: 1980, y: 0 } })
    const far = new shapes.standard.Link({
      source: { id: bus.id, port: 'top_99' },
      target: { x: 500, y: 100 },
    })
    graph.addCell(far)

    syncStencilInstances(graph, paper, busDef)
    expect(bus.hasPort('top_99')).toBe(true)
    expect(far.get('source')).toEqual({ id: bus.id, port: 'top_99' })
  })
})

describe('ресайз ширины символа (resizeX)', () => {
  // Без paper (view = null) перерисовка содержимого пропускается — модельная часть
  // (размер, позиция, кламп) работает и проверяется здесь.
  const paper = { findViewByModel: () => null }

  function valueCell(extraTms = {}) {
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const cell = new TMSStencil({
      position: { x: 100, y: 50 },
      size: { width: 100, height: 20 },
      tms: { stencilId: 'cell_value', ...extraTms },
    })
    graph.addCell(cell)
    return cell
  }

  it('растяжимость объявляет символ, а не код: у cell_value она есть, у cell_qw нет', () => {
    expect(widthResizeMin(valueCell())).toBe(getStencilById('cell_value').minWidth)
    const qw = new TMSStencil({ size: { width: 20, height: 20 }, tms: { stencilId: 'cell_qw' } })
    expect(widthResizeMin(qw)).toBeNull()
  })

  it('замок запрещает ресайз: ручек нет и правка не проходит', () => {
    const cell = valueCell({ locked: true })
    expect(widthResizeMin(cell)).toBeNull()
    // Жест идёт мимо paper.interactive, поэтому отказ обязан быть и в самой правке.
    expect(resizeStencilWidth(cell, paper, 200)).toBe(false)
    expect(cell.get('size').width).toBe(100)
  })

  it('ширина пишется, высота и левый край не трогаются', () => {
    const cell = valueCell()
    expect(resizeStencilWidth(cell, paper, 160)).toBe(true)
    expect(cell.get('size')).toMatchObject({ width: 160, height: 20 })
    expect(cell.get('position')).toMatchObject({ x: 100, y: 50 })
  })

  it('anchorRight держит правый край на месте (левая ручка тянет символ влево)', () => {
    const cell = valueCell()
    resizeStencilWidth(cell, paper, 140, { anchorRight: true })
    const pos = cell.get('position')
    expect(pos.x + cell.get('size').width).toBe(200)
    expect(pos.x).toBe(60)
  })

  it('минимум из stencil.json: уже него не сжать, правый край всё равно на месте', () => {
    const cell = valueCell()
    const min = getStencilById('cell_value').minWidth
    resizeStencilWidth(cell, paper, 5, { anchorRight: true })
    expect(cell.get('size').width).toBe(min)
    // Кламп не должен ломать привязку края: иначе карточка при сжатии «прыгала» бы.
    expect(cell.get('position').x + min).toBe(200)
  })

  it('та же ширина = no-op: вызывающему нечего писать в историю', () => {
    const cell = valueCell()
    expect(resizeStencilWidth(cell, paper, 100)).toBe(false)
  })

  it('сверка с реестром выставленную ширину не сбрасывает', () => {
    // static/minWidth = «габарит свой»: иначе загрузка формы возвращала бы карточке
    // ширину из stencil.json и правка молча терялась.
    const cell = valueCell()
    const graph = cell.graph
    resizeStencilWidth(cell, paper, 180)
    syncStencilInstances(graph, paper, getStencilById('cell_value'))
    expect(cell.get('size').width).toBe(180)
  })
})
