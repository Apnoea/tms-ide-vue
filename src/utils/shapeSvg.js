/**
 * Фигура-примитив (rect, line, circle, polyline, text) → SVG и её геометрия: рендер,
 * габарит, перенос, масштаб, поворот, отражение. Общие для редактора символов и
 * фигур-разметки на холсте (stencils/shapeElement), поэтому холст, `view.svg` и
 * редактор рисуют одно и то же. Символ целиком (shape.svg, stencil.json) — в stencilSvg.
 */

import { ATTR_PARAM, ATTR_SUFFIX, isValidParamKey } from '../constants/ids'
import { STATE_FILL_CLASS } from '../constants/animation'
import { TEXT_SHAPE_SIZE, normalizeFont } from '../constants/text'
import { escapeAttr, escapeXml } from './xml'
import { measureTextWidth } from './textMetrics'

// Числа в атрибутах: без хвостовых нулей и float-мусора (12.0 → 12, 12.5 → 12.5).
export function num(v) {
  return Number.parseFloat(Number(v).toFixed(3)).toString()
}

// Обводка есть у всех примитивов; заливка — только у замкнутых, по умолчанию none.
function strokeAttrs(shape) {
  return `stroke="${shape.stroke || '#000'}" stroke-width="${num(shape.strokeWidth ?? 2)}"`
}
function fillAttr(shape) {
  return `fill="${shape.fill || 'none'}"`
}

// Заливаемая фигура — замкнутый примитив (у него заливка по состоянию осмысленна,
// даже если базово fill=none).
export function isFillableShape(shape) {
  if (!shape) return false
  if (shape.type === 'rect' || shape.type === 'circle') return true
  if (shape.type === 'polyline') return !!shape.closed
  return false
}
/**
 * Ляжет ли на фигуру заливка состояния: замкнутая и без своей заливки. Новая фигура
 * рождается с `fill: 'none'`, так что своя заливка — это галка «Заливка», включённая
 * автором, и цвет состояния её не перебивает. Та же проверка в CSS экспорта
 * (`buildStateColorCssRules`, `[fill="none"]`).
 */
export function takesStateFill(shape) {
  return isFillableShape(shape) && (!shape.fill || shape.fill === 'none')
}
// Класс заливки — заливаемым примитивам и только у stateful-символа.
function fillClassAttr(shape, markFill) {
  return markFill && isFillableShape(shape) ? ` class="${STATE_FILL_CLASS}"` : ''
}

// Радиус скругления углов прямоугольника (в user-единицах) при shape.rounded.
export const ROUND_RX = 2

/**
 * Радиусы «круга»: модель хранит rx/ry (круг = равные), но из рукописного SVG и
 * старых shape.svg приходит одиночный `r` — приводим к одной форме здесь, чтобы
 * остальной код не проверял оба поля.
 */
export function radii(shape) {
  const rx = shape.rx ?? shape.r ?? 0
  const ry = shape.ry ?? shape.r ?? rx
  return { rx, ry }
}

// Якорь подписи без поля `align` — центр. Кегль по умолчанию и шрифт (whitelist, тем же
// семейством идёт замер) — в constants/text.
const TEXT_SHAPE_ANCHOR = 'middle'

/** Межстрочный шаг подписи в долях кегля. Константа, а не поле фигуры. */
export const TEXT_LINE_HEIGHT = 1.2

/**
 * Строки подписи: многострочность живёт в самом `text` как `\n`, отдельного поля нет.
 * Пустые строки значимы (автор оставил интервал).
 */
export function textLines(shape) {
  return String(shape?.text ?? '').split('\n')
}

// Выравнивание подписи = ЯКОРЬ роста: точка x,y стоит на месте, текст растёт от неё.
// Новая подпись создаётся с `left`, без поля — дефолт выше (центр).
const TEXT_ANCHORS = { left: 'start', center: 'middle', right: 'end' }
export function textAnchorOf(shape) {
  return TEXT_ANCHORS[shape?.align] || TEXT_SHAPE_ANCHOR
}

