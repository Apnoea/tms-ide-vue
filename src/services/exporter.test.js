import { describe, it, expect, vi } from 'vitest'
import { exportProject } from './exporter'
import { parseSvgProject } from './projectLoader'
import { LINK_Z } from '../stencils/linkDefaults'
import { computeBusPorts } from '../stencils/busCell'
import { CELL_META_FIELDS, LINK_META_FIELDS } from '../constants/ids'

// Мок-граф: минимальный интерфейс JointJS-graph'а, который дёргает exporter.
// Не зависит от реального dia.Graph — тесты быстрые и не требуют jsdom-setup'а
// JointJS-внутренностей.

function mockCell({ id, stencilId, x = 0, y = 0, w = 40, h = 40, z, ports, ...extra }) {
  const tms = { stencilId, ...extra }
  return {
    id,
    get(key) {
      if (key === 'tms') return tms
      if (key === 'position') return { x, y }
      if (key === 'size') return { width: w, height: h }
      if (key === 'z') return z
      if (key === 'ports') return ports
      return undefined
    },
  }
}

function mockLink({ id, source, target, tms = null, vertices = null, z = undefined }) {
  return {
    id,
    get(key) {
      if (key === 'source') return source
      if (key === 'target') return target
      if (key === 'tms') return tms || {}
      if (key === 'z') return z
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

  it('cell_qw: пишет data-tms-meta и переключение позиции через .true', () => {
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
    expect(result.svgText).toContain('animation-cell_qw-c1')

    const anims = result.animations.animations
    // Своей серости у cell_qw больше нет — карточки .QW не существует.
    expect(anims['animation-cell_qw-c1.QW']).toBeUndefined()
    // Позицию (+/−) переключает .true: onoff=false → крестик скрыт.
    expect(anims).toHaveProperty('animation-cell_qw-c1.true')
    const cross = anims['animation-cell_qw-c1.true'].bindings[0]
    expect(cross.tag).toBe('PS031VK001.ONOFF')
    expect(cross.when?.cases?.false?.apply?.addClass).toBe('animation-hidden')

    // Outer-wrapper есть ради detailTags, но своего animation-off нет: серость
    // (де-энергизация) задаётся на холсте (boolSource), а не в стенсиле.
    expect(anims).toHaveProperty('animation-cell_qw-c1')
    const anyOff = Object.values(anims).some((card) =>
      (card.bindings || []).some((b) => b.when?.cases?.false?.apply?.addClass === 'animation-off')
    )
    expect(anyOff).toBe(false)

    // detailTags на outer-wrapper — рантайм откроет popup при клике на ячейку
    expect(anims['animation-cell_qw-c1'].detailTags).toEqual([{ tag: 'PS031VK001.ONOFF' }])
  })

  it('cell_qw без slots: карточки анимаций НЕ эмитятся (нет привязки = нет анимации)', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_qw', x: 0, y: 0, w: 20, h: 20 }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims['animation-cell_qw-c1.true']).toBeUndefined()
    // Без привязок нет и detailTags → outer-карточка не создаётся
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

  it('cell_value: точность из tms.decimals, иначе дефолт (формат считает рантайм)', () => {
    const card = (extra) => {
      const graph = mockGraph([
        mockCell({ id: 'v1', stencilId: 'cell_value', valueTag: 'T1.VAL', ...extra }),
      ])
      return exportProject(graph).animations.animations['animation-T1.VAL']
    }
    expect(card({}).bindings[0].output.decimals).toBe(2)
    expect(card({ decimals: 0 }).bindings[0].output.decimals).toBe(0)
    expect(card({ decimals: 4 }).bindings[0].output.decimals).toBe(4)
  })

  it('cell_value: выбранная величина переживает round-trip', () => {
    // Без явной пары подпись/единица восстанавливались бы из пресета по суффиксу
    // тега — то есть выбор автора молча откатывался бы.
    const graph = mockGraph([
      mockCell({
        id: 'v1',
        stencilId: 'cell_value',
        valueTag: 'T1.RAW',
        valueLabel: 'Уровень',
        valueUnit: 'м',
      }),
    ])
    const parsed = parseSvgProject(exportProject(graph).svgText)
    expect(parsed.cells.find((c) => c.id === 'v1').tms).toMatchObject({
      valueLabel: 'Уровень',
      valueUnit: 'м',
    })
  })

  it('cell_node: цвет и диаметр точки переживают round-trip', () => {
    const graph = mockGraph([
      mockCell({ id: 'n1', stencilId: 'cell_node', w: 20, h: 20, color: '#ff8800', dotSize: 8 }),
    ])
    const exported = exportProject(graph)
    expect(exported.svgText).toContain('r="4"')
    const cell = parseSvgProject(exported.svgText).cells.find((c) => c.id === 'n1')
    expect(cell.tms).toMatchObject({ color: '#ff8800', dotSize: 8 })
    // Габарит ячейки от диаметра не зависит — на нём держатся hit-area и порт.
    expect(cell.size).toMatchObject({ width: 20, height: 20 })
  })

  it('cell_bus: цвет тела переживает round-trip, дефолт в meta не пишется', () => {
    const graph = mockGraph([
      mockCell({ id: 'b1', stencilId: 'cell_bus', w: 100, h: 10, color: '#ff8800' }),
      mockCell({ id: 'b2', stencilId: 'cell_bus', w: 100, h: 10 }),
    ])
    const exported = exportProject(graph)
    expect(exported.svgText).toContain('fill="#ff8800"')
    const parsed = parseSvgProject(exported.svgText)
    expect(parsed.cells.find((c) => c.id === 'b1').tms.color).toBe('#ff8800')
    expect(parsed.cells.find((c) => c.id === 'b2').tms.color).toBeUndefined()
  })

  it('cell_bus: толщина переживает round-trip, порты встают в её середину', () => {
    const graph = mockGraph([mockCell({ id: 'b1', stencilId: 'cell_bus', w: 80, h: 20 })])
    const cell = parseSvgProject(exportProject(graph).svgText).cells[0]
    expect(cell.size).toMatchObject({ width: 80, height: 20 })
    expect(cell.ports.items.find((i) => i.id === 'p_0').args.y).toBe(10)
  })

  it('cell_bus: маркер соединения только на занятых слотах', () => {
    // Порты в view.svg не идут, а слот стоит в середине толщины — конец провода
    // уходит под тело шины, и без точки соединение читалось бы как «мимо».
    const bus = mockCell({
      id: 'b1',
      stencilId: 'cell_bus',
      y: 100,
      w: 80,
      h: 20,
      ports: { items: computeBusPorts(80, 20) },
    })
    const graph = mockGraph(
      [bus, mockCell({ id: 'g1', stencilId: 'cell_node', y: 300, w: 20, h: 20 })],
      [
        mockLink({
          id: 'L1',
          source: { id: 'b1', port: 'p_1' },
          target: { id: 'g1' },
          tms: { strokeColor: '#ff8800', strokeWidth: 4 },
        }),
      ]
    )
    const svg = exportProject(graph).svgText
    // Слот p_1 → x=40, середина толщины 20 → cy=10; обводка цветом провода.
    expect(svg).toMatch(/cx="40" cy="10" r="5" fill="#ffffff" stroke="#ff8800"/)
    // Свободные слоты (p_0 → x=20, p_2 → x=60) точку не получают.
    expect(svg).not.toMatch(/cx="20" cy="10"/)
    expect(svg).not.toMatch(/cx="60" cy="10"/)
  })

  it('чужой цвет из архива не доезжает до атрибута fill', () => {
    // `color` уходит в fill экспортного SVG, а архив чужой: `url(...)` или обрывок
    // правила там означал бы подмену отрисовки.
    const graph = mockGraph([
      mockCell({ id: 'b1', stencilId: 'cell_bus', w: 100, h: 10, color: 'url(#evil)' }),
    ])
    const exported = exportProject(graph)
    expect(exported.svgText).not.toContain('url(#evil)')
    expect(parseSvgProject(exported.svgText).cells[0].tms.color).toBeUndefined()
  })

  it('cell_value без тега: предупреждение экспорта (карточка останется прочерком)', () => {
    // На схеме такая карточка выглядит рабочей, а в рантайме её нечем обновлять —
    // молча выпускать её в архив нельзя.
    const graph = mockGraph([mockCell({ id: 'v1', stencilId: 'cell_value', w: 100, h: 20 })])
    const { warnings } = exportProject(graph)
    expect(warnings.some((w) => w.includes('тег не выбран'))).toBe(true)
    // С тегом предупреждения нет.
    const ok = exportProject(
      mockGraph([mockCell({ id: 'v2', stencilId: 'cell_value', valueTag: 'T1.VAL' })])
    )
    expect(ok.warnings.some((w) => w.includes('тег не выбран'))).toBe(false)
  })

  it('cell_value: растянутая ширина переживает round-trip', () => {
    // Ширину карточки задаёт автор (ручки/поле), и содержимое раскладывается от неё —
    // без round-trip'а после импорта она вернулась бы к 100 из stencil.json.
    const graph = mockGraph([
      mockCell({ id: 'v1', stencilId: 'cell_value', valueTag: 'T1.VAL', w: 180, h: 20 }),
    ])
    const parsed = parseSvgProject(exportProject(graph).svgText)
    expect(parsed.cells.find((c) => c.id === 'v1').size).toMatchObject({ width: 180, height: 20 })
  })

  it('cell_value: точность переживает round-trip, пустая в meta не пишется', () => {
    const graph = mockGraph([
      mockCell({ id: 'v1', stencilId: 'cell_value', valueTag: 'T1.VAL', decimals: 3 }),
      mockCell({ id: 'v2', stencilId: 'cell_value', valueTag: 'T2.VAL' }),
    ])
    const parsed = parseSvgProject(exportProject(graph).svgText)
    expect(parsed.cells.find((c) => c.id === 'v1').tms.decimals).toBe(3)
    expect(parsed.cells.find((c) => c.id === 'v2').tms.decimals).toBeUndefined()
  })

  it('rangeSource на ячейке → карточка outer + merge в стенсильные', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qw',
        slots: { onoff: 'PS031VK001.ONOFF' },
        rangeSource: {
          tag: 'PS031.UA',
          ranges: [
            { min: 0, max: 5, color: '#10b981' },
            { min: 5, max: 10, color: '#ef4444' },
          ],
        },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims).toHaveProperty('animation-cell_qw-c1')
    expect(anims['animation-cell_qw-c1'].bindings[0].tag).toBe('PS031.UA')
    // range-биндинг МЕРЖИТСЯ в стенсильную .true
    const vkBindings = anims['animation-cell_qw-c1.true'].bindings
    expect(vkBindings.some((b) => b.tag === 'PS031.UA')).toBe(true)
  })

  it('одинаковые границы = точное значение (сравнение inclusive по обоим концам)', () => {
    // Так настраивается целочисленный тег: режим 2 → своя строка со своим цветом.
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        rangeSource: {
          tag: 'PS031.MODE',
          ranges: [
            { min: 2, max: 2, color: '#10b981' },
            { min: 3, max: 3, color: '#ef4444' },
          ],
        },
      }),
    ])
    const when =
      exportProject(graph).animations.animations['animation-cell_bus-c1'].bindings[0].when
    expect(when.type).toBe('range')
    expect(when.cases).toEqual([
      { min: 2, max: 2, apply: { addClass: 'animation-c-10b981' } },
      { min: 3, max: 3, apply: { addClass: 'animation-c-ef4444' } },
    ])
  })

  it('строка без порогов не попадает в карточку и уходит в warnings', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        rangeSource: {
          tag: 'T.U',
          ranges: [{ min: 0, max: 5, color: '#10b981' }, { color: '#ef4444' }],
        },
      }),
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = exportProject(graph)
    expect(result.warnings.some((w) => w.includes('без порогов'))).toBe(true)
    const cases = result.animations.animations['animation-cell_bus-c1'].bindings[0].when.cases
    expect(cases).toHaveLength(1)
    warn.mockRestore()
  })

  it('rangeSource с tag но без ranges → не падает, range-карточка не создаётся', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_bus', w: 80, h: 8, rangeSource: { tag: 'X' } }),
    ])
    // Главное — экспорт не бросает TypeError на vs.ranges.map.
    const anims = exportProject(graph).animations.animations
    // Без ranges range-биндинга нет (карточка либо отсутствует, либо без тега).
    const card = anims['animation-cell_bus-c1']
    expect(card?.bindings?.some((b) => b.tag === 'X')).not.toBe(true)
  })

  it('rangeSource с пустым ranges → не падает, range-карточка не создаётся', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        rangeSource: { tag: 'X', ranges: [] },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    expect(anims['animation-cell_bus-c1']?.bindings?.some((b) => b.tag === 'X')).not.toBe(true)
  })

  it('cell_qw: свой onoff → позиция (.true), boolSource родителей → серость на outer', () => {
    // Типичный кейс: свой выключатель + общий по ПС + секционный. Своя серость
    // убрана — LOCAL.ONOFF только переключает позицию (.true), а серость
    // (обесточенность) даёт boolSource родителей на outer (красит всё каскадом).
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qw',
        slots: { onoff: 'LOCAL.ONOFF' },
        boolSource: { groups: [['ОБЩИЙ.ONOFF', 'SECTION.ONOFF']] },
      }),
    ])
    const anims = exportProject(graph).animations.animations
    // Outer сереет только по родительским тегам.
    const outerOff = anims['animation-cell_qw-c1'].bindings.filter(
      (b) => b.when?.cases?.false?.apply?.addClass === 'animation-off'
    )
    expect(outerOff.map((b) => b.tag).sort()).toEqual(['SECTION.ONOFF', 'ОБЩИЙ.ONOFF'].sort())
    // Свой onoff (LOCAL) прячет крестик (.true), но серым НЕ делает.
    const cross = anims['animation-cell_qw-c1.true'].bindings
    expect(
      cross.find(
        (b) =>
          b.tag === 'LOCAL.ONOFF' && b.when?.cases?.false?.apply?.addClass === 'animation-hidden'
      )
    ).toBeDefined()
    expect(
      cross.find(
        (b) => b.tag === 'LOCAL.ONOFF' && b.when?.cases?.false?.apply?.addClass === 'animation-off'
      )
    ).toBeUndefined()
  })

  it('boolSource на линии → карточка с animation-off на link-id', () => {
    const cellA = mockCell({ id: 'a', stencilId: 'cell_qw', x: 0, y: 0 })
    const cellB = mockCell({ id: 'b', stencilId: 'cell_qw', x: 100, y: 0 })
    const link = mockLink({
      id: 'l1',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      tms: { boolSource: { groups: [['PS031VK001.ONOFF']] } },
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

  it('boolSource 2 группы по 1 тегу: multi, серый только когда ВСЕ открыты', () => {
    // Две одиночные группы = «две независимые ветки»: жива, если замкнута любая.
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        boolSource: { groups: [['BR1.ONOFF'], ['BR2.ONOFF']] },
      }),
    ])
    const card = exportProject(graph).animations.animations['animation-cell_bus-b1']
    expect(card.animation).toBe('multi')
    const mc = card.bindings.find((b) => b.multiCondition)?.multiCondition
    // серый = в каждой группе тег открыт → И по группам (внутри — ИЛИ «открыт»)
    expect(mc.expression).toBe('(g0t0) && (g1t0)')
    expect(mc.conditions.map((c) => c.tag)).toEqual(['BR1.ONOFF', 'BR2.ONOFF'])
    expect(mc.conditions[0].when).toEqual({ type: 'map', cases: { false: true } })
    expect(mc.apply.addClass).toBe('animation-off')
  })

  it('boolSource 2 группы (И внутри, ИЛИ между): (g0t0 || g0t1) && (g1t0)', () => {
    // Кейс «шина с двух сторон»: группа A = №1&№2 (последовательно), группа B = №3.
    // Жива = (№1 И №2) ИЛИ №3. Серая = (№1откр ИЛИ №2откр) И №3откр.
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        boolSource: { groups: [['BR1.ONOFF', 'BR2.ONOFF'], ['BR3.ONOFF']] },
      }),
    ])
    const card = exportProject(graph).animations.animations['animation-cell_bus-b1']
    expect(card.animation).toBe('multi')
    const mc = card.bindings.find((b) => b.multiCondition)?.multiCondition
    expect(mc.expression).toBe('(g0t0 || g0t1) && (g1t0)')
    expect(mc.conditions.map((c) => c.tag)).toEqual(['BR1.ONOFF', 'BR2.ONOFF', 'BR3.ONOFF'])
  })

  it('boolSource группы + диапазоны: один multi-card со слоями (диапазоны + булево)', () => {
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        rangeSource: { tag: 'PS.UA', ranges: [{ min: 0, max: 5, color: '#10b981' }] },
        boolSource: { groups: [['BR1.ONOFF'], ['BR2.ONOFF']] },
      }),
    ])
    const card = exportProject(graph).animations.animations['animation-cell_bus-b1']
    expect(card.animation).toBe('multi')
    const vBind = card.bindings.find(
      (b) => b.multiCondition?.apply?.addClass === 'animation-c-10b981'
    )
    expect(vBind.multiCondition.conditions[0].tag).toBe('PS.UA')
    expect(vBind.multiCondition.conditions[0].when.type).toBe('range')
    const orBind = card.bindings.find((b) => b.multiCondition?.expression === '(g0t0) && (g1t0)')
    expect(orBind.multiCondition.apply.addClass).toBe('animation-off')
  })

  it('boolSource одна группа (И) → дешёвый shape, не multi', () => {
    const graph = mockGraph([
      mockCell({
        id: 'b1',
        stencilId: 'cell_bus',
        w: 80,
        h: 8,
        boolSource: { groups: [['BR1.ONOFF', 'BR2.ONOFF']] },
      }),
    ])
    const card = exportProject(graph).animations.animations['animation-cell_bus-b1']
    expect(card.animation).toBe('shape')
    expect(card.bindings).toHaveLength(2)
  })

  it('boolSource ≥2 групп на ПРОВОДЕ → wire-карточка multi (не плоский AND)', () => {
    // Регрессия: OR-агрегация работала на ячейках, а линк флэтил в AND (любой
    // открыт → серый), игнорируя ветвление. Должен быть multi с выражением.
    const cellA = mockCell({ id: 'a', stencilId: 'cell_qw', x: 0, y: 0 })
    const cellB = mockCell({ id: 'b', stencilId: 'cell_qw', x: 100, y: 0 })
    const link = mockLink({
      id: 'l1',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      tms: { boolSource: { groups: [['BR1.ONOFF', 'BR2.ONOFF'], ['BR3.ONOFF']] } },
    })
    const anims = exportProject(mockGraph([cellA, cellB], [link])).animations.animations
    const card = anims['animation-wire-l1']
    expect(card.animation).toBe('multi')
    const mc = card.bindings.find((b) => b.multiCondition)?.multiCondition
    expect(mc.expression).toBe('(g0t0 || g0t1) && (g1t0)')
    expect(mc.conditions.map((c) => c.tag)).toEqual(['BR1.ONOFF', 'BR2.ONOFF', 'BR3.ONOFF'])
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

  it('cell_text из архива читается фигурой-подписью, вид сохраняется', () => {
    // Подпись перестала быть символом: на входе она конвертируется в разметку
    // (см. services/legacyFormat), поэтому round-trip отдаёт `tms.Shape`.
    const graph = mockGraph([
      mockCell({
        id: 't1',
        stencilId: 'cell_text',
        text: 'Секция',
        color: '#ff0000',
        fontSize: 20,
        bold: true,
        align: 'right',
      }),
    ])
    const parsed = parseSvgProject(exportProject(graph).svgText)
    expect(parsed.ok).toBe(true)
    const cell = parsed.cells.find((c) => c.id === 't1')
    expect(cell.type).toBe('tms.Shape')
    expect(cell.tms.shape).toMatchObject({
      type: 'text',
      text: 'Секция',
      fontSize: 20,
      bold: true,
      stroke: '#ff0000',
      align: 'right',
    })
  })

  it('cell_text: шрифт доезжает до SVG и переживает конвертацию в фигуру', () => {
    const graph = mockGraph([
      mockCell({ id: 't1', stencilId: 'cell_text', text: 'QF-101', fontFamily: 'monospace' }),
      mockCell({ id: 't2', stencilId: 'cell_text', text: 'Секция', fontFamily: 'sans-serif' }),
    ])
    const exported = exportProject(graph)
    expect(exported.svgText).toContain('font-family="monospace"')
    const parsed = parseSvgProject(exported.svgText)
    expect(parsed.cells.find((c) => c.id === 't1').tms.shape.fontFamily).toBe('monospace')
    // Дефолт не пишется ни в meta подписи, ни в геометрию фигуры.
    expect(parsed.cells.find((c) => c.id === 't2').tms.shape.fontFamily).toBeUndefined()
  })

  it('cell_text: чужое семейство из архива не доезжает до SVG — только whitelist', () => {
    const graph = mockGraph([
      mockCell({ id: 't1', stencilId: 'cell_text', text: 'Секция', fontFamily: 'Comic Sans MS' }),
    ])
    const svg = exportProject(graph).svgText
    expect(svg).not.toContain('Comic Sans')
    expect(svg).toContain('font-family="sans-serif"')
  })

  it('cell_text: align=left (дефолт) в meta не пишется', () => {
    const graph = mockGraph([
      mockCell({ id: 't1', stencilId: 'cell_text', text: 'Секция', align: 'left' }),
    ])
    const parsed = parseSvgProject(exportProject(graph).svgText)
    // При дефолтном left поле align в meta отсутствует (json чище).
    expect(parsed.cells.find((c) => c.id === 't1').tms.align).toBeUndefined()
  })

  it('locked: «замок» ячейки переживает round-trip; отсутствие = не заблокирован', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_qw', locked: true }),
      mockCell({ id: 'c2', stencilId: 'cell_qw' }),
    ])
    const parsed = parseSvgProject(exportProject(graph).svgText)
    expect(parsed.cells.find((c) => c.id === 'c1').tms.locked).toBe(true)
    expect(parsed.cells.find((c) => c.id === 'c2').tms.locked).toBeUndefined()
  })

  it('groupId: метка группы переживает round-trip', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_qw', groupId: 'grp-abc' }),
      mockCell({ id: 'c2', stencilId: 'cell_qw', groupId: 'grp-abc' }),
      mockCell({ id: 'c3', stencilId: 'cell_qw' }),
    ])
    const parsed = parseSvgProject(exportProject(graph).svgText)
    expect(parsed.cells.find((c) => c.id === 'c1').tms.groupId).toBe('grp-abc')
    expect(parsed.cells.find((c) => c.id === 'c2').tms.groupId).toBe('grp-abc')
    expect(parsed.cells.find((c) => c.id === 'c3').tms.groupId).toBeUndefined()
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

  it('cell_qr с slot.onoff: .true (cases.false→hidden) и .false (cases.true→hidden)', () => {
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
    expect(anims).toHaveProperty('animation-cell_qr-c1.true')
    expect(anims).toHaveProperty('animation-cell_qr-c1.false')

    // .true: hidden при value=false
    const closedBinding = anims['animation-cell_qr-c1.true'].bindings.find(
      (b) => b.when?.source === 'value'
    )
    expect(closedBinding?.tag).toBe('TAG.ONOFF')
    expect(closedBinding?.when?.cases?.false?.apply?.addClass).toBe('animation-hidden')

    // .false: hidden при value=true
    const openBinding = anims['animation-cell_qr-c1.false'].bindings.find(
      (b) => b.when?.source === 'value'
    )
    expect(openBinding?.tag).toBe('TAG.ONOFF')
    expect(openBinding?.when?.cases?.true?.apply?.addClass).toBe('animation-hidden')

    // В SVG обе линии получили id, по которым их найдёт WebScada
    expect(exported.svgText).toContain('id="animation-cell_qr-c1.true"')
    expect(exported.svgText).toContain('id="animation-cell_qr-c1.false"')
  })

  it('quality: cell_qk получает bad-биндинг ТОЛЬКО на outer для каждого тега', () => {
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_qk',
        slots: { onoff: 'LOCAL.ONOFF' },
        boolSource: { groups: [['ОБЩИЙ.ONOFF']] },
        rangeSource: {
          tag: 'PS031.UA',
          ranges: [{ min: 0, max: 5, color: '#10b981' }],
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
    // Inner-карточки (.true / .false) quality НЕ должны иметь —
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
        rangeSource: {
          tag: 'PS031.UA',
          ranges: [{ min: 0, max: 5, color: '#10b981' }],
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

  it('cell_value: пробел в теге не даёт невалидный id, тег подписки сохраняется', () => {
    // id по стандарту без пробелов, а рантайм ищет text-узел через getElementById:
    // с пробелом карточка навсегда осталась бы с прочерком. В id пробел заменяем,
    // в binding.tag тег идёт как есть — подписка на реальный сигнал не меняется.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_value', valueTag: 'ПС 1.НАПРЯЖЕНИЕ A', w: 100, h: 18 }),
    ])
    const { svgText, animations, warnings } = exportProject(graph)
    const key = 'animation-ПС_1.НАПРЯЖЕНИЕ_A'
    // Ключ карточки и id узла в SVG совпадают — иначе рантайм не найдёт элемент.
    expect(animations.animations).toHaveProperty(key)
    expect(svgText).toContain(`id="${key}"`)
    expect(svgText).not.toContain('id="animation-ПС 1')
    expect(animations.animations[key].bindings[0].tag).toBe('ПС 1.НАПРЯЖЕНИЕ A')
    // Молча не «чиним»: чаще это опечатка в tag-list'е, и тогда данные не придут
    // по самой подписке.
    expect(warnings.some((w) => w.includes('ПС 1.НАПРЯЖЕНИЕ A'))).toBe(true)
    // Round-trip тега — по data-tms-meta, там он исходный.
    expect(parseSvgProject(svgText).cells.find((c) => c.id === 'c1').tms.valueTag).toBe(
      'ПС 1.НАПРЯЖЕНИЕ A'
    )
    warnSpy.mockRestore()
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
    // bindings (LOCAL.A и LOCAL.B, живут в стенсильной .true) + дубль id в SVG.
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
    // Биндинги НЕ слились в одну карточку (свой onoff у cell_qw — в .true)
    const firstTags = anims['animation-cell_qw-abc12345.true'].bindings.map((b) => b.tag)
    const secondTags = anims['animation-cell_qw-abc12345-2222.true'].bindings.map((b) => b.tag)
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

  it('порядок проводов (кто кого огибает) переживает round-trip', () => {
    const cells = [
      mockCell({ id: 'c1', stencilId: 'cell_qw', x: 0, y: 0, w: 20, h: 20 }),
      mockCell({ id: 'c2', stencilId: 'cell_qw', x: 100, y: 100, w: 20, h: 20 }),
    ]
    const ends = { source: { id: 'c1', port: 'right' }, target: { id: 'c2', port: 'left' } }
    const graph = mockGraph(cells, [
      mockLink({ id: 'l1', ...ends, z: LINK_Z }),
      mockLink({ id: 'l2', ...ends, z: LINK_Z + 2 }),
    ])
    const parsed = parseSvgProject(exportProject(graph).svgText)
    const byId = Object.fromEntries(parsed.cells.filter((c) => c.z != null).map((c) => [c.id, c.z]))
    // Дно полосы не пишем в meta (шум в каждой линии) — важен поднятый провод.
    expect(byId.l1).toBeUndefined()
    expect(byId.l2).toBe(LINK_Z + 2)
  })

  it('толщина провода: round-trip через stroke-width + meta', () => {
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
          tms: { strokeWidth: 4 },
        }),
      ]
    )
    const exported = exportProject(graph)
    expect(exported.svgText).toContain('stroke-width="4"')
    const link = parseSvgProject(exported.svgText).cells.find((c) => c.type === 'standard.Link')
    expect(link.attrs.line.strokeWidth).toBe(4)
    expect(link.tms.strokeWidth).toBe(4)
  })

  it('z-порядок ячейки: round-trip через meta.z', () => {
    const graph = mockGraph([mockCell({ id: 'c1', stencilId: 'cell_qw', z: 5 })])
    const exported = exportProject(graph)
    const cell = parseSvgProject(exported.svgText).cells.find((c) => c.type === 'tms.Stencil')
    expect(cell.z).toBe(5)
  })

  it('flip символа: round-trip через meta + transform в SVG', () => {
    const graph = mockGraph([
      mockCell({ id: 'c1', stencilId: 'cell_qw', x: 0, y: 0, w: 20, h: 20, flipH: true }),
    ])
    const exported = exportProject(graph)
    // Контент обёрнут во flip-группу (scale по X в пределах width).
    expect(exported.svgText).toContain('scale(-1 1)')
    const cell = parseSvgProject(exported.svgText).cells.find((c) => c.type === 'tms.Stencil')
    expect(cell.tms.flipH).toBe(true)
    expect(cell.tms.flipV).toBeUndefined()
  })

  it('цвет провода: round-trip через stroke + meta', () => {
    const graph = mockGraph(
      [
        mockCell({ id: 'c1', stencilId: 'cell_qw', x: 0, y: 0 }),
        mockCell({ id: 'c2', stencilId: 'cell_qw', x: 100, y: 0 }),
      ],
      [
        mockLink({
          id: 'l1',
          source: { id: 'c1', port: 'right' },
          target: { id: 'c2', port: 'left' },
          tms: { strokeColor: '#ff0000' },
        }),
      ]
    )
    const exported = exportProject(graph)
    expect(exported.svgText).toContain('stroke="#ff0000"')
    const link = parseSvgProject(exported.svgText).cells.find((c) => c.type === 'standard.Link')
    expect(link.attrs.line.stroke).toBe('#ff0000')
    expect(link.tms.strokeColor).toBe('#ff0000')
  })

  it('толщина по умолчанию (2) не пишется в meta, path stroke-width=2', () => {
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
        }),
      ]
    )
    const exported = exportProject(graph)
    expect(exported.svgText).toContain('stroke-width="2"')
    const link = parseSvgProject(exported.svgText).cells.find((c) => c.type === 'standard.Link')
    // Дефолт не переопределяет attrs (остаётся из LINK_DEFAULTS) и не пишет tms.
    expect(link.tms?.strokeWidth).toBeUndefined()
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
    // Пропущенный провод — не молча: попадает в warnings (доходит до пользователя).
    expect(result.warnings.some((w) => w.includes('L1'))).toBe(true)
    warn.mockRestore()
  })

  it('линк с ненайденным портом → центр ячейки + console.warn, линк экспортируется', () => {
    const a = mockCell({ id: 'a1', stencilId: 'cell_node', x: 0, y: 0, w: 20, h: 20 })
    const b = mockCell({ id: 'b1', stencilId: 'cell_node', x: 100, y: 0, w: 20, h: 20 })
    // port 'ghost' нет в items (у mockCell ports не заданы) → fallback в центр + warn.
    const link = mockLink({ id: 'L1', source: { id: 'a1', port: 'ghost' }, target: { id: 'b1' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = exportProject(mockGraph([a, b], [link]))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('порт "ghost"'))
    const parsed = parseSvgProject(result.svgText)
    expect(parsed.cells.filter((c) => c.type === 'standard.Link')).toHaveLength(1)
    // Тихий сдвиг в центр — тоже в warnings.
    expect(result.warnings.some((w) => w.includes('ghost'))).toBe(true)
    warn.mockRestore()
  })

  // Образец на КАЖДОЕ tms-поле ячейки, заведомо не дефолтный (иначе `keep` его
  // отсечёт). Ключа нет → тест падает: новое поле в CELL_META_FIELDS обязано
  // получить образец и проехать round-trip, иначе оно теряется молча (exporter
  // перечисляет поля в cellExports ВРУЧНУЮ — там и живёт риск забыть).
  const CELL_SAMPLES = {
    slots: { onoff: 'PS031VK001.ONOFF' },
    text: 'Подпись',
    fontSize: 18,
    bold: true,
    color: '#ff8800',
    fontFamily: 'monospace',
    align: 'right',
    valueTag: 'PS031.VALUE',
    valueLabel: 'Напряжение',
    valueUnit: 'кВ',
    decimals: 3,
    dotSize: 6,
    locked: true,
    flipH: true,
    flipV: true,
    groupId: 'grp-ab12cd34',
    busId: 'bus-1',
    rangeSource: { tag: 'PS031.U', ranges: [{ min: 0, max: 5, color: '#10b981' }] },
    boolSource: { groups: [['BR1.ONOFF']] },
    navigation: 'view_other',
  }

  it('инвариант: каждое поле CELL_META_FIELDS переживает экспорт → разбор', () => {
    expect(CELL_META_FIELDS.filter((f) => !(f.key in CELL_SAMPLES)).map((f) => f.key)).toEqual([])
    // Шина в графе обязательна: загрузчик снимает busId, если её в архиве нет.
    const graph = mockGraph([
      mockCell({ id: 'bus-1', stencilId: 'cell_bus', w: 80, h: 8 }),
      mockCell({ id: 'c1', stencilId: 'cell_qw', ...CELL_SAMPLES }),
    ])
    const cell = parseSvgProject(exportProject(graph).svgText).cells.find((c) => c.id === 'c1')
    for (const f of CELL_META_FIELDS) {
      // flag-поле пишется как `true`, значение не переносится.
      expect(cell.tms[f.key], `поле ${f.key} не доехало`).toEqual(
        f.flag ? true : CELL_SAMPLES[f.key]
      )
    }
  })

  const LINK_SAMPLES = {
    rangeSource: { tag: 'PS031.U', ranges: [{ min: 0, max: 5, color: '#10b981' }] },
    boolSource: { groups: [['BR1.ONOFF']] },
    strokeWidth: 4,
    strokeColor: '#ff0000',
  }

  it('инвариант: каждое поле LINK_META_FIELDS переживает экспорт → разбор', () => {
    expect(LINK_META_FIELDS.filter((f) => !(f.key in LINK_SAMPLES)).map((f) => f.key)).toEqual([])
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
          tms: { ...LINK_SAMPLES },
        }),
      ]
    )
    const link = parseSvgProject(exportProject(graph).svgText).cells.find(
      (c) => c.type === 'standard.Link'
    )
    for (const f of LINK_META_FIELDS) {
      expect(link.tms[f.key], `поле ${f.key} не доехало`).toEqual(LINK_SAMPLES[f.key])
    }
  })

  it('враждебные значения meta нормализуются на ЗАПИСИ (не только на чтении)', () => {
    // Мусор попадает в модель и из чужого архива, и через правку графа в IDB —
    // экспорт обязан отдать уже вычищенное, иначе рантайм получит `toFixed(500)`.
    const graph = mockGraph([
      mockCell({
        id: 'c1',
        stencilId: 'cell_value',
        valueTag: 'PS031.VALUE',
        decimals: 500,
        fontSize: 'huge',
        align: 'sideways',
      }),
    ])
    const cell = parseSvgProject(exportProject(graph).svgText).cells.find(
      (c) => c.type === 'tms.Stencil'
    )
    expect(cell.tms.decimals).toBe(20)
    expect(cell.tms.fontSize).toBeUndefined()
    expect(cell.tms.align).toBeUndefined()
  })
})

