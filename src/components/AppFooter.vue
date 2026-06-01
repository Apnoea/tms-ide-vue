<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useCanvas } from '../composables/useCanvas'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { storeToRefs } from 'pinia'

const canvas = useCanvas()
const project = useProjectStore()
const ui = useUiStore()
const { tags } = storeToRefs(project)

// nowTick — bump'аем раз в секунду, чтобы relative time реактивно обновлялся.
// Альтернатива (вешать watch на lastSavedAt + setTimeout) усложнила бы код
// без выигрыша — индикатор и так редко перерисовывается.
const nowTick = ref(Date.now())
let tickInterval = null
onMounted(() => {
  tickInterval = setInterval(() => (nowTick.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (tickInterval) clearInterval(tickInterval)
})

// Текст про autosave: либо «Сохраняется...» (короткий flash после save),
// либо «Сохранено · 12 сек назад» / «Сохранено · 2 мин назад» / «—» если
// сейв ещё не было (свежий запуск без autosave). Минуты округляем — секунды
// до 59, потом «N мин назад» (>60 минут редкость для autosave).
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
    class="px-4 py-1.5 border-t border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 flex items-center gap-4 text-xs text-surface-500 dark:text-surface-400 font-mono"
  >
    <!-- Левый блок: счётчики. Клик по ячейкам — выделить всё, провода/теги
         пассивные (выделение всех проводов мало кому нужно отдельно). -->
    <button
      v-tooltip.top="canvas.cellsCount.value > 0 ? 'Выделить все ячейки' : 'Ячеек на холсте нет'"
      type="button"
      class="flex items-center gap-1 hover:text-surface-700 dark:hover:text-surface-200 transition-colors disabled:opacity-50 disabled:cursor-default disabled:hover:text-inherit"
      :disabled="canvas.cellsCount.value === 0"
      @click="canvas.selectAllCells()"
    >
      <i class="pi pi-th-large text-[10px]" />
      {{ canvas.cellsCount.value }}
    </button>
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

    <!-- Autosave-индикатор: всегда показываем «когда последний раз сохранили»,
         плюс flash зелёной галочкой первые 1.5 сек после успешного save. -->
    <span
      class="flex items-center gap-1 transition-colors"
      :class="
        canvas.recentlySaved.value
          ? 'text-primary-600 dark:text-primary-300'
          : 'text-surface-400 dark:text-surface-500'
      "
      :title="canvas.lastSavedAt.value ? 'Автосохранение в localStorage' : 'Изменений ещё не было'"
    >
      <i
        class="pi text-[10px]"
        :class="canvas.recentlySaved.value ? 'pi-check-circle' : 'pi-save'"
      />
      <span class="text-[11px]">{{ savedAgo }}</span>
    </span>

    <!-- Правый блок: справка + версия -->
    <button
      v-tooltip.top="'Горячие клавиши · ? или F1'"
      type="button"
      class="ml-auto flex items-center gap-1 text-surface-400 dark:text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
      @click="ui.openHelp"
    >
      <i class="pi pi-question-circle text-sm" />
      <kbd class="px-1 py-0.5 bg-surface-100 dark:bg-surface-800 rounded text-[10px] font-mono">
        F1
      </kbd>
    </button>
    <span class="text-surface-400 dark:text-surface-500">tms-ide-vue · v0.1.0</span>
  </footer>
</template>
