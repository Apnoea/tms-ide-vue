import { describe, it, expect } from 'vitest'
import {
  resolveValueDisplay,
  busPortX,
  desiredBusPortCount,
  computeBusPorts,
  resizeTextCell,
  flipTransform,
  buildPortItems,
} from './svgInjector'

// Мини-мок JointJS-ячейки: size/position + resize/position(). Достаточно для
// проверки якорной логики resizeTextCell (сдвиг позиции при смене ширины).
function mockCell(x, y, w, h) {
  const state = { size: { width: w, height: h }, position: { x, y } }
  return {
    get: (k) => state[k],
    resize: (nw, nh) => {
      state.size = { width: nw, height: nh }
    },
    position: (nx, ny) => {
      state.position = { x: nx, y: ny }
    },
    _state: state,
  }
}

describe('resolveValueDisplay', () => {
  it('maps known current suffix to amperes', () => {
    expect(resolveValueDisplay('PS031VV001.IA')).toEqual({ label: 'Ia', unit: 'А' })
  })

  it('maps known voltage suffix to volts', () => {
    expect(resolveValueDisplay('PS031TN001.UA')).toEqual({ label: 'Ua', unit: 'В' })
  })

  it('maps cosphi to no unit', () => {
    expect(resolveValueDisplay('PS031VV001.COSF')).toEqual({ label: 'cosφ', unit: '' })
  })

  it('falls back to suffix as label for unknown suffix', () => {
    expect(resolveValueDisplay('PS031X.WHATEVER')).toEqual({ label: 'WHATEVER', unit: '' })
  })

  it('handles empty/missing tag', () => {
    expect(resolveValueDisplay('')).toEqual({ label: '?', unit: '' })
    expect(resolveValueDisplay(undefined)).toEqual({ label: '?', unit: '' })
  })
})

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

describe('resizeTextCell (якорь align)', () => {
  it('left (дефолт): позиция не двигается — блок растёт вправо', () => {
    const cell = mockCell(100, 50, 40, 20)
    resizeTextCell(cell, 60, 20, 'left')
    expect(cell._state.size).toEqual({ width: 60, height: 20 })
    expect(cell._state.position).toEqual({ x: 100, y: 50 })
  })

  it('right: правый край на месте — при росте сдвигаемся влево', () => {
    const cell = mockCell(100, 50, 40, 20)
    // ширина 40 → 60 (+20): x должен уменьшиться на 20 (правый край 140 держится).
    resizeTextCell(cell, 60, 20, 'right')
    expect(cell._state.position).toEqual({ x: 80, y: 50 })
    expect(100 + 40).toBe(80 + 60) // правый край не сдвинулся
  })

  it('center: центр на месте — сдвиг на половину дельты', () => {
    const cell = mockCell(100, 50, 40, 20)
    // ширина 40 → 60 (+20): x -= 10, центр 120 держится.
    resizeTextCell(cell, 60, 20, 'center')
    expect(cell._state.position).toEqual({ x: 90, y: 50 })
  })

  it('ширина не изменилась → позицию не трогаем даже при right', () => {
    const cell = mockCell(100, 50, 40, 20)
    resizeTextCell(cell, 40, 24, 'right')
    expect(cell._state.position).toEqual({ x: 100, y: 50 })
  })
})
