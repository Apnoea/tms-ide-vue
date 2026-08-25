import { reinjectAllStencils } from '../stencils/svgInjector'
import { withPaperFrozen } from '../utils/paperBatch'
import { registerStencil } from '../stencils/registry'
import { withRestoreGuard } from '../utils/restoreGuard'
import { toPlain } from '../utils/plain'
import { idbGet, idbTryGet, idbSet, idbDel, idbKeys } from '../utils/idb'
import { loadStencilOverrides } from '../services/stencilOverrides'
import { parseTagList } from '../services/parsers'
import { migrateGraphJson } from '../services/legacyFormat'
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

  // Чтение проекта на старте не удалось: в IDB данные целы, а в сторе пустышка —
  // любая запись затёрла бы проект. Сессия read-only до перезагрузки.
  let storageUnreadable = false
  const readOnly = () => storageUnreadable

  /**
   * Восстанавливает проект из IndexedDB и грузит активную форму в граф.
   * Нет проекта в IDB → бутстрап пустой формы `main`.
   *
   * @returns {Promise<number>} число ячеек активной формы; `0` — пусто,
   *   **`-1` — хранилище не прочиталось**: запись выключена (read-only), вызывающий
   *   обязан сказать это пользователю.
   */
  async function restoreProject() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return 0

    // Оверрайды стенсилов (правки заливки/анимации, новые стенсилы) — в реестр ДО
    // отрисовки форм, иначе ячейки нарисуются встроенной версией и правки «слетят».
    // Переживают reload без dev-плагина (см. stencilOverrides).
    for (const s of await loadStencilOverrides()) registerStencil(s.stencilJson, s.shapeSvg)

    // Сбой чтения меты НЕ равен «проекта ещё нет»: иначе бутстрап ниже перезаписал
    // бы существующий проект пустой формой.
    const metaRead = await idbTryGet(META_KEY)
    if (!metaRead.ok) {
      storageUnreadable = true
      canvas.setSaveError(true)
      return -1
    }
    const meta = metaRead.value

    if (!meta || !Array.isArray(meta.formIds) || meta.formIds.length === 0) {
      await idbSet(formKey(DEFAULT_FORM_ID), { cells: [] })
      workspace.loadForms([{ id: DEFAULT_FORM_ID, graphJson: { cells: [] } }], DEFAULT_FORM_ID)
      workspace.setFormTree(null) // плоское дерево из единственной формы
      await persistMeta() // только при бутстрапе — иначе мета уже актуальна
    } else {
      const forms = []
      for (const id of meta.formIds) {
        const read = await idbTryGet(formKey(id))
        // Форма не прочиталась: в IDB она цела, в сторе пусто — первый autosave
        // затёр бы её.
        if (!read.ok) {
          storageUnreadable = true
          canvas.setSaveError(true)
          return -1
        }
        // Прошлый формат переписываем сразу: иначе он дожил бы до первой правки, а
        // экспорт уже пишет новый вид — форма и архив разъехались бы.
        const { json: graphJson, changed } = migrateGraphJson(read.value || { cells: [] })
        if (changed) await idbSet(formKey(id), graphJson)
        forms.push({ id, graphJson })
      }
      workspace.loadForms(forms, meta.activeFormId)
      workspace.setFormTree(meta.hierarchy) // null у старых проектов → плоский
      workspace.setProjectName(meta.projectName ?? null) // старые проекты → без имени
      workspace.loadFormBg(meta.formBg) // старые проекты → дефолтный фон у всех форм
      // Мета протухла (activeFormId не из formIds) → loadForms скорректировал
      // активную на первую; перезапишем мету, чтобы IDB не расходился со стором.
      if (workspace.activeFormId !== meta.activeFormId) await persistMeta()
    }

    // Теги проекта (если были сохранены с проектом) — поднимаем в стор.
    const tagsText = await idbGet(TAGS_KEY)
    if (tagsText) project.setTags(parseTagList(tagsText))

    const activeJson = workspace.getFormGraph(workspace.activeFormId) || { cells: [] }
    return withRestoreGuard(restoringHistory, () => {
      withPaperFrozen(paper, () => graph.fromJSON(activeJson))
      // sync: порты/габарит экземпляров сверяем с реестром (символ мог быть правлен
      // в прошлой сессии, а форма хранит порты той версии). Оверрайды символов
      // подняты выше, поэтому реестр здесь уже актуален.
      reinjectAllStencils(graph, paper, { sync: true })
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
    if (readOnly()) return false
    return idbSet(
      META_KEY,
      toPlain({
        formIds: [...workspace.formIds],
        activeFormId: workspace.activeFormId,
        hierarchy: workspace.formTree, // дерево форм (иерархия) — переживает reload
        projectName: workspace.projectName, // имя проекта — переживает reload
        formBg: workspace.formBg, // фон холста по формам — свойство проекта, не браузера
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
    if (!graph || !id || restoringHistory.value || readOnly()) return
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
    if (id && !readOnly()) await idbSet(formKey(id), { cells: [] })
  }

  /**
   * Заменяет проект целиком (импорт): формы + мета + теги в IDB и в стор. Граф не
   * трогает — это reload или вызывающий код.
   *
   * true = все записи прошли. При false стор загружен (сессия рабочая), но IDB
   * неполон — caller обязан предупредить, иначе после reload часть форм пуста.
   *
   * @param {{ id: string, graphJson: object }[]} forms
   * @param {string|null} [tagsText] — сырой текст tag-list'а проекта
   * @param {Array|null} [hierarchy] — дерево форм из hierarchy.json (null → плоское)
   * @param {string|null} [projectName] — имя проекта (из имени .zip)
   * @returns {Promise<boolean>}
   */
  async function replaceProject(
    forms,
    tagsText,
    hierarchy = null,
    projectName = null,
    projectMeta = null
  ) {
    // Хранилище не читается → и не пишем: импорт молча потерял бы данные проекта.
    if (readOnly()) return false
    // GC форм прежнего проекта: restore идёт по formIds меты, старые ключи копили
    // бы мёртвые blob'ы до квоты. Чистим ДО записи новых.
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
    // Фон форм — после loadForms: loadFormBg отбрасывает ключи форм, которых в
    // проекте нет (архив мог принести мету от прежнего состава).
    workspace.loadFormBg(projectMeta?.formBg)
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
    if (readOnly()) return Promise.resolve(false)
    if (lastSaved?.id === id) lastSaved = null // пишем ту же форму мимо saveActiveForm
    return idbSet(formKey(id), json)
  }

  /** Удалить форму из IDB по id. */
  function removeFormPersist(id) {
    if (readOnly()) return Promise.resolve()
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
