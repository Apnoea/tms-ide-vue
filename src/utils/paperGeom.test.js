import { describe, it, expect } from 'vitest'
import { projectToScreen, rotatedAabb } from './paperGeom'

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
