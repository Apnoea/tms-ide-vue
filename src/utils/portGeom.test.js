// Одна формула «где порт на холсте» на три потребителя: отцепление конца провода
// (svgInjector), индекс портов при импорте (projectLoader) и врезка символа в провод
// (useWireSplice). Раньше формула была скопирована в каждый — расхождение любой копии
// приклеивает провода не туда.
import { describe, it, expect } from 'vitest'
import { dia } from '@joint/core'
import { tmsNamespace, TMSStencil } from '../stencils/tmsStencil'
import { portPoints, portPointAt } from './portGeom'

const JSON_CELL = {
  id: 'c1',
  position: { x: 100, y: 200 },
  size: { width: 20, height: 40 },
  ports: {
    items: [
      { id: 'top', args: { x: 10, y: 0 } },
      { id: 'bottom', args: { x: 10, y: 40 } },
    ],
  },
}

describe('portGeom', () => {
  it('без поворота — позиция плюс локальные координаты порта', () => {
    expect(portPoints(JSON_CELL)).toEqual([
      { id: 'top', x: 110, y: 200 },
      { id: 'bottom', x: 110, y: 240 },
    ])
  })

  it('поворот на 90° вращает порты вокруг центра ячейки', () => {
    const rotated = { ...JSON_CELL, angle: 90 }
    const [top, bottom] = portPoints(rotated)
    // Центр (110,220); верхний порт уходит вправо, нижний — влево.
    expect(top.x).toBeCloseTo(130)
    expect(top.y).toBeCloseTo(220)
    expect(bottom.x).toBeCloseTo(90)
    expect(bottom.y).toBeCloseTo(220)
  })

  it('модель JointJS и её JSON дают одинаковые точки', () => {
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    const cell = new TMSStencil({
      position: { x: 100, y: 200 },
      size: { width: 20, height: 40 },
      angle: 90,
      tms: { stencilId: 'cell_qw' },
      ports: { items: JSON_CELL.ports.items },
    })
    graph.addCell(cell)
    expect(portPoints(cell)).toEqual(portPoints({ ...JSON_CELL, angle: 90 }))
  })

  it('portPointAt: свой порт — его точка, неизвестный — центр ячейки', () => {
    expect(portPointAt(JSON_CELL, 'bottom')).toEqual({ x: 110, y: 240 })
    // Порт удалили из символа: конец провода обязан остаться НА символе, а не уехать
    // в (0,0) — иначе линия улетает в угол схемы.
    expect(portPointAt(JSON_CELL, 'gone')).toEqual({ x: 110, y: 220 })
  })

  it('битые данные не роняют: не ячейка → пусто', () => {
    expect(portPoints(null)).toEqual([])
    expect(portPoints({})).toEqual([])
    expect(portPointAt(undefined, 'top')).toBeNull()
  })
})
