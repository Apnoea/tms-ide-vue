import { ref } from 'vue'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useUiStore } from '../stores/useUiStore'
import { useNotify } from './useNotify'
import { useCanvas } from './useCanvas'
import { useForms } from './useForms'
import { useProjectArchive } from './useProjectArchive'

/**
 * Оркестрация проектных операций: формы (useForms) и проект целиком — импорт, экспорт
 * .zip, миграции (useProjectArchive). Без UI, поэтому мутации графа под сериями
 * await'ов тестируемы в изоляции.
 *
 * graph/paper — из `useCanvas`; остальные зависимости инжектятся бэгом (их
 * lifecycle-хуки живут в компоненте). Здесь общий для обеих частей контекст и
 * `projectBusy`: параллельный запуск мутировал бы один граф.
 *
 * @param {object} deps
 * @param {import('vue').Ref<boolean>} deps.restoringHistory — общий флаг с undo/autosave
 * @param {{ saveActiveForm, persistMeta, replaceProject, readTagsText, persistForm, removeFormPersist, loadTrash, pushTrash, popTrash }} deps.autosave
 * @param {{ cancelPendingSnapshot, initHistory }} deps.undo
 * @param {{ stopSimulation, simulating }} deps.simulation
 */
export function useProject({ restoringHistory, autosave, undo, simulation }) {
  const canvas = useCanvas()
  const workspace = useWorkspaceStore()
  const ui = useUiStore()
  const notify = useNotify()

  // idbSet возвращает false, а не бросает: без явного флага новая форма молча
  // пропала бы после reload, а статус «не сохранено» не загорелся.
  const flagIfNotSaved = (ok) => {
    if (!ok) canvas.setSaveError(true)
    return ok
  }
  const ctx = {
    canvas,
    workspace,
    notify,
    restoringHistory,
    autosave,
    undo,
    simulation,
    flagIfNotSaved,
  }
  const forms = useForms(ctx)
  const archive = useProjectArchive(ctx)

  // Проектные операции мутируют один граф и стор через серии await'ов, поэтому идут
  // через общий busy-флаг: параллельный запуск рассинхронил бы их. Флаг реактивный —
  // useHotkeys гейтит по нему мутирующие хоткеи, иначе paste/undo/delete между
  // await'ами записали бы граф чужой формы.
  const projectBusy = ref(false)
  const withProjectBusy =
    (fn) =>
    async (...args) => {
      if (projectBusy.value) return
      projectBusy.value = true
      ui.setProjectBusy(true) // App гейтит всю область редактирования (inert) на это время
      try {
        return await fn(...args)
      } catch (e) {
        // Один перехват на все проектные операции: без него исключение из любой
        // стало бы unhandled-rejection без следа для пользователя.
        console.error('[Project] операция завершилась ошибкой:', e)
        notify.error('Операция не выполнена', e?.message || String(e))
      } finally {
        projectBusy.value = false
        ui.setProjectBusy(false)
      }
    }

  return {
    exportingProject: archive.exportingProject,
    projectBusy,
    selectForm: withProjectBusy(forms.selectForm),
    importProjectFromArchive: withProjectBusy(archive.importProjectFromArchive),
    exportProjectToArchive: withProjectBusy(archive.exportProjectToArchive),
    createForm: withProjectBusy(forms.createForm),
    duplicateForm: withProjectBusy(forms.duplicateForm),
    deleteForm: withProjectBusy(forms.deleteForm),
    restoreForm: withProjectBusy(forms.restoreForm),
    renameForm: withProjectBusy(forms.renameForm),
    moveFormNode: withProjectBusy(forms.moveFormNode),
    syncStencilInClosedForms: withProjectBusy(archive.syncStencilInClosedForms),
    migrateRangesToStencils: withProjectBusy(archive.migrateRangesToStencils),
    cleanupInheritedRanges: withProjectBusy(archive.cleanupInheritedRanges),
    trash: forms.trash,
    refreshTrash: forms.refreshTrash,
  }
}
