import { describe, it, expect } from 'vitest'
import { busLineY, busApproachSide, busAttachPlacement } from './busSnap'

// Шина: origin (100, 200), 200×20 → её линия (середина толщины) на y = 210.
const bus = { position: { x: 100, y: 200 }, size: { width: 200, height: 20 } }

describe('busLineY', () => {
  it('линия шины — середина толщины, там же стоят слоты портов', () => {
    expect(busLineY(bus.position, bus.size)).toBe(210)
    expect(busLineY({ x: 0, y: 0 }, { width: 80, height: 8 })).toBe(4)
  })
})

describe('busApproachSide', () => {
  it('сторону считаем от линии, а не от края тела', () => {
    expect(busApproachSide(bus.position, bus.size, { x: 120, y: 209 })).toBe('top')
    expect(busApproachSide(bus.position, bus.size, { x: 120, y: 211 })).toBe('bottom')
    // Внутри тела, но ниже середины — это уже подход снизу.
    expect(busApproachSide(bus.position, bus.size, { x: 120, y: 215 })).toBe('bottom')
  })
})

describe('busAttachPlacement', () => {
  const cellSize = { width: 20, height: 40 }

  it('символ ложится центром на линию шины, вдоль — по снапу к сетке', () => {
    const p = busAttachPlacement(bus, cellSize, { x: 143, y: 260 })
    expect(p.side).toBe('bottom')
    expect(p.angle).toBe(0)
    // Центр по Y на линии (210 - 40/2), по X — снап 143-10=133 → 130.
    expect(p.position).toEqual({ x: 130, y: 190 })
  })

  it('поднесли сверху — разворот на 180°, позиция та же', () => {
    const p = busAttachPlacement(bus, cellSize, { x: 143, y: 150 })
    expect(p).toMatchObject({ side: 'top', angle: 180 })
    // Поворот идёт вокруг центра, а центр всё там же — на линии шины.
    expect(p.position).toEqual({ x: 130, y: 190 })
  })

  it('noRotate: символ не разворачиваем даже сверху', () => {
    const p = busAttachPlacement(bus, cellSize, { x: 143, y: 150 }, { canRotate: false })
    expect(p).toMatchObject({ side: 'top', angle: 0 })
  })

  it('снап вдоль шины идёт по шагу сетки paper’а', () => {
    const p = busAttachPlacement(bus, cellSize, { x: 147, y: 260 }, { gridSize: 5 })
    expect(p.position.x).toBe(135) // 147-10=137 → 135
  })
})
