<script setup>
/**
 * Статус-полоса (верх справа, над инспектором): справка + ОДИН статус —
 * `saveError` (браузер не пишет в IndexedDB: квота / приватный режим, работа
 * живёт только в памяти вкладки). В норме полоса пуста.
 *
 * «Есть правки, не попавшие в .zip» здесь НЕ показываем: это амбер-точка на
 * кнопке «Экспорт» (ProjectActions) — рядом с действием, которое закрывает
 * вопрос. Дублировать её текстом значило занимать место ровно в том состоянии,
 * когда смотреть не надо, а «Выгружено» вообще сообщало «всё нормально».
 * Успешный автосейв тоже молчит — кричим только про потерю данных.
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

    <!-- Разделитель — только когда слева есть статус, иначе висел бы у края. -->
    <div v-if="canvas.saveError.value" class="h-4 w-px bg-surface-200" aria-hidden="true"></div>

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
