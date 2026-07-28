// Всё про визуал провода: дефолты модели, роутер, z-полоса, стиль из tms и
// ручки выделенного. Конфиг нужен И при рисовании из порта (defaultLink), И при
// восстановлении из SVG/JSON — иначе загруженный провод получает дефолты JointJS
// (стрелка на конце, прямой connector) и выглядит иначе нарисованного.

import { dia, routers, linkTools } from '@joint/core'
import { LINK_META_FIELDS } from '../constants/ids'

/**
 * rightAngle со снапом маршрута к сетке: базовый ставит соединительный сегмент по
 * середине промежутка, т.е. «между клетками». Ортогональность не страдает (соседние
 * точки делят координату → снапятся одинаково), концы на портах роутер не трогает.
 */
export function gridRightAngleRouter(vertices, args, linkView) {
  const g = linkView?.paper?.options?.gridSize || 10
  const route = routers.rightAngle.call(this, vertices, args, linkView)
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
 * Провода всегда позади символов (иначе линия перекрывает порты). Именно
 * ФИКСИРОВАННЫЙ z, а не `toBack()`: тот даёт `min(z)-1`, поэтому цикл по линкам на
 * каждом reinject смещал z → `toJSON()` расходился с undo-снимком, и следующий
 * клик писал фантомный шаг истории, срезая redo. Запас «вниз» большой: «на задний
 * план» для символа (reorderCells считает по элементам) не роняет его под провода.
 */
export const LINK_Z = -1000

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
