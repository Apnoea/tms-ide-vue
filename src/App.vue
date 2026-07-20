<script setup>
import { useEventListener } from '@vueuse/core'
import Toast from 'primevue/toast'
import ConfirmPopup from 'primevue/confirmpopup'

import StatusBar from './components/StatusBar.vue'
import ProjectActions from './components/ProjectActions.vue'
import TagListControl from './components/TagListControl.vue'
import FormTree from './components/FormTree.vue'
import PalettePane from './components/PalettePane.vue'
import CanvasPane from './components/CanvasPane.vue'
import StencilEditor from './components/StencilEditor.vue'
import InspectorPane from './components/InspectorPane.vue'
import HelpDialog from './components/HelpDialog.vue'

import { useUiStore } from './stores/useUiStore'
import { useWorkspaceStore } from './stores/useWorkspaceStore'
import { useCanvas } from './composables/useCanvas'

const ui = useUiStore()
const workspace = useWorkspaceStore()
const canvas = useCanvas()

// beforeunload-гард только при saveError: запись в IndexedDB не проходит (квота /
// приватный режим), autosave не спасает → закрытие вкладки теряет всё. В обычном
// режиме (autosave пишет) не мешаем — данные уже в IDB, потери нет.
useEventListener(window, 'beforeunload', (e) => {
  if (!canvas.saveError.value) return
  e.preventDefault()
  e.returnValue = ''
})

// ? и F1 — открыть справку. Глобальный хоткей, игнорируем фокус в инпуте.
// F1 нужен потому что `?` на русской раскладке = Shift+, и не сразу очевиден.
useEventListener(window, 'keydown', (event) => {
  if (event.key !== '?' && event.key !== 'F1') return
  const t = event.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return
  }
  event.preventDefault()
  ui.openHelp()
})
</script>

<template>
  <div class="h-screen flex flex-col bg-surface-100 text-surface-900">
    <!-- Проектный I/O — здесь, а не в тулбаре холста; дерево форм — в левой панели. -->
    <div class="flex items-stretch gap-2 px-2 py-1.5">
      <div class="w-[380px] shrink-0 flex items-center gap-2 px-2 min-w-0">
        <i class="pi pi-sitemap text-primary-500 shrink-0" />
        <span class="text-sm font-bold tracking-tight shrink-0">TMS IDE</span>
        <!-- Имя открытого проекта (= имя .zip). Отделяет активный проект от
             «свежего»; при импорте разных архивов видно, что именно загружено. -->
        <span class="text-surface-300 shrink-0" aria-hidden="true">·</span>
        <span
          class="min-w-0 truncate text-sm text-surface-500"
          :title="workspace.projectName || 'Проект ещё не сохранён в файл'"
        >
          {{ workspace.projectName || 'Без названия' }}
        </span>
      </div>
      <div class="flex-1 min-w-0 flex items-center gap-2 px-2">
        <ProjectActions />
        <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>
        <TagListControl />
      </div>
      <div class="w-[420px] shrink-0 flex items-center px-2">
        <StatusBar />
      </div>
    </div>

    <!-- Без ресайза между колонками; тень отделяет карточки от общего surface-100. -->
    <!-- Пока открыт редактор стенсилов: левую панель (формы/палитра) гейтим
         (inert), чтобы drag/переключение формы не уходили в скрытый под оверлеем
         холст. Правую (инспектор) НЕ гейтим — там свойства стенсила (StencilInspector),
         с ней работают. Оверлей физически накрывает только холст. -->
    <!-- Идёт проектная операция (экспорт/импорт/переключение формы/CRUD): всю
         область редактирования гейтим `inert` + затемняем, чтобы клики/правки
         (overlay-кнопки, контекст-меню, инспектор, drag) не уехали под ключ чужой
         формы — живой граф между await'ами держит другую форму (ui.projectBusy). -->
    <div
      class="flex-1 min-h-0 flex gap-2 px-2 pb-2 transition-opacity"
      :class="{ 'opacity-60': ui.projectBusy }"
      :inert="ui.projectBusy"
    >
      <div
        class="w-[380px] shrink-0 rounded-lg overflow-hidden shadow-md flex flex-col transition-opacity"
        :class="{ 'pointer-events-none opacity-60': ui.stencilEditorOpen }"
        :inert="ui.stencilEditorOpen"
      >
        <FormTree />
        <PalettePane />
      </div>
      <!-- Редактор стенсилов — оверлей поверх холста (relative-контейнер). CanvasPane
           остаётся смонтированным под ним: paper/graph не пересоздаются. -->
      <div class="flex-1 min-w-0 rounded-lg overflow-hidden shadow-md relative">
        <CanvasPane />
        <StencilEditor v-if="ui.stencilEditorOpen" class="absolute inset-0 z-20" />
      </div>
      <div class="w-[420px] shrink-0 rounded-lg overflow-hidden shadow-md">
        <InspectorPane />
      </div>
    </div>

    <Toast position="bottom-right" />
    <ConfirmPopup />
    <HelpDialog />
  </div>
</template>
