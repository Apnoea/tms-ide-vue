import { onBeforeUnmount } from 'vue'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { withRestoreGuard } from '../utils/restoreGuard'
import { idbGet, idbSet } from '../utils/idb'
import { parseTagList } from '../services/parsers'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useCanvas } from './useCanvas'

// IndexedDB-ключи проекта. Мета — порядок форм + активная; граф каждой формы —
// отдельным ключом (autosave переписывает только активную, а не весь проект).
// Теги — текст tag-list'а проекта (теги едут с проектом, переживают reload).
const META_KEY = 'project:meta'
const TAGS_KEY = 'project:tags'
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
  const project = useProjectStore()
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

    if (!meta || !Array.isArray(meta.formIds) || meta.formIds.length === 0) {
      await idbSet(formKey(DEFAULT_FORM_ID), { cells: [] })
      workspace.loadForms([{ id: DEFAULT_FORM_ID, graphJson: { cells: [] } }], DEFAULT_FORM_ID)
      await persistMeta() // только при бутстрапе — иначе мета уже актуальна
    } else {
      const forms = []
      for (const id of meta.formIds) {
        const graphJson = (await idbGet(formKey(id))) || { cells: [] }
        forms.push({ id, graphJson })
      }
      workspace.loadForms(forms, meta.activeFormId)
      // Мета протухла (activeFormId не из formIds) → loadForms скорректировал
      // активную на первую; перезапишем мету, чтобы IDB не расходился со стором.
      if (workspace.activeFormId !== meta.activeFormId) await persistMeta()
    }

    // Теги проекта (если были сохранены с проектом) — поднимаем в стор.
    const tagsText = await idbGet(TAGS_KEY)
    if (tagsText) project.setTags(parseTagList(tagsText))

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
    return idbSet(META_KEY, {
      formIds: [...workspace.formIds],
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
    const ok = await idbSet(formKey(id), json)
    if (!ok) {
      // Запись упала (квота / приватный режим) — не зажигаем «✓ Сохранено»,
      // а помечаем ошибку: футер покажет «не сохранено».
      canvas.setSaveError(true)
      return
    }
    canvas.setSaveError(false)
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

  /**
   * Заменяет проект целиком (импорт папки): пишет все формы + мету + теги в
   * IndexedDB и грузит их в стор. Граф НЕ трогает — это делает либо reload (если
   * импорт дописал стенсилы), либо вызывающий код вручную (если стенсилов нет).
   * Старые `project:form:<id>` от прежнего проекта остаются осиротевшими в IDB
   * (restore читает только formIds из меты) — некритичная утечка, GC позже.
   *
   * Возвращает true, если ВСЕ записи в IDB прошли. При false стор всё равно
   * загружен (сессия рабочая), но IDB неполон — caller обязан предупредить, иначе
   * после reload часть форм окажется пустой (квота), а импорт «успешен».
   *
   * @param {{ id: string, graphJson: object }[]} forms
   * @param {string|null} [tagsText] — сырой текст tag-list'а проекта
   * @returns {Promise<boolean>}
   */
  async function replaceProject(forms, tagsText) {
    let ok = true
    for (const f of forms) ok = (await idbSet(formKey(f.id), f.graphJson)) && ok
    workspace.loadForms(forms, forms[0]?.id ?? null)
    ok = (await persistMeta()) && ok
    // Только если проект принёс теги. Иначе НЕ затираем project:tags в IDB
    // (импорт проекта без taglist'а не должен стирать уже загруженные теги).
    if (tagsText != null) {
      ok = (await idbSet(TAGS_KEY, tagsText)) && ok
      project.setTags(parseTagList(tagsText))
    }
    if (!ok) canvas.setSaveError(true) // футер покажет «не сохранено»
    return ok
  }

  /** Сырой текст tag-list'а проекта из IDB (для бандла на экспорте). null — нет. */
  function readTagsText() {
    return idbGet(TAGS_KEY)
  }

  onBeforeUnmount(() => clearTimeout(savedFlashTimer))

  return {
    restoreProject,
    saveActiveForm,
    clearActiveForm,
    persistMeta,
    replaceProject,
    readTagsText,
  }
}
