import { describe, it, expect } from 'vitest'
import {
  buildNodeExportSvg,
  nodeSize,
  NODE_COLOR_DEFAULT,
  NODE_SIZE_DEFAULT,
  NODE_SIZE_MAX,
} from './nodeCell'

// Точка соединения рисуется программно: вид (цвет и диаметр) задаёт автор в tms, а
// габарит ячейки остаётся прежним — он держит hit-area и порт `center`.

describe('nodeSize', () => {
  it('дефолт при пустом и мусорном значении', () => {
    for (const v of [undefined, null, NaN, 'abc']) expect(nodeSize(v)).toBe(NODE_SIZE_DEFAULT)
  })

  it('клампится в [дефолт, габарит ячейки] и округляется', () => {
    expect(nodeSize(1)).toBe(NODE_SIZE_DEFAULT)
    expect(nodeSize(1000)).toBe(NODE_SIZE_MAX)
    expect(nodeSize(6.4)).toBe(6)
  })
})

describe('buildNodeExportSvg', () => {
  it('точка стоит в центре ячейки, радиус — половина диаметра', () => {
    const svg = buildNodeExportSvg(20, 20, { dotSize: 8 })
    expect(svg).toContain('cx="10"')
    expect(svg).toContain('cy="10"')
    expect(svg).toContain('r="4"')
  })

  it('свой цвет уезжает в fill, без него — дефолт; класс заливки остаётся', () => {
    // tms-range-fill — opt-in заливки цветом диапазона: свой цвет БАЗОВЫЙ, рантайм
    // красит точку поверх него.
    expect(buildNodeExportSvg(20, 20, { color: '#ff8800' })).toContain('fill="#ff8800"')
    expect(buildNodeExportSvg(20, 20, {})).toContain(`fill="${NODE_COLOR_DEFAULT}"`)
    expect(buildNodeExportSvg(20, 20, {})).toContain('class="tms-range-fill"')
  })

  it('чужой цвет из архива не доезжает до атрибута', () => {
    expect(buildNodeExportSvg(20, 20, { color: 'url(#evil)' })).toContain(
      `fill="${NODE_COLOR_DEFAULT}"`
    )
  })
})