describe('exportProject: фигуры-разметка', () => {
  // Фигура — ячейка без стенсила: у неё нет карточек анимации и id, в SVG уезжает
  // статичная геометрия + data-tms-meta для round-trip'а.
  function shapeCell({ id, shape, x = 0, y = 0, w = 40, h = 20, z, angle = 0, ...extra }) {
    const tms = { shape, ...extra }
    return {
      id,
      get(key) {
        if (key === 'type') return 'tms.Shape'
        if (key === 'tms') return tms
        if (key === 'position') return { x, y }
        if (key === 'size') return { width: w, height: h }
        if (key === 'z') return z
        return undefined
      },
      angle: () => angle,
    }
  }

  it('фигура едет в view.svg геометрией и возвращается через round-trip', () => {
    const shape = {
      type: 'rect',
      x: 0,
      y: 0,
      w: 40,
      h: 20,
      stroke: '#ff8800',
      strokeWidth: 3,
    }
    const graph = mockGraph([shapeCell({ id: 's1', shape, x: 100, y: 60 })])
    const { svgText, animations } = exportProject(graph)

    expect(svgText).toContain('translate(100,60)')
    expect(svgText).toContain('stroke="#ff8800"')
    // Карточек у разметки нет — рантайм её не адресует.
    expect(animations.animations).toEqual({})
    expect(svgText).not.toContain('id="animation-')

    const parsed = parseSvgProject(svgText)
    expect(parsed.ok).toBe(true)
    const cell = parsed.cells.find((c) => c.id === 's1')
    expect(cell.type).toBe('tms.Shape')
    expect(cell.position).toEqual({ x: 100, y: 60 })
    expect(cell.size).toEqual({ width: 40, height: 20 })
    expect(cell.tms.shape).toMatchObject(shape)
  })

  it('заливка фигуры доезжает до SVG и переживает round-trip', () => {
    const shape = { type: 'rect', x: 0, y: 0, w: 40, h: 20, stroke: '#000', fill: '#ffcc00' }
    const parsed = parseSvgProject(
      exportProject(mockGraph([shapeCell({ id: 's1', shape })])).svgText
    )
    expect(parsed.cells.find((c) => c.id === 's1').tms.shape.fill).toBe('#ffcc00')
  })

  it('ломаная, поворот, замок и группа переживают round-trip', () => {
    const shape = {
      type: 'polyline',
      points: [
        [0, 0],
        [20, 10],
        [0, 20],
      ],
      closed: true,
      stroke: '#000',
      strokeWidth: 2,
    }
    const graph = mockGraph([
      shapeCell({
        id: 's2',
        shape,
        x: 10,
        y: 10,
        w: 20,
        h: 20,
        angle: 90,
        z: 7,
        locked: true,
        groupId: 'grp-1',
      }),
    ])
    const cell = parseSvgProject(exportProject(graph).svgText).cells.find((c) => c.id === 's2')
    expect(cell.tms.shape.points).toEqual(shape.points)
    expect(cell.tms.shape.closed).toBe(true)
    expect(cell.tms.locked).toBe(true)
    expect(cell.tms.groupId).toBe('grp-1')
    expect(cell.angle).toBe(90)
    expect(cell.z).toBe(7)
  })

  it('подложка (z ниже проводов) пишется ПЕРЕД линиями', () => {
    // Иначе залитая плашка, уведённая под провода в IDE, в view.svg снова окажется
    // поверх них — порядок в файле и есть порядок наложения.
    const shape = { type: 'rect', x: 0, y: 0, w: 40, h: 20, stroke: '#000', fill: '#eee' }
    const a = mockCell({ id: 'a', stencilId: 'cell_qw', w: 20, h: 20 })
    const b = mockCell({ id: 'b', stencilId: 'cell_qw', x: 100, w: 20, h: 20 })
    const graph = mockGraph(
      [a, b, shapeCell({ id: 's1', shape, z: -2000 })],
      [mockLink({ id: 'l1', source: { id: 'a' }, target: { id: 'b' }, z: -1000 })]
    )
    const svg = exportProject(graph).svgText
    // Ищем по заливке фигуры: в meta кавычки заэскейплены, искать по kind неудобно.
    const bgAt = svg.indexOf('#eee')
    const lineAt = svg.indexOf('<path id=')
    expect(bgAt).toBeGreaterThan(-1)
    expect(lineAt).toBeGreaterThan(-1)
    expect(bgAt).toBeLessThan(lineAt)
  })

  it('подложка переживает round-trip и не всплывает к нулю', () => {
    const shape = { type: 'rect', x: 0, y: 0, w: 40, h: 20, stroke: '#000', fill: '#eee' }
    const graph = mockGraph([shapeCell({ id: 's1', shape, z: -1950 })])
    const cell = parseSvgProject(exportProject(graph).svgText).cells[0]
    expect(cell.z).toBe(-1950)
  })

  it('фигуры и символы сохраняют порядок наложения (подложка остаётся снизу)', () => {
    // Порядок в SVG = порядок отрисовки. Если фигуры собирать отдельным списком,
    // подложка окажется поверх схемы.
    const back = shapeCell({
      id: 'bg',
      shape: { type: 'rect', x: 0, y: 0, w: 200, h: 100, stroke: '#000' },
      w: 200,
      h: 100,
    })
    const sym = mockCell({ id: 'c1', stencilId: 'cell_qw', x: 20, y: 20, w: 20, h: 20 })
    const { svgText } = exportProject(mockGraph([back, sym]))
    expect(svgText.indexOf('"kind":"shape"')).toBeLessThan(svgText.indexOf('animation-cell_qw'))
  })

  it('битая геометрия из чужого архива отбраковывается при чтении', () => {
    const attr = (o) => JSON.stringify(o).replace(/"/g, '&quot;')
    const bad = attr({ kind: 'shape', id: 's3', width: 40, height: 20, shape: { type: 'rect' } })
    const ok = attr({
      kind: 'shape',
      id: 's4',
      width: 10,
      height: 10,
      shape: { type: 'rect', x: 0, y: 0, w: 10, h: 10, strokeWidth: 'huge' },
    })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,0)" data-tms-meta='${bad}'/>
      <g transform="translate(0,0)" data-tms-meta='${ok}'/>
    </svg>`
    const out = parseSvgProject(svg)
    // Прямоугольник без размеров дал бы `width="NaN"` в выгрузке — такую фигуру не
    // создаём; нечисловая толщина откатывается к дефолту, фигура остаётся.
    expect(out.cells.map((c) => c.id)).toEqual(['s4'])
    expect(out.cells[0].tms.shape.strokeWidth).toBe(2)
    expect(out.errors.length).toBeGreaterThan(0)
  })
})
