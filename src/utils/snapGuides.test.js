import { describe, it, expect } from 'vitest'
import { guideCandidates, findGuides } from './snapGuides'

const box = (x, y, width = 20, height = 20, ports) => ({ x, y, width, height, ports })

describe('guideCandidates', () => {
  it('на элемент приходится три линии по оси плюс по линии на порт', () => {
    const { xs, ys } = guideCandidates([box(0, 0, 20, 40, [{ x: 10, y: 0 }])])
    expect(xs.map((c) => c.v)).toEqual([0, 10, 20, 10])
    expect(xs.filter((c) => c.kind === 'port')).toHaveLength(1)
    // Линия по X рисуется по вертикали, поэтому её протяжённость — габарит по Y.
    expect(xs[0]).toMatchObject({ from: 0, to: 40 })
    expect(ys.map((c) => c.v)).toEqual([0, 20, 40, 0])
  })
})

describe('findGuides', () => {
  const neighbour = guideCandidates([box(100, 100)])

  it('край почти на краю соседа — притягивает и отдаёт линию', () => {
    const { dx, dy, lines } = findGuides(box(97, 200), neighbour, 5)
    expect(dx).toBe(3) // 97 → 100, левый край на левом крае
    expect(dy).toBe(0)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ axis: 'x', v: 100 })
  })

  it('дальше порога — ни сдвига, ни линий', () => {
    expect(findGuides(box(70, 200), neighbour, 5)).toEqual({ dx: 0, dy: 0, lines: [] })
  })

  it('центр к центру и обе оси сразу', () => {
    // Центр соседа — (110, 110); ставим набор так, чтобы совпали оба центра.
    const { dx, dy, lines } = findGuides(box(102, 98), neighbour, 5)
    expect({ dx, dy }).toEqual({ dx: -2, dy: 2 })
    expect(lines.map((l) => l.axis)).toEqual(['x', 'y'])
  })

  it('порт-в-порт приоритетнее близкого края', () => {
    // Порт соседа на x=105, его левый край — на 100. Порт двигаемого на x=102 (край
    // на 99): по краю ближе, но порты обязаны победить.
    const cands = guideCandidates([box(100, 100, 20, 20, [{ x: 105, y: 100 }])])
    const { dx, lines } = findGuides(box(99, 300, 20, 20, [{ x: 102, y: 300 }]), cands, 5)
    expect(dx).toBe(3) // 102 → 105
    expect(lines[0].v).toBe(105)
  })

  it('линия тянется от дальнего участника до края набора', () => {
    const cands = guideCandidates([box(100, 100, 20, 20), box(100, 400, 20, 20)])
    const { lines } = findGuides(box(100, 250, 20, 20), cands, 5)
    const line = lines.find((l) => l.axis === 'x')
    expect(line).toMatchObject({ v: 100, from: 100, to: 420 })
  })

  it('accept отбрасывает попадание по оси вместе с его линией', () => {
    // Оба центра почти совпали, но сдвиг по X запрещён: остаётся только ось Y.
    const accept = (axis) => axis !== 'x'
    const { dx, dy, lines } = findGuides(box(102, 98), neighbour, 5, accept)
    expect({ dx, dy }).toEqual({ dx: 0, dy: 2 })
    expect(lines.map((l) => l.axis)).toEqual(['y'])
  })

  it('без кандидатов и без бокса ничего не считаем', () => {
    expect(findGuides(box(0, 0), { xs: [], ys: [] }, 5)).toEqual({ dx: 0, dy: 0, lines: [] })
    expect(findGuides(null, neighbour, 5)).toEqual({ dx: 0, dy: 0, lines: [] })
  })
})
