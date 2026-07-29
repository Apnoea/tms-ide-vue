<script setup>
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import AutoComplete from 'primevue/autocomplete'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import {
  useAnimationClipboard,
  applyBoolClip,
  applyRangeClip,
} from '../composables/useAnimationClipboard'
import { useAlign } from '../composables/useAlign'
import { useSwitchGroups } from '../composables/useSwitchGroups'
import { useVoltageRanges } from '../composables/useVoltageRanges'
import { useTextCellProps, ALIGN_OPTIONS, BOLD_OPTIONS } from '../composables/useTextCellProps'
import { useNavigationField } from '../composables/useNavigationField'
import { useProjectStore } from '../stores/useProjectStore'
import { getStencilById, hasBoolSlot } from '../stencils/registry'
import { injectStencilSvg } from '../stencils/svgInjector'
import { TEXT_FONT_SIZE } from '../stencils/textCell'
import { resolveValueDisplay } from '../stencils/valueCell'
import { nplural } from '../utils/plural'
import { normalizeSwitchSources } from '../utils/switchSources'
import { toPlain } from '../utils/plain'
import { isBooleanType } from '../services/parsers'
import TagPickerDialog from './TagPickerDialog.vue'
import TagField from './TagField.vue'
import RangeBlock from './RangeBlock.vue'
import BooleanBlock from './BooleanBlock.vue'
import { ANIMATION_CLASS_OPTIONS } from '../constants/animation'
import { previewOuterKey } from '../constants/ids'

// Статичные стенсилы (флаг `static: true` в stencil.json) — без визуальной
// реакции на animation-классы; voltage/switch source на них бессмыслен, в
// multi-select их пропускаем.
function isStatic(stencilId) {
  return !!getStencilById(stencilId)?.static
}

const canvas = useCanvas()
const animClip = useAnimationClipboard()
// Выравнивание + распределение выделенных ячеек (секция «Выравнивание» в мульти-режиме).
const { canAlign, canDistribute, alignCells, distributeCells } = useAlign()

// Тулбар выравнивания/распределения (мульти-режим). Кнопки различаются лишь
// подсказкой, операцией и координатами прямоугольников иконки (viewBox 16×16) —
// держим конфигом, а не копипастом разметки. В rects: ось выравнивания (без
// opacity) + два «элемента» (o:0.8); у распределения — три равных столбца.
const ALIGN_ROWS = [
  {
    label: 'По горизонтали',
    kind: 'align',
    buttons: [
      {
        op: 'left',
        tip: 'По левому краю',
        rects: [
          { x: 1, y: 2, w: 1.4, h: 12, rx: 0.5 },
          { x: 3.4, y: 4, w: 9, h: 3, rx: 1, o: 0.8 },
          { x: 3.4, y: 9, w: 5.5, h: 3, rx: 1, o: 0.8 },
        ],
      },
      {
        op: 'centerX',
        tip: 'По центру (горизонт.)',
        rects: [
          { x: 7.3, y: 2, w: 1.4, h: 12, rx: 0.5 },
          { x: 3.5, y: 4, w: 9, h: 3, rx: 1, o: 0.8 },
          { x: 5.25, y: 9, w: 5.5, h: 3, rx: 1, o: 0.8 },
        ],
      },
      {
        op: 'right',
        tip: 'По правому краю',
        rects: [
          { x: 13.2, y: 2, w: 1.4, h: 12, rx: 0.5 },
          { x: 4.2, y: 4, w: 9, h: 3, rx: 1, o: 0.8 },
          { x: 7.7, y: 9, w: 5.5, h: 3, rx: 1, o: 0.8 },
        ],
      },
    ],
  },
  {
    label: 'По вертикали',
    kind: 'align',
    buttons: [
      {
        op: 'top',
        tip: 'По верхнему краю',
        rects: [
          { x: 2, y: 1, w: 12, h: 1.4, rx: 0.5 },
          { x: 4, y: 3.4, w: 3, h: 9, rx: 1, o: 0.8 },
          { x: 9, y: 3.4, w: 3, h: 5.5, rx: 1, o: 0.8 },
        ],
      },
      {
        op: 'centerY',
        tip: 'По центру (вертик.)',
        rects: [
          { x: 2, y: 7.3, w: 12, h: 1.4, rx: 0.5 },
          { x: 4, y: 3.5, w: 3, h: 9, rx: 1, o: 0.8 },
          { x: 9, y: 5.25, w: 3, h: 5.5, rx: 1, o: 0.8 },
        ],
      },
      {
        op: 'bottom',
        tip: 'По нижнему краю',
        rects: [
          { x: 2, y: 13.2, w: 12, h: 1.4, rx: 0.5 },
          { x: 4, y: 4.2, w: 3, h: 9, rx: 1, o: 0.8 },
          { x: 9, y: 7.7, w: 3, h: 5.5, rx: 1, o: 0.8 },
        ],
      },
    ],
  },
  {
    // Распределение: равные интервалы. Нужно ≥3 ячеек (иначе disabled).
    label: 'Распределение',
    kind: 'distribute',
    buttons: [
      {
        op: 'x',
        tip: 'Распределить по горизонтали (равные интервалы)',
        rects: [
          { x: 2, y: 3, w: 2.6, h: 10, rx: 0.8 },
          { x: 6.7, y: 3, w: 2.6, h: 10, rx: 0.8 },
          { x: 11.4, y: 3, w: 2.6, h: 10, rx: 0.8 },
        ],
      },
      {
        op: 'y',
        tip: 'Распределить по вертикали (равные интервалы)',
        rects: [
          { x: 3, y: 2, w: 10, h: 2.6, rx: 0.8 },
          { x: 3, y: 6.7, w: 10, h: 2.6, rx: 0.8 },
          { x: 3, y: 11.4, w: 10, h: 2.6, rx: 0.8 },
        ],
      },
    ],
  },
]
const project = useProjectStore()
const notify = useNotify()