/**
 * Габарит подписи: ширина — canvas-замером самой длинной строки, высота — по их
 * числу с запасом на descender'ы. Точка привязки `x`/`y` — baseline ПЕРВОЙ строки и
 * позиция по якорю (textAnchorOf), блок растёт вниз.
 */
export function textShapeBox(shape) {
  const size = shape.fontSize ?? TEXT_SHAPE_SIZE
  const lines = textLines(shape)
  // Без canvas (jsdom) — оценка по числу символов.
  const widths = lines.map((line) => {
    const w = measureTextWidth(line, size, shape.bold, -1, shape.fontFamily)
    return w < 0 ? line.length * size * 0.6 : w
  })
  const width = Math.max(0, ...widths)
  const anchor = textAnchorOf(shape)
  const x = anchor === 'start' ? shape.x : anchor === 'end' ? shape.x - width : shape.x - width / 2
  return {
    x,
    y: shape.y - size,
    w: width,
    h: size * 1.25 + (lines.length - 1) * size * TEXT_LINE_HEIGHT,
  }
}

// Скругление: у линии/ломаной — круглые торцы и стыки, у прямоугольника — углы (rx).
function roundingAttrs(shape) {
  if (!shape.rounded) return ''
  if (shape.type === 'rect') return ` rx="${num(ROUND_RX)}"`
  if (shape.type === 'line') return ' stroke-linecap="round"'
  if (shape.type === 'polyline') return ' stroke-linecap="round" stroke-linejoin="round"'
  return ''
}

/** Суффикс текста, показывающего значение тега: метка на `<text>` и idSuffix его карточки. */
export const VALUE_TEXT_SUFFIX = '.value'

/**
 * Одна фигура → SVG-строка. Тем же генератором рисуются фигуры-примитивы на холсте
 * (stencils/shapeElement), поэтому холст, `view.svg` и редактор символов показывают
 * одно и то же.
 *
 * @param {boolean} [markFill] — метить заливаемые фигуры классом состояния (только
 *   stateful-символы; примитивам холста не нужно — у них нет анимаций)
 */
