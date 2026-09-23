import { describe, it, expect, vi, beforeEach } from 'vitest'

const idbStore = vi.hoisted(() => new Map())
const idbRead = vi.hoisted(() => ({ ok: true }))
vi.mock('../utils/idb', () => ({
  idbTryGet: vi.fn(async (k) => ({ ok: idbRead.ok, value: idbStore.get(k) })),
  idbSet: vi.fn(async (k, v) => {
    idbStore.set(k, v)
    return true
  }),
}))

import { removeStencilOverride, stencilSignature, upsertStencilOverride } from './stencilOverrides'

// stencilSignature решает, «изменился ли символ» при импорте. Должна быть
// устойчива к порядку ключей (glob-модуль против JSON.parse дают разный порядок),
// но чувствительна к реальным правкам json/svg и к порядку в массивах.
describe('stencilSignature', () => {
  it('стабильна к порядку ключей верхнего уровня', () => {
    expect(stencilSignature({ a: 1, b: 2 }, 'svg')).toBe(stencilSignature({ b: 2, a: 1 }, 'svg'))
  })

  it('стабильна к порядку вложенных ключей', () => {
    expect(stencilSignature({ x: { p: 1, q: 2 } }, '')).toBe(
      stencilSignature({ x: { q: 2, p: 1 } }, '')
    )
  })

  it('различает разный svg', () => {
    expect(stencilSignature({ a: 1 }, 'A')).not.toBe(stencilSignature({ a: 1 }, 'B'))
  })

  it('различает разный json (правка заливки)', () => {
    expect(stencilSignature({ stateColors: {} }, 'x')).not.toBe(
      stencilSignature({ stateColors: { on: '#f00' } }, 'x')
    )
  })

  it('порядок элементов массива значим', () => {
    expect(stencilSignature({ a: [1, 2] }, '')).not.toBe(stencilSignature({ a: [2, 1] }, ''))
  })

  it('пустой/undefined json не бросает', () => {
    expect(stencilSignature(undefined, 'x')).toBe(stencilSignature({}, 'x'))
  })
})

// Сброс символа набора к поставке снимает оверрайд: вызывающему нужен честный итог
// записи, иначе он пообещал бы сброс, который вернётся после перезагрузки.
describe('removeStencilOverride', () => {
  beforeEach(() => {
    idbStore.clear()
    idbRead.ok = true
  })

  it('снимает оверрайд, остальные оставляет', async () => {
    await upsertStencilOverride({ id: 'a', stencilJson: { id: 'a' } })
    await upsertStencilOverride({ id: 'b', stencilJson: { id: 'b' } })
    expect(await removeStencilOverride('a')).toBe(true)
    expect(idbStore.get('project:stencils').map((s) => s.id)).toEqual(['b'])
  })

  it('оверрайда нет — снимать нечего, это успех', async () => {
    expect(await removeStencilOverride('nope')).toBe(true)
  })

  it('хранилище не прочиталось — false, ничего не пишем', async () => {
    idbRead.ok = false
    expect(await removeStencilOverride('a')).toBe(false)
    expect(idbStore.has('project:stencils')).toBe(false)
  })
})
