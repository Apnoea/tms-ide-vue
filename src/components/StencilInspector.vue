<script setup>
/**
 * Свойства символа — контент правой панели в режиме редактора. Секции:
 * идентификация (название/id/категория), поведение (флаги), «Анимации» — ДВА
 * сворачиваемых блока состояния (булево / по значению; открыт максимум один, оба
 * закрытых = анимации нет) и диапазоны значений, и фигура (свойства выделенного
 * элемента + его видимость по состоянию).
 *
 * Анимации оформлены КАРТОЧКАМИ как в инспекторе холста (StateBlock/RangeBlock): это
 * одна настройка с двух сторон — здесь задаётся поведение символа, там у экземпляра
 * привязывается тег.
 *
 * Стейт — синглтон useStencilEditor (тот же инстанс, что рисуется в центре).
 */
import { computed, ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import SelectButton from 'primevue/selectbutton'
import Button from 'primevue/button'
import ColorField from './ColorField.vue'
import { getAllStencils, getCategories, registryVersion } from '../stencils/registry'
import { useStencilEditor, STATE_PRESETS } from '../composables/useStencilEditor'
import { normalizeStateColor } from '../constants/animation'
import { STENCIL_DOMAINS } from '../constants/domains'
import { ALIGN_OPTIONS } from '../constants/text'
import RangeRows from './RangeRows.vue'
import { isFillableShape, stencilDraftProblems, TEXT_SHAPE_SIZE } from '../utils/stencilSvg'
import { FONT_FAMILIES, normalizeFont } from '../utils/textMetrics'

const {
  meta,
  editingId,
  shapes,
  selectedId,
  selectedIds,
  updateShape,
  selectedFor,
  commonValue,
  applyToSelected,
  commit,
  setAnimationMode,
  addState,
  updateState,
  removeState,
  setStateColor,
  applyPositionPreset,
  previewState,
  addRange,
  updateRange,
  removeRange,
} = useStencilEditor()

/**
 * Проблемы черновика ЖИВЬЁМ, по полям: занятый id или пустая категория видны сразу,
 * а не тостом после клика «Сохранить». Те же правила, что проверяет сохранение
 * (`stencilDraftProblems`) — разойтись они не могут.
 *
 * Правится существующий символ — его собственный id из списка занятых исключается.
 * Пустой черновик (редактор только открыли) не краснеет: ошибок там ещё нет, а
 * подсвеченная панель на старте читается как поломка.
 */
const problemByField = computed(() => {
  registryVersion.value // список символов мог измениться, пока редактор открыт
  const existingIds = getAllStencils()
    .map((s) => s.id)
    .filter((id) => id !== editingId.value)
  const map = new Map()
  if (!meta.id && !meta.label && !shapes.value.length) return map
  for (const p of stencilDraftProblems(meta, shapes.value, existingIds)) {
    if (!map.has(p.field)) map.set(p.field, p.message)
  }
  return map
})

const problemOf = (field) => problemByField.value.get(field) || ''

/**
 * Превью состояния: стол показывает только фигуры выбранного (эмуляция
 * `animation-hidden` + цвет состояния, см. StencilEditor.renderShapes). Живёт в строке
 * состояния, а не отдельным контролом над столом: «строка ↔ что видно» — одна и та же
 * вещь, и связь читается без объяснений. Повторный клик возвращает «все».
 */
function togglePreview(key) {
  previewState.value = previewState.value === key ? 'all' : key
}

// Свойства фигуры правятся сразу по ВСЕМУ выделению; поля геометрии и подписи — только
// при одной выделенной (selectedShape). Расхождение значений показывается, см. *Mixed.
const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null)
const multiCount = computed(() => selectedIds.value.length)

// Применимость по типу примитива: у линии нет заливки, у круга — скругления, у подписи
// ни того ни другого (видимость по состоянию есть). Цвет есть у всех — у подписи это
// цвет глифов в поле `stroke`.
const FILLABLE = (s) => s.type !== 'line' && s.type !== 'text'
const ROUNDABLE = (s) => s.type !== 'circle' && s.type !== 'text'
const NOT_TEXT = (s) => s.type !== 'text'

// Контрол показывается, если свойство применимо хоть к одной выделенной фигуре.
const hasFill = computed(() => selectedFor(FILLABLE).length > 0)
const hasStrokeWidth = computed(() => selectedFor(NOT_TEXT).length > 0)

// Подпись правится содержимым/размером/жирностью/шрифтом; обводки, заливки и
// скругления у неё нет, а видимость по состоянию — есть (прячется через
// animation-hidden наравне с остальными фигурами).
const isTextShape = computed(() => selectedShape.value?.type === 'text')
const textSize = computed(() => selectedShape.value?.fontSize ?? TEXT_SHAPE_SIZE)

// Текст подписи пишется живьём, шаг истории — по коммиту (blur). Пустой текст
// фигуру НЕ удаляет: подпись-параметр приходит с холста, а в редакторе её рисует
// иконка (см. ShapePrimitive).
const textDraft = ref(null)
const textValue = computed(() => textDraft.value ?? selectedShape.value?.text ?? '')

