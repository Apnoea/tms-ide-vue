<script setup>
/**
 * Блок «состояние элемента» в инспекторе: тег слота-драйвера символа. Слот-драйвер один
 * и его режим задан в определении символа (`stateMode`: `boolean` → слот `onoff`,
 * `value` → слот `value`), поэтому блок один, а заголовок и подсказка следуют типу
 * слота — на холсте режим не переключается.
 *
 * × в шапке снимает привязку тега. Без тега рантайму нечем переключать символ, и он
 * экспортируется статичным — это законное состояние, а не ошибка ввода.
 *
 * Состояния символа показываем здесь же: иначе они видны только в редакторе символов,
 * и код значения тега не с чем сверить.
 */
import { computed } from 'vue'
import Button from 'primevue/button'
import TagField from './TagField.vue'
import { isBooleanType } from '../services/parsers'

const props = defineProps({
  /** Слот-драйвер: `{ key, type, value }`. */
  slotInfo: { type: Object, required: true },
  /** Состояния «по значению» из определения символа: `[{ key, label, code }]`. */
  states: { type: Array, default: () => [] },
  tagsLoaded: { type: Boolean, default: false },
  // copyable — тег привязан, есть что копировать; pasteable — в буфере лежит тег
  // состояния, «вставить» показываем на любом выделении (совместимость проверит вставка).
  copyable: { type: Boolean, default: false },
  pasteable: { type: Boolean, default: false },
})

defineEmits(['pick-tag', 'highlight-tag', 'clear', 'copy', 'paste'])

const isBool = computed(() => isBooleanType(props.slotInfo?.type))

// У булева слота состояний ровно два, и в определении символа они не перечисляются —
// подписываем их так же, как переключатель предпросмотра в редакторе символов.
const BOOL_STATES = [
  { key: 'true', label: 'Вкл', code: 'true' },
  { key: 'false', label: 'Выкл', code: 'false' },
]

const displayStates = computed(() => (isBool.value ? BOOL_STATES : props.states))
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i class="pi text-cyan-500" :class="isBool ? 'pi-power-off' : 'pi-sliders-h'" />
      <div class="text-xs font-medium text-surface-700">
        {{ isBool ? 'Булево значение' : 'Состояние по значению' }}
      </div>
      <div class="ml-auto flex items-center">
        <Button
          v-if="pasteable"
          v-tooltip.bottom="'Вставить тег состояния'"
          icon="pi pi-clipboard"
          severity="secondary"
          text
          size="small"
          class="p-1! w-6! h-6!"
          @click="$emit('paste')"
        />
        <Button
          v-if="copyable"
          v-tooltip.bottom="'Копировать тег состояния'"
          icon="pi pi-copy"
          severity="secondary"
          text
          size="small"
          class="p-1! w-6! h-6!"
          @click="$emit('copy')"
        />
        <!-- × в шапке, а не в строке тега: случайный клик по чипу не должен стирать
             привязку. -->
        <Button
          v-if="slotInfo.value"
          v-tooltip.bottom="'Очистить тег'"
          icon="pi pi-times"
          severity="secondary"
          text
          size="small"
          class="p-1! w-6! h-6!"
          @click="$emit('clear')"
        />
      </div>
    </div>

    <div class="text-[11px] text-surface-500 mb-1">
      Тег
      <span class="text-surface-400">для анимации элемента</span>
    </div>
    <TagField
      :value="slotInfo.value || ''"
      :can-pick="tagsLoaded"
      highlightable
      @pick="$emit('pick-tag')"
      @highlight="$emit('highlight-tag', slotInfo.value)"
    />

    <!-- Состояния — справка, а не настройка: их вид и коды заданы в символе. Показываем
         одинаково в обоих режимах: у булева слота это `true`/`false`, у режима «по
         значению» — коды, которые вписал автор символа. -->
    <div v-if="displayStates.length" class="mt-2">
      <div class="text-[11px] text-surface-500 mb-1">Состояния символа</div>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="st in displayStates"
          :key="st.key"
          class="inline-flex items-center gap-1 rounded border border-surface-200 bg-surface-50 px-1.5 py-0.5 text-[11px] text-surface-600"
        >
          {{ st.label || st.key }}
          <code v-if="st.code !== '' && st.code != null" class="font-mono text-surface-400">
            {{ st.code }}
          </code>
        </span>
      </div>
    </div>

    <p v-if="!tagsLoaded" class="text-[11px] text-surface-400 leading-snug mt-1">
      Загрузи tag-list, чтобы выбрать тег.
    </p>
  </div>
</template>
