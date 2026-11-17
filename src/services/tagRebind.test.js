import { describe, it, expect } from 'vitest'
import { indexBoundTags, planRebind, renameFormTags, renameTagBy, suggestRename } from './tagRebind'

const cell = (tms) => ({ id: Math.random().toString(36).slice(2), tms })
const form = (id, ...cells) => ({ id, json: { cells } })

describe('indexBoundTags', () => {
  it('считает привязки и формы по каждому тегу', () => {
    const index = indexBoundTags([
      form(
        'a',
        cell({ slots: { onoff: 'S.A' } }),
        cell({ boolSource: { groups: [['S.A', 'S.B']] } })
      ),
      form('b', cell({ slots: { onoff: 'S.A' } }), cell({ shape: { type: 'text' } })),
    ])
    expect(index.counts.get('S.A')).toBe(3)
    expect(index.counts.get('S.B')).toBe(1)
    expect([...index.formsOf.get('S.A')]).toEqual(['a', 'b'])
  })
})

describe('planRebind', () => {
  const index = indexBoundTags([
    form('a', cell({ slots: { onoff: 'OLD.X' } }), cell({ slots: { onoff: 'OLD.Y' } })),
    form('b', cell({ slots: { onoff: 'OLD.X' } }), cell({ slots: { onoff: 'KEEP.Z' } })),
  ])

  it('привязки, теги, формы и чего после замены нет в tag-list', () => {
    const names = new Set(['NEW.X', 'KEEP.Z'])
    expect(planRebind(index, renameTagBy('OLD.', 'NEW.'), names)).toEqual({
      bindings: 3,
      tags: 2,
      forms: 2,
      missing: ['NEW.Y'],
    })
  })

  it('без tag-list проверку «нет в tag-list» не делает', () => {
    expect(planRebind(index, renameTagBy('OLD.', 'NEW.'), new Set()).missing).toEqual([])
  })
})

describe('renameTagBy', () => {
  it('заменяет каждое вхождение как строку, а не regex', () => {
    expect(renameTagBy('.', '_')('a.b.c')).toBe('a_b_c')
    expect(renameTagBy('A.', '')('A.B')).toBe('B')
  })

  it('имя целиком не стирается — привязка остаётся как была', () => {
    expect(renameTagBy('A.B', '')('A.B')).toBe('A.B')
  })
})

describe('suggestRename', () => {
  // Старый префикс — длинный адрес из нескольких сегментов, новый — короткое имя сервера.
  const OLD = '10_0_0.1_2.ST01_0.SRV_100.5_0_Data_M.'
  const NEW = 'Plant_OPCUA.'
  const tails = ['RP_001.RVS_1.Level', 'RP_001.RVS_2.Level', 'RP_002.NA_1.State', 'RP_002.NA_1.I']

  it('смена префикса', () => {
    const names = new Set([...tails.map((t) => NEW + t), 'IEC870_Client_conn1'])
    expect(suggestRename([...tails.map((t) => OLD + t), 'IEC870_Client_conn1'], names)).toEqual({
      find: OLD,
      replace: NEW,
      matched: 4,
      missing: 4,
    })
  })

  it('префикс сняли — замена на пустую строку', () => {
    const names = new Set(tails)
    expect(
      suggestRename(
        tails.map((t) => NEW + t),
        names
      )
    ).toMatchObject({
      find: NEW,
      replace: '',
      matched: 4,
    })
  })

  it('смена суффикса', () => {
    const heads = ['PS1.QW1', 'PS1.QW2', 'PS2.QK1']
    const names = new Set(heads.map((h) => `${h}.STATE`))
    expect(
      suggestRename(
        heads.map((h) => `${h}.ONOFF`),
        names
      )
    ).toMatchObject({
      find: '.ONOFF',
      replace: '.STATE',
      matched: 3,
    })
  })

  it('все привязки есть в tag-list / tag-list пуст / пары нет → null', () => {
    expect(suggestRename(['A.B'], new Set(['A.B']))).toBeNull()
    expect(suggestRename(['A.B'], new Set())).toBeNull()
    expect(suggestRename(['A.B'], new Set(['C.D']))).toBeNull()
  })

  it('замена, ломающая больше, чем чинит, и одиночные совпадения не предлагаются', () => {
    // «X.» → «Y.» нашёл бы X.1 и X.2, но сломал бы три тега, которые уже на месте;
    // суффиксы «.1» → «.3» находят по одному тегу.
    const names = new Set(['Y.1', 'Y.2', 'X.3', 'X.4', 'X.5', 'Z.1', 'Z.2'])
    expect(suggestRename(['X.1', 'X.2', 'X.3', 'X.4', 'X.5'], names)).toBeNull()
  })
})

describe('renameFormTags', () => {
  it('новый граф и число изменённых привязок; без изменений → null', () => {
    const json = { cells: [cell({ slots: { onoff: 'OLD.X' } }), cell({ slots: { onoff: 'K.Y' } })] }
    const res = renameFormTags(json, renameTagBy('OLD.', 'NEW.'))
    expect(res.changed).toBe(1)
    expect(res.json.cells[0].tms.slots.onoff).toBe('NEW.X')
    expect(res.json.cells[1]).toBe(json.cells[1])
    expect(json.cells[0].tms.slots.onoff).toBe('OLD.X')
    expect(renameFormTags(json, renameTagBy('NONE', 'x'))).toBeNull()
  })

  it('подпись, равная тегу символа, едет вместе с ним; прочие подписи — нет', () => {
    // Так подписана форма проверки тегов: p1 = имя тега.
    const json = {
      cells: [cell({ slots: { value: 'OLD.X' }, params: { p1: 'OLD.X', p2: 'OLD.Y', p3: 'кВ' } })],
    }
    const res = renameFormTags(json, renameTagBy('OLD.', 'NEW.'))
    expect(res.changed).toBe(1) // подписи — не привязки
    expect(res.json.cells[0].tms.params).toEqual({ p1: 'NEW.X', p2: 'OLD.Y', p3: 'кВ' })
    expect(json.cells[0].tms.params.p1).toBe('OLD.X')
  })
})
