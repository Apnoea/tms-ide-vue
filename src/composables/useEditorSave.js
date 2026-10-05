import { computed, ref } from 'vue'
import { useUiStore } from '../stores/useUiStore'
import { useNotify } from './useNotify'
import { useCanvas } from './useCanvas'
import { useConfirmDanger } from './useConfirmDanger'
import { stencilDraftProblems, parseStencilSvg } from '../utils/stencilSvg'
import { presetEditResult, sameShapeStates } from '../utils/presetPatch'
import { sanitizeSvgMarkup } from '../utils/sanitizeSvg'
import { nplural } from '../utils/plural'
import {
  getAllStencils,
  getStencilById,
  isPresetStencil,
  registerStencil,
} from '../stencils/registry'
import { syncStencilInstances } from '../stencils/svgInjector'
import { persistStencilsToDisk } from '../services/stencilLibrary'
import { removeStencilOverride, upsertStencilOverride } from '../services/stencilOverrides'
import { presetStencilBase } from '../services/presetLibrary'

// Поля черновика, которые подсвечивает панель символа (StencilInspector, `problemOf`).
const SYMBOL_FIELDS = new Set(['id', 'label', 'category'])

/**
 * Жизненный цикл правки символа в редакторе: несохранённое, закрытие с подтверждением,
 * сохранение (валидация → реестр → IDB-оверрайд → диск dev-плагином → экземпляры во
 * всех формах) и сброс символа набора к поставочному виду.
 *
 * @param {object} deps
 * @param {object} deps.ed — модель редактора (useStencilEditor)
 * @param {object|null} deps.editTarget — правимый символ (null — создание)
 * @param {boolean} deps.isDuplicate — копия: сохраняется как новый символ
 * @param {boolean} deps.rangesOnly — программный символ: правятся только зоны
 * @param {boolean} deps.animationOnly — символ набора: правятся только анимации
 */
