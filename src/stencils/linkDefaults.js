// Единый конфиг визуала для проводов TMS IDE. Используется в двух местах:
//   • CanvasPane.defaultLink() — когда юзер тащит из порта (JointJS-flow)
//   • projectLoader — при восстановлении провода из SVG/JSON (graph.fromJSON)
//
// Без второго применения восстановленные провода получают дефолты JointJS
// (стрелка-marker на target, прямой connector) — отличается от того, что
// рисуется в редакторе при ручной прокладке.

import { routers } from '@joint/core'

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
