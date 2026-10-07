<script setup>
/**
 * Карточка анимации в инспекторах: шапка — иконка, заголовок и уточнение, справа —
 * действия блока, под ней — тело (слот по умолчанию). Одна разметка у блоков холста
 * (состояние, значение, зависимость, диапазоны) и редактора символов.
 *
 * Типовые действия — вставить / копировать / очистить — рисует сама карточка: кнопка
 * есть, когда задан её тултип (`pasteTip`/`copyTip`/`clearTip`; пусто или `false` —
 * кнопки нет), клик уходит эмитом. Порядок и вид у всех карточек поэтому одинаковые.
 * Нетиповое действие — в слот `actions`, перед ними.
 */
import Button from 'primevue/button'

const props = defineProps({
  /** Классы иконки целиком, с цветом: `pi pi-sitemap text-purple-500`. */
  icon: { type: String, required: true },
  title: { type: String, required: true },
  /** Уточнение после заголовка мелким: «по булеву тегу», «к состоянию». */
  hint: { type: String, default: '' },
  pasteTip: { type: [String, Boolean], default: '' },
  copyTip: { type: [String, Boolean], default: '' },
  clearTip: { type: [String, Boolean], default: '' },
})

const emit = defineEmits(['paste', 'copy', 'clear'])

const ACTIONS = [
  { key: 'paste', icon: 'pi pi-clipboard' },
  { key: 'copy', icon: 'pi pi-copy' },
  { key: 'clear', icon: 'pi pi-times' },
]
const tipOf = (key) => props[`${key}Tip`] || ''
</script>

<template>
  <div class="tms-card">
    <div class="flex items-center gap-2 mb-2 min-h-6">
      <i :class="icon" />
      <div class="flex items-baseline gap-1.5 min-w-0">
        <span class="text-xs font-medium text-surface-700">{{ title }}</span>
        <span v-if="hint" class="tms-hint truncate">{{ hint }}</span>
      </div>
      <div
        v-if="$slots.actions || ACTIONS.some((a) => tipOf(a.key))"
        class="ml-auto flex items-center"
      >
        <slot name="actions" />
        <template v-for="a in ACTIONS" :key="a.key">
          <Button
            v-if="tipOf(a.key)"
            v-tooltip.bottom="tipOf(a.key)"
            :icon="a.icon"
            severity="secondary"
            text
            size="small"
            class="tms-row-btn"
            :data-action="a.key"
            @click="emit(a.key)"
          />
        </template>
      </div>
    </div>
    <slot />
  </div>
</template>
