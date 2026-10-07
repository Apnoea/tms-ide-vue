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
import AnimationCard from './AnimationCard.vue'
import { STEPPER_PROPS } from '../constants/icons'

defineProps({
  /** Слот подписи со значением тега: `{ key, type, value }`. */
  slotInfo: { type: Object, required: true },
  /** Объявленные подписи: `{ key, label, value }` — label пуст у пустой по умолчанию. */
  params: { type: Array, default: () => [] },
  /** Знаков после запятой (`tms.decimals`); `null` = поле не задано, показываем дефолт. */
  decimals: { type: Number, default: null },
  tagsLoaded: { type: Boolean, default: false },
  // copyable — в карточке есть что копировать (тег, точность или подпись); pasteable —
  // в буфере лежит карточка значения, «вставить» показываем на любом выделении.
  copyable: { type: Boolean, default: false },
  pasteable: { type: Boolean, default: false },
})

const emit = defineEmits([
  'pick-tag',
  'highlight-tag',
  'clear',
  'copy',
  'paste',
  'update-decimals',
  'update-param',
])

// Заголовки полей по позиции: у символа параметр — только текст по умолчанию («Величина»
// или пусто), и над вторым полем не было ничего. Текст символа остаётся плейсхолдером.
const PARAM_HEADINGS = ['Подпись', 'Ед. изм.']
</script>

<template>
  <AnimationCard
    icon="pi pi-hashtag text-cyan-600"
    title="Значение"
    hint="тега"
    :paste-tip="pasteable && 'Вставить карточку значения'"
    :copy-tip="copyable && 'Копировать карточку значения'"
    :clear-tip="!!slotInfo.value && 'Очистить тег'"
    @paste="emit('paste')"
    @copy="emit('copy')"
    @clear="emit('clear')"
  >
    <!-- Копируется карточка ЦЕЛИКОМ (тег, точность, подписи): ряд однотипных показаний
         настраивают один раз. × снимает только привязку тега — точность и подписи это
         вид символа, а не анимация. -->
    <TagField
      :value="slotInfo.value"
      :can-pick="tagsLoaded"
      highlightable
      @pick="emit('pick-tag')"
      @highlight="emit('highlight-tag', slotInfo.value)"
    />
    <!-- Точность — свойство ЗНАЧЕНИЯ: без привязанного тега печатать нечего, и поле
         спрашивало бы о формате несуществующих данных. -->
    <div v-if="slotInfo.value" class="mt-2 flex items-center gap-3">
      <span class="tms-hint shrink-0">Знаков после запятой</span>
      <!-- Точность показываем ЧИСЛОМ, а не подсказкой в пустом поле: в `tms` дефолт не
           пишется, но в рантайме подпись всё равно печатается с ним, и пустое поле
           читалось бы как «точность не задана». -->
      <InputNumber
        :model-value="decimals ?? VALUE_DECIMALS_DEFAULT"
        :min="0"
        :max="6"
        :step="1"
        v-bind="STEPPER_PROPS"
        size="small"
        input-class="w-12! text-center"
        class="ml-auto"
        @update:model-value="(v) => emit('update-decimals', v)"
      />
    </div>
    <!-- Две колонки: подпись и единица читаются парой, как на самой карточке; единица
         короче — колонка уже. Пустое поле = текст из символа. -->
    <div v-if="params.length" class="mt-2 grid grid-cols-[2fr_1fr] gap-2">
      <div v-for="(param, i) in params" :key="param.key">
        <div class="tms-hint mb-1 truncate min-h-4">
          {{ PARAM_HEADINGS[i] ?? param.label }}
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
  </AnimationCard>
</template>
