// Всё про визуал провода: дефолты модели, роутер, z-полоса, стиль из tms и ручки
// выделенного. Конфиг применяется и при рисовании из порта (defaultLink), и при
// восстановлении из SVG/JSON — на дефолтах JointJS провод выглядел бы иначе.

import { dia, routers, linkTools } from '@joint/core'
import { LINK_META_FIELDS } from '../constants/ids'
import { RANGE_FILL_CLASS, cssColor } from '../constants/animation'
import { ARROW_KINDS, WIRE_STROKE_MAX, WIRE_STROKE_MIN } from '../constants/wire'

const { Directions } = routers.rightAngle

/**
 * Сторона подхода к порту, который лежит ВНУТРИ тела символа (слот шины стоит в
 * середине толщины). Дефолт роутера — ближайшая сторона bbox, а у слота в середине
 * тонкого тела top и bottom равноудалены; здесь возвращается сторона, с которой
 * провод реально идёт, поэтому к шине подключаются и сверху, и снизу.
 *
 * Ось перпендикулярна длинной стороне тела: у шины вход всегда вертикальный. Для тела
 * без вытянутости (точка соединения) — по преобладающей дельте.
 *
 * null = порт на границе тела (обычный символ) → направление за роутером.
 */
/** Точка СТРОГО внутри bbox (границы не считаются): порт в теле, а не на контуре. */
export function isInsideBBox(point, bbox) {
  if (!point || !bbox) return false
  return (
    point.x > bbox.x &&
    point.x < bbox.x + bbox.width &&
    point.y > bbox.y &&
    point.y < bbox.y + bbox.height
  )
}

export function insideApproachDirection(anchor, bbox, from) {
  if (!anchor || !bbox || !from) return null
  if (!isInsideBBox(anchor, bbox)) return null
  const dx = from.x - anchor.x
  const dy = from.y - anchor.y
  const vertical =
    bbox.width > bbox.height
      ? true
      : bbox.height > bbox.width
        ? false
        : Math.abs(dy) >= Math.abs(dx)
  if (vertical) return dy < 0 ? Directions.TOP : Directions.BOTTOM
  return dx < 0 ? Directions.LEFT : Directions.RIGHT
}

/**
 * `sourceDirection`/`targetDirection` для концов на портах внутри тела. «Откуда идёт
 * провод» — ближайший ручной излом, а без изломов противоположный конец.
 */
export function rightAngleDirections(vertices, linkView) {
  const out = {}
  if (!linkView) return out
  const list = Array.isArray(vertices) ? vertices : []
  const ends = [
    [
      'sourceDirection',
      linkView.sourceView,
      linkView.sourceAnchor,
      list[0] || linkView.targetAnchor,
    ],
    [
      'targetDirection',
      linkView.targetView,
      linkView.targetAnchor,
      list[list.length - 1] || linkView.sourceAnchor,
    ],
  ]
  for (const [key, view, anchor, from] of ends) {
    if (!view?.model?.isElement?.()) continue
    const dir = insideApproachDirection(anchor, view.model.getBBox(), from)
    if (dir) out[key] = dir
  }
  return out
}

/**
 * rightAngle со снапом маршрута к сетке (базовый ставит соединительный сегмент по
 * середине промежутка, между клетками). Ортогональность сохраняется — соседние точки
 * делят координату и снапятся одинаково; концы на портах не двигаются.
 */
export function gridRightAngleRouter(vertices, args, linkView) {
  const g = linkView?.paper?.options?.gridSize || 10
  const route = routers.rightAngle.call(
    this,
    vertices,
    { ...args, ...rightAngleDirections(vertices, linkView) },
    linkView
  )
  return route.map((p) => ({ x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }))
}

export const LINK_DEFAULTS = {
  // anchor-aware ортогональный роутер: в отличие от manhattan не зигзагит при
  // выходе из порта в «неудобную» сторону. useVertices обязателен — без него
  // rightAngle игнорирует ручные изломы и хэндлы висят в стороне от линии.
  router: {
    name: 'gridRightAngle',
    args: { margin: 5, useVertices: true },
  },
  // «Горб» на пересечении — стандарт электросхем: перекрещивающиеся провода должны
  // отличаться от соединённых.
  connector: { name: 'jumpover', args: { size: 6, type: 'arc' } },
  attrs: {
    line: {
      stroke: '#000',
      strokeWidth: 2,
      // По умолчанию наконечников нет — их включает настройка провода
      // (`arrowStart`/`arrowEnd`, см. linkStyleAttrs).
      targetMarker: { type: 'none' },
      sourceMarker: { type: 'none' },
    },
  },
}

