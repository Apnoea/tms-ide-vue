import { dia, shapes, anchors, connectionPoints, routers } from '@joint/core'
import { tmsNamespace } from './tmsStencil'
import { LINK_DEFAULTS, gridRightAngleRouter, linkStyleAttrs } from './linkDefaults'

const GRID_COLOR_ON_LIGHT = '#e2e8f0' // slate-200
const GRID_COLOR_ON_DARK = '#334155' // slate-700
/**
 * Шаг сетки холста. Экспортируется, потому что от него зависят не только точки под
 * ячейками: к нему снапятся габарит и порты масштабированного символа (см.
 * svgInjector.scaledSize) — разъехавшись, эти два места дали бы порт между клетками.
 */
export const CANVAS_GRID = 5

/** Фон холста по умолчанию (slate-50). Настройка окружения — см. `ui.canvasBg`. */
export const CANVAS_BG_DEFAULT = '#f8fafc'

/**
 * Цвет точек сетки под цвет фона: slate-200 на тёмном фоне не видно, а второй
 * настройки «цвет сетки» не хочется — считаем яркость и берём один из двух вариантов.
 *
 * Разбираем только hex (пикер даёт именно его). CSS-имя или мусор из localStorage
 * яркостью не измерить — тогда светлый вариант, как было до настройки.
 */
export function gridColorFor(bg) {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(String(bg || ''))?.[1]
  if (!hex) return GRID_COLOR_ON_LIGHT
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  // Relative luminance (sRGB-коэффициенты, без гамма-коррекции — для выбора из двух
  // вариантов её точности хватает).
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum < 0.5 ? GRID_COLOR_ON_DARK : GRID_COLOR_ON_LIGHT
}

/**
 * Уже есть такой же провод между этой парой портов? (в любом направлении)
 * Перебираем только линки, СВЯЗАННЫЕ с source-ячейкой — любой дубль обязан иметь
 * один конец на ней, поэтому полный перебор графа не нужен (иначе O(links) на
 * каждый mousemove протяжки).
 */
export function isDuplicateConnection(graph, sourceCell, { srcPort, tgtId, tgtPort, drawn }) {
  const srcId = sourceCell.id
  for (const link of graph.getConnectedLinks(sourceCell)) {
    if (link === drawn) continue
    const os = link.get('source')
    const ot = link.get('target')
    if (!os?.id || !ot?.id) continue
    const same =
      os.id === srcId &&
      (os.port || null) === srcPort &&
      ot.id === tgtId &&
      (ot.port || null) === tgtPort
    const reverse =
      os.id === tgtId &&
      (os.port || null) === tgtPort &&
      ot.id === srcId &&
      (ot.port || null) === srcPort
    if (same || reverse) return true
  }
  return false
}

/** Граф холста с нашим cellNamespace — иначе fromJSON не поднимет `tms.Stencil`. */
export function createCanvasGraph() {
  return new dia.Graph({}, { cellNamespace: tmsNamespace })
}

/**
 * Создаёт `dia.Paper` холста со всей проектной конфигурацией (интерактив, снап
 * связей, anchor'ы cell_node, валидация соединений). Вынесено из CanvasPane —
 * там остаётся подписка на события paper'а.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.el — контейнер холста
 * @param {import('@joint/core').dia.Graph} opts.graph
 * @param {(id: string) => boolean} opts.isSelected — выделен ли элемент (для
 *        interactive: концы тащим только у выделенного провода)
 */
