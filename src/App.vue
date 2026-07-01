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
import InspectorPane from './components/InspectorPane.vue'
import HelpDialog from './components/HelpDialog.vue'

import { useUiStore } from './stores/useUiStore'

const ui = useUiStore()

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
    <!-- Верхняя полоса (h-10) по колонкам: лого (над формами/палитрой) │ проектные
         действия Открыть/Экспорт/Tag-list (над холстом) │ справка (над инспектором).
         Проектный I/O — здесь, а не в тулбаре холста; дерево форм — в левой панели. -->
    <div class="flex items-stretch gap-2 px-2 py-1.5">
      <div class="w-[380px] shrink-0 flex items-center gap-2 px-2">
        <i class="pi pi-sitemap text-primary-500 shrink-0" />
        <span class="text-sm font-bold tracking-tight">TMS IDE</span>
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

    <!-- Карточки: левая 380px (дерево форм + палитра стеком) / инспектор 420px,
         холст — остальное. Без ресайза. Отделяет от общего surface-100 тень. -->
    <div class="flex-1 min-h-0 flex gap-2 px-2 pb-2">
      <div class="w-[380px] shrink-0 rounded-lg overflow-hidden shadow-md flex flex-col">
        <FormTree />
        <PalettePane />
      </div>
      <div class="flex-1 min-w-0 rounded-lg overflow-hidden shadow-md">
        <CanvasPane />
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
