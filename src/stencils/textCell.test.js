import { describe, it, expect, vi } from 'vitest'

// В jsdom canvas недоступен, а экспорт подписи опирается на замер — подменяем
// метрику детерминированной (7px на символ, пустая строка → 0).
vi.mock('../utils/textMetrics', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, measureTextWidth: (text) => (text || '').length * 7 }
})

import { resizeTextCell, buildTextExportSvg, textCellSize, TEXT_FONT_SIZE } from './textCell'

// Мини-мок JointJS-ячейки: size/position + resize/position(). Полноценный dia
// элемент для проверки якоря resizeTextCell не нужен (paper тоже не нужен).
function mockCell(x, y, w, h) {
  const state = { size: { width: w, height: h }, position: { x, y } }
  return {
    get: (k) => state[k],
    resize: (nw, nh) => {
      state.size = { width: nw, height: nh }
    },
    position: (nx, ny) => {
      state.position = { x: nx, y: ny }
    },
    _state: state,
  }
}

describe('resizeTextCell (якорь align)', () => {
  it('left (дефолт): позиция не двигается — блок растёт вправо', () => {
    const cell = mockCell(100, 50, 40, 20)
    resizeTextCell(cell, 60, 20, 'left')
    expect(cell._state.size).toEqual({ width: 60, height: 20 })
    expect(cell._state.position).toEqual({ x: 100, y: 50 })
  })

  it('right: правый край на месте — при росте сдвигаемся влево', () => {
    const cell = mockCell(100, 50, 40, 20)
    // ширина 40 → 60 (+20): x должен уменьшиться на 20 (правый край 140 держится).
    resizeTextCell(cell, 60, 20, 'right')
    expect(cell._state.position).toEqual({ x: 80, y: 50 })
    expect(100 + 40).toBe(80 + 60) // правый край не сдвинулся
  })

  it('center: центр на месте — сдвиг на половину дельты', () => {
    const cell = mockCell(100, 50, 40, 20)
    // ширина 40 → 60 (+20): x -= 10, центр 120 держится.
    resizeTextCell(cell, 60, 20, 'center')
    expect(cell._state.position).toEqual({ x: 90, y: 50 })
  })

  it('ширина не изменилась → позицию не трогаем даже при right', () => {
    const cell = mockCell(100, 50, 40, 20)
    resizeTextCell(cell, 40, 24, 'right')
    expect(cell._state.position).toEqual({ x: 100, y: 50 })
  })
})

// Единственная точка расчёта габарита — вызывающие не распаковывают tms
// сам и передавал четыре позиционных аргумента — новое свойство (шрифт) легко
// забыть в одном из четырёх мест.
describe('textCellSize', () => {
  it('считает по tms целиком, включая шрифт и жирность', () => {
    // Мок метрики — 7px на символ, поэтому ширина = len*7 + padding*2.
    expect(textCellSize({ text: 'QF-101', fontSize: 14 })).toEqual({
      width: 6 * 7 + 8,
      height: 14 + 6,
    })
  })

  it('второй аргумент переопределяет текст (live-resize при печати)', () => {
    const tms = { text: 'очень длинный текст', fontSize: 10 }
    expect(textCellSize(tms, 'abcd').width).toBe(4 * 7 + 8)
  })

  it('пустой tms → дефолтный размер шрифта и минимальная ширина', () => {
    expect(textCellSize({})).toEqual({ width: 24, height: TEXT_FONT_SIZE + 6 })
  })
})

describe('buildTextExportSvg', () => {
  it('шрифт из whitelist уходит в SVG, чужой падает в дефолт', () => {
    expect(buildTextExportSvg('Секция', 20, { font: 'monospace' })).toContain(
      'font-family="monospace"'
    )
    expect(buildTextExportSvg('Секция', 20, { font: 'Comic Sans MS' })).toContain(
      'font-family="sans-serif"'
    )
  })

  it('textLength фиксирует ширину, посчитанную IDE', () => {
    // Панель может рисовать generic-имя другой гарнитурой; без textLength подпись
    // наползала бы за габарит ячейки, который в этой ширине и забейкан.
    const svg = buildTextExportSvg('QF-101', 20, {})
    expect(svg).toContain('textLength="42"') // 6 символов × 7px
    expect(svg).toContain('lengthAdjust="spacingAndGlyphs"')
  })

  it('пустой текст — без textLength (иначе строка схлопнулась бы в ноль)', () => {
    expect(buildTextExportSvg('', 20, {})).not.toContain('textLength')
  })
})
