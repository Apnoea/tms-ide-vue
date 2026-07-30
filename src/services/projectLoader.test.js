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

  it('подтягивает tms-поля cell_text (text, fontSize, bold, align)', () => {
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
    const out = parseSvgProject(svg)
    const cell = out.cells[0]
    expect(cell.tms.text).toBe('Hello')
    expect(cell.tms.fontSize).toBe(20)
    expect(cell.tms.bold).toBe(true)
    expect(cell.tms.align).toBe('center')
  })

  it('round-trip angle/navigation/switchSources/rangeSource на ячейке', () => {
    const meta = {
      id: 'c1',
      stencilId: 'cell_qw',
      width: 20,
      height: 20,
      angle: 90,
      navigation: 'view_other',
      locked: true,
      groupId: 'grp-xyz',
      switchSources: { groups: [['A.ONOFF'], ['B.ONOFF']] },
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
    expect(cell.tms.switchSources).toEqual({ groups: [['A.ONOFF'], ['B.ONOFF']] })
    expect(cell.tms.rangeSource).toEqual({
      tag: 'V.U',
      ranges: [{ min: 0, max: 5, class: 'animation-low' }],
    })
  })

  it('архив со старым ключом voltageSource читается в rangeSource (ячейка + провод)', () => {
    // Проекты, выгруженные до переименования: legacyKey в META_FIELDS — единственное
    // место, где старое имя ещё живёт (см. services/legacyFormat).
    const src = { tag: 'V.U', ranges: [{ min: 0, max: 5, class: 'animation-low' }] }
    const cell = { id: 'a', stencilId: 'cell_qw', width: 20, height: 20, voltageSource: src }
    const link = {
      id: 'link-old',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      voltageSource: src,
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,0)" data-tms-meta='${attr(cell)}'/>
      ${cellG('b')}
      <path data-tms-meta='${attr(link)}'/>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.cells[0].tms.rangeSource).toEqual(src)
    expect(out.cells[0].tms.voltageSource).toBeUndefined()
    const parsedLink = out.cells.find((c) => c.id === 'link-old')
    expect(parsedLink.tms.rangeSource).toEqual(src)
  })

  it('round-trip vertices/switchSources на проводе', () => {
    const verts = [
      { x: 20, y: 0 },
      { x: 20, y: 40 },
    ]
    const meta = {
      id: 'link-1',
      source: { id: 'a', port: 'right' },
      target: { id: 'b', port: 'left' },
      vertices: verts,
      switchSources: { groups: [['S.ONOFF']] },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      ${cellG('a')}${cellG('b')}
      <path d="M 0,0 L 10,10" data-tms-meta='${attr(meta)}'/>
    </svg>`
    const link = parseSvgProject(svg).cells.find((c) => c.type === 'standard.Link')
    expect(link.vertices).toEqual(verts)
    expect(link.tms.switchSources).toEqual({ groups: [['S.ONOFF']] })
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

  it('отбрасывает провод с несуществующим endpoint (иначе fromJSON падает на уже сохранённой форме)', () => {
    // Ячейка 'b' пропущена (незарегистрированный стенсил) → провод a→b висячий.
    const badCell = attr({ id: 'b', stencilId: 'cell_nonexistent', width: 10, height: 10 })
    const link = attr({ id: 'l1', source: { id: 'a' }, target: { id: 'b' } })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      ${cellG('a')}
      <g transform="translate(0,0)" data-tms-meta='${badCell}'/>
      <path d="M 0,0 L 10,10" data-tms-meta='${link}'/>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.cells.filter((c) => c.type === 'standard.Link')).toEqual([]) // висячий отброшен
    expect(out.cells.filter((c) => c.type === 'tms.Stencil').map((c) => c.id)).toEqual(['a'])
    expect(out.errors.some((e) => /отсутствующий символ/.test(e))).toBe(true)
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
