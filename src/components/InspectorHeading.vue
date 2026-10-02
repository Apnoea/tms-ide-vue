<script setup>
/**
 * Заголовок инспектора — путь от корня к выделенному: «Инспектор › Символ» на холсте,
 * «Символ › Фигура» в редакторе. Корень при выделении — кнопка: клик снимает выделение
 * и возвращает к свойствам корня (форма на холсте, символ в редакторе), как Esc.
 */
defineProps({
  root: { type: String, required: true },
  /** Что выделено; null — ничего, заголовок — один корень. */
  leaf: { type: String, default: null },
  /** Уточнение после листа: «выделено: 3». В узкой панели сокращается первым. */
  note: { type: String, default: null },
  /** Подсказка кнопки-корня: куда она возвращает. */
  backTip: { type: String, default: '' },
})

defineEmits(['back'])
</script>

<template>
  <h2
    class="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold uppercase tracking-wide text-surface-900"
  >
    <button
      v-if="leaf"
      v-tooltip.bottom="backTip"
      type="button"
      class="shrink-0 cursor-pointer uppercase tracking-wide text-surface-400 hover:text-surface-700"
      @click="$emit('back')"
    >
      {{ root }}
    </button>
    <span v-else class="shrink-0">{{ root }}</span>
    <template v-if="leaf">
      <span class="text-surface-300">›</span>
      <span class="truncate">{{ leaf }}</span>
      <span
        v-if="note"
        :title="note"
        class="shrink-[10] truncate text-xs font-normal normal-case tracking-normal text-surface-500"
      >
        {{ note }}
      </span>
    </template>
  </h2>
</template>
