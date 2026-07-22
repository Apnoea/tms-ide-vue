import { describe, it, expect, beforeEach } from 'vitest'
import { useAnimationClipboard, applyBoolClip, applyRangeClip } from './useAnimationClipboard'

// Буфер — singleton-ref, чистим между тестами через публичный copy* API.
beforeEach(() => {
  const clip = useAnimationClipboard()
  clip.copyBool(null)
  clip.copyRange(null)
})

describe('useAnimationClipboard — буфер', () => {
  it('hasBool/hasRange отражают наличие payload', () => {
    const clip = useAnimationClipboard()
    expect(clip.hasBool.value).toBe(false)
    expect(clip.hasRange.value).toBe(false)
    clip.copyBool({ onoffTag: 'A', groups: [] })
    clip.copyRange({ tag: 'B', ranges: [] })
    expect(clip.hasBool.value).toBe(true)
    expect(clip.hasRange.value).toBe(true)
  })

  it('слоты независимы', () => {
    const clip = useAnimationClipboard()
    clip.copyBool({ onoffTag: 'A', groups: [] })
    expect(clip.hasRange.value).toBe(false)
  })
})

describe('applyBoolClip', () => {
  it('раздаёт группы-зависимости любому не-static', () => {
    const next = applyBoolClip(
      { stencilId: 'cell_x' },
      { onoffTag: null, groups: [['A', 'B'], ['C']] },
      {}
    )
    expect(next.switchSources).toEqual({ groups: [['A', 'B'], ['C']] })
  })

  it('пишет onoff-тег только при булевом слоте', () => {
    const clip = { onoffTag: 'SIG', groups: [] }
    expect(applyBoolClip({}, clip, { hasBoolSlot: true }).slots).toEqual({ onoff: 'SIG' })
    expect(applyBoolClip({}, clip, { hasBoolSlot: false }).slots).toBeUndefined()
  })

  it('пустые группы снимают switchSources у цели', () => {
    const next = applyBoolClip(
      { switchSources: { groups: [['OLD']] } },
      { onoffTag: null, groups: [[]] },
      {}
    )
    expect(next.switchSources).toBeUndefined()
  })

  it('сохраняет прочие поля tms', () => {
    const next = applyBoolClip(
      { slots: { onoff: 'X' }, color: '#fff' },
      { onoffTag: null, groups: [['A']] },
      {}
    )
    expect(next.color).toBe('#fff')
    expect(next.slots).toEqual({ onoff: 'X' })
  })

  it('null для статичного стенсила и пустого буфера', () => {
    expect(applyBoolClip({}, { onoffTag: 'A', groups: [] }, { isStatic: true })).toBeNull()
    expect(applyBoolClip({}, null, {})).toBeNull()
  })

  it('не делит ссылку на группы между целями', () => {
    const clip = { onoffTag: null, groups: [['A']] }
    const a = applyBoolClip({}, clip, {})
    const b = applyBoolClip({}, clip, {})
    expect(a.switchSources).not.toBe(b.switchSources)
    expect(a.switchSources.groups[0]).not.toBe(clip.groups[0])
  })
})

describe('applyRangeClip', () => {
  it('вставляет voltageSource свежим клоном', () => {
    const clip = { tag: 'PT', ranges: [{ min: 0, max: 1, class: 'animation-low' }] }
    const a = applyRangeClip({ color: '#000' }, clip, {})
    expect(a.voltageSource).toEqual(clip)
    expect(a.voltageSource).not.toBe(clip)
    expect(a.color).toBe('#000')
    // Клон на каждую цель — не общая ссылка.
    const b = applyRangeClip({}, clip, {})
    expect(a.voltageSource).not.toBe(b.voltageSource)
  })

  it('null для статичного стенсила и пустого буфера', () => {
    expect(applyRangeClip({}, { tag: 'PT', ranges: [] }, { isStatic: true })).toBeNull()
    expect(applyRangeClip({}, null, {})).toBeNull()
  })
})
