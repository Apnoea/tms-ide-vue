// @vitest-environment jsdom
// Кнопки зон у аналогового тега с диапазонами: клик ставит значение внутри зоны, чтобы
// проверить окраску, не вспоминая пороги символа.
import { describe, it, expect } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import SimulationPanel from './SimulationPanel.vue'

const RANGES = [
  { max: 10, color: '#10b981' },
  { min: 10, max: 50, color: '#f59e0b' },
  { min: 50, color: '#ef4444' },
]
const tag = (extra = {}) => ({
  tag: 'P1.VALUE',
  kind: 'value',
  type: 'Float',
  rangeSource: { tag: 'P1.VALUE', ranges: RANGES },
  ...extra,
})

const mountPanel = (tags, values = new Map()) =>
  mountWithApp(SimulationPanel, { props: { tags, values } })

const zones = (w) => w.findAll('button').filter((b) => /[≤≥–=]/.test(b.text()))

// Путь как у инспектора: при выделении список сужен до его тегов, корень снимает выделение.
it('SimulationPanel: заголовок «Симуляция › Символ», корень снимает выделение', async () => {
  const w = mountWithApp(SimulationPanel, {
    props: { tags: [tag()], values: new Map(), selectionLeaf: 'Символ' },
  })
  expect(w.find('h2').text()).toMatch(/Симуляция\s*›\s*Символ/)
  await w.find('h2 button').trigger('click')
  expect(w.emitted('clear-selection')).toHaveLength(1)
})

// Сброс всех значений — рядом с поиском; место под него держится, пока значений нет.
it('SimulationPanel: сброс всех значений у поиска, без строк-пояснений', async () => {
  const empty = mountPanel([tag()])
  expect(empty.find('.pi-refresh').exists()).toBe(false)
  expect(empty.text()).not.toContain('Пустое поле')
  const w = mountPanel([tag()], new Map([['P1.VALUE', 5]]))
  await w.find('.pi-refresh').element.closest('button').click()
  expect(w.emitted('reset')).toHaveLength(1)
})

describe('SimulationPanel: зоны диапазонов', () => {
  it('подписи по порогам и значение из зоны по клику', async () => {
    const w = mountPanel([tag()])
    expect(zones(w).map((b) => b.text())).toEqual(['≤ 10', '10–50', '≥ 50'])
    await zones(w)[1].trigger('click')
    expect(w.emitted('set-tag')).toEqual([['P1.VALUE', 30]])
  })

  it('заданное значение подсвечивает свою зону', () => {
    const w = mountPanel([tag()], new Map([['P1.VALUE', 70]]))
    const active = zones(w).filter((b) => b.classes().includes('bg-primary-50'))
    expect(active.map((b) => b.text())).toEqual(['≥ 50'])
  })

  it('зона под перекрывающей строкой не нажимается', async () => {
    const shadowed = [
      { min: 0, max: 100, color: '#10b981' },
      { min: 20, max: 40, color: '#f59e0b' },
    ]
    const w = mountPanel([tag({ rangeSource: { tag: 'P1.VALUE', ranges: shadowed } })])
    await zones(w)[1].trigger('click')
    expect(w.emitted('set-tag')).toBeUndefined()
  })

  it('без диапазонов и у не-аналоговых тегов кнопок зон нет', () => {
    const w = mountPanel([
      tag({ rangeSource: undefined }),
      { tag: 'Q1.ONOFF', kind: 'bool', type: 'Boolean' },
    ])
    expect(zones(w)).toHaveLength(0)
  })
})