export function useEditorSave({ ed, editTarget, isDuplicate, rangesOnly, animationOnly }) {
  const ui = useUiStore()
  const notify = useNotify()
  const confirmDanger = useConfirmDanger()
  const canvas = useCanvas()
  const { meta, shapes, editingId, hasChanges, select } = ed

  // Несохранённое считаем разницей с исходным состоянием (`hasChanges`), а не шагами
  // истории: правка, отменённая руками, разницы не даёт. Копия «грязная» с самого
  // начала — она ещё не существует, и молча терять её на Esc нельзя.
  const isDirty = computed(() => isDuplicate || hasChanges.value)

  // Закрытие с подтверждением, если черновик непустой. Попап якорится на кнопку
  // «Закрыть» — для Esc, где DOM-таргета нет, через closeBtn-реф.
  const closeBtn = ref(null)
  function requestClose(event) {
    if (!isDirty.value) {
      ui.closeStencilEditor()
      return
    }
    confirmDanger({
      target: event?.currentTarget || closeBtn.value?.$el,
      message: 'Закрыть редактор? Несохранённый символ будет потерян.',
      acceptLabel: 'Закрыть',
      accept: () => ui.closeStencilEditor(),
    })
  }

  // Сохранение: валидация → регистрация в реестре → персист на диск (в проде плагина
  // нет, символ уедет в library/ проекта). При правке id исключается из проверки
  // уникальности, а после сохранения экземпляры во всех формах подхватывают новый
  // рисунок, при смене портов идёт предупреждение.
  async function save() {
    const editing = editingId.value
    const existingIds = getAllStencils()
      .map((s) => s.id)
      .filter((id) => id !== editing)
    // Проверки черновика — про фигуры и поля, которых у программного символа не правят.
    const problems = rangesOnly ? [] : stencilDraftProblems(meta, shapes.value, existingIds)
    if (problems.length) {
      notify.warn('Проверь символ', problems.map((p) => p.message).join('; '))
      // Поля символа подсвечены в его панели, а её не видно, пока выделены фигуры.
      if (problems.some((p) => SYMBOL_FIELDS.has(p.field))) select(null)
      return
    }
    const prev = editing ? getStencilById(editing) : null
    const out = rangesOnly ? ed.outputRangesOnly(prev) : ed.output({ keepBox: animationOnly })
    const { json, svg, pristine } = animationOnly ? presetEdit(out) : { ...out, pristine: false }
    registerStencil(json, svg)
    // Оверрайд в IDB даёт правке пережить reload и в prod. Символ, совпавший с набором,
    // оверрайда не держит: иначе он перекрывал бы обновления набора.
    const idbOk = pristine
      ? await removeStencilOverride(json.id)
      : await upsertStencilOverride({ id: json.id, stencilJson: json, shapeSvg: svg })
    // Файл в src/library/ попадает под git как встроенный символ — символу набора туда нельзя.
    const onDisk = isPresetStencil(json)
      ? false
      : await persistStencilsToDisk([{ id: json.id, stencilJson: json, shapeSvg: svg }])
    // Символ уходит в .zip (library/) — проект разошёлся с последним экспортом.
    canvas.markDirty()
    // Оверрайд не записался (квота, приватный режим) — правка живёт только до reload:
    // сообщаем и поднимаем saveError.
    if (!idbOk) {
      canvas.setSaveError(true)
      notify.error(
        'Символ не сохранён локально',
        'Браузер отклонил запись в хранилище — правка потеряется после перезагрузки'
      )
    }

    if (editing) await syncInstancesAndReport(json.id, prev, 'Символ обновлён')
    else if (onDisk) notify.success('Символ создан', json.id)
    else {
      notify.success(
        'Символ создан',
        'Переживёт перезагрузку; файл в src/library/ появится только в dev-режиме'
      )
    }
    ui.closeStencilEditor()
  }

  /**
   * Правка символа набора: отличия от установленной версии (utils/presetPatch). Рисунок
   * свой, только если видимость фигур по состояниям разошлась с набором. Набора нет
   * (символ пришёл со старым архивом) — сохраняем снимком, как свой символ.
   */
  function presetEdit({ json, svg }) {
    const base = presetStencilBase(json.id)
    if (!base) return { json, svg, pristine: false }
    const baseShapes = parseStencilSvg(sanitizeSvgMarkup(base.shapeSvg).svg)
    return presetEditResult(base, json, {
      editedSvg: svg,
      drawing: !sameShapeStates(baseShapes, shapes.value),
    })
  }

  // «Сбросить к набору» — только у символа набора, у которого есть правки проекта.
  const canResetToPreset =
    animationOnly && !!editTarget?.presetPatch && !!presetStencilBase(editTarget.id)

  function confirmResetToPreset(event) {
    confirmDanger({
      target: event?.currentTarget,
      message: 'Вернуть символ к виду из набора? Настройки проекта у него сбросятся.',
      acceptLabel: 'Сбросить',
      accept: resetToPreset,
    })
  }

  async function resetToPreset() {
    const base = presetStencilBase(editTarget.id)
    if (!base) return
    const prev = getStencilById(base.id)
    registerStencil(base.stencilJson, base.shapeSvg)
    if (!(await removeStencilOverride(base.id))) {
      canvas.setSaveError(true)
      notify.error(
        'Сброс не сохранён',
        'Браузер отклонил запись в хранилище — после перезагрузки правки вернутся'
      )
    }
    canvas.markDirty()
    await syncInstancesAndReport(base.id, prev, 'Символ возвращён к набору')
    ui.closeStencilEditor()
  }

  /**
   * Расставленные экземпляры — к новой версии символа во ВСЕХ формах, с итогом в тосте.
   * Закрытые формы правятся сразу, а не при своём открытии: иначе провод, потерявший
   * порт, отваливался через дни и без связи с этой правкой.
   */
  async function syncInstancesAndReport(stencilId, prev, title) {
    // Идёт в теневом графе, живой холст не трогает (см. syncStencilInClosedForms).
    const closed = await canvas.syncStencilInClosedForms(stencilId, prev)
    // Экземпляры на холсте подтягивают новую версию символа целиком (рисунок, порты,
    // габарит) одной операцией — значит один шаг undo.
    const { changed, detached } = syncStencilInstances(
      canvas.graphRef.value,
      canvas.paperRef.value,
      getStencilById(stencilId),
      prev
    )
    canvas.bumpVersion()
    if (changed || detached.length) canvas.requestSnapshot()
    // Отцепленные концы выделяются: иначе их пришлось бы искать по схеме глазами.
    if (detached.length) canvas.setSelection(detached.map((id) => ({ kind: 'link', id })))
    const what = []
    const total = changed + closed.changed
    if (total) what.push(`обновлено ${nplural(total, 'символ', 'символа', 'символов')}`)
    // Активную считаем, только если правка её задела: символ мог стоять лишь в закрытых.
    const forms = closed.forms + (changed ? 1 : 0)
    if (forms > 1) what.push(`на ${nplural(forms, 'форме', 'формах', 'формах')}`)
    const detachedTotal = detached.length + closed.detached
    if (detachedTotal) {
      what.push(`отцеплено ${nplural(detachedTotal, 'провод', 'провода', 'проводов')}`)
    }
    // Отцепленный провод — потеря соединения, поэтому warn, а не success. На активной
    // форме концы выделены, на остальных их придётся искать — об этом и говорим.
    const detail = what.length ? what.join(', ') : stencilId
    if (detachedTotal) {
      const where = closed.detached
        ? ' — порт удалён, проверь другие формы'
        : ' — порт удалён, перецепи'
      notify.warn(title, detail + where)
    } else notify.success(title, detail)
  }

  return { isDirty, closeBtn, requestClose, save, canResetToPreset, confirmResetToPreset }
}
