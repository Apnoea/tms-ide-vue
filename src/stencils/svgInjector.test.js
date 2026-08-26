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
  contentTransform,
  scaledSize,
  stencilScale,
  scalableStencil,
  contentScales,
  applyStencilScale,
  STENCIL_SCALE_MAX,
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

  it('маркеры концов пересобираются: свободный конец получает точку на загрузке', () => {
    // `attrs` приезжают из сохранённого graphJson, а точка выводится из привязки
    // конца — без пересборки она появлялась бы только после того, как конец тронули.
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const free = new shapes.standard.Link({ source: { id: 'c1' }, target: { x: 40, y: 40 } })
    graph.addCell(free)
    reinjectAllStencils(graph, paper)
    expect(free.attr('line/targetMarker')).toMatchObject({ type: 'circle' })
    expect(free.attr('line/sourceMarker')).toEqual({ type: 'none' })
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
      source: { id: bus.id, port: 'p_0' },
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
    expect(link.get('source')).toEqual({ id: bus.id, port: 'p_0' })
    expect(link.get('vertices')).toEqual([{ x: 20, y: 300 }])
    expect(bus.getPorts()).toHaveLength(before)
  })

  it('слот за краем сжатой шины не сносится (набор портов держит useBusResize)', () => {
    // Такой слот существует именно потому, что на нём висит линия: после сжатия
    // clampBusLinkPorts перенёс провод, а порт остался. Сверка это не её дело.
    const { graph, bus, busDef } = busForm()
    bus.addPort({ id: 'p_99', group: 'port', args: { x: 1980, y: 0 } })
    const far = new shapes.standard.Link({
      source: { id: bus.id, port: 'p_99' },
      target: { x: 500, y: 100 },
    })
    graph.addCell(far)

    syncStencilInstances(graph, paper, busDef)
    expect(bus.hasPort('p_99')).toBe(true)
    expect(far.get('source')).toEqual({ id: bus.id, port: 'p_99' })
  })
})

describe('масштаб символа: чистые функции', () => {
  const stencil = {
    id: 'cell_x',
    width: 20,
    height: 40,
    ports: [
      { name: 'p1', x: 10, y: 0 },
      { name: 'p2', x: 10, y: 40 },
      { name: 'p3', x: 5, y: 20 },
    ],
  }

  it('stencilScale: дефолт 1, меньше единицы не бывает, потолок клампится', () => {
    expect(stencilScale(undefined)).toBe(1)
    expect(stencilScale({ scale: 0.5 })).toBe(1)
    expect(stencilScale({ scale: 2.5 })).toBe(2.5)
    expect(stencilScale({ scale: 99 })).toBe(STENCIL_SCALE_MAX)
  })

  it('scaledSize: обе стороны садятся на сетку', () => {
    expect(scaledSize(stencil, 1)).toEqual({ width: 20, height: 40 })
    expect(scaledSize(stencil, 2)).toEqual({ width: 40, height: 80 })
    // 20×1.3 = 26 → 25, 40×1.3 = 52 → 50: габарит между клетками увёл бы за собой
    // крайние порты, а с ними концы проводов.
    expect(scaledSize(stencil, 1.3)).toEqual({ width: 25, height: 50 })
  })

  it('порты: крайние липнут к границам, внутренние садятся на сетку', () => {
    const items = buildPortItems(stencil, 40, 80)
    expect(items.map((i) => i.args)).toEqual([
      { x: 20, y: 0 },
      { x: 20, y: 80 },
      { x: 10, y: 40 },
    ])
  })

  it('порт на границе не уезжает внутрь при дробном масштабе', () => {
    // 25/20 = 1.25: y=40 (нижний край) обязан стать 50, а не 50±округление внутрь.
    const items = buildPortItems(stencil, 25, 50)
    expect(items[1].args).toEqual({ x: 15, y: 50 })
    // Внутренний порт (5, 20) → 6.25 / 25 → на сетку.
    expect(items[2].args).toEqual({ x: 5, y: 25 })
  })

  it('программные символы контентом не масштабируются: тянутая шина не растягивается', () => {
    // Их билдеры рисуют по ФАКТИЧЕСКОМУ размеру, поэтому база масштаба = он сам.
    // Иначе тело шины, растянутой за края, уезжало бы во всю ширину холста.
    expect(contentScales(getStencilById('cell_bus'))).toBe(false)
    expect(contentScales(getStencilById('cell_text'))).toBe(false)
    expect(contentScales(getStencilById('cell_node'))).toBe(false)
    expect(contentScales(getStencilById('cell_qw'))).toBe(true)
    // База = фактический размер → трансформа нет вообще.
    expect(contentTransform({ baseWidth: 260, baseHeight: 8, width: 260, height: 8 })).toBeNull()
  })

  it('масштаб и flip складываются в один transform', () => {
    const base = { baseWidth: 20, baseHeight: 40 }
    expect(contentTransform({ ...base, width: 20, height: 40 })).toBeNull()
    expect(contentTransform({ ...base, width: 40, height: 80 })).toBe('scale(2 2)')
    expect(contentTransform({ ...base, width: 40, height: 80, flipH: true })).toBe(
      'translate(40 0) scale(-1 1) scale(2 2)'
    )
    // Снап сторон может дать чуть разные коэффициенты — держим оба, а не средний.
    expect(contentTransform({ ...base, width: 25, height: 50 })).toBe('scale(1.25 1.25)')
  })
})

