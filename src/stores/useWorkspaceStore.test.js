import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from './useWorkspaceStore'
import { CANVAS_BG_DEFAULT } from '../stencils/canvasPaper'

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

// hierarchy.json приезжает из чужого архива, то есть это непроверенные данные. Раньше
// битая структура роняла ИМПОРТ ЦЕЛИКОМ (`.map is not a function`) — из-за файла,
// без которого проект прекрасно открывается плоским списком.
describe('иерархия из чужого архива', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function seeded() {
    const store = useWorkspaceStore()
    store.loadForms(
      ['a', 'b', 'c'].map((id) => ({ id, graphJson: { cells: [] } })),
      'a'
    )
    return store
  }

  it('мусорные узлы не роняют импорт, детей поднимаем на место отброшенного', () => {
    const ws = seeded()
    ws.setFormTree([null, { id: '', children: [{ id: 'b', children: [] }] }, 'строка', 42])
    expect(ws.formTree).toEqual([{ id: 'b', children: [] }])
  })

  it('children не массивом — узел остаётся, детей просто нет', () => {
    const ws = seeded()
    ws.setFormTree([{ id: 'a', children: 'oops' }, { id: 'b' }])
    expect(ws.formTree).toEqual([
      { id: 'a', children: [] },
      { id: 'b', children: [] },
    ])
  })

  it('числовой id приводится к строке (ключи форм — строки из путей архива)', () => {
    const ws = seeded()
    ws.setFormTree([{ id: 42, children: [] }])
    expect(ws.formTree).toEqual([{ id: '42', children: [] }])
  })

  it('дубль формы в двух ветках режется — иначе путается drag-n-drop', () => {
    const ws = seeded()
    ws.setFormTree([
      { id: 'a', children: [{ id: 'b', children: [] }] },
      { id: 'b', children: [] },
    ])
    expect(ws.formTree).toEqual([{ id: 'a', children: [{ id: 'b', children: [] }] }])
  })

  it('узел на несуществующую форму ОСТАЁТСЯ — FormTree рисует его битым', () => {
    const ws = seeded()
    ws.setFormTree([{ id: 'gone', children: [] }])
    expect(ws.formTree).toEqual([{ id: 'gone', children: [] }])
  })

  it('в мусоре нет ни одного годного узла → плоский список форм', () => {
    const ws = seeded()
    ws.setFormTree([null, { children: [] }])
    expect(ws.formTree).toEqual([
      { id: 'a', children: [] },
      { id: 'b', children: [] },
      { id: 'c', children: [] },
    ])
  })

  it('иерархия объектом вместо массива → плоский список', () => {
    const ws = seeded()
    ws.setFormTree({ a: 1 })
    expect(ws.formTree.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('слишком глубокая вложенность обрезается, форма не теряется из панели', () => {
    const ws = seeded()
    // 40 уровней: глубже 32 отбрасываем — форма уедет в «Без иерархии», а не в стек.
    let node = { id: 'deep', children: [] }
    for (let i = 0; i < 40; i++) node = { id: `n${i}`, children: [node] }
    ws.setFormTree([node])
    const depth = (n, d = 1) => (n.children.length ? depth(n.children[0], d + 1) : d)
    expect(depth(ws.formTree[0])).toBeLessThanOrEqual(33)
  })
})

// Фон холста — свойство ФОРМЫ (уезжает в мету проекта и в архив), поэтому живёт здесь,
// а не в ui-сторе: у каждой схемы свой цвет, у коллеги проект открывается таким же.
describe('фон форм', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function seeded() {
    const store = useWorkspaceStore()
    store.loadForms(
      [
        { id: 'a', graphJson: { cells: [] } },
        { id: 'b', graphJson: { cells: [] } },
      ],
      'a'
    )
    return store
  }

  it('по умолчанию фона нет (значит дефолтный)', () => {
    const store = seeded()
    expect(store.formBg).toEqual({})
    expect(store.activeFormBg).toBeNull()
  })

  it('цвет пишется своей форме, другие остаются дефолтными', () => {
    const store = seeded()
    expect(store.setFormBg('a', '#101828')).toBe(true)
    expect(store.activeFormBg).toBe('#101828')
    store.setActiveFormId('b')
    expect(store.activeFormBg).toBeNull()
  })

  it('дефолт и мусор записи не создают (в мете копим только заданные цвета)', () => {
    const store = seeded()
    expect(store.setFormBg('a', CANVAS_BG_DEFAULT)).toBe(false)
    for (const bad of ['', 'url(x)', null]) expect(store.setFormBg('a', bad)).toBe(false)
    expect(store.formBg).toEqual({})
    // Несуществующая форма — тоже нет.
    expect(store.setFormBg('ghost', '#101828')).toBe(false)
  })

  it('сброс в дефолт удаляет запись', () => {
    const store = seeded()
    store.setFormBg('a', '#101828')
    expect(store.setFormBg('a', null)).toBe(true)
    expect(store.formBg).toEqual({})
  })

  it('переименование формы переносит её фон, удаление — снимает', () => {
    const store = seeded()
    store.setFormBg('a', '#101828')
    store.renameForm('a', 'a2')
    expect(store.formBg).toEqual({ a2: '#101828' })
    store.removeForm('a2')
    expect(store.formBg).toEqual({})
  })

  it('загрузка меты отбрасывает цвета форм, которых в проекте нет, и мусор', () => {
    const store = seeded()
    store.loadFormBg({ a: '#101828', ghost: '#ffffff', b: 'url(evil)' })
    expect(store.formBg).toEqual({ a: '#101828' })
  })
})
