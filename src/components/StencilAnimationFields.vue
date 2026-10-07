<script setup>
/**
 * «Анимации» в свойствах символа: два сворачиваемых блока состояния (открыт максимум
 * один; оба закрытых = анимации нет), зоны диапазонов и галка качества сигнала.
 *
 * Оформлены карточками как в инспекторе холста (StateBlock/RangeBlock): одна настройка
 * с двух сторон — здесь поведение символа, там привязка тега у экземпляра.
 */
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import ColorField from './ColorField.vue'
import RangeRows from './RangeRows.vue'
import AnimationCard from './AnimationCard.vue'
import { useStencilEditor, STATE_PRESETS } from '../composables/useStencilEditor'
import { normalizeStateColor } from '../constants/animation'
import { isFillableShape } from '../utils/shapeSvg'

const {
  meta,
  presetInfo,
  shapes,
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

// Режим и состав состояний заперты у символа набора (по их ключам патч проекта
// ложится на новую версию) и у программного — там анимацию задаёт код.
const stateSetLocked = computed(() => meta.locked || !!presetInfo.value)

/**
 * Превью состояния: стол показывает только фигуры выбранного (эмуляция
 * `animation-hidden` + цвет состояния, см. StencilEditor.renderShapes). Живёт в строке
 * состояния, а не отдельным контролом над столом: «строка ↔ что видно» — одна и та же
 * вещь, и связь читается без объяснений. Повторный клик возвращает «все».
 */
function togglePreview(key) {
  previewState.value = previewState.value === key ? 'all' : key
}

/**
 * Режимы анимации состояния — ДВА сворачиваемых блока, а не таб: у символа работает
 * ровно один (`stateMode`), поэтому открыт тоже ровно один, а закрытые оба = анимация
 * выключена. Заголовок блока и есть переключатель — отдельного «Выкл» не нужно.
 * Здесь режимы ВЫБИРАЮТ, поэтому к общему «Состояние» идёт уточнение источника — на
 * холсте оно подписью, режим там уже задан символом.
 */
const ANIM_MODES = [
  { value: 'boolean', label: 'Состояние', hint: 'по булеву тегу', icon: 'pi-power-off' },
  { value: 'value', label: 'Состояние', hint: 'по коду значения', icon: 'pi-sliders-h' },
]

/** Какой блок раскрыт: `null` — анимации нет. */
const openMode = computed(() => (meta.stateful ? meta.stateMode : null))

// Строки таблицы состояний по режимам. Булев — те же две строки «подпись → значение»,
// что у «по значению», но read-only (`fixed`): значения фиксированы (true/false),
// править и удалять нечего.
const BOOLEAN_STATES = [
  { key: 'true', label: 'Вкл', code: 'true', fixed: true },
  { key: 'false', label: 'Выкл', code: 'false', fixed: true },
]
const stateRows = computed(() => ({ boolean: BOOLEAN_STATES, value: meta.states }))
// Пресет-подписи для editable-Select строки состояния (автор может вписать своё).
const PRESET_LABELS = STATE_PRESETS.map((p) => p.label)

// Заливку по состоянию (state-color) показываем, только когда в символе есть
// заливаемые фигуры (замкнутые примитивы) — иначе цвет заливки некуда применить.
const hasFillableShapes = computed(() => shapes.value.some(isFillableShape))

/**
 * Колонки таблицы состояний: глаз — подпись — значение — цвет контура — [цвет заливки]
 * — удаление. Шапка и строки живут в ОДНОЙ сетке, иначе при смене ширины панели
 * заголовки уезжали бы относительно колонок. Колонка удаления есть и в булевом режиме
 * (там кнопки нет) — иначе два блока не совпали бы между собой.
 */
const stateGridCols = computed(
  () => `30px minmax(0, 1fr) 3rem 30px${hasFillableShapes.value ? ' 30px' : ''} 1.5rem`
)

// Контур/заливка для ключа состояния из stateColors (строка или { stroke, fill }).
const stateColor = (key, which) => normalizeStateColor(meta.stateColors[key])[which]

/**
 * Колонки цвета: контур всегда, заливка — при заливаемых фигурах. Заглушка — что
 * показывать, пока цвет не задан (свотч при этом приглушён); у заливки она НЕ белая: на
 * светлой панели белый квадрат сливается с фоном и колонка выглядит пустой.
 */
const colorColumns = computed(() => [
  {
    which: 'stroke',
    icon: 'pi-circle',
    headTip: hasFillableShapes.value ? 'Цвет контуров' : 'Цвет символа',
    tip: 'Цвет контуров символа в этом состоянии',
    clearTip: 'Убрать цвет',
    placeholder: '#64748b', // slate-500
  },
  ...(hasFillableShapes.value
    ? [
        {
          which: 'fill',
          icon: 'pi-circle-fill',
          headTip: 'Цвет заливки — фигуры со своей заливкой её сохраняют',
          tip: 'Цвет заливки фигур в этом состоянии',
          clearTip: 'Убрать заливку',
          placeholder: '#cbd5e1', // slate-300
        },
      ]
    : []),
])

// Свотч цвета состояния: живьём на @input (видно на превью), снимок истории — на
// @change (пипетка закрыта) и на кнопке-сбросе. Как у цвета фигуры.
function clearStateColor(key, which) {
  setStateColor(key, '', which)
  commit()
}
</script>

<template>
  <div class="space-y-2 border-t border-surface-200 pt-4">
    <div class="tms-field-label">Анимации</div>

    <!-- Режимы состояния: открыт максимум один, оба закрыты = анимации нет.
         `value = null` (клик по открытому) выключает анимацию. -->
    <Accordion
      :value="openMode"
      class="tms-anim-accordion"
      @update:value="setAnimationMode($event || 'off')"
    >
      <!-- `disabled` запирает только заголовок (смену режима), содержимое открытой
           панели — коды и цвета — остаётся правимым. -->
      <AccordionPanel
        v-for="mode in ANIM_MODES"
        :key="mode.value"
        :value="mode.value"
        :disabled="stateSetLocked"
      >
        <AccordionHeader data-test="anim-mode">
          <span class="flex w-full min-w-0 items-center gap-2">
            <i
              class="pi"
              :class="[mode.icon, openMode === mode.value ? 'text-cyan-500' : 'text-surface-400']"
            />
            <span class="flex flex-1 items-baseline gap-1.5 min-w-0">
              <span
                class="text-xs font-medium"
                :class="openMode === mode.value ? 'text-surface-700' : 'text-surface-500'"
              >
                {{ mode.label }}
              </span>
              <span class="tms-hint truncate">{{ mode.hint }}</span>
            </span>
          </span>
        </AccordionHeader>
        <AccordionContent>
          <div class="px-3 pb-3">
            <p class="tms-hint mb-2">
              {{
                mode.value === 'boolean'
                  ? 'Два положения по булеву тегу: какие фигуры видны и каким цветом.'
                  : 'Свои состояния с кодами значений: какие фигуры видны в каждом и каким цветом.'
              }}
            </p>

            <div class="space-y-1.5 mb-2">
              <div
                class="tms-hint grid items-center gap-1.5"
                :style="{ gridTemplateColumns: stateGridCols }"
              >
                <span aria-hidden="true"></span>
                <span>Подпись</span>
                <span>Значение</span>
                <span v-for="col in colorColumns" :key="col.which" class="flex justify-center">
                  <i v-tooltip.top="col.headTip" class="pi text-[11px]!" :class="col.icon" />
                </span>
                <!-- Колонка кнопки удаления: в булевом режиме пустая, но есть — иначе
                     колонки двух блоков не совпадали бы. -->
                <span aria-hidden="true"></span>
              </div>
              <TransitionGroup name="tms-row">
                <div
                  v-for="st in stateRows[mode.value]"
                  :key="st.key"
                  class="grid items-center gap-1.5"
                  :style="{ gridTemplateColumns: stateGridCols }"
                >
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
                  <InputText
                    v-if="st.fixed"
                    :model-value="st.label"
                    disabled
                    size="small"
                    class="min-w-0"
                  />
                  <Select
                    v-else
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
                    :disabled="st.fixed"
                    :placeholder="st.fixed ? undefined : 'код'"
                    size="small"
                    class="min-w-0 font-mono"
                    @update:model-value="updateState(st.key, { code: $event })"
                    @change="commit"
                  />
                  <!-- Колонка — ровно по свотчу (30px): сброс цвета висит бейджем
                       на его углу (как у вида шины), отдельная кнопка рядом
                       требовала бы места и в строках, где цвет не задан. -->
                  <div
                    v-for="col in colorColumns"
                    :key="col.which"
                    class="flex items-center justify-center"
                  >
                    <ColorField
                      v-tooltip.top="col.tip"
                      :model-value="stateColor(st.key, col.which) || col.placeholder"
                      :class="{ 'opacity-40': !stateColor(st.key, col.which) }"
                      @update:model-value="setStateColor(st.key, $event, col.which)"
                      @change="commit"
                    >
                      <template #badge>
                        <button
                          v-if="stateColor(st.key, col.which)"
                          type="button"
                          v-tooltip.top="col.clearTip"
                          class="tms-reset-badge"
                          @click.stop="clearStateColor(st.key, col.which)"
                        >
                          <i class="pi pi-times" />
                        </button>
                      </template>
                    </ColorField>
                  </div>
                  <!-- Булевы состояния не удаляются (их ровно два), под замком — тоже;
                       колонка остаётся: сетка строк общая с шапкой. -->
                  <span v-if="st.fixed || stateSetLocked" aria-hidden="true"></span>
                  <Button
                    v-else
                    v-tooltip.top="'Убрать состояние'"
                    icon="pi pi-times"
                    severity="secondary"
                    text
                    size="small"
                    class="tms-row-btn"
                    @click="removeState(st.key)"
                  />
                </div>
              </TransitionGroup>
              <!-- Состав состояний у символа набора задаёт набор: по их ключам правки
                   проекта ложатся на новую версию. -->
              <div v-if="mode.value === 'value' && !stateSetLocked" class="flex gap-1.5">
                <button type="button" class="tms-add-row" @click="addState">
                  <i class="pi pi-plus text-[10px]!" />
                  состояние
                </button>
                <button
                  type="button"
                  v-tooltip.top="'4 состояния: Включен / Отключен / Промежуточное / Недостоверно'"
                  class="tms-add-row"
                  @click="applyPositionPreset"
                >
                  <i class="pi pi-bolt text-[10px]!" />
                  Сигнал положения
                </button>
              </div>
            </div>
          </div>
        </AccordionContent>
      </AccordionPanel>
    </Accordion>

    <!-- Зоны диапазонов — НЕЗАВИСИМО от анимации состояния (символ показывает
         положение по своему тегу и красится по числу другого), поэтому карточка вне
         `stateful`-ветки. У программного символа это единственное, что правится. -->
    <AnimationCard icon="pi pi-chart-bar text-yellow-500" title="Цвет" hint="по диапазону тега">
      <p class="tms-hint mb-2">
        Цвет символа по числу тега. Границы включаются в диапазон: одинаковые («3 — 3») задают
        точное значение.
      </p>
      <RangeRows
        :ranges="meta.ranges"
        @update-range="updateRange"
        @add-range="addRange"
        @remove-range="removeRange"
      />
    </AnimationCard>

    <!-- Quality — свойство символа, а не отдельной анимации: серость и «показать
         все положения» при bad-качестве драйвящего тега работают в любом режиме,
         поэтому галка стоит ПОСЛЕ всех блоков. Без анимации состояния цепляться
         не за что (нужен её тег). -->
    <label
      v-if="meta.stateful"
      class="flex items-center gap-2 pt-1"
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
</template>

<style scoped>
/* Дефолты Aura для блока анимаций слишком жирные: панели должны читаться карточками
   инспектора (как StateBlock/RangeBlock на холсте), а не полосами аккордеона.
   Активный режим виден раскрытием, цветом иконки и заголовка — рамке его дублировать
   незачем, она остаётся нейтральной, как у карточек холста. */
.tms-anim-accordion :deep(.p-accordionpanel) {
  margin-bottom: 0.5rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 0.25rem;
  background: var(--p-surface-0);
}
.tms-anim-accordion :deep(.p-accordionheader) {
  padding: 0.75rem;
  background: transparent;
  border: 0;
  border-radius: 0.25rem;
}
.tms-anim-accordion :deep(.p-accordioncontent-content) {
  padding: 0;
  background: transparent;
  border: 0;
}
/* `.p-accordioncontent` — GRID, а его трек по умолчанию не уже содержимого: длинная
   подпись состояния распирала бы панель до горизонтального скролла, несмотря на
   `minmax(0, 1fr)` внутри таблицы (`stateGridCols`). */
.tms-anim-accordion :deep(.p-accordioncontent) {
  grid-template-columns: minmax(0, 1fr);
}
</style>
