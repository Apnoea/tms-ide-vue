import { describe, it, expect } from 'vitest'
import { projectToScreen, rotatedAabb, rotatePoint, overlayButtonPositions } from './paperGeom'

describe('projectToScreen', () => {
  it('применяет scale + translate', () => {
    const paper = { scale: () => ({ sx: 2 }), translate: () => ({ tx: 10, ty: 20 }) }
    expect(projectToScreen(paper, 5, 6)).toEqual({ x: 20, y: 32 })
  })
})

describe('rotatedAabb', () => {
  it('0° — рамка как есть', () => {
    expect(rotatedAabb({ x: 5, y: 6 }, { width: 20, height: 30 }, 0)).toEqual({
      x: 5,
      y: 6,
      width: 20,
      height: 30,
    })
  })

  it('90° — ширина/высота меняются местами вокруг центра', () => {
    // центр (20,20); повёрнутые габариты 40×20 → x=0, y=10
    expect(rotatedAabb({ x: 10, y: 0 }, { width: 20, height: 40 }, 90)).toEqual({
      x: 0,
      y: 10,
      width: 40,
      height: 20,
    })
  })
})

describe('rotatePoint', () => {
  const center = { x: 10, y: 20 }

  it('без угла — та же точка', () => {
    expect(rotatePoint({ x: 0, y: 0 }, center, 0)).toEqual({ x: 0, y: 0 })
  })

  it('90° по часовой в экранных осях: точка слева от центра уходит вверх', () => {
    const p = rotatePoint({ x: 0, y: 20 }, center, 90)
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(10)
  })

  it('обратный поворот возвращает исходную точку (им считается вектор жеста)', () => {
    const p = { x: 3, y: 7 }
    const back = rotatePoint(rotatePoint(p, center, 37), center, -37)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('180° отражает точку через центр', () => {
    const p = rotatePoint({ x: 0, y: 0 }, center, 180)
    expect(p.x).toBeCloseTo(20)
    expect(p.y).toBeCloseTo(40)
  })
})

describe('overlayButtonPositions', () => {
  it('повороты по верхним углам, отражения по серединам сторон, удаление снизу справа', () => {
    const pos = overlayButtonPositions({ left: 100, top: 200, right: 140, bottom: 260 })
    expect(pos.rotateCcw).toEqual({ left: '60px', top: '160px' })
    expect(pos.rotateCw).toEqual({ left: '148px', top: '160px' })
    expect(pos.flipH).toEqual({ left: '104px', top: '160px' })
    expect(pos.flipV).toEqual({ left: '60px', top: '214px' })
    expect(pos.delete).toEqual({ left: '148px', top: '268px' })
  })
})
