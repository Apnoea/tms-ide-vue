<script setup>
/**
 * Поля вида провода: цвет, толщина, наконечники. Один набор контролов на два места
 * инспектора — свойства одиночного провода и мульти-выделение проводов, — иначе
 * разметка (и её поведение) разъезжалась бы по двум копиям.
 *
 * Значения приходят готовыми: `undefined` в поле = у целей разные значения, тогда
 * рядом с подписью показываем «разные» и не подменяем его значением первого.
 */
import InputNumber from 'primevue/inputnumber'
import SelectButton from 'primevue/selectbutton'
import { isDefaultWireValue, WIRE_STYLE_DEFAULTS } from '../stencils/linkDefaults'

const props = defineProps({
  /**
   * { strokeColor, strokeWidth, arrowStart, arrowEnd }; undefined = «разные».
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
</script>

<template>
  <div class="space-y-2.5">
    <!-- Цвет линии — строка «подпись слева / пикер справа» (как цвет текста).
         Крестик поверх пикера — сброс к дефолту, как у кнопки фона холста: виден
         только когда цвет свой, иначе висел бы пустым обещанием. -->
    <div class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
        Цвет
        <span v-if="mixed('strokeColor')" class="text-surface-400">разные</span>
      </span>
      <span class="relative ml-auto inline-flex">
        <input
          type="color"
          :value="values.strokeColor ?? WIRE_STYLE_DEFAULTS.strokeColor"
          class="h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
          @input="emit('apply', 'strokeColor', $event.target.value)"
        />
        <button
          v-if="isCustom('strokeColor')"
          v-tooltip.bottom="'Вернуть цвет по умолчанию'"
          type="button"
          class="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
          @click.stop="emit('apply', 'strokeColor', WIRE_STYLE_DEFAULTS.strokeColor)"
        >
          <i class="pi pi-times text-[7px]!" />
        </button>
      </span>
    </div>

    <!-- Толщина линии — InputNumber со степперами, как в редакторе символов. -->
    <div class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
        Толщина, px
        <span v-if="mixed('strokeWidth')" class="text-surface-400">разные</span>
      </span>
      <span class="relative ml-auto inline-flex">
        <InputNumber
          :model-value="values.strokeWidth ?? null"
          :min="0.5"
          :max="20"
          :step="0.5"
          :max-fraction-digits="1"
          show-buttons
          button-layout="horizontal"
          size="small"
          input-class="w-12! text-center"
          @update:model-value="(v) => emit('apply', 'strokeWidth', v)"
        />
        <button
          v-if="isCustom('strokeWidth')"
          v-tooltip.bottom="'Вернуть толщину по умолчанию'"
          type="button"
          class="absolute -right-0.5 -top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-surface-300 bg-surface-0 text-surface-500 shadow-sm hover:text-surface-800"
          @click.stop="emit('apply', 'strokeWidth', WIRE_STYLE_DEFAULTS.strokeWidth)"
        >
          <i class="pi pi-times text-[7px]!" />
        </button>
      </span>
    </div>

    <!-- Наконечники смотрят В точку соединения, размер — от толщины линии.
         Концы независимы: бывает и один, и оба. -->
    <div v-for="end in arrowEnds" :key="end.key" class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
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
          <svg v-tooltip.bottom="option.tip" viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true">
            <path
              v-for="(el, i) in option.glyph"
              :key="i"
              :d="el.d"
              :fill="el.mode === 'fill' ? 'currentColor' : 'none'"
              :stroke="el.mode === 'stroke' ? 'currentColor' : 'none'"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </template>
      </SelectButton>
    </div>
  </div>
</template>
