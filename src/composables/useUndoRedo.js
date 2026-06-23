import { onBeforeUnmount } from 'vue'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { withRestoreGuard } from '../utils/restoreGuard'
import { useCanvas } from './useCanvas'

const HISTORY_LIMIT = 50

/**
 * Undo/redo стек snapshot'ов graph.toJSON(). Каждое значимое изменение → debounce
 * 200ms → snapshot. JointJS не таскает CommandManager в open-source @joint/core,
 * поэтому минимальная своя реализация — full-graph replay; для текущего объёма
 * (десятки ячеек) ок.
 *
 * Зависит от:
 *  • `restoringHistory` (Ref<boolean>) — общий флаг с useAutosave; пока идёт
 *    restore, новые snapshot'ы не пишем (иначе восстановление ломает историю).
 *  • `saveAutosave` (fn) — после успешного snapshot/restore сохраняем активную
 *    форму (в IndexedDB через useAutosave), чтобы перезагрузка давала актуальное
 *    состояние.
 *
 * После создания composable нужно вызвать `init()` когда graph готов, чтобы
 * стартовая позиция (пустой граф или восстановленный автосейв) попала в стек.
 */
export function useUndoRedo({ restoringHistory, saveAutosave }) {
  const canvas = useCanvas()
  let history = []
  let historyIndex = -1
  let snapshotTimer = null

  function syncAvail() {
    canvas.setUndoRedoAvail(historyIndex > 0, historyIndex < history.length - 1)
  }

  function initHistory() {
    const graph = canvas.graphRef.value
    if (!graph) return
    history = [graph.toJSON()]
    historyIndex = 0
    syncAvail()
  }

  function snapshot() {
    const graph = canvas.graphRef.value
    if (restoringHistory.value || !graph) return
    // Если делаем новое действие после серии undo — отрезаем «будущее»
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1)
    }
    history.push(graph.toJSON())
    historyIndex++
    if (history.length > HISTORY_LIMIT) {
      history.shift()
      historyIndex--
    }
    // Autosave пишем по тому же триггеру что и history snapshot — оба отражают
    // «стабильное» состояние после действия пользователя.
    saveAutosave()
    syncAvail()
  }

  function scheduleSnapshot() {
    if (restoringHistory.value) return
    clearTimeout(snapshotTimer)
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null
      snapshot()
    }, 200)
  }

  function undo() {
    if (historyIndex <= 0) return
    if (restoreFromHistory(historyIndex - 1)) historyIndex--
  }

  function redo() {
    if (historyIndex >= history.length - 1) return
    if (restoreFromHistory(historyIndex + 1)) historyIndex++
  }

  /**
   * Применяет snapshot history[idx] к графу. Возвращает true при успехе,
   * false если graph/paper не готовы или fromJSON/reinjectAllStencils упали.
   * Caller (undo/redo) сдвигает historyIndex ТОЛЬКО на успех — иначе стек
   * разсинхронизировался бы с фактическим состоянием графа.
   * try/finally гарантирует сброс restoringHistory даже при throw — без него
   * флаг залип бы навсегда и заблокировал undo / snapshot / autosave.
   */
  function restoreFromHistory(idx) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return false
    clearTimeout(snapshotTimer)
    snapshotTimer = null

    let ok = false
    try {
      withRestoreGuard(restoringHistory, () => {
        graph.fromJSON(history[idx])
        reinjectAllStencils(graph, paper)
        canvas.bumpVersion()
        canvas.clearSelection()
      })
      ok = true
    } catch (e) {
      console.warn('[Undo/Redo] restore failed, индекс не сдвигаем', e)
    }
    if (ok) {
      saveAutosave()
      syncAvail()
    }
    return ok
  }

  /** Снимает pending-snapshot (для performClearCanvas / переключения форм /
   * импорта — чтобы отложенный таймер не задвоил пустое/новое состояние). */
  function cancelPendingSnapshot() {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }

  onBeforeUnmount(cancelPendingSnapshot)

  return { initHistory, scheduleSnapshot, undo, redo, cancelPendingSnapshot }
}
