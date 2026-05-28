import { describe, it, expect } from 'vitest'
import { exportProject } from './exporter'
import { parseSvgProject } from './projectLoader'

// Мок-граф: минимальный интерфейс JointJS-graph'а, который дёргает exporter.
// Не зависит от реального dia.Graph — тесты быстрые и не требуют jsdom-setup'а
// JointJS-внутренностей.

function mockCell({ id, stencilId, prefix, x = 0, y = 0, w = 40, h = 40, ...extra }) {
  const tms = { stencilId, prefix, ...extra }
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

function mockLink({ id, source, target, voltageSource = null }) {
  return {
    id,
    get(key) {
      if (key === 'source') return source
      if (key === 'target') return target
      if (key === 'tms') return voltageSource ? { voltageSource } : {}
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
    expect(result.count).toBe(0)
    expect(result.linkCount).toBe(0)
    expect(result.svgText).toMatch(/<svg[^>]+viewBox/)
    expect(result.animations.animations).toEqual({})
  })

  it('cell_vk: пишет data-tms-meta и animation-карточки .VK / .VK-cross', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_vk', prefix: 'PS031VK001', x: 50, y: 100, w: 20, h: 20 }),
    ])
    const result = exportProject(graph)
    expect(result.count).toBe(1)
    expect(result.svgText).toContain('data-tms-stencil="cell_vk"')
    expect(result.svgText).toContain('data-tms-object="PS031VK001"')
    expect(result.svgText).toContain('data-tms-meta=')
    expect(result.svgText).toContain('animation-cell-PS031VK001')

    const anims = result.animations.animations
    expect(anims).toHaveProperty('animation-PS031VK001.VK')
    expect(anims).toHaveProperty('animation-PS031VK001.VK-cross')
    expect(anims['animation-PS031VK001.VK'].bindings[0].tag).toBe('PS031VK001.ONOFF')
  })

  it('cell_value с valueTag: id и animation key из тега (а не auto-prefix)', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_value',
        prefix: 'cell_value_1',
        valueTag: 'PS031VV001.IA',
        w: 100,
        h: 18,
      }),
    ])
    const result = exportProject(graph)
    // outer wrapper должен использовать valueTag как идентификатор
    expect(result.svgText).toContain('animation-cell-PS031VV001.IA')
    // animations.json — ключ из тега
    expect(result.animations.animations).toHaveProperty('animation-PS031VV001.IA')
    const card = result.animations.animations['animation-PS031VV001.IA']
    expect(card.animation).toBe('text')
    expect(card.bindings[0].tag).toBe('PS031VV001.IA')
  })

  it('voltageSource на ячейке → карточка animation-cell-{prefix} + merge в стенсильные', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_vk',
        prefix: 'PS031VK001',
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
    expect(anims).toHaveProperty('animation-cell-PS031VK001')
    expect(anims['animation-cell-PS031VK001'].bindings[0].tag).toBe('PS031.UA')
    // voltage биндинг МЕРЖИТСЯ в .VK / .VK-cross
    const vkBindings = anims['animation-PS031VK001.VK'].bindings
    expect(vkBindings.some((b) => b.tag === 'PS031.UA')).toBe(true)
  })

  it('экспорт + load round-trip: cells сохраняют tms и position', () => {
    const graph = mockGraph(
      [
        mockCell({
          id: 'c1',
          stencilId: 'cell_vk',
          prefix: 'PS031VK001',
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
    expect(cells[0].tms.prefix).toBe('PS031VK001')
  })
})
