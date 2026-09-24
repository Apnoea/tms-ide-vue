<script setup>
/**
 * Самодельная иконка из constants/icons: сетка 16×16, цвет — `currentColor` (его задаёт
 * кнопка или пункт меню). `mirror` отражает по горизонтали: поворот против часовой — то
 * же, что по часовой, зеркалом.
 */
defineProps({
  glyph: { type: Array, required: true },
  mirror: { type: Boolean, default: false },
})
</script>

<template>
  <svg
    viewBox="0 0 16 16"
    class="h-3.5 w-3.5"
    :class="{ '-scale-x-100': mirror }"
    aria-hidden="true"
  >
    <path
      v-for="(el, i) in glyph"
      :key="i"
      :d="el.d"
      :fill="el.mode === 'fill' ? 'currentColor' : 'none'"
      :stroke="el.mode === 'stroke' ? 'currentColor' : 'none'"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
