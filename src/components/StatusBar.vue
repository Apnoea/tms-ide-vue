<script setup>
/**
 * Статус-полоса (верх справа, над инспектором): справка по хоткеям. Индикатор
 * автосейва — отдельным элементом на холсте (SaveIndicator, слева-снизу).
 */
import { useUiStore } from '../stores/useUiStore'

const ui = useUiStore()
</script>

<template>
  <div class="flex w-full items-center justify-end">
    <!-- Справка по хоткеям. -->
    <button
      v-tooltip.bottom="'Горячие клавиши · ? или F1'"
      type="button"
      class="flex items-center gap-1 text-surface-400 transition-colors hover:text-surface-700"
      @click="ui.openHelp"
    >
      <i class="pi pi-question-circle text-sm" />
      <kbd class="rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px]">F1</kbd>
    </button>
  </div>
</template>
