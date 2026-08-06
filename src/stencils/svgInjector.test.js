import { describe, it, expect } from 'vitest'
import { dia, shapes } from '@joint/core'
import { tmsNamespace } from './tmsStencil'
import { LINK_Z, LINK_Z_TOP, normalizeLinkZ } from './linkDefaults'
import { reinjectAllStencils, flipTransform, buildPortItems } from './svgInjector'

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
