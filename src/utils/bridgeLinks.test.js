// Какие провода едут вместе с выделением ячеек. Провод со СВОБОДНЫМ концом (точкой на
// холсте) обязан попадать в набор: точка ни за чем не следует, и без этого «выделить
// всё и перетащить» растягивало бы линию, оставляя точку на месте.
import { describe, it, expect } from 'vitest'
import { dia, shapes } from '@joint/core'
import { tmsNamespace, TMSStencil } from '../stencils/tmsStencil'
import { computeBridgeLinks } from './bridgeLinks'

function setup(links) {
  const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
  const cell = (id) =>
    new TMSStencil({ id, position: { x: 0, y: 0 }, size: { width: 20, height: 20 } })
  graph.addCells([cell('a'), cell('b'), cell('c')])
  graph.addCells(links.map((l, i) => new shapes.standard.Link({ id: `l${i + 1}`, ...l })))
  return graph
}

describe('computeBridgeLinks', () => {
  it('оба конца в наборе — провод едет с ячейками', () => {
    const graph = setup([{ source: { id: 'a' }, target: { id: 'b' } }])
    expect(computeBridgeLinks(graph, ['a', 'b'])).toEqual([{ kind: 'link', id: 'l1' }])
  })

  it('один конец вне набора — провод не берём (перестроится сам за портом)', () => {
    const graph = setup([{ source: { id: 'a' }, target: { id: 'c' } }])
    expect(computeBridgeLinks(graph, ['a', 'b'])).toEqual([])
  })

  it('конец на ячейке из набора + свободный конец — провод едет целиком', () => {
    const graph = setup([{ source: { id: 'a' }, target: { x: 200, y: 100 } }])
    expect(computeBridgeLinks(graph, ['a'])).toEqual([{ kind: 'link', id: 'l1' }])
  })

  it('оба конца свободны — провод ни к чему не привязан, чужому выделению не подчиняется', () => {
    const graph = setup([{ source: { x: 0, y: 0 }, target: { x: 50, y: 50 } }])
    expect(computeBridgeLinks(graph, ['a', 'b', 'c'])).toEqual([])
  })

  it('свободный конец + конец на ячейке ВНЕ набора — не берём', () => {
    const graph = setup([{ source: { id: 'c' }, target: { x: 200, y: 100 } }])
    expect(computeBridgeLinks(graph, ['a', 'b'])).toEqual([])
  })
})
