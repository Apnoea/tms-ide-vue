import { onBeforeUnmount } from 'vue'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { withPaperFrozen } from '../utils/paperBatch'
import { withRestoreGuard } from '../utils/restoreGuard'
import { useCanvas } from './useCanvas'

const HISTORY_LIMIT = 50

/**
 * Undo/redo: стек снимков `graph.toJSON()`, значимое изменение → дебаунс 200мс →
 * snapshot. В open-source @joint/core нет CommandManager, поэтому свой full-graph
 * replay — для десятков ячеек достаточно. Снимки хранятся СТРОКАМИ: дедуп против
 * вершины — сравнение строк, а не два `JSON.stringify` графа на действие.
 * `initHistory()` зовём, когда graph готов — иначе стартовой позиции нет в стеке.
 *
 * @param {object} deps
 * @param {import('vue').Ref<boolean>} deps.restoringHistory — общий флаг с
 *        useAutosave: пока идёт restore, снимки не пишем (иначе история рвётся)
 * @param {(json: object, jsonStr: string) => void} deps.saveAutosave — персист
 *        активной формы; отдаём ему готовые json+строку, чтобы он не обходил граф
 *        вторым `toJSON()` на то же действие
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
    history = [JSON.stringify(graph.toJSON())]
    historyIndex = 0
    syncAvail()
  }

  function snapshot() {
    const graph = canvas.graphRef.value
    if (restoringHistory.value || !graph) return
    const json = graph.toJSON()
    const str = JSON.stringify(json)
    // Триггер мог не изменить граф (клик-выделение в модель не пишется). Пустышки
    // вымывали бы HISTORY_LIMIT, Ctrl+Z «прожимался» бы впустую, а после серии undo
    // такой снимок ещё и срезал бы redo.
    if (str === history[historyIndex]) return
    // Если делаем новое действие после серии undo — отрезаем «будущее»
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1)
    }
    history.push(str)
    historyIndex++
    if (history.length > HISTORY_LIMIT) {
      history.shift()
      historyIndex--
    }
    // Autosave по тому же триггеру: оба отражают стабильное состояние после действия.
    saveAutosave(json, str)
    // Реальное изменение графа → состояние разошлось с последним экспортом.
    canvas.markDirty()
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

  /**
   * Фиксирует отложенный снимок перед навигацией по истории. Иначе Ctrl+Z в окне
   * дебаунса съедал ДВА действия: pending-снимок отбрасывался и в стек не попадал,
   * так что redo его не возвращал.
   */
  function flushPendingSnapshot() {
    if (!snapshotTimer) return
    clearTimeout(snapshotTimer)
    snapshotTimer = null
    snapshot() // дедуп внутри: если граф не менялся, шаг не добавится
  }

  function undo() {
    flushPendingSnapshot()
    if (historyIndex <= 0) return
    if (restoreFromHistory(historyIndex - 1)) historyIndex--
  }

  function redo() {
    // Незакоммиченное действие делает redo-хвост недействительным — флашим его
    // (snapshot сам срежет «будущее»), иначе redo вернул бы состояние из ветки,
    // которой уже не существует.
    flushPendingSnapshot()
    if (historyIndex >= history.length - 1) return
    if (restoreFromHistory(historyIndex + 1)) historyIndex++
  }

  /**
   * Применяет history[idx] к графу. `false` — graph/paper не готовы либо
   * fromJSON/reinject упали; вызывающий сдвигает индекс ТОЛЬКО на успех, иначе стек
   * разошёлся бы с фактическим графом. Флаг restoringHistory снимается и при throw
   * (иначе залип бы, заблокировав undo/snapshot/autosave).
   */
  function restoreFromHistory(idx) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return false
    clearTimeout(snapshotTimer)
    snapshotTimer = null

    const str = history[idx]
    let json = null
    let ok = false
    try {
      json = JSON.parse(str)
      withRestoreGuard(restoringHistory, () => {
        // Undo/redo — то же массовое переписывание графа, что загрузка формы:
        // промежуточные состояния перерисовывать незачем. Инъекция — ПОСЛЕ
        // разморозки: у замороженного paper'а нет представлений новых ячеек.
        withPaperFrozen(paper, () => graph.fromJSON(json))
        reinjectAllStencils(graph, paper)
        canvas.bumpVersion()
        canvas.clearSelection()
      })
      ok = true
    } catch (e) {
      console.warn('[Undo/Redo] restore failed, индекс не сдвигаем', e)
    }
    if (ok) {
      saveAutosave(json, str)
      canvas.markDirty() // undo/redo меняет граф → расхождение с экспортом
      syncAvail()
    }
    return ok
  }

  /** Снять pending-снимок: очистка холста / переключение формы / импорт — чтобы
   * отложенный таймер не задвоил новое состояние. */
  function cancelPendingSnapshot() {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }

  onBeforeUnmount(cancelPendingSnapshot)

  return { initHistory, snapshot, scheduleSnapshot, undo, redo, cancelPendingSnapshot }
}
