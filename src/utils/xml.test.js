import { describe, it, expect } from 'vitest'
import { SVG_NS, escapeXml, escapeAttr } from './xml'

describe('xml utils', () => {
  it('SVG_NS — каноничный namespace', () => {
    expect(SVG_NS).toBe('http://www.w3.org/2000/svg')
  })

  describe('escapeXml', () => {
    it('экранирует &, <, >', () => {
      expect(escapeXml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
    })
    it('пропускает обычный текст', () => {
      expect(escapeXml('Hello world')).toBe('Hello world')
    })
    it('& экранируется первым (иначе двойной escape)', () => {
      expect(escapeXml('&lt;')).toBe('&amp;lt;')
    })
    it('non-string coerce без падения', () => {
      expect(escapeXml(42)).toBe('42')
      expect(escapeXml(null)).toBe('null')
    })
  })

  describe('escapeAttr', () => {
    it('включает экранирование " и \'', () => {
      expect(escapeAttr('a"b\'c')).toBe('a&quot;b&apos;c')
    })
    it('делает всё что escapeXml + кавычки', () => {
      expect(escapeAttr('<"&>')).toBe('&lt;&quot;&amp;&gt;')
    })
  })
})