// Computed-и читают canvas.graphVersion, чтобы пересчитываться при изменениях графа
// (JointJS-модели не Vue-reactive, ловим через явный version-tick).
const details = computed(() => {
  canvas.graphVersion.value // touch для reactive-зависимости
  const sel = canvas.singleSelection.value // мульти-режим обрабатывается отдельно
  const graph = canvas.graphRef.value
  if (!sel || !graph) return null
  const cell = graph.getCell(sel.id)
  if (!cell) return null

  if (sel.kind === 'cell') {
    const tms = cell.get('tms') || {}
    const stencil = tms.stencilId ? getStencilById(tms.stencilId) : null
    const slotsDef = stencil?.slots || []
    const slotValues = tms.slots || {}

    return {
      kind: 'cell',
      id: cell.id,
      stencilId: tms.stencilId,
      stencilLabel: stencil?.label || tms.stencilId || '-',
      locked: !!tms.locked,
      isText: tms.stencilId === 'cell_text',
      text: tms.text ?? '',
      fontSize: tms.fontSize ?? TEXT_FONT_SIZE,
      bold: !!tms.bold,
      align: tms.align || 'left',
      color: tms.color || '',
      isValue: tms.stencilId === 'cell_value',
      valueTag: tms.valueTag ?? '',
      // id outer-карточки в animations.json/SVG (тот же, что эмитит exporter).
      exportId: previewOuterKey(tms.stencilId, cell.id, tms.valueTag),
      // Стенсилы с булевым слотом-драйвером (key onoff — см. hasBoolSlot; это
      // cell_qw/qr/qk/qf, cell_alr, пользовательские) рендерят его через BooleanBlock
      // первой строкой (основной тег) вместе с зависимостями switchSources.
      hasBoolSlot: hasBoolSlot(stencil),
      // Тег основного булева слота (slot.onoff) — для исключения из switchSources.
      // Из payload (tms.slots.onoff), как и multi-select; не по индексу slots[0].
      onoffTag: slotValues.onoff || '',
      // Слоты для UI: декларация из стенсила + текущее значение из tms.slots.
      // Нужны BooleanBlock (slots[0]) и slot-picker'у; type — тип тега.
      slots: slotsDef.map((s) => ({
        key: s.key,
        type: s.type,
        value: slotValues[s.key] || '',
      })),
      voltageSource: tms.voltageSource || null,
      switchSources: tms.switchSources || null,
      navigation: tms.navigation || '',
    }
  }

  if (sel.kind === 'link') {
    const tms = cell.get('tms') || {}
    return {
      kind: 'link',
      id: cell.id,
      // Толщина/цвет линии — из JointJS-attr (реально отрисованные); дефолты 2 / #000.
      strokeWidth: cell.attr('line/strokeWidth') ?? 2,
      strokeColor: cell.attr('line/stroke') || '#000000',
      voltageSource: tms.voltageSource || null,
      switchSources: tms.switchSources || null,
    }
  }

  return null
})

// Слот-драйвер стенсила «по значению»: любой не-onoff слот (onoff рисует
// BooleanBlock). Значение сигнала выбирает активное состояние; на холсте нужна
// одна строка — привязать тег (сами состояния/вид уже в стенсиле).
const valueStateSlot = computed(() => {
  const d = details.value
  if (!d || d.kind !== 'cell') return null
  return (d.slots || []).find((s) => s.key !== 'onoff') || null
})

// ─── Удаление ───
function onDelete() {
  canvas.deleteItems([...canvas.selection.value])
}

// ─── Единый tag-picker ───
// Все места открывают один диалог через openPicker(config). tags/selected/header
// снимаются в момент открытия (во время открытого диалога tag-list не меняется);
// onSelect — что делать с выбранным тегом. picker=null → диалог закрыт.
const picker = ref(null)

function openPicker(config) {
  picker.value = { selected: '', tags: [], header: 'Выберите тег', ...config }
}

function onPickerSelect(tag) {
  const cb = picker.value?.onSelect
  picker.value = null
  cb?.(tag)
}

// ─── Редактирование слотов (привязка тегов) ───
// Булев слот → только bool-теги; остальные — весь tag-list.
function openSlotPicker(slot) {
  openPicker({
    tags: isBooleanType(slot?.type) ? project.booleanTags : project.tags,
    selected: slot?.value || '',
    header: 'Выберите тег',
    onSelect: (tag) => patchSlotTag(slot.key, tag),
  })
}

/**
 * Каркас правки выделенной ЯЧЕЙКИ (не линка): резолвит cell + её stencil и
 * отдаёт { cell, stencil, tms, d } в fn. fn сам мутирует cell (cell.set('tms',…),
 * при нужде resize). Вернул false → выходим без перерисовки и snapshot'а (нечего
 * менять). reinject:true — перерисовать SVG ячейки (новые bindings) после fn.
 * Финал — bumpVersion + requestSnapshot один раз.
 */
