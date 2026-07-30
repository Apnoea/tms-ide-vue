<script setup>
/**
 * Статус-полоса (верх справа, над инспектором): состояние проекта + справка по
 * хоткеям. Единый локус статуса — отдельного индикатора автосейва нет. Приоритет:
 *   saveError       — браузер НЕ сохраняет (квота/приватный режим), риск потери;
 *   dirtySinceExport — есть правки после последнего экспорта/импорта в .zip;
 *   иначе            — состояние совпадает с последним доставленным архивом.
 * Автосейв в IndexedDB в норме молчит (успех — это ожидаемое), кричим только про
 * критичную ошибку записи.
 */
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from '../composables/useCanvas'

const ui = useUiStore()
const canvas = useCanvas()
</script>

<template>
  <div class="flex w-full items-center justify-end gap-3">
    <div
      v-if="canvas.saveError.value"
      v-tooltip.bottom="
        'Браузер не сохраняет данные (квота / приватный режим). Экспортируйте проект (Ctrl+S), чтобы не потерять работу'
      "
      class="flex items-center gap-1.5 text-[11px] font-medium text-red-600"
    >
      <i class="pi pi-exclamation-triangle !text-[10px]" />
      Не сохранено
    </div>
    <div
      v-else-if="canvas.dirtySinceExport.value"
      v-tooltip.bottom="'Есть изменения, не попавшие в .zip. Ctrl+S — экспортировать проект'"
      class="flex items-center gap-1.5 text-[11px] font-medium text-amber-600"
    >
      <i class="pi pi-circle-fill !text-[7px]" />
      Не выгружено
    </div>
    <div
      v-else
      v-tooltip.bottom="'Нет изменений с последнего экспорта/импорта проекта'"
      class="flex items-center gap-1.5 text-[11px] text-surface-400"
    >
      <i class="pi pi-check !text-[10px]" />
      Выгружено
    </div>

    <div class="h-4 w-px bg-surface-200" aria-hidden="true"></div>

    <button
      v-tooltip.bottom="'Клавиши и приёмы · ? или F1'"
      type="button"
      class="flex items-center gap-1 text-surface-400 transition-colors hover:text-surface-700"
      @click="ui.openHelp"
    >
      <i class="pi pi-question-circle text-sm" />
      <kbd class="rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px]">F1</kbd>
    </button>
  </div>
</template>