function setText(v) {
  const next = v ?? ''
  textDraft.value = next
  if (selectedShape.value) updateShape(selectedShape.value.id, { text: next })
}

// Чип области применения: тогл + шаг истории (мета символа входит в undo-снимок).
function toggleDomain(key) {
  const next = new Set(meta.domains)
  if (!next.delete(key)) next.add(key)
  meta.domains = [...next]
  commit()
}

function commitText() {
  const draft = textDraft.value
  textDraft.value = null
  if (draft !== null) commit()
}

// Черновик не должен переезжать на другую фигуру при смене выделения.
watch(
  () => selectedShape.value?.id,
  () => (textDraft.value = null)
)
function setTextSize(v) {
  if (selectedShape.value && v != null) updateShape(selectedShape.value.id, { fontSize: v })
}
function setTextBold(on) {
  if (!selectedShape.value) return
  updateShape(selectedShape.value.id, { bold: !!on })
  commit()
}

// Текст из тега: слот и text-карточку по этому флагу собирает buildStencilJson.
function setValueText(on) {
  if (!selectedShape.value) return
  updateShape(selectedShape.value.id, { valueText: !!on })
  commit()
}

/**
 * Параметр — подпись, которую правят у каждого экземпляра (текст фигуры остаётся
 * значением по умолчанию и подписью поля в инспекторе холста). Ключ выдаём сами:
 * автору он не нужен.
 *
 * Снятая галка ПОМНИТ ключ (`paramPrev`) и возвращает его при повторном включении:
 * значения экземпляров лежат под ключом, и новый номер осиротил бы уже расставленные
 * подписи по всем формам.
 */
function setParam(on) {
  const shape = selectedShape.value
  if (!shape) return
  updateShape(
    shape.id,
    on
      ? { param: shape.paramPrev || nextParamKey(), paramPrev: undefined }
      : { param: undefined, paramPrev: shape.param }
  )
  commit()
}

// Номер — от максимума занятых, включая снятые: иначе освободившийся ключ достался бы
// новой подписи, и в неё всплыл бы прежний текст экземпляра.
function nextParamKey() {
  const used = shapes.value
    .flatMap((s) => [s.param, s.paramPrev])
    .map((key) => /^p(\d+)$/.exec(key || '')?.[1])
    .filter(Boolean)
    .map(Number)
  return `p${Math.max(0, ...used) + 1}`
}

// Флаг стоит у нескольких подписей: слот и суффикс один, поэтому в схему уехала бы
// только одна из них.
const valueTextConflict = computed(
  () => shapes.value.filter((s) => s.type === 'text' && s.valueText).length > 1
)
// Выравнивание — якорь роста подписи: у фигуры без поля это центр, новым редактор
// ставит левый край.
const textAlign = computed(() => selectedShape.value?.align || 'center')
function setTextAlign(v) {
  if (!selectedShape.value || !v) return
  updateShape(selectedShape.value.id, { align: v })
  commit()
}

// Шрифт меняет габарит подписи (cropToContent считает его замером), поэтому
// коммитим сразу — как жирность, а не как ввод текста.
const textFont = computed(() => normalizeFont(selectedShape.value?.fontFamily))
function setTextFont(v) {
  if (!selectedShape.value) return
  updateShape(selectedShape.value.id, { fontFamily: normalizeFont(v) })
  commit()
}

// Заливку по состоянию (state-color) показываем, только когда в символе есть
// заливаемые фигуры (замкнутые примитивы) — иначе цвет заливки некуда применить.
const hasFillableShapes = computed(() => shapes.value.some(isFillableShape))
// Контур/заливка для ключа состояния из stateColors (строка или { stroke, fill }).
const stateStroke = (key) => normalizeStateColor(meta.stateColors[key]).stroke
const stateFill = (key) => normalizeStateColor(meta.stateColors[key]).fill

// Заглушки свотчей состояния — что показывать, пока цвет не задан (свотч при этом
// приглушён). Заливка НЕ белая: на светлой панели белый квадрат сливается с фоном и
// колонка выглядит пустой.
const STATE_STROKE_PLACEHOLDER = '#64748b' // slate-500
const STATE_FILL_PLACEHOLDER = '#cbd5e1' // slate-300

// Свотч цвета требует 6-значный #rrggbb: разворачиваем #rgb, «none»/пусто →
// запасной цвет (сам факт заливки регулируется отдельной галкой).
function normHex(c, fallback) {
  if (!c || c === 'none') return fallback
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + [...c.slice(1)].map((ch) => ch + ch).join('')
  }
  return c
}
// «Разные» = значение у выделенных фигур расходится (commonValue → undefined).
// У поля цвета пустого состояния нет, поэтому там показываем дефолт и подписываем
// расхождение словом; у числа/селекта — пустое поле с «—».
const mixed = (v, filter) => v === undefined && selectedFor(filter).length > 1

const strokeCommon = computed(() => commonValue((s) => s.stroke))
const strokeColor = computed(() => normHex(strokeCommon.value, '#000000'))
const strokeMixed = computed(() => mixed(strokeCommon.value))

