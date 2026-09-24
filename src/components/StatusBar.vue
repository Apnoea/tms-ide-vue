<script setup>
/**
 * Статус-полоса (верх справа): справка + единственный статус `saveError` —
 * браузер не пишет в IndexedDB (квота / приватный режим), работа живёт только в
 * памяти вкладки. В норме полоса пуста: успешный автосейв молчит, а «есть правки
 * не в .zip» в интерфейсе не индицируется — о нём говорит только тултип «Экспорт»
 * (см. ProjectActions), флаг нужен десктопной оболочке.
 */
import Message from 'primevue/message'
import Divider from 'primevue/divider'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from '../composables/useCanvas'

const ui = useUiStore()
const canvas = useCanvas()
</script>

<template>
  <div class="flex w-full items-center justify-end gap-3">
    <Message
      v-if="canvas.saveError.value"
      v-tooltip.bottom="
        'Браузер не сохраняет данные (квота / приватный режим). Экспортируй проект (Ctrl+S), чтобы не потерять работу'
      "
      severity="error"
      variant="simple"
      size="small"
      class="tms-status-message"
    >
      Не сохранено
    </Message>

    <!-- Разделитель — только когда слева есть статус, иначе висел бы у края. Высота
         меньше тулбарной: строка статуса компактнее. -->
    <Divider
      v-if="canvas.saveError.value"
      layout="vertical"
      class="tms-toolbar-divider"
      style="height: 1rem"
    />

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

<style scoped>
/* Статус стоит в строке шапки, поэтому от `Message` нужен только цвет severity:
   собственные отступы и размер шрифта ужимаем до 11px, как у соседних элементов. */
.tms-status-message :deep(.p-message-text) {
  font-size: 11px;
  font-weight: 500;
}
.tms-status-message :deep(.p-message-content) {
  gap: 0.375rem;
  padding: 0;
}
</style>
