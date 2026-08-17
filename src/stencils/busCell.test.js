import { describe, it, expect } from 'vitest'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from './tmsStencil'
import {
  busPortX,
  busPortY,
  desiredBusPortCount,
  computeBusPorts,
  busPortIndex,
  buildBusExportSvg,
  buildBusContent,
  busMarkerRadius,
  collectBusMarks,
  BUS_COLOR_DEFAULT,
  BUS_MARKER_FILL,
  setBusThickness,
  BUS_THICKNESS_MAX,
} from './busCell'

/** Минимальный линк для collectBusMarks: он читает только source/target/tms. */
function mockLink({ source = null, target = null, tms = null }) {
  return {
    get(key) {
      if (key === 'source') return source
      if (key === 'target') return target
      if (key === 'tms') return tms
      return undefined
    },
  }
}

/** Ячейка-шина с портами по текущему размеру (как её собирает svgInjector). */
function busCellOf(width, height) {
  return new TMSStencil({
    position: { x: 0, y: 0 },
    size: { width, height },
    tms: { stencilId: 'cell_bus' },
    ports: { items: computeBusPorts(width, height) },
  })
}

describe('bus port math', () => {
  it('busPortX returns step * (index + 1)', () => {
    expect(busPortX(0)).toBe(20)
    expect(busPortX(1)).toBe(40)
    expect(busPortX(4)).toBe(100)
  })

  it('desiredBusPortCount: width / step - 1, минимум 1', () => {
    expect(desiredBusPortCount(80)).toBe(3) // 80/20 - 1 = 3
    expect(desiredBusPortCount(200)).toBe(9)
    expect(desiredBusPortCount(40)).toBe(1) // 40/20 - 1 = 1
    expect(desiredBusPortCount(10)).toBe(1) // clamp to 1
  })

  it('computeBusPorts: один ряд p_* в середине толщины', () => {
    const ports = computeBusPorts(80, 8)
    // desired = 3, и слот один на индекс: сверху и снизу приходят в ту же точку цепи.
    expect(ports).toHaveLength(3)
    expect(ports[0]).toEqual({ id: 'p_0', group: 'port', args: { x: 20, y: 4 } })
    expect(ports[2]).toEqual({ id: 'p_2', group: 'port', args: { x: 60, y: 4 } })
  })

  it('busPortY округляет: порт на дробной координате ушёл бы с сетки', () => {
    expect(busPortY(8)).toBe(4)
    expect(busPortY(15)).toBe(8)
    expect(busPortY(undefined)).toBe(0)
  })
})

describe('busPortIndex', () => {
  it('достаёт индекс из id порта', () => {
    expect(busPortIndex('p_0')).toBe(0)
    expect(busPortIndex('p_12')).toBe(12)
    // Сжатие слева двигает порт-рефы вниз (shiftBusLinkPorts) — индекс уходит в
    // минус до того, как clampBusLinkPorts прижмёт его к нулю.
    expect(busPortIndex('p_-2')).toBe(-2)
    expect(busPortIndex('port')).toBeNaN()
  })
})

describe('цвет шины', () => {
  // Цвет тела — БАЗОВЫЙ: класс tms-range-fill остаётся, и привязанные диапазоны
  // заливают тело поверх него в рантайме.
  it('свой цвет уезжает в fill, без него — дефолт', () => {
    expect(buildBusExportSvg(100, 10, '#ff8800')).toContain('fill="#ff8800"')
    expect(buildBusExportSvg(100, 10)).toContain(`fill="${BUS_COLOR_DEFAULT}"`)
    expect(buildBusExportSvg(100, 10, '#ff8800')).toContain('class="tms-range-fill"')
  })
})

