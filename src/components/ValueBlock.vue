<script setup>
/**
 * Карточка «Значение тега» в инспекторе холста: тег-источник подписи (слот типа
 * `Text`), точность и правимые подписи символа (`tms.params`). На схеме они стоят
 * рядом со значением, поэтому и правятся одним блоком.
 */
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import TagField from './TagField.vue'
import { VALUE_DECIMALS_DEFAULT } from '../constants/animation'

defineProps({
  /** Слот подписи со значением тега: `{ key, type, value }`. */
  slotInfo: { type: Object, required: true },
  /** Объявленные подписи: `{ key, label, value }` — label пуст у пустой по умолчанию. */
  params: { type: Array, default: () => [] },
  /** Знаков после запятой (`tms.decimals`); null = дефолт протокола. */
  decimals: { type: Number, default: null },
  tagsLoaded: { type: Boolean, default: false },
})

const emit = defineEmits(['pick-tag', 'highlight-tag', 'update-decimals', 'update-param'])
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i class="pi pi-hashtag text-cyan-600" />
      <div class="text-xs font-medium text-surface-700">Значение тега</div>
    </div>
    <div class="text-[11px] text-surface-500 mb-1">
      Тег
      <span class="text-surface-400">для анимации элемента</span>
    </div>
    <TagField
      :value="slotInfo.value"
      :can-pick="tagsLoaded"
      highlightable
      @pick="emit('pick-tag')"
      @highlight="emit('highlight-tag', slotInfo.value)"
    />
    <div class="mt-2 flex items-center gap-3">
      <span class="text-[11px] text-surface-500 shrink-0">Знаков после запятой</span>
      <InputNumber
        :model-value="decimals"
        :min="0"
        :max="6"
        :step="1"
        show-buttons
        button-layout="horizontal"
        size="small"
        input-class="w-12! text-center"
        class="ml-auto"
        :placeholder="String(VALUE_DECIMALS_DEFAULT)"
        @update:model-value="(v) => emit('update-decimals', v)"
      />
    </div>
    <!-- Две колонки: у карточки значения это «величина» и «единица» — они читаются
         парой, как на самой карточке. Пустое поле = текст из символа. -->
    <div v-if="params.length" class="mt-2 grid grid-cols-2 gap-2">
      <div v-for="param in params" :key="param.key">
        <!-- Строка заголовка есть всегда: у пустой по умолчанию подписи названия нет,
             а без неё поля в паре разъезжаются по вертикали. -->
        <div class="text-[11px] text-surface-500 mb-1 truncate min-h-4">
          {{ param.label }}
        </div>
        <InputText
          :model-value="param.value"
          size="small"
          class="w-full"
          :placeholder="param.label"
          data-param-field
          @update:model-value="(v) => emit('update-param', param.key, v)"
        />
      </div>
    </div>
  </div>
</template>
