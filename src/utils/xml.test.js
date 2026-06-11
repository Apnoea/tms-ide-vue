import { describe, it, expect } from 'vitest'
import { escapeXml, escapeAttr } from './xml'

describe('xml utils', () => {
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
