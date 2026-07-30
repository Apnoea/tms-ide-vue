import { reinjectAllStencils } from '../stencils/svgInjector'
import { registerStencil } from '../stencils/registry'
import { withRestoreGuard } from '../utils/restoreGuard'
import { toPlain } from '../utils/plain'
import { idbGet, idbSet, idbDel, idbKeys } from '../utils/idb'
import { loadStencilOverrides } from '../services/stencilOverrides'
import { migrateGraphJson } from '../services/legacyFormat'
import { parseTagList } from '../services/parsers'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useCanvas } from './useCanvas'

// Граф каждой формы — отдельным ключом: autosave переписывает только активную, а
// не весь проект. Мета — порядок форм + активная, теги — сырой tag-list.
const META_KEY = 'project:meta'
const TAGS_KEY = 'project:tags'
const formKey = (id) => `project:form:${id}`

// Дефолтная форма при пустом старте (проекта в IDB ещё нет).
const DEFAULT_FORM_ID = 'main'

/**
 * Мост граф ↔ IndexedDB (формами и активной владеет useWorkspaceStore).
 *
 * @param {object} opts
 * @param {import('vue').Ref<boolean>} opts.restoringHistory — общий флаг с
 *        useUndoRedo: пока идёт восстановление, не сохраняем, иначе
 *        snapshot → save → restore зациклится
 */
