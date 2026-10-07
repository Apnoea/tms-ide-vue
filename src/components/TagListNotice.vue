<script setup>
/**
 * Предупреждение над «Анимациями» инспектора, пока tag-list не загружен: выбрать тег не
 * из чего. Одно на весь раздел — раньше та же подсказка повторялась в каждой карточке и
 * в тултипах полей. Поля тегов и кнопки «+ тег» при этом просто неактивны. Вид — штатный
 * `Message` (как у предупреждений в наборах и свойствах фигуры), тексты — как у пустого
 * пикера тегов.
 */
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useProjectStore } from '../stores/useProjectStore'
import { useTagList } from '../composables/useTagList'

const project = useProjectStore()
const { pickTagList } = useTagList()
</script>

<template>
  <Message v-if="!project.tags.length" severity="warn" size="small" :closable="false">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>Tag-list не загружен</span>
      <Button
        label="Загрузить tag-list"
        icon="pi pi-tags"
        severity="warn"
        text
        size="small"
        @click="pickTagList()"
      />
    </div>
  </Message>
</template>
