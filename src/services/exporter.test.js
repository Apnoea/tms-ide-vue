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

    // slot.onoff неявно даёт animation-off биндинг на outer-wrapper:
    // крестик переключается (стенсильный .VK / .VK-cross) И ячейка серая
    // на false без ручного добавления switchSources.
    expect(anims).toHaveProperty('animation-cell-c1')
    const outerOff = anims['animation-cell-c1'].bindings.find(
      (b) =>
        b.tag === 'PS031VK001.ONOFF' && b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(outerOff).toBeDefined()
    // На .VK animation-off уже эмитится стенсильным шаблоном — outer-merge не
    // нужен (избежать дубля). Проверяем, что биндинг РОВНО один.
    const vkOffBindings = anims['animation-c1.VK'].bindings.filter(
      (b) =>
        b.tag === 'PS031VK001.ONOFF' && b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(vkOffBindings).toHaveLength(1)

    // detailTags на outer-wrapper — рантайм откроет popup при клике на ячейку
    expect(anims['animation-cell-c1'].detailTags).toEqual([{ tag: 'PS031VK001.ONOFF' }])
  })

  it('cell_vk без slots: карточки анимаций НЕ эмитятся (нет привязки = нет анимации)', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_vk', x: 0, y: 0, w: 20, h: 20 }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims['animation-c1.VK']).toBeUndefined()
    expect(anims['animation-c1.VK-cross']).toBeUndefined()
    // Без slot.onoff intrinsic-switch не эмитит animation-off
    expect(anims['animation-cell-c1']).toBeUndefined()
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

  it('cell_vk: slot.onoff + switchSources родителей → N+1 независимых биндингов', () => {
    // Типичный кейс: свой выключатель + общий по ПС + секционный. Все три тега
    // независимы; любой false → ячейка серая (AND через несколько биндингов).
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_vk',
        slots: { onoff: 'LOCAL.ONOFF' },
        switchSources: { tags: ['ОБЩИЙ.ONOFF', 'SECTION.ONOFF'] },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    const bindings = anims['animation-cell-c1'].bindings
    const offBindings = bindings.filter(
      (b) => b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(offBindings).toHaveLength(3)
    expect(offBindings.map((b) => b.tag).sort()).toEqual(
      ['LOCAL.ONOFF', 'SECTION.ONOFF', 'ОБЩИЙ.ONOFF'].sort()
    )
    // На .VK: 1 стенсильный (slot.onoff) + 2 от switchSources родителей =
    // 3 биндинга animation-off. slot.onoff в outer-merge НЕ задваивается
    // (стенсильный шаблон уже эмитит этот тег прямо в .VK).
    const vkBindings = anims['animation-c1.VK'].bindings
    const vkOff = vkBindings.filter(
      (b) => b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(vkOff).toHaveLength(3)
    expect(vkOff.map((b) => b.tag).sort()).toEqual(
      ['LOCAL.ONOFF', 'SECTION.ONOFF', 'ОБЩИЙ.ONOFF'].sort()
    )
  })

  it('switchSources на линии → карточка с animation-off на link-id', () => {
    const cellA = mockCell({ id: 'a', stencilId: 'cell_vk', x: 0, y: 0 })
    const cellB = mockCell({ id: 'b', stencilId: 'cell_vk', x: 100, y: 0 })
    const link = mockLink({
      id: 'l1',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      tms: { switchSources: { tags: ['PS031VK001.ONOFF'] } },
    })
    const graph = mockGraph([cellA, cellB], [link])
    const anims = exportProject(graph).animations.animations
    // short-id из link.id 'l1' = 'l1' (нет дефиса для shortenId)
    const wireKey = 'animation-wire-l1'
    expect(anims).toHaveProperty(wireKey)
    expect(anims[wireKey].bindings[0].when.cases.false.apply.addClass).toBe('animation-off')
    // detailTags на wire-карточке — рантайм откроет popup со связанным тегом
    expect(anims[wireKey].detailTags).toEqual([{ tag: 'PS031VK001.ONOFF' }])
  })

  it('navigation: создаёт animation-cell-{id} с полем navigation + round-trip через data-tms-meta', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_vk',
        slots: { onoff: 'PS031VK001.ONOFF' },
        navigation: 'view_substation_a',
      }),
    ])
    const exported = exportProject(graph)
    const anims = exported.animations.animations
    expect(anims).toHaveProperty('animation-cell-c1')
    expect(anims['animation-cell-c1'].navigation).toBe('view_substation_a')

    // Round-trip: navigation должен попасть в data-tms-meta и восстановиться
    const parsed = parseSvgProject(exported.svgText)
    expect(parsed.ok).toBe(true)
    const cell = parsed.cells.find((c) => c.id === 'c1')
    expect(cell.tms.navigation).toBe('view_substation_a')
  })

  it('navigation у ячейки без других анимаций → создаётся пустая shape-карточка', () => {
    // cell_bus не имеет slots/animationTemplate — обычно без anim-карточки.
    // Но navigation требует animation-entry, чтобы рантайм повесил обработчик клика.
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        navigation: 'view_other',
      }),
    ])
    const anims = exportProject(graph).animations.animations
    // shortenId('b1') = 'b1' (без дефисов)
    expect(anims['animation-cell-b1']).toEqual({
      animation: 'shape',
      bindings: [],
      navigation: 'view_other',
    })
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