const fillCommon = computed(() => commonValue((s) => s.fill, FILLABLE))
const fillState = computed(() => commonValue((s) => !!s.fill && s.fill !== 'none', FILLABLE))
const fillEnabled = computed(() => fillState.value === true)
const fillMixed = computed(() => mixed(fillState.value, FILLABLE))
const fillColor = computed(() => normHex(fillCommon.value, '#ffffff'))

// Живое обновление на каждый сдвиг палитры (видно на холсте сразу), один снимок
// истории на `change` (палитра закрыта, код применён) — как жесты рисования.
function setStroke(color) {
  applyToSelected({ stroke: color })
}
const strokeWidthCommon = computed(() => commonValue((s) => s.strokeWidth ?? 2, NOT_TEXT))
const strokeWidth = computed(() => strokeWidthCommon.value ?? null)
function setStrokeWidth(v) {
  if (v != null) applyToSelected({ strokeWidth: v }, NOT_TEXT)
}
function setFill(color) {
  applyToSelected({ fill: color }, FILLABLE)
}
function toggleFill(on) {
  // При расхождении галка приходит в true — первый клик включает заливку всем
  // (цвет берём общий, а если и он разный — дефолтный белый).
  applyToSelected({ fill: on ? normHex(fillCommon.value, '#ffffff') : 'none' }, FILLABLE)
  commit()
}

// Скругление: у линии/ломаной — круглые торцы/стыки, у прямоугольника — углы (rx).
// Круг скруглять нечего — контрол скрыт.
const hasRounding = computed(() => selectedFor(ROUNDABLE).length > 0)
const roundedState = computed(() => commonValue((s) => !!s.rounded, ROUNDABLE))
const roundedEnabled = computed(() => roundedState.value === true)
const roundedMixed = computed(() => mixed(roundedState.value, ROUNDABLE))
function toggleRounded(on) {
  applyToSelected({ rounded: !!on }, ROUNDABLE)
  commit()
}

// Единый свитч анимации состояния: Выкл / Булево / По значению. Тумблер + режим
// меняет setAnimationMode — одной операцией, одним шагом истории.
/**
 * Режимы анимации состояния — ДВА сворачиваемых блока, а не таб: у символа работает
 * ровно один (`stateMode`), поэтому открыт тоже ровно один, а закрытые оба = анимация
 * выключена. Заголовок блока и есть переключатель — отдельного «Выкл» не нужно.
 */
const ANIM_MODES = [
  { value: 'boolean', label: 'Булево значение', icon: 'pi-power-off' },
  { value: 'value', label: 'Состояние по значению', icon: 'pi-sliders-h' },
]

/** Какой блок раскрыт: `null` — анимации нет. */
const openMode = computed(() => (meta.stateful ? meta.stateMode : null))

/**
 * Клик по заголовку: открыть режим либо закрыть открытый (= выключить анимацию).
 * Смена режима сбрасывает видимость фигур и цвета — ключи состояний у режимов разные
 * (`applyStateMode`), поэтому это одна операция и один шаг истории.
 */
function toggleMode(mode) {
  if (meta.locked) return
  setAnimationMode(openMode.value === mode ? 'off' : mode)
}
// Булев режим — те же две строки «подпись → значение», что у «по значению», но
// read-only: значения фиксированы (true/false), редактировать/удалять нельзя.
const BOOLEAN_STATES = [
  { label: 'Вкл', value: 'true' },
  { label: 'Выкл', value: 'false' },
]
// Пресет-подписи для editable-Select строки состояния (автор может вписать своё).
const PRESET_LABELS = STATE_PRESETS.map((p) => p.label)

// Видимость выделенной фигуры. Булев: Всегда/При вкл/При выкл. По значению:
// Всегда + все объявленные состояния (по подписи, значение — стабильный key).
const STATE_OPTIONS = [
  { label: 'Всегда', value: 'always' },
  { label: 'При вкл', value: 'true' },
  { label: 'При выкл', value: 'false' },
]
const shapeStateOptions = computed(() => {
  if (meta.stateMode !== 'value') return STATE_OPTIONS
  return [
    { label: 'Всегда', value: 'always' },
    ...meta.states.map((s) => ({ label: s.label || s.key, value: s.key })),
  ]
})
// Видимость — тоже на всё выделение; при расхождении селект пуст (placeholder «—»),
// выбор применяется ко всем. Дискретная операция → снимок истории сразу.
// Подпись здесь участвует: `animation-hidden` — это display:none на группе
// состояния, он работает и для <text>. Из перекраски (stateColors) текст
// исключён — см. `:not(text)` в constants/animation.
const hasShapeState = computed(() => meta.stateful && selectedFor().length > 0)
const shapeState = computed({
  get: () => commonValue((s) => s.state || 'always') ?? null,
  set: (v) => {
    if (!v) return
    applyToSelected({ state: v })
    commit()
  },
})

// Категории для комбо (существующие + можно вписать новую). registryVersion —
// чтобы список пересобрался, если реестр поменяется.
const categories = computed(() => {
  void registryVersion.value
  return getCategories()
})

