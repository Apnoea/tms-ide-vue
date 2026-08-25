/**
 * Модель редактора символов → артефакты проекта:
 *   • serializeSvg(shapes, meta) → shape.svg (viewBox 0 0 W H)
 *   • buildStencilJson(meta, ports) → stencil.json
 *
 * Чистые функции: модель своя (примитивы + порты), координаты уже в системе
 * стенсила и снапнуты к сетке — здесь только рендер.
 *
 * Примитивы: rect, line, circle, polyline, text. Анимация состояния — фигуры
 * группируются по state в <g data-anim-suffix=".<ключ>">, оттуда же строится
 * animationTemplate (ключи булевы или произвольные, см. meta.stateMode).
 *
 * `text` участвует в видимости по состоянию (группа `data-anim-suffix`), но не в
 * перекраске: CSS исключает `<text>` селектором `*:not(text)`.
 */

import { ATTR_SUFFIX, STENCIL_ID_RE } from '../constants/ids'
import { STATE_FILL_CLASS, normalizeStateColor } from '../constants/animation'
import { escapeXml } from './xml'
import { measureTextWidth, normalizeFont } from './textMetrics'

// Числа в атрибутах — без хвостовых нулей и float-мусора (модель снапнута к
// сетке, но масштаб/дробный шаг могут дать 12.5 → оставляем как есть, а 12.0 → 12).
function num(v) {
  return Number.parseFloat(Number(v).toFixed(3)).toString()
}

// Обводка есть у всех примитивов; fill — только у замкнутых (rect/circle/polyline),
// по умолчанию none (SCADA-символы — контурные). У линии заливки нет.
function strokeAttrs(shape) {
  return `stroke="${shape.stroke || '#000'}" stroke-width="${num(shape.strokeWidth ?? 2)}"`
}
function fillAttr(shape) {
  return `fill="${shape.fill || 'none'}"`
}

// Заливаемая фигура — замкнутый примитив: у него заливка по состоянию имеет
// смысл (лампа/индикатор), даже если базово fill=none.
export function isFillableShape(shape) {
  if (!shape) return false
  if (shape.type === 'rect' || shape.type === 'circle') return true
  if (shape.type === 'polyline') return !!shape.closed
  return false
}
// Класс заливки — заливаемым примитивам и только у stateful-символа: иначе он
// мёртвый шум в каждом статичном shape.svg.
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

// Подпись: кегль по умолчанию и якорь для фигуры БЕЗ поля `align` (такие
// центрируются — так нарисованы встроенные символы). Шрифт — из whitelist'а
// utils/textMetrics, тем же семейством идёт замер, иначе bbox разойдётся с рендером.
export const TEXT_SHAPE_SIZE = 10
const TEXT_SHAPE_ANCHOR = 'middle'

/**
 * Межстрочный шаг подписи, в долях кегля. Константа, а не поле фигуры: одно значение
 * держит подписи одинаковыми у всех авторов, а лишнее поле пришлось бы тащить через
 * round-trip и валидацию.
 */
export const TEXT_LINE_HEIGHT = 1.2

/**
 * Строки подписи. Многострочность живёт в самом `text` как `\n` — новых полей в
 * модели и в `data-tms-meta` не появляется. Пустая строка внутри значима (автор
 * оставил интервал), поэтому не отбрасываем.
 */
export function textLines(shape) {
  return String(shape?.text ?? '').split('\n')
}

// Выравнивание подписи = ЯКОРЬ роста (как align у cell_text): точка x,y стоит на
// месте, а текст растёт от неё. Новую подпись оба редактора создают с `left` — клик
// ставит начало текста; без поля работает дефолт выше (центр).
const TEXT_ANCHORS = { left: 'start', center: 'middle', right: 'end' }
export function textAnchorOf(shape) {
  return TEXT_ANCHORS[shape?.align] || TEXT_SHAPE_ANCHOR
}

// Инверсия TEXT_ANCHORS: `text-anchor` из файла → поле `align` модели. Без чтения
// выравнивание терялось бы на пересохранении символа — подпись прыгала бы в центр.
const TEXT_ALIGN_BY_ANCHOR = { start: 'left', middle: 'center', end: 'right' }
function textAlignOf(el) {
  return TEXT_ALIGN_BY_ANCHOR[el.getAttribute('text-anchor')] || null
}

