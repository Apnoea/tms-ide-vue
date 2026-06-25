import { describe, it, expect, vi } from 'vitest'
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

function mockLink({ id, source, target, tms = null, vertices = null }) {
  return {
    id,
    get(key) {
      if (key === 'source') return source
      if (key === 'target') return target
      if (key === 'tms') return tms || {}
      return undefined
    },
    vertices: () => vertices || [],
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

  it('cell_qw: пишет data-tms-meta и animation-карточки .QW / .QW-cross по cellId', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qw',
        slots: { onoff: 'PS031VK001.ONOFF' },
        x: 50,
        y: 100,
        w: 20,
        h: 20,
      }),
    ])
    const result = exportProject(graph)
    expect(result.svgText).toContain('data-tms-stencil="cell_qw"')
    expect(result.svgText).toContain('data-tms-meta=')
    // Outer-wrapper id и стенсильные карточки — все по cellId
    expect(result.svgText).toContain('animation-cell_qw-c1')

    const anims = result.animations.animations
    expect(anims).toHaveProperty('animation-cell_qw-c1.QW')
    expect(anims).toHaveProperty('animation-cell_qw-c1.QW-cross')
    // Биндинг тега из slot.onoff — подставлен в шаблоны стенсила
    expect(anims['animation-cell_qw-c1.QW'].bindings[0].tag).toBe('PS031VK001.ONOFF')

    // slot.onoff неявно даёт animation-off биндинг на outer-wrapper:
    // крестик переключается (стенсильный .QW / .QW-cross) И ячейка серая
    // на false без ручного добавления switchSources.
    expect(anims).toHaveProperty('animation-cell_qw-c1')
    const outerOff = anims['animation-cell_qw-c1'].bindings.find(
      (b) =>
        b.tag === 'PS031VK001.ONOFF' && b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(outerOff).toBeDefined()
    // На .QW animation-off уже эмитится стенсильным шаблоном — outer-merge не
    // нужен (избежать дубля). Проверяем, что биндинг РОВНО один.
    const vkOffBindings = anims['animation-cell_qw-c1.QW'].bindings.filter(
      (b) =>
        b.tag === 'PS031VK001.ONOFF' && b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(vkOffBindings).toHaveLength(1)

    // detailTags на outer-wrapper — рантайм откроет popup при клике на ячейку
    expect(anims['animation-cell_qw-c1'].detailTags).toEqual([{ tag: 'PS031VK001.ONOFF' }])
  })

  it('cell_qw без slots: карточки анимаций НЕ эмитятся (нет привязки = нет анимации)', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_qw', x: 0, y: 0, w: 20, h: 20 }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims['animation-cell_qw-c1.QW']).toBeUndefined()
    expect(anims['animation-cell_qw-c1.QW-cross']).toBeUndefined()
    // Без slot.onoff intrinsic-switch не эмитит animation-off
    expect(anims['animation-cell_qw-c1']).toBeUndefined()
  })

  it('cell_value с дефисом в теге: animId = valueTag целиком (не режется по `-`)', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_value',
        valueTag: 'MY-TAG.IA',
        w: 100,
        h: 18,
      }),
    ])
    const result = exportProject(graph)
    // Naive split-by-dash для 'MY-TAG.IA' дал бы 'MY' — рантайм не нашёл бы
    // text-карточку. Для cell_value мы используем valueTag целиком без укорачивания.
    expect(result.svgText).toContain('animation-cell-MY-TAG.IA')
    expect(result.animations.animations).toHaveProperty('animation-MY-TAG.IA')
  })

  it('cell_value с valueTag: id и animation key из тега (рантайм-конвенция, префикс animation-cell-)', () => {
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
    // outer wrapper использует valueTag как идентификатор (рантайм-конвенция),
    // префикс animation-cell- сохраняется — cell_value по семантике рантайма.
    expect(result.svgText).toContain('animation-cell-PS031VV001.IA')
    expect(result.animations.animations).toHaveProperty('animation-PS031VV001.IA')
    const card = result.animations.animations['animation-PS031VV001.IA']
    expect(card.animation).toBe('text')
    expect(card.bindings[0].tag).toBe('PS031VV001.IA')
  })

  it('voltageSource на ячейке → карточка outer + merge в стенсильные', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qw',
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
    expect(anims).toHaveProperty('animation-cell_qw-c1')
    expect(anims['animation-cell_qw-c1'].bindings[0].tag).toBe('PS031.UA')
    // voltage биндинг МЕРЖИТСЯ в .QW / .QW-cross
    const vkBindings = anims['animation-cell_qw-c1.QW'].bindings
    expect(vkBindings.some((b) => b.tag === 'PS031.UA')).toBe(true)
  })

  it('voltageSource с tag но без ranges → не падает, voltage-карточка не создаётся', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_bus', w: 80, h: 8, voltageSource: { tag: 'X' } }),
    ])
    // Главное — экспорт не бросает TypeError на vs.ranges.map.
    const anims = exportProject(graph).animations.animations
    // Без ranges range-биндинга нет (карточка либо отсутствует, либо без voltage-tag).
    const card = anims['animation-cell_bus-c1']
    expect(card?.bindings?.some((b) => b.tag === 'X')).not.toBe(true)
  })

  it('voltageSource с пустым ranges → не падает, voltage-карточка не создаётся', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        voltageSource: { tag: 'X', ranges: [] },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims['animation-cell_bus-c1']?.bindings?.some((b) => b.tag === 'X')).not.toBe(true)
  })

  it('cell_qw: slot.onoff + switchSources родителей → N+1 независимых биндингов', () => {
    // Типичный кейс: свой выключатель + общий по ПС + секционный. Все три тега
    // независимы; любой false → ячейка серая (AND через несколько биндингов).
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qw',
        slots: { onoff: 'LOCAL.ONOFF' },
        switchSources: { and: ['ОБЩИЙ.ONOFF', 'SECTION.ONOFF'] },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    const bindings = anims['animation-cell_qw-c1'].bindings
    const offBindings = bindings.filter(
      (b) => b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(offBindings).toHaveLength(3)
    expect(offBindings.map((b) => b.tag).sort()).toEqual(
      ['LOCAL.ONOFF', 'SECTION.ONOFF', 'ОБЩИЙ.ONOFF'].sort()
    )
    // На .QW: 1 стенсильный (slot.onoff) + 2 от switchSources родителей =
    // 3 биндинга animation-off. slot.onoff в outer-merge НЕ задваивается
    // (стенсильный шаблон уже эмитит этот тег прямо в .QW).
    const vkBindings = anims['animation-cell_qw-c1.QW'].bindings
    const vkOff = vkBindings.filter(
      (b) => b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(vkOff).toHaveLength(3)
    expect(vkOff.map((b) => b.tag).sort()).toEqual(
      ['LOCAL.ONOFF', 'SECTION.ONOFF', 'ОБЩИЙ.ONOFF'].sort()
    )
  })

  it('switchSources на линии → карточка с animation-off на link-id', () => {
    const cellA = mockCell({ id: 'a', stencilId: 'cell_qw', x: 0, y: 0 })
    const cellB = mockCell({ id: 'b', stencilId: 'cell_qw', x: 100, y: 0 })
    const link = mockLink({
      id: 'l1',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      tms: { switchSources: { and: ['PS031VK001.ONOFF'] } },
    })
    const graph = mockGraph([cellA, cellB], [link])
    const anims = exportProject(graph).animations.animations
    // short-id из link.id 'l1' = 'l1' (нет дефисов для разделения по сегментам UUID)
    const wireKey = 'animation-wire-l1'
    expect(anims).toHaveProperty(wireKey)
    expect(anims[wireKey].bindings[0].when.cases.false.apply.addClass).toBe('animation-off')
    // detailTags на wire-карточке — рантайм откроет popup со связанным тегом
    expect(anims[wireKey].detailTags).toEqual([{ tag: 'PS031VK001.ONOFF' }])
  })

  it('switchSources or (Параллельно): multi, серый только когда ВСЕ открыты', () => {
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        switchSources: { or: ['BR1.ONOFF', 'BR2.ONOFF'], and: [] },
      }),
    ])
    const card = exportProject(graph).animations.animations['animation-cell_bus-b1']
    expect(card.animation).toBe('multi')
    const mc = card.bindings.find((b) => b.multiCondition)?.multiCondition
    // все «Параллельно» открыты → AND условий «открыт»
    expect(mc.expression).toBe('(o0 && o1)')
    expect(mc.conditions.map((c) => c.tag)).toEqual(['BR1.ONOFF', 'BR2.ONOFF'])
    expect(mc.conditions[0].when).toEqual({ type: 'map', cases: { false: true } })
    expect(mc.apply.addClass).toBe('animation-off')
  })

  it('switchSources mixed (Параллельно + Последовательно): (o0) && (a0 || a1)', () => {
    // Кейс «шина с двух сторон»: путь A = №1&№2 последовательно, путь B = №3.
    // Жива = №3 ИЛИ (№1 И №2). Серая = №3откр И (№1откр ИЛИ №2откр).
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        switchSources: { or: ['BR3.ONOFF'], and: ['BR1.ONOFF', 'BR2.ONOFF'] },
      }),
    ])
    const card = exportProject(graph).animations.animations['animation-cell_bus-b1']
    expect(card.animation).toBe('multi')
    const mc = card.bindings.find((b) => b.multiCondition)?.multiCondition
    expect(mc.expression).toBe('(o0) && (a0 || a1)')
    expect(mc.conditions.map((c) => c.tag)).toEqual(['BR3.ONOFF', 'BR1.ONOFF', 'BR2.ONOFF'])
  })

  it('switchSources or + voltage: один multi-card со слоями (voltage + switch)', () => {
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        voltageSource: { tag: 'PS.UA', ranges: [{ min: 0, max: 5, class: 'animation-low' }] },
        switchSources: { or: ['BR1.ONOFF', 'BR2.ONOFF'], and: [] },
      }),
    ])
    const card = exportProject(graph).animations.animations['animation-cell_bus-b1']
    expect(card.animation).toBe('multi')
    const vBind = card.bindings.find((b) => b.multiCondition?.apply?.addClass === 'animation-low')
    expect(vBind.multiCondition.conditions[0].tag).toBe('PS.UA')
    expect(vBind.multiCondition.conditions[0].when.type).toBe('range')
    const orBind = card.bindings.find((b) => b.multiCondition?.expression === '(o0 && o1)')
    expect(orBind.multiCondition.apply.addClass).toBe('animation-off')
  })

  it('switchSources and-only (Последовательно) → дешёвый shape, не multi', () => {
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        switchSources: { or: [], and: ['BR1.ONOFF', 'BR2.ONOFF'] },
      }),
    ])
    const card = exportProject(graph).animations.animations['animation-cell_bus-b1']
    expect(card.animation).toBe('shape')
    expect(card.bindings).toHaveLength(2)
  })

  it('switchSources or/mixed на ПРОВОДЕ → wire-карточка multi (не плоский AND)', () => {
    // Регрессия: OR/mixed работал на ячейках, а линк флэтил в AND (любой
    // открыт → серый), игнорируя «Параллельно». Должен быть multi с выражением.
    const cellA = mockCell({ id: 'a', stencilId: 'cell_qw', x: 0, y: 0 })
    const cellB = mockCell({ id: 'b', stencilId: 'cell_qw', x: 100, y: 0 })
    const link = mockLink({
      id: 'l1',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      tms: { switchSources: { or: ['BR3.ONOFF'], and: ['BR1.ONOFF', 'BR2.ONOFF'] } },
    })
    const anims = exportProject(mockGraph([cellA, cellB], [link])).animations.animations
    const card = anims['animation-wire-l1']
    expect(card.animation).toBe('multi')
    const mc = card.bindings.find((b) => b.multiCondition)?.multiCondition
    expect(mc.expression).toBe('(o0) && (a0 || a1)')
    expect(mc.conditions.map((c) => c.tag)).toEqual(['BR3.ONOFF', 'BR1.ONOFF', 'BR2.ONOFF'])
    expect(mc.apply.addClass).toBe('animation-off')
  })

  it('navigation: создаёт outer-карточку с полем navigation + round-trip через data-tms-meta', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qw',
        slots: { onoff: 'PS031VK001.ONOFF' },
        navigation: 'view_substation_a',
      }),
    ])
    const exported = exportProject(graph)
    const anims = exported.animations.animations
    expect(anims).toHaveProperty('animation-cell_qw-c1')
    expect(anims['animation-cell_qw-c1'].navigation).toBe('view_substation_a')

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
    // short-id из 'b1' = 'b1' (без дефисов для разделения)
    expect(anims['animation-cell_bus-b1']).toEqual({
      animation: 'shape',
      bindings: [],
      navigation: 'view_other',
    })
  })

  it('cell_qr с slot.onoff: .closed (cases.false→hidden) и .open (cases.true→hidden)', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qr',
        slots: { onoff: 'TAG.ONOFF' },
        w: 20,
        h: 40,
      }),
    ])
    const exported = exportProject(graph)
    const anims = exported.animations.animations

    // Две карточки на двух SVG-линиях
    expect(anims).toHaveProperty('animation-cell_qr-c1.closed')
    expect(anims).toHaveProperty('animation-cell_qr-c1.open')

    // .closed: hidden при value=false
    const closedBinding = anims['animation-cell_qr-c1.closed'].bindings.find(
      (b) => b.when?.source === 'value'
    )
    expect(closedBinding?.tag).toBe('TAG.ONOFF')
    expect(closedBinding?.when?.cases?.false?.apply?.addClass).toBe('animation-hidden')

    // .open: hidden при value=true
    const openBinding = anims['animation-cell_qr-c1.open'].bindings.find(
      (b) => b.when?.source === 'value'
    )
    expect(openBinding?.tag).toBe('TAG.ONOFF')
    expect(openBinding?.when?.cases?.true?.apply?.addClass).toBe('animation-hidden')

    // В SVG обе линии получили id, по которым их найдёт WebScada
    expect(exported.svgText).toContain('id="animation-cell_qr-c1.closed"')
    expect(exported.svgText).toContain('id="animation-cell_qr-c1.open"')
  })

  it('quality: cell_qk получает bad-биндинг ТОЛЬКО на outer для каждого тега', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qk',
        slots: { onoff: 'LOCAL.ONOFF' },
        switchSources: { and: ['ОБЩИЙ.ONOFF'] },
        voltageSource: {
          tag: 'PS031.UA',
          ranges: [{ min: 0, max: 5, class: 'animation-low' }],
        },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    const outer = anims['animation-cell_qk-c1']
    const qBindings = outer.bindings.filter((b) => b.when?.source === 'quality')
    expect(qBindings.map((b) => b.tag).sort()).toEqual(
      ['PS031.UA', 'LOCAL.ONOFF', 'ОБЩИЙ.ONOFF'].sort()
    )
    for (const b of qBindings) {
      expect(b.when.type).toBe('range')
      expect(b.when.cases).toEqual([{ min: 0, max: 191, apply: { addClass: 'animation-off' } }])
    }
    // Inner-карточки (.closed / .open) quality НЕ должны иметь —
    // animation-off на outer и так каскадит на все потомки.
    for (const key of Object.keys(anims)) {
      if (key === 'animation-cell_qk-c1') continue
      if (!key.startsWith('animation-cell_qk-c1')) continue
      const innerQ = (anims[key].bindings || []).filter((b) => b.when?.source === 'quality')
      expect(innerQ).toEqual([])
    }
  })

  it('quality: cell_qk без тегов (голый стенсил) — outer-карточка не создаётся', () => {
    const graph = mockGraph([mockCell({ id: 'c1', stencilId: 'cell_qk' })])
    const anims = exportProject(graph).animations.animations
    expect(anims['animation-cell_qk-c1']).toBeUndefined()
  })

  it('quality: остальные стенсилы (cell_qw и т.п.) quality-биндингов НЕ получают', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qw',
        slots: { onoff: 'LOCAL.ONOFF' },
        voltageSource: {
          tag: 'PS031.UA',
          ranges: [{ min: 0, max: 5, class: 'animation-low' }],
        },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    for (const card of Object.values(anims)) {
      expect(card.bindings?.every((b) => b.when?.source !== 'quality')).toBe(true)
    }
  })

  it('cell_value: спецсимволы в valueTag (&, <, ") не ломают XML — round-trip через projectLoader', () => {
    // Контрфактический valueTag — реальные SCADA-теги такого не содержат, но без
    // эскейпа экспорт дал бы невалидный XML и projectLoader упал бы на parsererror.
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_value',
        valueTag: 'A&B<C"D',
        w: 100,
        h: 18,
      }),
    ])
    const { svgText } = exportProject(graph)
    // Реальный round-trip: экспортированный SVG валиден и читается обратно с тем
    // же тегом (без эскейпа parseSvgProject вернул бы ok=false на parsererror).
    const parsed = parseSvgProject(svgText)
    expect(parsed.ok).toBe(true)
    const cell = parsed.cells.find((c) => c.id === 'c1')
    expect(cell?.tms.valueTag).toBe('A&B<C"D')
  })

  it('warnings: два cell_value с одинаковым valueTag → дубль попадает в result.warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_value', valueTag: 'PS031.UA' }),
      mockCell({ id: 'c2', stencilId: 'cell_value', valueTag: 'PS031.UA' }),
    ])
    const result = exportProject(graph)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/PS031\.UA/)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('дубль valueTag → уникальные outer-id (валидный SVG), второй с суффиксом', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_value', valueTag: 'PS031.UA' }),
      mockCell({ id: 'c2', stencilId: 'cell_value', valueTag: 'PS031.UA' }),
    ])
    const { svgText } = exportProject(graph)
    // Базовый outer-id — ровно один раз (без duplicate-id в SVG).
    const base = (svgText.match(/id="animation-cell-PS031\.UA"/g) || []).length
    expect(base).toBe(1)
    // Второй cell_value получил уникальный суффикс.
    expect(svgText).toContain('animation-cell-PS031.UA__2')
    warnSpy.mockRestore()
  })

  it('short-id collision: две ячейки с одинаковым первым сегментом UUID получают разные animation-keys', () => {
    // Контрфактический сценарий: два UUID с совпадающим первым сегментом.
    // Без uniqueShortId оба свернулись бы в animId='abc12345' и слили бы свои
    // bindings (LOCAL.A и LOCAL.B) в одну карточку + дубль id в SVG.
    const graph = mockGraph([
      mockCell({
        id: 'abc12345-1111-1111-1111-111111111111',
        stencilId: 'cell_qw',
        slots: { onoff: 'LOCAL.A' },
      }),
      mockCell({
        id: 'abc12345-2222-2222-2222-222222222222',
        stencilId: 'cell_qw',
        slots: { onoff: 'LOCAL.B' },
      }),
    ])
    const exported = exportProject(graph)
    const anims = exported.animations.animations
    // Первая ячейка получает короткий первый сегмент, вторая расширяется.
    expect(anims['animation-cell_qw-abc12345']).toBeDefined()
    expect(anims['animation-cell_qw-abc12345-2222']).toBeDefined()
    // Биндинги НЕ слились в одну карточку
    const firstTags = anims['animation-cell_qw-abc12345'].bindings.map((b) => b.tag)
    const secondTags = anims['animation-cell_qw-abc12345-2222'].bindings.map((b) => b.tag)
    expect(firstTags).toContain('LOCAL.A')
    expect(firstTags).not.toContain('LOCAL.B')
    expect(secondTags).toContain('LOCAL.B')
    expect(secondTags).not.toContain('LOCAL.A')
    // В SVG id'шники тоже различны (без дубля → валидный SVG)
    expect(exported.svgText).toContain('id="animation-cell_qw-abc12345"')
    expect(exported.svgText).toContain('id="animation-cell_qw-abc12345-2222"')
  })

  it('экспорт + load round-trip: cells сохраняют tms.slots и position', () => {
    const graph = mockGraph(
      [
        mockCell({
          id: 'c1',
          stencilId: 'cell_qw',
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
    expect(cells[0].tms.stencilId).toBe('cell_qw')
    expect(cells[0].tms.slots).toEqual({ onoff: 'PS031VK001.ONOFF' })
  })

  it('экспорт + load round-trip: ручные изломы провода сохраняются', () => {
    const verts = [
      { x: 60, y: 40 },
      { x: 60, y: 120 },
    ]
    const graph = mockGraph(
      [
        mockCell({ id: 'c1', stencilId: 'cell_qw', x: 0, y: 0, w: 20, h: 20 }),
        mockCell({ id: 'c2', stencilId: 'cell_qw', x: 100, y: 100, w: 20, h: 20 }),
      ],
      [
        mockLink({
          id: 'l1',
          source: { id: 'c1', port: 'right' },
          target: { id: 'c2', port: 'left' },
          vertices: verts,
        }),
      ]
    )
    const exported = exportProject(graph)
    const parsed = parseSvgProject(exported.svgText)
    expect(parsed.ok).toBe(true)
    const link = parsed.cells.find((c) => c.type === 'standard.Link')
    expect(link).toBeTruthy()
    expect(link.vertices).toEqual(verts)
  })

  it('битый линк (endpoint без size) не роняет экспорт — провод пропускается', () => {
    // Ячейка без size: getEndpointPos возвращает null (а не падает на size.width)
    // → линк пропускается, экспорт формы не рушится.
    const broken = {
      id: 'b1',
      get(key) {
        if (key === 'tms') return { stencilId: 'cell_node' }
        if (key === 'position') return { x: 0, y: 0 }
        return undefined // size отсутствует
      },
    }
    const good = mockCell({ id: 'g1', stencilId: 'cell_node', x: 100, y: 0, w: 20, h: 20 })
    const link = mockLink({ id: 'L1', source: { id: 'b1' }, target: { id: 'g1' } })
    // broken — только endpoint (не в elements), иначе цикл по ячейкам сам бы упал.
    const graph = {
      getElements: () => [good],
      getLinks: () => [link],
      getCell: (id) => (id === 'b1' ? broken : [good, link].find((c) => c.id === id)),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let result
    expect(() => (result = exportProject(graph))).not.toThrow()
    const parsed = parseSvgProject(result.svgText)
    expect(parsed.cells.filter((c) => c.type === 'standard.Link')).toHaveLength(0)
    warn.mockRestore()
  })

  it('линк с ненайденным портом → центр ячейки + console.warn, линк экспортируется', () => {
    const a = mockCell({ id: 'a1', stencilId: 'cell_node', x: 0, y: 0, w: 20, h: 20 })
    const b = mockCell({ id: 'b1', stencilId: 'cell_node', x: 100, y: 0, w: 20, h: 20 })
    // port 'ghost' нет в items (у mockCell ports не заданы) → fallback в центр + warn.
    const link = mockLink({ id: 'L1', source: { id: 'a1', port: 'ghost' }, target: { id: 'b1' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = exportProject(mockGraph([a, b], [link]))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Порт "ghost" не найден'))
    const parsed = parseSvgProject(result.svgText)
    expect(parsed.cells.filter((c) => c.type === 'standard.Link')).toHaveLength(1)
    warn.mockRestore()
  })
})