export function createCanvasPaper({
  el,
  graph,
  isSelected,
  background = CANVAS_BG_DEFAULT,
  wireStyle = () => ({}),
}) {
  return new dia.Paper({
    el,
    model: graph,
    width: '100%',
    height: '100%',
    gridSize: CANVAS_GRID,
    // LinkView резолвит имя роутера через routerNamespace (не через опцию
    // `routers`), поэтому спредим встроенные и добавляем свой: имя работает и в
    // редакторе, и при загрузке из JSON/SVG.
    routerNamespace: { ...routers, gridRightAngle: gridRightAngleRouter },
    drawGrid: {
      name: 'dot',
      color: gridColorFor(background),
      thickness: 1,
    },
    // Единственный источник цвета фона — эта опция (JointJS ставит её инлайном);
    // правила в style.css его НЕ перебивают, иначе выбор пользователя не применился бы.
    background: { color: background },
    cellViewNamespace: tmsNamespace,
    // У провода тащим только концы и только у выделенного: маршрут строит роутер, а
    // валидность соединения держит validateConnection (конец можно и оставить на
    // холсте — см. linkPinning).
    interactive: (cellView) => {
      const m = cellView.model
      if (m.isLink?.()) {
        return {
          arrowheadMove: isSelected(m.id),
          vertexAdd: false,
          vertexMove: false,
          vertexRemove: false,
          linkMove: false,
        }
      }
      // Замок = полная неинтерактивность. Выделение приходит своим
      // element:pointerdown, поэтому замок остаётся снимаемым.
      if (m.get('tms')?.locked) return false
      return true
    },
    // Порог click vs drag: без него микро-движение на magnet'е рождает
    // draft-линию (мусор в undo).
    clickThreshold: 5,
    magnetThreshold: 4,
    // Конец провода можно оставить на холсте: свободный конец помечается точкой
    // (см. endMarker) — она заменила символ «точка соединения».
    linkPinning: true,
    // Не заставляем целиться в кружок порта — бросок рядом подтягивается сам.
    snapLinks: { radius: 30 },
    // Конец линии — в позиции anchor'а порта, не на boundary магнита (иначе
    // offset = portRadius). cell_node: anchor на стороне bbox (см. ниже), но
    // визуально доводим до центра, где нарисована точка — иначе 10px зазор.
    defaultConnectionPoint: function (line, view) {
      const stencilId = view?.model?.get?.('tms')?.stencilId
      if (stencilId === 'cell_node') return view.model.getBBox().center()
      // Шина: слот стоит в СЕРЕДИНЕ толщины, и провод, доведённый до anchor'а, уходил
      // внутрь тела — вместе с наконечником, который там и прятался. Заканчиваем линию
      // на границе тела: соединение по-прежнему обозначает маркер на занятом слоте
      // (см. collectBusMarks), а стрелка остаётся снаружи и видна.
      if (stencilId === 'cell_bus') return connectionPoints.bbox.apply(this, arguments)
      return connectionPoints.anchor.apply(this, arguments)
    },
    // Anchor — точка, от которой роутер строит путь. У cell_node порт в ЦЕНТРЕ
    // bbox, и rightAngle с внутренним anchor'ом всегда заходил с одной стороны
    // («провод приходит слева»); midSide берёт середину ближайшей стороны.
    // `apply` — anchors.* ждут `this` = linkView (дёргают this.paper.findView).
    defaultAnchor: function (view) {
      const stencilId = view?.model?.get?.('tms')?.stencilId
      const fn = stencilId === 'cell_node' ? anchors.midSide : anchors.center
      return fn.apply(this, arguments)
    },
    // Новый провод рождается в «липких» настройках инструмента (см.
    // workspace.wireStyle): рисуя серию однотипных линий, автор задаёт вид один раз.
    // Стиль пишем и в tms (round-trip), и в attrs (рисует JointJS).
    defaultLink: () => {
      const tms = wireStyle() || {}
      const attrs = linkStyleAttrs(tms)
      return new shapes.standard.Link({
        ...LINK_DEFAULTS,
        ...(Object.keys(tms).length ? { tms: { ...tms } } : {}),
        ...(attrs ? { attrs } : {}),
      })
    },
    validateConnection: (sourceView, sourceMagnet, targetView, targetMagnet, _end, linkView) => {
      // «на себя» и в воздух
      if (sourceView === targetView) return false
      if (!targetMagnet) return false
      return !isDuplicateConnection(graph, sourceView.model, {
        srcPort: sourceMagnet?.getAttribute('port') || null,
        tgtId: targetView.model.id,
        tgtPort: targetMagnet?.getAttribute('port') || null,
        drawn: linkView?.model,
      })
    },
  })
}
