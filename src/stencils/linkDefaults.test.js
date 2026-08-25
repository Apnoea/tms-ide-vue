import { describe, it, expect } from 'vitest'
import {
  insideApproachDirection,
  rightAngleDirections,
  arrowSize,
  isInsideBBox,
  arrowPath,
  arrowMarker,
  arrowExportSvg,
  linkStyleAttrs,
} from './linkDefaults'

// Порт шины стоит в СЕРЕДИНЕ толщины, и дефолт роутера (MAGNET_SIDE = ближайшая
// сторона bbox) при равноудалённых top/bottom заводил все провода с одной стороны.
describe('insideApproachDirection', () => {
  // Шина: широкое тонкое тело, слот в середине.
  const bus = { x: 0, y: 100, width: 80, height: 8 }
  const slot = { x: 20, y: 104 }

  it('к шине провод подходит с той стороны, откуда идёт', () => {
    expect(insideApproachDirection(slot, bus, { x: 20, y: 40 })).toBe('top')
    expect(insideApproachDirection(slot, bus, { x: 20, y: 300 })).toBe('bottom')
  })

  it('вход в шину всегда перпендикулярен телу, даже если провод идёт сбоку', () => {
    // По дельте вышло бы «слева», и провод въехал бы в торец вдоль тела.
    expect(insideApproachDirection(slot, bus, { x: -200, y: 104 })).toBe('bottom')
    expect(insideApproachDirection(slot, bus, { x: 500, y: 102 })).toBe('top')
  })

  it('тело без вытянутости (точка соединения): ось по преобладающей дельте', () => {
    const node = { x: 50, y: 50, width: 4, height: 4 }
    const center = { x: 52, y: 52 }
    expect(insideApproachDirection(center, node, { x: 52, y: 300 })).toBe('bottom')
    expect(insideApproachDirection(center, node, { x: 300, y: 52 })).toBe('right')
  })

  it('порт на границе тела — направление остаётся за роутером', () => {
    // Обычный символ: порт на краю габарита, сторона однозначна и без нас.
    expect(insideApproachDirection({ x: 20, y: 100 }, bus, { x: 20, y: 40 })).toBeNull()
    expect(insideApproachDirection({ x: 0, y: 104 }, bus, { x: 20, y: 40 })).toBeNull()
    expect(insideApproachDirection(null, bus, { x: 0, y: 0 })).toBeNull()
  })
})

describe('rightAngleDirections', () => {
  const elementView = (bbox) => ({ model: { isElement: () => true, getBBox: () => bbox } })
  const bus = { x: 0, y: 100, width: 80, height: 8 }

  it('оба конца на шинах получают свою сторону', () => {
    const dirs = rightAngleDirections([], {
      sourceView: elementView(bus),
      sourceAnchor: { x: 20, y: 104 },
      targetView: elementView({ ...bus, y: 300 }),
      targetAnchor: { x: 20, y: 304 },
    })
    // Источник выше цели: из него выходим вниз, в цель заходим сверху.
    expect(dirs).toEqual({ sourceDirection: 'bottom', targetDirection: 'top' })
  })

  it('сторону задаёт ближайший ручной излом, а не противоположный конец', () => {
    const linkView = {
      sourceView: elementView(bus),
      sourceAnchor: { x: 20, y: 104 },
      targetView: null,
      targetAnchor: { x: 400, y: 50 },
    }
    // Без изломов провод идёт к цели наверху — выходим вверх.
    expect(rightAngleDirections([], linkView).sourceDirection).toBe('top')
    // Излом уводит провод вниз — выходим вниз, иначе линия обогнула бы шину.
    expect(rightAngleDirections([{ x: 20, y: 400 }], linkView).sourceDirection).toBe('bottom')
  })

  it('свободный конец и конец на проводе пропускаются', () => {
    expect(
      rightAngleDirections([], {
        sourceView: null,
        sourceAnchor: { x: 0, y: 0 },
        targetView: { model: { isElement: () => false } },
        targetAnchor: { x: 20, y: 104 },
      })
    ).toEqual({})
    expect(rightAngleDirections([], null)).toEqual({})
  })
})

