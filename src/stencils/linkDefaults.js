// Всё про визуал провода: дефолты модели, роутер, z-полоса, стиль из tms и
// ручки выделенного. Конфиг нужен И при рисовании из порта (defaultLink), И при
// восстановлении из SVG/JSON — иначе загруженный провод получает дефолты JointJS
// (стрелка на конце, прямой connector) и выглядит иначе нарисованного.

import { dia, routers, linkTools } from '@joint/core'
import { LINK_META_FIELDS } from '../constants/ids'
import { RANGE_FILL_CLASS } from '../constants/animation'

const { Directions } = routers.rightAngle

/**
 * Сторона подхода к порту, который лежит ВНУТРИ тела символа (слот шины стоит в
 * середине толщины). Дефолт роутера для порта — `MAGNET_SIDE`, то есть сторона bbox,
 * ближайшая к anchor'у: у слота в середине тонкого тела top и bottom равноудалены, и
 * все провода заходили с одной стороны. Возвращаем сторону, с которой провод реально
 * идёт, — тогда к шине подключаются и сверху, и снизу.
 *
 * Ось выбираем перпендикулярно длинной стороне тела: у шины (широкая и тонкая) вход
 * всегда вертикальный, иначе провод входил бы с торца вдоль тела. Для тела без явной
 * вытянутости (точка соединения) — по преобладающей дельте, как роутер поступает с
 * концом, не привязанным к символу.
 *
 * null = порт на границе тела (обычный символ) → направление оставляем роутеру.
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
 * rightAngle со снапом маршрута к сетке: базовый ставит соединительный сегмент по
 * середине промежутка, т.е. «между клетками». Ортогональность не страдает (соседние
 * точки делят координату → снапятся одинаково), концы на портах роутер не трогает.
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
  // «Горб» на пересечении — стандарт электросхем: перекрещивающиеся провода
  // должны отличаться от соединённых (T-junction через порт).
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
 * Полоса z проводов — ниже символов (у тех дно 0), иначе линия перекрыла бы порты.
 * Внутри полосы порядок значим: `jumpover` рисует мостик на том, кто в коллекции
 * позже (она отсортирована по z), т.е. больший z = «этот провод сверху».
 *
 * LINK_Z — дно полосы и дефолт нового провода. Значения раздаёт перенумерация
 * (utils/zOrder), а не `toBack()`: тот даёт `min(z)-1`, z дрейфит на каждом
 * reinject и плодит фантомные шаги истории.
 */
export const LINK_Z = -1000
/** Потолок полосы проводов: 101 целый уровень — больше на схеме не нужно. */
export const LINK_Z_TOP = -900
export const LINK_Z_BOUNDS = { min: LINK_Z, max: LINK_Z_TOP }

/**
 * z провода в полосе: значение из неё возвращается как есть (reinject не двигает
 * заданный порядок), остальное едет на дно. Не кламп к ближайшей границе — авто-z
 * от JointJS прижался бы к потолку и новый провод оказался поверх всех.
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
 * же путём в группе провода, иначе вид разошёлся бы с `view.svg`.
 */
export function arrowPath(kind, strokeWidth, dir = 1) {
  const { len, half } = arrowSize(strokeWidth)
  const back = len * (dir < 0 ? -1 : 1)
  if (kind === 'solid') return `M 0 0 L ${back} ${half} L ${back} ${-half} Z`
  if (kind === 'open') return `M ${back} ${half} L 0 0 L ${back} ${-half}`
  return null
}

/**
 * Наконечник для экспортного SVG — элементом внутри группы провода, а не `<marker>` в
 * `<defs>`: маркер не потомок группы, и CSS анимаций (обесточивание, цвет диапазона) до
 * него не достаёт — линия посерела бы, а наконечник остался цветным.
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

/**
 * JointJS-описание маркера конца, `null` — наконечник не задан. Экспортируется, потому
 * что инспектор ставит маркеры точечным `link.attr('line/sourceMarker', …)`: замена
 * всего `attrs` снесла бы `wrapper` (hit-area) и маркеры не перерисовывались бы.
 */
export function arrowMarker(kind, tms, dir = 1) {
  const d = arrowPath(kind, tms?.strokeWidth, dir)
  if (!d) return null
  const color = tms?.strokeColor || LINK_DEFAULTS.attrs.line.stroke
  if (kind === 'solid') return { type: 'path', d, fill: color, stroke: 'none' }
  return { type: 'path', d, fill: 'none', stroke: color, strokeWidth: tms?.strokeWidth ?? 2 }
}

/**
 * tms-стиль (толщина/цвет) → `attrs.line`. Источник правды — tms, но рисует JointJS
 * по attrs, поэтому дублируем при КАЖДОМ создании модели (paste, load): иначе копия
 * выглядит дефолтной, а после экспорта «внезапно» становится толстой/цветной.
 * null = стиль дефолтный. Всегда новый объект — LINK_DEFAULTS.attrs общий на все
 * провода, мутировать нельзя.
 */
export function linkStyleAttrs(tms) {
  const lineAttrs = {}
  for (const f of LINK_META_FIELDS) {
    const v = tms?.[f.key]
    if (f.attr && v !== undefined) lineAttrs[f.attr] = v
  }
  // Оси маркеров у концов противоположны — JointJS разворачивает `sourceMarker`,
  // поэтому «тело вдоль линии внутрь» это +X у начала и −X у конца (с обратным знаком
  // остриё смотрит из точки соединения наружу).
  const start = arrowMarker(tms?.arrowStart, tms, 1)
  const end = arrowMarker(tms?.arrowEnd, tms, -1)
  if (start) lineAttrs.sourceMarker = start
  if (end) lineAttrs.targetMarker = end
  if (!Object.keys(lineAttrs).length) return null
  return { line: { ...LINK_DEFAULTS.attrs.line, ...lineAttrs } }
}

// Ручки концов: кружок размером с порт, но контрастный. Живут в слое инструментов
// ПОВЕРХ magnet'ов — иначе перетаскивание конца превращалось бы в рисование нового
// провода (magnet выигрывает).
// Белая заливка + АМБЕР-обводка: та же форма, что у порта (белый кружок), но своим
// цветом — «это ручка провода, а не точка подключения». Cyan занят ручками масштаба,
// чёрный — портами, поэтому третьей роли достался третий цвет.
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
 * границе тела (см. defaultConnectionPoint в canvasPaper: иначе провод уходил бы под
 * тело вместе с наконечником). Ручка при этом уезжала с точки соединения на край, хотя
 * соединение — это слот в СЕРЕДИНЕ толщины. Поэтому у концов, чей anchor лежит внутри
 * тела, ставим ручку в anchor; у остальных поведение штатное.
 *
 * Угол не считаем: ручка — круг, вращать нечего.
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
