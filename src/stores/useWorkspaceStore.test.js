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
})
