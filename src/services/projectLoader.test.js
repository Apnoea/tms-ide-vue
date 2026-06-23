import { describe, it, expect } from 'vitest'
import { parseSvgProject } from './projectLoader'

// parseSvgProject — единственная экспортируемая функция модуля. Принимает
// svg-текст с data-tms-meta атрибутами и возвращает структуру JointJS-cells
// (включая links) пригодную для graph.fromJSON.

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

  it('подтягивает tms-поля cell_text (text, fontSize, bold)', () => {
    const meta = {
      id: 'c1',
      stencilId: 'cell_text',
      width: 60,
      height: 20,
      text: 'Hello',
      fontSize: 20,
      bold: true,
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,0)" data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const out = parseSvgProject(svg)
    const cell = out.cells[0]
    expect(cell.tms.text).toBe('Hello')
    expect(cell.tms.fontSize).toBe(20)
    expect(cell.tms.bold).toBe(true)
  })

  it('round-trip angle/navigation/switchSources/voltageSource на ячейке', () => {
    const meta = {
      id: 'c1',
      stencilId: 'cell_qw',
      width: 20,
      height: 20,
      angle: 90,
      navigation: 'view_other',
      switchSources: { or: ['A.ONOFF'], and: ['B.ONOFF'] },
      voltageSource: { tag: 'V.U', ranges: [{ min: 0, max: 5, class: 'animation-low' }] },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,0)" data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const cell = parseSvgProject(svg).cells[0]
    expect(cell.angle).toBe(90)
    expect(cell.tms.navigation).toBe('view_other')
    expect(cell.tms.switchSources).toEqual({ or: ['A.ONOFF'], and: ['B.ONOFF'] })
    expect(cell.tms.voltageSource).toEqual({
      tag: 'V.U',
      ranges: [{ min: 0, max: 5, class: 'animation-low' }],
    })
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
      switchSources: { or: [], and: ['S.ONOFF'] },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path d="M 0,0 L 10,10" data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const link = parseSvgProject(svg).cells[0]
    expect(link.vertices).toEqual(verts)
    expect(link.tms.switchSources).toEqual({ or: [], and: ['S.ONOFF'] })
  })

  it('парсит провод <path> с source/target', () => {
    const meta = {
      id: 'link-1',
      source: { id: 'cell-a', port: 'top' },
      target: { id: 'cell-b', port: 'bottom' },
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path d="M 0,0 L 10,10" data-tms-meta='${JSON.stringify(meta).replace(/"/g, '&quot;')}'/>
    </svg>`
    const out = parseSvgProject(svg)
    expect(out.ok).toBe(true)
    const link = out.cells[0]
    expect(link.type).toBe('standard.Link')
    expect(link.source).toEqual({ id: 'cell-a', port: 'top' })
    expect(link.target).toEqual({ id: 'cell-b', port: 'bottom' })
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
