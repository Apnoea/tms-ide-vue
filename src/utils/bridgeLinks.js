import { isFreeEnd } from '../stencils/linkDefaults'

/**
 * «Мостовые» линии — провода, целиком принадлежащие набору ячеек: каждый конец либо
 * привязан к ячейке из `cellIds`, либо свободен (точка на холсте), и хотя бы один
 * конец в наборе. Такие провода едут с выделением (лассо, Ctrl-клик, Ctrl+A) и
 * копируются вместе с ячейками.
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
    // Оба конца свободны — провод к набору ячеек не относится.
    if (!s?.id && !t?.id) continue
    if (belongs(s) && belongs(t)) out.push({ kind: 'link', id: link.id })
  }
  return out
}
