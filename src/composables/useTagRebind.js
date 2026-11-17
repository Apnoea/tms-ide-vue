import { useCanvas } from './useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { indexBoundTags, suggestRename } from '../services/tagRebind'

// Сама подсказка всплывает, только когда замена находит большую часть недостающих
// тегов (сменился префикс сервера): иначе пара-тройка разошедшихся тегов поднимала бы
// окно на каждой загрузке. Частичную замену подставляет кнопка.
const AUTO_SHARE = 0.5

/**
 * Привязанные теги проекта для диалога «Замена в привязках» и подсказка замены после
 * загрузки tag-list (файлом или в архиве проекта).
 */
export function useTagRebind() {
  const canvas = useCanvas()
  const workspace = useWorkspaceStore()
  const project = useProjectStore()
  const ui = useUiStore()

  /** Индекс привязок: активная форма — из живого графа (правки могли не уехать в стор). */
  function boundTagIndex() {
    const activeId = workspace.activeFormId
    const live = canvas.graphRef?.value
    return indexBoundTags(
      workspace.formIds.map((id) => ({
        id,
        json: id === activeId && live ? live.toJSON() : workspace.getFormGraph(id),
      }))
    )
  }

  const suggestion = () => suggestRename(boundTagIndex().counts.keys(), project.tagNames)

  /**
   * После загрузки tag-list: большая часть недостающих привязок находится одной заменой —
   * открыть диалог с подставленными полями. Применяет замену только пользователь.
   */
  function offerRebind() {
    const s = suggestion()
    if (!s || s.matched < s.missing * AUTO_SHARE) return null
    ui.openTagRebind({ ...s, suggested: true })
    return s
  }

  /** Кнопка у tag-list: любая найденная замена подставляется в поля. */
  function openRebind() {
    const s = suggestion()
    ui.openTagRebind(s ? { ...s, suggested: true } : {})
  }

  return { boundTagIndex, offerRebind, openRebind }
}
