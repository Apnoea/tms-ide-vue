import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from './useWorkspaceStore'

const sample = () => [
  { id: 'a', graphJson: { cells: [{ id: 'x' }] } },
  { id: 'b', graphJson: { cells: [] } },
]

describe('useWorkspaceStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loadForms наполняет список id и активную', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'b')
    expect(ws.formIds).toEqual(['a', 'b'])
    expect(ws.activeFormId).toBe('b')
  })

  it('loadForms без activeId берёт первую форму', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample())
    expect(ws.activeFormId).toBe('a')
  })

  it('getFormGraph возвращает граф формы / null для несуществующей', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    expect(ws.getFormGraph('a')).toEqual({ cells: [{ id: 'x' }] })
    expect(ws.getFormGraph('missing')).toBeNull()
  })

  it('updateActiveGraph пишет граф в активную форму', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    ws.updateActiveGraph({ cells: [{ id: 'y' }] })
    expect(ws.getFormGraph('a')).toEqual({ cells: [{ id: 'y' }] })
  })

  it('setActiveFormId переключает только на существующую форму', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    ws.setActiveFormId('b')
    expect(ws.activeFormId).toBe('b')
    ws.setActiveFormId('nope')
    expect(ws.activeFormId).toBe('b')
  })

  it('clearActiveForm обнуляет граф активной формы', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    ws.clearActiveForm()
    expect(ws.getFormGraph('a')).toEqual({ cells: [] })
  })

  it('addForm добавляет пустую форму; дубль id → false', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    expect(ws.addForm('c')).toBe(true)
    expect(ws.formIds).toEqual(['a', 'b', 'c'])
    expect(ws.getFormGraph('c')).toEqual({ cells: [] })
    expect(ws.addForm('a')).toBe(false) // занят
    expect(ws.formIds).toEqual(['a', 'b', 'c'])
  })

  it('removeForm: удаление активной переключает на первую оставшуюся', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    const next = ws.removeForm('a')
    expect(next).toBe('b')
    expect(ws.activeFormId).toBe('b')
    expect(ws.formIds).toEqual(['b'])
  })

  it('removeForm не активной не трогает активную', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    ws.removeForm('b')
    expect(ws.activeFormId).toBe('a')
    expect(ws.formIds).toEqual(['a'])
  })

  it('renameForm сохраняет порядок, переносит активную и граф', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    expect(ws.renameForm('a', 'z')).toBe(true)
    expect(ws.formIds).toEqual(['z', 'b']) // порядок сохранён (не уехал в конец)
    expect(ws.activeFormId).toBe('z')
    expect(ws.getFormGraph('z')).toEqual({ cells: [{ id: 'x' }] })
    expect(ws.getFormGraph('a')).toBeNull()
  })

  it('renameForm отклоняет занятый/несуществующий/совпадающий id', () => {
    const ws = useWorkspaceStore()
    ws.loadForms(sample(), 'a')
    expect(ws.renameForm('a', 'b')).toBe(false) // занят
    expect(ws.renameForm('missing', 'q')).toBe(false) // нет такой
    expect(ws.renameForm('a', 'a')).toBe(false) // совпадает
    expect(ws.formIds).toEqual(['a', 'b'])
  })

  describe('moveNode (DnD дерева)', () => {
    function setup(tree) {
      const ws = useWorkspaceStore()
      ws.loadForms(
        ['a', 'b', 'c'].map((id) => ({ id, graphJson: { cells: [] } })),
        'a'
      )
      ws.setFormTree(tree)
      return ws
    }

    it('inside вкладывает узел в целевой', () => {
      const ws = setup([
        { id: 'a', children: [] },
        { id: 'b', children: [] },
      ])
      expect(ws.moveNode('b', 'a', 'inside')).toBe(true)
      expect(ws.formTree).toEqual([{ id: 'a', children: [{ id: 'b', children: [] }] }])
    })

    it('before/after переставляют сиблингов', () => {
      const ws = setup([
        { id: 'a', children: [] },
        { id: 'b', children: [] },
        { id: 'c', children: [] },
      ])
      expect(ws.moveNode('c', 'a', 'before')).toBe(true)
      expect(ws.formTree.map((n) => n.id)).toEqual(['c', 'a', 'b'])
    })

    it('targetId=null → в конец корня (outdent)', () => {
      const ws = setup([{ id: 'a', children: [{ id: 'b', children: [] }] }])
      expect(ws.moveNode('b', null, 'inside')).toBe(true)
      expect(ws.formTree).toEqual([
        { id: 'a', children: [] },
        { id: 'b', children: [] },
      ])
    })

    it('узел едет вместе с поддеревом', () => {
      const ws = setup([
        { id: 'a', children: [{ id: 'a1', children: [] }] },
        { id: 'b', children: [] },
      ])
      ws.moveNode('a', 'b', 'inside')
      expect(ws.formTree).toEqual([
        { id: 'b', children: [{ id: 'a', children: [{ id: 'a1', children: [] }] }] },
      ])
    })

    it('reject: drop на себя и в собственное поддерево (цикл)', () => {
      const before = [
        { id: 'a', children: [{ id: 'a1', children: [] }] },
        { id: 'b', children: [] },
      ]
      const ws = setup(before)
      expect(ws.moveNode('a', 'a', 'inside')).toBe(false)
      expect(ws.moveNode('a', 'a1', 'inside')).toBe(false) // в потомка
      expect(ws.formTree).toEqual(before)
    })

    it('reject: target не найден', () => {
      const ws = setup([{ id: 'a', children: [] }])
      expect(ws.moveNode('a', 'ghost', 'inside')).toBe(false)
    })

    it('орфан (в formIds, но не в дереве) при drop добавляется узлом', () => {
      const ws = setup([{ id: 'a', children: [] }]) // b, c — орфаны
      expect(ws.moveNode('b', 'a', 'inside')).toBe(true)
      expect(ws.formTree).toEqual([{ id: 'a', children: [{ id: 'b', children: [] }] }])
    })
  })
})
