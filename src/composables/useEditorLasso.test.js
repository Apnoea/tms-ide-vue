// Хит-тест рамки лассо в редакторе символов. Критерий — ПЕРЕСЕЧЕНИЕ bbox (как
// findModelsInArea на холсте): рамку тянут «примерно», требовать полного охвата
// длинной линии нельзя. Сам жест (порог клика, additive) — в компоненте.
import { describe, it, expect } from 'vitest'
import { hitShapes } from './useEditorLasso'

const rect = (id, x, y, w = 10, h = 10) => ({ id, type: 'rect', x, y, w, h })

describe('hitShapes', () => {
  it('берёт фигуру, пересечённую рамкой, и не берёт лежащую вне', () => {
    const shapes = [rect('a', 0, 0), rect('b', 50, 50)]
    expect(hitShapes(shapes, { x: -5, y: -5, w: 20, h: 20 })).toEqual(['a'])
  })

  it('частичное перекрытие достаточно (рамку тянут «примерно»)', () => {
    expect(hitShapes([rect('a', 0, 0, 40, 40)], { x: 30, y: 30, w: 100, h: 100 })).toEqual(['a'])
  })

  it('горизонтальная линия (h = 0) ловится — касание краями считаем попаданием', () => {
    const line = { id: 'l', type: 'line', x1: 0, y1: 10, x2: 40, y2: 10 }
    expect(hitShapes([line], { x: 5, y: 10, w: 10, h: 0 })).toEqual(['l'])
    expect(hitShapes([line], { x: 5, y: 20, w: 10, h: 5 })).toEqual([])
  })

  it('круг ловится по габаритному квадрату', () => {
    const circle = { id: 'c', type: 'circle', cx: 20, cy: 20, r: 10 }
    expect(hitShapes([circle], { x: 0, y: 0, w: 11, h: 11 })).toEqual(['c'])
    expect(hitShapes([circle], { x: 0, y: 0, w: 5, h: 5 })).toEqual([])
  })

  it('ломаная — по bbox вершин; подпись — по замеренному габариту', () => {
    const poly = {
      id: 'p',
      type: 'polyline',
      points: [
        [0, 0],
        [30, 5],
      ],
    }
    const text = { id: 't', type: 'text', x: 60, y: 60, text: 'Wh', fontSize: 10 }
    expect(hitShapes([poly, text], { x: 20, y: 0, w: 5, h: 10 })).toEqual(['p'])
    expect(hitShapes([poly, text], { x: 55, y: 55, w: 10, h: 10 })).toEqual(['t'])
  })

  it('пустая рамка и пустой список фигур безопасны', () => {
    expect(hitShapes([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
    expect(hitShapes(null, { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
  })
})
