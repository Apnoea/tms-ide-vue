import { describe, it, expect } from 'vitest'
import { stencilSignature } from './stencilOverrides'

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
