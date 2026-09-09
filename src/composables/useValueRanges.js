import { ref, watch } from 'vue'
import { useCanvas } from './useCanvas'
import { useNotify } from './useNotify'
import { useProjectStore } from '../stores/useProjectStore'
import { getStencilById } from '../stencils/registry'
import { toPlain } from '../utils/plain'
import { RANGE_COLOR_PRESETS, rangeRowColor } from '../constants/animation'

/**
 * Новая строка источника: цвет — первый пресет, не занятый другими строками, пороги
 * пустые (их вписывает автор).
 */
function newRow(vs) {
  const used = new Set((vs?.ranges || []).map((r) => rangeRowColor(r)))
  const color = RANGE_COLOR_PRESETS.find((c) => !used.has(c)) || RANGE_COLOR_PRESETS[0]
  return { color }
}

/**
 * Шкала начинается с нуля: у ПЕРВОЙ строки низ фиксирован (в инспекторе поле не
 * правится). Приводим при правках списка, а не на чтении: старую форму с другим низом
 * молча переписывать нельзя, а после первой же правки она станет обычной.
 */
export function withZeroStart(ranges) {
  if (!ranges?.length || ranges[0].min === 0) return ranges
  return ranges.map((r, i) => (i === 0 ? { ...r, min: 0 } : r))
}

/**
 * Правка одной строки: новый массив ranges либо null, если ввод невалиден. min/max —
 * числа, нечисловой ввод дал бы NaN и сломал сравнение при экспорте. Десятичная
 * запятая («3,99») нормализуется в точку до Number().
 */
export function editRanges(ranges, idx, field, value) {
  let parsed = value
  if (field !== 'color') {
    const raw = String(value).trim().replace(',', '.')
    // Пустая строка отсекается ДО Number(): `Number('')` даёт 0, и очистка поля
    // записала бы порог 0.
    if (!raw) return null
    parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
  }
  return ranges.map((r, i) => (i === idx ? { ...r, [field]: parsed } : r))
}

/**
 * Блок «Диапазоны значений» инспектора (`tms.rangeSource`: тег + строки «пороги →
 * цвет») в двух видах: одиночный правит выделенный элемент, мульти держит локальный
 * ШАБЛОН `multiRange` и раздаёт любую правку на всё выделение (сбрасывается при смене
 * состава).
 *
 * Вынесено из CanvasInspector: наружу нужны только props блока и обработчики его
 * эмитов. Заблокированные и статичные (текст/значение) цели пропускаются.
 *
 * @param {object} deps
 * @param {import('vue').ComputedRef} deps.details — текущий выделенный элемент
 * @param {(updater: (tms: object) => object|undefined) => void} deps.mutateSelectedTms
 * @param {(config: object) => void} deps.openPicker — открыть единый tag-picker
 */
