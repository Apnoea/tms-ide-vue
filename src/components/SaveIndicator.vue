<script setup>
/**
 * Индикатор автосейва — чип слева-снизу холста (симметрично координатам справа).
 * По умолчанию только иконка состояния; по ховеру разворачивается «N мин назад».
 * Состояние autosave'а — в useCanvas (recentlySaved / lastSavedAt / saveError).
 * Клика-экспорта тут нет: экспорт — кнопка «Экспорт» в топ-баре и Ctrl+S.
 */
import { computed } from 'vue'
import { useTimestamp } from '@vueuse/core'
import { useCanvas } from '../composables/useCanvas'

const canvas = useCanvas()

// Bump раз в секунду для relative time. useTimestamp сам ставит/снимает interval.
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

// Приоритет: ошибка записи > свежий save-flash > idle.
const saveStateClass = computed(() =>
  canvas.saveError.value
    ? 'text-red-600'
    : canvas.recentlySaved.value
      ? 'text-primary-600'
      : 'text-surface-400'
)
const saveStateIcon = computed(() =>
  canvas.saveError.value
    ? 'pi-exclamation-triangle'
    : canvas.recentlySaved.value
      ? 'pi-check-circle'
      : 'pi-save'
)
</script>

<template>
  <div class="group absolute bottom-2 left-2 flex items-center gap-1.5 font-mono text-[11px]">
    <i class="pi text-[10px]" :class="[saveStateIcon, saveStateClass]" />
    <span class="hidden group-hover:inline" :class="saveStateClass">
      {{ canvas.saveError.value ? 'не сохранено' : savedAgo }}
    </span>
  </div>
</template>
