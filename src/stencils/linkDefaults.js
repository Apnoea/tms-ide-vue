// Всё про визуал провода: дефолты модели, роутер, z-полоса, стиль из tms и
// ручки выделенного. Конфиг нужен И при рисовании из порта (defaultLink), И при
// восстановлении из SVG/JSON — иначе загруженный провод получает дефолты JointJS
// (стрелка на конце, прямой connector) и выглядит иначе нарисованного.

import { dia, routers, linkTools } from '@joint/core'
import { LINK_META_FIELDS } from '../constants/ids'

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
export function insideApproachDirection(anchor, bbox, from) {
  if (!anchor || !bbox || !from) return null
  const inside =
    anchor.x > bbox.x &&
    anchor.x < bbox.x + bbox.width &&
    anchor.y > bbox.y &&
    anchor.y < bbox.y + bbox.height
  if (!inside) return null
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
      // Направление на электросхеме неинформативно — стрелок нет.
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
  if (!Object.keys(lineAttrs).length) return null
  return { line: { ...LINK_DEFAULTS.attrs.line, ...lineAttrs } }
}

// Ручки концов: кружок размером с порт, но контрастный. Живут в слое инструментов
// ПОВЕРХ magnet'ов — иначе перетаскивание конца превращалось бы в рисование нового
// провода (magnet выигрывает).
const ENDPOINT_HANDLE_ATTRS = {
  r: 3,
  fill: '#f97316', // orange-500 — отличать от cyan-порта, читается как «тащи меня»
  stroke: '#ffffff',
  'stroke-width': 1,
  cursor: 'move',
}
const SourceEndpointHandle = linkTools.SourceArrowhead.extend({
  tagName: 'circle',
  attributes: ENDPOINT_HANDLE_ATTRS,
})
const TargetEndpointHandle = linkTools.TargetArrowhead.extend({
  tagName: 'circle',
  attributes: ENDPOINT_HANDLE_ATTRS,
})
// Ручка излома: дефолтный r=6 ужимаем до размера порта.
const VertexHandle = linkTools.Vertices.VertexHandle.extend({
  attributes: {
    r: 3,
    fill: '#33334f',
    stroke: '#ffffff',
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
