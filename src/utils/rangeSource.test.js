// Откуда берутся диапазоны: зоны символа + тег слота либо собственный источник
// элемента. Правило одно на экспорт, симуляцию и инспектор — разойдись они, схема
// красилась бы в превью иначе, чем в рантайме.
import { describe, it, expect } from 'vitest'
import {
  effectiveRangeSource,
  graphJsonAccess,
  inheritedRangeSource,
  resolveRangeSource,
} from './rangeSource'

const ZONES = [{ min: 0, max: 5, color: '#10b981' }]
const OWN = { tag: 'OWN.TAG', ranges: [{ min: 0, max: 9, color: '#ef4444' }] }

// graphJson формы: ячейки и провода `standard.Link` с концами `{ id }`.
const el = (id, stencilId, tms = {}) => ({ id, tms: { stencilId, ...tms } })
const wire = (id, source, target, tms = {}) => ({
  id,
  type: 'standard.Link',
  source: { id: source },
  target: { id: target },
  tms,
})
const BUS = { tag: 'BUS.U', ranges: ZONES }
const registry = { cell_qw: { id: 'cell_qw', ranges: ZONES }, cell_bus: { id: 'cell_bus' } }
const getStencil = (id) => registry[id]

describe('inheritedRangeSource / resolveRangeSource', () => {
  it('провод у шины берёт её тег и строки; свой источник у провода legacy побеждает', () => {
    const access = graphJsonAccess({
      cells: [el('b', 'cell_bus', { rangeSource: BUS }), el('q', 'cell_qw'), wire('w', 'b', 'q')],
    })
    const w = access.node('w')
    expect(inheritedRangeSource(w, access, getStencil)).toEqual({ ...BUS, from: 'bus' })
    expect(resolveRangeSource(w, access, getStencil)).toEqual({ ...BUS, from: 'bus' })
    const legacy = access.of(wire('w2', 'b', 'q', { rangeSource: OWN }))
    expect(resolveRangeSource(legacy, access, getStencil)).toBe(OWN)
  })

  it('цепь: провод → точка → провод → шина; точка наследует тоже', () => {
    const access = graphJsonAccess({
      cells: [
        el('b', 'cell_bus', { rangeSource: BUS }),
        el('n', 'cell_node'),
        el('q', 'cell_qw'),
        wire('w1', 'b', 'n'),
        wire('w2', 'n', 'q'),
      ],
    })
    expect(resolveRangeSource(access.node('w2'), access, getStencil)).toMatchObject(BUS)
    expect(resolveRangeSource(access.node('n'), access, getStencil)).toMatchObject(BUS)
  })

  it('на одном уровне шина сильнее символа, иначе — source раньше target', () => {
    const sym = el('q', 'cell_qw', { slots: { range: 'Q.VAL' } })
    const busFirst = graphJsonAccess({
      cells: [sym, el('b', 'cell_bus', { rangeSource: BUS }), wire('w', 'q', 'b')],
    })
    expect(inheritedRangeSource(busFirst.node('w'), busFirst, getStencil).from).toBe('bus')
    const twoSymbols = graphJsonAccess({
      cells: [sym, el('q2', 'cell_qw', { slots: { range: 'Q2.VAL' } }), wire('w', 'q', 'q2')],
    })
    expect(inheritedRangeSource(twoSymbols.node('w'), twoSymbols, getStencil)).toEqual({
      tag: 'Q.VAL',
      ranges: ZONES,
      from: 'symbol',
    })
  })

  it('ближний источник побеждает дальний, свободный конец и цикл безопасны', () => {
    // Символ прямо на конце (уровень 1) против шины за точкой (уровень 3).
    const access = graphJsonAccess({
      cells: [
        el('q', 'cell_qw', { slots: { range: 'Q.VAL' } }),
        el('n', 'cell_node'),
        el('b', 'cell_bus', { rangeSource: BUS }),
        wire('w', 'q', 'n'),
        wire('w2', 'n', 'b'),
        wire('loop', 'n', 'n'),
      ],
    })
    expect(inheritedRangeSource(access.node('w'), access, getStencil).tag).toBe('Q.VAL')
    // Провод в воздух: `{x, y}` вместо `{id}` — источника нет.
    const free = access.of({ id: 'f', type: 'standard.Link', source: { x: 1, y: 2 }, target: {} })
    expect(inheritedRangeSource(free, access, getStencil)).toBeNull()
  })

  it('символ и шина не наследуют — только своё', () => {
    const access = graphJsonAccess({
      cells: [el('b', 'cell_bus', { rangeSource: BUS }), el('q', 'cell_qw'), wire('w', 'b', 'q')],
    })
    expect(resolveRangeSource(access.node('q'), access, getStencil)).toBeNull()
  })
})

describe('effectiveRangeSource', () => {
  it('зоны символа + тег слота `range`', () => {
    const out = effectiveRangeSource({ slots: { range: 'PT1.VALUE' } }, { ranges: ZONES })
    expect(out).toEqual({ tag: 'PT1.VALUE', ranges: ZONES })
  })

  it('провод и шина: собственный источник элемента', () => {
    expect(effectiveRangeSource({ rangeSource: OWN }, null)).toBe(OWN)
    // Символ без зон — тоже свой источник (шина, прошлые схемы).
    expect(effectiveRangeSource({ rangeSource: OWN }, { ranges: [] })).toBe(OWN)
  })

  it('зоны есть, тег не привязан — работает источник прошлых схем', () => {
    // Иначе перенос диапазонов в символ погасил бы цвет на уже нарисованных формах.
    expect(effectiveRangeSource({ rangeSource: OWN }, { ranges: ZONES })).toBe(OWN)
  })

  it('привязанный тег зон перебивает собственный источник', () => {
    const out = effectiveRangeSource(
      { slots: { range: 'PT1.VALUE' }, rangeSource: OWN },
      { ranges: ZONES }
    )
    expect(out).toEqual({ tag: 'PT1.VALUE', ranges: ZONES })
  })

  it('нет ни зон, ни источника — null', () => {
    expect(effectiveRangeSource({}, null)).toBeNull()
    expect(effectiveRangeSource({ slots: {} }, { ranges: ZONES })).toBeNull()
  })
})
