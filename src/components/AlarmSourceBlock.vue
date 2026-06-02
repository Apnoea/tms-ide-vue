<script setup>
import Tag from 'primevue/tag'

/**
 * Карточка анимации «Аварийный сигнал» для cell_alr. По смыслу аналогична
 * VoltageSourceBlock / SwitchSourceBlock, но обёртывает required-слот стенсила,
 * а не отдельную сущность tms.* (вся анимация cell_alr декларативна, в
 * stencil.animationTemplate). Отсюда:
 * • нет кнопки «удалить» — без тега стенсил не функционален, и юзер вообще
 * не может «выключить» эту анимацию у cell_alr; убирать нечего.
 * • picker'ит ровно слот (parent зовёт openSlotPicker(slot)).
 *
 * Поведение: когда тег = false → индикатор аварии скрыт (animation-hidden).
 * Когда true → видим. Это поведение зашито в stencil.json — здесь просто
 * напоминаем юзеру одной строкой описания.
 */
// Имя prop'а — alarmSlot, а не просто slot: `slot` — зарезервированный атрибут
// шаблона в Vue 2 (deprecated в Vue 3), eslint-plugin-vue ругается на :slot=…
defineProps({
  alarmSlot: { type: Object, required: true }, // { key, label, value, tagSuffix, required }
  tagsLoaded: { type: Boolean, default: false },
})

defineEmits(['open-tag-picker'])
</script>

<template>
  <div class="border border-surface-200 rounded p-3 bg-surface-0">
    <div class="flex items-center gap-2 mb-2">
      <i class="pi pi-bell text-amber-500" aria-hidden="true" />
      <div class="text-xs font-medium text-surface-700">Аварийный сигнал</div>
      <Tag
        v-if="alarmSlot.tagSuffix"
        v-tooltip.bottom="`Ожидается тег с суффиксом ${alarmSlot.tagSuffix}`"
        :value="alarmSlot.tagSuffix"
        severity="secondary"
        rounded
        class="ml-auto !font-mono !text-[10px] !py-0"
      />
    </div>

    <p class="text-[11px] text-surface-500 mb-2 leading-snug">
      Когда значение тега =
      <code class="font-mono">true</code>
      — индикатор аварии виден, иначе скрыт.
    </p>

    <div>
      <div class="text-[11px] text-surface-500 mb-1">Тег</div>
      <div class="flex items-center gap-2">
        <code
          class="flex-1 px-2 py-1 bg-surface-100 hover:bg-surface-200 rounded text-xs font-mono truncate transition-colors"
          :class="[
            tagsLoaded ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            alarmSlot.required && !alarmSlot.value ? 'border border-amber-500/40' : '',
          ]"
          :title="tagsLoaded ? 'Выбрать тег' : 'Загрузи tag-list, чтобы выбрать тег'"
          @click="tagsLoaded && $emit('open-tag-picker')"
        >
          {{
            alarmSlot.value ||
            (alarmSlot.tagSuffix ? `— выбрать тег ${alarmSlot.tagSuffix} —` : '— не выбран —')
          }}
        </code>
      </div>
    </div>
  </div>
</template>
