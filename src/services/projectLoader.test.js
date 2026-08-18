import { describe, it, expect } from 'vitest'
import { parseSvgProject } from './projectLoader'

// parseSvgProject — единственная экспортируемая функция модуля. Принимает
// svg-текст с data-tms-meta атрибутами и возвращает структуру JointJS-cells
// (включая links) пригодную для graph.fromJSON.

const attr = (o) => JSON.stringify(o).replace(/"/g, '&quot;')
// <g>-ячейка с зарегистрированным стенсилом (endpoint для провода в тестах).
const cellG = (id) =>
  `<g transform="translate(0,0)" data-tms-meta='${attr({ id, stencilId: 'cell_qw', width: 20, height: 20 })}'/>`

describe('parseSvgProject', () => {
  it('возвращает ok=false на пустом вводе', () => {
    expect(parseSvgProject('').ok).toBe(false)
    expect(parseSvgProject('   ').ok).toBe(false)
    expect(parseSvgProject(null).ok).toBe(false)
  })

  it('валидный SVG без tms-элементов → ok=true, cells пустой (пустая форма ≠ битая)', () => {
    // Пустая схема — заготовка / цель навигации; импорт обязан её сохранить,
    // иначе ссылки tms.navigation на эту форму ломаются.
    const out = parseSvgProject('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')
    expect(out.ok).toBe(true)
    expect(out.cells).toEqual([])
  })

  it('парсит cell_qw с минимальной meta (slot-based)', () => {
    const meta = {
      id: 'cell-abc',
      stencilId: 'cell_qw',
      width: 20,
      height: 20,
      slots: { onoff: 'PS031VK001.ONOFF' },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(50, 100)" data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'>
        <rect/>
      </g>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.ok).toBe(true)
    expect(out.cells).toHaveLength(1)
    const cell = out.cells[0]
    expect(cell.type).toBe('tms.Stencil')
    expect(cell.id).toBe('cell-abc')
    expect(cell.position).toEqual({ x: 50, y: 100 })
    expect(cell.size).toEqual({ width: 20, height: 20 })
    expect(cell.tms.stencilId).toBe('cell_qw')
    expect(cell.tms.slots).toEqual({ onoff: 'PS031VK001.ONOFF' })
  })

  it('cell_text превращается в фигуру-подпись (прошлый формат)', () => {
    const meta = {
      id: 'c1',
      stencilId: 'cell_text',
      width: 60,
      height: 20,
      text: 'Hello',
      fontSize: 20,
      bold: true,
      align: 'center',
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,0)" data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const cell = parseSvgProject(svg).cells[0]
    expect(cell.type).toBe('tms.Shape')
    expect(cell.tms.shape).toMatchObject({
      type: 'text',
      text: 'Hello',
      fontSize: 20,
      bold: true,
      align: 'center',
    })
  })

  it('round-trip angle/navigation/boolSource/rangeSource на ячейке', () => {
    const meta = {
      id: 'c1',
      stencilId: 'cell_qw',
      width: 20,
      height: 20,
      angle: 90,
      navigation: 'view_other',
      locked: true,
      groupId: 'grp-xyz',
      boolSource: { groups: [['A.ONOFF'], ['B.ONOFF']] },
      rangeSource: { tag: 'V.U', ranges: [{ min: 0, max: 5, class: 'animation-low' }] },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,0)" data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const cell = parseSvgProject(svg).cells[0]
    expect(cell.angle).toBe(90)
    expect(cell.tms.navigation).toBe('view_other')
    expect(cell.tms.locked).toBe(true)
    expect(cell.tms.groupId).toBe('grp-xyz')
    expect(cell.tms.boolSource).toEqual({ groups: [['A.ONOFF'], ['B.ONOFF']] })
    // Строка приходит с прежним class-именем палитры и читается как цвет: в модели
    // остаётся одно поле, класс перекраса генерируется из него при экспорте.
    expect(cell.tms.rangeSource).toEqual({
      tag: 'V.U',
      ranges: [{ min: 0, max: 5, color: '#10b981' }],
    })
  })

  it('round-trip vertices/boolSource на проводе', () => {
    const verts = [
      { x: 20, y: 0 },
      { x: 20, y: 40 },
    ]
    const meta = {
      id: 'link-1',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      vertices: verts,
      boolSource: { groups: [['S.ONOFF']] },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      ${cellG('a')}${cellG('b')}
      <path d="M 0,0 L 10,10" data-tms-meta='${attr(meta)}'/>
    </svg>`
    const link = parseSvgProject(svg).cells.find((c) => c.type === 'standard.Link')
    expect(link.vertices).toEqual(verts)
    expect(link.tms.boolSource).toEqual({ groups: [['S.ONOFF']] })
  })

  it('парсит провод <path> с source/target', () => {
    const meta = {
      id: 'link-1',
      source: { id: 'cell-a', port: 'top' },
      target: { id: 'cell-b', port: 'bottom' },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      ${cellG('cell-a')}${cellG('cell-b')}
      <path d="M 0,0 L 10,10" data-tms-meta='${attr(meta)}'/>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.ok).toBe(true)
    const link = out.cells.find((c) => c.type === 'standard.Link')
    expect(link.type).toBe('standard.Link')
    expect(link.source).toEqual({ id: 'cell-a', port: 'top' })
    expect(link.target).toEqual({ id: 'cell-b', port: 'bottom' })
  })

  it('конец на несобранной ячейке становится точкой из геометрии (провод не теряем)', () => {
    // Ячейка 'b' пропущена (незарегистрированный стенсил) → конец провода привязать
    // некуда. Раньше линию выбрасывали целиком: ссылка на отсутствующую ячейку валит
    // fromJSON. Теперь конец превращается в свободную точку из `d` — схема сохраняет
    // линию, а автор видит предупреждение и перецепит её сам.
    const badCell = attr({ id: 'b', stencilId: 'cell_nonexistent', width: 10, height: 10 })
    const link = attr({ id: 'l1', source: { id: 'a' }, target: { id: 'b' } })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      ${cellG('a')}
      <g transform="translate(0,0)" data-tms-meta='${badCell}'/>
      <path d="M 0,0 L 10,10" data-tms-meta='${link}'/>
    </svg>`
    const out = parseSvgProject(svg)
    const links = out.cells.filter((c) => c.type === 'standard.Link')
    expect(links).toHaveLength(1)
    expect(links[0].source).toEqual({ id: 'a' })
    expect(links[0].target).toEqual({ x: 10, y: 10 })
    expect(out.cells.filter((c) => c.type === 'tms.Stencil').map((c) => c.id)).toEqual(['a'])
    expect(out.errors.some((e) => /восстановлен по геометрии/.test(e))).toBe(true)
  })

  it('свободный конец (провод отцепили от порта) переживает round-trip как точка', () => {
    // Именно этот случай терялся: exporter писал `{ id: undefined }`, и импорт
    // выбрасывал провод как «без source/target» — связь исчезала молча.
    const link = attr({ id: 'l1', source: { id: 'a' }, target: { x: 140, y: 110 } })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      ${cellG('a')}
      <path d="M 0,0 L 140,110" data-tms-meta='${link}'/>
    </svg>`
    const out = parseSvgProject(svg)
    const links = out.cells.filter((c) => c.type === 'standard.Link')
    expect(links).toHaveLength(1)
    expect(links[0].target).toEqual({ x: 140, y: 110 })
    // Точка — штатная привязка, предупреждать не о чем.
    expect(out.errors).toEqual([])
  })

  it('потерянная привязка возвращается, если конец стоит ровно на порту символа', () => {
    // Так лечится след регрессии: имени порта в архиве нет, но геометрия цела и
    // конец линии совпадает с позицией слота — это восстановление, а не угадывание,
    // поэтому и предупреждать не о чем.
    const bus = attr({ id: 'bus', stencilId: 'cell_bus', width: 200, height: 8 })
    const link = attr({ id: 'l1', source: {}, target: { id: 'a', port: 'top' } })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,100)" data-tms-meta='${bus}'/>
      ${cellG('a')}
      <path d="M 20,104 L 20,200" data-tms-meta='${link}'/>
    </svg>`
    const out = parseSvgProject(svg)
    const link1 = out.cells.find((c) => c.type === 'standard.Link')
    // Слот шины p_0 стоит на (20,104) — середина толщины 8 — туда и привязываемся.
    expect(link1.source).toEqual({ id: 'bus', port: 'p_0' })
    expect(out.errors).toEqual([])
  })

  it('закрепление на шине переживает импорт, ссылка в пустоту снимается', () => {
    // busId ведёт «символ едет за шиной» (см. useBusSnap). Шина могла в архив не
    // попасть — тогда закрепление держало бы символ за несуществующей ячейкой.
    const bus = attr({ id: 'bus', stencilId: 'cell_bus', width: 80, height: 8 })
    const onBus = attr({ id: 'a', stencilId: 'cell_qw', width: 20, height: 20, busId: 'bus' })
    const orphan = attr({ id: 'b', stencilId: 'cell_qw', width: 20, height: 20, busId: 'ghost' })
    const out = parseSvgProject(`<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,100)" data-tms-meta='${bus}'/>
      <g transform="translate(0,100)" data-tms-meta='${onBus}'/>
      <g transform="translate(0,300)" data-tms-meta='${orphan}'/>
    </svg>`)
    expect(out.cells.find((c) => c.id === 'a').tms.busId).toBe('bus')
    expect(out.cells.find((c) => c.id === 'b').tms.busId).toBeUndefined()
    expect(out.errors.some((e) => e.includes('ghost'))).toBe(true)
  })

  it('без geometry и без привязки провод отбрасывается', () => {
    const link = attr({ id: 'l1', source: {}, target: {} })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-tms-meta='${link}'/>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.cells.filter((c) => c.type === 'standard.Link')).toEqual([])
    expect(out.errors.length).toBeGreaterThan(0)
  })

  it('пропускает ячейку с неизвестным стенсилом, накапливает warning', () => {
    const meta = {
      id: 'c1',
      stencilId: 'cell_nonexistent',
      width: 10,
      height: 10,
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,0)" data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.cells).toEqual([])
    expect(out.errors.length).toBeGreaterThan(0)
    expect(out.errors[0]).toMatch(/cell_nonexistent/)
    // stencilId выкинутой ячейки всё равно попадает в stencilIds — иначе импорт
    // не смог бы предупредить о недостающем стенсиле.
    expect(out.stencilIds).toContain('cell_nonexistent')
  })

  it('пропускает провод без source/target — пишет в errors', () => {
    const meta = { id: 'link-x' } // нет source/target
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.cells.filter((c) => c.type === 'standard.Link')).toEqual([])
    expect(out.errors.length).toBeGreaterThan(0)
  })

  it('чистит числовые/перечислимые поля чужой meta', () => {
    // Архив приходит извне: `decimals: 500` валит `toFixed` в рантайме,
    // нечисловой fontSize ломает замер габарита, неизвестный align — якорь роста.
    const meta = {
      id: 'c1',
      stencilId: 'cell_value',
      width: 60,
      height: 20,
      valueTag: 'PS031.VALUE',
      decimals: 500,
      fontSize: 'huge',
      align: 'sideways',
      fontFamily: 'Comic Sans MS',
      rangeSource: { tag: 'PS031.U', ranges: [{ min: 'x', max: '5', class: 'animation-low' }] },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,0)" data-tms-meta='${attr(meta)}'/>
    </svg>`
    const { tms } = parseSvgProject(svg).cells[0]
    expect(tms.decimals).toBe(20)
    expect(tms.fontSize).toBeUndefined()
    expect(tms.align).toBeUndefined()
    // Шрифт вне whitelist'а откатывается к дефолту, а не выбрасывается: панель
    // WebScada всё равно нарисует им, и замер обязан совпасть с рендером.
    expect(tms.fontFamily).toBe('sans-serif')
    // Нечисловая граница = «порога нет», числовая строка приводится к числу.
    expect(tms.rangeSource.ranges[0]).toEqual({ min: undefined, max: 5, color: '#10b981' })
  })

  it('чистит angle/z ячейки (поля верхнего уровня JointJS)', () => {
    const cellWith = (extra) => {
      const meta = { id: 'c1', stencilId: 'cell_qw', width: 20, height: 20, ...extra }
      return parseSvgProject(
        `<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(0,0)" data-tms-meta='${attr(meta)}'/></svg>`
      ).cells[0]
    }
    // Нечисловой z ломает сортировку коллекции JointJS, отрицательный утащил бы
    // символ под провода (у них своя полоса).
    expect(cellWith({ z: 'abc' }).z).toBeUndefined()
    expect(cellWith({ z: -5 }).z).toBe(0)
    // Угол приводим к 0..359: 725 = 5, 360 = «не повёрнут» (поле не пишем).
    expect(cellWith({ angle: 725 }).angle).toBe(5)
    expect(cellWith({ angle: -90 }).angle).toBe(270)
    expect(cellWith({ angle: 360 }).angle).toBeUndefined()
    expect(cellWith({ angle: 'boom' }).angle).toBeUndefined()
  })

  it('пропускает ячейку без transform — пишет в errors', () => {
    const meta = {
      id: 'c1',
      stencilId: 'cell_qw',
      width: 20,
      height: 20,
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.cells).toEqual([])
    expect(out.errors.length).toBeGreaterThan(0)
  })
})
