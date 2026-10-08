<script setup>
import Button from 'primevue/button'

/**
 * Выравнивание и распределение выделенных ячеек: три подписанные категории (по
 * горизонтали, по вертикали, распределение) кнопками PrimeVue (outlined, 32px — как
 * тулбарные) с рисованной миниатюрой раскладки в слоте иконки — глифа для «выровнять по
 * левому краю» в наборе иконок нет.
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
      <span class="tms-field-label shrink-0">
        {{ row.label }}
      </span>
      <div class="ml-auto flex items-center gap-1">
        <Button
          v-for="btn in row.buttons"
          :key="btn.op"
          v-tooltip.bottom="btn.tip"
          severity="secondary"
          outlined
          size="small"
          class="tms-icon-btn"
          :disabled="row.kind === 'distribute' && !canDistribute"
          @click="emit(row.kind === 'distribute' ? 'distribute' : 'align', btn.op)"
        >
          <template #icon>
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
          </template>
        </Button>
      </div>
    </div>
  </div>
</template>
