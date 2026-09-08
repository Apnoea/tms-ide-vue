// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseTagList, isBooleanType, isNumericType } from './parsers'

describe('parseTagList', () => {
  it('parses standard name=Type;... lines', () => {
    const text = 'PS031VK001.ONOFF=Boolean;\nPS031TN001.UA=Float;'
    expect(parseTagList(text)).toEqual([
      { name: 'PS031VK001.ONOFF', type: 'Boolean' },
      { name: 'PS031TN001.UA', type: 'Float' },
    ])
  })

  it('skips comment lines starting with #', () => {
    const text = `#Format <Tag name>=<Tag type>
#
PS031VK001.ONOFF=Boolean`
    expect(parseTagList(text)).toEqual([{ name: 'PS031VK001.ONOFF', type: 'Boolean' }])
  })

  it('skips empty/whitespace-only lines', () => {
    const text = '\n\n   \nPS031.X=Boolean\n\n'
    expect(parseTagList(text)).toEqual([{ name: 'PS031.X', type: 'Boolean' }])
  })

  it('skips lines without =', () => {
    expect(parseTagList('garbage\nPS031.X=Float')).toEqual([{ name: 'PS031.X', type: 'Float' }])
  })

  it('returns empty array for empty input', () => {
    expect(parseTagList('')).toEqual([])
  })
})

// XML-дерево SCADA: объекты вкладываются произвольно, теги лежат в объектах. Тег
// адресуется полным `name`, путь объектов и `paramName` идут рядом — для группировки.
describe('parseTagList: XML-дерево объектов', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Root>
    <Object name="S17" description="S17">
        <Object name="N70155" description="S17 N70155">
            <Tag name="S17N70155Tag1" paramName="Tag1" description="S17 N70155 Tag1" type="Boolean" origin="in"/>
        </Object>
        <Object name="N70160">
            <Tag name="S17N70160Tag2" paramName="Tag2" type="ByteArray" origin="in"/>
            <Object name="P120">
                <Tag name="P120Tag1" paramName="Tag1" type="Boolean" origin="in"/>
            </Object>
        </Object>
    </Object>
</Root>`

  it('собирает теги с любой глубины, путь — имена объектов', () => {
    expect(parseTagList(xml)).toEqual([
      {
        name: 'S17N70155Tag1',
        type: 'Boolean',
        description: 'S17 N70155 Tag1',
        param: 'Tag1',
        origin: 'in',
        path: ['S17', 'N70155'],
      },
      {
        name: 'S17N70160Tag2',
        type: 'ByteArray',
        param: 'Tag2',
        origin: 'in',
        path: ['S17', 'N70160'],
      },
      {
        name: 'P120Tag1',
        type: 'Boolean',
        param: 'Tag1',
        origin: 'in',
        path: ['S17', 'N70160', 'P120'],
      },
    ])
  })

  it('тег без имени и повтор имени отбрасываются', () => {
    // Повтор — два сигнала под одним адресом: привязка стала бы неоднозначной.
    const dup = `<Root>
      <Tag name="A" type="Boolean"/>
      <Tag type="Boolean"/>
      <Object name="O"><Tag name="A" type="Float"/></Object>
    </Root>`
    expect(parseTagList(dup)).toEqual([{ name: 'A', type: 'Boolean' }])
  })

  it('объект без имени структуру не задаёт, но теги отдаёт', () => {
    const anon = `<Root><Object><Tag name="A" type="Boolean"/></Object></Root>`
    expect(parseTagList(anon)).toEqual([{ name: 'A', type: 'Boolean' }])
  })

  it('битый XML — пустой список (вызывающий скажет «нет валидных тегов»)', () => {
    expect(parseTagList('<Root><Object name="a"</Root>')).toEqual([])
  })
})

// Фильтры пикеров: булев слот берёт булевы, диапазоны — числовые. Перечень типов у
// каждой SCADA свой, поэтому «числовой» — это «не из списка нечисловых».
describe('isBooleanType / isNumericType', () => {
  it('булевы узнаются по началу названия', () => {
    for (const t of ['Boolean', 'bool', 'BOOL']) expect(isBooleanType(t)).toBe(true)
    for (const t of ['Float', 'Int32', '', undefined]) expect(isBooleanType(t)).toBe(false)
  })

  it('числовыми считаются все, кроме булевых, текстовых, бинарных и дат', () => {
    for (const t of ['Float', 'Double', 'Int16', 'UInt32', 'Word', 'Byte', 'Real', 'Decimal'])
      expect(isNumericType(t)).toBe(true)
    for (const t of ['Boolean', 'String', 'Text', 'Char', 'ByteArray', 'Blob', 'DateTime', 'Time'])
      expect(isNumericType(t)).toBe(false)
  })

  it('незнакомый и пустой тип остаются доступны: спрятать нужный тег хуже', () => {
    expect(isNumericType('Whatever')).toBe(true)
    expect(isNumericType('')).toBe(true)
    expect(isNumericType(undefined)).toBe(true)
  })
})
