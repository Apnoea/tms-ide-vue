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
})
