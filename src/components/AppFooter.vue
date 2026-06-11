<script setup>
import { computed } from 'vue'
import { useTimestamp } from '@vueuse/core'
import { useCanvas } from '../composables/useCanvas'
import { useUiStore } from '../stores/useUiStore'

const canvas = useCanvas()
const ui = useUiStore()

// Bump раз в секунду для relative time. useTimestamp сам ставит/снимает
// setInterval и auto-disposes на unmount.
const nowTick = useTimestamp({ interval: 1000 })

const savedAgo = computed(() => {
  const ts = canvas.lastSavedAt.value
  if (!ts) return '—'
  const diff = Math.max(0, Math.floor((nowTick.value - ts) / 1000))
  if (diff < 5) return 'только что'
  if (diff < 60) return `${diff} сек назад`
  const mins = Math.floor(diff / 60)
  return `${mins} мин назад`
})
</script>

<template>
  <footer
    class="px-4 py-1.5 border-t border-surface-200 bg-surface-0 flex items-center gap-3 text-xs text-surface-500 font-mono"
  >
    <!-- LEFT: file state — save-индикатор. Click → force-save (= экспорт). -->
    <button
      v-tooltip.top="'Сохранить · Ctrl+S'"
      type="button"
      class="flex items-center gap-1 transition-colors hover:text-surface-700"
      :class="canvas.recentlySaved.value ? 'text-primary-600' : 'text-surface-400'"
      @click="canvas.exportProject"
    >
      <i
        class="pi text-[10px]"
        :class="canvas.recentlySaved.value ? 'pi-check-circle' : 'pi-save'"
      />
      <span class="text-[11px]">{{ savedAgo }}</span>
    </button>

    <!-- RIGHT: help. -->
    <button
      v-tooltip.top="'Горячие клавиши · ? или F1'"
      type="button"
      class="ml-auto flex items-center gap-1 text-surface-400 hover:text-surface-700 transition-colors"
      @click="ui.openHelp"
    >
      <i class="pi pi-question-circle text-sm" />
      <kbd class="px-1 py-0.5 bg-surface-100 rounded text-[10px] font-mono">F1</kbd>
    </button>
  </footer>
</template>
