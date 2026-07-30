import { ref, watch } from 'vue'
import { useCanvas } from './useCanvas'
import { useNotify } from './useNotify'
import { useProjectStore } from '../stores/useProjectStore'
import { getStencilById } from '../stencils/registry'
import { toPlain } from '../utils/plain'

// Дефолтные диапазоны; клонируем каждый диапазон на использование —
// чтобы ячейки не делили один и тот же массив.
//
// max-границы укорочены на 0.01: WebScada condition-evaluator inclusive по
// обоим концам (`>=min && <=max`). При max=4/4/7 значение 4 матчило бы и low,
// и mid одновременно — итоговый цвет зависел бы от порядка CSS-правил, а не
// от данных. Та же логика что для quality `[0, 191]` (max=191, не 192).
const RANGE_DEFAULTS = [
  { min: 0, max: 3.99, class: 'animation-low' },
  { min: 4, max: 6.99, class: 'animation-mid' },
  { min: 7, max: 10, class: 'animation-high' },
]

/**
 * Правка одного порога: возвращает новый массив ranges либо null, если ввод
 * невалиден. min/max — числа; нечисловой ввод (пустая строка, буквы) дал бы NaN,
 * который молча сломал бы диапазон при экспорте → правку игнорируем. Русская
 * десятичная запятая («3,99») — самый частый «съеденный» ввод у инженеров с ru-
 * раскладкой: нормализуем в точку до Number(), иначе тоже NaN → тихий откат.
 */
export function editRanges(ranges, idx, field, value) {
  let parsed = value
  if (field !== 'class') {
    const raw = String(value).trim().replace(',', '.')
    // Пустую строку отсекаем ДО Number(): `Number('')` даёт 0, и очистка поля
    // молча записывала бы порог 0 вместо «правку игнорируем».
    if (!raw) return null
    parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
  }
  return ranges.map((r, i) => (i === idx ? { ...r, [field]: parsed } : r))
}

/**
 * Блок «Диапазоны значений» инспектора (`tms.rangeSource`: тег + пороги → класс
 * по диапазону) в двух режимах:
 *  • одиночный — правки идут прямо в выделенный элемент;
 *  • мульти — локальный ШАБЛОН `multiRange` (у выделения нет общего источника),
 *    любая правка раздаётся на всё выделение; сбрасывается при смене состава.
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

  function openRangePicker() {
    openPicker({
      tags: () => project.tags,
      selected: details.value?.rangeSource?.tag || '',
      header: 'Выберите тег (диапазоны значений)',
      onSelect: onPickTag,
    })
  }

  function onPickTag(tag) {
    // Если rangeSource ещё не существует (add-flow без созданной карточки),
    // создаём её с дефолтными диапазонами; иначе обновляем только тег.
    if (details.value?.rangeSource) {
      patchRangeSource({ tag })
    } else {
      patchRangeSource({ tag, ranges: RANGE_DEFAULTS.map((r) => ({ ...r })) })
    }
  }

  function updateRange(idx, field, value) {
    const vs = details.value?.rangeSource
    if (!vs?.ranges) return
    const ranges = editRanges(vs.ranges, idx, field, value)
    if (ranges) patchRangeSource({ ranges })
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

  // ─── Мульти-режим: локальный шаблон (тег + пороги) ───
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
      tags: () => project.tags,
      header: 'Тег диапазонов для всех выделенных символов',
      onSelect: onPickMultiRangeTag,
    })
  }

  function onPickMultiRangeTag(tag) {
    if (!tag) return
    const prev = multiRange.value
    multiRange.value = {
      tag,
      ranges: prev?.ranges ?? RANGE_DEFAULTS.map((r) => ({ ...r })),
    }
    applyMultiRange()
  }

  /** Правка порога в шаблоне → перераздача на всё выделение. */
  function updateMultiRange(idx, field, value) {
    const vs = multiRange.value
    if (!vs?.ranges) return
    const ranges = editRanges(vs.ranges, idx, field, value)
    if (!ranges) return
    multiRange.value = { ...vs, ranges }
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
    // мульти-режим
    multiRange,
    openMultiRangePicker,
    updateMultiRange,
    removeMultiRange,
    toggleMultiRangeHighlight,
  }
}
