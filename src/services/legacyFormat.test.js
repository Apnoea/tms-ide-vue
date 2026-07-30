// Чтение старого формата: проект/символ, сохранённые до переименования
// «voltage» → «диапазоны», должны открываться без потерь и переезжать на новые
// имена. Регрессия дорогая: молча теряются привязки диапазонов всей схемы.
import { describe, it, expect } from 'vitest'
import { migrateTms, migrateGraphJson, migrateStencilSvg } from './legacyFormat'

const SRC = { tag: 'PS.UA', ranges: [{ min: 0, max: 5, class: 'animation-low' }] }

describe('migrateTms', () => {
  it('переносит старый ключ в rangeSource и убирает legacy-поле', () => {
    const out = migrateTms({ stencilId: 'cell_bus', voltageSource: SRC })
    expect(out).toEqual({ stencilId: 'cell_bus', rangeSource: SRC })
    expect('voltageSource' in out).toBe(false)
  })

  it('без старого ключа не трогает объект (null = копия не нужна)', () => {
    expect(migrateTms({ stencilId: 'cell_qw', rangeSource: SRC })).toBeNull()
    expect(migrateTms({})).toBeNull()
    expect(migrateTms(null)).toBeNull()
  })

  it('оба ключа: новый приоритетнее, старый отбрасывается', () => {
    const out = migrateTms({ rangeSource: SRC, voltageSource: { tag: 'OLD', ranges: [] } })
    expect(out).toEqual({ rangeSource: SRC })
  })
})

describe('migrateGraphJson', () => {
  it('мигрирует ячейки и провода формы, отдаёт changed', () => {
    const { json, changed } = migrateGraphJson({
      cells: [
        { id: 'a', tms: { stencilId: 'cell_bus', voltageSource: SRC } },
        { id: 'l', type: 'standard.Link', tms: { voltageSource: SRC } },
      ],
    })
    expect(changed).toBe(true)
    expect(json.cells[0].tms).toEqual({ stencilId: 'cell_bus', rangeSource: SRC })
    expect(json.cells[1].tms).toEqual({ rangeSource: SRC })
  })

  it('нечего мигрировать → тот же объект и changed=false (в IDB не пишем)', () => {
    const src = { cells: [{ id: 'a', tms: { stencilId: 'cell_qw' } }] }
    const { json, changed } = migrateGraphJson(src)
    expect(changed).toBe(false)
    expect(json).toBe(src)
  })

  it('битый json не роняет миграцию', () => {
    expect(migrateGraphJson(null).changed).toBe(false)
    expect(migrateGraphJson({}).changed).toBe(false)
  })
})

describe('migrateStencilSvg', () => {
  it('заменяет все вхождения старого класса заливки', () => {
    const { svg, changed } = migrateStencilSvg(
      '<svg><rect class="tms-voltage-fill"/><circle class="tms-voltage-fill"/></svg>'
    )
    expect(changed).toBe(true)
    expect(svg).toBe('<svg><rect class="tms-range-fill"/><circle class="tms-range-fill"/></svg>')
  })

  it('без старого класса возвращает строку как есть', () => {
    const src = '<svg><rect class="tms-range-fill"/></svg>'
    expect(migrateStencilSvg(src)).toEqual({ svg: src, changed: false })
    expect(migrateStencilSvg(undefined).changed).toBe(false)
  })
})
