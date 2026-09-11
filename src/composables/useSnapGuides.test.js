import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const selection = ref([])
const elements = ref([])

/** Ячейка в духе JointJS: `position()` с аргументами — запись, без них — чтение. */
function makeCell(id, x, y, ports = []) {
  const pos = { x, y }
  return {
    id,
    get: (key) => (key === 'position' ? pos : key === 'size' ? { width: 20, height: 20 } : null),
    angle: () => 0,
    position: vi.fn((nx, ny) => {
      pos.x = nx
      pos.y = ny
    }),
    ports: { items: ports.map((p, i) => ({ id: `p${i}`, args: p })) },
  }
}

const graph = {
  getElements: () => elements.value,
  getCell: (id) => elements.value.find((c) => c.id === id) || null,
}
const paper = { scale: () => ({ sx: 1 }), translate: () => ({ tx: 0, ty: 0 }) }

const mockCanvas = {
  graphRef: ref(graph),
  paperRef: ref(paper),
  selection,
  writableItems: (items) =>
    items.map((i) => graph.getCell(i.id)).filter((c) => c && !c.get('tms')?.locked),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

const { useSnapGuides } = await import('./useSnapGuides')

describe('useSnapGuides', () => {
  let sim

  beforeEach(() => {
    selection.value = []
    elements.value = []
    sim = useSnapGuides()
  })

  it('ведущая ячейка притягивается к линии соседа, линия отдаётся в экранных px', () => {
    const lead = makeCell('lead', 97, 300)
    elements.value = [lead, makeCell('other', 100, 100)]
    selection.value = [{ kind: 'cell', id: 'lead' }]

    sim.beginGuides('lead')
    sim.updateGuides(lead, {})

    expect(lead.position).toHaveBeenCalledWith(100, 300)
    expect(sim.guideLines.value).toHaveLength(1)
    // Линия по X вертикальна и тянется от соседа до края набора.
    expect(sim.guideLines.value[0]).toMatchObject({ x1: 100, x2: 100, y1: 100, y2: 320 })
  })

  it('порт двигаемой ячейки притягивается к порту соседа', () => {
    // Порт соседа на x=105 (100 + 5), у ведущей — на x=102: сдвиг +3.
    const lead = makeCell('lead', 97, 300, [{ x: 5, y: 0 }])
    elements.value = [lead, makeCell('other', 100, 100, [{ x: 5, y: 0 }])]
    selection.value = [{ kind: 'cell', id: 'lead' }]

    sim.beginGuides('lead')
    sim.updateGuides(lead, {})

    expect(lead.position).toHaveBeenCalledWith(100, 300)
  })

  it('притяжение, уводящее ведущую с сетки, отбрасывается вместе с линией', () => {
    // Сосед стоит криво (x = 101): встав на его край, ведущая ушла бы на 101 — порты
    // слезли бы с сетки, и провод к ним шёл бы наклонно. Ось Y (300 → 300) не задета.
    const lead = makeCell('lead', 100, 297)
    elements.value = [lead, makeCell('other', 101, 300)]
    selection.value = [{ kind: 'cell', id: 'lead' }]

    sim.beginGuides('lead')
    sim.updateGuides(lead, {})

    expect(lead.position).toHaveBeenCalledWith(100, 300)
    expect(sim.guideLines.value).toHaveLength(1)
    expect(sim.guideLines.value[0]).toMatchObject({ y1: 300, y2: 300 })
  })

  it('Alt отключает притяжение и гасит линии', () => {
    const lead = makeCell('lead', 97, 300)
    elements.value = [lead, makeCell('other', 100, 100)]
    selection.value = [{ kind: 'cell', id: 'lead' }]

    sim.beginGuides('lead')
    sim.updateGuides(lead, { altKey: true })

    expect(lead.position).not.toHaveBeenCalled()
    expect(sim.guideLines.value).toEqual([])
  })

  it('без начала жеста и после его конца ничего не считается', () => {
    const lead = makeCell('lead', 97, 300)
    elements.value = [lead, makeCell('other', 100, 100)]

    sim.updateGuides(lead, {})
    expect(lead.position).not.toHaveBeenCalled()

    sim.beginGuides('lead')
    sim.updateGuides(lead, {})
    expect(sim.guideLines.value).toHaveLength(1)

    sim.endGuides()
    expect(sim.guideLines.value).toEqual([])
    sim.updateGuides(lead, {})
    expect(sim.guideLines.value).toEqual([])
  })

  it('запертую ведущую не двигаем: pointermove приходит и на неё', () => {
    const lead = makeCell('lead', 97, 300)
    lead.get = (key) =>
      key === 'position'
        ? { x: 97, y: 300 }
        : key === 'size'
          ? { width: 20, height: 20 }
          : key === 'tms'
            ? { locked: true }
            : null
    elements.value = [lead, makeCell('other', 100, 100)]

    sim.beginGuides('lead')
    sim.updateGuides(lead, {})

    expect(lead.position).not.toHaveBeenCalled()
    expect(sim.guideLines.value).toEqual([])
  })

  it('запертая ячейка выделения в габарит набора не входит', () => {
    // Locked стоит левее ведущей: войди она в набор, левый край был бы 90 — дальше
    // порога от линии соседа (100), и притяжения не случилось бы вовсе.
    const lead = makeCell('lead', 97, 300)
    const locked = makeCell('locked', 90, 300)
    locked.get = (key) =>
      key === 'position'
        ? { x: 90, y: 300 }
        : key === 'size'
          ? { width: 20, height: 20 }
          : key === 'tms'
            ? { locked: true }
            : null
    elements.value = [lead, locked, makeCell('other', 100, 100)]
    selection.value = [
      { kind: 'cell', id: 'lead' },
      { kind: 'cell', id: 'locked' },
    ]

    sim.beginGuides('lead')
    sim.updateGuides(lead, {})
    expect(lead.position).toHaveBeenCalledWith(100, 300)
  })
})