export function serializeShape(shape, markFill) {
  switch (shape.type) {
    case 'rect':
      return (
        `<rect${fillClassAttr(shape, markFill)} x="${num(shape.x)}" y="${num(shape.y)}" ` +
        `width="${num(shape.w)}" height="${num(shape.h)}" ` +
        `${fillAttr(shape)} ${strokeAttrs(shape)}${roundingAttrs(shape)}/>`
      )
    case 'line':
      return (
        `<line x1="${num(shape.x1)}" y1="${num(shape.y1)}" ` +
        `x2="${num(shape.x2)}" y2="${num(shape.y2)}" ${strokeAttrs(shape)}${roundingAttrs(shape)}/>`
      )
    case 'circle': {
      // Круг — частный случай эллипса (rx === ry): при равных полуосях пишем
      // <circle>, иначе <ellipse>.
      const { rx, ry } = radii(shape)
      const geom = rx === ry ? `r="${num(rx)}"` : `rx="${num(rx)}" ry="${num(ry)}"`
      const tag = rx === ry ? 'circle' : 'ellipse'
      return (
        `<${tag}${fillClassAttr(shape, markFill)} cx="${num(shape.cx)}" cy="${num(shape.cy)}" ${geom} ` +
        `${fillAttr(shape)} ${strokeAttrs(shape)}${roundingAttrs(shape)}/>`
      )
    }
    case 'polyline': {
      const pts = (shape.points || []).map(([x, y]) => `${num(x)},${num(y)}`).join(' ')
      // Замкнутая ломаная — это <polygon> (сам соединяет конец с началом).
      const tag = shape.closed ? 'polygon' : 'polyline'
      return `<${tag}${fillClassAttr(shape, markFill)} points="${pts}" ${fillAttr(shape)} ${strokeAttrs(shape)}${roundingAttrs(shape)}/>`
    }
    case 'text': {
      // Цвет подписи — это fill (обводки у текста нет), поэтому stroke не пишем:
      // он дал бы «жирный контур» вокруг глифов.
      const weight = shape.bold ? ' font-weight="bold"' : ''
      const size = shape.fontSize ?? TEXT_SHAPE_SIZE
      const lines = textLines(shape)
      // Текст, показывающий значение тега: метка идёт на сам <text> (рантайм пишет в
      // его textContent), а не на группу — та отвечает за видимость по состоянию.
      const valueMark = shape.valueText ? ` ${ATTR_SUFFIX}="${VALUE_TEXT_SUFFIX}"` : ''
      // Подпись-параметр: экземпляр подставит свой текст в этот узел.
      const paramMark = isValidParamKey(shape.param)
        ? ` ${ATTR_PARAM}="${escapeAttr(shape.param)}"`
        : ''
      const open =
        `<text${valueMark}${paramMark} x="${num(shape.x)}" y="${num(shape.y)}" text-anchor="${textAnchorOf(shape)}" ` +
        `font-size="${num(size)}" font-family="${normalizeFont(shape.fontFamily)}"${weight} ` +
        `fill="${shape.stroke || '#000'}">`
      // Одна строка — текст прямо в <text>, без tspan'ов.
      if (lines.length < 2) return `${open}${escapeXml(shape.text || '')}</text>`
      // Несколько — по tspan'у на строку (переносов SVG не делает): у каждого свой x
      // и dy — шаг вниз. `text-anchor` наследуется от <text>, якорь тот же.
      const tspans = lines
        .map(
          (line, i) =>
            `<tspan x="${num(shape.x)}" dy="${i === 0 ? 0 : num(size * TEXT_LINE_HEIGHT)}">${escapeXml(line)}</tspan>`
        )
        .join('')
      return `${open}${tspans}</text>`
    }
    default:
      return ''
  }
}

/**
 * Единый обход опорных точек фигуры: `fn(x, y)` → `[x, y]`. На нём стоят перенос,
 * масштаб, поворот и отражение.
 *
 * Прямоугольник и эллипс заданы размерами, поэтому отображаются два угла (у эллипса —
 * центр и «радиус-угол»), а стороны пересчитываются через abs: поворот сам меняет их
 * местами, отражение не даёт отрицательной ширины. Подпись переносится точкой
 * привязки, глифы остаются горизонтальными.
 */
function mapShapePoints(s, fn) {
  if (!s) return s
  if (s.type === 'rect') {
    const [ax, ay] = fn(s.x, s.y)
    const [bx, by] = fn(s.x + s.w, s.y + s.h)
    return {
      ...s,
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay),
    }
  }
  if (s.type === 'circle') {
    const { rx, ry } = radii(s)
    const [cx, cy] = fn(s.cx, s.cy)
    const [ex, ey] = fn(s.cx + rx, s.cy + ry)
    return { ...s, cx, cy, rx: Math.abs(ex - cx), ry: Math.abs(ey - cy) }
  }
  if (s.type === 'line') {
    const [x1, y1] = fn(s.x1, s.y1)
    const [x2, y2] = fn(s.x2, s.y2)
    return { ...s, x1, y1, x2, y2 }
  }
  if (s.type === 'polyline') return { ...s, points: s.points.map(([x, y]) => fn(x, y)) }
  if (s.type === 'text') {
    const [x, y] = fn(s.x, s.y)
    return { ...s, x, y }
  }
  return s
}

/**
 * Масштаб относительно НАЧАЛА КООРДИНАТ: фигуры холста хранятся прижатыми к 0,0
 * (`shapeElement.placeShape`), и ресайз за ручки тянет геометрию в тех же пропорциях.
 * Подпись не масштабируется — её габарит задаёт шрифт.
 */
export function scaleShape(s, sx, sy) {
  return mapShapePoints(s, (x, y) => [x * sx, y * sy])
}

