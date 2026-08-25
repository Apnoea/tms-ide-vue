// Имена форм чужого архива → безопасные id + перенос всего, что этим id адресуется.
// Почему это не косметика: id формы = имя папки в архиве, цель tms.navigation и ключ
// формы; `..` в имени уводил файл за папку проекта при распаковке на объекте.
import { describe, it, expect } from 'vitest'
import { renameFormIds, remapNavigation, remapTree, remapProjectMeta } from './formIds'

describe('renameFormIds', () => {
  it('годные имена не двигаются', () => {
    const { map, renamed } = renameFormIds(['main', 'form2', 'sub-1_a'])
    expect([...map.entries()]).toEqual([
      ['main', 'main'],
      ['form2', 'form2'],
      ['sub-1_a', 'sub-1_a'],
    ])
    expect(renamed).toEqual([])
  })

  it('путь наружу и точки чинятся, форма не теряется', () => {
    const { map, renamed } = renameFormIds(['..', 'a/b', 'main'])
    expect(map.get('main')).toBe('main')
    expect(map.get('..')).toMatch(/^form_\d+$/)
    expect(map.get('a/b')).toBe('a_b')
    expect(renamed).toHaveLength(2)
  })

  it('пробел и точка в имени → подчёркивание', () => {
    const { map } = renameFormIds(['Form 3', 'sub.form'])
    expect(map.get('Form 3')).toBe('Form_3')
    expect(map.get('sub.form')).toBe('sub_form')
  })

  it('нечинимое имя (кириллица) получает form_N, а не «_1»', () => {
    const { map } = renameFormIds(['Схема1', 'Подстанция'])
    expect(map.get('Схема1')).toBe('form_1')
    expect(map.get('Подстанция')).toBe('form_2')
  })

  it('коллизия после чистки разводится счётчиком', () => {
    const { map } = renameFormIds(['a b', 'a.b'])
    expect(map.get('a b')).toBe('a_b')
    expect(map.get('a.b')).toBe('a_b_2')
  })

  it('настоящее имя не вытесняется чинёным (порядок не важен)', () => {
    // «Схема» получила бы form_1, но такая форма в архиве уже есть — берём form_2.
    const { map } = renameFormIds(['Схема', 'form_1'])
    expect(map.get('form_1')).toBe('form_1')
    expect(map.get('Схема')).toBe('form_2')
  })

  it('слишком длинное имя обрезается', () => {
    const long = 'f'.repeat(200)
    const { map } = renameFormIds([long])
    expect(map.get(long).length).toBe(64)
  })
})

describe('перенос ссылок на новые имена', () => {
  const map = new Map([
    ['a b', 'a_b'],
    ['main', 'main'],
  ])

  it('навигация переезжает, внешняя цель остаётся как была', () => {
    const cells = [
      { id: 'c1', tms: { navigation: 'a b' } },
      { id: 'c2', tms: { navigation: 'external_view' } },
      { id: 'c3', tms: {} },
    ]
    const out = remapNavigation(cells, map)
    expect(out[0].tms.navigation).toBe('a_b')
    expect(out[1].tms.navigation).toBe('external_view')
    // Ячейки без навигации не пересобираем — лишние копии ни к чему.
    expect(out[2]).toBe(cells[2])
  })

  it('иерархия переезжает рекурсивно, мусор не роняет', () => {
    const tree = [{ id: 'main', children: [{ id: 'a b', children: [] }, null] }]
    expect(remapTree(tree, map)).toEqual([
      { id: 'main', children: [{ id: 'a_b', children: [] }, null] },
    ])
    expect(remapTree('oops', map)).toBe('oops')
  })

  it('фон формы переезжает вместе с id', () => {
    expect(remapProjectMeta({ formBg: { 'a b': '#123456' } }, map)).toEqual({
      formBg: { a_b: '#123456' },
    })
    expect(remapProjectMeta(null, map)).toBe(null)
  })
})
