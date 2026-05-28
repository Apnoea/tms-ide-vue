<script setup>
import { watch, onMounted, onBeforeUnmount } from 'vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'

import AppHeader from './components/AppHeader.vue'
import AppFooter from './components/AppFooter.vue'
import PalettePane from './components/PalettePane.vue'
import CanvasPane from './components/CanvasPane.vue'
import InspectorPane from './components/InspectorPane.vue'
import HelpDialog from './components/HelpDialog.vue'

import { useUiStore } from './stores/useUiStore'
import { storeToRefs } from 'pinia'

const ui = useUiStore()
const { darkMode } = storeToRefs(ui)

// Синхронизация PrimeVue / Tailwind dark mode с DOM (через .dark на html)
function applyDarkMode(isDark) {
  if (isDark) document.documentElement.classList.add('dark')
  else document.documentElement.classList.remove('dark')
}

// ? и F1 — открыть справку. Глобальный хоткей, игнорируем если фокус в инпуте.
// F1 нужен потому что `?` на русской раскладке = Shift+, и не сразу очевиден.
function onGlobalKeyDown(event) {
  if (event.key !== '?' && event.key !== 'F1') return
  const t = event.target
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable)
  ) {
    return
  }
  event.preventDefault()
  ui.openHelp()
}

onMounted(() => {
  applyDarkMode(darkMode.value)
  window.addEventListener('keydown', onGlobalKeyDown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeyDown))
watch(darkMode, applyDarkMode)
</script>

<template>
  <div class="h-screen flex flex-col bg-surface-0 dark:bg-surface-950 text-surface-900 dark:text-surface-50">
    <AppHeader />

    <!-- Внешний splitter управляет только палитрой vs остальной частью.
         Внутренний — canvas vs inspector. Так resize правого gutter'а не сдвигает палитру
         (баг 3-панельного PrimeVue Splitter с state-storage). -->
    <Splitter
      class="flex-1 min-h-0 !border-0 !rounded-none"
      :gutter-size="6"
      state-key="tms-ide:splitter-outer:v1"
      state-storage="local"
    >
      <SplitterPanel :size="18" :min-size="12">
        <PalettePane />
      </SplitterPanel>

      <SplitterPanel :size="82" :min-size="60">
        <Splitter
          class="h-full !border-0 !rounded-none"
          :gutter-size="6"
          state-key="tms-ide:splitter-inner:v1"
          state-storage="local"
        >
          <SplitterPanel :size="73" :min-size="40">
            <CanvasPane />
          </SplitterPanel>
          <SplitterPanel :size="27" :min-size="15">
            <InspectorPane />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>
    </Splitter>

    <AppFooter />

    <Toast position="bottom-right" />
    <ConfirmDialog />
    <HelpDialog />
  </div>
</template>

<style>
/* Сплиттер PrimeVue по умолчанию ставит border-radius и фон — снимаем,
   чтобы вписывался в общий фрейм IDE без визуальных «коробочек». */
.p-splitter {
  background: transparent !important;
}
.p-splitter > .p-splitterpanel {
  overflow: hidden;
}
</style>