/**
 * Габарит подписи: ширину меряем canvas-метрикой (шрифт задаёт размер, рамки у
 * текста нет), высоту — по числу строк с запасом на descender'ы.
 * `x`/`y` — точка привязки: baseline ПЕРВОЙ строки по y, по x — согласно якорю (см.
 * textAnchorOf). Блок растёт вниз, поэтому у уже расставленных подписей место не
 * меняется, когда автор дописывает строку.
 */
export function textShapeBox(shape) {
  const size = shape.fontSize ?? TEXT_SHAPE_SIZE
  const lines = textLines(shape)
  // Замер недоступен (нет canvas — jsdom/воркер) → оценка по числу символов:
  // приблизительный габарит полезнее нулевого.
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

// Опциональное скругление (тумблер в редакторе): у линии/ломаной — круглые торцы
// и стыки, у прямоугольника — скруглённые углы (rx). У круга скруглять нечего.
function roundingAttrs(shape) {
  if (!shape.rounded) return ''
  if (shape.type === 'rect') return ` rx="${num(ROUND_RX)}"`
  if (shape.type === 'line') return ' stroke-linecap="round"'
  if (shape.type === 'polyline') return ' stroke-linecap="round" stroke-linejoin="round"'
  return ''
}

/**
 * Одна фигура → SVG-строка. Экспортируется, потому что тем же генератором рисуются
 * фигуры-примитивы на холсте (см. stencils/shapeElement): холст, `view.svg` и
 * редактор символов обязаны показывать одно и то же, а разойтись они могут только
 * если рисовать их разным кодом.
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
      // Круг — частный случай эллипса (rx === ry), и тогда пишем прежний <circle>:
      // рукописные символы и уже выгруженные shape.svg не переписываются.
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
      const open =
        `<text x="${num(shape.x)}" y="${num(shape.y)}" text-anchor="${textAnchorOf(shape)}" ` +
        `font-size="${num(size)}" font-family="${normalizeFont(shape.fontFamily)}"${weight} ` +
        `fill="${shape.stroke || '#000'}">`
      // Одна строка — прежняя разметка: уже выгруженные shape.svg не переписываются
      // (иначе дифф «дышал» бы на каждом пересохранении символа).
      if (lines.length < 2) return `${open}${escapeXml(shape.text || '')}</text>`
      // Несколько — по tspan'у на строку: переносы SVG сам не делает. У каждого свой
      // x (без него строка продолжила бы предыдущую) и dy — шаг вниз. text-anchor
      // стоит на <text> и наследуется, поэтому якорь роста тот же, что у одной строки.
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
 * ЕДИНЫЙ обход опорных точек фигуры: `fn(x, y)` → `[x, y]`. На нём стоят все
 * преобразования (перенос, масштаб, поворот, отражение) — иначе каждое повторяло бы
 * switch по типам, и они разъезжались бы при добавлении примитива.
 *
 * Прямоугольник и эллипс заданы не точками, а размерами, поэтому им отображаются два
 * угла (у эллипса — центр и «радиус-угол»), а размеры пересчитываются по результату
 * через abs: так поворот на 90° сам меняет стороны местами, а отражение не даёт
 * отрицательной ширины.
 *
 * Подпись переносится точкой привязки — глифы остаются горизонтальными: угла у
 * фигуры-текста нет, а вертикальный текст в мнемосхемах не нужен.
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
 * Масштаб фигуры относительно НАЧАЛА КООРДИНАТ (фигуры-примитивы холста хранятся
 * прижатыми к 0,0 — см. shapeElement.placeShape). Нужен ресайзу фигуры за ручки:
 * тянут её габарит, а геометрия должна поехать в те же пропорции. Подпись не
 * масштабируется — её габарит задаёт шрифт (mapShapePoints двигает только привязку).
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
 * У линии и ломаной порядок вершин на картинку не влияет (реверс рисует ту же
 * линию), поэтому точки сравниваются как множество; у прямоугольника и эллипса
 * геометрия уже нормализована (mapShapePoints пересчитывает размеры по abs), и
 * сравнивать можно как есть.
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
 * Доступен ли поворот выделения: у круга и квадрата он ничего не меняет, у
 * одиночной подписи — только переносит точку привязки (глифы остаются
 * горизонтальными), и кнопка обещала бы разворот, которого не будет.
 */
export function canRotateShapes(shapes) {
  const list = (shapes || []).filter(Boolean)
  if (!list.length) return false
  if (list.length === 1 && list[0].type === 'text') return false
  return transformChangesView(list, (s, center) => rotateShape90(s, center, 1))
}

/**
 * Доступно ли отражение выделения по оси: симметричным фигурам (прямоугольник,
 * эллипс, ортогональная линия) оно ничего не даёт. У одиночной подписи зеркалить
 * нечего, кроме якоря роста, — а его меняет только горизонтальная ось.
 */
export function canFlipShapes(shapes, axis) {
  const list = (shapes || []).filter(Boolean)
  if (!list.length) return false
  // Одиночную подпись НЕ отражаем: зеркальный текст не нужен, а якорь роста меняют
  // полем `align` в инспекторе. Поворот ей доступен (через `angle` ячейки), отражение —
  // нет. В составе пачки подпись отражается вместе с остальными фигурами, и там
  // `flipShape` инвертирует её якорь сам.
  if (list.length === 1 && list[0].type === 'text') return false
  return transformChangesView(list, (s, center) => flipShape(s, center, axis))
}

/**
 * bbox одной фигуры: общий источник для cropToContent и хит-теста лассо — иначе
 * рамка ловила бы не то, что попадёт в границы символа. Обводка в габарит не
 * входит, у подписи его задаёт шрифт (textShapeBox).
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
 * bbox НАБОРА фигур (и портов, если переданы) — `null`, если считать нечего. Один
 * источник для кропа габарита символа и для трансформаций выделения: центр поворота
 * обязан совпадать с той рамкой, по которой обрезается символ.
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

/**
 * Обрезка пустых полей: считаем bbox фигур + портов, расширяем до кратных grid
 * границ (min — вниз, max — вверх, чтобы контент не срезался), сдвигаем всё в
 * (0,0). Итоговый стенсил = ровно контент, размеры кратны grid. Обводку в bbox
 * не учитываем — как в рукописных стенсилах (rect x=0 со stroke срезается вьюбоксом).
 *
 * @returns {{shapes:Array, ports:Array, width:number, height:number}}
 */
export function cropToContent(shapes, ports = [], grid = 10) {
  if (!shapes?.length) return { shapes: shapes || [], ports: ports || [], width: 0, height: 0 }
  const bounds = shapesBounds(shapes, ports)
  if (!bounds) return { shapes, ports, width: 0, height: 0 }
  const minX = bounds.x
  const minY = bounds.y
  const maxX = bounds.x + bounds.w
  const maxY = bounds.y + bounds.h

  const x0 = Math.floor(minX / grid) * grid
  const y0 = Math.floor(minY / grid) * grid
  const x1 = Math.ceil(maxX / grid) * grid
  const y1 = Math.ceil(maxY / grid) * grid
  const dx = -x0
  const dy = -y0
  return {
    shapes: shapes.map((s) => translateShape(s, dx, dy)),
    ports: ports.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    width: Math.max(grid, x1 - x0),
    height: Math.max(grid, y1 - y0),
  }
}

// Тело группы: сериализованные фигуры с отступом (пустая строка, если фигур нет).
// markFill пробрасываем в serializeShape — метку заливки ставим лишь у stateful.
function groupBody(shapes, markFill) {
  return (shapes || [])
    .map((s) => serializeShape(s, markFill))
    .filter(Boolean)
    .map((el) => `    ${el}`)
    .join('\n')
}

// Порядок и набор состояний-групп. Булев режим — фикс. `true`,`false` (частный
// случай); режим значения — ключи из meta.states (порядок как задал автор).
function stateKeys(meta) {
  return meta?.stateMode === 'value' ? (meta.states || []).map((s) => s.key) : ['true', 'false']
}

/**
 * Модель → строка shape.svg. viewBox/width/height берём из meta (кратны шагу сетки).
 * Фигуры оборачиваем в `<g>` — единый формат с рукописными стенсилами (у них
 * всё в группе); на группу состояния вешается data-anim-suffix.
 */
export function serializeSvg(shapes, meta) {
  const w = num(meta.width)
  const h = num(meta.height)
  const all = shapes || []
  // Метку tms-state-fill ставим только у stateful-стенсилов (иначе перекрашивать
  // по состоянию нечего — см. fillClassAttr).
  const markFill = !!meta?.stateful
  let groups
  if (meta?.stateful) {
    // Внутренняя анимация: статику — в базовую группу, каждое состояние — в свой
    // <g data-anim-suffix=".<ключ>"> (рантайм вешает animation-hidden, когда
    // значение тега не совпадает). Порядок: база → состояния (анимируемое поверх).
    // В базовую группу — статика И фигуры на НЕИЗВЕСТНОМ ключе (состояние удалили/
    // заменили, а привязка осталась): иначе такая фигура не попала бы ни в одну
    // группу и молча исчезла бы из shape.svg.
    const known = new Set(stateKeys(meta))
    const base = groupBody(
      all.filter((s) => !s.state || s.state === 'always' || !known.has(s.state)),
      markFill
    )
    // Пустую базовую группу не пишем: у символа, где ВСЕ фигуры привязаны к состояниям
    // (cell_alr виден только при `true`), она появлялась мусорной строкой при каждом
    // пересохранении. Разбору она не нужна — collectShapes обходит дерево рекурсивно.
    groups = base ? `  <g>\n${base}\n  </g>\n` : ''
    for (const key of stateKeys(meta)) {
      const body = groupBody(
        all.filter((s) => s.state === key),
        markFill
      )
      if (body) groups += `  <g ${ATTR_SUFFIX}=".${key}">\n${body}\n  </g>\n`
    }
  } else {
    const body = groupBody(all, markFill)
    groups = body ? `  <g>\n${body}\n  </g>\n` : ''
  }
  // Без XML-декларации: `definitions/<id>/shape.svg` — файл под git, и его пишут ДВА
  // пути (сохранение из редактора и запись при импорте .zip). Второй берёт разметку из
  // реестра, где она прошла sanitizeSvgMarkup — а тот сериализует только
  // `documentElement`, то есть декларацию теряет. С декларацией файл «дышал» в гите:
  // сохранил из редактора — строка появилась, импортировал проект — исчезла.
  // Читателям она не нужна: glob тянет файл как текст, дальше DOMParser с типом
  // image/svg+xml, а UTF-8 — дефолт XML. В экспортном `view.svg` декларация остаётся:
  // он отдаётся рантайму отдельным документом и в git не попадает.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n` +
    groups +
    '</svg>\n'
  )
}

