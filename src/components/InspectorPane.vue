<script setup>
/**
 * Оболочка правой панели: единая точка монтирования, переключает контент по
 * режиму. Холст открыт → свойства ячейки (CanvasInspector); редактор стенсилов
 * открыт → свойства стенсила (StencilInspector). Рамку (aside/шапку/скролл)
 * держит каждый контент сам.
 */
import { useUiStore } from '../stores/useUiStore'
import CanvasInspector from './CanvasInspector.vue'
import StencilInspector from './StencilInspector.vue'

const ui = useUiStore()
</script>

<template>
  <StencilInspector v-if="ui.stencilEditorOpen" />
  <CanvasInspector v-else />
</template>
