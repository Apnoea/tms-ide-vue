import { onBeforeUnmount } from 'vue'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { withRestoreGuard } from '../utils/restoreGuard'
import { useCanvas } from './useCanvas'

// Версионированный ключ — если в будущем поменяем формат JSON, увеличим v и
// устаревшие сохранения просто проигнорируются.
const AUTOSAVE_KEY = 'tms-ide:graph:v1'

// Длительность «✓ Сохранено» flash-индикатора в footer'е.
const FLASH_DURATION_MS = 1500

/**
 * Автосейв графа в localStorage. Зависит от внешнего флага `restoringHistory`
 * (общего с useUndoRedo) — пока идёт восстановление из истории, сейв не пишем,
 * иначе зациклимся в snapshot → save → restore.
 *
 * @param {object} opts
 * @param {import('vue').Ref<boolean>} opts.restoringHistory — общий флаг с useUndoRedo
 */
export function useAutosave({ restoringHistory }) {
  const canvas = useCanvas()
  // Таймер для flash-индикатора «✓ Сохранено» в footer'е (1.5 сек после save).
  let savedFlashTimer = null

  /** Возвращает кол-во восстановленных ячеек (0 если сейва нет / битый). */
  function tryRestoreAutosave() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return 0
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY)
      if (!raw) return 0
      const json = JSON.parse(raw)
      if (!json?.cells) return 0
      return withRestoreGuard(restoringHistory, () => {
        graph.fromJSON(json)
        reinjectAllStencils(graph, paper)
        // fromJSON делает silent reset — 'add'/'remove' события не летят, поэтому
        // явно бампаем graphVersion (иначе Inspector/AppFooter в старом состоянии).
        canvas.bumpVersion()
        return graph.getElements().length
      })
    } catch (e) {
      console.warn('[Autosave] Не удалось восстановить', e)
      return 0
    }
  }

  function saveAutosave() {
    const graph = canvas.graphRef.value
    if (!graph || restoringHistory.value) return
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(graph.toJSON()))
      canvas.setRecentlySaved(true)
      canvas.setLastSavedAt(Date.now())
      clearTimeout(savedFlashTimer)
      savedFlashTimer = setTimeout(() => canvas.setRecentlySaved(false), FLASH_DURATION_MS)
    } catch (e) {
      // Quota exceeded — не критично, просто пропускаем сохранение
      console.warn('[Autosave] Запись упала', e)
    }
  }

  /** Удаляет автосейв (для «очистить холст»). */
  function clearAutosave() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY)
    } catch {
      /* ignore */
    }
  }

  onBeforeUnmount(() => clearTimeout(savedFlashTimer))

  return { tryRestoreAutosave, saveAutosave, clearAutosave }
}