// Атрибуты обводки/заливки фигуры из SVG-элемента (инверсия strokeAttrs/fillAttr).
function readStroke(el) {
  return {
    stroke: el.getAttribute('stroke') || '#000',
    strokeWidth: Number.parseFloat(el.getAttribute('stroke-width')) || 2,
  }
}

// Инверсия roundingAttrs: rect с rx>0 или линия/ломаная с круглыми торцами/стыками.
function isRounded(el) {
  if (el.tagName.toLowerCase() === 'rect') return Number.parseFloat(el.getAttribute('rx')) > 0
  return (
    el.getAttribute('stroke-linecap') === 'round' || el.getAttribute('stroke-linejoin') === 'round'
  )
}

/**
 * Инверсия многострочного рендера: строки собираются из `<tspan>`, а `<text>` без них
 * читается целиком (рукописные символы и старые shape.svg). Каждая строка триммится —
 * в файле tspan'ы могут стоять с отступами; пустой tspan даёт пустую строку, потому
 * что автор явно оставил интервал.
 */
function readTextLines(el) {
  const tspans = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'tspan')
  if (!tspans.length) return (el.textContent || '').trim()
  return tspans.map((t) => (t.textContent || '').trim()).join('\n')
}

/**
 * Разбор одного элемента. Возвращает null, если у фигуры нет ОБЯЗАТЕЛЬНЫХ размеров:
 * чужой `<rect x="0" y="0"/>` иначе дал бы `w: NaN`, и при пересохранении символа в
 * файл уехало бы `width="NaN"` — символ ломается молча. Координаты необязательны
 * (по SVG их дефолт — 0), поэтому у них fallback, а не отбраковка.
 */
