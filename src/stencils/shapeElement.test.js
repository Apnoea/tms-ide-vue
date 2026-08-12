// Фигура-разметка — отдельный тип ячейки без стенсила и портов. Проверяем то, на
// чём держится модель: геометрия живёт в `tms.shape` (редакторский формат), а место
// на холсте — в `position`, поэтому перемещение не трогает геометрию.
import { describe, it, expect } from 'vitest'
import { dia } from '@joint/core'
import { tmsNamespace, TMSShape } from './tmsStencil'
import {
  placeShape,
  materializeShape,
  isShapeCell,
  applyShapePatch,
  resizeShapeCell,
  isShapeResizable,
  moveLineEnd,
} from './shapeElement'

const paper = { findViewByModel: () => null }
const graphOf = () => new dia.Graph({}, { cellNamespace: tmsNamespace })

describe('placeShape', () => {
  it('прижимает фигуру к (0,0) и отдаёт её место габаритом', () => {
    const placed = placeShape({ type: 'rect', x: 120, y: 80, w: 40, h: 20 })
    expect(placed.position).toEqual({ x: 120, y: 80 })
    expect(placed.size).toEqual({ width: 40, height: 20 })
    expect(placed.shape).toMatchObject({ x: 0, y: 0, w: 40, h: 20 })
  })

  it('линия любого наклона: геометрия сохраняется, габарит = её bbox', () => {
    // Из `size` такую линию не вывести — потому геометрию и храним отдельно.
    const placed = placeShape({ type: 'line', x1: 100, y1: 200, x2: 140, y2: 170 })
    expect(placed.position).toEqual({ x: 100, y: 170 })
    expect(placed.size).toEqual({ width: 40, height: 30 })
    expect(placed.shape).toMatchObject({ x1: 0, y1: 30, x2: 40, y2: 0 })
  })

  it('горизонтальная линия получает минимальную толщину под клик', () => {
    // Нулевой габарит нельзя ни выделить, ни подцепить.
    const placed = placeShape({ type: 'line', x1: 0, y1: 50, x2: 60, y2: 50 })
    expect(placed.size).toEqual({ width: 60, height: 1 })
  })

  it('ломаная переносит все точки', () => {
    const placed = placeShape({
      type: 'polyline',
      points: [
        [10, 10],
        [30, 20],
        [10, 40],
      ],
      closed: true,
    })
    expect(placed.position).toEqual({ x: 10, y: 10 })
    expect(placed.size).toEqual({ width: 20, height: 30 })
    expect(placed.shape.points).toEqual([
      [0, 0],
      [20, 10],
      [0, 30],
    ])
    expect(placed.shape.closed).toBe(true)
  })

  it('тип без габарита → null (ячейку не создаём)', () => {
    expect(placeShape({ type: 'polyline', points: [] })).toBeNull()
    expect(placeShape(null)).toBeNull()
  })
})

describe('materializeShape', () => {
  it('создаёт ячейку tms.Shape без stencilId и портов', () => {
    const graph = graphOf()
    const cell = materializeShape(graph, paper, { type: 'rect', x: 10, y: 10, w: 40, h: 20 })
    expect(isShapeCell(cell)).toBe(true)
    expect(cell.get('tms').stencilId).toBeUndefined()
    expect(cell.getPorts()).toEqual([])
    expect(cell.get('position')).toEqual({ x: 10, y: 10 })
    expect(graph.getElements()).toHaveLength(1)
  })

  it('фигура переживает toJSON → fromJSON (autosave формы)', () => {
    const graph = graphOf()
    materializeShape(graph, paper, {
      type: 'circle',
      cx: 50,
      cy: 50,
      rx: 20,
      ry: 10,
      stroke: '#f00',
      strokeWidth: 3,
    })
    const restored = graphOf()
    restored.fromJSON(graph.toJSON())
    const cell = restored.getElements()[0]
    expect(isShapeCell(cell)).toBe(true)
    expect(cell.get('tms').shape).toMatchObject({
      type: 'circle',
      rx: 20,
      ry: 10,
      stroke: '#f00',
      strokeWidth: 3,
    })
    expect(cell.get('size')).toEqual({ width: 40, height: 20 })
  })

  it('символ фигурой не считается', () => {
    const graph = graphOf()
    const stencilCell = new tmsNamespace.tms.Stencil({
      position: { x: 0, y: 0 },
      size: { width: 20, height: 20 },
      tms: { stencilId: 'cell_qw' },
    })
    graph.addCell(stencilCell)
    expect(isShapeCell(stencilCell)).toBe(false)
    expect(isShapeCell(new TMSShape())).toBe(true)
  })
})

