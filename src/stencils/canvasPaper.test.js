import { describe, it, expect } from 'vitest'
import { isDuplicateConnection } from './canvasPaper'

/** Линк-мок: только то, что читает isDuplicateConnection. */
function link(source, target) {
  return {
    get: (key) => (key === 'source' ? source : target),
  }
}

/** Граф-мок: getConnectedLinks игнорирует ячейку — набор задаём явно. */
function graphOf(links) {
  return { getConnectedLinks: () => links }
}

const A = { id: 'a' }

describe('isDuplicateConnection', () => {
  it('ловит дубль той же пары портов', () => {
    const graph = graphOf([link({ id: 'a', port: 'out' }, { id: 'b', port: 'in' })])
    expect(
      isDuplicateConnection(graph, A, { srcPort: 'out', tgtId: 'b', tgtPort: 'in', drawn: null })
    ).toBe(true)
  })

  it('ловит дубль в обратном направлении (b→a при рисовании a→b)', () => {
    const graph = graphOf([link({ id: 'b', port: 'in' }, { id: 'a', port: 'out' })])
    expect(
      isDuplicateConnection(graph, A, { srcPort: 'out', tgtId: 'b', tgtPort: 'in', drawn: null })
    ).toBe(true)
  })

  it('другой порт той же пары ячеек — не дубль', () => {
    const graph = graphOf([link({ id: 'a', port: 'out' }, { id: 'b', port: 'in2' })])
    expect(
      isDuplicateConnection(graph, A, { srcPort: 'out', tgtId: 'b', tgtPort: 'in', drawn: null })
    ).toBe(false)
  })

  it('сам рисуемый линк себя не считает дублем', () => {
    const drawn = link({ id: 'a', port: 'out' }, { id: 'b', port: 'in' })
    expect(
      isDuplicateConnection(graphOf([drawn]), A, {
        srcPort: 'out',
        tgtId: 'b',
        tgtPort: 'in',
        drawn,
      })
    ).toBe(false)
  })

  it('недорисованный линк (конец в воздухе) пропускается', () => {
    // Пока конец не сел на порт, source/target хранят координаты без id.
    const graph = graphOf([link({ id: 'a', port: 'out' }, { x: 10, y: 20 })])
    expect(
      isDuplicateConnection(graph, A, { srcPort: 'out', tgtId: 'b', tgtPort: 'in', drawn: null })
    ).toBe(false)
  })
})
