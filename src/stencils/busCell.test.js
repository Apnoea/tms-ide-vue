import { describe, it, expect } from 'vitest'
import { dia } from '@joint/core'
import { TMSStencil, tmsNamespace } from './tmsStencil'
import {
  busPortX,
  desiredBusPortCount,
  computeBusPorts,
  busPortIndex,
  buildBusExportSvg,
  BUS_COLOR_DEFAULT,
  setBusThickness,
  BUS_THICKNESS_MAX,
} from './busCell'

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

  it('computeBusPorts создаёт пары top_*/bot_* с правильными координатами', () => {
    const ports = computeBusPorts(80, 8)
    // desired = 3, значит ожидаем по 3 top и 3 bot = 6 портов
    expect(ports).toHaveLength(6)

    const top0 = ports.find((p) => p.id === 'top_0')
    expect(top0).toEqual({ id: 'top_0', group: 'port', args: { x: 20, y: 0 } })

    const bot2 = ports.find((p) => p.id === 'bot_2')
    expect(bot2).toEqual({ id: 'bot_2', group: 'port', args: { x: 60, y: 8 } })
  })
})

describe('busPortIndex', () => {
  it('достаёт индекс из id порта', () => {
    expect(busPortIndex('top_0')).toBe(0)
    expect(busPortIndex('bot_12')).toBe(12)
    // Сжатие слева двигает порт-рефы вниз (shiftBusLinkPorts) — индекс уходит в
    // минус до того, как clampBusLinkPorts прижмёт его к нулю.
    expect(busPortIndex('top_-2')).toBe(-2)
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

describe('setBusThickness', () => {
  const paper = { findViewByModel: () => null }
  const MIN = 8 // дефолтная высота cell_bus

  function busOf(height = MIN, width = 80) {
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const cell = new TMSStencil({
      position: { x: 0, y: 0 },
      size: { width, height },
      tms: { stencilId: 'cell_bus' },
      ports: { items: computeBusPorts(width, height) },
    })
    graph.addCell(cell)
    return cell
  }

  const portY = (cell, id) => cell.getPort(id).args.y

  it('нижний ряд портов уезжает на новую толщину, верхний остаётся на нуле', () => {
    // Провода привязаны по id и следуют за портом — иначе нижние концы отстали бы
    // от тела шины.
    const cell = busOf()
    expect(setBusThickness(cell, paper, 20, MIN)).toBe(true)
    expect(cell.get('size').height).toBe(20)
    expect(portY(cell, 'bot_0')).toBe(20)
    expect(portY(cell, 'top_0')).toBe(0)
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
    expect(portY(cell, 'bot_0')).toBe(12)
  })

  it('та же толщина и мусор = no-op', () => {
    const cell = busOf(20)
    expect(setBusThickness(cell, paper, 20, MIN)).toBe(false)
    expect(setBusThickness(cell, paper, NaN, MIN)).toBe(false)
    expect(cell.get('size').height).toBe(20)
  })
})
