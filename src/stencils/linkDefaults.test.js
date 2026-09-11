// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  insideApproachDirection,
  rightAngleDirections,
  arrowSize,
  isInsideBBox,
  arrowPath,
  arrowMarker,
  arrowInset,
  arrowInsetEnds,
  insetTowards,
  syncLinkEndMarkers,
  snapFreeLinkEnds,
  renderEndDots,
  arrowExportSvg,
  linkStyleAttrs,
  isFreeEnd,
  endPoint,
  normalizeWireStyle,
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
    expect(arrowSize(2)).toEqual({ len: 3, half: 3 })
    expect(arrowSize(4)).toEqual({ len: 6, half: 6 })
    // Треугольник крупнее галочки: 2 толщины против 1.5.
    expect(arrowSize(2, 'solid')).toEqual({ len: 4, half: 4 })
    expect(arrowSize(2, 'open')).toEqual({ len: 3, half: 3 })
    // Мусор и ноль → дефолтная толщина линии (2).
    expect(arrowSize(undefined)).toEqual({ len: 3, half: 3 })
    // Раствор 90°: длина равна полуширине, каждая сторона идёт под 45°.
    const { len, half } = arrowSize(3)
    expect(len).toBe(half)
  })

  it('solid — замкнутый треугольник, open — две линии; раствор у обоих 90°', () => {
    // Треугольник: основание в конце ПУТИ (x = 0), остриё на `len` впереди — в точке
    // соединения: путь под ним укорочен (arrowInsetJumpover), тело до острия не доходит.
    expect(arrowPath('solid', 2)).toBe('M -4 0 L 0 4 L 0 -4 Z')
    // Галочка: вершина в конце пути, тело упирается в неё; остриё — miter-выступ.
    expect(arrowPath('open', 2)).toBe('M 3 3 L 0 0 L 3 -3')
    expect(arrowPath(undefined, 2)).toBeNull()
  })

  it('arrowInset: путь не доходит до точки соединения ровно на вынос острия', () => {
    // Треугольник — на всю длину; галочка — на miter-выступ w/√2 (сотые).
    expect(arrowInset('solid', 2)).toBe(4)
    expect(arrowInset('open', 2)).toBe(1.41)
    expect(arrowInset('open', 4)).toBe(2.83)
    expect(arrowInset(null, 2)).toBe(0)
    expect(arrowInset(undefined, 2)).toBe(0)
  })

  it('маркеры ОБОИХ концов одинаковы: тело в +X, остриё впереди конца пути', () => {
    // `marker-start` ориентируется по направлению пути, а `target-marker` JointJS
    // отдаёт с `rotate(180)`, поэтому внутрь линии у обоих указывает +X. Зеркальный
    // путь увёл бы наконечник конца ЗА точку соединения, под символ.
    const line = linkStyleAttrs({ arrowStart: 'solid', arrowEnd: 'solid' }).line
    expect(line.sourceMarker.d).toBe('M -4 0 L 0 4 L 0 -4 Z')
    expect(line.targetMarker.d).toBe('M -4 0 L 0 4 L 0 -4 Z')
    // Тот же путь, что ставит инспектор при выборе наконечника — иначе вид провода
    // зависел бы от того, только что его настроили или загрузили из архива.
    expect(line.targetMarker.d).toBe(arrowMarker('solid', { strokeWidth: 2 }).d)
  })

  it('insetTowards сдвигает конец внутрь на длину наконечника, но не дальше середины', () => {
    expect(insetTowards({ x: 0, y: 0 }, { x: 100, y: 0 }, 5)).toEqual({ x: 5, y: 0 })
    expect(insetTowards({ x: 0, y: 40 }, { x: 0, y: 0 }, 10)).toEqual({ x: 0, y: 30 })
    // Короткий провод: два наконечника иначе поменяли бы концы местами.
    expect(insetTowards({ x: 0, y: 0 }, { x: 6, y: 0 }, 5)).toEqual({ x: 3, y: 0 })
    // Нулевой отрезок / нулевой сдвиг — точка как есть.
    expect(insetTowards({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toEqual({ x: 1, y: 1 })
    expect(insetTowards({ x: 1, y: 1 }, { x: 9, y: 1 }, 0)).toEqual({ x: 1, y: 1 })
  })

  it('arrowInsetEnds режет путь под наконечником к ближайшему излому', () => {
    const s = { x: 0, y: 0 }
    const t = { x: 100, y: 50 }
    // Начало — на len = 4 к первому излому (вниз), конец без стрелки не тронут.
    expect(arrowInsetEnds(s, t, [{ x: 0, y: 50 }], { arrowStart: 'solid' })).toEqual({
      start: { x: 0, y: 4 },
      end: { x: 100, y: 50 },
    })
    // Без изломов ориентир — противоположный конец; толщина 4 → len = 8.
    const both = arrowInsetEnds(s, { x: 100, y: 0 }, [], {
      arrowStart: 'solid',
      arrowEnd: 'solid',
      strokeWidth: 4,
    })
    expect(both).toEqual({ start: { x: 8, y: 0 }, end: { x: 92, y: 0 } })
    // Галочка режет только на miter-выступ (w = 2 → 1.41).
    const open = arrowInsetEnds(s, { x: 100, y: 0 }, [], { arrowStart: 'open', arrowEnd: 'open' })
    expect(open).toEqual({ start: { x: 1.41, y: 0 }, end: { x: 98.59, y: 0 } })
    // Без наконечников концы как есть.
    expect(arrowInsetEnds(s, t, [], {})).toEqual({ start: s, end: t })
    // Без наконечников и без tms — концы как есть.
    expect(arrowInsetEnds(s, t, [], undefined)).toEqual({ start: s, end: t })
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

// Понятие «конец провода свободен» — ОДНО на весь проект: выделение, маркер точки,
// экспорт меты и загрузчик обязаны решать одинаково.
describe('isFreeEnd / endPoint', () => {
  it('точка на холсте — свободный конец, привязка к ячейке — нет', () => {
    expect(isFreeEnd({ x: 10, y: 20 })).toBe(true)
    expect(isFreeEnd({ id: 'a' })).toBe(false)
    expect(isFreeEnd({ id: 'a', port: 'top' })).toBe(false)
  })

  it('ни привязки, ни координат — свободным НЕ считаем (точку рисовать негде)', () => {
    expect(isFreeEnd({})).toBe(false)
    expect(isFreeEnd({ x: NaN, y: 0 })).toBe(false)
    expect(isFreeEnd(null)).toBe(false)
    expect(isFreeEnd(undefined)).toBe(false)
  })

  it('endPoint отдаёт координаты только свободного конца', () => {
    expect(endPoint({ x: 5, y: 6 })).toEqual({ x: 5, y: 6 })
    expect(endPoint({ id: 'a', x: 5, y: 6 })).toBeNull()
    expect(endPoint({})).toBeNull()
  })
})

// Допуски вида провода: одна проверка на правку из инспектора и на чтение меты.
describe('normalizeWireStyle', () => {
  it('оставляет годные значения', () => {
    expect(
      normalizeWireStyle({ strokeWidth: 4, strokeColor: '#ff0000', arrowEnd: 'solid' })
    ).toEqual({ strokeWidth: 4, strokeColor: '#ff0000', arrowEnd: 'solid' })
  })

  it('толщина вне 0.5..20, чужой цвет и неизвестный наконечник отбрасываются', () => {
    expect(normalizeWireStyle({ strokeWidth: 30 })).toEqual({})
    expect(normalizeWireStyle({ strokeWidth: 0.1 })).toEqual({})
    expect(normalizeWireStyle({ strokeWidth: '4' })).toEqual({ strokeWidth: 4 })
    expect(normalizeWireStyle({ strokeColor: 'url(evil)' })).toEqual({})
    expect(normalizeWireStyle({ arrowStart: 'dot' })).toEqual({})
  })

  it('не объект → пусто', () => {
    expect(normalizeWireStyle(null)).toEqual({})
    expect(normalizeWireStyle('solid')).toEqual({})
  })
})

describe('renderEndDots', () => {
  const linkOf = (tms, source, target) => ({
    get: (key) => (key === 'tms' ? tms : key === 'source' ? source : target),
  })

  it('точка рисуется в группе линка с классом заливки — как в экспорте', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    renderEndDots(linkOf({ strokeColor: '#ff0000' }, { id: 'a', port: 'p' }, { x: 40, y: 10 }), {
      el,
    })
    const dots = el.querySelectorAll('circle')
    expect(dots).toHaveLength(1)
    expect(dots[0].getAttribute('cx')).toBe('40')
    expect(dots[0].getAttribute('fill')).toBe('#ff0000')
    expect(dots[0].getAttribute('class')).toBe('tms-range-fill')
  })

  it('повторный вызов заменяет прежние точки, наконечник её вытесняет', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const link = linkOf({}, { x: 0, y: 0 }, { x: 40, y: 10 })
    renderEndDots(link, { el })
    renderEndDots(link, { el })
    expect(el.querySelectorAll('circle')).toHaveLength(2)

    renderEndDots(linkOf({ arrowEnd: 'solid' }, { id: 'a' }, { x: 40, y: 10 }), { el })
    expect(el.querySelectorAll('circle')).toHaveLength(0)
  })
})

describe('syncLinkEndMarkers', () => {
  const link = (tms, target) => {
    const attrs = {}
    return {
      get: (key) => (key === 'tms' ? tms : key === 'target' ? target : { id: 'c1', port: 'p' }),
      attr: (path, value) => {
        attrs[path] = value
        return attrs[path]
      },
      attrs,
    }
  }

  it('без наконечников оба маркера пустые: точку свободного конца рисует DOM', () => {
    const l = link({}, { x: 10, y: 20 })
    syncLinkEndMarkers(l)
    expect(l.attrs['line/sourceMarker']).toEqual({ type: 'none' })
    expect(l.attrs['line/targetMarker']).toEqual({ type: 'none' })
  })

  it('заданный наконечник ставится маркером', () => {
    const l = link({ arrowEnd: 'solid' }, { x: 10, y: 20 })
    syncLinkEndMarkers(l)
    expect(l.attrs['line/targetMarker']).toMatchObject({ type: 'path', fill: '#000' })
  })
})

describe('snapFreeLinkEnds', () => {
  const linkWith = (source, target) => {
    const model = { source, target }
    return {
      get: (key) => model[key],
      set: (key, value) => (model[key] = value),
      model,
    }
  }

  it('свободный конец с дробной координаты садится на сетку', () => {
    // JointJS ставит его в точку отпускания мыши как есть, а порты символов кратны
    // шагу — иначе провод идёт к точке наклонной линией.
    const link = linkWith({ id: 'c1' }, { x: 203, y: 97 })
    expect(snapFreeLinkEnds(link, 5)).toBe(true)
    expect(link.model.target).toEqual({ x: 205, y: 95 })
    // Привязанный конец не трогаем: он следует за портом.
    expect(link.model.source).toEqual({ id: 'c1' })
  })

  it('конец уже на сетке не переписывается', () => {
    const link = linkWith({ x: 20, y: 40 }, { id: 'c2' })
    expect(snapFreeLinkEnds(link, 5)).toBe(false)
  })
})
