import { describe, it, expect } from 'vitest'
import { textCellToShape, migrateGraphJson, legacyBusPortId } from './legacyFormat'
import { TEXT_PADDING_X } from '../stencils/textCell'

// Подпись из прошлого формата (символ cell_text) должна стать фигурой-разметкой,
// не потеряв ни вида, ни места, ни свойств ячейки.

function textCell(tms = {}, rest = {}) {
  return {
    type: 'tms.Stencil',
    id: 't1',
    position: { x: 100, y: 50 },
    size: { width: 60, height: 20 },
    tms: { stencilId: 'cell_text', text: 'Секция', ...tms },
    ...rest,
  }
}

describe('textCellToShape', () => {
  it('чужие ячейки не трогает', () => {
    expect(textCellToShape({ tms: { stencilId: 'cell_qw' } })).toBeNull()
    expect(textCellToShape({ tms: { shape: { type: 'text' } } })).toBeNull()
    expect(textCellToShape(null)).toBeNull()
  })

  it('вид подписи переезжает в геометрию фигуры', () => {
    const out = textCellToShape(
      textCell({ text: 'QF-101', fontSize: 20, bold: true, color: '#ff0000', fontFamily: 'serif' })
    )
    expect(out.type).toBe('tms.Shape')
    expect(out.id).toBe('t1')
    expect(out.tms.shape).toMatchObject({
      type: 'text',
      text: 'QF-101',
      fontSize: 20,
      bold: true,
      stroke: '#ff0000',
      fontFamily: 'serif',
      align: 'left',
    })
  })

  it('подпись остаётся на своём месте: baseline ниже центра ячейки', () => {
    // Ячейка 50..70 по вертикали, у cell_text текст центрирован по ней; у фигуры
    // точка привязки — baseline, поэтому она ниже центра (~0.3em).
    const out = textCellToShape(textCell({ fontSize: 14 }))
    expect(out.position.y + out.tms.shape.y).toBeCloseTo(50 + 10 + 14 * 0.3, 5)
    // Левый край + отступ — там же, где текст рисовался у символа.
    expect(out.position.x + out.tms.shape.x).toBeCloseTo(100 + TEXT_PADDING_X, 5)
  })

  it('якорь роста сохраняется даже без замера ширины', () => {
    // Замер идёт через canvas, в jsdom он недоступен — align обязан доехать всё равно,
    // иначе подпись после первой правки поехала бы в другую сторону.
    for (const align of ['left', 'center', 'right']) {
      expect(textCellToShape(textCell({ align })).tms.shape.align).toBe(align)
    }
    // Мусорный якорь — как у cell_text, дефолт.
    expect(textCellToShape(textCell({ align: 'justify' })).tms.shape.align).toBe('left')
  })

  it('свойства ячейки (замок, группа, угол, слой) переносятся', () => {
    const out = textCellToShape(textCell({ locked: true, groupId: 'grp-1' }, { angle: 90, z: 7 }))
    expect(out.tms).toMatchObject({ locked: true, groupId: 'grp-1' })
    expect(out.angle).toBe(90)
    expect(out.z).toBe(7)
    // Символьных полей у фигуры нет — иначе она осталась бы наполовину стенсилом.
    expect(out.tms.stencilId).toBeUndefined()
  })

  it('дефолты не пишутся: ни семейства шрифта, ни жирности', () => {
    const shape = textCellToShape(textCell()).tms.shape
    expect(shape.fontFamily).toBeUndefined()
    expect(shape.bold).toBeUndefined()
  })
})

