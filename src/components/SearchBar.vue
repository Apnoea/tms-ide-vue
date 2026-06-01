<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useUiStore } from '../stores/useUiStore'
import { useCanvas } from '../composables/useCanvas'

/**
 * Плавающий поиск по схеме (Ctrl+F). Открывается из CanvasPane через
 * ui.openSearch(), монтируется как overlay в правом верхнем углу холста.
 *
 * Состояние поиска (query, matches, currentIdx) живёт в useCanvas — компонент
 * только редактирует query и листает match'и. Подсветка на холсте применяется
 * watch'ем в CanvasPane (см. tms-search-match/-current классы).
 */

const ui = useUiStore()
const canvas = useCanvas()

const inputRef = ref(null)

const query = computed({
  get: () => canvas.searchQuery.value,
  set: (v) => canvas.runSearch(v),
})

const total = computed(() => canvas.searchMatchIds.value.length)
const current = computed(() => (total.value === 0 ? 0 : canvas.searchCurrentIdx.value + 1))

onMounted(async () => {
  await nextTick()
  inputRef.value?.$el?.focus?.()
  inputRef.value?.$el?.select?.()
})

function close() {
  canvas.clearSearch()
  ui.closeSearch()
}

function next() {
  canvas.cycleSearchMatch(1)
}

function prev() {
  canvas.cycleSearchMatch(-1)
}

function onKeyDown(event) {
  // Enter / Shift+Enter — циклить совпадения, как в браузерном Ctrl+F
  if (event.key === 'Enter') {
    event.preventDefault()
    if (total.value === 0) return
    if (event.shiftKey) prev()
    else next()
    return
  }
  // Esc — закрыть поиск. Глобальный keydown в CanvasPane выходит на input-фокусе,
  // поэтому ловим тут локально.
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}
</script>

<template>
  <div
    class="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2 py-1.5 bg-surface-0 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded shadow-lg"
    @mousedown.stop
    @click.stop
  >
    <i class="pi pi-search text-surface-400 dark:text-surface-500 text-xs" aria-hidden="true" />
    <InputText
      ref="inputRef"
      v-model="query"
      size="small"
      placeholder="Поиск по тегу / тексту"
      class="!text-xs !w-56 !py-1"
      @keydown="onKeyDown"
    />
    <span
      class="text-[11px] font-mono tabular-nums min-w-[42px] text-center"
      :class="
        query && total === 0
          ? 'text-red-500 dark:text-red-400'
          : 'text-surface-500 dark:text-surface-400'
      "
    >
      {{ query ? `${current} / ${total}` : '—' }}
    </span>
    <Button
      v-tooltip.bottom="'Предыдущее · Shift+Enter / Shift+F3'"
      icon="pi pi-chevron-up"
      severity="secondary"
      text
      size="small"
      class="!w-7 !h-7 !p-0"
      :disabled="total === 0"
      @click="prev"
    />
    <Button
      v-tooltip.bottom="'Следующее · Enter / F3'"
      icon="pi pi-chevron-down"
      severity="secondary"
      text
      size="small"
      class="!w-7 !h-7 !p-0"
      :disabled="total === 0"
      @click="next"
    />
    <Button
      v-tooltip.bottom="'Закрыть · Esc'"
      icon="pi pi-times"
      severity="secondary"
      text
      size="small"
      class="!w-7 !h-7 !p-0"
      @click="close"
    />
  </div>
</template>
