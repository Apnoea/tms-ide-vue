// Единый конфиг визуала для проводов TMS IDE. Используется в двух местах:
//   • CanvasPane.defaultLink() — когда юзер тащит из порта (JointJS-flow)
//   • projectLoader — при восстановлении провода из SVG/JSON (graph.fromJSON)
//
// Без второго применения восстановленные провода получают дефолты JointJS
// (стрелка-marker на target, прямой connector) — отличается от того, что
// рисуется в редакторе при ручной прокладке.

import { routers } from '@joint/core'
import { LINK_META_FIELDS } from '../constants/ids'

/**
 * rightAngle с привязкой ИЗЛОМОВ к сетке. Базовый rightAngle ставит
 * соединительный сегмент по середине промежутка между ячейками → координаты
 * часто «между клетками». Снапим точки маршрута к gridSize: ортогональность
 * сохраняется (соседние точки делят координату → снапятся одинаково), а концы
 * (на портах) роутер в маршрут не включает — они остаются на месте.
 * Регистрируется в paper.options.routerNamespace (CanvasPane), чтобы имя
 * резолвилось и в редакторе, и при toJSON/fromJSON.
 */
export function gridRightAngleRouter(vertices, args, linkView) {
  const g = linkView?.paper?.options?.gridSize || 10
  const route = routers.rightAngle.call(this, vertices, args, linkView)
  return route.map((p) => ({ x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }))
}

export const LINK_DEFAULTS = {
  // grid-снапящий rightAngle (см. gridRightAngleRouter). anchor-aware orthogonal
  // роутер: в отличие от manhattan не зигзагит при выходе из порта в «неудобную»
  // сторону. margin=5 — отступ маршрута от bbox ячейки.
  // useVertices=true — иначе rightAngle игнорирует ручные изломы
  // (linkTools.Vertices) и хэндлы висят в стороне от линии. При
  // vertices.length===0 роутер идёт коротким путём независимо от флага.
  router: {
    name: 'gridRightAngle',
    args: { margin: 5, useVertices: true },
  },
  // jumpover — рисует «горб» в местах пересечения с другими линиями. Стандарт
  // на электросхемах: непересекающиеся (просто перекрещивающиеся) провода
  // визуально отличаются от соединённых (T-junction через порт). size=6 —
  // высота дуги, type=arc — полудуга (gap/cubic — альтернативы).
  connector: { name: 'jumpover', args: { size: 6, type: 'arc' } },
  attrs: {
    line: {
      stroke: '#000',
      strokeWidth: 2,
      // Без стрелок на концах: для электрической схемы направление неинформативно.
      targetMarker: { type: 'none' },
      sourceMarker: { type: 'none' },
    },
  },
}

/**
 * Фиксированный z всех проводов: они ВСЕГДА позади символов (провод-подложка, порты
 * не должны перекрываться линией). Именно фиксированный, а не `toBack()`: тот ставит
 * `min(z)-1`, поэтому цикл по линкам на каждом reinject (undo / смена формы / экспорт)
 * смещал z и переворачивал их порядок → `graph.toJSON()` расходился с undo-снимком,
 * любой следующий клик писал фантомный шаг истории и срезал redo-ветку.
 * Значение с запасом «вниз»: ячейки живут выше (см. reorderCells — min/max по
 * элементам), так что «на задний план» для символа не роняет его под провода.
 */
export const LINK_Z = -1000

/**
 * `attrs` провода под его tms-стиль (толщина/цвет из LINK_META_FIELDS с `attr`).
 * Стиль — источник правды в `tms`, но рисует JointJS по `attrs.line`, поэтому при
 * КАЖДОМ создании модели (paste, round-trip-load) его надо продублировать туда:
 * иначе копия/загруженный провод выглядит дефолтным, а после следующего экспорта
 * «внезапно» становится толстым/цветным (exporter пишет из tms).
 * Возвращает null, если стиль дефолтный — вызывающий не переопределяет attrs.
 * Новый объект: общий LINK_DEFAULTS.attrs шарится всеми проводами, мутировать нельзя.
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
