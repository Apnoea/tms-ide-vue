/**
 * «Мостовые» линии — провода, у которых ОБА конца лежат в наборе cellIds.
 * Используются:
 *   • при multi-select ячеек (lasso, Ctrl-клик, Ctrl+A) автоматически
 *     включаются в выделение
 *   • при copy/paste — копируются вместе с ячейками со сменой source/target id
 *
 * Возвращает массив { kind: 'link', id } для удобного включения в selection.
 *
 * @param {dia.Graph} graph
 * @param {Iterable<string>|Set<string>} cellIds — id'ы ячеек
 * @returns {Array<{kind: 'link', id: string}>}
 */
export function computeBridgeLinks(graph, cellIds) {
  if (!graph) return []
  const set = cellIds instanceof Set ? cellIds : new Set(cellIds)
  const out = []
  for (const link of graph.getLinks()) {
    const s = link.get('source')?.id
    const t = link.get('target')?.id
    if (s && t && set.has(s) && set.has(t)) {
      out.push({ kind: 'link', id: link.id })
    }
  }
  return out
}
