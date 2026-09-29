// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  shapeBounds,
  shapesBounds,
  rotateShape90,
  flipShape,
  canRotateShapes,
  canFlipShapes,
  takesStateFill,
} from './shapeSvg'

describe('takesStateFill', () => {
  it('замкнутая фигура без своей заливки — да, со своей — нет', () => {
    expect(takesStateFill({ type: 'rect', fill: 'none' })).toBe(true)
    expect(takesStateFill({ type: 'circle' })).toBe(true)
    expect(takesStateFill({ type: 'polyline', closed: true, fill: 'none' })).toBe(true)
    expect(takesStateFill({ type: 'rect', fill: '#ffffff' })).toBe(false)
    expect(takesStateFill({ type: 'circle', fill: '#facc15' })).toBe(false)
  })

  it('линия, открытая ломаная и подпись — нет', () => {
    expect(takesStateFill({ type: 'line' })).toBe(false)
    expect(takesStateFill({ type: 'polyline', fill: 'none' })).toBe(false)
    expect(takesStateFill({ type: 'text', fill: 'none' })).toBe(false)
  })
})

// Общий габарит фигуры: на нём стоят и обрезка холста, и хит-тест лассо —
// разойдутся, и рамка начнёт ловить не то, что попадёт в границы символа.
describe('shapeBounds', () => {
  it('rect / circle / line / polyline', () => {
    expect(shapeBounds({ type: 'rect', x: 5, y: 6, w: 10, h: 4 })).toEqual({
      x: 5,
      y: 6,
      w: 10,
      h: 4,
    })
    expect(shapeBounds({ type: 'circle', cx: 20, cy: 20, r: 8 })).toEqual({
      x: 12,
      y: 12,
      w: 16,
      h: 16,
    })
    // Линия «справа налево»: габарит нормализован, отрицательной ширины не бывает.
    expect(shapeBounds({ type: 'line', x1: 30, y1: 10, x2: 10, y2: 20 })).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 10,
    })
    expect(
      shapeBounds({
        type: 'polyline',
        points: [
          [4, 8],
          [20, 2],
          [10, 12],
        ],
      })
    ).toEqual({ x: 4, y: 2, w: 16, h: 10 })
  })

  it('эллипс — габарит по разным полуосям', () => {
    expect(shapeBounds({ type: 'circle', cx: 20, cy: 20, rx: 10, ry: 4 })).toEqual({
      x: 10,
      y: 16,
      w: 20,
      h: 8,
    })
  })

  it('подпись — по замеренному габариту (не нулевой)', () => {
    const b = shapeBounds({ type: 'text', x: 10, y: 10, text: 'Wh', fontSize: 10 })
    expect(b.w).toBeGreaterThan(0)
    expect(b.h).toBeGreaterThan(0)
  })

  it('без габарита (нет фигуры / ломаная без вершин) → null', () => {
    expect(shapeBounds(null)).toBeNull()
    expect(shapeBounds({ type: 'polyline', points: [] })).toBeNull()
  })
})

describe('shapesBounds', () => {
  it('объединяет габариты фигур и портов', () => {
    const b = shapesBounds(
      [
        { type: 'rect', x: 10, y: 10, w: 10, h: 10 },
        { type: 'line', x1: 30, y1: 5, x2: 40, y2: 5 },
      ],
      [{ x: 0, y: 25 }]
    )
    expect(b).toEqual({ x: 0, y: 5, w: 40, h: 20 })
  })

  it('пусто (нет фигур / только фигуры без габарита) → null', () => {
    expect(shapesBounds([])).toBeNull()
    expect(shapesBounds([{ type: 'polyline', points: [] }])).toBeNull()
  })
})

describe('rotateShape90 / flipShape', () => {
  const center = { x: 20, y: 20 }

  it('поворот прямоугольника меняет стороны местами вокруг центра', () => {
    const r = rotateShape90({ type: 'rect', x: 10, y: 15, w: 20, h: 10 }, center, 1)
    expect(r).toMatchObject({ x: 15, y: 10, w: 10, h: 20 })
  })

  it('поворот по и против часовой — взаимно обратны', () => {
    const line = { type: 'line', x1: 5, y1: 8, x2: 25, y2: 30 }
    const back = rotateShape90(rotateShape90(line, center, 1), center, -1)
    expect(back).toMatchObject(line)
  })

  it('по часовой в экранных осях: точка справа от центра уходит вниз', () => {
    const p = rotateShape90({ type: 'circle', cx: 30, cy: 20, r: 4 }, center, 1)
    expect(p).toMatchObject({ cx: 20, cy: 30 })
  })

  it('поворот эллипса меняет полуоси', () => {
    const e = rotateShape90({ type: 'circle', cx: 20, cy: 20, rx: 10, ry: 4 }, center, 1)
    expect(e).toMatchObject({ cx: 20, cy: 20, rx: 4, ry: 10 })
  })

  it('отражение по горизонтали зеркалит вершины ломаной', () => {
    const f = flipShape(
      {
        type: 'polyline',
        points: [
          [10, 10],
          [30, 25],
        ],
      },
      center,
      'h'
    )
    expect(f.points).toEqual([
      [30, 10],
      [10, 25],
    ])
  })

  it('отражение дважды возвращает исходное', () => {
    const rect = { type: 'rect', x: 12, y: 14, w: 16, h: 8 }
    expect(flipShape(flipShape(rect, center, 'v'), center, 'v')).toMatchObject(rect)
  })

  it('у подписи горизонтальное отражение инвертирует якорь, вертикальное — нет', () => {
    const text = { type: 'text', x: 10, y: 20, text: 'Wh', align: 'left' }
    expect(flipShape(text, center, 'h')).toMatchObject({ x: 30, align: 'right' })
    expect(flipShape(text, center, 'v')).toMatchObject({ x: 10, align: 'left' })
  })
})

