<script setup>
/**
 * Строка пункта контекстного меню (слот `#item` у PrimeVue ContextMenu) — общая для меню
 * холста и редактора символов. Сверх стандартной рисует клавишу справа (`item.shortcut`):
 * вписанная в подпись, она сливалась с текстом. Классы PrimeVue приходят в `bind` (props
 * слота) — вид, ховер и клавиатурная навигация остаются штатными.
 */
defineProps({
  item: { type: Object, required: true },
  bind: { type: Object, required: true },
  hasSubmenu: { type: Boolean, default: false },
})
</script>

<template>
  <a v-bind="bind.action">
    <span v-if="item.icon" v-bind="bind.icon" :class="item.icon" />
    <span v-bind="bind.label">{{ item.label }}</span>
    <span v-if="item.shortcut" class="ml-auto pl-6 font-mono text-[11px] text-surface-400">
      {{ item.shortcut }}
    </span>
    <i v-if="hasSubmenu" class="pi pi-angle-right" v-bind="bind.submenuicon" />
  </a>
</template>
