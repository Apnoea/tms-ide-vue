// @vitest-environment jsdom
// Разметка символа приезжает из чужого .zip и уходит в v-html/appendChild, а
// оверрайды в IDB переживают reload — один <script> в архиве жил бы до чистки
// хранилища. Проверяем, что фильтр режет активное и не трогает наши символы.
import { describe, it, expect } from 'vitest'
import { sanitizeSvgMarkup } from './sanitizeSvg'
import { getAllStencils } from '../stencils/registry'

const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${inner}</svg>`

describe('sanitizeSvgMarkup — что режем', () => {
  it('<script> вырезается вместе с содержимым', () => {
    const { svg, removed } = sanitizeSvgMarkup(wrap('<script>alert(1)</script><rect x="1"/>'))
    expect(svg).not.toContain('script')
    expect(svg).not.toContain('alert')
    expect(svg).toContain('<rect')
    expect(removed).toContain('<script>')
  })

  it('обработчики событий снимаются с любого элемента', () => {
    const { svg, removed } = sanitizeSvgMarkup(
      wrap('<rect x="1" onload="alert(1)" onclick="alert(2)"/>')
    )
    expect(svg).not.toMatch(/onload|onclick|alert/)
    expect(svg).toContain('x="1"')
    expect(removed).toEqual(expect.arrayContaining(['onload=', 'onclick=']))
  })

  it('ссылки наружу: href / xlink:href / use / foreignObject / image', () => {
    const { svg } = sanitizeSvgMarkup(
      wrap(
        '<a href="javascript:alert(1)"><rect/></a>' +
          '<use xlink:href="http://evil/x.svg#a"/>' +
          '<foreignObject><div>hi</div></foreignObject>' +
          '<image href="data:image/svg+xml,<svg/>"/>'
      )
    )
    expect(svg).not.toMatch(/javascript:|xlink|foreignObject|<image|<a[\s>]/)
  })

  it('SMIL-анимация не проходит (свой протокол анимаций у нас в animations.json)', () => {
    const { svg } = sanitizeSvgMarkup(wrap('<rect><animate attributeName="x" to="9"/></rect>'))
    expect(svg).not.toContain('animate')
  })

  it('style-атрибут снимается — через него протаскивается url() и внешние ссылки', () => {
    const { svg } = sanitizeSvgMarkup(wrap('<rect style="fill:url(http://evil/x)"/>'))
    expect(svg).not.toContain('style')
  })

  it('битая разметка → пустая строка, а не сырой ввод в v-html', () => {
    const { svg, removed } = sanitizeSvgMarkup('<svg><rect')
    expect(svg).toBe('')
    expect(removed.length).toBeGreaterThan(0)
  })
})

describe('sanitizeSvgMarkup — что сохраняем', () => {
  it('геометрия, оформление и data-* остаются', () => {
    const { svg, removed } = sanitizeSvgMarkup(
      wrap(
        '<g data-anim-suffix=".true"><line x1="0" y1="0" x2="10" y2="10" stroke="#000" ' +
          'stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></g>'
      )
    )
    expect(removed).toEqual([])
    expect(svg).toContain('data-anim-suffix=".true"')
    expect(svg).toContain('stroke-linecap="round"')
    expect(svg).toContain('vector-effect="non-scaling-stroke"')
  })

  it('градиент с локальной ссылкой проходит (заливка бака в рукописных символах)', () => {
    const { svg, removed } = sanitizeSvgMarkup(
      wrap(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
          '<rect fill="url(#g)"/>'
      )
    )
    expect(removed).toEqual([])
    expect(svg).toContain('linearGradient')
    expect(svg).toContain('fill="url(#g)"')
  })

  it('идемпотентность: повторная чистка не меняет строку', () => {
    const once = sanitizeSvgMarkup(wrap('<rect x="1" y="2" fill="none" stroke="#000"/>')).svg
    expect(sanitizeSvgMarkup(once).svg).toBe(once)
  })

  it('встроенные символы проходят фильтр без потерь', () => {
    // Иначе рисунок оборудования молча обеднеет, а stencilSignature начнёт
    // считать наши же символы «изменёнными» при импорте.
    for (const s of getAllStencils()) {
      if (!s.svgText) continue
      expect({ id: s.id, removed: sanitizeSvgMarkup(s.svgText).removed }).toEqual({
        id: s.id,
        removed: [],
      })
    }
  })
})
