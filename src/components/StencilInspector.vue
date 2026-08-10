<script setup>
/**
 * Свойства стенсила — контент правой панели в режиме редактора. Секции:
 * идентификация (название/id/категория), поведение (флаги),
 * анимация состояния (свитч Выкл/Булево/По значению + список состояний) и
 * фигура (свойства выделенного элемента + его видимость по состоянию).
 * Стейт — синглтон useStencilEditor (тот же инстанс, что рисуется в центре).
 */
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import SelectButton from 'primevue/selectbutton'
import Button from 'primevue/button'
import { getCategories, registryVersion } from '../stencils/registry'
import { useStencilEditor, STATE_PRESETS } from '../composables/useStencilEditor'
import { normalizeStateColor } from '../constants/animation'
import { isFillableShape, TEXT_SHAPE_SIZE } from '../utils/stencilSvg'
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
} = useStencilEditor()

// Свойства фигуры правятся сразу по ВСЕМУ выделению (рамкой выделяют именно чтобы
// задать общий цвет/толщину); поля геометрии и подписи — только когда выделена
// одна (selectedShape). Расхождение значений показываем, а не прячем: см. *Mixed.
const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null)
const multiCount = computed(() => selectedIds.value.length)

// Применимость по типу примитива: у линии нет заливки, у круга — скругления, у
// подписи ни того ни другого (но видимость по состоянию у неё есть). Цвет есть у
// всех — у подписи это цвет глифов (поле `stroke`, см. ShapePrimitive).
const FILLABLE = (s) => s.type !== 'line' && s.type !== 'text'
const ROUNDABLE = (s) => s.type !== 'circle' && s.type !== 'text'
const NOT_TEXT = (s) => s.type !== 'text'

// Контрол показываем, если свойство применимо хоть к одной выделенной фигуре.
const hasFill = computed(() => selectedFor(FILLABLE).length > 0)
const hasStrokeWidth = computed(() => selectedFor(NOT_TEXT).length > 0)

// Подпись правится содержимым/размером/жирностью/шрифтом; обводки, заливки и
// скругления у неё нет, а видимость по состоянию — есть (прячется через
// animation-hidden наравне с остальными фигурами).
const isTextShape = computed(() => selectedShape.value?.type === 'text')
const textSize = computed(() => selectedShape.value?.fontSize ?? TEXT_SHAPE_SIZE)
function setText(v) {
  if (selectedShape.value) updateShape(selectedShape.value.id, { text: v ?? '' })
}
function setTextSize(v) {
  if (selectedShape.value && v != null) updateShape(selectedShape.value.id, { fontSize: v })
}
function setTextBold(on) {
  if (!selectedShape.value) return
  updateShape(selectedShape.value.id, { bold: !!on })
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

// Заливку по состоянию (state-color) показываем, только когда в стенсиле есть
// заливаемые фигуры (замкнутые примитивы) — иначе цвет заливки некуда применить.
const hasFillableShapes = computed(() => shapes.value.some(isFillableShape))
// Контур/заливка для ключа состояния из stateColors (строка или { stroke, fill }).
const stateStroke = (key) => normalizeStateColor(meta.stateColors[key]).stroke
const stateFill = (key) => normalizeStateColor(meta.stateColors[key]).fill

// <input type="color"> требует 6-значный #rrggbb: разворачиваем #rgb, «none»/
// пусто → запасной цвет (сам факт заливки регулируется отдельной галкой).
function normHex(c, fallback) {
  if (!c || c === 'none') return fallback
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + [...c.slice(1)].map((ch) => ch + ch).join('')
  }
  return c
}
// «Разные» = значение у выделенных фигур расходится (commonValue → undefined).
// У <input type="color"> пустого состояния нет, поэтому там показываем дефолт и
// подписываем расхождение словом; у числа/селекта — пустое поле с «—».
const mixed = (v, filter) => v === undefined && selectedFor(filter).length > 1

const strokeCommon = computed(() => commonValue((s) => s.stroke))
const strokeColor = computed(() => normHex(strokeCommon.value, '#000000'))
const strokeMixed = computed(() => mixed(strokeCommon.value))

const fillCommon = computed(() => commonValue((s) => s.fill, FILLABLE))
const fillState = computed(() => commonValue((s) => !!s.fill && s.fill !== 'none', FILLABLE))
const fillEnabled = computed(() => fillState.value === true)
const fillMixed = computed(() => mixed(fillState.value, FILLABLE))
const fillColor = computed(() => normHex(fillCommon.value, '#ffffff'))

