<script setup>
/**
 * Плашка «Фигура» в свойствах символа: свойства выделенного, на всё выделение сразу.
 * Видимость (в каком состоянии видна фигура) живёт здесь — это свойство элемента.
 * Контролы показаны, если свойство применимо хоть к одной выделенной фигуре, и правят
 * только применимые; геометрия и подпись — только при одной выделенной.
 */
import { computed, ref, watch } from 'vue'
import Textarea from 'primevue/textarea'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import SelectButton from 'primevue/selectbutton'
import Message from 'primevue/message'
import ColorField from './ColorField.vue'
import { useStencilEditor } from '../composables/useStencilEditor'
import { ALIGN_OPTIONS, FONT_FAMILIES, TEXT_SHAPE_SIZE, normalizeFont } from '../constants/text'

const {
  meta,
  presetInfo,
  shapes,
  selectedId,
  selectedIds,
  updateShape,
  selectedFor,
  commonValue,
  applyToSelected,
  commit,
} = useStencilEditor()

// У символа из набора рисунок задаёт набор: правится только видимость по состоянию.
const isPresetSymbol = computed(() => !!presetInfo.value)

const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null)
const multiCount = computed(() => selectedIds.value.length)

// Применимость по типу примитива: у линии нет заливки, у круга — скругления, у подписи
// ни того ни другого (видимость по состоянию есть). Цвет есть у всех — у подписи это
// цвет глифов в поле `stroke`.
const FILLABLE = (s) => s.type !== 'line' && s.type !== 'text'
const ROUNDABLE = (s) => s.type !== 'circle' && s.type !== 'text'
const NOT_TEXT = (s) => s.type !== 'text'

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
</script>

<template>
  <div class="flex min-h-0 max-h-[50%] shrink-0 flex-col border-t border-surface-200">
    <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center gap-2">
      <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Фигура</h2>
      <span v-if="multiCount > 1" class="text-xs text-surface-500">выделено: {{ multiCount }}</span>
    </div>
    <div class="p-4 overflow-y-auto text-sm">
      <div v-if="multiCount" class="space-y-2.5">
        <p v-if="isPresetSymbol" class="tms-hint">
          Вид фигуры задаёт набор — здесь правится только её видимость по состоянию.
        </p>
        <!-- Подпись: содержимое + размер + жирность. Обводки, заливки, скругления
             и видимости по состоянию у неё нет — текст всегда статичен. -->
        <template v-if="isTextShape && !isPresetSymbol">
          <div>
            <div class="tms-field-label mb-1">Текст</div>
            <!-- Пустая подпись остаётся фигурой и рисуется иконкой (её текст
                 приходит с холста, если она помечена правимой); убрать её — Del,
                 как любую другую. Enter добавляет строку. -->
            <Textarea
              :model-value="textValue"
              rows="2"
              auto-resize
              size="small"
              class="w-full"
              placeholder="Текст подписи"
              @update:model-value="setText"
              @blur="commitText"
            />
          </div>
          <label class="flex items-center justify-between">
            <span class="tms-field-label">Размер, pt</span>
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
            <span class="tms-field-label">Выравнивание</span>
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
            <span class="tms-field-label">Шрифт</span>
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
          <Message v-if="valueTextConflict" severity="warn" variant="simple" size="small">
            Значение тега может показывать только одна подпись — сними флаг с остальных.
          </Message>
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
        <!-- Вид фигуры (цвет, толщина, заливка, скругление) — у символа из набора его
             задаёт поставка, остаётся только видимость по состоянию ниже. -->
        <template v-if="!isPresetSymbol">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="tms-field-label">
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
            <span class="tms-field-label">Толщина, px</span>
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
        </template>
        <!-- Видимость (в каком состоянии видна фигура) — только при включённой
             анимации состояния; опции зависят от режима (см. shapeStateOptions). -->
        <div v-if="hasShapeState" class="pt-1">
          <div class="tms-field-label mb-1">Видимость</div>
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
      <!-- Без иконки и отступов `tms-empty`: плашка «Фигура» занимает нижнюю
           половину панели, развёрнутое пустое состояние съело бы её целиком. -->
      <p v-else class="tms-hint">Выдели фигуру на холсте</p>
    </div>
  </div>
</template>
