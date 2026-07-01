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
import { withRestoreGuard } from '../utils/restoreGuard'
import { nplural } from '../utils/plural'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useNotify } from './useNotify'
import { useCanvas } from './useCanvas'

/**
 * Оркестрация проектных операций: переключение формы, CRUD форм (создать /
 * удалить / переименовать), импорт и экспорт проекта в .zip. Без UI — поэтому
 * логика мутаций графа/стора под сериями await'ов тестируема в изоляции.
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
    await persistForm(id, { cells: [] })
    workspace.setActiveFormId(id)
    await persistMeta()
    loadActiveIntoCanvas(graph, paper, { cells: [] })
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
    await persistMeta()
    if (wasActive) loadActiveIntoCanvas(graph, paper, workspace.getFormGraph(newActive))
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
    await persistForm(id, json)
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
      await persistForm(fid, next)
      if (fid === workspace.activeFormId) activeChanged = true
    }
    await persistMeta()

    // Активная форма содержала ссылку → перезагружаем её в холст, чтобы инспектор
    // и экспорт видели новый target (сброс undo под изменённое состояние).
    if (activeChanged && graph && paper) {
      cancelPendingSnapshot()
      loadActiveIntoCanvas(graph, paper, workspace.getFormGraph(workspace.activeFormId))
    }
    return true
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
    await applyImportedBundle(data, graph, paper)
  }

  /**
   * Применяет распакованный бандл проекта: парсит формы → заменяет проект в
   * IndexedDB → если в бандле есть стенсилы, шлём их в dev-плагин
   * (он пишет в definitions/ → Vite авто-reload, на ребуте restoreProject поднимет
   * всё из IDB). Стенсилов нет → применяем активную форму сразу. Предупреждаем о
   * стенсилах, которых нет ни в базе, ни в бандле.
   */
  async function applyImportedBundle(data, graph, paper) {
    // Бандл-стенсилы, которых нет в базе, регистрируем в рантайме ДО парсинга —
    // иначе parseSvgProject выкинет их ячейки. Список фиксируем здесь (после
    // регистрации getStencilById вернёт их) — он же идёт в POST для записи файлов.
    // Уже имеющиеся в базе НЕ трогаем: перезапись через JSON.stringify сбила бы
    // рукописное форматирование committed-файлов → git-шум, семантика и так на месте.
    const newStencils = data.stencils.filter((s) => !getStencilById(s.id))
    for (const s of newStencils) registerStencil(s.stencilJson, s.shapeSvg)

    const forms = []
    const usedStencilIds = new Set()
    let skipped = 0
    for (const f of data.forms) {
      const parsed = parseSvgProject(f.svgText)
      for (const id of parsed.stencilIds) usedStencilIds.add(id)
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

    const persisted = await replaceProject(forms, data.tagsText, data.hierarchy)

    // Стенсилы, на которые ссылаются формы (по meta SVG), но которых нет ни в базе,
    // ни в бандле — отрисовать их нечем, предупреждаем.
    const importedIds = new Set(data.stencils.map((s) => s.id))
    const missing = [...usedStencilIds].filter((id) => !getStencilById(id) && !importedIds.has(id))
    if (missing.length) notify.warn('Не хватает стенсилов', missing.join(', '))

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

    // Новые стенсилы пишем в definitions/ (dev-плагин) — reload сделает рантайм-
    // регистрацию персистентной. Уже имеющиеся в POST не попадают (отфильтрованы выше).
    if (newStencils.length) {
      let written = false
      try {
        const res = await fetch('/__stencils/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(newStencils),
        })
        written = res.ok
      } catch {
        written = false
      }
      if (written) {
        // Файлы записаны в definitions/ — на диске для будущих сессий (glob их
        // подхватит). Vite обычно делает full-reload (restoreProject поднимет всё
        // из IDB), но НЕ ждём его: стенсилы уже в рантайм-реестре, рисуем форму
        // сразу. Холст корректен, даже если reload не придёт (HMR-патч).
        applyActiveForm()
        notify.success('Проект импортирован', okMsg)
      } else {
        // dev-плагин недоступен/ошибка: формы применяем, но ячейки на новые
        // стенсилы не отрисуются (см. предупреждение о недостающих стенсилах).
        applyActiveForm()
        notify.warn(
          'Проект импортирован без новых стенсилов',
          'Не удалось записать стенсилы (dev-плагин).'
        )
      }
    } else {
      applyActiveForm()
      notify.success('Проект импортирован', okMsg)
    }
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
    if (textEditing.value) commitTextEdit() // не потерять незакоммиченную правку текста

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

      notify.success(
        'Проект экспортирован',
        `${nplural(formsOut.length, 'форма', 'формы', 'форм')}, ` +
          nplural(stencils.length, 'стенсил', 'стенсила', 'стенсилов')
      )
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

  /** Экспорт в .zip (скачивание) — единственный формат вывода проекта. */
  async function exportProjectToArchive() {
    await buildAndDeliverBundle((bundle) =>
      downloadBlob(buildProjectZipBlob(bundle), 'project.zip')
    )
  }

  // Проектные операции мутируют один граф/стор через серии await'ов. Параллельный
  // запуск рассинхронил бы их (оверлей экспорта накрывает только canvas, а дерево
  // форм в левой панели остаётся кликабельным → клик по форме во время экспорта/
  // импорта влез бы в один граф). Гоняем все через общий busy-флаг — на уровне логики, не UI.
  let projectBusy = false
  const withProjectBusy =
    (fn) =>
    async (...args) => {
      if (projectBusy) return
      projectBusy = true
      try {
        return await fn(...args)
      } finally {
        projectBusy = false
      }
    }

  return {
    exportingProject,
    selectForm: withProjectBusy(selectForm),
    importProjectFromArchive: withProjectBusy(importProjectFromArchive),
    exportProjectToArchive: withProjectBusy(exportProjectToArchive),
    createForm: withProjectBusy(createForm),
    deleteForm: withProjectBusy(deleteForm),
    renameForm: withProjectBusy(renameForm),
  }
}
