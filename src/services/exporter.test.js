import { describe, it, expect } from 'vitest'
import { exportProject } from './exporter'
import { parseSvgProject } from './projectLoader'

// Мок-граф: минимальный интерфейс JointJS-graph'а, который дёргает exporter.
// Не зависит от реального dia.Graph — тесты быстрые и не требуют jsdom-setup'а
// JointJS-внутренностей.

function mockCell({ id, stencilId, x = 0, y = 0, w = 40, h = 40, ...extra }) {
  const tms = { stencilId, ...extra }
  return {
    id,
    get(key) {
      if (key === 'tms') return tms
      if (key === 'position') return { x, y }
      if (key === 'size') return { width: w, height: h }
      return undefined
    },
  }
}

function mockLink({ id, source, target, tms = null }) {
  return {
    id,
    get(key) {
      if (key === 'source') return source
      if (key === 'target') return target
      if (key === 'tms') return tms || {}
      return undefined
    },
  }
}

function mockGraph(elements = [], links = []) {
  return {
    getElements: () => elements,
    getLinks: () => links,
    getCell: (id) => [...elements, ...links].find((c) => c.id === id),
  }
}

describe('exportProject', () => {
  it('пустой граф → count=0, валидный svg + viewBox', () => {
    const result = exportProject(mockGraph())
    expect(result.svgText).toMatch(/<svg[^>]+viewBox/)
    expect(result.animations.animations).toEqual({})
  })

  it('cell_vk: пишет data-tms-meta и animation-карточки .VK / .VK-cross по cellId', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_vk',
        slots: { onoff: 'PS031VK001.ONOFF' },
        x: 50,
        y: 100,
        w: 20,
        h: 20,
      }),
    ])
    const result = exportProject(graph)
    expect(result.svgText).toContain('data-tms-stencil="cell_vk"')
    expect(result.svgText).toContain('data-tms-meta=')
    // Outer-wrapper id и стенсильные карточки — все по cellId
    expect(result.svgText).toContain('animation-cell-c1')

    const anims = result.animations.animations
    expect(anims).toHaveProperty('animation-c1.VK')
    expect(anims).toHaveProperty('animation-c1.VK-cross')
    // Биндинг тега из slot.onoff — подставлен в шаблоны стенсила
    expect(anims['animation-c1.VK'].bindings[0].tag).toBe('PS031VK001.ONOFF')
  })

  it('cell_vk без slots: карточки анимаций НЕ эмитятся (нет привязки = нет анимации)', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_vk', x: 0, y: 0, w: 20, h: 20 }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims['animation-c1.VK']).toBeUndefined()
    expect(anims['animation-c1.VK-cross']).toBeUndefined()
  })

  it('cell_value с valueTag: id и animation key из тега', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_value',
        valueTag: 'PS031VV001.IA',
        w: 100,
        h: 18,
      }),
    ])
    const result = exportProject(graph)
    // outer wrapper использует valueTag как идентификатор (рантайм-конвенция)
    expect(result.svgText).toContain('animation-cell-PS031VV001.IA')
    expect(result.animations.animations).toHaveProperty('animation-PS031VV001.IA')
    const card = result.animations.animations['animation-PS031VV001.IA']
    expect(card.animation).toBe('text')
    expect(card.bindings[0].tag).toBe('PS031VV001.IA')
  })

  it('voltageSource на ячейке → карточка animation-cell-{cellId} + merge в стенсильные', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_vk',
        slots: { onoff: 'PS031VK001.ONOFF' },
        voltageSource: {
          tag: 'PS031.UA',
          ranges: [
            { min: 0, max: 5, class: 'animation-low' },
            { min: 5, max: 10, class: 'animation-high' },
          ],
        },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims).toHaveProperty('animation-cell-c1')
    expect(anims['animation-cell-c1'].bindings[0].tag).toBe('PS031.UA')
    // voltage биндинг МЕРЖИТСЯ в .VK / .VK-cross
    const vkBindings = anims['animation-c1.VK'].bindings
    expect(vkBindings.some((b) => b.tag === 'PS031.UA')).toBe(true)
  })

  it('switchSource на ячейке → карточка с animation-off на false + merge в стенсильные', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_vk',
        slots: { onoff: 'PS031VK001.ONOFF' },
        switchSource: { tag: 'PS031VK001.ONOFF' },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims).toHaveProperty('animation-cell-c1')
    const outerBindings = anims['animation-cell-c1'].bindings
    const switchBinding = outerBindings.find((b) => b.tag === 'PS031VK001.ONOFF')
    expect(switchBinding).toBeDefined()
    expect(switchBinding.when.cases.false.apply.addClass).toBe('animation-off')
    // Merge в .VK / .VK-cross тоже работает
    const vkBindings = anims['animation-c1.VK'].bindings
    expect(vkBindings.some((b) => b.tag === 'PS031VK001.ONOFF' && b.when.cases.false)).toBe(true)
  })

  it('switchSource на линии → анимационная карточка с animation-off', () => {
    const cellA = mockCell({ id: 'a', stencilId: 'cell_vk', x: 0, y: 0 })
    const cellB = mockCell({ id: 'b', stencilId: 'cell_vk', x: 100, y: 0 })
    const link = mockLink({
      id: 'l1',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      tms: { switchSource: { tag: 'PS031VK001.ONOFF' } },
    })
    const graph = mockGraph([cellA, cellB], [link])
    const anims = exportProject(graph).animations.animations
    // Wire id формируется по link.id
    const wireKey = 'animation-wire-l1'
    expect(anims).toHaveProperty(wireKey)
    expect(anims[wireKey].bindings[0].when.cases.false.apply.addClass).toBe('animation-off')
  })

  it('экспорт + load round-trip: cells сохраняют tms.slots и position', () => {
    const graph = mockGraph(
      [
        mockCell({
          id: 'c1',
          stencilId: 'cell_vk',
          slots: { onoff: 'PS031VK001.ONOFF' },
          x: 100,
          y: 200,
          w: 20,
          h: 20,
        }),
      ],
      []
    )
    const exported = exportProject(graph)
    const parsed = parseSvgProject(exported.svgText)
    expect(parsed.ok).toBe(true)
    const cells = parsed.cells.filter((c) => c.type === 'tms.Stencil')
    expect(cells).toHaveLength(1)
    expect(cells[0].id).toBe('c1')
    expect(cells[0].position).toEqual({ x: 100, y: 200 })
    expect(cells[0].tms.stencilId).toBe('cell_vk')
    expect(cells[0].tms.slots).toEqual({ onoff: 'PS031VK001.ONOFF' })
  })
})
