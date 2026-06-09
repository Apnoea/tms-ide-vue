// Единый конфиг визуала для проводов TMS IDE. Используется в двух местах:
//   • CanvasPane.defaultLink() — когда юзер тащит из порта (JointJS-flow)
//   • projectLoader — при восстановлении провода из SVG/JSON (graph.fromJSON)
//
// Без второго применения восстановленные провода получают дефолты JointJS
// (стрелка-marker на target, прямой connector) — отличается от того, что
// рисуется в редакторе при ручной прокладке.

// Стилевые константы лейбла провода — переиспользуем в редакторе (link.labels)
// и в exporter'е (SVG `<rect>`/`<text>`), чтобы канва и финальный SVG выглядели
// одинаково. font-size 10px, белый фон с тонкой surface-300 обводкой.
export const LINK_LABEL_FONT_SIZE = 10
export const LINK_LABEL_FONT_FAMILY = 'sans-serif'
export const LINK_LABEL_TEXT_COLOR = '#374151' // surface-700
export const LINK_LABEL_BG_COLOR = '#ffffff'
export const LINK_LABEL_BORDER_COLOR = '#cbd5e1' // surface-300
export const LINK_LABEL_PAD_X = 4
export const LINK_LABEL_PAD_Y = 2

/**
 * Объект label для `link.labels([buildLinkLabel(text)])`. JointJS auto-sizes
 * rect под text через ref/refWidth — поэтому в редакторе фон точно охватывает
 * любую длину. В экспортном SVG width считается отдельно по character-count
 * (без layout — DOMParser не может измерить glyph metrics).
 */
export function buildLinkLabel(text) {
  return {
    position: { distance: 0.5 },
    markup: [
      { tagName: 'rect', selector: 'rect' },
      { tagName: 'text', selector: 'text' },
    ],
    attrs: {
      rect: {
        ref: 'text',
        fill: LINK_LABEL_BG_COLOR,
        stroke: LINK_LABEL_BORDER_COLOR,
        strokeWidth: 1,
        rx: 2,
        ry: 2,
        refX: -LINK_LABEL_PAD_X,
        refY: -LINK_LABEL_PAD_Y,
        refWidth: LINK_LABEL_PAD_X * 2,
        refHeight: LINK_LABEL_PAD_Y * 2,
      },
      text: {
        text,
        fill: LINK_LABEL_TEXT_COLOR,
        fontSize: LINK_LABEL_FONT_SIZE,
        fontFamily: LINK_LABEL_FONT_FAMILY,
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
    },
  }
}

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
