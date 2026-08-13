import { describe, it, expect } from 'vitest'
import { isDuplicateConnection, gridColorFor, CANVAS_BG_DEFAULT } from './canvasPaper'

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

describe('gridColorFor', () => {
  // Точки сетки идут парой к цвету фона (настройка окружения `ui.canvasBg`):
  // отдельной настройки нет, поэтому вариант выбирается по яркости.
  it('на светлом фоне точки тёмные, на тёмном — светлые', () => {
    const onLight = gridColorFor(CANVAS_BG_DEFAULT)
    const onDark = gridColorFor('#101828')
    expect(onLight).not.toBe(onDark)
    expect(gridColorFor('#ffffff')).toBe(onLight)
    expect(gridColorFor('#000000')).toBe(onDark)
  })

  it('короткий hex понимается как полный', () => {
    expect(gridColorFor('#000')).toBe(gridColorFor('#000000'))
    expect(gridColorFor('#fff')).toBe(gridColorFor('#ffffff'))
  })

  it('яркость считается по каналам, а не по сумме: синий тёмный, зелёный светлый', () => {
    // 0.0722 против 0.7152 — при равном «количестве краски» это разные полюса.
    expect(gridColorFor('#0000ff')).toBe(gridColorFor('#000000'))
    expect(gridColorFor('#00ff00')).toBe(gridColorFor('#ffffff'))
  })

  it('не-hex (CSS-имя, мусор из localStorage) не считаем — светлый вариант', () => {
    for (const v of ['black', 'rgb(0,0,0)', 'not-a-color', '', null, undefined]) {
      expect(gridColorFor(v)).toBe(gridColorFor(CANVAS_BG_DEFAULT))
    }
  })
})
