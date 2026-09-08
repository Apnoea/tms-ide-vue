import { describe, it, expect } from 'vitest'
import {
  EMPTY_TICKS,
  currentTick,
  pushTick,
  backTick,
  forwardTick,
  truncateAfterCurrent,
  replaceCurrentTick,
} from './tickHistory'

const tick = (v) => new Map([['T1', v]])
/** Значения тега по шагам — по ним видно и порядок, и позицию просмотра. */
const values = (state) => state.ticks.map((t) => t.get('T1'))

describe('pushTick', () => {
  it('новый тик встаёт последним шагом и становится текущим', () => {
    let s = pushTick(EMPTY_TICKS, tick(1), 3)
    s = pushTick(s, tick(2), 3)
    expect(values(s)).toEqual([1, 2])
    expect(s.index).toBe(1)
    expect(currentTick(s).get('T1')).toBe(2)
  })

  it('за пределом глубины уходят самые старые', () => {
    let s = EMPTY_TICKS
    for (const v of [1, 2, 3, 4, 5]) s = pushTick(s, tick(v), 3)
    expect(values(s)).toEqual([3, 4, 5])
    expect(s.index).toBe(2)
  })

  it('исходное состояние не мутируется', () => {
    const before = pushTick(EMPTY_TICKS, tick(1), 3)
    pushTick(before, tick(2), 3)
    expect(values(before)).toEqual([1])
    expect(EMPTY_TICKS.ticks).toEqual([])
  })
})

describe('backTick / forwardTick', () => {
  const three = [1, 2, 3].reduce((s, v) => pushTick(s, tick(v), 10), EMPTY_TICKS)

  it('шаг назад двигает позицию, набор берётся из истории', () => {
    const back = backTick(three)
    expect(back.index).toBe(1)
    expect(currentTick(back).get('T1')).toBe(2)
  })

  it('с первого тика и с пустой истории назад некуда', () => {
    expect(backTick({ ticks: [tick(1)], index: 0 })).toBeNull()
    expect(backTick(EMPTY_TICKS)).toBeNull()
  })

  it('шаг вперёд идёт по истории, а с её конца требует новый тик', () => {
    const back = backTick(three)
    const fwd = forwardTick(back)
    expect(fwd.needsNew).toBe(false)
    expect(currentTick(fwd.state).get('T1')).toBe(3)
    expect(forwardTick(three).needsNew).toBe(true)
    expect(forwardTick(EMPTY_TICKS).needsNew).toBe(true)
  })
})

describe('truncateAfterCurrent / replaceCurrentTick', () => {
  const three = [1, 2, 3].reduce((s, v) => pushTick(s, tick(v), 10), EMPTY_TICKS)

  it('обрезка снимает шаги после текущей позиции', () => {
    const s = truncateAfterCurrent(backTick(three))
    expect(values(s)).toEqual([1, 2])
    expect(s.index).toBe(1)
  })

  it('на последнем шаге обрезать нечего', () => {
    expect(truncateAfterCurrent(three)).toBe(three)
  })

  it('замена набора не двигает позицию и не добавляет шаг', () => {
    const s = replaceCurrentTick(three, tick(42))
    expect(values(s)).toEqual([1, 2, 42])
    expect(s.index).toBe(2)
  })

  it('в пустой истории заменять нечего', () => {
    expect(replaceCurrentTick(EMPTY_TICKS, tick(1))).toBe(EMPTY_TICKS)
    expect(currentTick(EMPTY_TICKS)).toBeNull()
  })
})
