// buildStateColorCssRules пишет CSS внутрь <style><![CDATA[…]]> экспортного
// view.svg, а stateColors приходит из stencil.json чужого проекта — проверяем, что
// подделанные ключ/цвет не утекают в правила (иначе `}` рвёт весь стиль).
import { describe, it, expect } from 'vitest'
import { buildStateColorCssRules } from './animation'

const stencil = (stateColors) => ({ id: 'cell_x', stateColors })

describe('buildStateColorCssRules', () => {
  it('строка = только контур, объект = контур + заливка', () => {
    const rules = buildStateColorCssRules([
      stencil({ true: '#ff0000', false: { stroke: 'blue', fill: '#0f0' } }),
    ])
    expect(rules.some((r) => r.includes('animation-color-cell_x-true') && r.includes('#ff0000')))
    expect(rules.filter((r) => r.includes('animation-color-cell_x-false'))).toHaveLength(2)
  })

  it('scope префиксует селекторы (симуляция)', () => {
    const rules = buildStateColorCssRules([stencil({ true: '#fff' })], {
      scope: '.tms-simulating ',
    })
    expect(rules[0].startsWith('.tms-simulating .animation-color-')).toBe(true)
  })

  it('ключ состояния вне маски не даёт правил', () => {
    expect(buildStateColorCssRules([stencil({ 'x } body { display:none': '#fff' })])).toEqual([])
    expect(buildStateColorCssRules([stencil({ 'a"b': '#fff' })])).toEqual([])
  })

  it('цвет вне маски не даёт правил (hex и CSS-имя — единственные допустимые)', () => {
    expect(buildStateColorCssRules([stencil({ true: 'red; } body { display:none' })])).toEqual([])
    expect(buildStateColorCssRules([stencil({ true: 'url(http://evil/x)' })])).toEqual([])
    // Заливка отброшена, валидный контур остаётся.
    const rules = buildStateColorCssRules([stencil({ true: { stroke: 'red', fill: 'a; }' } })])
    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain('stroke: red')
  })
})
