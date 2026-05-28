// Единый конфиг визуала для проводов TMS IDE. Используется в двух местах:
//   • CanvasPane.defaultLink() — когда юзер тащит из порта (JointJS-flow)
//   • projectLoader — при восстановлении провода из SVG/JSON (graph.fromJSON)
//
// Без второго применения восстановленные провода получают дефолты JointJS
// (стрелка-marker на target, прямой connector) — отличается от того, что
// рисуется в редакторе при ручной прокладке.

export const LINK_DEFAULTS = {
  // manhattan-router: ортогональные пути с обходом ячеек. step=10 совпадает
  // с gridSize холста, чтобы провода ложились ровно на сетку.
  router: {
    name: 'manhattan',
    args: { padding: 10, step: 10 },
  },
  connector: { name: 'normal' },
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
