import { describe, it, expect, beforeEach } from 'vitest'
import {
  useAnimationClipboard,
  applyStateClip,
  applyDepsClip,
  applyValueClip,
} from './useAnimationClipboard'

// Буфер — singleton-ref, чистим между тестами через публичный copy* API.
beforeEach(() => {
  const clip = useAnimationClipboard()
  clip.copyState(null)
  clip.copyDeps(null)
  clip.copyValue(null)
})

describe('useAnimationClipboard — буфер', () => {
  it('has* отражают наличие payload', () => {
    const clip = useAnimationClipboard()
    expect([clip.hasState.value, clip.hasDeps.value, clip.hasValue.value]).toEqual([
      false,
      false,
      false,
    ])
    clip.copyState({ slotKey: 'onoff', tag: 'A' })
    clip.copyDeps({ groups: [['B']] })
    clip.copyValue({ slotKey: 'value_text', tag: 'D', decimals: null, params: {} })
    expect([clip.hasState.value, clip.hasDeps.value, clip.hasValue.value]).toEqual([
      true,
      true,
      true,
    ])
  })

  it('слоты независимы', () => {
    const clip = useAnimationClipboard()
    clip.copyState({ slotKey: 'onoff', tag: 'A' })
    expect(clip.hasDeps.value).toBe(false)
    expect(clip.hasValue.value).toBe(false)
  })
})

describe('applyValueClip', () => {
  const CLIP = {
    slotKey: 'value_text',
    tag: 'PT1.VALUE',
    decimals: 3,
    params: { p1: 'Напряжение', p2: 'кВ' },
  }

  it('пишет тег, точность и объявленные подписи', () => {
    const next = applyValueClip({}, CLIP, { slotKey: 'value_text', paramKeys: ['p1', 'p2'] })
    expect(next.slots).toEqual({ value_text: 'PT1.VALUE' })
    expect(next.decimals).toBe(3)
    expect(next.params).toEqual({ p1: 'Напряжение', p2: 'кВ' })
  })

  it('подписи вне объявления цели отбрасываются', () => {
    // У другого символа подписи свои: чужой ключ стал бы мусором в payload.
    const next = applyValueClip({}, CLIP, { slotKey: 'value_text', paramKeys: ['p1'] })
    expect(next.params).toEqual({ p1: 'Напряжение' })
  })

  it('незаданное в буфере снимается у цели: вставка заменяет карточку целиком', () => {
    const target = { slots: { value_text: 'OLD' }, decimals: 1, params: { p1: 'Старая' } }
    const next = applyValueClip(
      target,
      { slotKey: 'value_text', tag: '', params: {} },
      {
        slotKey: 'value_text',
        paramKeys: ['p1'],
      }
    )
    // Опустевшие наборы не оставляем: `{}` уехал бы в meta мусором.
    expect(next.slots).toBeUndefined()
    expect(next.decimals).toBeUndefined()
    expect(next.params).toBeUndefined()
  })

  it('null у символа без Text-слота, статичного и пустого буфера', () => {
    expect(applyValueClip({}, CLIP, { slotKey: null })).toBeNull()
    // Слот другого ключа — не цель: подпись значения ищет свой слот.
    expect(applyValueClip({}, CLIP, { slotKey: 'value_label' })).toBeNull()
    expect(applyValueClip({}, CLIP, { slotKey: 'value_text', isStatic: true })).toBeNull()
    expect(applyValueClip({}, null, { slotKey: 'value_text' })).toBeNull()
  })
})

describe('applyStateClip', () => {
  it('пишет тег в слот цели', () => {
    const clip = { slotKey: 'onoff', tag: 'SIG' }
    const next = applyStateClip({ color: '#fff' }, clip, { slotKey: 'onoff' })
    expect(next.slots).toEqual({ onoff: 'SIG' })
    expect(next.color).toBe('#fff')
  })

  it('прочие слоты цели остаются', () => {
    const next = applyStateClip(
      { slots: { value_text: 'PT' } },
      { slotKey: 'onoff', tag: 'SIG' },
      {
        slotKey: 'onoff',
      }
    )
    expect(next.slots).toEqual({ value_text: 'PT', onoff: 'SIG' })
  })

  it('null при другом слоте цели: булев тег в символ «по значению» не идёт', () => {
    const clip = { slotKey: 'onoff', tag: 'SIG' }
    expect(applyStateClip({}, clip, { slotKey: 'value' })).toBeNull()
    // Элемент без слота-драйвера (провод, шина) — тоже не цель.
    expect(applyStateClip({}, clip, { slotKey: null })).toBeNull()
  })

  it('null для статичного символа и пустого буфера', () => {
    expect(
      applyStateClip({}, { slotKey: 'onoff', tag: 'A' }, { isStatic: true, slotKey: 'onoff' })
    ).toBeNull()
    expect(applyStateClip({}, null, { slotKey: 'onoff' })).toBeNull()
  })
})

describe('applyDepsClip', () => {
  it('раздаёт группы любому не-static элементу', () => {
    const next = applyDepsClip({ stencilId: 'cell_x' }, { groups: [['A', 'B'], ['C']] }, {})
    expect(next.boolSource).toEqual({ groups: [['A', 'B'], ['C']] })
  })

  it('сохраняет прочие поля tms', () => {
    const next = applyDepsClip({ slots: { onoff: 'X' }, color: '#fff' }, { groups: [['A']] }, {})
    expect(next.color).toBe('#fff')
    expect(next.slots).toEqual({ onoff: 'X' })
  })

  it('null у статичного символа, пустого буфера и пустых групп', () => {
    expect(applyDepsClip({}, { groups: [['A']] }, { isStatic: true })).toBeNull()
    expect(applyDepsClip({}, null, {})).toBeNull()
    // Копировать пустые зависимости блок не даёт — вставка не должна снимать чужие.
    const target = { boolSource: { groups: [['OLD']] } }
    expect(applyDepsClip(target, { groups: [[]] }, {})).toBeNull()
    expect(target.boolSource).toEqual({ groups: [['OLD']] })
  })

  it('не делит ссылку на группы между целями', () => {
    const clip = { groups: [['A']] }
    const a = applyDepsClip({}, clip, {})
    const b = applyDepsClip({}, clip, {})
    expect(a.boolSource).not.toBe(b.boolSource)
    expect(a.boolSource.groups[0]).not.toBe(clip.groups[0])
  })
})