/**
 * Дефолтный вид провода — единый источник для полей инспектора и для решения «писать
 * ли значение в meta» (дефолты в `tms` не пишутся). Цвет шестизначный: короткую форму
 * `#000` из `attrs.line` `<input type="color">` не понимает.
 */
export const WIRE_STYLE_DEFAULTS = {
  strokeWidth: LINK_DEFAULTS.attrs.line.strokeWidth,
  strokeColor: '#000000',
  arrowStart: null,
  arrowEnd: null,
}

/** Значение равно дефолту. `undefined` («разные» у мульти-выделения) — нет. */
export function isDefaultWireValue(key, value) {
  if (value === undefined) return false
  if (key === 'strokeColor') {
    return value === WIRE_STYLE_DEFAULTS.strokeColor || value === LINK_DEFAULTS.attrs.line.stroke
  }
  return value === WIRE_STYLE_DEFAULTS[key]
}

/**
 * Чужой/произвольный вид провода → только годные поля. Одна проверка на оба входа
 * «липких» настроек: правку из инспектора и чтение меты проекта.
 */
export function normalizeWireStyle(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  const width = Number(src.strokeWidth)
  if (Number.isFinite(width) && width >= WIRE_STROKE_MIN && width <= WIRE_STROKE_MAX) {
    out.strokeWidth = width
  }
  const color = cssColor(src.strokeColor)
  if (color) out.strokeColor = color
  for (const key of ['arrowStart', 'arrowEnd']) {
    if (ARROW_KINDS.includes(src[key])) out[key] = src[key]
  }
  return out
}

/**
 * Конец провода «на холсте»: не привязка к ячейке, а точка с координатами. Единый
 * предикат для выделения, маркера конца, экспорта и загрузчика — конец без координат
 * свободным не считается (точку рисовать негде).
 */
export function isFreeEnd(end) {
  return !end?.id && Number.isFinite(end?.x) && Number.isFinite(end?.y)
}

/** Координаты свободного конца либо `null` (привязка к ячейке / мусор). */
export function endPoint(end) {
  return isFreeEnd(end) ? { x: end.x, y: end.y } : null
}

/**
 * Полоса z проводов — ниже символов (у тех дно 0). Внутри полосы порядок значим:
 * `jumpover` рисует мостик на том, кто в коллекции позже, то есть больший z =
 * «этот провод сверху».
 *
 * LINK_Z — дно полосы и дефолт нового провода. Значения раздаёт перенумерация
 * (utils/zOrder), а не `toBack()`: тот даёт `min(z)-1`, и z дрейфит на каждом reinject.
 */
export const LINK_Z = -1000
/** Потолок полосы проводов: 101 целый уровень — больше на схеме не нужно. */
export const LINK_Z_TOP = -900
export const LINK_Z_BOUNDS = { min: LINK_Z, max: LINK_Z_TOP }

/**
 * z провода в полосе: значение из неё возвращается как есть (reinject не двигает
 * заданный порядок), остальное едет на дно. Не кламп к ближайшей границе — авто-z от
 * JointJS прижался бы к потолку, и новый провод лёг бы поверх всех.
 */
export function normalizeLinkZ(z) {
  if (!Number.isFinite(z) || z < LINK_Z || z > LINK_Z_TOP) return LINK_Z
  return z
}

/**
 * Длина и полуширина наконечника — пропорционально толщине линии. Длина РАВНА
 * полуширине: это раствор 90° (по 45° на сторону) — «тупой» наконечник, как на
 * присланных схемах. Оба вида строятся из одной пары, поэтому угол у стрелки-линий и у
 * треугольника одинаков по построению, а не «на глаз».
 */
export function arrowSize(strokeWidth) {
  const w = Number(strokeWidth)
  const base = Number.isFinite(w) && w > 0 ? w : LINK_DEFAULTS.attrs.line.strokeWidth
  const side = base * 2.5
  return { len: side, half: side }
}

/**
 * Геометрия наконечника в системе маркера: начало в точке конца линии, ось X смотрит
 * В точку соединения. `solid` — замкнутый треугольник (заливается цветом линии),
 * `open` — две линии (незамкнутая «галочка», красится обводкой). Раствор у обоих
 * одинаковый — 90°, см. arrowSize.
 *
 * Одна функция на холст и экспорт: JointJS рисует `d` как маркер линка, exporter — тем
 * же путём в группе провода.
 */
