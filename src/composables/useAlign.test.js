import { describe, it, expect } from 'vitest'
import { computeAlignMoves, computeDistributeMoves } from './useAlign'

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

describe('computeDistributeMoves', () => {
  it('3 ячейки по X — равный интервал, крайние не двигаются', () => {
    // span 0..120, sumW=60, gap=(120-60)/2=30; средняя 30 → 50
    const boxes = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
      { x: 100, y: 0, width: 20, height: 20 },
    ]
    const moves = computeDistributeMoves('x', boxes, 10)
    expect(moves[0]).toEqual({ dx: 0, dy: 0 })
    expect(moves[1]).toEqual({ dx: 20, dy: 0 })
    expect(moves[2]).toEqual({ dx: 0, dy: 0 })
  })

  it('<3 ячеек — нулевые сдвиги', () => {
    const boxes = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 50, y: 0, width: 20, height: 20 },
    ]
    expect(computeDistributeMoves('x', boxes, 10)).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ])
  })

  it('сетка 2×3 — распределяет каждую строку отдельно (сетку не схлопывает)', () => {
    const boxes = [
      { x: 0, y: 0, width: 20, height: 20 }, // строка A
      { x: 30, y: 0, width: 20, height: 20 },
      { x: 100, y: 0, width: 20, height: 20 },
      { x: 0, y: 50, width: 20, height: 20 }, // строка B (не пересекается по Y с A)
      { x: 30, y: 50, width: 20, height: 20 },
      { x: 100, y: 50, width: 20, height: 20 },
    ]
    const moves = computeDistributeMoves('x', boxes, 10)
    expect(moves[1]).toEqual({ dx: 20, dy: 0 }) // середина строки A: 30 → 50
    expect(moves[4]).toEqual({ dx: 20, dy: 0 }) // середина строки B: 30 → 50
    expect(moves[0]).toEqual({ dx: 0, dy: 0 })
    expect(moves[2]).toEqual({ dx: 0, dy: 0 })
    expect(moves[3]).toEqual({ dx: 0, dy: 0 })
    expect(moves[5]).toEqual({ dx: 0, dy: 0 })
  })

  it('3 элемента с разными X и Y — распределяются по X (группы по оси, не по строке)', () => {
    // разные Y (не одна строка), но 3 разные X → 3 группы-колонки → середина едет
    const boxes = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 40, width: 20, height: 20 }, // середина: 20 → 50
      { x: 100, y: 80, width: 20, height: 20 },
    ]
    const moves = computeDistributeMoves('x', boxes, 10)
    expect(moves[0]).toEqual({ dx: 0, dy: 0 })
    expect(moves[1]).toEqual({ dx: 30, dy: 0 })
    expect(moves[2]).toEqual({ dx: 0, dy: 0 })
  })

  it('3 в стопке по одному X — распределение по X = no-op (нечего расходить)', () => {
    const boxes = [
      { x: 10, y: 0, width: 20, height: 20 },
      { x: 10, y: 40, width: 20, height: 20 },
      { x: 10, y: 90, width: 20, height: 20 },
    ]
    // одна X-группа (все перекрываются по X) → <3 групп → no-op по горизонтали
    expect(computeDistributeMoves('x', boxes, 10)).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ])
  })
})
