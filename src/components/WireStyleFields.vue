<script setup>
/**
 * Поля вида провода: цвет, толщина, маршрут, наконечники. Один набор контролов на два места
 * инспектора — свойства одиночного провода и мульти-выделение проводов, — иначе
 * разметка (и её поведение) разъезжалась бы по двум копиям.
 *
 * Значения приходят готовыми: `undefined` в поле = у целей разные значения, тогда
 * рядом с подписью показываем «разные» и не подменяем его значением первого.
 */
import InputNumber from 'primevue/inputnumber'
import SelectButton from 'primevue/selectbutton'
import ColorField from './ColorField.vue'
import GlyphIcon from './GlyphIcon.vue'
import { isDefaultWireValue, WIRE_STYLE_DEFAULTS } from '../stencils/linkDefaults'
import { WIRE_ROUTE_STRAIGHT, WIRE_STROKE_MAX, WIRE_STROKE_MIN } from '../constants/wire'
import { STEPPER_PROPS } from '../constants/icons'

const props = defineProps({
  /**
   * { route, strokeColor, strokeWidth, arrowStart, arrowEnd }; undefined = «разные».
   * Имя не `style`: так зовётся fallthrough-атрибут, и внешний `style="…"` приехал бы
   * строкой в этот же prop.
   */
  values: { type: Object, required: true },
  /** Варианты наконечника (миниатюры) и подписи концов — из инспектора. */
  arrowOptions: { type: Array, required: true },
  arrowEnds: { type: Array, required: true },
})

const emit = defineEmits(['apply'])

const mixed = (key) => props.values[key] === undefined
/** Значение своё, а не дефолтное — только тогда показываем сброс. */
const isCustom = (key) =>
  props.values[key] !== undefined && !isDefaultWireValue(key, props.values[key])

// «По сетке» — отсутствие поля (`route: null`), в SelectButton ему нужно своё значение.
const ROUTE_OPTIONS = [
  { value: 'grid', label: 'По сетке' },
  { value: WIRE_ROUTE_STRAIGHT, label: 'Прямой' },
]
</script>

<template>
  <div class="space-y-2.5">
    <!-- Цвет линии — строка «подпись слева / пикер справа» (как цвет текста).
         Крестик поверх пикера — сброс к дефолту, как у кнопки фона холста: виден
         только когда цвет свой, иначе висел бы пустым обещанием. -->
    <div class="flex items-center gap-3">
      <span class="tms-field-label shrink-0">
        Цвет
        <span v-if="mixed('strokeColor')" class="text-surface-400">разные</span>
      </span>
      <ColorField
        :model-value="values.strokeColor ?? WIRE_STYLE_DEFAULTS.strokeColor"
        class="ml-auto"
        @update:model-value="emit('apply', 'strokeColor', $event)"
      >
        <template #badge>
          <button
            v-if="isCustom('strokeColor')"
            v-tooltip.bottom="'Вернуть цвет по умолчанию'"
            type="button"
            class="tms-reset-badge"
            @click.stop="emit('apply', 'strokeColor', WIRE_STYLE_DEFAULTS.strokeColor)"
          >
            <i class="pi pi-times" />
          </button>
        </template>
      </ColorField>
    </div>

    <!-- Толщина линии — InputNumber со степперами, как в редакторе символов. -->
    <div class="flex items-center gap-3">
      <span class="tms-field-label shrink-0">
        Толщина,
        <span class="normal-case">px</span>
        <span v-if="mixed('strokeWidth')" class="text-surface-400">разные</span>
      </span>
      <span class="relative ml-auto inline-flex">
        <InputNumber
          :model-value="values.strokeWidth ?? null"
          :min="WIRE_STROKE_MIN"
          :max="WIRE_STROKE_MAX"
          :step="0.5"
          :max-fraction-digits="1"
          v-bind="STEPPER_PROPS"
          size="small"
          input-class="w-12! text-center"
          @update:model-value="(v) => emit('apply', 'strokeWidth', v)"
        />
        <button
          v-if="isCustom('strokeWidth')"
          v-tooltip.bottom="'Вернуть толщину по умолчанию'"
          type="button"
          class="tms-reset-badge"
          @click.stop="emit('apply', 'strokeWidth', WIRE_STYLE_DEFAULTS.strokeWidth)"
        >
          <i class="pi pi-times" />
        </button>
      </span>
    </div>

    <!-- Маршрут — после вида линии и перед наконечниками: цвет и толщину правят чаще
         (маршрут «липкий», его выбирают раз на серию), а маршрут со стрелками — про
         форму линии и её концы. У «разных» ни один вариант не подсвечен. -->
    <div class="flex items-center gap-3">
      <span class="tms-field-label shrink-0">
        Маршрут
        <span v-if="mixed('route')" class="text-surface-400">разные</span>
      </span>
      <SelectButton
        :model-value="mixed('route') ? null : values.route || 'grid'"
        :options="ROUTE_OPTIONS"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        class="ml-auto"
        @update:model-value="(v) => emit('apply', 'route', v === 'grid' ? null : v)"
      />
    </div>

    <!-- Наконечники смотрят В точку соединения, размер — от толщины линии.
         Концы независимы: бывает и один, и оба. -->
    <div v-for="end in arrowEnds" :key="end.key" class="flex items-center gap-3">
      <span class="tms-field-label shrink-0">
        {{ end.label }}
        <span v-if="mixed(end.key)" class="text-surface-400">разные</span>
      </span>
      <SelectButton
        :model-value="values[end.key] || 'none'"
        :options="arrowOptions"
        option-value="value"
        :allow-empty="false"
        size="small"
        class="ml-auto"
        @update:model-value="(v) => emit('apply', end.key, v === 'none' ? null : v)"
      >
        <template #option="{ option }">
          <GlyphIcon v-tooltip.bottom="option.tip" :glyph="option.glyph" class="h-4! w-4!" />
        </template>
      </SelectButton>
    </div>
  </div>
</template>
