import { describe, it, expect } from 'vitest'
import { computeAlignMoves } from './useAlign'

describe('computeAlignMoves', () => {
  it('край: разные полосы (не пересекаются по перпендикуляру) — обычное выравнивание', () => {
    // top-align: ось Y, перпендикуляр X. X-диапазоны не пересекаются → 2 полосы.
    const boxes = [
      { x: 0, y: 20, width: 20, height: 20 },
      { x: 50, y: 40, width: 20, height: 20 },
    ]
    const moves = computeAlignMoves('top', boxes, 10)
    expect(moves[0]).toEqual({ dx: 0, dy: 0 }) // уже на minY=20
    expect(moves[1]).toEqual({ dx: 0, dy: -20 }) // 40 → 20
  })

  it('centerY: вертикальный стек (одна полоса) — пакуется вплотную, центрирован', () => {
    // одна полоса (X совпадает); min=0,max=60,total=40; центр 30; старт snap(30-20)=10
    const boxes = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 0, y: 40, width: 20, height: 20 },
    ]
    const moves = computeAlignMoves('centerY', boxes, 10)
    expect(moves[0]).toEqual({ dx: 0, dy: 10 }) // y 0 → 10
    expect(moves[1]).toEqual({ dx: 0, dy: -10 }) // y 40 → 30 (касается первого)
  })

  it('left: ряд с общим Y (одна полоса) — пакуется вплотную от левого края', () => {
    const boxes = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 50, y: 0, width: 20, height: 20 },
    ]
    const moves = computeAlignMoves('left', boxes, 10)
    expect(moves[0]).toEqual({ dx: 0, dy: 0 }) // уже на minX=0
    expect(moves[1]).toEqual({ dx: -30, dy: 0 }) // x 50 → 20 (вплотную)
  })

  it('right: одна полоса пакуется к правому краю', () => {
    const boxes = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 50, y: 0, width: 20, height: 20 },
    ]
    // max=70, total=40, старт=30 → box0 x30, box1 x50
    const moves = computeAlignMoves('right', boxes, 10)
    expect(moves[0]).toEqual({ dx: 30, dy: 0 })
    expect(moves[1]).toEqual({ dx: 0, dy: 0 })
  })

  it('одиночная ячейка в полосе = обычное выравнивание (centerX по центру)', () => {
    // одна полоса из 1 (Y не пересекается со второй), но проверим центр X одиночки
    const boxes = [
      { x: 10, y: 0, width: 20, height: 20 },
      { x: 100, y: 100, width: 40, height: 20 },
    ]
    const moves = computeAlignMoves('centerX', boxes, 10)
    // общий minX=10,maxX=140,центр=75; box0(w20): старт snap(75-10)=snap(65)=70 → dx=60
    expect(moves[0]).toEqual({ dx: 60, dy: 0 })
    // box1(w40): старт snap(75-20)=snap(55)=60 → dx=60-100=-40
    expect(moves[1]).toEqual({ dx: -40, dy: 0 })
  })
})
