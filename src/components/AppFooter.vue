<script setup>
import { useCanvas } from '../composables/useCanvas'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { storeToRefs } from 'pinia'

const canvas = useCanvas()
const project = useProjectStore()
const ui = useUiStore()
const { tags } = storeToRefs(project)
</script>

<template>
  <footer
    class="px-4 py-1.5 border-t border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 flex items-center gap-4 text-xs text-surface-500 dark:text-surface-400 font-mono"
  >
    <!-- Левый блок: счётчики -->
    <span class="flex items-center gap-1">
      <i class="pi pi-th-large text-[10px]" />
      {{ canvas.cellsCount.value }}
    </span>
    <span class="flex items-center gap-1">
      <i class="pi pi-arrows-h text-[10px]" />
      {{ canvas.linksCount.value }}
    </span>
    <span class="flex items-center gap-1">
      <i class="pi pi-tags text-[10px]" />
      {{ tags.length }}
    </span>

    <!-- Разделитель -->
    <span class="text-surface-300 dark:text-surface-700">·</span>

    <!-- Autosave-индикатор -->
    <span
      class="flex items-center gap-1 transition-colors"
      :class="
        canvas.recentlySaved.value
          ? 'text-primary-600 dark:text-primary-300'
          : 'text-surface-400 dark:text-surface-500'
      "
      :title="
        canvas.recentlySaved.value
          ? 'Только что сохранено в localStorage'
          : 'Автосохранение включено'
      "
    >
      <i class="pi text-[10px]" :class="canvas.recentlySaved.value ? 'pi-check-circle' : 'pi-save'" />
      <span class="text-[11px]">
        {{ canvas.recentlySaved.value ? 'Сохранено' : 'Авто' }}
      </span>
    </span>

    <!-- Правый блок: справка + версия -->
    <button
      v-tooltip.top="'Горячие клавиши · ?'"
      type="button"
      class="ml-auto flex items-center text-surface-400 dark:text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
      @click="ui.openHelp"
    >
      <i class="pi pi-question-circle text-[12px]" />
    </button>
    <span class="text-surface-400 dark:text-surface-500">tms-ide-vue · v0.1.0</span>
  </footer>
</template>
