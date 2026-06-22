<script setup>
/**
 * Панель форм проекта — плоский список. Клик по форме открывает её на холсте
 * (через canvas.selectForm; оркестрацию переключения держит CanvasPane).
 * Состав форм задаётся снаружи (импорт проекта — Фаза 3), здесь только выбор.
 */
import { useCanvas } from '../composables/useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

const canvas = useCanvas()
const workspace = useWorkspaceStore()
</script>

<template>
  <aside class="flex flex-col bg-surface-50 border-r border-b border-surface-200">
    <div class="min-h-12 px-4 py-2 border-b border-surface-200 flex items-center">
      <h2 class="text-sm font-semibold text-surface-900 uppercase tracking-wide">Формы</h2>
    </div>

    <ul class="overflow-y-auto max-h-48 p-1.5 space-y-0.5">
      <li v-for="f in workspace.formList" :key="f.id">
        <button
          type="button"
          class="w-full text-left px-2 py-1.5 rounded text-sm truncate transition-colors"
          :class="
            f.id === workspace.activeFormId
              ? 'bg-primary-100 text-primary-700 font-medium'
              : 'text-surface-700 hover:bg-surface-200'
          "
          :title="f.name"
          @click="canvas.selectForm(f.id)"
        >
          {{ f.name }}
        </button>
      </li>
    </ul>
  </aside>
</template>
