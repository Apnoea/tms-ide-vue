import { ref, nextTick } from 'vue'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { getStencilById, registerStencil } from '../stencils/registry'
import { exportProject } from '../services/exporter'
import { parseSvgProject } from '../services/projectLoader'
import {
  buildProjectZipBlob,
  downloadBlob,
  pickProjectArchive,
  readProjectZipFile,
  collectUsedStencilIds,
} from '../services/projectZip'
import { persistStencilsToDisk } from '../services/stencilLibrary'
import { replaceStencilOverrides, stencilSignature } from '../services/stencilOverrides'
import { withRestoreGuard } from '../utils/restoreGuard'
import { withPaperFrozen } from '../utils/paperBatch'
import { renameFormIds, remapNavigation, remapTree, remapProjectMeta } from '../utils/formIds'
import { FORM_ID_RE } from '../constants/ids'
import { nplural } from '../utils/plural'
import { toPlain } from '../utils/plain'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useUiStore } from '../stores/useUiStore'
import { useNotify } from './useNotify'
import { useCanvas } from './useCanvas'

/**
 * Оркестрация проектных операций: переключение формы, CRUD форм, импорт и экспорт
 * .zip. Без UI, поэтому мутации графа под сериями await'ов тестируемы в изоляции.
 *
 * graph/paper — из `useCanvas`; остальные зависимости инжектятся бэгом (их
 * lifecycle-хуки живут в компоненте). Функции обёрнуты в общий `projectBusy`:
 * параллельный запуск мутировал бы один граф.
 *
 * @param {object} deps
 * @param {import('vue').Ref<boolean>} deps.restoringHistory — общий флаг с undo/autosave
 * @param {{ saveActiveForm, persistMeta, replaceProject, readTagsText, persistForm, removeFormPersist, loadTrash, pushTrash, popTrash }} deps.autosave
 * @param {{ cancelPendingSnapshot, initHistory }} deps.undo
 * @param {{ stopSimulation, simulating }} deps.simulation
 * @param {() => void} deps.commitTextEdit — закоммитить inline-правку текста
 * @param {import('vue').Ref<boolean>} deps.textEditing — идёт ли inline-редактирование
 */