describe('applyShapePatch', () => {
  it('меняет вид фигуры, не трогая её место', () => {
    const graph = graphOf()
    const cell = materializeShape(graph, paper, { type: 'rect', x: 10, y: 20, w: 40, h: 20 })
    const changed = applyShapePatch(graph, paper, [cell.id], {
      stroke: '#f00',
      strokeWidth: 4,
      fill: '#eee',
    })
    expect(changed).toBe(1)
    expect(cell.get('tms').shape).toMatchObject({ stroke: '#f00', strokeWidth: 4, fill: '#eee' })
    // Обводка в габарит не входит (как в редакторе), поэтому размер и позиция те же.
    expect(cell.get('position')).toEqual({ x: 10, y: 20 })
    expect(cell.get('size')).toEqual({ width: 40, height: 20 })
  })

  it('подпись: габарит пересчитывается под новый текст', () => {
    const graph = graphOf()
    const cell = materializeShape(graph, paper, {
      type: 'text',
      x: 100,
      y: 100,
      text: 'Ок',
      fontSize: 14,
    })
    const before = cell.get('size').width
    applyShapePatch(graph, paper, [cell.id], { text: 'Очень длинная подпись' })
    // Без пересчёта hit-area и выделение разошлись бы с рисунком.
    expect(cell.get('size').width).toBeGreaterThan(before)
  })

  it('ячейки-символы в пачке пропускает', () => {
    const graph = graphOf()
    const stencilCell = new tmsNamespace.tms.Stencil({
      position: { x: 0, y: 0 },
      size: { width: 20, height: 20 },
      tms: { stencilId: 'cell_qw' },
    })
    const shapeCell = materializeShape(graph, paper, { type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    graph.addCell(stencilCell)

    expect(applyShapePatch(graph, paper, [stencilCell.id, shapeCell.id], { stroke: '#00f' })).toBe(
      1
    )
    expect(stencilCell.get('tms').stroke).toBeUndefined()
    expect(shapeCell.get('tms').shape.stroke).toBe('#00f')
  })
})

describe('resizeShapeCell', () => {
  it('масштабирует геометрию под новый габарит', () => {
    const graph = graphOf()
    const cell = materializeShape(graph, paper, { type: 'rect', x: 0, y: 0, w: 40, h: 20 })
    expect(resizeShapeCell(cell, paper, { x: 0, y: 0, width: 80, height: 40 })).toBe(true)
    expect(cell.get('size')).toEqual({ width: 80, height: 40 })
    expect(cell.get('tms').shape).toMatchObject({ w: 80, h: 40 })
  })

  it('эллипс тянется по полуосям, ломаная — точками', () => {
    const graph = graphOf()
    const ell = materializeShape(graph, paper, { type: 'circle', cx: 10, cy: 10, rx: 10, ry: 10 })
    resizeShapeCell(ell, paper, { x: 0, y: 0, width: 40, height: 20 })
    expect(ell.get('tms').shape).toMatchObject({ rx: 20, ry: 10 })

    const poly = materializeShape(graph, paper, {
      type: 'polyline',
      points: [
        [0, 0],
        [10, 20],
      ],
    })
    resizeShapeCell(poly, paper, { x: 0, y: 0, width: 20, height: 20 })
    expect(poly.get('tms').shape.points).toEqual([
      [0, 0],
      [20, 20],
    ])
  })

  it('горизонтальная линия остаётся прямой при растяжении по вертикали', () => {
    const graph = graphOf()
    const line = materializeShape(graph, paper, { type: 'line', x1: 0, y1: 0, x2: 40, y2: 0 })
    // Локальные y у неё нулевые, поэтому любой вертикальный множитель оставляет
    // их нулями — наклонной прямая стать не может.
    resizeShapeCell(line, paper, { x: 0, y: 0, width: 80, height: 20 })
    const shape = line.get('tms').shape
    expect(shape.x2).toBe(80)
    expect(shape.y1).toBe(shape.y2)
  })

  it('перемещение края переносит фигуру вместе с габаритом', () => {
    const graph = graphOf()
    const cell = materializeShape(graph, paper, { type: 'rect', x: 100, y: 100, w: 40, h: 20 })
    // Тянем за левый край: правый на месте (140), левый уехал на 80.
    resizeShapeCell(cell, paper, { x: 80, y: 100, width: 60, height: 20 })
    expect(cell.get('position')).toEqual({ x: 80, y: 100 })
    expect(cell.get('size')).toEqual({ width: 60, height: 20 })
  })

  it('подпись и заблокированная фигура ручек не получают', () => {
    const graph = graphOf()
    const text = materializeShape(graph, paper, { type: 'text', x: 10, y: 10, text: 'Ок' })
    expect(isShapeResizable(text)).toBe(false)

    const rect = materializeShape(graph, paper, { type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    expect(isShapeResizable(rect)).toBe(true)
    rect.set('tms', { ...rect.get('tms'), locked: true })
    expect(isShapeResizable(rect)).toBe(false)
  })
})

describe('moveLineEnd', () => {
  it('переносит конец линии и пересчитывает габарит', () => {
    const graph = graphOf()
    const line = materializeShape(graph, paper, { type: 'line', x1: 0, y1: 0, x2: 40, y2: 0 })
    expect(moveLineEnd(line, paper, 'p2', { x: 40, y: 30 })).toBe(true)
    // Второй конец уехал вниз: линия стала наклонной, bbox — 40×30.
    expect(line.get('size')).toEqual({ width: 40, height: 30 })
    expect(line.get('tms').shape).toMatchObject({ x1: 0, y1: 0, x2: 40, y2: 30 })
  })

  it('перенос начала вверх-влево сдвигает и позицию ячейки', () => {
    const graph = graphOf()
    const line = materializeShape(graph, paper, {
      type: 'line',
      x1: 100,
      y1: 100,
      x2: 140,
      y2: 100,
    })
    moveLineEnd(line, paper, 'p1', { x: 80, y: 60 })
    expect(line.get('position')).toEqual({ x: 80, y: 60 })
    expect(line.get('size')).toEqual({ width: 60, height: 40 })
  })

  it('не-линию не трогает', () => {
    const graph = graphOf()
    const rect = materializeShape(graph, paper, { type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    expect(moveLineEnd(rect, paper, 'p1', { x: 50, y: 50 })).toBe(false)
  })
})
