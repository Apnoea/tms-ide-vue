<script setup>
/**
 * Оболочка правой панели: единая точка монтирования, переключает контент по
 * режиму. Идёт симуляция → значения тегов (SimulationPanel: правки схемы всё равно
 * не нужны, а значения нужны рядом со схемой); редактор символов открыт → свойства
 * символа (StencilInspector); иначе свойства ячейки (CanvasInspector). Рамку
 * (aside/шапку/скролл) держит каждый контент сам. Смена контента проявляется
 * (`tms-panel-in`).
 */
import { useUiStore } from '../stores/useUiStore'
import { useSimulation } from '../composables/useSimulation'
import { useCanvas } from '../composables/useCanvas'
import { useSelectionHeading } from '../composables/useSelectionHeading'
import CanvasInspector from './CanvasInspector.vue'
import StencilInspector from './StencilInspector.vue'
import SimulationPanel from './SimulationPanel.vue'

const ui = useUiStore()
const canvas = useCanvas()
const selectionLeaf = useSelectionHeading()
const { simulating, formTags, simValues, setTagValue, clearTagValues, selectedTags } =
  useSimulation()

// Уход синхронный: без хука Vue держит уходящую панель на время анимации, и две панели
// на миг встают в колонку вместе.
function leaveNow(_el, done) {
  done()
}
</script>

<template>
  <Transition enter-active-class="tms-panel-in" @leave="leaveNow">
    <SimulationPanel
      v-if="simulating && !ui.stencilEditorOpen"
      :tags="formTags"
      :values="simValues"
      :selected="selectedTags"
      :selection-leaf="selectionLeaf"
      @set-tag="setTagValue"
      @reset="clearTagValues"
      @clear-selection="canvas.clearSelection()"
    />
    <StencilInspector v-else-if="ui.stencilEditorOpen" />
    <CanvasInspector v-else />
  </Transition>
</template>
