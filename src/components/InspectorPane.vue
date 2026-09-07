<script setup>
/**
 * Оболочка правой панели: единая точка монтирования, переключает контент по
 * режиму. Идёт симуляция → значения тегов (SimulationPanel: правки схемы всё равно
 * не нужны, а значения нужны рядом со схемой); редактор символов открыт → свойства
 * символа (StencilInspector); иначе свойства ячейки (CanvasInspector). Рамку
 * (aside/шапку/скролл) держит каждый контент сам.
 */
import { useUiStore } from '../stores/useUiStore'
import { useSimulation } from '../composables/useSimulation'
import CanvasInspector from './CanvasInspector.vue'
import StencilInspector from './StencilInspector.vue'
import SimulationPanel from './SimulationPanel.vue'

const ui = useUiStore()
const { simulating, formTags, simValues, setTagValue, clearTagValues, selectedTags } =
  useSimulation()
</script>

<template>
  <SimulationPanel
    v-if="simulating && !ui.stencilEditorOpen"
    :tags="formTags"
    :values="simValues"
    :selected="selectedTags"
    @set-tag="setTagValue"
    @reset="clearTagValues"
  />
  <StencilInspector v-else-if="ui.stencilEditorOpen" />
  <CanvasInspector v-else />
</template>