describe('наконечники провода', () => {
  it('размер пропорционален толщине линии', () => {
    expect(arrowSize(2)).toEqual({ len: 5, half: 5 })
    expect(arrowSize(4)).toEqual({ len: 10, half: 10 })
    // Мусор и ноль → дефолтная толщина линии (2).
    expect(arrowSize(undefined)).toEqual({ len: 5, half: 5 })
    // Раствор 90°: длина равна полуширине, каждая сторона идёт под 45°.
    const { len, half } = arrowSize(3)
    expect(len).toBe(half)
  })

  it('solid — замкнутый треугольник, open — две линии; раствор у обоих 90°', () => {
    // Вершина в точке конца линии (0 0), тело — вдоль оси X внутрь линии.
    expect(arrowPath('solid', 2)).toBe('M 0 0 L 5 5 L 5 -5 Z')
    expect(arrowPath('open', 2)).toBe('M 5 5 L 0 0 L 5 -5')
    expect(arrowPath(undefined, 2)).toBeNull()
  })

  it('маркеры ОБОИХ концов одинаковы: тело в +X, остриё в точке соединения', () => {
    // `marker-start` ориентируется по направлению пути, а `target-marker` JointJS
    // отдаёт с `rotate(180)` — то есть внутрь линии у обоих указывает +X. Раньше у
    // конца знак был обратным: наконечник уезжал ЗА точку соединения, под символ, и
    // после загрузки формы пропадал (в инспекторе при этом оставался выбранным).
    const line = linkStyleAttrs({ arrowStart: 'solid', arrowEnd: 'solid' }).line
    expect(line.sourceMarker.d).toBe('M 0 0 L 5 5 L 5 -5 Z')
    expect(line.targetMarker.d).toBe('M 0 0 L 5 5 L 5 -5 Z')
    // Тот же путь, что ставит инспектор при выборе наконечника — иначе вид провода
    // зависел бы от того, только что его настроили или загрузили из архива.
    expect(line.targetMarker.d).toBe(arrowMarker('solid', { strokeWidth: 2 }).d)
  })

  it('стиль линии несёт маркеры только для заданных концов', () => {
    expect(linkStyleAttrs({ arrowEnd: 'solid' }).line.targetMarker).toMatchObject({
      type: 'path',
      fill: '#000',
    })
    expect(linkStyleAttrs({ arrowEnd: 'solid' }).line.sourceMarker).toEqual({ type: 'none' })
    // Полая — контуром в цвет линии, без заливки.
    const open = linkStyleAttrs({ arrowStart: 'open', strokeColor: '#ff0000' }).line.sourceMarker
    expect(open).toMatchObject({ fill: 'none', stroke: '#ff0000' })
    expect(linkStyleAttrs({})).toBeNull()
  })

  it('экспортный наконечник ставится в точку конца и поворачивается по углу', () => {
    const svg = arrowExportSvg('solid', { x: 40, y: 10 }, 90, 2, '#000')
    expect(svg).toContain('transform="translate(40 10) rotate(90)"')
    expect(svg).toContain('class="tms-range-fill"')
    expect(arrowExportSvg(null, { x: 0, y: 0 }, 0, 2, '#000')).toBe('')
  })
})

// Ручка конца провода стоит в anchor'е, если тот ВНУТРИ тела (слот шины в середине
// толщины): путь у шины заканчивается на границе, и ручка иначе уезжала бы с точки
// соединения на край. Предикат — общий с insideApproachDirection.
describe('isInsideBBox', () => {
  const bbox = { x: 100, y: 50, width: 80, height: 8 }

  it('точка в теле — да, на границе и снаружи — нет', () => {
    expect(isInsideBBox({ x: 140, y: 54 }, bbox)).toBe(true)
    // Границы не считаются: порт на контуре обычного символа — не «внутри тела».
    expect(isInsideBBox({ x: 100, y: 54 }, bbox)).toBe(false)
    expect(isInsideBBox({ x: 140, y: 50 }, bbox)).toBe(false)
    expect(isInsideBBox({ x: 200, y: 54 }, bbox)).toBe(false)
  })

  it('без точки или bbox — нет (концы без привязки)', () => {
    expect(isInsideBBox(null, bbox)).toBe(false)
    expect(isInsideBBox({ x: 1, y: 1 }, null)).toBe(false)
  })
})
