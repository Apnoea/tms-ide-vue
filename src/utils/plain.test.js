import { describe, it, expect } from 'vitest'
import { ref, reactive } from 'vue'
import { toPlain } from './plain'

describe('toPlain', () => {
  it('глубокий клон без общих ссылок', () => {
    const src = { tag: 'X', ranges: [{ min: 0, max: 5, class: 'low' }] }
    const out = toPlain(src)
    expect(out).toEqual(src)
    expect(out).not.toBe(src)
    expect(out.ranges[0]).not.toBe(src.ranges[0])
  })

  it('снимает Vue reactive-прокси (structuredClone на нём бросил бы DataCloneError)', () => {
    const r = ref({ tag: 'Y', ranges: [{ min: 1, max: 2, class: 'mid' }] })
    expect(() => toPlain(r.value)).not.toThrow()
    const out = toPlain(r.value)
    expect(out).toEqual({ tag: 'Y', ranges: [{ min: 1, max: 2, class: 'mid' }] })
    // Результат — обычные объекты, не завязан на реактивный источник.
    out.tag = 'Z'
    expect(r.value.tag).toBe('Y')

    expect(toPlain(reactive({ a: [1, 2] }))).toEqual({ a: [1, 2] })
  })
})
