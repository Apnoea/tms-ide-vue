import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('./useCanvas', () => ({
  useCanvas: () => ({ graphRef: ref(null), paperRef: ref(null), selection: ref([]) }),
}))
vi.mock('./useNotify', () => ({
  useNotify: () => ({ success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  TOAST_LIFE: {},
}))
vi.mock('../stencils/registry', () => ({ getStencilById: () => null }))

import { editRanges, useValueRanges, withZeroStart } from './useValueRanges'
import { useProjectStore } from '../stores/useProjectStore'

const RANGES = [
  { min: 0, max: 3.99, color: '#10b981' },
  { min: 4, max: 10, color: '#ef4444' },
]

describe('editRanges', () => {
  it('пишет число в нужный порог, остальные не трогает', () => {
    const out = editRanges(RANGES, 1, 'min', '5')
    expect(out[1]).toEqual({ min: 5, max: 10, color: '#ef4444' })
    expect(out[0]).toEqual(RANGES[0])
    expect(out).not.toBe(RANGES) // новый массив, без мутации исходного
  })

  it('русская десятичная запятая нормализуется в точку', () => {
    expect(editRanges(RANGES, 0, 'max', '3,5')[0].max).toBe(3.5)
  })

  it('нечисловой ввод → null (правку игнорируем, NaN в данные не попадает)', () => {
    expect(editRanges(RANGES, 0, 'min', 'abc')).toBeNull()
    expect(editRanges(RANGES, 0, 'min', '')).toBeNull()
  })

  it('цвет пишется строкой, без числового парсинга', () => {
    expect(editRanges(RANGES, 0, 'color', '#f59e0b')[0].color).toBe('#f59e0b')
  })

  it('точное значение правится тем же путём, что и порог', () => {
    const rows = [{ value: 1, color: '#10b981' }]
    expect(editRanges(rows, 0, 'value', '2')[0]).toEqual({ value: 2, color: '#10b981' })
    expect(editRanges(rows, 0, 'value', '')).toBeNull()
  })
})

// Диапазон сравнивает значение с min/max, поэтому булев и текстовый тег в его пикере
// не нужны: такая привязка не даст цвета ни в превью, ни в рантайме.
describe('пикер тега диапазонов: только числовые типы', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function setup() {
    useProjectStore().setTags([
      { name: 'UA', type: 'Float' },
      { name: 'ONOFF', type: 'Boolean' },
      { name: 'NAME', type: 'String' },
      { name: 'RAW', type: 'ByteArray' },
      { name: 'CNT', type: 'Int32' },
      { name: 'MYSTERY', type: 'Whatever' },
    ])
    const openPicker = vi.fn()
    const api = useValueRanges({
      details: ref({ rangeSource: null }),
      mutateSelectedTms: vi.fn(),
      openPicker,
    })
    return { api, openPicker }
  }

  it('одиночная привязка отдаёт числовые теги, незнакомый тип оставляет', () => {
    const { api, openPicker } = setup()
    api.openRangePicker()
    const tags = openPicker.mock.calls[0][0].tags()
    expect(tags.map((t) => t.name)).toEqual(['UA', 'CNT', 'MYSTERY'])
  })

  it('массовая привязка фильтрует так же', () => {
    const { api, openPicker } = setup()
    api.openMultiRangePicker()
    expect(openPicker.mock.calls[0][0].tags().map((t) => t.name)).toEqual(['UA', 'CNT', 'MYSTERY'])
  })
})

// Низ первой строки фиксирован нулём: в инспекторе поле не правится, поэтому данные
// обязаны совпадать с тем, что показано.
describe('withZeroStart', () => {
  it('первой строке ставит min = 0, остальные не трогает', () => {
    const out = withZeroStart([
      { min: 5, max: 8, color: '#10b981' },
      { min: 8, max: 10, color: '#ef4444' },
    ])
    expect(out[0]).toEqual({ min: 0, max: 8, color: '#10b981' })
    expect(out[1]).toEqual({ min: 8, max: 10, color: '#ef4444' })
  })

  it('готовый список отдаёт как есть (без лишней перезаписи графа)', () => {
    const rows = [{ min: 0, max: 4, color: '#10b981' }]
    expect(withZeroStart(rows)).toBe(rows)
    expect(withZeroStart([])).toEqual([])
  })
})