describe('маркеры соединения', () => {
  // Порты в view.svg не идут, а порт лежит в середине толщины: конец провода уходит
  // под тело шины, и без точки соединение не отличить от «провод проходит мимо».
  it('точка только на занятых слотах, в середине толщины', () => {
    const svg = buildBusExportSvg(80, 20, '#000000', [{ index: 1, strokeWidth: 2 }])
    expect(svg).toContain('<circle cx="40" cy="10"')
    expect(svg.match(/<circle/g)).toHaveLength(1)
    expect(buildBusExportSvg(80, 20, '#000000')).not.toContain('<circle')
  })

  it('заливка контрастная, обводка — цветом провода', () => {
    const svg = buildBusExportSvg(80, 8, '#000000', [{ index: 0, color: '#ff8800' }])
    expect(svg).toContain(`fill="${BUS_MARKER_FILL}"`)
    expect(svg).toContain('stroke="#ff8800"')
  })

  it('цвет провода из чужого архива чистится: url(#…) не доезжает до stroke', () => {
    const svg = buildBusExportSvg(80, 8, '#000000', [{ index: 0, color: 'url(#evil)' }])
    expect(svg).not.toContain('url(')
    expect(svg).toContain(`stroke="${BUS_COLOR_DEFAULT}"`)
  })

  it('радиус: не меньше порта на холсте, у толстого провода шире линии', () => {
    expect(busMarkerRadius(2)).toBe(3)
    expect(busMarkerRadius(undefined)).toBe(3)
    expect(busMarkerRadius(6)).toBe(7)
  })

  it('collectBusMarks: слот один раз, даже если проводов в нём несколько', () => {
    const graph = {
      getLinks: () => [
        mockLink({ id: 'l1', source: { id: 'bus', port: 'p_1' }, tms: { strokeColor: '#ff8800' } }),
        // Второй провод в тот же слот — штатно (слот = одна точка цепи).
        mockLink({ id: 'l2', target: { id: 'bus', port: 'p_1' }, tms: { strokeColor: '#00ff00' } }),
        mockLink({ id: 'l3', source: { id: 'bus', port: 'p_2' } }),
        // Чужая ячейка и конец без порта в счёт не идут.
        mockLink({ id: 'l4', source: { id: 'other', port: 'p_0' } }),
        mockLink({ id: 'l5', target: { id: 'bus' } }),
      ],
    }
    expect(collectBusMarks(graph, 'bus')).toEqual([
      { index: 1, color: '#ff8800', strokeWidth: undefined },
      { index: 2, color: undefined, strokeWidth: undefined },
    ])
    expect(collectBusMarks(null, 'bus')).toEqual([])
  })

  it('на холсте точка рисуется в контенте — порты скрыты до hover', () => {
    const cell = busCellOf(80, 8)
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    graph.addCell(cell)
    graph.addCell(
      new shapes.standard.Link({ source: { id: cell.id, port: 'p_0' }, target: { x: 20, y: 300 } })
    )
    const content = buildBusContent({ model: cell })
    const dots = content.filter((el) => el.tagName === 'circle')
    expect(dots).toHaveLength(1)
    expect(dots[0].getAttribute('cx')).toBe('20')
    expect(dots[0].getAttribute('cy')).toBe('4')
  })
})

describe('setBusThickness', () => {
  const paper = { findViewByModel: () => null }
  const MIN = 8 // дефолтная высота cell_bus

  function busOf(height = MIN, width = 80) {
    const cell = busCellOf(width, height)
    // В графе — portProp идёт через port-manager живой ячейки.
    new dia.Graph({}, { cellNamespace: tmsNamespace }).addCell(cell)
    return cell
  }

  const portY = (cell, id) => cell.getPort(id).args.y

  it('порты уезжают в середину новой толщины', () => {
    // Провода привязаны по id и следуют за портом — иначе концы отстали бы от
    // середины потолстевшего тела.
    const cell = busOf()
    expect(setBusThickness(cell, paper, 20, MIN)).toBe(true)
    expect(cell.get('size').height).toBe(20)
    expect(portY(cell, 'p_0')).toBe(10)
    expect(portY(cell, 'p_2')).toBe(10)
  })

  it('количество портов не меняется — оно зависит только от ширины', () => {
    const cell = busOf()
    const before = cell.getPorts().length
    setBusThickness(cell, paper, 30, MIN)
    expect(cell.getPorts().length).toBe(before)
  })

  it('тоньше дефолта не делаем, толще предела — тоже', () => {
    const cell = busOf(20)
    setBusThickness(cell, paper, 1, MIN)
    expect(cell.get('size').height).toBe(MIN)
    setBusThickness(cell, paper, 1000, MIN)
    expect(cell.get('size').height).toBe(BUS_THICKNESS_MAX)
  })

  it('дробное округляется: порты по y дробными быть не должны', () => {
    const cell = busOf()
    setBusThickness(cell, paper, 12.4, MIN)
    expect(cell.get('size').height).toBe(12)
    expect(portY(cell, 'p_0')).toBe(6)
    setBusThickness(cell, paper, 15, MIN)
    expect(portY(cell, 'p_0')).toBe(8)
  })

  it('та же толщина и мусор = no-op', () => {
    const cell = busOf(20)
    expect(setBusThickness(cell, paper, 20, MIN)).toBe(false)
    expect(setBusThickness(cell, paper, NaN, MIN)).toBe(false)
    expect(cell.get('size').height).toBe(20)
  })
})