export function arrowPath(kind, strokeWidth) {
  const { len, half } = arrowSize(strokeWidth)
  if (kind === 'solid') return `M 0 0 L ${len} ${half} L ${len} ${-half} Z`
  if (kind === 'open') return `M ${len} ${half} L 0 0 L ${len} ${-half}`
  return null
}

/**
 * Наконечник для экспортного SVG — элементом внутри группы провода, а не `<marker>` в
 * `<defs>`: до маркера не достаёт CSS анимаций (обесточивание, цвет диапазона), и
 * наконечник остался бы цветным на серой линии.
 *
 * `tms-range-fill` на треугольнике — тот же opt-in, что у тела шины: заливку красят
 * только помеченные элементы.
 *
 * @param {'solid'|'open'} kind
 * @param {{x: number, y: number}} point — конец линии
 * @param {number} angle — куда смотрит наконечник (градусы, ось X)
 */
export function arrowExportSvg(kind, point, angle, strokeWidth, color) {
  const d = arrowPath(kind, strokeWidth)
  if (!d || !point) return ''
  const transform = `translate(${point.x} ${point.y}) rotate(${angle})`
  const paint =
    kind === 'solid'
      ? `class="${RANGE_FILL_CLASS}" fill="${color}" stroke="none"`
      : `fill="none" stroke="${color}" stroke-width="${strokeWidth ?? 2}"`
  return `<path d="${d}" transform="${transform}" ${paint}/>`
}

/** Точка свободного конца для экспортного SVG — тем же приёмом, что наконечник. */
export function dotExportSvg(point, strokeWidth, color) {
  if (!point) return ''
  return (
    `<circle class="${RANGE_FILL_CLASS}" cx="${point.x}" cy="${point.y}" ` +
    `r="${dotRadius(strokeWidth)}" fill="${color}" stroke="none"/>`
  )
}

/**
 * JointJS-описание маркера конца, `null` — наконечник не задан. Инспектор ставит
 * маркеры точечным `link.attr('line/sourceMarker', …)`: замена всего `attrs` снесла бы
 * `wrapper` (hit-area).
 */
export function arrowMarker(kind, tms) {
  const d = arrowPath(kind, tms?.strokeWidth)
  if (!d) return null
  const color = tms?.strokeColor || LINK_DEFAULTS.attrs.line.stroke
  if (kind === 'solid') return { type: 'path', d, fill: color, stroke: 'none' }
  return { type: 'path', d, fill: 'none', stroke: color, strokeWidth: tms?.strokeWidth ?? 2 }
}

/** Радиус точки на свободном конце — от толщины линии, как раствор наконечника. */
function dotRadius(strokeWidth) {
  return arrowSize(strokeWidth).len / 2
}

/**
 * Маркер свободного конца: провод, законченный на холсте, помечается точкой.
 *
 * Точка не хранится в модели — выводится из привязки конца, поэтому в `data-tms-meta`
 * и в инспекторе её нет. Выбранный автором наконечник приоритетнее точки.
 */
function endMarker(kind, tms, endRef) {
  const arrow = arrowMarker(kind, tms)
  if (arrow) return arrow
  // Вызывающий без данных о концах (`undefined`) получает пустой маркер: точку ставим
  // только там, где конец точно свободен.
  if (!isFreeEnd(endRef)) return null
  return {
    type: 'circle',
    r: dotRadius(tms?.strokeWidth),
    fill: tms?.strokeColor || LINK_DEFAULTS.attrs.line.stroke,
    stroke: 'none',
  }
}

/**
 * tms-стиль (толщина/цвет) → `attrs.line`. Источник правды — tms, но рисует JointJS по
 * attrs, поэтому стиль применяется при КАЖДОМ создании модели (paste, load). null =
 * стиль дефолтный. Всегда новый объект: `LINK_DEFAULTS.attrs` общий на все провода.
 */
