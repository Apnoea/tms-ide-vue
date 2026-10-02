import { ref, nextTick } from 'vue'
import { reinjectAllStencils, syncStencilInstances } from '../stencils/svgInjector'
import { createCanvasGraph } from '../stencils/canvasPaper'
import {
  getAllStencils,
  getStencilById,
  isPresetStencil,
  registerStencil,
} from '../stencils/registry'
import {
  migrateFormsRanges,
  planRangeMigration,
  planWireRangeCleanup,
} from '../services/rangeMigration'
import { exportProject } from '../services/exporter'
import { parseSvgProject } from '../services/projectLoader'
import {
  buildProjectZipBlob,
  downloadBlob,
  pickProjectArchive,
  readProjectZipFile,
} from '../services/projectZip'
import { persistStencilsToDisk } from '../services/stencilLibrary'
import { loadPresets, presetStencilBase, rebaseOverrides } from '../services/presetLibrary'
import {
  loadStencilOverrides,
  replaceStencilOverrides,
  stencilSignature,
  upsertStencilOverride,
} from '../services/stencilOverrides'
import { withPaperFrozen, withRestoreGuard } from '../utils/graphBatch'
import {
  renameFormIds,
  remapNavigation,
  remapTree,
  remapProjectMeta,
  withImportedFormText,
} from '../utils/formIds'
import { RANGE_SLOT, safeFormId } from '../constants/ids'
import { nplural } from '../utils/plural'
import { normalizePresetPatch, rebaseOnPreset } from '../utils/presetPatch'
import { usePresets } from './usePresets'

/**
 * Проект целиком: импорт и экспорт .zip, разовые миграции диапазонов после
 * восстановления и сверка символа во всех закрытых формах. Часть useProject:
 * зависимости и `flagIfNotSaved` приходят его контекстом, busy-гейт ставит он же.
 *
 * @param {object} ctx — контекст useProject
 */
