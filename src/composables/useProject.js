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
import { nplural } from '../utils/plural'
import { toPlain } from '../utils/plain'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useUiStore } from '../stores/useUiStore'
import { useNotify } from './useNotify'
import { useCanvas } from './useCanvas'

/**
 * Оркестрация проектных операций: переключение формы, CRUD форм (создать /
 * дублировать / удалить / переименовать), импорт и экспорт проекта в .zip. Без UI
 * — поэтому логика мутаций графа/стора под сериями await'ов тестируема в изоляции.
 *
 * graph/paper берём из `useCanvas` (как `useAutosave`); зависимости из других
 * композаблов инжектятся бэгом — их lifecycle-хуки должны жить в компоненте.
 * Возвращает уже обёрнутые в общий `projectBusy` функции (взаимное исключение —
 * параллельный запуск мутировал бы один граф) + ref `exportingProject` для оверлея.
 *
 * @param {object} deps
 * @param {import('vue').Ref<boolean>} deps.restoringHistory — общий флаг с undo/autosave
 * @param {{ saveActiveForm, persistMeta, replaceProject, readTagsText, persistForm, removeFormPersist }} deps.autosave
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
  } = autosave
  const { cancelPendingSnapshot, initHistory } = undo
  const { stopSimulation, simulating } = simulation

  // Допустимое имя формы (= имя папки при экспорте = цель навигации).
  const FORM_ID_RE = /^[A-Za-z0-9_-]+$/

  // idbSet возвращает false, не бросает (запись формы/меты могла не пройти —
  // квота / приватный режим). Флагаем явно: иначе новая/переименованная форма
  // молча пропадёт после reload, а «не сохранено» не загорится.
  const flagIfNotSaved = (ok) => {
    if (!ok) canvas.setSaveError(true)
    return ok
  }

  // Загрузить graphJson в живой холст + сброс undo под новую форму. Общий хвост
  // selectForm / createForm / deleteForm (когда меняется активная форма).
  function loadActiveIntoCanvas(graph, paper, json) {
    withRestoreGuard(restoringHistory, () => {
      graph.fromJSON(json || { cells: [] })
      reinjectAllStencils(graph, paper)
      canvas.bumpVersion()
    })
    initHistory()
    canvas.clearSelection()
  }

  // Флаг «идёт экспорт проекта» — на время прогона форм через живой paper
  // показываем оверлей (формы мелькают на холсте).
  const exportingProject = ref(false)

  /**
   * Переключение активной формы (зовётся панелью форм через canvas.selectForm).
   * Сохраняем текущую форму (старый activeFormId ещё в сторе) → переключаем
   * указатель + мету → грузим выбранную в граф → сбрасываем undo под новую форму.
   */
  async function selectForm(id) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper || id === workspace.activeFormId) return
    // Гасим pending snapshot ПЕРВОЙ строкой, до любого await: иначе таймер формы A
    // выстрелит во время await saveActiveForm/persistMeta — уже после
    // setActiveFormId(B), пока в графе ещё A — и запишет граф A под ключ B.
    // Сама правка A не теряется: saveActiveForm ниже её персистит.
    cancelPendingSnapshot()
    if (simulating.value) stopSimulation() // симуляция не должна тащиться на новую форму
    await saveActiveForm()
    workspace.setActiveFormId(id)
    await persistMeta()
    loadActiveIntoCanvas(graph, paper, workspace.getFormGraph(id))
  }

  /**
   * Создать новую пустую форму и переключиться на неё. Имя автогенерится
   * (`formN`, уникальное) — переименовать можно в панели форм.
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
   * Дублировать форму (`<id>_copy`) и переключиться на копию. Граф клонируем
   * через `toPlain`: стор держит объекты ячеек, и по общей ссылке правка копии
   * уехала бы в оригинал. id ячеек не меняем — они уникальны в пределах формы,
   * а экспорт пер-форма. Узел копии ставим сиблингом после исходной
   * (`addForm` кладёт в конец корня — копия улетала бы от родителя).
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
    const newActive = workspace.removeForm(id)
    await removeFormPersist(id)
    flagIfNotSaved(await persistMeta())
    if (wasActive) loadActiveIntoCanvas(graph, paper, workspace.getFormGraph(newActive))
    canvas.markDirty() // форма удалена → проект разошёлся с .zip
  }

  /**
   * Переименовать форму (id = имя везде: ключ стора/IDB, цель навигации, папка
   * экспорта). Переносим ключ + чиним ссылки `tms.navigation === oldId` во ВСЕХ
   * формах на новое имя (иначе они повисли бы битыми). Возвращает true/false.
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
    // Флашим активную: её правки (в т.ч. nav-ссылки) должны попасть в стор до скана.
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

    // Активная форма содержала ссылку → перезагружаем её в холст, чтобы инспектор
    // и экспорт видели новый target (сброс undo под изменённое состояние).
    if (activeChanged && graph && paper) {
      cancelPendingSnapshot()
      loadActiveIntoCanvas(graph, paper, workspace.getFormGraph(workspace.activeFormId))
    }
    canvas.markDirty() // переименование (+ фикс nav-ссылок) → расхождение с .zip
    return true
  }

  /**
   * Перенос узла дерева форм (DnD в FormTree). Меняет только структуру дерева +
   * персист меты — граф/холст не трогает (иерархия = метаданные редактора).
   */
  async function moveFormNode(dragId, targetId, zone) {
    if (!workspace.moveNode(dragId, targetId, zone)) return
    flagIfNotSaved(await persistMeta())
    canvas.markDirty() // иерархия (hierarchy.json) изменилась → расхождение с .zip
  }

  /**
   * Импорт проекта из .zip (зовётся ProjectActions через canvas.importProjectFromArchive).
   * Выбор архива → распаковка → применяем бандл. Единственный источник импорта.
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
   * Применяет распакованный бандл проекта: парсит формы → заменяет проект в
   * IndexedDB → если в бандле есть стенсилы, шлём их в dev-плагин
   * (он пишет в definitions/ → Vite авто-reload, на ребуте restoreProject поднимет
   * всё из IDB). Стенсилов нет → применяем активную форму сразу. Предупреждаем о
   * стенсилах, которых нет ни в базе, ни в бандле.
   */
  async function applyImportedBundle(data, graph, paper, projectName = null) {
    // Бандл-стенсилы регистрируем в рантайме ДО парсинга — иначе parseSvgProject
    // выкинет их ячейки. Регистрируем не только новые (которых нет в реестре), но и
    // ИЗМЕНЁННЫЕ: если проект принёс другую версию существующего стенсила (правка
    // заливки/анимации cell_qw и т.п.), берём её — иначе правки «слетали» бы на
    // встроенную версию. Неизменённые встроенные не трогаем (сравнение по
    // stencilSignature, устойчиво к порядку полей).
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
    const importedStencils = [...newStencils, ...changedStencils]
    for (const s of importedStencils) registerStencil(s.stencilJson, s.shapeSvg)

    const forms = []
    const usedStencilIds = new Set()
    let skipped = 0
    // Пер-элементные предупреждения парсера (выкинутый провод, ячейка без transform
    // и т.п.) — форма может загрузиться `ok`, но молча потерять часть ячеек. Копим
    // и показываем сводкой, иначе пропажа уходит только в возвращаемое значение.
    const parseWarnings = []
    for (const f of data.forms) {
      const parsed = parseSvgProject(f.svgText)
      for (const id of parsed.stencilIds) usedStencilIds.add(id)
      for (const w of parsed.errors || []) parseWarnings.push(`${f.id}: ${w}`)
      // Пропускаем только битый SVG. Пустая форма (parsed.ok, 0 ячеек) валидна —
      // сохраняем как цель навигации/заготовку, иначе рвутся ссылки tms.navigation.
      if (!parsed.ok) {
        skipped++
        continue
      }
      forms.push({ id: f.id, graphJson: { cells: parsed.cells } })
    }
    if (!forms.length) {
      notify.error('Импорт проекта', 'Не найдено валидных форм')
      return
    }

    const persisted = await replaceProject(forms, data.tagsText, data.hierarchy, projectName)

    // Стенсилы, на которые ссылаются формы (по meta SVG), но которых нет ни в базе,
    // ни в бандле — отрисовать их нечем, предупреждаем.
    const importedIds = new Set(data.stencils.map((s) => s.id))
    const missing = [...usedStencilIds].filter((id) => !getStencilById(id) && !importedIds.has(id))
    if (missing.length) notify.warn('Не хватает стенсилов', missing.join(', '))
    if (parseWarnings.length) {
      const head = parseWarnings.slice(0, 5).join('; ')
      const tail = parseWarnings.length > 5 ? ` (+${parseWarnings.length - 5})` : ''
      notify.warn('Часть элементов пропущена при импорте', head + tail)
    }

    // Грузит активную форму в граф. Стенсилы (включая бандл-новые) уже в рантайм-
    // реестре, поэтому рисуем сразу — reload, если случится, лишь переподнимет то
    // же самое из IDB.
    const applyActiveForm = () => {
      if (simulating.value) stopSimulation()
      cancelPendingSnapshot()
      const activeJson = workspace.getFormGraph(workspace.activeFormId) || { cells: [] }
      withRestoreGuard(restoringHistory, () => {
        graph.fromJSON(activeJson)
        reinjectAllStencils(graph, paper)
        canvas.bumpVersion()
      })
      initHistory()
      canvas.clearSelection()
      // Импортированный проект = то, что на диске → расхождения с .zip нет.
      canvas.markExported()
      // Вписываем импортированный контент в область видимости (иначе paper стоит на
      // translate(0,0) и формы, нарисованные не у левого-верхнего угла, вне экрана).
      nextTick(() => canvas.fitToContent())
    }
    const okMsg =
      nplural(forms.length, 'форма', 'формы', 'форм') + (skipped ? `, пропущено ${skipped}` : '')

    // Запись в IDB упала (квота / браузер отклонил) — стор загружен, сессия рабочая,
    // но reload потеряет часть форм. Рисуем активную для текущей сессии, не врём про
    // успех и НЕ пишем стенсилы (их reload подхватил бы вместе с уже неполным проектом).
    if (!persisted) {
      applyActiveForm()
      notify.error(
        'Проект сохранён не полностью',
        'Браузер отклонил запись в локальное хранилище — после перезагрузки часть форм может пропасть'
      )
      return
    }

    // Оверрайды стенсилов проекта (новые + изменённые встроенные) → в IDB: они
    // переживут reload и в prod, где dev-плагина нет. Заменяем весь набор — импорт
    // меняет проект целиком. Это делает стенсилы персистентными независимо от
    // persistStencilsToDisk ниже (тот — dev-бонус: пишет файлы в definitions/,
    // чтобы новый стенсил попал в кодовую базу под git).
    await replaceStencilOverrides(importedStencils)
    if (importedStencils.length) persistStencilsToDisk(importedStencils)

    applyActiveForm()
    notify.success('Проект импортирован', okMsg)
  }

  /**
   * Прогон всех форм через живой paper → бандл проекта, затем `deliver(bundle)`
   * доставляет его (скачивание .zip). Геометрию провода exporter берёт из
   * отрисованного paper, а на нём живёт только активная форма → каждую форму
   * прогоняем через живой граф (под restoreGuard, без autosave/undo), снимаем
   * view.svg+animations.json, в finally возвращаем исходную. Стенсилы — used из
   * реестра (GC); теги — из бандла проекта (IDB).
   */
  async function buildAndDeliverBundle(deliver) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper) return

    const originalActive = workspace.activeFormId
    exportingProject.value = true
    // Гасим отложенный snapshot: иначе его таймер выстрелит во время цикла (между
    // await'ами restoringHistory снят), а в графе уже чужая форма → autosave
    // запишет её JSON под ключ активной. fromJSON в цикле под guard'ом новых не
    // планирует, так что одного сброса здесь достаточно.
    cancelPendingSnapshot()
    try {
      await saveActiveForm() // зафиксировать текущую форму перед прогоном
      const formsOut = []
      const graphs = []
      // Предупреждения exporter'а (пропущенные стенсилы, дубли valueTag) — иначе
      // они уходят только в console.warn, и в поставленном .zip молча нет части
      // оборудования. Копим по всем формам и показываем сводкой ниже.
      const exportWarnings = []

      for (const id of [...workspace.formIds]) {
        const json = workspace.getFormGraph(id) || { cells: [] }
        graphs.push(json)
        withRestoreGuard(restoringHistory, () => {
          graph.fromJSON(json)
          reinjectAllStencils(graph, paper)
        })
        await nextTick() // дать paper отрисовать линии (exporter читает их DOM-путь)
        const result = exportProject(graph, paper)
        formsOut.push({ id, viewSvg: result.svgText, animationsJson: result.animationsJson })
        for (const w of result.warnings || []) exportWarnings.push(`${id}: ${w}`)
      }

      // Используемые стенсилы из реестра (def→stencil.json без svgText, svgText→shape.svg).
      const stencils = collectUsedStencilIds(graphs)
        .map((sid) => {
          const def = getStencilById(sid)
          if (!def) return null
          const { svgText, ...stencilJson } = def
          return { id: sid, stencilJson, shapeSvg: svgText || '' }
        })
        .filter(Boolean)

      const tagsText = await readTagsText()
      await deliver({ forms: formsOut, stencils, tagsText, hierarchy: workspace.formTree })

      // Архив отдан браузеру → снимаем «не выгружено». Подтверждения, что файл
      // реально сохранён, у `<a download>` нет (клик синхронный, отмена диалога
      // молчит), поэтому формулировки нейтральные: «отправлен на скачивание», а не
      // «сохранён». Точный статус дал бы showSaveFilePicker (writable stream).
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
      // Возвращаем исходную активную форму на холст — в finally, чтобы при ошибке
      // посреди прогона холст не остался на чужой форме (рассинхрон со стором).
      // graph/paper читаем заново: могли занулиться, если компонент размонтировался
      // во время await. initHistory НЕ зовём: восстанавливаем тот же JSON, что был
      // до экспорта (промежуточные fromJSON шли под restoreGuard, снапшотов не
      // писали), поэтому undo-стек остаётся валидным — сброс означал бы потерю истории.
      const liveGraph = canvas.graphRef.value
      const livePaper = canvas.paperRef.value
      if (liveGraph && livePaper) {
        const activeJson = workspace.getFormGraph(originalActive) || { cells: [] }
        withRestoreGuard(restoringHistory, () => {
          liveGraph.fromJSON(activeJson)
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

  // Проектные операции мутируют один граф/стор через серии await'ов. Параллельный
  // запуск рассинхронил бы их (оверлей экспорта накрывает только canvas, а дерево
  // форм в левой панели остаётся кликабельным → клик по форме во время экспорта/
  // импорта влез бы в один граф). Гоняем все через общий busy-флаг. Реактивный —
  // useHotkeys читает его, чтобы гейтить мутирующие хоткеи (paste/undo/delete во
  // время прогона писали бы граф чужой формы в store/IDB между await'ами).
  const projectBusy = ref(false)
  const withProjectBusy =
    (fn) =>
    async (...args) => {
      if (projectBusy.value) return
      // Незакоммиченная inline-правка текста — ДО любой операции: fromJSON ниже
      // сменит граф, и правка ушла бы в никуда (ячейки уже нет), а оверлей-textarea
      // остался бы висеть над чужой формой.
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
    renameForm: withProjectBusy(renameForm),
    moveFormNode: withProjectBusy(moveFormNode),
  }
}