describe('масштаб символа: применение к экземпляру', () => {
  // Без paper (view = null) перерисовка контента пропускается, модельная часть —
  // размер, позиция, порты, tms — работает.
  const paper = { findViewByModel: () => null }

  function cellOf(stencilId, tms = {}) {
    const stencil = getStencilById(stencilId)
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const cell = new TMSStencil({
      position: { x: 100, y: 50 },
      size: { width: stencil.width, height: stencil.height },
      tms: { stencilId, ...tms },
      ports: { items: buildPortItems(stencil, stencil.width, stencil.height) },
    })
    graph.addCell(cell)
    return cell
  }

  it('масштабируются обычные символы и карточка значения, но не шина / точка / залоченные', () => {
    expect(scalableStencil(cellOf('cell_qw'))).toMatchObject({ id: 'cell_qw' })
    // Карточка значения — тем же жестом, что остальные: своей ширины у неё больше нет.
    expect(scalableStencil(cellOf('cell_value'))).toMatchObject({ id: 'cell_value' })
    expect(scalableStencil(cellOf('cell_bus'))).toBeNull()
    expect(scalableStencil(cellOf('cell_node'))).toBeNull()
    expect(scalableStencil(cellOf('cell_qw', { locked: true }))).toBeNull()
  })

  it('пишет размер, множитель и пересчитывает порты', () => {
    const cell = cellOf('cell_qw') // 20×20, порты по серединам сторон
    expect(applyStencilScale(cell, paper, 2)).toBe(true)
    expect(cell.get('size')).toMatchObject({ width: 40, height: 40 })
    expect(cell.get('tms').scale).toBe(2)
    const args = cell.getPorts().map((p) => p.args)
    expect(args).toEqual([
      { x: 20, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 40 },
      { x: 0, y: 20 },
    ])
  })

  it('позицию берёт от вызывающего (ручка держит свой угол), возврат к ×1 снимает поле', () => {
    const cell = cellOf('cell_qw')
    applyStencilScale(cell, paper, 2, { position: { x: 80, y: 30 } })
    expect(cell.get('position')).toMatchObject({ x: 80, y: 30 })
    expect(applyStencilScale(cell, paper, 1, { position: { x: 100, y: 50 } })).toBe(true)
    expect(cell.get('size')).toMatchObject({ width: 20, height: 20 })
    // ×1 — дефолт: поле не держим, иначе оно уедет в meta пустым фактом.
    expect('scale' in cell.get('tms')).toBe(false)
  })

  it('ниже родного размера не уменьшает, выше потолка не растит', () => {
    const cell = cellOf('cell_qw')
    expect(applyStencilScale(cell, paper, 0.5)).toBe(false)
    applyStencilScale(cell, paper, 99)
    expect(cell.get('tms').scale).toBe(STENCIL_SCALE_MAX)
    expect(cell.get('size')).toMatchObject({ width: 80, height: 80 })
  })

  it('повторный вызов с тем же масштабом ничего не меняет (нет шага истории)', () => {
    const cell = cellOf('cell_qw')
    expect(applyStencilScale(cell, paper, 3)).toBe(true)
    expect(applyStencilScale(cell, paper, 3)).toBe(false)
  })

  it('сверка с реестром уважает масштаб: увеличенный экземпляр не сбрасывается', () => {
    const cell = cellOf('cell_qw')
    applyStencilScale(cell, paper, 2)
    const graph = cell.graph
    syncStencilInstances(graph, paper, getStencilById('cell_qw'))
    expect(cell.get('size')).toMatchObject({ width: 40, height: 40 })
  })
})
