<script setup>
import { useEventListener } from '@vueuse/core'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Toast from 'primevue/toast'
import ConfirmPopup from 'primevue/confirmpopup'

import AppFooter from './components/AppFooter.vue'
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
  <div class="h-screen flex flex-col bg-surface-0 text-surface-900">
    <!-- Внешний splitter управляет только палитрой vs остальной частью.
         Внутренний — canvas vs inspector. Так resize правого gutter'а не
         сдвигает палитру (баг 3-панельного PrimeVue Splitter с state-storage). -->
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
    <ConfirmPopup />
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
