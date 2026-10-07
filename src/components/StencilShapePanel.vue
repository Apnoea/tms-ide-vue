<script setup>
/**
 * Свойства выделенных фигур — инспектор редактора показывает их вместо свойств символа,
 * пока есть выделение (как инспектор холста). Правка идёт на всё выделение сразу:
 * контролы показаны, если свойство применимо хоть к одной выделенной фигуре, и правят
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
import AnimationCard from './AnimationCard.vue'
import { useStencilEditor } from '../composables/useStencilEditor'
import { ALIGN_OPTIONS, FONT_FAMILIES, TEXT_SHAPE_SIZE, normalizeFont } from '../constants/text'
import { joinStateKeys, shapeStateKeys } from '../utils/stencilSvg'
import { STEPPER_PROPS } from '../constants/icons'

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

// У символа из набора рисунок задаёт набор: правится только привязка к состоянию.
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

/**
 * Привязка к состоянию — где видна выделенная фигура: «Всегда» (статика символа) либо
 * состояния — в булевом режиме одно из Вкл/Выкл, «по значению» — ЛЮБОЙ набор заданных
 * автором (`on+mid`, см. joinStateKeys): одна фигура может быть общей для нескольких
 * положений.
 *
 * Подпись здесь участвует: `animation-hidden` — это display:none на группе состояния,
 * он работает и для <text>. Из перекраски (stateColors) текст исключён — см.
 * `:not(text)` в constants/animation.
 */
const BOOLEAN_STATES = [
  { key: 'true', label: 'Вкл', code: 'true' },
  { key: 'false', label: 'Выкл', code: 'false' },
]
const multiState = computed(() => meta.stateMode === 'value')
const declaredStates = computed(() => (multiState.value ? meta.states : BOOLEAN_STATES))
const stateBindings = computed(() => [
  { value: 'always', label: 'Всегда', code: null },
  ...declaredStates.value.map((s) => ({
    value: s.key,
    label: s.label || s.key,
    code: s.code !== '' && s.code != null ? s.code : null,
  })),
])
const hasShapeState = computed(() => meta.stateful && selectedFor().length > 0)
// Общее у выделенных; null — у фигур пачки привязки разные, ни одна строка не отмечена.
const shapeState = computed(() => commonValue((s) => s.state || 'always') ?? null)
const boundKeys = computed(() => new Set(shapeStateKeys(shapeState.value)))

function isBound(value) {
  return value === 'always' ? shapeState.value === 'always' : boundKeys.value.has(value)
}

// Привязка — на всё выделение; дискретная операция → снимок истории сразу. «По
// значению» состояние переключается в наборе (снял последнее — фигура снова «всегда»),
// в булевом режиме и у «Всегда» выбор единственный.
function bindToState(value) {
  let state = value
  if (value !== 'always' && multiState.value) {
    const keys = new Set(boundKeys.value)
    if (keys.has(value)) keys.delete(value)
    else keys.add(value)
    state = joinStateKeys(
      [...keys],
      declaredStates.value.map((s) => s.key)
    )
  }
  applyToSelected({ state })
  commit()
}
</script>

<template>
  <div class="space-y-2.5">
    <p v-if="isPresetSymbol" class="tms-hint">
      Вид фигуры задаёт набор — здесь правится только её привязка к состоянию.
    </p>
    <!-- Подпись: содержимое + размер + жирность. Обводки, заливки и скругления у неё
         нет. -->
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
        <span class="tms-field-label">
          Размер,
          <span class="normal-case">pt</span>
        </span>
        <InputNumber
          :model-value="textSize"
          :min="4"
          :max="72"
          :step="1"
          v-bind="STEPPER_PROPS"
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
         задаёт поставка, остаётся только привязка к состоянию ниже. -->
    <template v-if="!isPresetSymbol">
      <label class="flex items-center justify-between cursor-pointer">
        <span class="tms-field-label">
          {{ isTextShape ? 'Цвет' : 'Цвет линии' }}
          <span v-if="strokeMixed" class="text-xs text-surface-400">разные</span>
        </span>
        <ColorField :model-value="strokeColor" @update:model-value="setStroke" @change="commit" />
      </label>
      <label v-if="hasStrokeWidth" class="flex items-center justify-between">
        <span class="tms-field-label">
          Толщина,
          <span class="normal-case">px</span>
        </span>
        <InputNumber
          :model-value="strokeWidth"
          :min="0.5"
          :max="20"
          :step="0.5"
          :max-fraction-digits="1"
          v-bind="STEPPER_PROPS"
          size="small"
          input-class="w-12! text-center"
          placeholder="—"
          @update:model-value="setStrokeWidth"
          @blur="commit"
        />
      </label>
      <!-- Свотч заливки — справа на строке чекбокса (появляется при включении),
           чтобы тумблер не добавлял новую строку. Высота строки — по свотчу (30px):
           ниже неё строка росла бы при включении, и панель прыгала. -->
      <div v-if="hasFill" class="flex min-h-[30px] items-center justify-between">
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
    <!-- Привязка к состоянию — карточкой под «Анимации», как в свойствах символа: та же
         настройка со стороны фигуры. Только при включённой анимации состояния. -->
    <div v-if="hasShapeState" class="space-y-2 border-t border-surface-200 pt-4">
      <div class="tms-field-label">Анимации</div>
      <AnimationCard
        icon="pi pi-eye text-cyan-500"
        title="Привязка"
        hint="к состоянию"
        data-test="state-binding"
      >
        <template v-if="shapeState === null" #actions>
          <span class="tms-hint">у выделенных разная</span>
        </template>
        <p class="tms-hint mb-2">
          {{
            multiState
              ? 'Где видна фигура: всегда или в отмеченных состояниях.'
              : 'Где видна фигура: всегда или только в одном состоянии.'
          }}
        </p>
        <div class="space-y-1">
          <button
            v-for="opt in stateBindings"
            :key="opt.value"
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors"
            :class="
              isBound(opt.value)
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-surface-200 text-surface-700 hover:bg-surface-50'
            "
            @click="bindToState(opt.value)"
          >
            <i
              class="pi text-[11px]!"
              :class="
                multiState && opt.value !== 'always'
                  ? isBound(opt.value)
                    ? 'pi-check-square'
                    : 'pi-stop'
                  : isBound(opt.value)
                    ? 'pi-check-circle'
                    : 'pi-circle'
              "
            />
            <span class="min-w-0 flex-1 truncate">{{ opt.label }}</span>
            <code v-if="opt.code" class="font-mono text-[11px] text-surface-400">
              {{ opt.code }}
            </code>
          </button>
        </div>
      </AnimationCard>
    </div>
    <!-- Геометрия и текст правятся по одной фигуре: у пачки нет общего
         «размера», а массовая замена текста снесла бы разные подписи. -->
    <p v-if="multiCount > 1" class="pt-1 text-xs text-surface-400">
      Размер и текст — при выделении одной фигуры.
    </p>
  </div>
</template>