export function useAutosave({ restoringHistory }) {
  const canvas = useCanvas()
  const workspace = useWorkspaceStore()
  const project = useProjectStore()

  /**
   * Восстанавливает проект из IndexedDB и грузит активную форму в граф.
   * Нет проекта в IDB → бутстрап пустой формы `main`. Возвращает кол-во ячеек
   * активной формы (0 — пусто).
   */
  async function restoreProject() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return 0

    // Оверрайды стенсилов (правки заливки/анимации, новые стенсилы) — в реестр ДО
    // отрисовки форм, иначе ячейки нарисуются встроенной версией и правки «слетят».
    // Переживают reload без dev-плагина (см. stencilOverrides).
    for (const s of await loadStencilOverrides()) registerStencil(s.stencilJson, s.shapeSvg)

    const meta = await idbGet(META_KEY)

    if (!meta || !Array.isArray(meta.formIds) || meta.formIds.length === 0) {
      await idbSet(formKey(DEFAULT_FORM_ID), { cells: [] })
      workspace.loadForms([{ id: DEFAULT_FORM_ID, graphJson: { cells: [] } }], DEFAULT_FORM_ID)
      workspace.setFormTree(null) // плоское дерево из единственной формы
      await persistMeta() // только при бутстрапе — иначе мета уже актуальна
    } else {
      const forms = []
      for (const id of meta.formIds) {
        const stored = (await idbGet(formKey(id))) || { cells: [] }
        // Старый формат payload'а (см. services/legacyFormat) переписываем сразу:
        // иначе форма жила бы в legacy до первой правки, а экспорт уже пишет новый
        // ключ — привязки диапазонов ушли бы из архива.
        const { json: graphJson, changed } = migrateGraphJson(stored)
        if (changed) await idbSet(formKey(id), graphJson)
        forms.push({ id, graphJson })
      }
      workspace.loadForms(forms, meta.activeFormId)
      workspace.setFormTree(meta.hierarchy) // null у старых проектов → плоский
      workspace.setProjectName(meta.projectName ?? null) // старые проекты → без имени
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
    return idbSet(
      META_KEY,
      toPlain({
        formIds: [...workspace.formIds],
        activeFormId: workspace.activeFormId,
        hierarchy: workspace.formTree, // дерево форм (иерархия) — переживает reload
        projectName: workspace.projectName, // имя проекта — переживает reload
      })
    )
  }

  // Что уже лежит в IDB под активной формой (`{ id, str }`): повторная запись того
  // же графа — structuredClone блоба на сотни КБ. null = неизвестно, пишем.
  let lastSaved = null

  /**
   * Сохраняет активную форму (граф → стор + IndexedDB). Fire-and-forget.
   *
   * @param {object} [json] — готовый `graph.toJSON()` от useUndoRedo
   * @param {string} [jsonStr] — его же `JSON.stringify`
   */
  async function saveActiveForm(json, jsonStr) {
    const graph = canvas.graphRef.value
    const id = workspace.activeFormId
    if (!graph || !id || restoringHistory.value) return
    const graphJson = json ?? graph.toJSON()
    workspace.updateActiveGraph(graphJson)
    // Сами считаем только на редких путях (CRUD форм, переключение, экспорт).
    const str = jsonStr ?? JSON.stringify(graphJson)
    if (lastSaved && lastSaved.id === id && lastSaved.str === str) return
    const ok = await idbSet(formKey(id), graphJson)
    // Квота / приватный режим → статус-полоса скажет «не сохранено». Успех молчит.
    canvas.setSaveError(!ok)
    // Неудачную запись не запоминаем — следующий сейв обязан попробовать снова.
    lastSaved = ok ? { id, str } : null
  }

  /** Очищает граф активной формы (для «очистить холст» — только активную). */
  async function clearActiveForm() {
    const id = workspace.activeFormId
    workspace.clearActiveForm()
    lastSaved = null // пишем в обход saveActiveForm — его память о IDB устарела
    if (id) await idbSet(formKey(id), { cells: [] })
  }

  /**
   * Заменяет проект целиком (импорт): пишет все формы + мету + теги в IndexedDB и
   * грузит их в стор. Граф НЕ трогает — это делает либо reload (если импорт дописал
   * стенсилы), либо вызывающий код вручную (если стенсилов нет).
   *
   * Возвращает true, если ВСЕ записи в IDB прошли. При false стор всё равно
   * загружен (сессия рабочая), но IDB неполон — caller обязан предупредить, иначе
   * после reload часть форм окажется пустой (квота), а импорт «успешен».
   *
   * @param {{ id: string, graphJson: object }[]} forms
   * @param {string|null} [tagsText] — сырой текст tag-list'а проекта
   * @param {Array|null} [hierarchy] — дерево форм из hierarchy.json (null → плоское)
   * @param {string|null} [projectName] — имя проекта (из имени .zip)
   * @returns {Promise<boolean>}
   */
  async function replaceProject(forms, tagsText, hierarchy = null, projectName = null) {
    // GC форм прежнего проекта: импорт заменяет проект целиком, а старые
    // project:form:<id> дальше не читаются (restore идёт по formIds меты) и копили
    // бы мёртвые blob'ы до квоты. Чистим ДО записи новых — освобождаем место.
    lastSaved = null // проект меняется целиком — прежняя запись ни о чём не говорит
    const keep = new Set(forms.map((f) => formKey(f.id)))
    for (const key of await idbKeys()) {
      if (key.startsWith('project:form:') && !keep.has(key)) await idbDel(key)
    }
    let ok = true
    for (const f of forms) ok = (await idbSet(formKey(f.id), toPlain(f.graphJson))) && ok
    workspace.loadForms(forms, forms[0]?.id ?? null)
    workspace.setFormTree(hierarchy)
    workspace.setProjectName(projectName) // до persistMeta — уедет в мету
    ok = (await persistMeta()) && ok
    // Только если проект принёс теги. Иначе НЕ затираем project:tags в IDB
    // (импорт проекта без taglist'а не должен стирать уже загруженные теги).
    if (tagsText != null) {
      ok = (await idbSet(TAGS_KEY, tagsText)) && ok
      project.setTags(parseTagList(tagsText))
    }
    if (!ok) canvas.setSaveError(true) // статус-полоса покажет «не сохранено»
    return ok
  }

  /** Сырой текст tag-list'а проекта из IDB (для бандла на экспорте). null — нет. */
  function readTagsText() {
    return idbGet(TAGS_KEY)
  }

  /** Запись graphJson формы по id (создание / переименование). */
  function persistForm(id, json) {
    if (lastSaved?.id === id) lastSaved = null // пишем ту же форму мимо saveActiveForm
    return idbSet(formKey(id), json)
  }

  /** Удалить форму из IDB по id. */
  function removeFormPersist(id) {
    if (lastSaved?.id === id) lastSaved = null
    return idbDel(formKey(id))
  }

  return {
    restoreProject,
    saveActiveForm,
    clearActiveForm,
    persistMeta,
    replaceProject,
    readTagsText,
    persistForm,
    removeFormPersist,
  }
}