export function linkStyleAttrs(tms, source, target) {
  const lineAttrs = {}
  for (const f of LINK_META_FIELDS) {
    const v = tms?.[f.key]
    if (f.attr && v !== undefined) lineAttrs[f.attr] = v
  }
  // Маркеры обоих концов одинаковы: `marker-start` ориентируется по направлению пути,
  // а `target-marker` JointJS отдаёт с `rotate(180)`, поэтому внутрь линии у обоих
  // смотрит +X. Зеркальный путь для конца увёл бы наконечник за точку соединения.
  const start = endMarker(tms?.arrowStart, tms, source)
  const end = endMarker(tms?.arrowEnd, tms, target)
  if (start) lineAttrs.sourceMarker = start
  if (end) lineAttrs.targetMarker = end
  if (!Object.keys(lineAttrs).length) return null
  return { line: { ...LINK_DEFAULTS.attrs.line, ...lineAttrs } }
}

/**
 * Маркеры концов ЖИВОГО линка → в attrs, точечным `attr()` (замена всего `attrs`
 * снесла бы `wrapper`). Зовётся при смене наконечника или стиля и на перецепке конца:
 * точка свободного конца появляется и исчезает вместе с привязкой.
 */
export function syncLinkEndMarkers(link) {
  if (!link?.attr) return
  const tms = link.get('tms') || {}
  const source = endMarker(tms.arrowStart, tms, link.get('source'))
  const target = endMarker(tms.arrowEnd, tms, link.get('target'))
  link.attr('line/sourceMarker', source || { type: 'none' })
  link.attr('line/targetMarker', target || { type: 'none' })
}

// Ручки концов: кружок размером с порт, в слое инструментов ПОВЕРХ magnet'ов — иначе
// перетаскивание конца читалось бы как рисование нового провода.
// Белая заливка + АМБЕР-обводка: форма как у порта, но свой цвет (cyan занят ручками
// масштаба, чёрный — портами).
const HANDLE_STROKE = '#f59e0b' // amber-500
const ENDPOINT_HANDLE_ATTRS = {
  r: 3,
  fill: '#ffffff',
  stroke: HANDLE_STROKE,
  'stroke-width': 1,
  cursor: 'move',
}
/**
 * Позиция ручки конца. JointJS ставит её на КОНЕЦ ПУТИ, а у шины путь заканчивается на
 * границе тела (defaultConnectionPoint в canvasPaper), тогда как соединение — слот в
 * середине толщины. Поэтому у концов, чей anchor внутри тела, ручка садится в anchor.
 * Угол не считаем: ручка круглая.
 */
function endpointHandleUpdate(base) {
  return function update() {
    const view = this.relatedView
    const isSource = this.arrowheadType === 'source'
    const anchor = isSource ? view?.sourceAnchor : view?.targetAnchor
    const endView = isSource ? view?.sourceView : view?.targetView
    const bbox = endView?.model?.isElement?.() ? endView.model.getBBox() : null
    if (anchor && isInsideBBox(anchor, bbox)) {
      this.vel.attr('transform', `translate(${anchor.x} ${anchor.y})`)
      return this
    }
    return base.prototype.update.call(this)
  }
}

const SourceEndpointHandle = linkTools.SourceArrowhead.extend({
  tagName: 'circle',
  attributes: ENDPOINT_HANDLE_ATTRS,
  update: endpointHandleUpdate(linkTools.SourceArrowhead),
})
const TargetEndpointHandle = linkTools.TargetArrowhead.extend({
  tagName: 'circle',
  attributes: ENDPOINT_HANDLE_ATTRS,
  update: endpointHandleUpdate(linkTools.TargetArrowhead),
})
// Ручка излома: дефолтный r=6 ужимаем до размера порта, вид — как у ручек концов.
const VertexHandle = linkTools.Vertices.VertexHandle.extend({
  attributes: {
    r: 3,
    fill: '#ffffff',
    stroke: HANDLE_STROKE,
    'stroke-width': 1,
    cursor: 'move',
  },
})

/**
 * Ручки выделенного провода: концы (переанкеринг к другому порту) + изломы.
 * Снап изломов к сетке делает change:vertices-хендлер в CanvasPane — иначе хэндл
 * отрывается от линии. redundancyRemoval убирает излом, легший на прямую.
 * Vertices ПЕРВЫМ: его vertex-adding обёртка ловит клик по всей линии и должна
 * лежать НИЖЕ эндпоинт-ручек, иначе клик у конца рисует излом вместо перемещения.
 */
export function attachLinkTools(linkView) {
  linkView.addTools(
    new dia.ToolsView({
      tools: [
        new linkTools.Vertices({
          snapRadius: 10,
          redundancyRemoval: true,
          handleClass: VertexHandle,
        }),
        new SourceEndpointHandle(),
        new TargetEndpointHandle(),
      ],
    })
  )
}
