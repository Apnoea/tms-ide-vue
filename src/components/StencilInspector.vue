<script setup>
/**
 * Свойства стенсила — контент правой панели в режиме редактора. Метаданные
 * (id / label / категория / размер) редактируются здесь, а не в тулбаре холста;
 * стейт — синглтон useStencilEditor (тот же инстанс, что рисуется в центре).
 * Анимации приедут сюда же в v2.
 */
import { computed, watch } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import SelectButton from 'primevue/selectbutton'
import { getCategories, registryVersion } from '../stencils/registry'
import { snapToGrid } from '../utils/grid'
import { useStencilEditor } from '../composables/useStencilEditor'

const { meta, editingId, shapes, selectedId, updateShape, commit, setShapeState } =
  useStencilEditor()

// Свойства выделенной фигуры (цвет линии/заливка) правятся здесь же. У линии
// заливки нет — только обводка.
const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null)
const hasFill = computed(() => selectedShape.value && selectedShape.value.type !== 'line')

// <input type="color"> требует 6-значный #rrggbb: разворачиваем #rgb, «none»/
// пусто → запасной цвет (сам факт заливки регулируется отдельной галкой).
function normHex(c, fallback) {
  if (!c || c === 'none') return fallback
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + [...c.slice(1)].map((ch) => ch + ch).join('')
  }
  return c
}
const strokeColor = computed(() => normHex(selectedShape.value?.stroke, '#000000'))
const fillEnabled = computed(() => {
  const f = selectedShape.value?.fill
  return !!f && f !== 'none'
})
const fillColor = computed(() => normHex(selectedShape.value?.fill, '#ffffff'))

// Живое обновление на @input (видно на холсте сразу), один снимок истории на
// @change (закрытие пипетки) — как жесты рисования.
function setStroke(e) {
  if (selectedShape.value) updateShape(selectedShape.value.id, { stroke: e.target.value })
}
const strokeWidth = computed(() => selectedShape.value?.strokeWidth ?? 2)
function setStrokeWidth(v) {
  if (selectedShape.value && v != null) updateShape(selectedShape.value.id, { strokeWidth: v })
}
function setFill(e) {
  if (selectedShape.value) updateShape(selectedShape.value.id, { fill: e.target.value })
}
function toggleFill(on) {
  if (!selectedShape.value) return
  updateShape(selectedShape.value.id, {
    fill: on ? normHex(selectedShape.value.fill, '#ffffff') : 'none',
  })
  commit()
}

// Скругление: у линии/ломаной — круглые торцы/стыки, у прямоугольника — углы (rx).
// Круг скруглять нечего — контрол скрыт.
const hasRounding = computed(() => selectedShape.value && selectedShape.value.type !== 'circle')
const roundedEnabled = computed(() => !!selectedShape.value?.rounded)
function toggleRounded(on) {
  if (!selectedShape.value) return
  updateShape(selectedShape.value.id, { rounded: on })
  commit()
}

// Видимость фигуры по булеву состоянию стенсила (внутренняя анимация):
// always — статична, on/off — видна только при этом значении тега-драйвера.
const STATE_OPTIONS = [
  { label: 'Всегда', value: 'always' },
  { label: 'При вкл', value: 'true' },
  { label: 'При выкл', value: 'false' },
]
const shapeState = computed({
  get: () => selectedShape.value?.state || 'always',
  set: (v) => {
    if (selectedShape.value) setShapeState(selectedShape.value.id, v)
  },
})

// Категории для комбо (существующие + можно вписать новую). registryVersion —
// чтобы список пересобрался, если реестр поменяется.
const categories = computed(() => {
  void registryVersion.value
  return getCategories()
})

// Размер стенсила кратен 10 (порты и сам стенсил садятся на сетку схемы).
watch(
  () => [meta.width, meta.height],
  () => {
    meta.width = Math.max(10, snapToGrid(meta.width, 10))
    meta.height = Math.max(10, snapToGrid(meta.height, 10))
  }
)

