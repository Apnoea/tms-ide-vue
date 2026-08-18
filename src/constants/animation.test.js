// buildStateColorCssRules пишет CSS внутрь <style><![CDATA[…]]> экспортного
// view.svg, а stateColors приходит из stencil.json чужого проекта — проверяем, что
// подделанные ключ/цвет не утекают в правила (иначе `}` рвёт весь стиль).
import { describe, it, expect } from 'vitest'
import {
  buildStateColorCssRules,
  buildRangeCssRules,
  rangeColorClass,
  rangeRowColor,
} from './animation'

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

describe('цвет строки диапазона', () => {
  it('свой цвет приоритетнее прежнего class-имени палитры', () => {
    expect(rangeRowColor({ color: '#123456', class: 'animation-low' })).toBe('#123456')
    expect(rangeRowColor({ class: 'animation-mid' })).toBe('#f59e0b')
    expect(rangeRowColor({})).toBe('')
    // Мусор из чужого архива цветом не считаем (значение уедет в CSS).
    expect(rangeRowColor({ color: 'url(#evil)' })).toBe('')
  })

  it('класс перекраса собирается из цвета, небезопасные символы выкидываются', () => {
    expect(rangeColorClass('#ff8800')).toBe('animation-c-ff8800')
    expect(rangeColorClass('red')).toBe('animation-c-red')
    expect(rangeColorClass('')).toBe('')
  })
})

describe('buildRangeCssRules', () => {
  it('правило на каждый использованный цвет + animation-off поверх', () => {
    const rules = buildRangeCssRules(['#ff8800', '#ff8800', '#10b981'])
    // Дубли схлопнуты: по два правила (stroke + opt-in fill) на цвет, плюс off.
    expect(rules).toHaveLength(6)
    expect(rules[0]).toContain('.animation-c-ff8800')
    expect(rules[0]).toContain('stroke: #ff8800')
    expect(rules.at(-1)).toContain('.animation-off')
  })

  it('без цветов остаётся только off; мусор правил не даёт', () => {
    expect(buildRangeCssRules([])).toHaveLength(2)
    expect(buildRangeCssRules(['url(#evil)', ''])).toHaveLength(2)
  })

  it('scope префиксует селекторы (симуляция)', () => {
    const [rule] = buildRangeCssRules(['#10b981'], { scope: '.tms-simulating ' })
    expect(rule.startsWith('.tms-simulating .animation-c-10b981')).toBe(true)
  })
})