/**
 * Поворот на 90° вокруг точки: `dir > 0` — по часовой. Ось Y экранная (вниз), поэтому
 * по часовой вектор (dx, dy) переходит в (−dy, dx). Координаты округляем: шаг вершин
 * равен пикселю (SHAPE_GRID), а нечётный габарит дал бы половинки.
 */
export function rotateShape90(s, center, dir = 1) {
  const k = dir < 0 ? -1 : 1
  return mapShapePoints(s, (x, y) => {
    const dx = x - center.x
    const dy = y - center.y
    return [Math.round(center.x - k * dy), Math.round(center.y + k * dx)]
  })
}

/** Отражение подписи меняет якорь: иначе текст уезжает за прежние границы. */
const FLIPPED_ALIGN = { left: 'right', right: 'left' }

/** Отражение вокруг точки: 'h' — по горизонтали (меняет левый и правый край). */
export function flipShape(s, center, axis) {
  const flipped = mapShapePoints(s, (x, y) => [
    axis === 'h' ? 2 * center.x - x : x,
    axis === 'v' ? 2 * center.y - y : y,
  ])
  if (axis !== 'h' || flipped.type !== 'text') return flipped
  const align = FLIPPED_ALIGN[flipped.align]
  return align ? { ...flipped, align } : flipped
}

export function translateShape(s, dx, dy) {
  return mapShapePoints(s, (x, y) => [x + dx, y + dy])
}

/**
 * Ключ ВИДА фигуры: одинаковый ключ = преобразование ничего визуально не поменяло.
 * У линии и ломаной точки сравниваются как множество (реверс вершин рисует ту же
 * линию), у прямоугольника и эллипса геометрия уже нормализована.
 */
function shapeViewKey(s) {
  const setKey = (pts) =>
    pts
      .map(([x, y]) => `${x},${y}`)
      .sort()
      .join(' ')
  if (s.type === 'line')
    return setKey([
      [s.x1, s.y1],
      [s.x2, s.y2],
    ])
  if (s.type === 'polyline') return setKey(s.points || [])
  if (s.type === 'rect') return `r ${s.x} ${s.y} ${s.w} ${s.h}`
  if (s.type === 'circle') {
    const { rx, ry } = radii(s)
    return `c ${s.cx} ${s.cy} ${rx} ${ry}`
  }
  if (s.type === 'text') return `t ${s.x} ${s.y} ${s.align || ''}`
  return JSON.stringify(s)
}

/** Меняет ли преобразование вид выделения (центр — центр общего габарита). */
function transformChangesView(shapes, apply) {
  const bbox = shapesBounds(shapes)
  if (!bbox) return false
  const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }
  return shapes.some((s) => shapeViewKey(apply(s, center)) !== shapeViewKey(s))
}

/**
 * Доступен ли поворот выделения: у круга и квадрата он ничего не меняет, у одиночной
 * подписи лишь переносит точку привязки (глифы горизонтальны).
 */
export function canRotateShapes(shapes) {
  const list = (shapes || []).filter(Boolean)
  if (!list.length) return false
  if (list.length === 1 && list[0].type === 'text') return false
  return transformChangesView(list, (s, center) => rotateShape90(s, center, 1))
}

/**
 * Доступно ли отражение выделения по оси: симметричным фигурам (прямоугольник,
 * эллипс, ортогональная линия) оно ничего не даёт.
 */
export function canFlipShapes(shapes, axis) {
  const list = (shapes || []).filter(Boolean)
  if (!list.length) return false
  // Одиночную подпись не отражаем — якорь роста меняют полем `align`. В пачке она
  // отражается вместе с остальными (`flipShape` инвертирует якорь сам).
  if (list.length === 1 && list[0].type === 'text') return false
  return transformChangesView(list, (s, center) => flipShape(s, center, axis))
}

/**
 * bbox одной фигуры — общий источник для cropToContent и хит-теста лассо. Обводка в
 * габарит не входит, у подписи его задаёт шрифт (textShapeBox).
 *
 * @returns {{x:number, y:number, w:number, h:number}|null} null — тип без габарита
 */
