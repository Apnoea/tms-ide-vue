<script setup>
/**
 * Панель форм проекта — плоский список. Клик открывает форму на холсте, «+»
 * создаёт пустую, двойной клик / карандаш — inline-переименование, корзина —
 * удаление (с подтверждением). Оркестрацию (стор + IDB + перезагрузка холста)
 * держит useProject в CanvasPane, сюда проброшено через canvas.* .
 */
import { ref, nextTick } from 'vue'
import Badge from 'primevue/badge'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useConfirm } from 'primevue/useconfirm'
import { useCanvas } from '../composables/useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

const canvas = useCanvas()
const workspace = useWorkspaceStore()
const confirm = useConfirm()

// Inline-переименование: id редактируемой формы + черновик имени.
const editingId = ref(null)
const editValue = ref('')
// Функция-ref на input (v-if гарантирует один инстанс) — для авто-фокуса.
let renameInputEl = null
const setRenameInput = (el) => (renameInputEl = el)

async function startRename(id) {
  editingId.value = id
  editValue.value = id
  await nextTick()
  renameInputEl?.$el?.focus()
  renameInputEl?.$el?.select()
}

async function commitRename() {
  const oldId = editingId.value
  if (oldId == null) return
  const next = editValue.value
  editingId.value = null // выходим из режима до await — повторный blur не сработает
  if (next.trim() && next.trim() !== oldId) await canvas.renameForm(oldId, next)
}

function cancelRename() {
  editingId.value = null
}

function confirmDelete(event, id) {
  confirm.require({
    target: event.currentTarget,
    message: `Удалить форму «${id}»?`,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Удалить',
    rejectLabel: 'Отмена',
    acceptProps: { severity: 'danger', size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    accept: () => canvas.deleteForm(id),
  })
}
</script>

<template>
  <aside class="flex flex-col bg-surface-50 border-r border-b border-surface-200">
    <div class="min-h-16 px-4 py-3 border-b border-surface-200 flex items-center gap-2">
      <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Формы</h2>
      <Badge :value="workspace.formIds.length" severity="secondary" size="small" />
      <Button
        v-tooltip.bottom="'Создать форму'"
        icon="pi pi-plus"
        severity="secondary"
        text
        rounded
        size="small"
        class="ml-auto !w-7 !h-7"
        @click="canvas.createForm"
      />
    </div>

    <ul class="overflow-y-auto max-h-48 p-1.5 space-y-0.5">
      <li v-for="id in workspace.formIds" :key="id">
        <InputText
          v-if="editingId === id"
          :ref="setRenameInput"
          v-model="editValue"
          size="small"
          class="w-full !text-sm font-mono"
          @keyup.enter="commitRename"
          @keyup.esc="cancelRename"
          @blur="commitRename"
        />
        <div
          v-else
          class="group flex items-center rounded transition-colors"
          :class="id === workspace.activeFormId ? 'bg-primary-100' : 'hover:bg-surface-200'"
        >
          <button
            type="button"
            class="flex-1 min-w-0 text-left px-2 py-1.5 text-sm truncate"
            :class="
              id === workspace.activeFormId ? 'text-primary-700 font-medium' : 'text-surface-700'
            "
            :title="id"
            @click="canvas.selectForm(id)"
            @dblclick="startRename(id)"
          >
            {{ id }}
          </button>
          <Button
            v-tooltip.bottom="'Переименовать'"
            icon="pi pi-pencil"
            severity="secondary"
            text
            size="small"
            class="!p-1 !w-6 !h-6 opacity-0 group-hover:opacity-100"
            @click="startRename(id)"
          />
          <Button
            v-tooltip.bottom="
              workspace.formIds.length <= 1 ? 'Нельзя удалить единственную форму' : 'Удалить форму'
            "
            icon="pi pi-trash"
            severity="secondary"
            text
            size="small"
            class="!p-1 !w-6 !h-6 mr-1 opacity-0 group-hover:opacity-100"
            :disabled="workspace.formIds.length <= 1"
            @click="confirmDelete($event, id)"
          />
        </div>
      </li>
    </ul>
  </aside>
</template>