describe('canRotateShapes / canFlipShapes (доступность операции)', () => {
  it('круг: ни поворота, ни отражения — он симметричен', () => {
    const circle = [{ type: 'circle', cx: 20, cy: 20, r: 10 }]
    expect(canRotateShapes(circle)).toBe(false)
    expect(canFlipShapes(circle, 'h')).toBe(false)
    expect(canFlipShapes(circle, 'v')).toBe(false)
  })

  it('эллипс: поворот меняет полуоси, отражение — нет', () => {
    const ellipse = [{ type: 'circle', cx: 20, cy: 20, rx: 10, ry: 4 }]
    expect(canRotateShapes(ellipse)).toBe(true)
    expect(canFlipShapes(ellipse, 'h')).toBe(false)
  })

  it('квадрат: ничего не даёт; прямоугольник: только поворот', () => {
    expect(canRotateShapes([{ type: 'rect', x: 5, y: 5, w: 10, h: 10 }])).toBe(false)
    const rect = [{ type: 'rect', x: 5, y: 5, w: 20, h: 10 }]
    expect(canRotateShapes(rect)).toBe(true)
    expect(canFlipShapes(rect, 'h')).toBe(false)
    expect(canFlipShapes(rect, 'v')).toBe(false)
  })

  it('линия: поворот всегда, отражение — только у наклонной', () => {
    const horizontal = [{ type: 'line', x1: 10, y1: 10, x2: 30, y2: 10 }]
    expect(canRotateShapes(horizontal)).toBe(true)
    // Отражение горизонтальной линии лишь меняет концы местами — рисуется то же.
    expect(canFlipShapes(horizontal, 'h')).toBe(false)
    expect(canFlipShapes(horizontal, 'v')).toBe(false)
    const diagonal = [{ type: 'line', x1: 10, y1: 10, x2: 30, y2: 25 }]
    expect(canFlipShapes(diagonal, 'h')).toBe(true)
  })

  it('ломаная: симметричная не отражается, «уголок» отражается', () => {
    const symmetric = [
      {
        type: 'polyline',
        points: [
          [10, 10],
          [20, 20],
          [30, 10],
        ],
      },
    ]
    expect(canFlipShapes(symmetric, 'h')).toBe(false)
    expect(canFlipShapes(symmetric, 'v')).toBe(true)
    const corner = [
      {
        type: 'polyline',
        points: [
          [10, 10],
          [30, 10],
          [30, 20],
        ],
      },
    ]
    expect(canFlipShapes(corner, 'h')).toBe(true)
  })

  it('одиночная подпись: ни поворота, ни отражения при любом якоре', () => {
    const centered = [{ type: 'text', x: 10, y: 10, text: 'Wh' }]
    expect(canRotateShapes(centered)).toBe(false)
    expect(canFlipShapes(centered, 'h')).toBe(false)
    // Якорь роста правится полем `align`, зеркалить подпись незачем.
    const anchored = [{ type: 'text', x: 10, y: 10, text: 'Wh', align: 'left' }]
    expect(canFlipShapes(anchored, 'h')).toBe(false)
    expect(canFlipShapes(anchored, 'v')).toBe(false)
  })

  it('пачка: доступно, пока меняется взаимное расположение', () => {
    const twoCircles = [
      { type: 'circle', cx: 10, cy: 10, r: 5 },
      { type: 'circle', cx: 30, cy: 10, r: 5 },
    ]
    // По отдельности круги симметричны, но пара из горизонтальной становится
    // вертикальной / меняется местами.
    expect(canRotateShapes(twoCircles)).toBe(true)
    expect(canFlipShapes(twoCircles, 'h')).toBe(true)
    // Вертикальная ось пару на одной высоте не двигает.
    expect(canFlipShapes(twoCircles, 'v')).toBe(false)
  })

  it('пустое выделение — операций нет', () => {
    expect(canRotateShapes([])).toBe(false)
    expect(canFlipShapes(undefined, 'h')).toBe(false)
  })
})
