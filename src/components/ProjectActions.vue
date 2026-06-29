<script setup>
/**
 * Проектный I/O в топ-баре: «Открыть» (импорт папки проекта через FSA) и
 * «Экспорт» (запись в папку проекта). Tag-list — отдельный контрол у холста
 * (TagListControl). Оркестрация импорта/экспорта — в CanvasPane через canvas.* .
 */
import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import Button from 'primevue/button'
import { useConfirm } from 'primevue/useconfirm'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'

const canvas = useCanvas()
const notify = useNotify()
const confirm = useConfirm()

// Ref на кнопку «Открыть» — target для ConfirmPopup замены проекта.
const openProjectBtnRef = ref(null)
// Идёт импорт (read-folder → parse → запись в IDB): спиннер + дизейбл, чтобы не
// запустить вторую операцию поверх.
const importing = ref(false)

// Кастомное событие из CanvasPane (Ctrl+O хоткей) → импорт проекта.
useEventListener(window, 'tms-open-project', () => openProjectFolder())

// Импорт проекта-папки (формы + библиотека). Подтверждаем замену текущей
// работы; picker открывается внутри accept-клика (свежая user-activation для
// FSA). Оркестрация — в CanvasPane.importProject.
async function openProjectFolder() {
  const hasContent = canvas.cellsCount.value + canvas.linksCount.value > 0
  if (hasContent) {
    const accepted = await new Promise((resolve) => {
      confirm.require({
        target: openProjectBtnRef.value?.$el ?? null,
        message: 'Открыть проект? Текущая работа будет заменена.',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Открыть',
        rejectLabel: 'Отмена',
        acceptProps: { severity: 'primary', size: 'small' },
        rejectProps: { severity: 'secondary', text: true, size: 'small' },
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      })
    })
    if (!accepted) return
  }
  importing.value = true
  try {
    await canvas.importProject()
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('[ProjectActions] Ошибка импорта проекта:', e)
    notify.error('Ошибка импорта проекта', e.message || String(e))
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="flex items-center gap-1">
    <Button
      ref="openProjectBtnRef"
      v-tooltip.bottom="'Открыть проект · Ctrl+O'"
      icon="pi pi-folder-open"
      label="Открыть"
      severity="secondary"
      text
      size="small"
      :loading="importing"
      :disabled="importing"
      @click="openProjectFolder"
    />
    <!-- Экспорт — главное действие (вывод проекта): лёгкий primary-акцент
         (cyan-текст) против серого «Открыть». -->
    <Button
      v-tooltip.bottom="'Экспортировать проект · Ctrl+S'"
      icon="pi pi-download"
      label="Экспорт"
      severity="primary"
      text
      size="small"
      :disabled="importing"
      @click="canvas.exportProjectToFolder"
    />
  </div>
</template>
