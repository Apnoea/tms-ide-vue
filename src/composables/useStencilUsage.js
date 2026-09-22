import { useCanvas } from './useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

/**
 * Где символы расставлены в проекте. Считает по живому графу активной формы (правки
 * могли не уехать в стор) и по сохранённым графам остальных.
 *
 * Общий для палитры (удаление одного символа) и наборов (удаление целого набора):
 * правило «не осиротить ячейки» одно, а расходясь, они дали бы разные ответы на один
 * и тот же вопрос.
 */
export function useStencilUsage() {
  const canvas = useCanvas()
  const workspace = useWorkspaceStore()

  /**
   * @param {string|string[]|Set<string>} ids — один id или набор
   * @returns {{ count: number, formIds: string[] }}
   */
  function stencilUsage(ids) {
    const wanted = ids instanceof Set ? ids : new Set(Array.isArray(ids) ? ids : [ids])
    const activeId = workspace.activeFormId
    const formIds = []
    let count = 0
    const scan = (formId, graph) => {
      const n = (graph?.cells || []).filter((c) => wanted.has(c?.tms?.stencilId)).length
      if (n) {
        count += n
        formIds.push(formId)
      }
    }
    const live = canvas.graphRef?.value
    scan(activeId, live ? live.toJSON() : workspace.getFormGraph(activeId))
    for (const fid of workspace.formIds) {
      if (fid === activeId) continue
      scan(fid, workspace.getFormGraph(fid))
    }
    return { count, formIds }
  }

  return { stencilUsage }
}
