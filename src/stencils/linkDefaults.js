// Единый конфиг визуала для проводов TMS IDE. Используется в двух местах:
//   • CanvasPane.defaultLink() — когда юзер тащит из порта (JointJS-flow)
//   • projectLoader — при восстановлении провода из SVG/JSON (graph.fromJSON)
//
// Без второго применения восстановленные провода получают дефолты JointJS
// (стрелка-marker на target, прямой connector) — отличается от того, что
// рисуется в редакторе при ручной прокладке.

export const LINK_DEFAULTS = {
  // rightAngle (JointJS 4) — anchor-aware orthogonal router. По сравнению с
  // manhattan не делает зигзаги при выходе из порта в «неудобную» сторону:
  // ориентируется по позиции anchor'а на границе ячейки. margin=5 — отступ
  // от bbox ячейки чтобы провод не лип к корпусу.
  router: {
    name: 'rightAngle',
    args: { margin: 5 },
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
