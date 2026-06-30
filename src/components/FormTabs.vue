<script setup>
/**
 * Вкладки форм проекта (браузер-стиль) над холстом. Клик — открыть форму, «+» —
 * создать пустую, двойной клик по вкладке — inline-переименование, × на вкладке —
 * удаление (с подтверждением). Оркестрацию (стор + IDB + перезагрузка холста)
 * держит useProject в CanvasPane, сюда проброшено через canvas.* .
 */
import { ref, nextTick } from 'vue'
import InputText from 'primevue/inputtext'
import { useConfirm } from 'primevue/useconfirm'
import { useCanvas } from '../composables/useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

const canvas = useCanvas()
const workspace = useWorkspaceStore()
const confirm = useConfirm()

// Inline-переименование: id редактируемой вкладки + черновик имени.
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
  <!-- pl-4: первая вкладка отодвинута от левого края, чтобы левый флэр активной
       вкладки лёг на карточку холста, а не висел над зазором между панелями. -->
  <div class="flex items-stretch gap-1.5 h-10 pl-4 pr-1 pt-1.5 overflow-x-auto">
    <div
      v-for="(id, index) in workspace.formIds"
      :key="id"
      class="group relative flex items-center flex-shrink-0 pl-2.5 pr-2 pb-1 transition-colors"
      :class="
        id === workspace.activeFormId
          ? 'tms-tab-active bg-surface-0 rounded-t-lg'
          : index > 0 && workspace.formIds[index - 1] !== workspace.activeFormId
            ? 'tms-tab-divider'
            : ''
      "
    >
      <!-- Hover-подсветка неактивной вкладки: верх на уровне активной вкладки
           (top-0), но снизу зазор (bottom-1) — в отличие от активной не доходит
           до холста, а висит «пилюлей» (скруглена со всех сторон). Как у хрома. -->
      <span
        v-if="id !== workspace.activeFormId"
        class="absolute inset-x-0 top-0 bottom-1 rounded-lg bg-surface-200/70 opacity-0 transition-opacity group-hover:opacity-100"
      ></span>
      <!-- favicon-заглушка (форма) — для браузер-вкладочного вида. У активной —
           cyan-акцент, усиливает фокус. -->
      <i
        class="relative z-10 pi pi-file !text-[10px] shrink-0 cursor-pointer"
        :class="id === workspace.activeFormId ? 'text-primary-500' : 'text-surface-400'"
        @click="canvas.selectForm(id)"
        @dblclick="startRename(id)"
      />
      <InputText
        v-if="editingId === id"
        :ref="setRenameInput"
        v-model="editValue"
        size="small"
        class="relative z-10 !text-xs font-mono !py-0.5 w-32 ml-1.5"
        @keyup.enter="commitRename"
        @keyup.esc="cancelRename"
        @blur="commitRename"
      />
      <template v-else>
        <button
          type="button"
          class="relative z-10 px-1.5 py-1.5 text-xs font-mono truncate max-w-[160px]"
          :class="
            id === workspace.activeFormId ? 'text-surface-900 font-medium' : 'text-surface-600'
          "
          :title="id"
          @click="canvas.selectForm(id)"
          @dblclick="startRename(id)"
        >
          {{ id }}
        </button>
        <button
          v-if="workspace.formIds.length > 1"
          type="button"
          v-tooltip.bottom="'Удалить форму'"
          class="relative z-10 ml-0.5 w-5 h-5 flex items-center justify-center rounded-full text-surface-400 hover:bg-surface-200 hover:text-surface-700"
          @click.stop="confirmDelete($event, id)"
        >
          <i class="pi pi-times !text-[10px]" />
        </button>
      </template>
    </div>

    <!-- «+»: круглый hover, как у ×. Постоянный разделитель слева (по ховеру не
         прячется), кроме случая когда последняя вкладка активна — её флэр сам отделяет. -->
    <button
      type="button"
      v-tooltip.bottom="'Создать форму'"
      class="group relative flex w-9 flex-shrink-0 items-center justify-center pb-1 text-surface-500"
      :class="workspace.formIds.at(-1) === workspace.activeFormId ? '' : 'tms-add-divider'"
      @click="canvas.createForm"
    >
      <span
        class="flex h-7 w-7 items-center justify-center rounded-full transition-colors group-hover:bg-surface-200/70"
      >
        <i class="pi pi-plus !text-xs"></i>
      </span>
    </button>
  </div>
</template>

<style scoped>
/* «Обратный» бордер активной вкладки: вогнутые уголки у нижних краёв, которыми
 вкладка плавно вливается в карточку холста (хром-стиль). Псевдоэлементы залиты
 цветом вкладки/холста (surface-0); вырезанная радиальным градиентом дуга
 показывает общий фон (surface-100) — отсюда вогнутость. */
.tms-tab-active::before,
.tms-tab-active::after {
  content: '';
  position: absolute;
  bottom: 0;
  width: 8px;
  height: 8px;
  pointer-events: none;
}
.tms-tab-active::before {
  left: -8px;
  background: radial-gradient(circle at top left, transparent 7.5px, var(--p-surface-0) 8px);
}
.tms-tab-active::after {
  right: -8px;
  background: radial-gradient(circle at top right, transparent 7.5px, var(--p-surface-0) 8px);
}

/* Вертикальный разделитель слева (в середине гэпа). Сдвиг вверх на 2px
 компенсирует pb-1 ячейки — линия по центру контента, а не геометрии. */
.tms-tab-divider::before,
.tms-add-divider::before {
  content: '';
  position: absolute;
  left: -3px;
  top: 50%;
  height: 16px;
  width: 1px;
  transform: translateY(calc(-50% - 2px));
  background: var(--p-surface-300);
  transition: opacity 0.15s;
}
/* Прячем разделитель при ховере ВКЛАДКИ: свой (tms-tab-divider:hover) и у соседа
 справа (.group:hover + …, будь то вкладка или «+»). При ховере самой «+»
 разделитель остаётся — нет правила tms-add-divider:hover. */
.tms-tab-divider:hover::before,
.group:hover + .tms-tab-divider::before,
.group:hover + .tms-add-divider::before {
  opacity: 0;
}
</style>
