import { onBeforeUnmount } from 'vue'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { withRestoreGuard } from '../utils/restoreGuard'
import { idbGet, idbSet } from '../utils/idb'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useCanvas } from './useCanvas'

// IndexedDB-ключи проекта. Мета — порядок форм + активная; граф каждой формы —
// отдельным ключом (autosave переписывает только активную, а не весь проект).
const META_KEY = 'project:meta'
const formKey = (id) => `project:form:${id}`

// Дефолтная форма при пустом старте (проекта в IDB ещё нет).
const DEFAULT_FORM_ID = 'main'

// Длительность «✓ Сохранено» flash-индикатора в footer'е.
const FLASH_DURATION_MS = 1500

/**
 * Персист проекта в IndexedDB. Формами/активной владеет useWorkspaceStore; здесь
 * — мост граф ↔ хранилище. Зависит от внешнего флага `restoringHistory` (общего
 * с useUndoRedo): пока идёт восстановление, сейв не пишем (иначе snapshot → save
 * → restore зациклится).
 *
 * @param {object} opts
 * @param {import('vue').Ref<boolean>} opts.restoringHistory — общий флаг с useUndoRedo
 */
export function useAutosave({ restoringHistory }) {
  const canvas = useCanvas()
  const workspace = useWorkspaceStore()
  // Таймер flash-индикатора «✓ Сохранено» в footer'е (1.5 сек после save).
  let savedFlashTimer = null

  /**
   * Восстанавливает проект из IndexedDB и грузит активную форму в граф.
   * Нет проекта в IDB → бутстрап пустой формы `main`. Возвращает кол-во ячеек
   * активной формы (0 — пусто).
   */
  async function restoreProject() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return 0

    const meta = await idbGet(META_KEY)
    let forms
    let activeId

    if (!meta || !Array.isArray(meta.formIds) || meta.formIds.length === 0) {
      forms = [{ id: DEFAULT_FORM_ID, name: DEFAULT_FORM_ID, graphJson: { cells: [] } }]
      activeId = DEFAULT_FORM_ID
      await idbSet(formKey(DEFAULT_FORM_ID), { cells: [] })
    } else {
      forms = []
      for (const id of meta.formIds) {
        const graphJson = (await idbGet(formKey(id))) || { cells: [] }
        forms.push({ id, name: id, graphJson })
      }
      activeId = meta.activeFormId
    }

    workspace.loadForms(forms, activeId)
    await persistMeta()

    const activeJson = workspace.getFormGraph(workspace.activeFormId) || { cells: [] }
    return withRestoreGuard(restoringHistory, () => {
      graph.fromJSON(activeJson)
      reinjectAllStencils(graph, paper)
      // fromJSON делает silent reset — 'add'/'remove' не летят, бампаем явно.
      canvas.bumpVersion()
      return graph.getElements().length
    })
  }

  /**
   * Пишет мету проекта (порядок форм + активная) в IndexedDB. Зовётся после
   * смены активной формы (selectForm) — чтобы перезагрузка открыла последнюю
   * просматриваемую форму, а не первую.
   */
  async function persistMeta() {
    await idbSet(META_KEY, {
      formIds: workspace.formList.map((f) => f.id),
      activeFormId: workspace.activeFormId,
    })
  }

  /** Сохраняет активную форму (граф → стор + IndexedDB). Fire-and-forget. */
  async function saveActiveForm() {
    const graph = canvas.graphRef.value
    const id = workspace.activeFormId
    if (!graph || !id || restoringHistory.value) return
    const json = graph.toJSON()
    workspace.updateActiveGraph(json)
    await idbSet(formKey(id), json)
    canvas.setRecentlySaved(true)
    canvas.setLastSavedAt(Date.now())
    clearTimeout(savedFlashTimer)
    savedFlashTimer = setTimeout(() => canvas.setRecentlySaved(false), FLASH_DURATION_MS)
  }

  /** Очищает граф активной формы (для «очистить холст» — только активную). */
  async function clearActiveForm() {
    const id = workspace.activeFormId
    workspace.clearActiveForm()
    if (id) await idbSet(formKey(id), { cells: [] })
  }

  onBeforeUnmount(() => clearTimeout(savedFlashTimer))

  return { restoreProject, saveActiveForm, clearActiveForm, persistMeta }
}
