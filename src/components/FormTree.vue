<script setup>
/**
 * Дерево форм проекта (навигатор, слева над палитрой). Иерархия — из
 * `workspace.formTree` (грузится из hierarchy.json проекта, см. useProject);
 * v1 только для чтения (без drag-перестройки). Клик по узлу — открыть форму,
 * карандаш — inline-rename, × — удаление, «+» в шапке — создать (падает последним
 * узлом в корень). Формы вне дерева → группа «Без иерархии»; узлы на
 * несуществующую форму рисуются битыми (серым).
 */
import { computed, ref, nextTick } from 'vue'
import InputText from 'primevue/inputtext'
import { useConfirm } from 'primevue/useconfirm'
import { useCanvas } from '../composables/useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

const canvas = useCanvas()
const workspace = useWorkspaceStore()
const confirm = useConfirm()

// Свёрнутые ветки (по id). По умолчанию всё раскрыто.
const collapsed = ref(new Set())
function toggle(id) {
  const s = new Set(collapsed.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  collapsed.value = s
}

function collectIds(nodes, set) {
  for (const n of nodes) {
    set.add(n.id)
    collectIds(n.children, set)
  }
}

// Плоский список строк для рендера (DFS с учётом свёрнутости) + группа orphan'ов.
const rows = computed(() => {
  const existing = new Set(workspace.formIds)
  const inTree = new Set()
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const hasChildren = !!n.children?.length
      if (hasChildren) collectIds(n.children, inTree) // все потомки — «в дереве»
      inTree.add(n.id)
      out.push({ kind: 'form', id: n.id, depth, hasChildren, broken: !existing.has(n.id) })
      if (hasChildren && !collapsed.value.has(n.id)) walk(n.children, depth + 1)
    }
  }
  walk(workspace.formTree, 0)
  const orphans = workspace.formIds.filter((id) => !inTree.has(id))
  if (orphans.length) {
    out.push({ kind: 'group', label: 'Без иерархии' })
    for (const id of orphans)
      out.push({ kind: 'form', id, depth: 0, hasChildren: false, broken: false })
  }
  return out
})

// ─── Inline-переименование ───
const editingId = ref(null)
const editValue = ref('')
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
  editingId.value = null
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
  <div class="flex shrink-0 flex-col border-b border-surface-200 bg-surface-50">
    <div
      class="min-h-14 px-4 border-b border-surface-200 bg-surface-0 flex items-center justify-between gap-2"
    >
      <h2 class="text-sm font-semibold uppercase tracking-wide text-surface-900">Формы</h2>
      <button
        type="button"
        v-tooltip.bottom="'Создать форму'"
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-surface-400 hover:bg-surface-200 hover:text-surface-700"
        @click="canvas.createForm"
      >
        <i class="pi pi-plus !text-[10px]" />
      </button>
    </div>

    <div class="max-h-[40vh] overflow-auto p-1">
      <template v-for="(row, i) in rows" :key="row.kind === 'form' ? `f:${row.id}` : `g:${i}`">
        <!-- Заголовок группы «Без иерархии» -->
        <div
          v-if="row.kind === 'group'"
          class="mt-2 px-2 py-1 text-[10px] uppercase tracking-wider text-surface-400"
        >
          {{ row.label }}
        </div>

        <!-- Строка формы -->
        <div
          v-else
          class="group flex items-center gap-1 rounded transition-colors"
          :class="row.id === workspace.activeFormId ? 'bg-surface-200/70' : 'hover:bg-surface-100'"
          :style="{ paddingLeft: `${row.depth * 14}px` }"
        >
          <!-- Шеврон свёртки / спейсер под выравнивание -->
          <button
            v-if="row.hasChildren"
            type="button"
            class="flex h-5 w-5 shrink-0 items-center justify-center text-surface-400 hover:text-surface-700"
            @click="toggle(row.id)"
          >
            <i
              class="pi !text-[10px]"
              :class="collapsed.has(row.id) ? 'pi-chevron-right' : 'pi-chevron-down'"
            />
          </button>
          <span v-else class="w-5 shrink-0" aria-hidden="true"></span>

          <InputText
            v-if="editingId === row.id"
            :ref="setRenameInput"
            v-model="editValue"
            size="small"
            class="relative z-10 my-0.5 w-full !py-0.5 font-mono !text-xs"
            @keyup.enter="commitRename"
            @keyup.esc="cancelRename"
            @blur="commitRename"
          />
          <template v-else>
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left text-xs font-mono truncate"
              :class="[
                row.broken
                  ? 'text-surface-400 line-through cursor-default'
                  : row.id === workspace.activeFormId
                    ? 'text-surface-900 font-medium'
                    : 'text-surface-600',
              ]"
              :title="row.broken ? `${row.id} — форма отсутствует` : row.id"
              @click="!row.broken && canvas.selectForm(row.id)"
            >
              <i
                class="pi pi-file !text-[10px] shrink-0"
                :class="row.id === workspace.activeFormId ? 'text-primary-500' : 'text-surface-400'"
              />
              <span class="truncate">{{ row.id }}</span>
            </button>
            <button
              v-if="!row.broken"
              type="button"
              v-tooltip.bottom="'Переименовать'"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-surface-400 opacity-0 hover:bg-surface-200 hover:text-surface-700 group-hover:opacity-100"
              @click.stop="startRename(row.id)"
            >
              <i class="pi pi-pencil !text-[10px]" />
            </button>
            <button
              v-if="!row.broken && workspace.formIds.length > 1"
              type="button"
              v-tooltip.bottom="'Удалить форму'"
              class="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-surface-400 opacity-0 hover:bg-surface-200 hover:text-surface-700 group-hover:opacity-100"
              @click.stop="confirmDelete($event, row.id)"
            >
              <i class="pi pi-times !text-[10px]" />
            </button>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>
