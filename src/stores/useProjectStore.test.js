import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from './useProjectStore'

describe('useProjectStore getters', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // Getter'ы (composition-store) разворачиваются Pinia — доступ БЕЗ `.value`,
  // возвращают отфильтрованный массив. Контракт зафиксирован: обращение с `.value`
  // дало бы undefined и пустые tag-picker'ы в инспекторе.
  it('booleanTags/floatTags фильтруют tags по типу и отдают массив', () => {
    const store = useProjectStore()
    store.setTags([
      { name: 'A', type: 'Boolean' },
      { name: 'B', type: 'Float' },
      { name: 'C', type: 'Int' },
    ])
    expect(Array.isArray(store.booleanTags)).toBe(true)
    expect(store.booleanTags.map((t) => t.name)).toEqual(['A'])
    expect(store.floatTags.map((t) => t.name)).toEqual(['B'])
  })

  it('пустой tag-list → пустые подмножества', () => {
    const store = useProjectStore()
    expect(store.booleanTags).toEqual([])
    expect(store.floatTags).toEqual([])
  })
})