function elementToShape(el) {
  const n = (a, fallback = 0) => {
    const v = Number.parseFloat(el.getAttribute(a))
    return Number.isFinite(v) ? v : fallback
  }
  // Размер, без которого фигуры не существует: NaN/отсутствие → null.
  const size = (a) => {
    const v = Number.parseFloat(el.getAttribute(a))
    return Number.isFinite(v) && v > 0 ? v : null
  }
  const fill = el.getAttribute('fill') || 'none'
  switch (el.tagName.toLowerCase()) {
    case 'rect': {
      const w = size('width')
      const h = size('height')
      if (w === null || h === null) return null
      return { type: 'rect', x: n('x'), y: n('y'), w, h, fill, ...readStroke(el) }
    }
    case 'line':
      return { type: 'line', x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2'), ...readStroke(el) }
    case 'circle': {
      // Единый тип для круга и эллипса: круг = равные радиусы.
      const r = size('r')
      if (r === null) return null
      return { type: 'circle', cx: n('cx'), cy: n('cy'), rx: r, ry: r, fill, ...readStroke(el) }
    }
    case 'ellipse': {
      const rx = size('rx')
      const ry = size('ry')
      if (rx === null || ry === null) return null
      return { type: 'circle', cx: n('cx'), cy: n('cy'), rx, ry, fill, ...readStroke(el) }
    }
    case 'polyline':
    case 'polygon': {
      const points = (el.getAttribute('points') || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p.split(',').map(Number))
      const shape = { type: 'polyline', points, fill, ...readStroke(el) }
      if (el.tagName.toLowerCase() === 'polygon') shape.closed = true
      return shape
    }
    case 'text': {
      // Цвет подписи лежит в fill (у текста нет обводки), поэтому кладём его в
      // `stroke` модели — редактор правит цвет фигуры одним полем для всех типов.
      const align = textAlignOf(el)
      return {
        type: 'text',
        x: n('x'),
        y: n('y'),
        ...(align ? { align } : {}),
        text: readTextLines(el),
        fontSize: size('font-size') ?? TEXT_SHAPE_SIZE,
        // Чужой shape.svg мог принести любой шрифт — берём только из whitelist,
        // иначе замер (canvas) считал бы одним, а панель рисовала другим.
        fontFamily: normalizeFont(el.getAttribute('font-family')),
        bold: el.getAttribute('font-weight') === 'bold',
        stroke: fill === 'none' ? '#000' : fill,
        strokeWidth: 2,
        fill: 'none',
      }
    }
    default:
      return null
  }
}

// Собирает фигуры рекурсивно: заходит внутрь `<g>` (наш формат и рукописные
// стенсилы держат примитивы в группе). Порядок — DFS в порядке документа.
function collectShapes(parent, out, state = 'always') {
  for (const el of Array.from(parent.children)) {
    if (el.tagName.toLowerCase() === 'g') {
      // Суффикс `.<ключ>` → state фигуры (булев `.true`/`.false` или value-ключ
      // `.on`/`.s1`); группа без суффикса — наследует родительское (по умолчанию
      // always). Ключ = суффикс без ведущей точки.
      const suffix = el.getAttribute(ATTR_SUFFIX)
      const childState = suffix && suffix.startsWith('.') ? suffix.slice(1) : state
      collectShapes(el, out, childState)
      continue
    }
    const shape = elementToShape(el)
    if (shape) {
      // Скругление: rect с rx, либо линия/ломаная с круглым linecap/linejoin.
      if (isRounded(el)) shape.rounded = true
      // state пишем только для непустого состояния; always — дефолт (поле не
      // заводим, чтобы статика парсилась байт-в-байт и round-trip не разъезжался).
      out.push(state === 'always' ? shape : { ...shape, state })
    }
  }
}

/**
 * Обратный парсинг shape.svg → массив примитивов модели (инверсия serializeSvg).
 * Рекурсит в `<g>`, поэтому читает и наш формат (фигуры в группе), и плоский, и
 * статические рукописные (tv2/tv3). `data-anim-suffix=".<ключ>"` на группе → state
 * фигуры (ключ = суффикс без точки); атрибуты групп (`transform`) и незнакомые
 * элементы (`path`, `text`) — пропускаются.
 */
export function parseStencilSvg(svgText) {
  if (!svgText) return []
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return []
  const out = []
  collectShapes(doc.documentElement, out)
  return out
}

/**
 * Проверка черновика перед сохранением. Чистая: uniqueness сверяем по
 * переданному списку существующих id (реестр знает caller). Возвращает массив
 * человекочитаемых проблем; пустой — можно сохранять.
 */
export function stencilDraftIssues(meta, shapes, existingIds = []) {
  const issues = []
  const id = (meta.id || '').trim()
  if (!id) issues.push('Укажите id')
  else if (!STENCIL_ID_RE.test(id)) issues.push('id: только латиница в нижнем регистре, цифры и _')
  else if (existingIds.includes(id)) issues.push(`id «${id}» уже занят`)
  if (!(meta.label || '').trim()) issues.push('Укажите название')
  if (!(meta.category || '').trim()) issues.push('Укажите категорию')
  if (!shapes?.length) issues.push('Добавьте хотя бы одну фигуру')
  // Кратность 5 = шаг сетки схемы (PORT_GRID в useStencilEditor); минимум 10.
  if (!(meta.width >= 10) || meta.width % 5 !== 0) issues.push('Ширина кратна 5')
  if (!(meta.height >= 10) || meta.height % 5 !== 0) issues.push('Высота кратна 5')
  return issues
}

// Карточка animationTemplate для состояния: элемент виден только в «своём»
// значении тега, т.е. получает animation-hidden на КАЖДОМ из чужих значений
// (hideOn). Булев режим: одно чужое значение (.true прячется на 'false'). Режим
// значения: перечисляем коды остальных состояний — на любом из них группа
// прячется, на своём (нет case) остаётся видимой. Обобщение той же механики.
function stateCard(idSuffix, tag, hideOn) {
  const list = Array.isArray(hideOn) ? hideOn : [hideOn]
  const cases = {}
  for (const v of list) cases[String(v)] = { apply: { addClass: 'animation-hidden' } }
  return {
    idSuffix,
    type: 'shape',
    bindings: [{ tag, when: { source: 'value', type: 'map', cases } }],
    detailTags: [{ tag }],
  }
}

/**
 * Наибольший номер в именах портов вида `pN`. Fallback для символов, сохранённых
 * до появления `portSeq`: продолжаем нумерацию от максимума, а не от количества
 * (порты могли удаляться, и `p{count+1}` совпал бы с живым портом).
 */
export function portSeqFrom(ports) {
  let max = 0
  for (const p of ports || []) {
    const n = Number.parseInt(String(p?.name || '').replace(/^p/, ''), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/**
 * Модель → объект stencil.json. ports включаем только непустыми — стенсил без
 * портов валиден (декор). Анимация состояния (при `stateful`) — по режиму:
 * булев (slot onoff + карточки `.true`/`.false`) либо «по значению» (slot value +
 * `states` + карточки `.<ключ>`), см. buildBooleanState/buildValueState. Иначе
 * стенсил статичен (разреженный json). Метку редактируемости НЕ пишем: по
 * умолчанию редактируем/удаляем, нередактируемые — `locked: true` в definitions.
 */
export function buildStencilJson(meta, ports, shapes = []) {
  const json = {
    id: meta.id,
    label: meta.label,
    category: meta.category,
    shapeFile: 'shape.svg',
    width: meta.width,
    height: meta.height,
  }
  // Декл-флаги пишем только когда включены (json чище; отсутствие = false).
  // `static` в редакторе не задаётся (только у встроенных text/value в их json).
  if (meta.noRotate) json.noRotate = true
  if (meta.noFlip) json.noFlip = true
  if (meta.quality) json.quality = true
  if (ports?.length) {
    json.ports = ports.map((p) => ({ name: p.name, x: p.x, y: p.y }))
    // Счётчик выданных имён — часть данных символа: без него следующая правка
    // выдала бы имя удалённого порта, и провод в другой форме сел бы на новый
    // порт. Берём максимум из счётчика и фактических имён — модель могла прийти
    // из символа, сохранённого до появления поля.
    //
    // Ноль не пишем: у символов с рукописными именами портов (`top`/`bottom`)
    // счётчик пустой, и поле-ноль появлялось в json при каждом пересохранении —
    // шум в диффе. Отсутствие поля читается как 0 (см. loadStencil).
    const seq = Math.max(meta.portSeq || 0, portSeqFrom(ports))
    if (seq) json.portSeq = seq
  }
  if (meta.stateful) {
    if (meta.stateMode === 'value') buildValueState(json, meta, shapes)
    else buildBooleanState(json, meta, shapes)
    // Цвета состояний (перекрас всего символа) — непустые, только для объявленных
    // состояний. Компактно: только контур → строка; есть заливка → объект
    // { stroke?, fill }. Заливку пишем лишь когда в стенсиле есть заливаемые фигуры
    // (иначе fill-цвет некуда применить — маркера tms-state-fill нет).
    const keys =
      meta.stateMode === 'value' ? (meta.states || []).map((s) => s.key) : ['true', 'false']
    const canFill = (shapes || []).some(isFillableShape)
    const stateColors = {}
    for (const k of keys) {
      const { stroke, fill } = normalizeStateColor(meta.stateColors?.[k])
      const useFill = canFill ? fill : ''
      if (stroke && useFill) stateColors[k] = { stroke, fill: useFill }
      else if (useFill) stateColors[k] = { fill: useFill }
      else if (stroke) stateColors[k] = stroke
    }
    if (Object.keys(stateColors).length) json.stateColors = stateColors
  }
  return json
}

// Булев режим (частный случай): слот onoff + карточки `.true`/`.false`, каждая
// прячется на противоположном значении. Пишем только при наличии таких фигур.
function buildBooleanState(json, meta, shapes) {
  const states = new Set(
    (shapes || []).map((s) => s.state).filter((st) => st === 'true' || st === 'false')
  )
  // Слот нужен и без state-фигур, если задан цвет состояния (символ реагирует на
  // тег только перекраской) — иначе тег некуда привязать и цвет ничем не драйвится.
  const hasColor = !!(meta.stateColors?.true || meta.stateColors?.false)
  if (!states.size && !hasColor) return
  const key = meta.stateSlot?.key || 'onoff'
  const tag = `{slot.${key}}`
  json.slots = [{ key, type: 'Boolean' }]
  const cards = []
  if (states.has('true')) cards.push(stateCard('.true', tag, ['false']))
  if (states.has('false')) cards.push(stateCard('.false', tag, ['true']))
  if (cards.length) json.animationTemplate = cards
}

// Режим «по значению»: слот value + список состояний (states — редакторные
// подписи/коды для round-trip, рантайм игнорит) + по карточке на каждое состояние
// С ФИГУРАМИ (прячется на кодах остальных). Слот/states пишем при любых
// объявленных состояниях (чтобы канвас мог привязать тег), карточки — только когда
// есть что анимировать. Смена кода → другой список cases, суффиксы/фигуры не трогаются.
function buildValueState(json, meta, shapes) {
  const declared = meta.states || []
  if (!declared.length) return
  const key = meta.stateSlot?.key || 'value'
  const tag = `{slot.${key}}`
  json.slots = [{ key, type: 'Value' }]
  json.states = declared.map((s) => ({ key: s.key, label: s.label || '', code: s.code ?? '' }))
  const shapeStates = new Set((shapes || []).map((s) => s.state).filter(Boolean))
  const coded = declared.filter((s) => s.code !== '' && s.code != null)
  const cards = declared
    .filter((s) => shapeStates.has(s.key))
    .map((st) =>
      stateCard(
        `.${st.key}`,
        tag,
        coded.filter((o) => o.key !== st.key).map((o) => o.code)
      )
    )
  if (cards.length) json.animationTemplate = cards
}
