/**
 * «Мостовые» линии — провода, целиком принадлежащие набору ячеек: КАЖДЫЙ конец либо
 * привязан к ячейке из `cellIds`, либо свободен (оставлен на холсте точкой), и хотя
 * бы один конец в наборе. Свободный конец ни за что не держится, поэтому провод с ним
 * едет вместе с выделением — иначе «выделить всё и перетащить» растягивало бы такие
 * линии, а точки оставались на месте (раньше на их месте была ячейка `cell_node`,
 * которая выделялась и ехала сама).
 *
 * Используются:
 *   • при multi-select ячеек (lasso, Ctrl-клик, Ctrl+A) автоматически включаются в
 *     выделение;
 *   • при copy/paste — копируются вместе с ячейками со сменой source/target id.
 *
 * @param {dia.Graph} graph
 * @param {Iterable<string>|Set<string>} cellIds — id'ы ячеек
 * @returns {Array<{kind: 'link', id: string}>}
 */
export function computeBridgeLinks(graph, cellIds) {
  if (!graph) return []
  const set = cellIds instanceof Set ? cellIds : new Set(cellIds)
  const belongs = (end) => (end?.id ? set.has(end.id) : isFreeEnd(end))
  const out = []
  for (const link of graph.getLinks()) {
    const s = link.get('source')
    const t = link.get('target')
    // Оба конца свободны — провод ни к чему не привязан, к набору ячеек он не
    // относится: тащить его вместе с чужим выделением незачем.
    if (!s?.id && !t?.id) continue
    if (belongs(s) && belongs(t)) out.push({ kind: 'link', id: link.id })
  }
  return out
}

/** Конец «на холсте»: не привязка к ячейке, а точка с координатами. */
export function isFreeEnd(end) {
  return !end?.id && Number.isFinite(end?.x) && Number.isFinite(end?.y)
}