// id = имя папки definitions/<id>/ → маска [a-z0-9_]. Фильтруем прямо в DOM
// (watch/computed не годятся: значение уходит в кириллицу и обратно за тик,
// Vue не перезатирает введённый символ). В правке id заблокирован.
function onIdInput(e) {
  const clean = (e.target.value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (e.target.value !== clean) e.target.value = clean
  meta.id = clean
}

// Свотч цвета состояния: живьём на @input (видно на превью), снимок истории — на
// @change (пипетка закрыта) и на кнопке-сбросе. Как у цвета фигуры.
function clearStateColor(key, which) {
  setStateColor(key, '', which)
  commit()
}
</script>

<template>
  <aside class="h-full flex flex-col bg-surface-50">
    <!-- Плашка «Символ»: свойства документа (идентификация/поведение/анимация) -->
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center">
        <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Символ</h2>
      </div>

      <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm space-y-4">
        <!-- Программный символ (шина): все свойства показаны как есть, но заданы кодом
             (контролы disabled) — в редакторе правятся только зоны диапазонов. -->
        <p v-if="meta.locked" class="text-[11px] text-surface-500 leading-snug">
          Программный символ: тело и порты задаёт код, правятся только диапазоны значений.
        </p>
        <!-- Проблемы черновика подсвечиваются ЖИВЬЁМ (`problemOf`): иначе занятый id
             или пустая категория всплывали только тостом после клика «Сохранить». -->
        <label class="relative block">
          <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Название</div>
          <InputText
            v-model="meta.label"
            :disabled="meta.locked"
            :invalid="!!problemOf('label')"
            size="small"
            class="w-full"
            placeholder="Задвижка"
            @change="commit"
          />
          <!-- Сообщение — в строке заголовка поля и АБСОЛЮТОМ: в потоке оно сдвигало бы
               остальные поля панели при каждом вводе. -->
          <p
            v-if="problemOf('label')"
            v-tooltip.left="problemOf('label')"
            class="pointer-events-auto absolute right-0 top-0 max-w-[70%] truncate text-[11px] text-red-500"
          >
            {{ problemOf('label') }}
          </p>
        </label>

        <label class="relative block">
          <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">id</div>
          <!-- Нативный <input> (не PrimeVue): @input гарантированно нативный, onIdInput
             правит e.target.value напрямую (обходя Vue-диффинг). -->
          <input
            :value="meta.id"
            :disabled="!!editingId"
            placeholder="cell_valve"
            class="p-inputtext p-component p-inputtext-sm w-full font-mono"
            :class="{ 'p-invalid': !!problemOf('id') }"
            @input="onIdInput"
            @change="commit"
          />
          <!-- Сообщение — в строке заголовка поля и АБСОЛЮТОМ: в потоке оно сдвигало бы
               остальные поля панели при каждом вводе. -->
          <p
            v-if="problemOf('id')"
            v-tooltip.left="problemOf('id')"
            class="pointer-events-auto absolute right-0 top-0 max-w-[70%] truncate text-[11px] text-red-500"
          >
            {{ problemOf('id') }}
          </p>
        </label>

        <label class="relative block">
          <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Категория</div>
          <Select
            v-model="meta.category"
            :options="categories"
            :disabled="meta.locked"
            :invalid="!!problemOf('category')"
            editable
            placeholder="Выберите или впишите"
            size="small"
            class="w-full"
            @change="commit"
          />
          <!-- Сообщение — в строке заголовка поля и АБСОЛЮТОМ: в потоке оно сдвигало бы
               остальные поля панели при каждом вводе. -->
          <p
            v-if="problemOf('category')"
            v-tooltip.left="problemOf('category')"
            class="pointer-events-auto absolute right-0 top-0 max-w-[70%] truncate text-[11px] text-red-500"
          >
            {{ problemOf('category') }}
          </p>
        </label>

        <!-- Область применения: фильтр палитры, а не вторая категория — символ может
             годиться сразу нескольким областям. Пусто = виден при любом фильтре. -->
        <div>
          <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">
            Область применения
          </div>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="d in STENCIL_DOMAINS"
              :key="d.key"
              type="button"
              :disabled="meta.locked"
              class="rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :class="[
                meta.locked ? '' : 'cursor-pointer',
                meta.domains.includes(d.key)
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-surface-300 text-surface-500 hover:text-surface-800',
              ]"
              @click="toggleDomain(d.key)"
            >
              {{ d.label }}
            </button>
          </div>
        </div>

        <!-- Флаги поведения — прямо после категории, без отдельной секции. Поворот и
             отражение раздельно: карточке значения, например, поворот нужен (её ставят
             вдоль вертикальных участков), а отражение зеркалило бы надпись. -->
        <label class="flex items-center gap-2" :class="meta.locked ? '' : 'cursor-pointer'">
          <Checkbox
            v-model="meta.noRotate"
            :disabled="meta.locked"
            binary
            input-id="se-norotate"
            @update:model-value="commit"
          />
          <span class="text-surface-700">Запретить поворот</span>
        </label>
        <label class="flex items-center gap-2" :class="meta.locked ? '' : 'cursor-pointer'">
          <Checkbox
            v-model="meta.noFlip"
            :disabled="meta.locked"
            binary
            input-id="se-noflip"
            @update:model-value="commit"
          />
          <span class="text-surface-700">Запретить отражение</span>
        </label>

        <!-- Анимации — карточками, как в инспекторе холста (StateBlock/RangeBlock):
             это две стороны одной настройки, здесь задаётся поведение символа, там у
             экземпляра привязывается тег. Одинаковый вид показывает эту пару. -->
        <div class="space-y-2 border-t border-surface-200 pt-4">
          <div class="text-[11px] uppercase tracking-wider text-surface-500">Анимации</div>

          <!-- Режимы состояния — два сворачиваемых блока: открыт максимум один, оба
               закрыты = анимации нет. Заголовок и есть переключатель. -->
          <div
            v-for="mode in ANIM_MODES"
            :key="mode.value"
            class="rounded border bg-surface-0"
            :class="openMode === mode.value ? 'border-primary-200' : 'border-surface-200'"
          >
            <button
              type="button"
              data-test="anim-mode"
              class="flex w-full items-center gap-2 p-3 text-left"
              :class="meta.locked ? 'cursor-not-allowed' : 'cursor-pointer'"
              :disabled="meta.locked"
              @click="toggleMode(mode.value)"
            >
              <i
                class="pi"
                :class="[mode.icon, openMode === mode.value ? 'text-cyan-500' : 'text-surface-400']"
              />
              <span
                class="flex-1 text-xs font-medium"
                :class="openMode === mode.value ? 'text-surface-700' : 'text-surface-500'"
              >
                {{ mode.label }}
              </span>
              <i
                class="pi text-[10px]! text-surface-400"
                :class="openMode === mode.value ? 'pi-chevron-down' : 'pi-chevron-right'"
              />
            </button>

            <!-- Раскрытие анимируется grid-строкой (см. `.tms-collapse-*` в style.css):
                 содержимое режима остаётся в DOM только пока блок открыт. -->
            <Transition name="tms-collapse">
              <div v-if="openMode === mode.value">
                <div class="px-3 pb-3">
                  <p class="text-[11px] text-surface-500 mb-2 leading-snug">
                    {{
                      mode.value === 'boolean'
                        ? 'Два положения по булеву тегу: какие фигуры видны и каким цветом.'
                        : 'Свои состояния с кодами значений: какие фигуры видны в каждом и каким цветом.'
                    }}
                  </p>

                  <div v-if="mode.value === 'boolean'" class="space-y-1.5 mb-2">
                    <div class="flex items-center gap-1.5 text-[11px] text-surface-500">
                      <span class="w-[30px] shrink-0" aria-hidden="true"></span>
                      <span class="flex-1 min-w-0">Подпись</span>
                      <span class="w-12">Значение</span>
                      <span class="flex w-[30px] shrink-0 justify-center">
                        <i
                          v-tooltip.top="hasFillableShapes ? 'Цвет контуров' : 'Цвет символа'"
                          class="pi pi-circle text-[11px]!"
                        />
                      </span>
                      <span v-if="hasFillableShapes" class="flex w-[30px] shrink-0 justify-center">
                        <i v-tooltip.top="'Цвет заливки'" class="pi pi-circle-fill text-[11px]!" />
                      </span>
                      <!-- Резерв под колонку удаления состояния: в режиме «по значению»
                           там кнопка, и без него колонки двух блоков не совпадали бы. -->
                      <span class="w-6 shrink-0" aria-hidden="true"></span>
                    </div>
                    <div
                      v-for="st in BOOLEAN_STATES"
                      :key="st.value"
                      class="flex items-center gap-1.5"
                    >
                      <!-- Глаз = превью этого состояния на столе (повторный клик — все). -->
                      <button
                        type="button"
                        v-tooltip.top="
                          previewState === st.value
                            ? 'Показать все фигуры'
                            : 'Показать символ в этом состоянии'
                        "
                        class="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded transition-colors"
                        :class="
                          previewState === st.value
                            ? 'bg-primary-50 text-primary-600'
                            : 'text-surface-300 hover:text-surface-600'
                        "
                        @click="togglePreview(st.value)"
                      >
                        <i class="pi pi-eye text-xs!" />
                      </button>
                      <InputText
                        :model-value="st.label"
                        disabled
                        size="small"
                        class="flex-1 min-w-0 text-xs!"
                      />
                      <InputText
                        :model-value="st.value"
                        disabled
                        size="small"
                        class="w-12 font-mono text-xs!"
                      />
                      <!-- Колонка — ровно по свотчу (30px): сброс цвета висит бейджем
                           на его углу (как у вида шины), отдельная кнопка рядом
                           требовала бы места и в строках, где цвет не задан. -->
                      <div class="flex w-[30px] shrink-0 items-center justify-center">
                        <ColorField
                          v-tooltip.top="'Цвет контуров символа в этом состоянии'"
                          :model-value="stateStroke(st.value) || STATE_STROKE_PLACEHOLDER"
                          :class="{ 'opacity-40': !stateStroke(st.value) }"
                          @update:model-value="setStateColor(st.value, $event, 'stroke')"
                          @change="commit"
                        >
                          <template #badge>
                            <button
                              v-if="stateStroke(st.value)"
                              type="button"
                              v-tooltip.top="'Убрать цвет'"
                              class="absolute -right-0.5 -top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
                              @click.stop="clearStateColor(st.value, 'stroke')"
                            >
                              <i class="pi pi-times text-[7px]!" />
                            </button>
                          </template>
                        </ColorField>
                      </div>
                      <div
                        v-if="hasFillableShapes"
                        class="flex w-[30px] shrink-0 items-center justify-center"
                      >
                        <ColorField
                          v-tooltip.top="'Цвет заливки фигур в этом состоянии'"
                          :model-value="stateFill(st.value) || STATE_FILL_PLACEHOLDER"
                          :class="{ 'opacity-40': !stateFill(st.value) }"
                          @update:model-value="setStateColor(st.value, $event, 'fill')"
                          @change="commit"
                        >
                          <template #badge>
                            <button
                              v-if="stateFill(st.value)"
                              type="button"
                              v-tooltip.top="'Убрать заливку'"
                              class="absolute -right-0.5 -top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
                              @click.stop="clearStateColor(st.value, 'fill')"
                            >
                              <i class="pi pi-times text-[7px]!" />
                            </button>
                          </template>
                        </ColorField>
                      </div>
                      <!-- Булевы состояния не удаляются (их ровно два) — место колонки
                           держим пустым, чтобы строки обоих блоков стояли одинаково. -->
                      <span class="w-6 shrink-0" aria-hidden="true"></span>
                    </div>
                  </div>

                  <div v-else class="space-y-1.5 mb-2">
                    <div class="flex items-center gap-1.5 text-[11px] text-surface-500">
                      <span class="w-[30px] shrink-0" aria-hidden="true"></span>
                      <span class="flex-1 min-w-0">Подпись</span>
                      <span class="w-12">Значение</span>
                      <span class="flex w-[30px] shrink-0 justify-center">
                        <i
                          v-tooltip.top="hasFillableShapes ? 'Цвет контуров' : 'Цвет символа'"
                          class="pi pi-circle text-[11px]!"
                        />
                      </span>
                      <span v-if="hasFillableShapes" class="flex w-[30px] shrink-0 justify-center">
                        <i v-tooltip.top="'Цвет заливки'" class="pi pi-circle-fill text-[11px]!" />
                      </span>
                      <!-- Колонка кнопки удаления состояния. -->
                      <span class="w-6 shrink-0" aria-hidden="true"></span>
                    </div>
                    <div v-for="st in meta.states" :key="st.key" class="flex items-center gap-1.5">
                      <!-- Глаз = превью этого состояния на столе (повторный клик — все). -->
                      <button
                        type="button"
                        v-tooltip.top="
                          previewState === st.key
                            ? 'Показать все фигуры'
                            : 'Показать символ в этом состоянии'
                        "
                        class="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded transition-colors"
                        :class="
                          previewState === st.key
                            ? 'bg-primary-50 text-primary-600'
                            : 'text-surface-300 hover:text-surface-600'
                        "
                        @click="togglePreview(st.key)"
                      >
                        <i class="pi pi-eye text-xs!" />
                      </button>
                      <Select
                        :model-value="st.label"
                        :options="PRESET_LABELS"
                        editable
                        placeholder="состояние"
                        size="small"
                        class="flex-1 min-w-0"
                        @update:model-value="updateState(st.key, { label: $event })"
                        @change="commit"
                      />
                      <InputText
                        :model-value="st.code"
                        placeholder="код"
                        size="small"
                        class="w-12 font-mono text-xs!"
                        @update:model-value="updateState(st.key, { code: $event })"
                        @change="commit"
                      />
                      <div class="flex w-[30px] shrink-0 items-center justify-center">
                        <ColorField
                          v-tooltip.top="'Цвет контуров символа в этом состоянии'"
                          :model-value="stateStroke(st.key) || STATE_STROKE_PLACEHOLDER"
                          :class="{ 'opacity-40': !stateStroke(st.key) }"
                          @update:model-value="setStateColor(st.key, $event, 'stroke')"
                          @change="commit"
                        >
                          <template #badge>
                            <button
                              v-if="stateStroke(st.key)"
                              type="button"
                              v-tooltip.top="'Убрать цвет'"
                              class="absolute -right-0.5 -top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
                              @click.stop="clearStateColor(st.key, 'stroke')"
                            >
                              <i class="pi pi-times text-[7px]!" />
                            </button>
                          </template>
                        </ColorField>
                      </div>
                      <div
                        v-if="hasFillableShapes"
                        class="flex w-[30px] shrink-0 items-center justify-center"
                      >
                        <ColorField
                          v-tooltip.top="'Цвет заливки фигур в этом состоянии'"
                          :model-value="stateFill(st.key) || STATE_FILL_PLACEHOLDER"
                          :class="{ 'opacity-40': !stateFill(st.key) }"
                          @update:model-value="setStateColor(st.key, $event, 'fill')"
                          @change="commit"
                        >
                          <template #badge>
                            <button
                              v-if="stateFill(st.key)"
                              type="button"
                              v-tooltip.top="'Убрать заливку'"
                              class="absolute -right-0.5 -top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
                              @click.stop="clearStateColor(st.key, 'fill')"
                            >
                              <i class="pi pi-times text-[7px]!" />
                            </button>
                          </template>
                        </ColorField>
                      </div>
                      <Button
                        v-tooltip.bottom="'Убрать состояние'"
                        icon="pi pi-times"
                        severity="secondary"
                        text
                        size="small"
                        class="p-1! w-6! h-6!"
                        @click="removeState(st.key)"
                      />
                    </div>
                    <div class="flex gap-1.5">
                      <button
                        type="button"
                        class="flex flex-1 items-center justify-center gap-1.5 px-2 py-1 rounded border border-dashed border-surface-300 text-xs text-surface-500 transition-colors hover:border-primary-400 hover:text-surface-700 cursor-pointer"
                        @click="addState"
                      >
                        <i class="pi pi-plus text-[10px]!" />
                        состояние
                      </button>
                      <button
                        type="button"
                        v-tooltip.bottom="
                          '4 состояния: Включен / Отключен / Промежуточное / Недостоверно'
                        "
                        class="flex flex-1 items-center justify-center gap-1.5 px-2 py-1 rounded border border-dashed border-surface-300 text-xs text-surface-500 transition-colors hover:border-primary-400 hover:text-surface-700 cursor-pointer"
                        @click="applyPositionPreset"
                      >
                        <i class="pi pi-bolt text-[10px]!" />
                        Сигнал положения
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Зоны диапазонов — НЕЗАВИСИМО от анимации состояния (символ показывает
               положение по своему тегу и красится по числу другого), поэтому карточка вне
               `stateful`-ветки. У программного символа это единственное, что правится. -->
          <div class="border border-surface-200 rounded p-3 bg-surface-0">
            <div class="flex items-center gap-2 mb-2 min-h-6">
              <i class="pi pi-chart-bar text-yellow-500" />
              <div class="text-xs font-medium text-surface-700">Диапазоны значений</div>
            </div>
            <p class="text-[11px] text-surface-500 mb-2 leading-snug">
              Цвет символа по числу тега. Границы включаются в диапазон: одинаковые («3 — 3») задают
              точное значение.
            </p>
            <RangeRows
              :ranges="meta.ranges"
              @update-range="updateRange"
              @add-range="addRange"
              @remove-range="removeRange"
            />
          </div>

          <!-- Quality — свойство символа, а не отдельной анимации: серость и «показать
               все положения» при bad-качестве драйвящего тега работают в любом режиме,
               поэтому галка стоит ПОСЛЕ всех блоков. Без анимации состояния цепляться
               не за что (нужен её тег). -->
          <label
            v-if="meta.stateful"
            class="flex items-center gap-2 px-1 pt-1"
            :class="meta.locked ? '' : 'cursor-pointer'"
          >
            <Checkbox
              v-model="meta.quality"
              :disabled="meta.locked"
              binary
              input-id="se-quality"
              @update:model-value="commit"
            />
            <span class="text-surface-700">Учитывать качество сигнала (Quality)</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Плашка «Фигура»: свойства выделенного (контекстно, на всё выделение).
         Видимость (в каком состоянии видна фигура) живёт здесь — это свойство
         элемента. Контролы показаны, если свойство применимо хоть к одной
         выделенной фигуре, и правят только применимые. -->
    <div class="flex min-h-0 max-h-[50%] shrink-0 flex-col border-t border-surface-200">
      <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center gap-2">
        <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Фигура</h2>
        <span v-if="multiCount > 1" class="text-xs text-surface-500">
          выделено: {{ multiCount }}
        </span>
      </div>
      <div class="p-4 overflow-y-auto text-sm">
        <div v-if="multiCount" class="space-y-2.5">
          <!-- Подпись: содержимое + размер + жирность. Обводки, заливки, скругления
               и видимости по состоянию у неё нет — текст всегда статичен. -->
          <template v-if="isTextShape">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Текст</div>
              <!-- Пустая подпись остаётся фигурой и рисуется иконкой (её текст
                   приходит с холста, если она помечена правимой); убрать её — Del,
                   как любую другую. Enter добавляет строку. -->
              <Textarea
                :model-value="textValue"
                rows="3"
                size="small"
                class="w-full"
                placeholder="Текст подписи"
                @update:model-value="setText"
                @blur="commitText"
              />
            </div>
            <label class="flex items-center justify-between">
              <span class="text-[11px] uppercase tracking-wider text-surface-500">Размер, pt</span>
              <InputNumber
                :model-value="textSize"
                :min="4"
                :max="72"
                :step="1"
                show-buttons
                button-layout="horizontal"
                size="small"
                input-class="w-12! text-center"
                @update:model-value="setTextSize"
                @blur="commit"
              />
            </label>
            <!-- Выравнивание = якорь роста: точка привязки стоит на месте, текст
                 растёт от неё (те же варианты, что у подписи на холсте). -->
            <label class="flex items-center justify-between">
              <span class="text-[11px] uppercase tracking-wider text-surface-500">
                Выравнивание
              </span>
              <SelectButton
                :model-value="textAlign"
                :options="ALIGN_OPTIONS"
                option-value="value"
                data-key="value"
                :allow-empty="false"
                size="small"
                @update:model-value="setTextAlign"
              >
                <template #option="{ option }">
                  <i :class="option.icon" v-tooltip.top="option.tip" />
                </template>
              </SelectButton>
            </label>
            <label class="flex items-center justify-between">
              <span class="text-[11px] uppercase tracking-wider text-surface-500">Шрифт</span>
              <!-- Пункты рисуются своим же семейством — выбор виден до применения. -->
              <Select
                :model-value="textFont"
                :options="FONT_FAMILIES"
                option-label="label"
                option-value="value"
                size="small"
                class="w-40"
                @update:model-value="setTextFont"
              >
                <template #option="{ option }">
                  <span :style="{ fontFamily: option.value }">{{ option.label }}</span>
                </template>
              </Select>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <Checkbox
                :model-value="!!selectedShape.bold"
                binary
                input-id="se-text-bold"
                @update:model-value="setTextBold"
              />
              <span class="text-surface-700">Жирный</span>
            </label>
            <!-- Текст из тега: содержимое подписи в рантайме заменяет значение
                 сигнала. Сам текст в символе остаётся заглушкой (её видно в
                 редакторе, на холсте и в схеме до прихода данных). -->
            <label class="flex items-center gap-2 cursor-pointer">
              <Checkbox
                :model-value="!!selectedShape.valueText"
                binary
                input-id="se-text-value"
                @update:model-value="setValueText"
              />
              <span class="text-surface-700">Показывает значение тега</span>
            </label>
            <p v-if="valueTextConflict" class="text-[11px] text-amber-600">
              Значение тега может показывать только одна подпись — снимите флаг с остальных.
            </p>
            <!-- Параметр: текст правится у каждого экземпляра на холсте, а здешний
                 остаётся значением по умолчанию и подписью поля в инспекторе. У
                 подписи со значением тега его нет: содержимое приходит из рантайма,
                 и правка на холсте всё равно была бы затёрта. -->
            <label v-if="!selectedShape.valueText" class="flex items-center gap-2 cursor-pointer">
              <Checkbox
                :model-value="!!selectedShape.param"
                binary
                input-id="se-text-param"
                @update:model-value="setParam"
              />
              <span class="text-surface-700">Правится на холсте</span>
            </label>
          </template>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-[11px] uppercase tracking-wider text-surface-500">
              {{ isTextShape ? 'Цвет' : 'Цвет линии' }}
              <span v-if="strokeMixed" class="text-xs text-surface-400">разные</span>
            </span>
            <ColorField
              :model-value="strokeColor"
              @update:model-value="setStroke"
              @change="commit"
            />
          </label>
          <label v-if="hasStrokeWidth" class="flex items-center justify-between">
            <span class="text-[11px] uppercase tracking-wider text-surface-500">Толщина, px</span>
            <InputNumber
              :model-value="strokeWidth"
              :min="0.5"
              :max="20"
              :step="0.5"
              :max-fraction-digits="1"
              show-buttons
              button-layout="horizontal"
              size="small"
              input-class="w-12! text-center"
              placeholder="—"
              @update:model-value="setStrokeWidth"
              @blur="commit"
            />
          </label>
          <!-- Свотч заливки — справа на строке чекбокса (появляется при включении),
               чтобы тумблер не добавлял новую строку и layout не прыгал. -->
          <div v-if="hasFill" class="flex min-h-7 items-center justify-between">
            <label class="flex items-center gap-2 cursor-pointer">
              <!-- indeterminate — заливка есть у части выделенных: галка не врёт,
                   что её нет, а первый клик включает всем. -->
              <Checkbox
                :model-value="fillEnabled"
                :indeterminate="fillMixed"
                binary
                input-id="se-fill"
                @update:model-value="toggleFill"
              />
              <span class="text-surface-700">Заливка</span>
            </label>
            <ColorField
              v-if="fillEnabled"
              :model-value="fillColor"
              @update:model-value="setFill"
              @change="commit"
            />
          </div>
          <label v-if="hasRounding" class="flex items-center gap-2 cursor-pointer">
            <Checkbox
              :model-value="roundedEnabled"
              :indeterminate="roundedMixed"
              binary
              input-id="se-rounded"
              @update:model-value="toggleRounded"
            />
            <span class="text-surface-700">Скругление</span>
          </label>
          <!-- Видимость (в каком состоянии видна фигура) — только при включённой
               анимации состояния; опции зависят от режима (см. shapeStateOptions). -->
          <div v-if="hasShapeState" class="pt-1">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Видимость</div>
            <Select
              v-model="shapeState"
              :options="shapeStateOptions"
              option-label="label"
              option-value="value"
              size="small"
              class="w-full"
              placeholder="—"
            />
          </div>
          <!-- Геометрия и текст правятся по одной фигуре: у пачки нет общего
               «размера», а массовая замена текста снесла бы разные подписи. -->
          <p v-if="multiCount > 1" class="pt-1 text-xs text-surface-400">
            Размер и текст — при выделении одной фигуры.
          </p>
        </div>
        <p v-else class="text-xs text-surface-400">Выделите фигуру на холсте</p>
      </div>
    </div>
  </aside>
</template>