export function useValueRanges({ details, mutateSelectedTms, openPicker }) {
  const canvas = useCanvas()
  const notify = useNotify()
  const project = useProjectStore()

  /** patch=null — удаляет источник целиком; иначе мержит в существующий объект. */
  function patchRangeSource(patch) {
    mutateSelectedTms((tms) => ({
      ...tms,
      rangeSource: patch === null ? null : { ...(tms.rangeSource || {}), ...patch },
    }))
  }

  // Только числовые: диапазон сравнивает значение с min/max, булев или текстовый тег
  // цвета не даст ни в превью, ни в рантайме.
  function openRangePicker() {
    openPicker({
      tags: () => project.numericTags,
      selected: details.value?.rangeSource?.tag || '',
      header: 'Выберите тег (диапазоны значений)',
      onSelect: onPickTag,
    })
  }

  function onPickTag(tag) {
    // Источника ещё нет (тег выбирают первым) — создаём с ОДНОЙ пустой строкой:
    // готовые пороги пришлось бы стирать, а осмысленные знает только автор схемы.
    if (details.value?.rangeSource) {
      patchRangeSource({ tag })
    } else {
      patchRangeSource({ tag, ranges: withZeroStart([{ ...newRow(null), min: 0 }]) })
    }
  }

  function updateRange(idx, field, value) {
    const vs = details.value?.rangeSource
    if (!vs?.ranges) return
    const ranges = editRanges(vs.ranges, idx, field, value)
    if (ranges) patchRangeSource({ ranges: withZeroStart(ranges) })
  }

  function addRange() {
    const vs = details.value?.rangeSource
    if (!vs) return
    patchRangeSource({ ranges: withZeroStart([...(vs.ranges || []), newRow(vs)]) })
  }

  /** Удаление строки. Последнюю не запрещаем: источник без строк — «цвета нет». */
  function removeRange(idx) {
    const vs = details.value?.rangeSource
    if (!vs?.ranges) return
    patchRangeSource({ ranges: withZeroStart(vs.ranges.filter((_, i) => i !== idx)) })
  }

  function removeRangeSource() {
    patchRangeSource(null)
  }

  /** «Подсветить на схеме»: toggle подсветки элементов с тем же rangeSource.tag. */
  function toggleRangeHighlight() {
    const tag = details.value?.rangeSource?.tag
    if (!tag) {
      notify.warn(
        'Тег не выбран',
        'Выберите тег источника, чтобы подсветить символы с тем же тегом'
      )
      return
    }
    canvas.toggleHighlightedTag(tag)
  }

  // ─── Мульти: локальный шаблон (тег + строки) ───
  const multiRange = ref(null) // { tag, ranges } | null

  watch(
    () => canvas.selection.value.map((i) => i.id).join('|'),
    () => {
      multiRange.value = null
    }
  )

  /** Прогон по выделению: пропускает заблокированные (`writableItems`) и статичные
   *  (текст/значение), зовёт fn(cell, tms), затем один bumpVersion + requestSnapshot. */
  function forEachSelectedCell(fn) {
    for (const cell of canvas.writableItems(canvas.selection.value)) {
      const tms = cell.get('tms') || {}
      if (getStencilById(tms.stencilId)?.static) continue
      fn(cell, tms)
    }
    canvas.bumpVersion()
    canvas.requestSnapshot()
  }

  /** Раздать текущий шаблон на всё выделение (клон на ячейку, без общих ссылок).
   *  toPlain, не structuredClone: multiRange.value — Vue reactive-прокси,
   *  structuredClone на нём бросает DataCloneError. */
  function applyMultiRange() {
    if (!multiRange.value) return
    forEachSelectedCell((cell, tms) =>
      cell.set('tms', { ...tms, rangeSource: toPlain(multiRange.value) })
    )
  }

  function openMultiRangePicker() {
    openPicker({
      tags: () => project.numericTags,
      header: 'Тег диапазонов для всех выделенных символов',
      onSelect: onPickMultiRangeTag,
    })
  }

  function onPickMultiRangeTag(tag) {
    if (!tag) return
    const prev = multiRange.value
    multiRange.value = {
      tag,
      ranges: withZeroStart(prev?.ranges ?? [{ ...newRow(null), min: 0 }]),
    }
    applyMultiRange()
  }

  function addMultiRange() {
    const vs = multiRange.value
    if (!vs) return
    multiRange.value = { ...vs, ranges: withZeroStart([...(vs.ranges || []), newRow(vs)]) }
    applyMultiRange()
  }

  function removeMultiRangeRow(idx) {
    const vs = multiRange.value
    if (!vs?.ranges) return
    multiRange.value = { ...vs, ranges: withZeroStart(vs.ranges.filter((_, i) => i !== idx)) }
    applyMultiRange()
  }

  /** Правка порога в шаблоне → перераздача на всё выделение. */
  function updateMultiRange(idx, field, value) {
    const vs = multiRange.value
    if (!vs?.ranges) return
    const ranges = editRanges(vs.ranges, idx, field, value)
    if (!ranges) return
    multiRange.value = { ...vs, ranges: withZeroStart(ranges) }
    applyMultiRange()
  }

  /** × — снять диапазоны со всех выделенных и очистить шаблон. */
  function removeMultiRange() {
    multiRange.value = null
    forEachSelectedCell((cell, tms) => {
      if (!tms.rangeSource) return
      const next = { ...tms }
      delete next.rangeSource
      cell.set('tms', next)
    })
  }

  function toggleMultiRangeHighlight() {
    const tag = multiRange.value?.tag
    if (tag) canvas.toggleHighlightedTag(tag)
  }

  return {
    // одиночный режим
    openRangePicker,
    updateRange,
    removeRangeSource,
    toggleRangeHighlight,
    addRange,
    removeRange,
    // мульти-режим
    multiRange,
    addMultiRange,
    removeMultiRangeRow,
    openMultiRangePicker,
    updateMultiRange,
    removeMultiRange,
    toggleMultiRangeHighlight,
  }
}