export function useProject({
  restoringHistory,
  autosave,
  undo,
  simulation,
  commitTextEdit,
  textEditing,
}) {
  const canvas = useCanvas()
  const workspace = useWorkspaceStore()
  const ui = useUiStore()
  const notify = useNotify()
  const {
    saveActiveForm,
    persistMeta,
    replaceProject,
    readTagsText,
    persistForm,
    removeFormPersist,
    loadTrash,
    pushTrash,
    popTrash,
  } = autosave
  const { cancelPendingSnapshot, initHistory } = undo
  const { stopSimulation, simulating } = simulation

  // idbSet возвращает false, а не бросает: без явного флага новая форма молча
  // пропала бы после reload, а статус «не сохранено» не загорелся.
  const flagIfNotSaved = (ok) => {
    if (!ok) canvas.setSaveError(true)
    return ok
  }

  // Корзина форм: список для UI (кнопка возврата над деревом). Читается из IDB, поэтому
  // переживает перезагрузку — тост с предложением вернуть форму мог быть пропущен.
  const trash = ref([])
  async function refreshTrash() {
    trash.value = await loadTrash()
  }

  // Загрузить graphJson в живой холст + сброс undo под новую форму. Общий хвост
  // selectForm / createForm / deleteForm (когда меняется активная форма).
  function loadActiveIntoCanvas(graph, paper, json) {
    let synced = { changed: 0, detached: [] }
    withRestoreGuard(restoringHistory, () => {
      // Заморозка только на fromJSON: инъекция ниже ходит через findViewByModel, а у
      // замороженного paper'а представлений новых ячеек нет (paperBatch).
      withPaperFrozen(paper, () => graph.fromJSON(json || { cells: [] }))
      // sync: символ могли править, пока форма была закрыта, а её порты лежат в
      // graphJson. initHistory ниже берёт уже сверенный граф за базу.
      synced = reinjectAllStencils(graph, paper, { sync: true }) || synced
      canvas.bumpVersion()
    })
    initHistory()
    canvas.clearSelection()
    reportDetached(synced)
    // Вписываем содержимое, как кнопка «Вписать»: zoom и translate остаются от прошлой
    // формы, а новая нарисована в своих координатах — иначе форма, начатая далеко от
    // начала координат, открывается за кадром. Пустая просто сбрасывается к 100% и
    // (0,0). nextTick нужен, чтобы ячейки попали в DOM: transformToFitContent мерит его.
    nextTick(() => canvas.fitToContent())
  }

  /**
   * Отцепленные при сверке концы — потеря соединения (порт удалили из символа, пока
   * форма была закрыта). Провода на месте, поэтому warn, а не error. Про обновление
   * портов и габарита не сообщаем: это норма.
   */
  function reportDetached({ detached }) {
    if (!detached.length) return
    notify.warn(
      'Символ изменился',
      `Отцеплено ${nplural(detached.length, 'провод', 'провода', 'проводов')}: порт удалён — перецепите`
    )
  }

  // Флаг «идёт экспорт»: на время прогона форм через живой paper показываем оверлей
  // (иначе формы мелькают на холсте).
  const exportingProject = ref(false)

  /**
   * Переключение активной формы: сохранить текущую (старый activeFormId ещё в сторе)
   * → переключить указатель и мету → загрузить выбранную в граф → сбросить undo.
   */
  async function selectForm(id) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper || id === workspace.activeFormId) return
    // Pending snapshot гасим ПЕРВОЙ строкой, до любого await: иначе таймер формы A
    // выстрелит уже после setActiveFormId(B), пока в графе ещё A, и запишет граф A под
    // ключ B. Правка A не теряется — её персистит saveActiveForm ниже.
    cancelPendingSnapshot()
    if (simulating.value) stopSimulation() // симуляция не должна тащиться на новую форму
    await saveActiveForm()
    workspace.setActiveFormId(id)
    await persistMeta()
    loadActiveIntoCanvas(graph, paper, workspace.getFormGraph(id))
  }

  /**
   * Создать пустую форму и переключиться на неё. Имя автогенерится (`formN`).
   */
  async function createForm() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return
    cancelPendingSnapshot()
    if (simulating.value) stopSimulation()
    await saveActiveForm() // не теряем правки текущей перед переключением
    let n = workspace.formIds.length + 1
    let id = `form${n}`
    while (workspace.hasForm(id)) id = `form${++n}`
    workspace.addForm(id)
    let ok = await persistForm(id, { cells: [] })
    workspace.setActiveFormId(id)
    ok = (await persistMeta()) && ok
    flagIfNotSaved(ok)
    loadActiveIntoCanvas(graph, paper, { cells: [] })
    canvas.markDirty() // новая форма → проект разошёлся с .zip
  }

  /** Свободное имя на базе `base`: `base`, `base2`, `base3`… */
  function uniqueFormId(base) {
    if (!workspace.hasForm(base)) return base
    let n = 2
    while (workspace.hasForm(`${base}${n}`)) n++
    return `${base}${n}`
  }

  /**
   * Дублировать форму (`<id>_copy`) и открыть копию. Граф клонируется `toPlain`:
   * стор держит объекты ячеек, по общей ссылке правка копии уехала бы в оригинал. id
   * ячеек не меняются (уникальны в пределах формы). Узел копии ставится сиблингом —
   * `addForm` кладёт в конец корня.
   */
  async function duplicateForm(id) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper || !workspace.hasForm(id)) return
    cancelPendingSnapshot()
    if (simulating.value) stopSimulation()
    await saveActiveForm() // дублируем актуальное состояние, а не последнее сохранённое
    const copyId = uniqueFormId(`${id}_copy`)
    const json = toPlain(workspace.getFormGraph(id) || { cells: [] })
    workspace.addForm(copyId, json)
    workspace.moveNode(copyId, id, 'after')
    let ok = await persistForm(copyId, json)
    workspace.setActiveFormId(copyId)
    ok = (await persistMeta()) && ok
    flagIfNotSaved(ok)
    loadActiveIntoCanvas(graph, paper, json)
    canvas.markDirty() // новая форма → проект разошёлся с .zip
    notify.success('Форма скопирована', `Открыта «${copyId}»`)
  }

  /**
   * Удалить форму. Нельзя удалить последнюю (в проекте всегда ≥1 форма). Если
   * удаляем активную — холст переключается на оставшуюся; иначе активную не трогаем.
   */
  async function deleteForm(id) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper || !workspace.hasForm(id)) return
    if (workspace.formIds.length <= 1) {
      notify.warn('Нельзя удалить', 'В проекте должна остаться хотя бы одна форма')
      return
    }
    const wasActive = id === workspace.activeFormId
    if (wasActive) cancelPendingSnapshot()
    else await saveActiveForm() // удаляем не активную — её правки сохраняем
    // В корзину — ДО удаления: нужны граф, фон и место в дереве. Ctrl+Z проектные
    // операции не откатывает, поэтому это единственный путь вернуть форму.
    const trashed = await pushTrash({
      id,
      graphJson: toPlain(workspace.getFormGraph(id) || { cells: [] }),
      bg: workspace.formBg[id] ?? null,
      anchor: workspace.nodeAnchor(id),
      ts: Date.now(),
    })
    await refreshTrash()
    const newActive = workspace.removeForm(id)
    await removeFormPersist(id)
    flagIfNotSaved(await persistMeta())
    if (wasActive) loadActiveIntoCanvas(graph, paper, workspace.getFormGraph(newActive))
    canvas.markDirty() // форма удалена → проект разошёлся с .zip
    // Корзина не записалась (квота / read-only) — обещать возврат нельзя.
    if (trashed) notify.info('Форма удалена', `«${id}» можно вернуть кнопкой над деревом форм`)
    else notify.warn('Форма удалена', `«${id}» вернуть не получится — хранилище не приняло копию`)
  }

  /**
   * Вернуть форму из корзины: граф, фон и место в дереве (после прежнего соседа, иначе
   * внутрь прежнего родителя, иначе в конец корня). Активную не меняем — возврат не
   * должен увести пользователя с текущей схемы.
   */
  async function restoreForm(id = trash.value[0]?.id) {
    if (!id) return false
    if (workspace.hasForm(id)) {
      notify.warn('Форма уже есть', `«${id}» в проекте — возвращать нечего`)
      await popTrash(id)
      await refreshTrash()
      return false
    }
    const entry = await popTrash(id)
    await refreshTrash()
    if (!entry) return false
    workspace.addForm(entry.id, entry.graphJson)
    if (entry.bg) workspace.setFormBg(entry.id, entry.bg)
    const anchor = entry.anchor || null
    if (anchor?.prevId && workspace.hasForm(anchor.prevId)) {
      workspace.moveNode(entry.id, anchor.prevId, 'after')
    } else if (anchor?.parentId && workspace.hasForm(anchor.parentId)) {
      workspace.moveNode(entry.id, anchor.parentId, 'inside')
    }
    flagIfNotSaved(await persistForm(entry.id, entry.graphJson))
    flagIfNotSaved(await persistMeta())
    canvas.markDirty()
    notify.success('Форма возвращена', `«${entry.id}» на месте`)
    return true
  }

  /**
   * Переименовать форму (id = ключ стора и IDB, цель навигации, папка экспорта):
   * перенести ключ и починить ссылки `tms.navigation === oldId` во ВСЕХ формах.
   */
  async function renameForm(oldId, newId) {
    if (!workspace.hasForm(oldId)) return false
    const id = String(newId || '').trim()
    if (id === oldId) return true
    if (!FORM_ID_RE.test(id)) {
      notify.warn('Недопустимое имя', 'Только латиница, цифры, _ и -')
      return false
    }
    if (workspace.hasForm(id)) {
      notify.warn('Имя занято', `Форма «${id}» уже есть`)
      return false
    }
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    // Активную флашим: её правки (в т.ч. nav-ссылки) нужны в сторе до скана.
    await saveActiveForm()

    // Переносим ключ формы.
    const json = workspace.getFormGraph(oldId) || { cells: [] }
    workspace.renameForm(oldId, id)
    let ok = await persistForm(id, json)
    await removeFormPersist(oldId)

    // Чиним tms.navigation === oldId во всех формах (ссылки на переименованную).
    let activeChanged = false
    for (const fid of [...workspace.formIds]) {
      const g = workspace.getFormGraph(fid)
      if (!g?.cells?.some((c) => c?.tms?.navigation === oldId)) continue
      const cells = g.cells.map((c) =>
        c?.tms?.navigation === oldId ? { ...c, tms: { ...c.tms, navigation: id } } : c
      )
      const next = { ...g, cells }
      workspace.setFormGraph(fid, next)
      ok = (await persistForm(fid, next)) && ok
      if (fid === workspace.activeFormId) activeChanged = true
    }
    ok = (await persistMeta()) && ok
    flagIfNotSaved(ok)

    // Активная форма содержала ссылку — перезагружаем её в холст, чтобы инспектор и
    // экспорт видели новый target.
    if (activeChanged && graph && paper) {
      cancelPendingSnapshot()
      loadActiveIntoCanvas(graph, paper, workspace.getFormGraph(workspace.activeFormId))
    }
    canvas.markDirty() // переименование (+ фикс nav-ссылок) → расхождение с .zip
    return true
  }

  /**
   * Перенос узла дерева форм (DnD): меняет структуру дерева и мету, граф не трогает.
   */
  async function moveFormNode(dragId, targetId, zone) {
    if (!workspace.moveNode(dragId, targetId, zone)) return
    flagIfNotSaved(await persistMeta())
    canvas.markDirty() // иерархия (hierarchy.json) изменилась → расхождение с .zip
  }

  /**
   * Импорт проекта из .zip: выбор архива → распаковка → применение бандла.
   * Единственный источник импорта.
   */
  async function importProjectFromArchive() {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return
    const file = await pickProjectArchive()
    if (!file) return
    const data = await readProjectZipFile(file)
    // Имя проекта = имя архива без .zip (для топ-бара и имени файла экспорта).
    const projectName = String(file.name || '').replace(/\.zip$/i, '')
    await applyImportedBundle(data, graph, paper, projectName)
  }

  /**
   * Применяет распакованный бандл: парсит формы → заменяет проект в IndexedDB → при
   * наличии символов в бандле шлёт их в dev-плагин (он пишет в definitions/, Vite
   * перезагружает страницу, restoreProject поднимает всё из IDB). Без символов сразу
   * применяет активную форму. Отсутствующие символы попадают в предупреждение.
   */
  async function applyImportedBundle(data, graph, paper, projectName = null) {
    // Символы бандла регистрируются ДО парсинга, иначе parseSvgProject выкинет их
    // ячейки. Берём и новые, и ИЗМЕНЁННЫЕ (проект принёс свою версию существующего
    // символа — она приоритетнее встроенной); неизменённые не трогаем, сравнение по
    // stencilSignature устойчиво к порядку полей.
    const newStencils = []
    const changedStencils = []
    for (const s of data.stencils) {
      const cur = getStencilById(s.id)
      if (!cur) {
        newStencils.push(s)
        continue
      }
      const { svgText, ...curJson } = cur
      if (stencilSignature(curJson, svgText) !== stencilSignature(s.stencilJson, s.shapeSvg)) {
        changedStencils.push(s)
      }
    }
    // registerStencil отклоняет id вне маски: такой символ не попадёт ни в реестр, ни
    // в оверрайды IDB, а его ячейки парсер выкинет — об этом нужно сказать вслух.
    const importedStencils = []
    const rejectedStencils = []
    for (const s of [...newStencils, ...changedStencils]) {
      if (registerStencil(s.stencilJson, s.shapeSvg)) importedStencils.push(s)
      else rejectedStencils.push(String(s.id ?? '?'))
    }

    // Имена форм архива → безопасные id: имя становится ключом формы, целью навигации
    // и путём в исходящем архиве, а `..` в нём уводит файл за папку проекта.
    const renamedForms = renameFormIds(data.forms.map((f) => f.id))

    const forms = []
    const usedStencilIds = new Set()
    let skipped = 0
    // Предупреждения парсера по элементам (выкинутый провод, ячейка без transform):
    // форма грузится `ok`, но может потерять часть ячеек — копим и показываем сводкой.
    const parseWarnings = []
    for (const f of data.forms) {
      const parsed = parseSvgProject(f.svgText)
      for (const id of parsed.stencilIds) usedStencilIds.add(id)
      for (const w of parsed.errors || []) parseWarnings.push(`${f.id}: ${w}`)
      // Пропускается только битый SVG: пустая форма (parsed.ok, 0 ячеек) валидна и
      // сохраняется — на неё могут ссылаться tms.navigation.
      if (!parsed.ok) {
        skipped++
        continue
      }
      // Ссылки навигации адресуют форму по id: после переименования правим и их.
      const cells = remapNavigation(parsed.cells, renamedForms.map)
      forms.push({ id: renamedForms.map.get(f.id) ?? f.id, graphJson: { cells } })
    }
    if (!forms.length) {
      notify.error('Импорт проекта', 'Не найдено валидных форм')
      return
    }

    const persisted = await replaceProject(
      forms,
      data.tagsText,
      // Иерархия и фон привязаны к id формы — переносим их на новые имена.
      remapTree(data.hierarchy, renamedForms.map),
      projectName,
      remapProjectMeta(data.project, renamedForms.map)
    )

    // Символы, на которые ссылаются формы, но которых нет ни в базе, ни в бандле —
    // отрисовать их нечем. Отклонённые по маске сюда не попадают: про них есть
    // отдельный тост.
    const importedIds = new Set(data.stencils.map((s) => s.id))
    const missing = [...usedStencilIds].filter((id) => !getStencilById(id) && !importedIds.has(id))
    if (missing.length) notify.warn('Не хватает символов', missing.join(', '))
    if (rejectedStencils.length) {
      notify.warn('Символы с недопустимым id пропущены', rejectedStencils.join(', '))
    }
    // Имя формы — её адрес в рантайме (цель навигации, имя папки), поэтому о
    // переименовании сообщаем: на объекте прежнее имя могло быть уже прописано.
    if (renamedForms.renamed.length) {
      const head = renamedForms.renamed
        .slice(0, 3)
        .map(([from, to]) => `${from} → ${to}`)
        .join('; ')
      const tail = renamedForms.renamed.length > 3 ? ` (+${renamedForms.renamed.length - 3})` : ''
      notify.warn('Формы переименованы', head + tail)
    }
    if (parseWarnings.length) {
      const head = parseWarnings.slice(0, 5).join('; ')
      const tail = parseWarnings.length > 5 ? ` (+${parseWarnings.length - 5})` : ''
      notify.warn('Часть элементов пропущена при импорте', head + tail)
    }

    // Активная форма рисуется сразу: символы (включая бандл-новые) уже в рантайм-
    // реестре, а reload лишь переподнимет то же самое из IDB.
    const applyActiveForm = () => {
      if (simulating.value) stopSimulation()
      cancelPendingSnapshot()
      const activeJson = workspace.getFormGraph(workspace.activeFormId) || { cells: [] }
      withRestoreGuard(restoringHistory, () => {
        graph.fromJSON(activeJson)
        reinjectAllStencils(graph, paper, { sync: true })
        canvas.bumpVersion()
      })
      initHistory()
      canvas.clearSelection()
      // Импортированный проект совпадает с файлом на диске.
      canvas.markExported()
      // Вписываем импортированный контент: paper стоит на translate(0,0), и формы,
      // нарисованные далеко от начала координат, оказались бы вне экрана.
      nextTick(() => canvas.fitToContent())
    }
    const okMsg =
      nplural(forms.length, 'форма', 'формы', 'форм') + (skipped ? `, пропущено ${skipped}` : '')

    // Запись в IDB упала (квота): сессия рабочая, но reload потеряет часть форм.
    // Рисуем активную форму, сообщаем об ошибке и НЕ пишем символы — они подтянулись
    // бы к уже неполному проекту.
    if (!persisted) {
      applyActiveForm()
      notify.error(
        'Проект сохранён не полностью',
        'Браузер отклонил запись в локальное хранилище — после перезагрузки часть форм может пропасть'
      )
      return
    }

    // Оверрайды символов проекта (новые + изменённые встроенные) → в IDB: переживают
    // reload и в prod, где dev-плагина нет. Набор заменяется целиком.
    await replaceStencilOverrides(importedStencils)
    // На ДИСК (файл в `definitions/` попадает под git) пишутся ТОЛЬКО символы,
    // которых в кодовой базе нет: архив хранит версию на момент своего экспорта, и
    // запись изменённого встроенного откатила бы правки символа в репозитории. В
    // рантайме версия из архива всё равно работает — её держит оверрайд выше.
    const newStencilIds = new Set(newStencils.map((s) => s.stencilJson?.id))
    const toDisk = importedStencils.filter((s) => newStencilIds.has(s.stencilJson?.id))
    if (toDisk.length) persistStencilsToDisk(toDisk)

    applyActiveForm()
    notify.success('Проект импортирован', okMsg)
  }

  /**
   * Прогон всех форм через живой paper → бандл проекта, затем `deliver(bundle)`.
   * Геометрию провода exporter берёт с отрисованного paper, а там живёт только активная
   * форма, поэтому каждая прогоняется через живой граф (под restoreGuard, без autosave
   * и undo); в finally возвращается исходная.
   */
  async function buildAndDeliverBundle(deliver) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return

    const originalActive = workspace.activeFormId
    exportingProject.value = true
    // Отложенный snapshot гасим: его таймер выстрелил бы во время цикла, когда в графе
    // чужая форма, и autosave записал бы её под ключ активной.
    cancelPendingSnapshot()
    try {
      await saveActiveForm() // зафиксировать текущую форму перед прогоном
      const formsOut = []
      const graphs = []
      // Предупреждения exporter'а копим по всем формам: иначе в .zip молча не хватает
      // части оборудования.
      const exportWarnings = []

      for (const id of [...workspace.formIds]) {
        const json = workspace.getFormGraph(id) || { cells: [] }
        graphs.push(json)
        let synced = { changed: 0, detached: [] }
        withRestoreGuard(restoringHistory, () => {
          withPaperFrozen(paper, () => graph.fromJSON(json))
          // sync: в .zip уходит форма, сверенная с реестром, иначе закрытая форма
          // выгрузится с портами прежней версии символа.
          synced = reinjectAllStencils(graph, paper, { sync: true }) || synced
        })
        // Отцепленный конец меняет схему связей — в сводку предупреждений экспорта.
        if (synced.detached.length) {
          exportWarnings.push(`${id}: отцеплено проводов (порт удалён): ${synced.detached.length}`)
        }
        await nextTick() // дать paper отрисовать линии (exporter читает их DOM-путь)
        const result = exportProject(graph, paper)
        formsOut.push({ id, viewSvg: result.svgText, animationsJson: result.animationsJson })
        for (const w of result.warnings || []) exportWarnings.push(`${id}: ${w}`)
      }

      // Используемые символы из реестра (def→stencil.json без svgText, svgText→shape.svg).
      const stencils = collectUsedStencilIds(graphs)
        .map((sid) => {
          const def = getStencilById(sid)
          if (!def) return null
          const { svgText, ...stencilJson } = def
          return { id: sid, stencilJson, shapeSvg: svgText || '' }
        })
        .filter(Boolean)

      const tagsText = await readTagsText()
      await deliver({
        forms: formsOut,
        stencils,
        tagsText,
        hierarchy: workspace.formTree,
        // Редакторная мета: фон холста по формам. В `view.svg` он не уезжает (там фон
        // даёт панель), но нужен, чтобы у коллеги проект открылся в тех же цветах.
        project: { formBg: workspace.formBg },
      })

      // Архив отдан браузеру — снимаем «не выгружено». Подтверждения записи у
      // `<a download>` нет, отсюда формулировка «отправлен на скачивание».
      canvas.markExported()
      notify.success(
        'Архив отправлен на скачивание',
        `${nplural(formsOut.length, 'форма', 'формы', 'форм')}, ` +
          nplural(stencils.length, 'символ', 'символа', 'символов')
      )
      if (exportWarnings.length) {
        const head = exportWarnings.slice(0, 5).join('; ')
        const tail = exportWarnings.length > 5 ? ` (+${exportWarnings.length - 5})` : ''
        notify.warn('Экспорт с предупреждениями', head + tail)
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.error('[Export] Ошибка экспорта проекта:', e)
        notify.error('Ошибка экспорта проекта', e.message || String(e))
      }
    } finally {
      // Исходная форма возвращается в finally: при ошибке посреди прогона холст не
      // должен остаться на чужой. graph/paper читаются заново — могли занулиться на
      // размонтировании. initHistory не нужен: JSON тот же, undo-стек валиден.
      const liveGraph = canvas.graphRef.value
      const livePaper = canvas.paperRef.value
      if (liveGraph && livePaper) {
        const activeJson = workspace.getFormGraph(originalActive) || { cells: [] }
        withRestoreGuard(restoringHistory, () => {
          withPaperFrozen(livePaper, () => liveGraph.fromJSON(activeJson))
          reinjectAllStencils(liveGraph, livePaper)
          canvas.bumpVersion()
        })
      }
      exportingProject.value = false
    }
  }

  /** Экспорт в .zip (скачивание) — единственный формат вывода проекта. Имя файла
   *  = имя проекта (из импортированного архива); нет имени → 'project'. */
  async function exportProjectToArchive() {
    await buildAndDeliverBundle((bundle) => {
      const base = (workspace.projectName || 'project').replace(/[\\/:*?"<>|]/g, '_')
      downloadBlob(buildProjectZipBlob(bundle), `${base}.zip`)
    })
  }

  // Проектные операции мутируют один граф и стор через серии await'ов, поэтому идут
  // через общий busy-флаг: параллельный запуск рассинхронил бы их. Флаг реактивный —
  // useHotkeys гейтит по нему мутирующие хоткеи, иначе paste/undo/delete между
  // await'ами записали бы граф чужой формы.
  const projectBusy = ref(false)
  const withProjectBusy =
    (fn) =>
    async (...args) => {
      if (projectBusy.value) return
      // Незакоммиченная inline-правка текста коммитится ДО операции: fromJSON сменит
      // граф, и правка ушла бы в никуда, а оверлей-textarea остался бы над чужой формой.
      if (textEditing.value) commitTextEdit()
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
    exportingProject,
    projectBusy,
    selectForm: withProjectBusy(selectForm),
    importProjectFromArchive: withProjectBusy(importProjectFromArchive),
    exportProjectToArchive: withProjectBusy(exportProjectToArchive),
    createForm: withProjectBusy(createForm),
    duplicateForm: withProjectBusy(duplicateForm),
    deleteForm: withProjectBusy(deleteForm),
    restoreForm: withProjectBusy(restoreForm),
    renameForm: withProjectBusy(renameForm),
    moveFormNode: withProjectBusy(moveFormNode),
    trash,
    refreshTrash,
  }
}