// Живое обновление на @input (видно на холсте сразу), один снимок истории на
// @change (закрытие пипетки) — как жесты рисования.
function setStroke(e) {
  applyToSelected({ stroke: e.target.value })
}
const strokeWidthCommon = computed(() => commonValue((s) => s.strokeWidth ?? 2, NOT_TEXT))
const strokeWidth = computed(() => strokeWidthCommon.value ?? null)
function setStrokeWidth(v) {
  if (v != null) applyToSelected({ strokeWidth: v }, NOT_TEXT)
}
function setFill(e) {
  applyToSelected({ fill: e.target.value }, FILLABLE)
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
const ANIM_MODE_OPTIONS = [
  { label: 'Выкл', value: 'off' },
  { label: 'Булево', value: 'boolean' },
  { label: 'По значению', value: 'value' },
]
const animMode = computed({
  get: () => (meta.stateful ? meta.stateMode : 'off'),
  set: (v) => setAnimationMode(v),
})
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
// по-прежнему исключён — см. `:not(text)` в constants/animation.
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
    <!-- Плашка «Стенсил»: свойства документа (идентификация/поведение/анимация) -->
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center">
        <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Символ</h2>
      </div>

      <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm space-y-4">
        <label class="block">
          <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Название</div>
          <InputText
            v-model="meta.label"
            size="small"
            class="w-full"
            placeholder="Задвижка"
            @change="commit"
          />
        </label>

        <label class="block">
          <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">id</div>
          <!-- Нативный <input> (не PrimeVue): @input гарантированно нативный, onIdInput
             правит e.target.value напрямую (обходя Vue-диффинг). -->
          <input
            :value="meta.id"
            :disabled="!!editingId"
            placeholder="cell_valve"
            class="p-inputtext p-component p-inputtext-sm w-full font-mono"
            @input="onIdInput"
            @change="commit"
          />
        </label>

        <label class="block">
          <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Категория</div>
          <Select
            v-model="meta.category"
            :options="categories"
            editable
            placeholder="Выберите или впишите"
            size="small"
            class="w-full"
            @change="commit"
          />
        </label>

        <!-- Единственный флаг поведения — прямо после категории, без отдельной секции. -->
        <label class="flex items-center gap-2 cursor-pointer">
          <Checkbox
            v-model="meta.noRotate"
            binary
            input-id="se-norotate"
            @update:model-value="commit"
          />
          <span class="text-surface-700">Запретить поворот</span>
        </label>

        <div class="border-t border-surface-200 pt-4">
          <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-2">
            Анимация состояния
          </div>
          <SelectButton
            v-model="animMode"
            :options="ANIM_MODE_OPTIONS"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            size="small"
            class="mb-2"
          />

          <template v-if="meta.stateful">
            <div v-if="meta.stateMode === 'boolean'" class="space-y-1.5 mb-2">
              <div class="flex items-center gap-1.5 text-[11px] text-surface-500">
                <span class="flex-1 min-w-0">Подпись</span>
                <span class="w-16">Значение</span>
                <span class="w-14 shrink-0 text-center">
                  {{ hasFillableShapes ? 'Контур' : 'Цвет' }}
                </span>
                <span v-if="hasFillableShapes" class="w-14 shrink-0 text-center">Заливка</span>
              </div>
              <div v-for="st in BOOLEAN_STATES" :key="st.value" class="flex items-center gap-1.5">
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
                  class="w-16 font-mono text-xs!"
                />
                <div class="flex w-14 shrink-0 items-center justify-center gap-0.5">
                  <input
                    type="color"
                    v-tooltip.top="'Цвет контуров символа в этом состоянии'"
                    :value="stateStroke(st.value) || '#64748b'"
                    :class="{ 'opacity-40': !stateStroke(st.value) }"
                    class="h-6 w-7 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                    @input="setStateColor(st.value, $event.target.value, 'stroke')"
                    @change="commit"
                  />
                  <button
                    v-if="stateStroke(st.value)"
                    type="button"
                    v-tooltip.top="'Убрать цвет'"
                    class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-surface-400 hover:text-surface-700"
                    @click="clearStateColor(st.value, 'stroke')"
                  >
                    <i class="pi pi-times text-[9px]!" />
                  </button>
                  <span v-else class="w-4 shrink-0" aria-hidden="true"></span>
                </div>
                <div
                  v-if="hasFillableShapes"
                  class="flex w-14 shrink-0 items-center justify-center gap-0.5"
                >
                  <input
                    type="color"
                    v-tooltip.top="'Цвет заливки фигур в этом состоянии'"
                    :value="stateFill(st.value) || '#ffffff'"
                    :class="{ 'opacity-40': !stateFill(st.value) }"
                    class="h-6 w-7 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                    @input="setStateColor(st.value, $event.target.value, 'fill')"
                    @change="commit"
                  />
                  <button
                    v-if="stateFill(st.value)"
                    type="button"
                    v-tooltip.top="'Убрать заливку'"
                    class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-surface-400 hover:text-surface-700"
                    @click="clearStateColor(st.value, 'fill')"
                  >
                    <i class="pi pi-times text-[9px]!" />
                  </button>
                  <span v-else class="w-4 shrink-0" aria-hidden="true"></span>
                </div>
              </div>
            </div>

            <div v-if="meta.stateMode === 'value'" class="space-y-1.5 mb-2">
              <div class="flex items-center gap-1.5 text-[11px] text-surface-500">
                <span class="flex-1 min-w-0">Подпись</span>
                <span class="w-16">Значение</span>
                <span class="w-14 shrink-0 text-center">
                  {{ hasFillableShapes ? 'Контур' : 'Цвет' }}
                </span>
                <span v-if="hasFillableShapes" class="w-14 shrink-0 text-center">Заливка</span>
                <span class="w-6 shrink-0" aria-hidden="true"></span>
              </div>
              <div v-for="st in meta.states" :key="st.key" class="flex items-center gap-1.5">
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
                  class="w-16 font-mono text-xs!"
                  @update:model-value="updateState(st.key, { code: $event })"
                  @change="commit"
                />
                <div class="flex w-14 shrink-0 items-center justify-center gap-0.5">
                  <input
                    type="color"
                    v-tooltip.top="'Цвет контуров символа в этом состоянии'"
                    :value="stateStroke(st.key) || '#64748b'"
                    :class="{ 'opacity-40': !stateStroke(st.key) }"
                    class="h-6 w-7 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                    @input="setStateColor(st.key, $event.target.value, 'stroke')"
                    @change="commit"
                  />
                  <button
                    v-if="stateStroke(st.key)"
                    type="button"
                    v-tooltip.top="'Убрать цвет'"
                    class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-surface-400 hover:text-surface-700"
                    @click="clearStateColor(st.key, 'stroke')"
                  >
                    <i class="pi pi-times text-[9px]!" />
                  </button>
                  <span v-else class="w-4 shrink-0" aria-hidden="true"></span>
                </div>
                <div
                  v-if="hasFillableShapes"
                  class="flex w-14 shrink-0 items-center justify-center gap-0.5"
                >
                  <input
                    type="color"
                    v-tooltip.top="'Цвет заливки фигур в этом состоянии'"
                    :value="stateFill(st.key) || '#ffffff'"
                    :class="{ 'opacity-40': !stateFill(st.key) }"
                    class="h-6 w-7 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                    @input="setStateColor(st.key, $event.target.value, 'fill')"
                    @change="commit"
                  />
                  <button
                    v-if="stateFill(st.key)"
                    type="button"
                    v-tooltip.top="'Убрать заливку'"
                    class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-surface-400 hover:text-surface-700"
                    @click="clearStateColor(st.key, 'fill')"
                  >
                    <i class="pi pi-times text-[9px]!" />
                  </button>
                  <span v-else class="w-4 shrink-0" aria-hidden="true"></span>
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

            <!-- Quality: серость + «показать все положения» при bad-качестве
                 драйвящего тега. Осмыслен только при анимации (нужен тег). -->
            <label class="mt-2 flex items-center gap-2 cursor-pointer">
              <Checkbox
                v-model="meta.quality"
                binary
                input-id="se-quality"
                @update:model-value="commit"
              />
              <span class="text-surface-700">Учитывать качество сигнала (Quality)</span>
            </label>
          </template>
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
              <InputText
                :model-value="selectedShape.text"
                size="small"
                class="w-full"
                @update:model-value="setText"
                @change="commit"
              />
            </div>
            <label class="flex items-center justify-between">
              <span class="text-surface-700">Размер</span>
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
            <label class="flex items-center justify-between">
              <span class="text-surface-700">Шрифт</span>
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
          </template>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-surface-700">
              {{ isTextShape ? 'Цвет' : 'Цвет линии' }}
              <span v-if="strokeMixed" class="text-xs text-surface-400">разные</span>
            </span>
            <input
              type="color"
              :value="strokeColor"
              class="w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
              @input="setStroke"
              @change="commit"
            />
          </label>
          <label v-if="hasStrokeWidth" class="flex items-center justify-between">
            <span class="text-surface-700">Толщина линии</span>
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
            <input
              v-if="fillEnabled"
              type="color"
              :value="fillColor"
              class="w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
              @input="setFill"
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
