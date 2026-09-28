<script setup>
/**
 * Название активной формы — в холостом инспекторе (ничего не выделено).
 *
 * В стор пишется на каждый ввод, а не по blur: поле живёт в ветке «ничего не
 * выделено», и клик по элементу холста снимает его раньше blur — набранное терялось
 * бы. Мету это не гоняет: её пишет отложенный вотчер useAutosave.
 *
 * Поле держит сырой ввод, стор — нормализованный: иначе trim съедал бы пробел между
 * словами прямо при наборе. Из стора поле перечитывается при смене формы и когда там
 * не то, что даёт ввод (импорт, возврат из корзины).
 */
import { ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import { useCanvas } from '../composables/useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { FORM_TITLE_MAX, normalizeFormTitle } from '../constants/ids'

const canvas = useCanvas()
const workspace = useWorkspaceStore()

const draft = ref(workspace.activeFormTitle)
watch(
  () => workspace.activeFormId,
  () => (draft.value = workspace.activeFormTitle)
)
watch(
  () => workspace.activeFormTitle,
  (title) => {
    if (normalizeFormTitle(draft.value) !== title) draft.value = title
  }
)

function onInput(value) {
  draft.value = value ?? ''
  if (workspace.setFormTitle(workspace.activeFormId, draft.value)) canvas.markDirty()
}
</script>

<template>
  <div>
    <label for="tms-form-title" class="mb-2 block uppercase tracking-wider text-surface-500">
      Название формы
    </label>
    <InputText
      id="tms-form-title"
      :model-value="draft"
      :placeholder="workspace.activeFormId || ''"
      :maxlength="FORM_TITLE_MAX"
      size="small"
      class="w-full text-xs!"
      @update:model-value="onInput"
      @blur="draft = workspace.activeFormTitle"
      @keyup.enter="$event.target.blur()"
    />
  </div>
</template>
