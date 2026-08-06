// Порядок наложения: перенумерация слоя вместо арифметики над z. Главное —
// команды не выносят слой за его полосу (символы не падают под провода, провод
// не всплывает над символами) и «выше» у крайнего элемента не делает вид, что
// сработало.
import { describe, it, expect } from 'vitest'
import { planZOrder, ELEMENT_Z_BOUNDS } from './zOrder'

const LINKS = { min: -1000, max: -900 }

/** Применяет план к списку и возвращает порядок id по новому z. */
function applied(items, plan) {
  const patch = new Map(plan.map((p) => [p.id, p.z]))
  return [...items]
    .map((i) => ({ id: i.id, z: patch.has(i.id) ? patch.get(i.id) : i.z }))
    .sort((a, b) => a.z - b.z)
    .map((i) => i.id)
}

/** Слой из n элементов с последовательными z от base. */
function layer(ids, base = 0) {
  return ids.map((id, i) => ({ id, z: base + i }))
}

describe('planZOrder', () => {
  it('front/back переносят выделенное в конец/начало слоя', () => {
    const items = layer(['a', 'b', 'c'])
    expect(applied(items, planZOrder(items, ['a'], 'front', ELEMENT_Z_BOUNDS))).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(applied(items, planZOrder(items, ['c'], 'back', ELEMENT_Z_BOUNDS))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('forward/backward двигают на одну позицию', () => {
    const items = layer(['a', 'b', 'c'])
    expect(applied(items, planZOrder(items, ['a'], 'forward', ELEMENT_Z_BOUNDS))).toEqual([
      'b',
      'a',
      'c',
    ])
    expect(applied(items, planZOrder(items, ['c'], 'backward', ELEMENT_Z_BOUNDS))).toEqual([
      'a',
      'c',
      'b',
    ])
  })

  it('выделение из нескольких двигается целиком и не рассыпается', () => {
    const items = layer(['a', 'b', 'c', 'd'])
    // Группа {b,c} на одну позицию вверх — обгоняет d, взаимный порядок цел.
    expect(applied(items, planZOrder(items, ['b', 'c'], 'forward', ELEMENT_Z_BOUNDS))).toEqual([
      'a',
      'd',
      'b',
      'c',
    ])
  })

  it('крайний элемент: команда — no-op, а не фантомный шаг истории', () => {
    const items = layer(['a', 'b'])
    expect(planZOrder(items, ['b'], 'forward', ELEMENT_Z_BOUNDS)).toEqual([])
    expect(planZOrder(items, ['a'], 'backward', ELEMENT_Z_BOUNDS)).toEqual([])
  })

  it('символы не уходят ниже нуля — иначе легли бы под провода', () => {
    const items = layer(['a', 'b', 'c'])
    const plan = planZOrder(items, ['c'], 'back', ELEMENT_Z_BOUNDS)
    expect(Math.min(...plan.map((p) => p.z))).toBeGreaterThanOrEqual(0)
  })

  it('провода остаются в своей полосе при любой команде', () => {
    const items = layer(['w1', 'w2', 'w3'], -1000)
    for (const mode of ['front', 'back', 'forward', 'backward']) {
      const plan = planZOrder(items, ['w1'], mode, LINKS)
      for (const { z } of plan) {
        expect(z).toBeGreaterThanOrEqual(LINKS.min)
        expect(z).toBeLessThanOrEqual(LINKS.max)
      }
    }
  })

  it('провод, поднятый наверх, получает больший z — он и рисует мостик', () => {
    const items = layer(['w1', 'w2'], -1000)
    const plan = planZOrder(items, ['w1'], 'front', LINKS)
    const order = applied(items, plan)
    expect(order[order.length - 1]).toBe('w1')
  })

  it('слой шире полосы: дробный шаг, но все уровни различны', () => {
    const ids = Array.from({ length: 150 }, (_, i) => `w${i}`)
    const items = ids.map((id) => ({ id, z: -1000 }))
    const plan = planZOrder(items, ['w0'], 'front', LINKS)
    const zs = applied(items, plan).map(
      (id) => plan.find((p) => p.id === id)?.z ?? items.find((i) => i.id === id).z
    )
    expect(new Set(zs).size).toBe(ids.length)
    expect(Math.min(...zs)).toBe(LINKS.min)
    expect(Math.max(...zs)).toBe(LINKS.max)
  })

  it('чужие id игнорируются — пустой план', () => {
    const items = layer(['a', 'b'])
    expect(planZOrder(items, ['zzz'], 'front', ELEMENT_Z_BOUNDS)).toEqual([])
  })
})