export function useProjectArchive(ctx) {
  const { canvas, workspace, notify, restoringHistory, flagIfNotSaved } = ctx
  const { saveActiveForm, replaceProject, readTagsText, persistForm } = ctx.autosave
  const { cancelPendingSnapshot, initHistory } = ctx.undo
  const { stopSimulation, simulating } = ctx.simulation
  const { adoptProjectPresets } = usePresets()

  // Флаг «идёт экспорт»: на время прогона форм через живой paper показываем оверлей
  // (иначе формы мелькают на холсте).
  const exportingProject = ref(false)

  /**
   * Разовый перенос диапазонов с элементов в символы: строки уезжают в определение
   * символа, тег остаётся на ячейке в слоте `range`. План считает чистая
   * `planRangeMigration` — символ забирает только набор, одинаковый у ВСЕХ его ячеек.
   * Зовётся после восстановления проекта; переносить нечего — молчит.
   */
  async function migrateRangesToStencils() {
    const forms = workspace.formIds.map((id) => ({ id, graphJson: workspace.getFormGraph(id) }))
    const plan = planRangeMigration(forms, getStencilById)
    if (!plan.stencils.length) return 0

    const saved = []
    for (const { id, ranges } of plan.stencils) {
      const { svgText, ...json } = getStencilById(id)
      const slots = json.slots || []
      json.ranges = ranges
      json.slots = slots.some((sl) => sl.key === RANGE_SLOT)
        ? slots
        : [...slots, { key: RANGE_SLOT, type: 'Value' }]
      if (!registerStencil(json, svgText)) continue
      flagIfNotSaved(await upsertStencilOverride({ id, stencilJson: json, shapeSvg: svgText }))
      saved.push({ id, stencilJson: json, shapeSvg: svgText })
    }
    if (!saved.length) return 0
    // Файлы в src/library/ — dev-бонус: в prod плагина нет, правка живёт в оверрайдах.
    await persistStencilsToDisk(saved)

    // Формы — только по символам, которые зоны реально приняли: ячейки прочих остаются
    // с собственным источником, иначе они потеряли бы цвет.
    const applied = migrateFormsRanges(forms, new Set(saved.map((s) => s.id)))
    for (const { id, graphJson } of applied.forms) {
      workspace.setFormGraph(id, graphJson)
      flagIfNotSaved(await persistForm(id, graphJson))
    }
    canvas.markDirty()
    notify.info(
      'Диапазоны перенесены в символы',
      `${nplural(saved.length, 'символ', 'символа', 'символов')} · элементов: ${applied.moved}`
    )
    return saved.length
  }

  /**
   * Разовая очистка проводов от диапазонов, совпадающих с унаследованными (см.
   * planWireRangeCleanup). Зовётся после переноса зон в символы: к тому моменту символы
   * уже отдают свои зоны, и совпадение с ними тоже считается. Снимать нечего — молчит.
   */
  async function cleanupInheritedRanges() {
    const forms = workspace.formIds.map((id) => ({ id, graphJson: workspace.getFormGraph(id) }))
    const plan = planWireRangeCleanup(forms, getStencilById)
    if (!plan.cleared) return 0
    for (const { id, graphJson } of plan.forms) {
      workspace.setFormGraph(id, graphJson)
      flagIfNotSaved(await persistForm(id, graphJson))
    }
    canvas.markDirty()
    notify.info(
      'Диапазоны проводов наследуются',
      `Снято настроек: ${plan.cleared} — они совпадали с источником (шина или символ)`
    )
    return plan.cleared
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
   * наличии символов в бандле шлёт их в dev-плагин (он пишет в src/library/, Vite
   * перезагружает страницу, restoreProject поднимает всё из IDB). Без символов сразу
   * применяет активную форму. Отсутствующие символы попадают в предупреждение.
   */
  async function applyImportedBundle(data, graph, paper, projectName = null) {
    // Наборы из архива — первыми: символы проекта строятся поверх установленной версии.
    const presetReport = await adoptProjectPresets(data.presets)
    const { stencils: archiveStencils, drawingReset } = rebaseArchiveStencils(data.stencils)

    // Символы бандла регистрируются ДО парсинга, иначе parseSvgProject выкинет их
    // ячейки. Берём и новые, и ИЗМЕНЁННЫЕ (проект принёс свою версию существующего
    // символа — она приоритетнее встроенной); неизменённые не трогаем, сравнение по
    // stencilSignature устойчиво к порядку полей.
    const newStencils = []
    const changedStencils = []
    for (const s of archiveStencils) {
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
      // Проект не заменился, а приём наборов выше уже вернул их символы к поставке —
      // возвращаем правки текущего проекта (его оверрайды в IDB целы).
      for (const s of rebaseOverrides(await loadStencilOverrides()).items) {
        registerStencil(s.stencilJson, s.shapeSvg)
      }
      notify.error('Импорт проекта', 'Не найдено валидных форм')
      return
    }

    const persisted = await replaceProject(
      forms,
      data.tagsText,
      // Иерархия, фон и название привязаны к id формы — переносим их на новые имена.
      remapTree(data.hierarchy, renamedForms.map),
      projectName,
      remapProjectMeta(
        withImportedFormText(
          data.project,
          { titles: data.navTitles, descriptions: data.navDescriptions },
          renamedForms.renamed
        ),
        renamedForms.map
      )
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
      // Наборы к этому моменту уже поставлены — о них надо сказать и здесь.
      reportProjectPresets(presetReport, drawingReset)
      return
    }

    // Оверрайды символов проекта (новые + изменённые встроенные) → в IDB: переживают
    // reload и в prod, где dev-плагина нет. Пишем набор ВСЕГДА, даже пустой — у
    // проекта без своих символов прежние оверрайды обязаны уйти. Запись не прошла:
    // символы архива живут до перезагрузки, и молчать об этом нельзя.
    const overridesSaved = flagIfNotSaved(await replaceStencilOverrides(importedStencils))
    if (!overridesSaved && importedStencils.length) {
      notify.warn(
        'Символы проекта не сохранены',
        'Браузер отклонил запись — после перезагрузки вернутся встроенные версии'
      )
    }
    // На ДИСК (файл в `src/library/` попадает под git) пишутся ТОЛЬКО символы,
    // которых в кодовой базе нет: архив хранит версию на момент своего экспорта, и
    // запись изменённого встроенного откатила бы правки символа в репозитории. В
    // рантайме версия из архива всё равно работает — её держит оверрайд выше. Символы
    // наборов не пишутся вовсе: в `src/library/` они стали бы встроенными.
    const newStencilIds = new Set(newStencils.map((s) => s.stencilJson?.id))
    const toDisk = importedStencils.filter(
      (s) => newStencilIds.has(s.stencilJson?.id) && !isPresetStencil(s.stencilJson)
    )
    if (toDisk.length) persistStencilsToDisk(toDisk)

    applyActiveForm()
    notify.success('Проект импортирован', okMsg)
    reportProjectPresets(presetReport, drawingReset)
  }

  /**
   * Символы наборов из `library/` архива — на установленную версию с правками проекта
   * (`rebaseOnPreset`). Символ, совпавший с поставкой, из списка выпадает: исходник уже
   * в реестре. Символ без установленного набора едет как есть.
   *
   * Патч из архива — чужие данные, поэтому чистится. Его отсутствие у символа с меткой
   * значит «правок нет», а не снимок прошлого формата: снимки жили только в IDB, в
   * архив символ набора всегда уходит с патчем или без правок.
   */
  function rebaseArchiveStencils(stencils) {
    const out = []
    const drawingReset = []
    for (const s of stencils) {
      const base = isPresetStencil(s.stencilJson) ? presetStencilBase(s.id) : null
      if (!base) {
        out.push(s)
        continue
      }
      const presetPatch = normalizePresetPatch(s.stencilJson.presetPatch) || {}
      const r = rebaseOnPreset(base, { ...s, stencilJson: { ...s.stencilJson, presetPatch } })
      if (r.drawingReset) drawingReset.push(s.id)
      if (!r.pristine) out.push({ id: s.id, stencilJson: r.json, shapeSvg: r.svg })
    }
    return { stencils: out, drawingReset }
  }

  /** Что импорт сделал с наборами — одним тостом; сброшенное и пропущенное — warn. */
  function reportProjectPresets(report, drawingReset) {
    const what = []
    if (report.installed.length) what.push(`установлены ${report.installed.join(', ')}`)
    if (report.updated.length) what.push(`обновлены до ${report.updated.join(', ')}`)
    if (report.older.length) {
      what.push(`проект собран на более старых: ${report.older.join(', ')} — показаны по твоим`)
    }
    if (report.skipped.length) what.push(`не установлены: ${report.skipped.join(', ')}`)
    if (drawingReset.length) {
      what.push(`видимость фигур сброшена (другая версия набора): ${drawingReset.join(', ')}`)
    }
    if (!report.saved) what.push('браузер отклонил запись — после перезагрузки наборов не будет')
    if (!what.length) return
    const attention = report.skipped.length || drawingReset.length || !report.saved
    notify[attention ? 'warn' : 'info']('Наборы символов проекта', what.join('; '))
  }

  /**
   * Правка символа → во ВСЕ формы проекта. Активную сверяет сам редактор (ему нужно
   * выделить отцепленные концы), здесь — остальные.
   *
   * Формы прогоняются через ТЕНЕВОЙ граф, без paper: сверке нужна только модель
   * (порты, габарит, концы проводов), а перерисовка в `syncStencilInstances`
   * опциональна. Живой холст при этом не трогается — иначе на нём одна за другой
   * мелькают чужие формы, и после `await persistForm` браузер успевает их показать.
   *
   * @param {string|string[]} stencilId — символ или НАБОР символов (обновление
   *   поставляемого набора правит их разом: форма читается и пишется один раз, а не
   *   по прогону на каждый символ)
   * @returns {Promise<{forms: number, changed: number, detached: number}>}
   */
  async function syncStencilInClosedForms(stencilId, prev = null) {
    const ids = Array.isArray(stencilId) ? stencilId : [stencilId]
    const stencils = ids.map((id) => getStencilById(id)).filter(Boolean)
    const report = { forms: 0, changed: 0, detached: 0 }
    if (!stencils.length) return report

    const others = [...workspace.formIds].filter((id) => id !== workspace.activeFormId)
    if (!others.length) return report

    const shadow = createCanvasGraph()
    for (const id of others) {
      shadow.fromJSON(workspace.getFormGraph(id) || { cells: [] })
      const synced = { changed: 0, detached: [] }
      for (const stencil of stencils) {
        const one = syncStencilInstances(shadow, null, stencil, prev)
        if (!one) continue
        synced.changed += one.changed
        synced.detached.push(...one.detached)
      }
      if (!synced.changed && !synced.detached.length) continue
      const json = shadow.toJSON()
      workspace.setFormGraph(id, json)
      flagIfNotSaved(await persistForm(id, json))
      report.forms += 1
      report.changed += synced.changed
      report.detached += synced.detached.length
    }
    return report
  }

  /** `project.json` архива: только непустые поля, без них — null (файл не пишется). */
  function projectMetaForArchive() {
    const meta = {}
    if (Object.keys(workspace.formBg).length) meta.formBg = workspace.formBg
    if (Object.keys(workspace.formTitle).length) meta.formTitle = workspace.formTitle
    if (Object.keys(workspace.formDescription).length) {
      meta.formDescription = workspace.formDescription
    }
    return Object.keys(meta).length ? meta : null
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
      // Предупреждения exporter'а копим по всем формам: иначе в .zip молча не хватает
      // части оборудования.
      const exportWarnings = []

      for (const id of [...workspace.formIds]) {
        let json = workspace.getFormGraph(id) || { cells: [] }
        let synced = { changed: 0, detached: [] }
        withRestoreGuard(restoringHistory, () => {
          withPaperFrozen(paper, () => graph.fromJSON(json))
          // sync: в .zip уходит форма, сверенная с реестром, иначе закрытая форма
          // выгрузится с портами прежней версии символа.
          synced = reinjectAllStencils(graph, paper, { sync: true }) || synced
        })
        // Сверка ПРАВИТ граф (порты, габарит, отцепление концов), поэтому её результат
        // сохраняется: иначе в архив уходит одна форма, а в проекте остаётся другая, и
        // предупреждение об отцепленных возвращается при каждом её открытии.
        if (synced.changed) {
          json = graph.toJSON()
          workspace.setFormGraph(id, json)
          flagIfNotSaved(await persistForm(id, json))
        }
        // Отцепленный конец меняет схему связей — в сводку предупреждений экспорта.
        if (synced.detached.length) {
          exportWarnings.push(`${id}: отцеплено проводов (порт удалён): ${synced.detached.length}`)
        }
        await nextTick() // дать paper отрисовать линии (exporter читает их DOM-путь)
        const result = exportProject(graph, paper)
        formsOut.push({ id, viewSvg: result.svgText, animationsJson: result.animationsJson })
        for (const w of result.warnings || []) exportWarnings.push(`${id}: ${w}`)
      }

      // В `library/` уезжает ВСЯ палитра, а не только символы со схем: проект —
      // контейнер работы, и символ, нарисованный про запас, обязан пережить перенос на
      // другую машину. (def→stencil.json без svgText, svgText→shape.svg)
      const stencils = getAllStencils().map(({ svgText, ...stencilJson }) => ({
        id: stencilJson.id,
        stencilJson,
        shapeSvg: svgText || '',
      }))

      const tagsText = await readTagsText()
      await deliver({
        forms: formsOut,
        stencils,
        tagsText,
        hierarchy: workspace.formTree,
        // Названия и описания — в `name` и `description` узлов `nav.json`: его читает
        // навигация рантайма.
        titles: workspace.formTitle,
        descriptions: workspace.formDescription,
        // Редакторная мета: фон холста, названия и описания по формам. Фон в `view.svg`
        // не уезжает (там фон даёт панель), но нужен, чтобы у коллеги проект открылся в
        // тех же цветах; тексты дублируются сюда ради форм вне дерева — в `nav.json` их
        // нет. Пустые поля не пишутся, и без них `project.json` не создаётся вовсе.
        project: projectMetaForArchive(),
        // Исходники наборов: в `library/` их символы уже с правками проекта, а коллеге
        // нужна поставка, на которую эти правки лягут (см. applyImportedBundle).
        presets: await loadPresets(),
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

  /**
   * Экспорт в .zip (скачивание) — единственный формат вывода проекта. Имя файла = имя
   * проекта (из импортированного архива); нет имени → 'project'.
   *
   * id проекта ВНУТРИ архива — первая форма дерева: он становится именем папки в
   * `projects/` сервера и ключом в его списках. Маска — как у имён форм.
   */
  async function exportProjectToArchive() {
    await buildAndDeliverBundle((bundle) => {
      const first = workspace.formTree[0]?.id || workspace.formIds[0]
      const projectId = safeFormId(first) || 'project'
      const base = (workspace.projectName || 'project').replace(/[\\/:*?"<>|]/g, '_')
      downloadBlob(buildProjectZipBlob({ ...bundle, projectId }), `${base}.zip`)
    })
  }

  return {
    exportingProject,
    importProjectFromArchive,
    exportProjectToArchive,
    syncStencilInClosedForms,
    migrateRangesToStencils,
    cleanupInheritedRanges,
  }
}
