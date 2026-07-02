import { describe, it, expect } from 'vitest'
import { subtreeIds, computeDrop } from './formTreeDnd'

const TREE = [
  { id: 'a', children: [{ id: 'a1', children: [{ id: 'a11', children: [] }] }] },
  { id: 'b', children: [] },
]

describe('subtreeIds', () => {
  it('собирает узел + всех потомков', () => {
    expect(subtreeIds(TREE, 'a')).toEqual(new Set(['a', 'a1', 'a11']))
    expect(subtreeIds(TREE, 'a1')).toEqual(new Set(['a1', 'a11']))
    expect(subtreeIds(TREE, 'b')).toEqual(new Set(['b']))
  })

  it('орфан (нет в дереве) → сам себе поддерево', () => {
    expect(subtreeIds(TREE, 'ghost')).toEqual(new Set(['ghost']))
    expect(subtreeIds([], 'x')).toEqual(new Set(['x']))
  })
})

describe('computeDrop', () => {
  const rows = [
    { kind: 'form', id: 'a' },
    { kind: 'form', id: 'b' },
    { kind: 'group', label: 'Без иерархии' },
    { kind: 'form', id: 'orphan' },
  ]
  const invalid = new Set(['drag']) // перетаскиваемый узел

  it('зоны по трети высоты: before / inside / after', () => {
    expect(computeDrop(rows, 0, 0.1, invalid)).toEqual({ targetId: 'a', zone: 'before' })
    expect(computeDrop(rows, 0, 0.5, invalid)).toEqual({ targetId: 'a', zone: 'inside' })
    expect(computeDrop(rows, 0, 0.9, invalid)).toEqual({ targetId: 'a', zone: 'after' })
  })

  it('заголовок группы / вне диапазона → null', () => {
    expect(computeDrop(rows, 2, 0.5, invalid)).toBeNull()
    expect(computeDrop(rows, 99, 0.5, invalid)).toBeNull()
  })

  it('строка из перетаскиваемого поддерева → null (визуальный guard циклов)', () => {
    expect(computeDrop(rows, 0, 0.5, new Set(['a']))).toBeNull()
  })
})