export function shapeBounds(s) {
  if (!s) return null
  if (s.type === 'rect') return { x: s.x, y: s.y, w: s.w, h: s.h }
  if (s.type === 'text') return textShapeBox(s)
  if (s.type === 'circle') {
    const { rx, ry } = radii(s)
    return { x: s.cx - rx, y: s.cy - ry, w: rx * 2, h: ry * 2 }
  }
  if (s.type === 'line') {
    return {
      x: Math.min(s.x1, s.x2),
      y: Math.min(s.y1, s.y2),
      w: Math.abs(s.x2 - s.x1),
      h: Math.abs(s.y2 - s.y1),
    }
  }
  if (s.type === 'polyline') {
    if (!s.points?.length) return null
    const xs = s.points.map(([x]) => x)
    const ys = s.points.map(([, y]) => y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  return null
}

/**
 * Пересекает ли отрезок прямоугольник `{ x1, y1, x2, y2 }` (Лианг — Барски: отрезок
 * отсекается по четырём полуплоскостям, пустой остаток — промах). Конец внутри
 * прямоугольника — попадание.
 */
function segmentHitsRect([ax, ay], [bx, by], r) {
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  for (const [p, q] of [
    [-dx, ax - r.x1],
    [dx, r.x2 - ax],
    [-dy, ay - r.y1],
    [dy, r.y2 - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
  }
  return true
}

/** Отрезки контура фигуры: стороны прямоугольника, звенья ломаной, сама линия. */
function contourSegments(s) {
  if (s.type === 'line')
    return [
      [
        [s.x1, s.y1],
        [s.x2, s.y2],
      ],
    ]
  const pts =
    s.type === 'rect'
      ? [
          [s.x, s.y],
          [s.x + s.w, s.y],
          [s.x + s.w, s.y + s.h],
          [s.x, s.y + s.h],
        ]
      : s.points || []
  const closed = s.type === 'rect' || !!s.closed
  const out = []
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]])
  if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]])
  return out
}

/**
 * Задевает ли прямоугольник линию эллипса. Эллипс выпуклый: прямоугольник целиком
 * внутри, если внутри все четыре угла; целиком снаружи, если снаружи его ближайшая к
 * центру точка (в осях, где эллипс — единичный круг).
 */
function rectTouchesEllipse(s, r) {
  const { rx, ry } = radii(s)
  if (!(rx > 0) || !(ry > 0)) return false
  const inside = (x, y) => ((x - s.cx) / rx) ** 2 + ((y - s.cy) / ry) ** 2 <= 1
  const corners = [
    [r.x1, r.y1],
    [r.x2, r.y1],
    [r.x2, r.y2],
    [r.x1, r.y2],
  ]
  if (corners.every(([x, y]) => inside(x, y))) return false
  const near = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  return inside(near(s.cx, r.x1, r.x2), near(s.cy, r.y1, r.y2))
}

/**
 * Задевает ли прямоугольник `{ x1, y1, x2, y2 }` ЛИНИЮ фигуры, а не её площадь: для
 * хит-теста контурных фигур, у которых пустое нутро не должно ловить ни клик, ни рамку.
 * Отрезки контура — по Лиангу — Барски, эллипс — точно. У подписи контура нет.
 */
export function shapeTouchesRect(s, r) {
  if (!s) return false
  if (s.type === 'circle') return rectTouchesEllipse(s, r)
  return contourSegments(s).some(([a, b]) => segmentHitsRect(a, b, r))
}

/**
 * bbox НАБОРА фигур (и портов, если переданы) — `null`, если считать нечего. Один
 * источник для кропа габарита символа и для центра трансформаций выделения.
 */
export function shapesBounds(shapes, ports = []) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const acc = (x, y) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const s of shapes || []) {
    const b = shapeBounds(s)
    if (!b) continue
    acc(b.x, b.y)
    acc(b.x + b.w, b.y + b.h)
  }
  for (const p of ports || []) acc(p.x, p.y)
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