function withSelectedCell(fn, { reinject = false } = {}) {
  const graph = canvas.graphRef.value
  const paper = canvas.paperRef.value
  const d = details.value
  if (!graph || !d || d.kind !== 'cell') return
  const cell = graph.getCell(d.id)
  const stencil = getStencilById(d.stencilId)
  if (!cell || !stencil) return
  if (fn({ cell, stencil, tms: cell.get('tms') || {}, d }) === false) return
  if (reinject) {
    const cellView = paper?.findViewByModel(cell)
    if (cellView) injectStencilSvg(cellView, stencil)
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

/** Записывает тег в слот ячейки + перерисовывает SVG (новые bindings). */
function patchSlotTag(key, tag) {
  withSelectedCell(
    ({ cell, tms }) => {
      const nextSlots = { ...(tms.slots || {}) }
      if (tag) nextSlots[key] = tag
      else delete nextSlots[key]
      cell.set('tms', { ...tms, slots: nextSlots })
    },
    { reinject: true }
  )
}

// ─── Редактирование текста (стенсил cell_text) ───
// Секция целиком в useTextCellProps (patch + ресайз под текст; ALIGN/BOLD-опции там же).
const { applyText, applyFontSize, applyBold, applyColor, applyAlign } = useTextCellProps({
  withSelectedCell,
})

// ─── Провод: стиль линии (толщина/цвет) ───
// Пишем в JointJS-attr (мгновенная отрисовка) + в tms[tmsKey] (round-trip через
// data-tms-meta + автосейв). Дефолт в tms не держим — meta пишет только
// нестандартное значение (как align='left'). isDefault решает, дефолт ли значение.
function applyLinkStyle(attrPath, tmsKey, isDefault, value) {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || d?.kind !== 'link' || value == null) return
  const link = graph.getCell(d.id)
  if (!link) return
  link.attr(attrPath, value)
  const tms = link.get('tms') || {}
  const next = { ...tms }
  if (isDefault(value)) delete next[tmsKey]
  else next[tmsKey] = value
  link.set('tms', next)
  canvas.bumpVersion()
  canvas.requestSnapshot()
}
const applyStrokeWidth = (v) => applyLinkStyle('line/strokeWidth', 'strokeWidth', (x) => x === 2, v)
const applyStrokeColor = (c) =>
  applyLinkStyle('line/stroke', 'strokeColor', (x) => x === '#000000' || x === '#000', c)

// ─── Замок ячейки ───
function applyLockToggle() {
  const d = details.value
  if (!d || d.kind !== 'cell') return
  canvas.toggleLocked([{ kind: 'cell', id: d.id }])
}

// Замок для ЦЕЛЬНОЙ группы (не произвольного мультивыделения — там замка нет).
// Тумблер «включён» = все члены группы locked; клик лочит/снимает всю группу.
const multiLock = computed(() => {
  canvas.graphVersion.value
  const graph = canvas.graphRef.value
  if (!graph) return { allLocked: false }
  const cells = canvas.selection.value
    .filter((s) => s.kind === 'cell')
    .map((s) => graph.getCell(s.id))
    .filter(Boolean)
  return { allLocked: cells.length > 0 && cells.every((c) => c.get('tms')?.locked) }
})

function applyMultiLockToggle() {
  canvas.toggleLocked(canvas.selection.value)
}

// Состав выделения: символы и провода СЧИТАЕМ РАЗДЕЛЬНО. В выделение авто-попадают
// мостовые провода (selectCellsWithBridges), поэтому `selection.length` называть
// «символами» нельзя — лассо по двум связанным символам дало бы «3 символа».
// `deletable` — сколько реально удалится (замок не даёт удалить), чтобы кнопка
// «Удалить (N)» не обещала больше, чем сделает.
const selectionSummary = computed(() => {
  canvas.graphVersion.value
  const sel = canvas.selection.value
  const cells = sel.filter((s) => s.kind === 'cell')
  const links = sel.filter((s) => s.kind === 'link')
  const graph = canvas.graphRef.value
  const lockedCells = graph
    ? cells.filter((s) => graph.getCell(s.id)?.get('tms')?.locked).length
    : 0
  const parts = []
  if (cells.length) parts.push(nplural(cells.length, 'символ', 'символа', 'символов'))
  if (links.length) parts.push(nplural(links.length, 'провод', 'провода', 'проводов'))
  return {
    label: parts.join(' + ') || 'ничего',
    // Тот же фильтр, что у deleteItems и пункта «Удалить» в контекст-меню.
    deletable: canvas.writableItems(sel).length,
    locked: lockedCells,
  }
})

// Группировка выделения. `ungroup`=true, когда все выделенные — члены ОДНОЙ группы
// (клик по группе выделяет её целиком → показываем «Разгруппировать»); иначе при
// ≥2 ячейках — «Сгруппировать» (объединит, в т.ч. слив разные группы в одну).
const multiGroup = computed(() => {
  canvas.graphVersion.value
  const graph = canvas.graphRef.value
  if (!graph) return { show: false, ungroup: false }
  const cells = canvas.selection.value
    .filter((s) => s.kind === 'cell')
    .map((s) => graph.getCell(s.id))
    .filter(Boolean)
  if (cells.length < 2) return { show: false, ungroup: false }
  const gids = cells.map((c) => c.get('tms')?.groupId)
  const sameGroup = gids.every((g) => g && g === gids[0])
  return { show: true, ungroup: sameGroup }
})

function applyGroupToggle() {
  if (multiGroup.value.ungroup) {
    const n = canvas.ungroupCells(canvas.selection.value)
    if (n) notify.success('Разгруппировано', nplural(n, 'символ', 'символа', 'символов'))
  } else {
    const n = canvas.groupCells(canvas.selection.value)
    if (n) notify.success('Сгруппировано', nplural(n, 'символ', 'символа', 'символов'))
  }
}

// Кнопка-замок в шапке инспектора: доступна для одиночной ячейки и для цельной
// группы (единый объект); у произвольного мультивыделения замка нет.
const lockState = computed(() => {
  const d = details.value
  if (d && d.kind === 'cell') return { show: true, locked: d.locked }
  if (multiGroup.value.ungroup) return { show: true, locked: multiLock.value.allLocked }
  return { show: false, locked: false }
})

function onToggleLock() {
  const d = details.value
  if (d && d.kind === 'cell') applyLockToggle()
  else if (multiGroup.value.ungroup) applyMultiLockToggle()
}

// ─── Tag-picker для cell_value (отображаемый тег) ───
function openValueTagPicker() {
  openPicker({
    tags: project.floatTags,
    selected: details.value?.valueTag || '',
    header: 'Выберите тег для отображения значения',
    onSelect: onPickValueTag,
  })
}

const valueDisplay = computed(() => {
  if (!details.value?.isValue) return null
  return resolveValueDisplay(details.value.valueTag)
})

function onPickValueTag(tag) {
  // Перерисовка — buildValueContent читает свежий tms.valueTag и обновляет label/unit.
  withSelectedCell(
    ({ cell, tms, d }) => {
      if (!d.isValue) return false
      if ((tms.valueTag ?? '') === tag) return false
      cell.set('tms', { ...tms, valueTag: tag })
    },
    { reinject: true }
  )
}

/**
 * Резолвит выделенную ячейку/линк, отдаёт её tms в `updater(tms)` → новый tms,
 * пишет его + bumpVersion + requestSnapshot. `updater` возвращает `undefined`,
 * чтобы ничего не менять (no-op).
 */
function mutateSelectedTms(updater) {
  const graph = canvas.graphRef.value
  const d = details.value
  if (!graph || !d) return
  const cell = graph.getCell(d.id)
  if (!cell) return
  const next = updater(cell.get('tms') || {})
  if (next === undefined) return
  cell.set('tms', next)
  canvas.bumpVersion()
  canvas.requestSnapshot()
}

// ─── Диапазоны значений (voltageSource) ───
// Секция целиком в useVoltageRanges: одиночный режим + мульти-шаблон.
const {
  openVoltagePicker,
  updateRange,
  removeVoltageSource,
  toggleVoltageHighlight,
  multiVoltage,
  openMultiVoltagePicker,
  updateMultiVoltageRange,
  removeMultiVoltage,
  toggleMultiVoltageHighlight,
} = useVoltageRanges({ details, mutateSelectedTms, openPicker })

// ─── switchSources: зависимости-теги ГРУППАМИ (DNF) ───
// Секция целиком в useSwitchGroups (форма { groups }, picker, add/edit/remove).
const {
  switchGroups,
  switchRemovable,
  onAddGroup,
  onAddSwitchTag,
  editSwitchTagAt,
  removeSwitchTagAt,
  removeSwitchGroup,
  removeSwitchSources,
} = useSwitchGroups({ details, mutateSelectedTms, openPicker })

/** Открыть picker массовой привязки булева тега (multi-select). */
function openMultiSwitchPicker() {
  openPicker({
    tags: project.booleanTags,
    header: 'Булев тег для всех выделенных символов',
    onSelect: onPickMultiSwitchTag,
  })
}

/** Multi-select: добавить тег НОВОЙ группой [tag] в switchSources всех
 * выделенных (у выделения нет общего состояния → каждому — своя новая группа,
 * не дублируя уже существующую одиночную группу с этим тегом). */
function onPickMultiSwitchTag(tag) {
  if (!tag) return
  const sel = canvas.selection.value
  if (!sel.length) return
  // writableItems отсекает заблокированные (замок read-only) — их считаем в skipped.
  const writable = canvas.writableItems(sel)
  let applied = 0
  let skipped = sel.length - writable.length
  for (const cell of writable) {
    const tms = cell.get('tms') || {}
    if (isStatic(tms.stencilId)) {
      skipped++
      continue
    }
    // Свитчи (стенсилы с slot.onoff) не должны зависеть от своего же тега —
    // slot.onoff уже отвечает за переключение, дубль в switchSources бессмыслен.
    if (hasBoolSlot(getStencilById(tms.stencilId)) && tms.slots?.onoff === tag) {
      skipped++
      continue
    }
    const groups = normalizeSwitchSources(tms.switchSources).groups
    // Уже есть одиночная группа ровно с этим тегом → не плодим дубль.
    if (groups.some((g) => g.length === 1 && g[0] === tag)) {
      applied++
      continue
    }
    cell.set('tms', { ...tms, switchSources: { groups: [...groups, [tag]] } })
    applied++
  }
  canvas.bumpVersion()
  canvas.requestSnapshot()
  const count = nplural(applied, 'символ', 'символа', 'символов')
  const detail =
    skipped > 0
      ? `Привязано к ${count} · пропущено: ${skipped} (заблокировано / текст / свой тег)`
      : `Привязано к ${count}`
  // applied === 0 — успеха не было: зелёный тост врал бы про результат.
  if (applied === 0) notify.warn('Тег не привязан', detail)
  else notify.success('Булев тег привязан', detail)
}

// ─── Копирование настроек анимаций между элементами ───
// Буфер (useAnimationClipboard) держит два независимых слота — булев блок и
// диапазоны, — копируются/вставляются раздельно кнопками в шапке своего блока.
// Копируем ЦЕЛИКОМ, включая тег (предсказуемый «тот же источник»); тег при нужде
// меняют вручную после вставки. toPlain снимает reactive-прокси — иначе вставка
// делила бы одну ссылку между ячейками. Вставка идёт на ВСЁ текущее выделение
// (одиночное и мульти), со счётчиком пропущенных (несовместимые цели).

/** Копировать булев блок выделенного: свой тег (slot.onoff) + группы-зависимости. */
function copyBool() {
  const d = details.value
  if (!d) return
  animClip.copyBool(toPlain({ onoffTag: d.onoffTag || null, groups: switchGroups.value }))
  notify.success('Скопировано', 'Булевые настройки анимации')
}

/** Копировать диапазоны выделенного (voltageSource целиком: тег + пороги). */
function copyRange() {
  const d = details.value
  if (!d?.voltageSource) return
  animClip.copyRange(toPlain(d.voltageSource))
  notify.success('Скопировано', 'Диапазоны значений')
}

/**
 * Вставить булев блок из буфера на всё текущее выделение. Группы-зависимости
 * (switchSources) раздаём любому не-static элементу/проводу; свой булев тег
 * (onoff) — только стенсилам с булевым слотом (иначе некуда его писать). Статичные
 * стенсилы (текст/значение) пропускаем со счётчиком.
 */
function pasteBool() {
  const clip = animClip.boolClip.value
  // Вставка ЗАМЕНЯЕТ блок целиком: буфер без групп снимает switchSources у цели.
  // Считаем такие случаи, чтобы не стереть зависимости молча (тост станет warn).
  const clipHasGroups = !!(clip?.groups || []).some((g) => g.length)
  pasteClip(
    clip,
    (tms) =>
      applyBoolClip(tms, clip, {
        isStatic: isStatic(tms.stencilId),
        hasBoolSlot: hasBoolSlot(getStencilById(tms.stencilId)),
      }),
    (tms) => !clipHasGroups && !!tms.switchSources
  )('Булевые настройки вставлены')
}

/** Вставить диапазоны из буфера на всё текущее выделение (voltageSource целиком,
 *  свежий клон на ячейку). Статичные стенсилы пропускаем. */
function pasteRange() {
  pasteClip(animClip.rangeClip.value, (tms) =>
    applyRangeClip(tms, animClip.rangeClip.value, { isStatic: isStatic(tms.stencilId) })
  )('Диапазоны вставлены')
}

/**
 * Общий каркас вставки буфера на всё выделение: для каждой цели зовёт apply(tms) →
 * новый tms либо null (несовместимо → пропуск со счётчиком). Заблокированные
 * отсекает `writableItems`. Пустой буфер — no-op. `wasCleared(tmsBefore)` (опц.)
 * помечает цели, у которых вставка СНЯЛА настройку — такие считаем отдельно и
 * выводим warn, чтобы данные не исчезали молча под зелёным тостом.
 * Возвращает функцию-финализатор (принимает заголовок тоста).
 */
function pasteClip(clip, apply, wasCleared = null) {
  return (title) => {
    if (!clip) return
    const sel = canvas.selection.value
    const writable = canvas.writableItems(sel)
    let applied = 0
    let skipped = sel.length - writable.length // заблокированные
    let cleared = 0
    for (const cell of writable) {
      const before = cell.get('tms') || {}
      const next = apply(before)
      if (!next) {
        skipped++
        continue
      }
      if (wasCleared?.(before)) cleared++
      cell.set('tms', next)
      applied++
    }
    canvas.bumpVersion()
    canvas.requestSnapshot()
    const parts = [`Применено к ${nplural(applied, 'символ', 'символа', 'символов')}`]
    if (skipped) parts.push(`пропущено: ${skipped}`)
    if (cleared) parts.push(`зависимости очищены: ${cleared}`)
    const detail = parts.join(' · ')
    // Нулевой результат или снятые настройки — не «успех».
    if (applied === 0) notify.warn('Настройки не применены', detail)
    else if (cleared) notify.warn(title, detail)
    else notify.success(title, detail)
  }
}

// ─── Hyperlink-навигация: клик в рантайме открывает другую view ───
// Секция целиком в useNavigationField (черновик + коммит по blur/Enter/выбору).
const {
  navigationEnabled,
  navInput,
  navSuggestions,
  otherFormIds,
  navBroken,
  toggleNavigationEnabled,
  onNavComplete,
  commitNav,
} = useNavigationField({ details, mutateSelectedTms })
</script>

<template>
  <aside class="h-full flex flex-col bg-surface-50">
    <div class="relative min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center">
      <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Инспектор</h2>
      <!-- Замок выделенного (одиночная ячейка или цельная группа) — абсолютом
           справа-сверху, единая точка во всех случаях. -->
      <Button
        v-if="lockState.show"
        v-tooltip.bottom="lockState.locked ? 'Разблокировать' : 'Заблокировать'"
        :icon="lockState.locked ? 'pi pi-lock' : 'pi pi-unlock'"
        :severity="lockState.locked ? 'primary' : 'secondary'"
        text
        rounded
        size="small"
        class="!absolute !right-2 !top-1/2 !-translate-y-1/2 !w-8 !h-8 !p-0"
        @click="onToggleLock"
      />
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm">
      <!-- Multi-select: больше одного символа — показываем сводку + удаление -->
      <template v-if="canvas.selection.value.length > 1">
        <div class="[&>*+*]:border-t [&>*+*]:border-surface-200 [&>*+*]:pt-4 [&>*+*]:mt-4">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
              {{ multiGroup.ungroup ? 'Группа' : 'Выделено' }}
            </div>
            <div class="font-medium text-surface-900">
              {{ selectionSummary.label }}
              <span v-if="selectionSummary.locked" class="text-[11px] font-normal text-surface-500">
                · {{ selectionSummary.locked }} заблокировано
              </span>
            </div>
            <p class="text-[11px] text-surface-500 mt-2">
              {{
                multiGroup.ungroup
                  ? 'Группа ведёт себя как один символ. Анимации применяются ко всем членам.'
                  : 'Символы можно тащить группой, удалить клавишей Del. Анимации ниже применяются ко всему выделению; остальные свойства — при одном выделенном.'
              }}
            </p>
          </div>

          <!-- Группировка: объединить выделенное в группу (клик по члену выделяет
               всю группу) либо разгруппировать. -->
          <div v-if="multiGroup.show">
            <Button
              :label="multiGroup.ungroup ? 'Разгруппировать' : 'Сгруппировать'"
              :icon="multiGroup.ungroup ? 'pi pi-table' : 'pi pi-th-large'"
              severity="secondary"
              outlined
              size="small"
              class="w-full"
              @click="applyGroupToggle"
            />
          </div>

          <!-- Выравнивание ячеек по рамке выделения. Только для ПРОИЗВОЛЬНОГО
               мультивыделения (≥2 ячеек), НЕ для цельной группы — та единый объект,
               внутреннюю раскладку не трогаем. Три категории: гориз./верт.
               выравнивание, распределение; центры снапятся к сетке. -->
          <div v-if="canAlign && !multiGroup.ungroup" class="space-y-2.5">
            <div v-for="row in ALIGN_ROWS" :key="row.label" class="flex items-center gap-3">
              <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                {{ row.label }}
              </span>
              <div class="ml-auto flex items-center gap-1">
                <button
                  v-for="btn in row.buttons"
                  :key="btn.op"
                  type="button"
                  v-tooltip.bottom="btn.tip"
                  :disabled="row.kind === 'distribute' && !canDistribute"
                  class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900 disabled:cursor-not-allowed disabled:opacity-40"
                  @click="row.kind === 'distribute' ? distributeCells(btn.op) : alignCells(btn.op)"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <rect
                      v-for="(r, i) in btn.rects"
                      :key="i"
                      :x="r.x"
                      :y="r.y"
                      :width="r.w"
                      :height="r.h"
                      :rx="r.rx"
                      :opacity="r.o"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Multi-select: те же блоки, что в single, как «применить ко всем»
               (общего состояния у выделения нет → списки пустые/шаблон, выбор тега
               и порогов раздаётся на всё выделение). Булев — BooleanBlock без групп:
               «+ группа» раздаёт тег новой группой на всё выделение. Range — шаблон
               multiVoltage: задаёшь тег → правишь пороги → на все выделенные. -->
          <div class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>
            <BooleanBlock
              :slot-info="null"
              :groups="[]"
              :removable="false"
              :tags-loaded="!!project.tags.length"
              :pasteable="animClip.hasBool.value"
              title="Булево значение"
              @add-group="openMultiSwitchPicker"
              @paste="pasteBool"
            />
            <RangeBlock
              :voltage-source="multiVoltage"
              :tags-loaded="!!project.tags.length"
              :class-options="ANIMATION_CLASS_OPTIONS"
              :pasteable="animClip.hasRange.value"
              @open-tag-picker="openMultiVoltagePicker"
              @update-range="updateMultiVoltageRange"
              @highlight="toggleMultiVoltageHighlight"
              @remove="removeMultiVoltage"
              @paste="pasteRange"
            />
          </div>

          <div class="pt-2 border-t border-surface-200">
            <Button
              :label="`Удалить (${selectionSummary.deletable})`"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              @click="onDelete"
            />
          </div>
        </div>
      </template>

      <template v-else-if="!details">
        <div>
          <div class="flex flex-col items-center text-center text-surface-400 pb-6 pt-8">
            <i class="pi pi-mouse text-3xl mb-3 opacity-60" />
            <div class="text-sm font-medium text-surface-500 mb-1">Ничего не выделено</div>
            <p class="text-[11px] leading-relaxed max-w-[180px]">
              Кликните по символу или проводу на холсте — здесь появятся свойства
            </p>
          </div>

          <!-- Холостой инспектор не простаивает: сводка активной формы + базовые
               хоткеи сразу под подсказкой; свободное место уходит вниз. -->
          <div class="space-y-4 border-t border-surface-200 pt-4 text-[11px]">
            <div>
              <div class="mb-2 uppercase tracking-wider text-surface-500">Сводка формы</div>
              <div class="flex flex-col gap-1 text-surface-600">
                <div class="flex justify-between">
                  <span>Символы</span>
                  <span class="font-mono">{{ canvas.cellsCount.value }}</span>
                </div>
                <div class="flex justify-between">
                  <span>Провода</span>
                  <span class="font-mono">{{ canvas.linksCount.value }}</span>
                </div>
                <div class="flex justify-between">
                  <span>Теги в tag-list</span>
                  <span class="font-mono">{{ project.tags.length }}</span>
                </div>
              </div>
            </div>
            <div>
              <div class="mb-2 uppercase tracking-wider text-surface-500">Подсказки</div>
              <ul class="flex flex-col gap-2 text-surface-500">
                <li class="flex items-center gap-2">
                  <i class="pi pi-arrows-alt !text-[10px] text-surface-400" />
                  Перетащи символ из палитры на холст
                </li>
                <li class="flex items-center gap-2">
                  <kbd class="rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px]">Ctrl+F</kbd>
                  поиск по тегам
                </li>
                <li class="flex items-center gap-2">
                  <kbd class="rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px]">?</kbd>
                  справка по хоткеям
                </li>
              </ul>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="details">
        <!-- Замок ячейки — кнопка в шапке инспектора (см. выше), не строкой. При
             locked свойства блокируются inert'ом; кнопка-замок вне его — снять можно. -->
        <div
          :inert="!!details.locked"
          :class="{ 'opacity-60': details.locked }"
          class="[&>*+*]:border-t [&>*+*]:border-surface-200 [&>*+*]:pt-4 [&>*+*]:mt-4"
        >
          <template v-if="details.kind === 'cell'">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Символ</div>
              <div class="font-medium text-surface-900">
                {{ details.stencilLabel }}
              </div>
              <div class="text-[11px] text-surface-500 font-mono">
                {{ details.stencilId }}
              </div>
              <!-- id outer-карточки в animations.json / экспортном SVG (тот же, что
                   эмитит exporter; точная подстановка short-id см. constants/ids). -->
              <div class="text-[11px] text-surface-500 font-mono break-all">
                {{ details.exportId }}
              </div>
            </div>

            <!-- Текстовое поле: редактирование содержимого + стиль. Параметры —
                 строкой «подпись слева, контрол справа» (как в редакторе). Само поле
                 ввода текста — исключение: подпись сверху, инпут во всю ширину. -->
            <div v-if="details.isText" class="space-y-2.5">
              <div>
                <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Текст</div>
                <InputText
                  :model-value="details.text"
                  size="small"
                  class="w-full"
                  placeholder="Введите текст"
                  @update:model-value="applyText"
                />
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Размер, pt
                </span>
                <InputNumber
                  :model-value="details.fontSize"
                  :min="6"
                  :max="72"
                  :step="1"
                  show-buttons
                  button-layout="horizontal"
                  size="small"
                  input-class="!w-12 text-center"
                  class="ml-auto"
                  @update:model-value="applyFontSize"
                />
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Жирность
                </span>
                <SelectButton
                  :model-value="details.bold ? 'bold' : null"
                  :options="BOLD_OPTIONS"
                  option-value="value"
                  data-key="value"
                  size="small"
                  class="ml-auto"
                  @update:model-value="(v) => applyBold(v === 'bold')"
                >
                  <template #option>
                    <span class="font-bold" v-tooltip.top="'Жирный'">B</span>
                  </template>
                </SelectButton>
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Цвет
                </span>
                <input
                  type="color"
                  :value="details.color || '#000000'"
                  class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                  @input="applyColor($event.target.value)"
                />
              </div>

              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Выравнивание
                </span>
                <SelectButton
                  :model-value="details.align"
                  :options="ALIGN_OPTIONS"
                  option-value="value"
                  data-key="value"
                  :allow-empty="false"
                  size="small"
                  class="ml-auto"
                  @update:model-value="applyAlign"
                >
                  <template #option="{ option }">
                    <i :class="option.icon" v-tooltip.top="option.tip" />
                  </template>
                </SelectButton>
              </div>
            </div>

            <!-- cell_value: picker одного полного тега для отображения значения -->
            <div v-else-if="details.isValue">
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                Тег значения
              </div>
              <TagField
                :value="details.valueTag || ''"
                :can-pick="!!project.tags.length"
                @pick="openValueTagPicker"
              />
              <div
                v-if="details.valueTag && valueDisplay"
                class="text-[11px] text-surface-500 mt-2 font-mono"
              >
                Подпись:
                <span class="text-surface-700">{{ valueDisplay.label }}</span>
                <template v-if="valueDisplay.unit">
                  · единица:
                  <span class="text-surface-700">{{ valueDisplay.unit }}</span>
                </template>
              </div>
            </div>

            <!-- Навигация (hyperlink на другую форму при клике в рантайме). Цель —
 id формы проекта (= view-id рантайма): можно выбрать из списка форм ИЛИ ввести
 view-id вручную (editable) — напр. для view, которой ещё нет в проекте. Свич
 справа от заголовка показывает/скрывает поле; выключение очищает значение. -->
            <div v-if="!details.isText" class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-surface-500">Навигация</div>
                  <div class="text-[11px] text-surface-500">переход при клике</div>
                </div>
                <ToggleSwitch
                  :model-value="navigationEnabled"
                  @update:model-value="toggleNavigationEnabled"
                />
              </div>
              <template v-if="navigationEnabled">
                <AutoComplete
                  :model-value="navInput"
                  :suggestions="navSuggestions"
                  dropdown
                  complete-on-focus
                  size="small"
                  placeholder="Форма или view-id"
                  class="w-full"
                  input-class="w-full !text-xs"
                  @update:model-value="(v) => (navInput = v)"
                  @complete="onNavComplete"
                  @item-select="commitNav"
                  @blur="commitNav"
                  @keyup.enter="commitNav"
                />
                <div v-if="navBroken" class="text-[11px] text-surface-500">
                  Внешняя view (не среди загруженных форм) — сработает, если она есть в рантайме
                </div>
                <div v-else-if="!otherFormIds.length" class="text-[11px] text-surface-500">
                  Загруженных форм нет — введите view-id вручную
                </div>
              </template>
            </div>
          </template>

          <template v-else>
            <div class="space-y-2.5">
              <div>
                <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
                  Элемент
                </div>
                <div class="font-medium text-surface-900">Провод</div>
              </div>

              <!-- Толщина линии — строка «подпись слева / контрол справа» (как размер
                   текста); InputNumber со степперами, как толщина линии в редакторе. -->
              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Толщина, px
                </span>
                <InputNumber
                  :model-value="details.strokeWidth"
                  :min="0.5"
                  :max="20"
                  :step="0.5"
                  show-buttons
                  button-layout="horizontal"
                  size="small"
                  input-class="!w-12 text-center"
                  class="ml-auto"
                  @update:model-value="applyStrokeWidth"
                />
              </div>

              <!-- Цвет линии — строка «подпись слева / пикер справа» (как цвет текста). -->
              <div class="flex items-center gap-3">
                <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
                  Цвет
                </span>
                <input
                  type="color"
                  :value="details.strokeColor"
                  class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                  @input="applyStrokeColor($event.target.value)"
                />
              </div>
            </div>
          </template>

          <div v-if="!details.isText && !details.isValue" class="space-y-2">
            <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>

            <!-- Стенсил «по значению»: привязка тега сигнала (состояния и их вид
                 запечены в стенсиле, здесь только тег-драйвер). -->
            <div v-if="valueStateSlot" class="border border-surface-200 rounded p-3 bg-surface-0">
              <div class="flex items-center gap-2 mb-2 min-h-6">
                <i class="pi pi-sitemap text-purple-500" />
                <div class="text-xs font-medium text-surface-700">Состояние по значению</div>
              </div>
              <div class="text-[11px] text-surface-500 mb-1">
                Тег
                <span class="text-surface-400">- сигнал, значение выбирает состояние</span>
              </div>
              <TagField
                :value="valueStateSlot.value"
                :can-pick="!!project.tags.length"
                highlightable
                @pick="openSlotPicker(valueStateSlot)"
                @highlight="canvas.toggleHighlightedTag(valueStateSlot.value)"
              />
            </div>

            <!-- Булево значение — виден ВСЕГДА. У стенсила с булевым слотом
                 (onoff, в т.ч. cell_alr) первой строкой идёт этот слот (основной
                 тег), ниже — зависимости switchSources. Теги пишутся лениво через
                 «Добавить»; × очищает (switchRemovable). -->
            <BooleanBlock
              :slot-info="details.hasBoolSlot ? details.slots[0] : null"
              :groups="switchGroups"
              :removable="switchRemovable"
              :tags-loaded="!!project.tags.length"
              :copyable="!!(details.onoffTag || switchGroups.length)"
              :pasteable="animClip.hasBool.value"
              title="Булево значение"
              @open-slot-picker="openSlotPicker(details.slots[0])"
              @add-group="onAddGroup"
              @add-tag="onAddSwitchTag"
              @edit-tag="editSwitchTagAt"
              @remove-tag="removeSwitchTagAt"
              @remove-group="removeSwitchGroup"
              @remove="removeSwitchSources"
              @highlight-tag="canvas.toggleHighlightedTag"
              @copy="copyBool"
              @paste="pasteBool"
            />

            <!-- Диапазоны значений (аналоговое значение) — виден всегда.
                 voltageSource создаётся лениво при выборе тега (onPickTag),
                 очищается через × (виден при непустом). -->
            <RangeBlock
              :voltage-source="details.voltageSource"
              :tags-loaded="!!project.tags.length"
              :class-options="ANIMATION_CLASS_OPTIONS"
              :copyable="!!details.voltageSource"
              :pasteable="animClip.hasRange.value"
              @open-tag-picker="openVoltagePicker"
              @update-range="updateRange"
              @highlight="toggleVoltageHighlight"
              @remove="removeVoltageSource"
              @copy="copyRange"
              @paste="pasteRange"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- Единый tag-picker для всех мест инспектора (слот / диапазоны / значение /
         булев / multi-select) — открывается через openPicker, см. picker-ref. -->
    <TagPickerDialog
      :visible="!!picker"
      :tags="picker?.tags || []"
      :selected="picker?.selected || ''"
      :header="picker?.header || 'Выберите тег'"
      @update:visible="(v) => !v && (picker = null)"
      @select="onPickerSelect"
    />
  </aside>
</template>
