<script setup>
/**
 * Название и описание активной формы — в холостом инспекторе (ничего не выделено).
 *
 * В стор пишется на каждый ввод, а не по blur: поля живут в ветке «ничего не
 * выделено», и клик по элементу холста снимает её раньше blur — набранное терялось
 * бы. Мету это не гоняет: её пишет отложенный вотчер useAutosave.
 *
 * Поле держит сырой ввод, стор — нормализованный: иначе trim съедал бы пробел между
 * словами прямо при наборе. Из стора поле перечитывается при смене формы и когда там
 * не то, что даёт ввод (импорт, возврат из корзины).
 */
import { ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useCanvas } from '../composables/useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import {
  FORM_DESCRIPTION_MAX,
  FORM_TITLE_MAX,
  normalizeFormDescription,
  normalizeFormTitle,
} from '../utils/formIds'

const canvas = useCanvas()
const workspace = useWorkspaceStore()

/** Черновик поля над текстом формы из стора (`read`), запись — через `write`. */
function formTextDraft(read, write, normalize) {
  const draft = ref(read())
  watch(
    () => workspace.activeFormId,
    () => (draft.value = read())
  )
  watch(read, (value) => {
    if (normalize(draft.value) !== value) draft.value = value
  })
  return {
    draft,
    input(value) {
      draft.value = value ?? ''
      if (write(workspace.activeFormId, draft.value)) canvas.markDirty()
    },
    blur() {
      draft.value = read()
    },
  }
}

const title = formTextDraft(
  () => workspace.activeFormTitle,
  workspace.setFormTitle,
  normalizeFormTitle
)
const description = formTextDraft(
  () => workspace.activeFormDescription,
  workspace.setFormDescription,
  normalizeFormDescription
)
const titleDraft = title.draft
const descriptionDraft = description.draft
</script>

<template>
  <div class="space-y-3">
    <div>
      <label for="tms-form-title" class="tms-field-label mb-2 block">Название формы</label>
      <InputText
        id="tms-form-title"
        :model-value="titleDraft"
        :placeholder="workspace.activeFormId || ''"
        :maxlength="FORM_TITLE_MAX"
        size="small"
        class="w-full"
        @update:model-value="title.input"
        @blur="title.blur"
        @keyup.enter="$event.target.blur()"
      />
    </div>
    <div>
      <label for="tms-form-description" class="tms-field-label mb-2 block">Описание формы</label>
      <Textarea
        id="tms-form-description"
        :model-value="descriptionDraft"
        :maxlength="FORM_DESCRIPTION_MAX"
        rows="2"
        auto-resize
        size="small"
        class="w-full"
        @update:model-value="description.input"
        @blur="description.blur"
      />
    </div>
  </div>
</template>
