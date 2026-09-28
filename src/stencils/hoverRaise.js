/**
 * Символ под курсором — поверх соседей, пока на нём мышь. Порты проявляются по
 * `:hover` (style.css), но z-index в SVG нет: порядок отрисовки — это порядок в DOM, и
 * сосед, стоящий в слое позже, закрывает порты на общей границе — их не видно и за
 * них не взяться.
 *
 * Поднимается только DOM-узел: `z` модели не трогаем, это была бы правка схемы (шаг
 * undo, «не выгружено»). Провода и так лежат полосой под ячейками (normalizeLinkZ),
 * их порядок не меняется. Уходит мышь — узел встаёт обратно по своему `z` тем же
 * путём, что при вставке вида (`insertCellView`).
 *
 * Поднимаем только ячейки с портами: у фигуры-разметки их нет, а залитый фон,
 * поднятый над схемой, на время ховера закрыл бы все символы на нём. Заблокированную
 * не поднимаем — её порты скрыты.
 *
 * @param {import('@joint/core').dia.Paper} paper
 */
export function createHoverRaise(paper) {
  let raised = null

  function canRaise(view) {
    const model = view?.model
    return !!model?.isElement?.() && !!model.getPorts?.().length && !model.get('tms')?.locked
  }

  function lower() {
    const view = raised
    raised = null
    if (!view) return
    const graph = paper.model
    // Ячейку удалили или форму перезагрузили: узел уже вне слоя, возвращать некуда.
    if (!view.el.parentNode || graph.getCell(view.model.id) !== view.model) return
    paper.getLayerView(graph.getCellLayerId(view.model)).insertCellView(view)
  }

  function raise(view) {
    if (raised && raised !== view) lower()
    if (!canRaise(view)) return
    const layer = view.el.parentNode
    if (!layer) return
    raised = view
    // Уже последний — не трогаем: перестановка узла под курсором браузер может принять
    // за новый вход мыши, и mouseenter пришёл бы снова.
    if (layer.lastChild !== view.el) layer.appendChild(view.el)
  }

  return { raise, lower }
}
