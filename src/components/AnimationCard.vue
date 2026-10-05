<script setup>
/**
 * Карточка анимации в инспекторах: шапка — иконка, заголовок и уточнение, справа —
 * действия блока (слот `actions`), под ней — тело (слот по умолчанию). Одна разметка у
 * блоков холста (состояние, значение, зависимость, диапазоны) и редактора символов.
 */
defineProps({
  /** Классы иконки целиком, с цветом: `pi pi-sitemap text-purple-500`. */
  icon: { type: String, required: true },
  title: { type: String, required: true },
  /** Уточнение после заголовка мелким: «по булеву тегу», «к состоянию». */
  hint: { type: String, default: '' },
})
</script>

<template>
  <div class="tms-card">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i :class="icon" />
      <div class="flex items-baseline gap-1.5 min-w-0">
        <span class="text-xs font-medium text-surface-700">{{ title }}</span>
        <span v-if="hint" class="tms-hint truncate">{{ hint }}</span>
      </div>
      <div v-if="$slots.actions" class="ml-auto flex items-center">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </div>
</template>
