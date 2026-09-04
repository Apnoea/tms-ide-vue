import { watch, onBeforeUnmount } from 'vue'
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

// Граф каждой формы — отдельным ключом: autosave переписывает только активную. Мета —
// порядок форм и активная, теги — сырой tag-list.
const META_KEY = 'project:meta'
const TAGS_KEY = 'project:tags'
const formKey = (id) => `project:form:${id}`
// Корзина удалённых форм: удаление не откатывается Ctrl+Z (проектные операции вне
// графового undo), а граф формы — часы работы. Записи в IDB — возврат переживает
// перезагрузку.
const TRASH_KEY = 'project:trash'
const TRASH_MAX = 5

// Дефолтная форма при пустом старте (проекта в IDB ещё нет).
const DEFAULT_FORM_ID = 'main'

/**
 * Мост граф ↔ IndexedDB (формами и активной владеет useWorkspaceStore).
 *
 * @param {object} opts
 * @param {import('vue').Ref<boolean>} opts.restoringHistory — общий флаг с
 *        useUndoRedo: пока идёт восстановление, не сохраняем (иначе
 *        snapshot → save → restore зацикливается)
 */
export function useAutosave({ restoringHistory }) {
  const canvas = useCanvas()
  const workspace = useWorkspaceStore()
  const project = useProjectStore()

  // Чтение проекта на старте не удалось: в IDB данные целы, в сторе пустышка, поэтому
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

    // Оверрайды символов — в реестр ДО отрисовки форм, иначе ячейки нарисуются
    // встроенной версией. Они же дают правкам пережить reload без dev-плагина.
    for (const s of await loadStencilOverrides()) registerStencil(s.stencilJson, s.shapeSvg)

    // Сбой чтения меты не равен «проекта ещё нет»: бутстрап ниже перезаписал бы
    // существующий проект пустой формой.
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
        // Форма не прочиталась: в IDB она цела, в сторе пусто, и первый autosave
        // затёр бы её.
        if (!read.ok) {
          storageUnreadable = true
          canvas.setSaveError(true)
          return -1
        }
        // Прошлый формат переписывается сразу: экспорт уже пишет новый вид, и без
        // перезаписи форма с архивом разъедутся.
        const { json: graphJson, changed } = migrateGraphJson(read.value || { cells: [] })
        if (changed) await idbSet(formKey(id), graphJson)
        forms.push({ id, graphJson })
      }
      workspace.loadForms(forms, meta.activeFormId)
      workspace.setFormTree(meta.hierarchy) // null у старых проектов → плоский
      workspace.setProjectName(meta.projectName ?? null) // старые проекты → без имени
      workspace.loadFormBg(meta.formBg) // старые проекты → дефолтный фон у всех форм
      workspace.loadWireStyle(meta.wireStyle)
      // Мета протухла (activeFormId не из formIds): loadForms взял первую форму,
      // перезаписываем мету, чтобы IDB не расходился со стором.
      if (workspace.activeFormId !== meta.activeFormId) await persistMeta()
    }

    // Теги проекта (если были сохранены с проектом) — поднимаем в стор.
    const tagsText = await idbGet(TAGS_KEY)
    if (tagsText) project.setTags(parseTagList(tagsText))

    const activeJson = workspace.getFormGraph(workspace.activeFormId) || { cells: [] }
    return withRestoreGuard(restoringHistory, () => {
      withPaperFrozen(paper, () => graph.fromJSON(activeJson))
      // sync: порты и габарит экземпляров сверяются с реестром — форма хранит порты
      // той версии символа, что была при сохранении. Оверрайды подняты выше.
      reinjectAllStencils(graph, paper, { sync: true })
      // fromJSON делает silent reset: 'add'/'remove' не летят, версию бампаем сами.
      canvas.bumpVersion()
      return graph.getElements().length
    })
  }

  /**
   * Пишет мету проекта (порядок форм + активная) в IndexedDB — после смены активной
   * формы, чтобы перезагрузка открыла последнюю просматриваемую.
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
        wireStyle: workspace.wireStyle, // вид нового провода (липкие настройки инструмента)
      })
    )
  }

  // Что уже лежит в IDB под активной формой (`{ id, str }`): повторная запись того же
  // графа — это structuredClone блоба на сотни КБ. null = неизвестно, пишем.
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
    // Сами считаем только на редких путях (CRUD форм, переключение формы, экспорт).
    const str = jsonStr ?? JSON.stringify(graphJson)
    if (lastSaved && lastSaved.id === id && lastSaved.str === str) return
    const ok = await idbSet(formKey(id), graphJson)
    // Квота или приватный режим — статус-полоса скажет «не сохранено».
    canvas.setSaveError(!ok)
    // Неудачную запись не запоминаем: следующий сейв должен попробовать снова.
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
   * неполон, и вызывающий обязан предупредить: после reload часть форм будет пуста.
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
    // Хранилище не читается — не пишем: импорт потерял бы данные проекта.
    if (readOnly()) return false
    // GC форм прежнего проекта: restore идёт по formIds меты, а старые ключи копили бы
    // мёртвые блобы до квоты. Чистим ДО записи новых.
    lastSaved = null // проект меняется целиком — прежняя запись ни о чём не говорит
    await idbDel(TRASH_KEY) // корзина от прежнего проекта: возвращать её формы некуда
    const keep = new Set(forms.map((f) => formKey(f.id)))
    for (const key of await idbKeys()) {
      if (key.startsWith('project:form:') && !keep.has(key)) await idbDel(key)
    }
    let ok = true
    for (const f of forms) ok = (await idbSet(formKey(f.id), toPlain(f.graphJson))) && ok
    workspace.loadForms(forms, forms[0]?.id ?? null)
    workspace.setFormTree(hierarchy)
    workspace.setProjectName(projectName) // до persistMeta — уедет в мету
    // Фон форм — после loadForms: loadFormBg отбрасывает ключи форм, которых в проекте
    // нет.
    workspace.loadFormBg(projectMeta?.formBg)
    ok = (await persistMeta()) && ok
    // Только если проект принёс теги: иначе project:tags в IDB не затираем.
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

  /** Все записи корзины, свежие первыми. Чтение упало → пустая. */
  async function loadTrash() {
    const { ok, value } = await idbTryGet(TRASH_KEY)
    return ok && Array.isArray(value) ? value : []
  }

  /** Положить форму в корзину; `false` = запись не прошла (квота / read-only). */
  async function pushTrash(entry) {
    if (readOnly()) return false
    const next = [entry, ...(await loadTrash()).filter((e) => e.id !== entry.id)]
    return idbSet(TRASH_KEY, toPlain(next.slice(0, TRASH_MAX)))
  }

  /** Вынуть запись из корзины (возврат формы или зачистка). */
  async function popTrash(id) {
    if (readOnly()) return null
    const items = await loadTrash()
    const entry = items.find((e) => e.id === id) || null
    if (entry) await idbSet(TRASH_KEY, toPlain(items.filter((e) => e.id !== id)))
    return entry
  }

  /** Запись graphJson формы по id (создание / переименование / возврат из корзины). */
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

  // Липкие настройки провода живут в мете, а её пишут только операции с формами —
  // поэтому свой вотчер. Отложенно: пикер цвета сыплет событиями на каждое движение
  // курсора, а мета пишется целиком. Глубокое сравнение не нужно — `setWireStyle`
  // собирает новый объект.
  let metaTimer = null
  watch(
    () => workspace.wireStyle,
    () => {
      clearTimeout(metaTimer)
      metaTimer = setTimeout(persistMeta, 300)
    }
  )
  onBeforeUnmount(() => clearTimeout(metaTimer))

  return {
    restoreProject,
    saveActiveForm,
    clearActiveForm,
    persistMeta,
    replaceProject,
    readTagsText,
    persistForm,
    removeFormPersist,
    loadTrash,
    pushTrash,
    popTrash,
  }
}
