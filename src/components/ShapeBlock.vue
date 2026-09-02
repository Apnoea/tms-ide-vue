<script setup>
/**
 * Свойства фигуры-разметки (`tms.Shape`) в инспекторе холста: вид и содержимое
 * подписи. Анимаций, навигации и тегов у фигуры нет, геометрия правится жестами на
 * холсте — поэтому блок автономен и знает только про патч вида.
 *
 * Значения приходят готовыми (`values` — поля фигуры из `details`), наружу уходит
 * ПАТЧ (`@patch`): пересчёт габарита и шаг истории делает вызывающий.
 */
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import SelectButton from 'primevue/selectbutton'
import { FONT_FAMILIES } from '../utils/textMetrics'

const props = defineProps({
  /** Поля выделенной фигуры: label/тип, обводка, заливка, поля подписи. */
  values: { type: Object, required: true },
  /** Черновик текста подписи (правится в родителе: пустой коммит удаляет фигуру). */
  text: { type: String, default: '' },
  alignOptions: { type: Array, required: true },
  boldOptions: { type: Array, required: true },
})

const emit = defineEmits(['patch', 'text-input', 'text-commit'])

const patch = (p) => emit('patch', p)

/** Тумблер заливки: включаем последним цветом (или белым), выключаем в `none`. */
function toggleFill(on) {
  patch({ fill: on ? props.values.fill || '#ffffff' : 'none' })
}
</script>

<template>
  <div>
    <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Фигура</div>
    <div class="font-medium text-surface-900">{{ values.shapeLabel }}</div>
  </div>

  <div class="space-y-2.5">
    <div v-if="values.isShapeText">
      <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-1">Текст</div>
      <!-- Пустое поле = удалить подпись (по коммиту, не на каждый символ: иначе
           стирание текста «под новый» сносило бы фигуру). Textarea, а не InputText:
           подпись многострочная, Enter добавляет строку — поэтому шаг истории
           пишется по blur, а не по Enter. -->
      <Textarea
        :model-value="text"
        rows="3"
        size="small"
        class="w-full"
        placeholder="Пустое поле удалит подпись"
        @update:model-value="(v) => emit('text-input', v)"
        @blur="emit('text-commit')"
      />
    </div>

    <div v-if="!values.isShapeText" class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
        {{ values.isShapeFillable ? 'Цвет линии' : 'Цвет' }}
      </span>
      <input
        type="color"
        :value="values.stroke"
        class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
        @input="patch({ stroke: $event.target.value })"
      />
    </div>

    <div v-if="!values.isShapeText" class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
        Толщина, px
      </span>
      <InputNumber
        :model-value="values.strokeWidth"
        :min="0.5"
        :max="40"
        :step="0.5"
        :max-fraction-digits="1"
        show-buttons
        button-layout="horizontal"
        size="small"
        input-class="w-12! text-center"
        class="ml-auto"
        @update:model-value="(v) => v != null && patch({ strokeWidth: v })"
      />
    </div>

    <!-- Заливка — как в редакторе символов: галка «есть/нет» + свотч при включённой
         (`<input type="color">` состояния «нет цвета» не имеет). Выключение пишет
         `none`, а не удаляет поле: отсутствие и `none` для отрисовки одно и то же, но
         патч мержится, а не заменяет фигуру. -->
    <div v-if="values.isShapeFillable" class="flex min-h-8 items-center gap-3">
      <label class="flex items-center gap-2 cursor-pointer">
        <Checkbox
          :model-value="!!values.fill"
          binary
          input-id="shape-fill"
          @update:model-value="toggleFill"
        />
        <span class="text-[11px] uppercase tracking-wider text-surface-500">Заливка</span>
      </label>
      <input
        v-if="values.fill"
        type="color"
        :value="values.fill"
        class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
        @input="patch({ fill: $event.target.value })"
      />
    </div>

    <template v-if="values.isShapeText">
      <div class="flex items-center gap-3">
        <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
          Размер, pt
        </span>
        <InputNumber
          :model-value="values.fontSize"
          :min="6"
          :max="72"
          :step="1"
          show-buttons
          button-layout="horizontal"
          size="small"
          input-class="w-12! text-center"
          class="ml-auto"
          @update:model-value="(v) => v != null && patch({ fontSize: v })"
        />
      </div>

      <div class="flex items-center gap-3">
        <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">Шрифт</span>
        <Select
          :model-value="values.fontFamily"
          :options="FONT_FAMILIES"
          option-label="label"
          option-value="value"
          size="small"
          class="ml-auto w-40"
          @update:model-value="(v) => patch({ fontFamily: v })"
        >
          <template #option="{ option }">
            <span :style="{ fontFamily: option.value }">{{ option.label }}</span>
          </template>
        </Select>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">Жирность</span>
        <SelectButton
          :model-value="values.bold ? 'bold' : null"
          :options="boldOptions"
          option-value="value"
          data-key="value"
          size="small"
          class="ml-auto"
          @update:model-value="(v) => patch({ bold: v === 'bold' })"
        >
          <template #option>
            <span class="font-bold" v-tooltip.top="'Жирный'">B</span>
          </template>
        </SelectButton>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">Цвет</span>
        <input
          type="color"
          :value="values.stroke"
          class="ml-auto h-8 w-10 cursor-pointer rounded border border-surface-300 bg-surface-0 p-0.5"
          @input="patch({ stroke: $event.target.value })"
        />
      </div>

      <!-- Выравнивание = якорь роста (как у cell_text): точка привязки стоит на
           месте, текст растёт от неё. -->
      <div class="flex items-center gap-3">
        <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
          Выравнивание
        </span>
        <SelectButton
          :model-value="values.shapeAlign"
          :options="alignOptions"
          option-value="value"
          data-key="value"
          size="small"
          class="ml-auto"
          @update:model-value="(v) => v && patch({ align: v })"
        >
          <template #option="{ option }">
            <i :class="option.icon" v-tooltip.top="option.tip" />
          </template>
        </SelectButton>
      </div>
    </template>
  </div>
</template>
