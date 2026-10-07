import { ref, nextTick } from 'vue'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { withPaperFrozen, withRestoreGuard } from '../utils/graphBatch'
import { FORM_ID_RE } from '../constants/ids'
import { nplural } from '../utils/plural'
import { toPlain } from '../utils/plain'
import { replayClass } from '../utils/replayClass'

/**
 * Формы проекта: переключение, создание, дублирование, удаление с корзиной,
 * переименование (с починкой ссылок навигации) и перенос в дереве. Часть useProject:
 * зависимости и `flagIfNotSaved` приходят его контекстом, busy-гейт ставит он же.
 *
 * @param {object} ctx — контекст useProject
 */
export function useForms(ctx) {
  const { canvas, workspace, notify, restoringHistory, flagIfNotSaved } = ctx
  const {
    saveActiveForm,
    persistMeta,
    persistForm,
    removeFormPersist,
    loadTrash,
    pushTrash,
    popTrash,
  } = ctx.autosave
  const { cancelPendingSnapshot, initHistory } = ctx.undo
  const { stopSimulation, simulating } = ctx.simulation

  // Корзина форм: список для кнопки возврата над деревом, читается из IDB.
  const trash = ref([])
  async function refreshTrash() {
    trash.value = await loadTrash()
  }

  // Загрузить graphJson в живой холст + сброс undo под новую форму. Общий хвост
  // selectForm / createForm / duplicateForm / deleteForm / renameForm (когда меняется
  // активная форма).
  function loadActiveIntoCanvas(graph, paper, json) {
    // Симуляция не переезжает на другую форму: её значения и подписи принадлежат той,
    // что была на холсте. Гасим здесь, потому что через эту точку идут ВСЕ смены графа
    // активной формы — удаление и переименование в том числе.
    if (simulating.value) stopSimulation()
    let synced = { changed: 0, detached: [] }
    withRestoreGuard(restoringHistory, () => {
      // Заморозка только на fromJSON: инъекция ниже ходит через findViewByModel, а у
      // замороженного paper'а представлений новых ячеек нет (graphBatch).
      withPaperFrozen(paper, () => graph.fromJSON(json || { cells: [] }))
      // sync: символ могли править, пока форма была закрыта, а её порты лежат в
      // graphJson. initHistory ниже берёт уже сверенный граф за базу.
      synced = reinjectAllStencils(graph, paper, { sync: true }) || synced
      canvas.bumpVersion()
    })
    initHistory()
    canvas.clearSelection()
    reportDetached(synced)
    playFormIn(paper)
    // Вписываем содержимое, как кнопка «Вписать»: zoom и translate остаются от прошлой
    // формы, а новая нарисована в своих координатах — иначе форма, начатая далеко от
    // начала координат, открывается за кадром. Пустая просто сбрасывается к 100% и
    // (0,0). nextTick нужен, чтобы ячейки попали в DOM: transformToFitContent мерит его.
    nextTick(() => canvas.fitToContent())
  }

  /**
   * Новая форма ПРОЯВЛЯЕТСЯ: у похожих схем мгновенная подмена не читается как
   * переключение. Гасить старую перед подменой не стали — это задержало бы отклик на
   * длительность анимации.
   */
  function playFormIn(paper) {
    replayClass(paper?.el, 'tms-form-in')
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
      `Отцеплено ${nplural(detached.length, 'провод', 'провода', 'проводов')}: порт удалён — перецепи`
    )
  }

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
    await saveActiveForm() // дублируем актуальное состояние, а не последнее сохранённое
    const copyId = uniqueFormId(`${id}_copy`)
    const json = toPlain(workspace.getFormGraph(id) || { cells: [] })
    workspace.addForm(copyId, json)
    workspace.moveNode(copyId, id, 'after')
    // Название — с пометкой, как у копии символа: две одинаковые подписи в дереве не
    // различить.
    const title = workspace.formTitleOf(id)
    if (title) workspace.setFormTitle(copyId, `${title} (копия)`)
    workspace.setFormDescription(copyId, workspace.formDescriptionOf(id))
    let ok = await persistForm(copyId, json)
    workspace.setActiveFormId(copyId)
    ok = (await persistMeta()) && ok
    flagIfNotSaved(ok)
    loadActiveIntoCanvas(graph, paper, json)
    canvas.markDirty() // новая форма → проект разошёлся с .zip
    // Без тоста: копия открыта и выделена в дереве.
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
    // В корзину — ДО удаления: нужны граф, фон, название и место в дереве.
    const trashed = await pushTrash({
      id,
      graphJson: toPlain(workspace.getFormGraph(id) || { cells: [] }),
      bg: workspace.formBg[id] ?? null,
      title: workspace.formTitleOf(id) || null,
      description: workspace.formDescriptionOf(id) || null,
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
   * Вернуть форму из корзины: граф, фон, название и место в дереве (после прежнего
   * соседа, иначе внутрь прежнего родителя, иначе в конец корня). Активную форму не
   * меняем.
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
    if (entry.title) workspace.setFormTitle(entry.id, entry.title)
    if (entry.description) workspace.setFormDescription(entry.id, entry.description)
    const anchor = entry.anchor || null
    if (anchor?.prevId && workspace.hasForm(anchor.prevId)) {
      workspace.moveNode(entry.id, anchor.prevId, 'after')
    } else if (anchor?.parentId && workspace.hasForm(anchor.parentId)) {
      workspace.moveNode(entry.id, anchor.parentId, 'inside')
    }
    flagIfNotSaved(await persistForm(entry.id, entry.graphJson))
    flagIfNotSaved(await persistMeta())
    canvas.markDirty()
    // Без тоста: форма видна в дереве на прежнем месте.
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

  return {
    trash,
    refreshTrash,
    selectForm,
    createForm,
    duplicateForm,
    deleteForm,
    restoreForm,
    renameForm,
    moveFormNode,
  }
}