describe('migrateGraphJson', () => {
  it('переписывает только подписи и сообщает об этом флагом', () => {
    const json = {
      cells: [
        textCell(),
        { type: 'tms.Stencil', id: 'c1', tms: { stencilId: 'cell_qw' } },
        { type: 'standard.Link', id: 'l1' },
      ],
    }
    const { json: next, changed } = migrateGraphJson(json)
    expect(changed).toBe(true)
    expect(next.cells[0].type).toBe('tms.Shape')
    expect(next.cells[1]).toBe(json.cells[1])
    expect(next.cells[2]).toBe(json.cells[2])
  })

  it('идемпотентна: второй проход ничего не меняет и не просит перезаписи', () => {
    const first = migrateGraphJson({ cells: [textCell()] })
    const second = migrateGraphJson(first.json)
    expect(second.changed).toBe(false)
    // changed:false отдаёт тот же объект — вызывающий по нему решает, писать ли в IDB.
    expect(second.json).toBe(first.json)
  })

  it('форма без подписей и мусор на входе возвращаются как есть', () => {
    const json = { cells: [{ type: 'standard.Link', id: 'l1' }] }
    expect(migrateGraphJson(json)).toEqual({ json, changed: false })
    expect(migrateGraphJson(null)).toEqual({ json: null, changed: false })
    expect(migrateGraphJson({})).toEqual({ json: {}, changed: false })
  })
})

describe('порты шины: два ряда → один', () => {
  const busJson = (ports) => ({
    type: 'tms.Stencil',
    id: 'bus',
    position: { x: 0, y: 0 },
    size: { width: 80, height: 20 },
    tms: { stencilId: 'cell_bus' },
    ports: { items: ports },
  })
  const legacyPorts = [
    { id: 'top_0', group: 'port', args: { x: 20, y: 0 } },
    { id: 'bot_0', group: 'port', args: { x: 20, y: 20 } },
  ]

  it('legacyBusPortId переводит оба ряда в один слот', () => {
    expect(legacyBusPortId('top_3')).toBe('p_3')
    expect(legacyBusPortId('bot_3')).toBe('p_3')
    // Не та схема — трогать нельзя: у символа из редактора порт зовётся как угодно.
    expect(legacyBusPortId('p_3')).toBeNull()
    expect(legacyBusPortId('top')).toBeNull()
    expect(legacyBusPortId(undefined)).toBeNull()
  })

  it('порты шины пересобираются: fromJSON берёт их из json как есть', () => {
    const { json: next, changed } = migrateGraphJson({ cells: [busJson(legacyPorts)] })
    expect(changed).toBe(true)
    // 80/20-1 = 3 слота, все в середине толщины 20.
    expect(next.cells[0].ports.items.map((p) => p.id)).toEqual(['p_0', 'p_1', 'p_2'])
    expect(next.cells[0].ports.items[0].args).toEqual({ x: 20, y: 10 })
  })

  it('порт-рефы линков переводятся — но только у шин', () => {
    const { json: next } = migrateGraphJson({
      cells: [
        { type: 'standard.Link', id: 'l1', source: { id: 'bus', port: 'bot_1' }, target: {} },
        { type: 'standard.Link', id: 'l2', source: { id: 'sym', port: 'top_1' }, target: {} },
        busJson(legacyPorts),
        { type: 'tms.Stencil', id: 'sym', tms: { stencilId: 'cell_qw' } },
      ],
    })
    // Линк идёт в списке ДО своей шины — id шин собираются отдельным проходом.
    expect(next.cells[0].source).toEqual({ id: 'bus', port: 'p_1' })
    // Символ из редактора с портом «top_1» — не наша схема, оставляем как есть.
    expect(next.cells[1].source).toEqual({ id: 'sym', port: 'top_1' })
  })

  it('оба ряда одного слота сливаются в один порт', () => {
    const { json: next } = migrateGraphJson({
      cells: [
        busJson(legacyPorts),
        { type: 'standard.Link', id: 'l1', source: { id: 'bus', port: 'top_0' }, target: {} },
        { type: 'standard.Link', id: 'l2', source: { id: 'bus', port: 'bot_0' }, target: {} },
      ],
    })
    expect(next.cells[1].source.port).toBe('p_0')
    expect(next.cells[2].source.port).toBe('p_0')
  })

  it('идемпотентна: новая схема второй раз не мигрирует', () => {
    const first = migrateGraphJson({
      cells: [
        busJson(legacyPorts),
        { type: 'standard.Link', id: 'l1', source: { id: 'bus', port: 'bot_2' }, target: {} },
      ],
    })
    const second = migrateGraphJson(first.json)
    expect(second.changed).toBe(false)
    expect(second.json).toBe(first.json)
  })
})