// id = имя папки definitions/<id>/ → маска [a-z0-9_]. Фильтруем прямо в DOM
// (watch/computed не годятся: значение уходит в кириллицу и обратно за тик,
// Vue не перезатирает введённый символ). В правке id заблокирован.
function onIdInput(e) {
  const clean = (e.target.value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (e.target.value !== clean) e.target.value = clean
  meta.id = clean
}
</script>

<template>
  <aside class="h-full flex flex-col bg-surface-50">
    <div class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center">
      <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Стенсил</h2>
    </div>

    <div class="flex-1 min-h-0 p-4 overflow-y-auto text-sm space-y-4">
      <label class="block">
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Категория</div>
        <Select
          v-model="meta.category"
          :options="categories"
          editable
          placeholder="Выберите или впишите"
          size="small"
          class="w-full"
        />
      </label>

      <label class="block">
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Название</div>
        <InputText v-model="meta.label" size="small" class="w-full" placeholder="Задвижка" />
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
        />
      </label>

      <div>
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Размер</div>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1.5 text-xs text-surface-500">
            Ш
            <InputNumber
              v-model="meta.width"
              :min="10"
              :step="10"
              :use-grouping="false"
              size="small"
              input-class="!w-16 text-center"
            />
          </label>
          <label class="flex items-center gap-1.5 text-xs text-surface-500">
            В
            <InputNumber
              v-model="meta.height"
              :min="10"
              :step="10"
              :use-grouping="false"
              size="small"
              input-class="!w-16 text-center"
            />
          </label>
        </div>
      </div>

      <div>
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Поведение</div>
        <label class="flex items-center gap-2 mb-1.5 cursor-pointer">
          <Checkbox v-model="meta.noRotate" binary input-id="se-norotate" />
          <span class="text-surface-700">Запретить поворот</span>
        </label>
        <label class="flex items-center gap-2 mb-1.5 cursor-pointer">
          <Checkbox v-model="meta.layoutOnly" binary input-id="se-layoutonly" />
          <span class="text-surface-700">Только разметка (без анимаций)</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <Checkbox v-model="meta.quality" binary input-id="se-quality" />
          <span class="text-surface-700">Анимация качества сигнала (Quality)</span>
        </label>
      </div>

      <div class="border-t border-surface-200 pt-4">
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-2">
          Анимация состояния
        </div>
        <label class="flex items-center gap-2 mb-2 cursor-pointer">
          <Checkbox v-model="meta.stateful" binary input-id="se-stateful" />
          <span class="text-surface-700">Булево состояние (вкл/выкл)</span>
        </label>
        <p v-if="meta.stateful" class="text-xs text-surface-400">
          Выделяй фигуру и задавай ей видимость (При&nbsp;вкл / При&nbsp;выкл) ниже.
        </p>
      </div>

      <div class="border-t border-surface-200 pt-4">
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-2">
          Выделенная фигура
        </div>
        <div v-if="selectedShape" class="space-y-2.5">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-surface-700">Цвет линии</span>
            <input
              type="color"
              :value="strokeColor"
              class="h-7 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
              @input="setStroke"
              @change="commit"
            />
          </label>
          <label class="flex items-center justify-between">
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
              input-class="!w-12 text-center"
              @update:model-value="setStrokeWidth"
              @blur="commit"
            />
          </label>
          <template v-if="hasFill">
            <label class="flex items-center gap-2 cursor-pointer">
              <Checkbox
                :model-value="fillEnabled"
                binary
                input-id="se-fill"
                @update:model-value="toggleFill"
              />
              <span class="text-surface-700">Заливка</span>
            </label>
            <label v-if="fillEnabled" class="flex items-center justify-between cursor-pointer">
              <span class="text-surface-700">Цвет заливки</span>
              <input
                type="color"
                :value="fillColor"
                class="h-7 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
                @input="setFill"
                @change="commit"
              />
            </label>
          </template>
          <label v-if="hasRounding" class="flex items-center gap-2 cursor-pointer">
            <Checkbox
              :model-value="roundedEnabled"
              binary
              input-id="se-rounded"
              @update:model-value="toggleRounded"
            />
            <span class="text-surface-700">Скругление</span>
          </label>
          <div v-if="meta.stateful" class="pt-1">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Видимость</div>
            <SelectButton
              v-model="shapeState"
              :options="STATE_OPTIONS"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              size="small"
            />
          </div>
        </div>
        <p v-else class="text-xs text-surface-400">Выделите фигуру на холсте</p>
      </div>
    </div>
  </aside>
</template>
