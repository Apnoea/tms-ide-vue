<script setup>
/**
 * Выравнивание и распределение выделенных ячеек: три подписанные категории (по
 * горизонтали, по вертикали, распределение) кнопками 18×18 с рисованной миниатюрой
 * раскладки — глифа для «выровнять по левому краю» в наборе иконок нет.
 *
 * Геометрию считает `useAlign` у вызывающего; сюда приходит только раскладка кнопок.
 */
defineProps({
  /** Строки-категории: `{ label, kind, buttons: [{ op, tip, rects }] }`. */
  rows: { type: Array, required: true },
  /** Распределение требует ≥3 ячеек — его кнопки гасим, а не скрываем. */
  canDistribute: { type: Boolean, default: false },
})

const emit = defineEmits(['align', 'distribute'])
</script>

<template>
  <div class="space-y-2.5">
    <div v-for="row in rows" :key="row.label" class="flex items-center gap-3">
      <span class="text-[11px] uppercase tracking-wider text-surface-500 shrink-0">
        {{ row.label }}
      </span>
      <div class="ml-auto flex items-center gap-1">
        <button
          v-for="btn in row.buttons"
          :key="btn.op"
          type="button"
          v-tooltip.bottom="btn.tip"
          :disabled="row.kind === 'distribute' && !canDistribute"
          class="flex h-8 w-8 items-center justify-center rounded border border-surface-300 text-surface-700 transition-colors hover:border-primary-400 hover:bg-surface-50 hover:text-surface-900 disabled:cursor-not-allowed disabled:opacity-40"
          @click="emit(row.kind === 'distribute' ? 'distribute' : 'align', btn.op)"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
            <rect
              v-for="(r, i) in btn.rects"
              :key="i"
              :x="r.x"
              :y="r.y"
              :width="r.w"
              :height="r.h"
              :rx="r.rx"
              :opacity="r.o"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
