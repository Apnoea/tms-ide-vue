import { describe, it, expect } from 'vitest'
import { resizeTextCell } from './textCell'

// Мини-мок JointJS-ячейки: size/position + resize/position(). Полноценный dia
// элемент для проверки якоря resizeTextCell не нужен (paper тоже не нужен).
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
