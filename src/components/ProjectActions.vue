<script setup>
/**
 * Проектный I/O в топ-баре. Проект — единый .zip: «Открыть» по клику открывает
 * файловый picker для .zip, «Экспорт» скачивает проект одним .zip. Tag-list —
 * отдельный контрол (TagListControl). Оркестрация — в CanvasPane через canvas.* .
 */
import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import Button from 'primevue/button'
import { useConfirm } from 'primevue/useconfirm'
import { useNotify } from '../composables/useNotify'
import { useCanvas } from '../composables/useCanvas'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { confirmDanger } from '../utils/confirmDanger'

const canvas = useCanvas()
const workspace = useWorkspaceStore()
const notify = useNotify()
const confirm = useConfirm()

// Ref на кнопку «Открыть» — target ConfirmPopup замены проекта.
const openBtnRef = ref(null)
// Идёт импорт (распаковка → parse → запись в IDB): спиннер + дизейбл, чтобы не
// запустить вторую операцию поверх.
const importing = ref(false)

// Ctrl+O (из CanvasPane) → импорт проекта из архива.
useEventListener(window, 'tms-open-project', () => openProject())

// Импорт проекта (.zip). Подтверждаем замену текущей работы; picker открывается
// внутри accept-клика (свежая user-activation для FSA). Оркестрация — в CanvasPane.
async function openProject() {
  // Контент считаем по ВСЕМУ проекту, а не только по активной форме: 10 полных
  // форм с пустой активной иначе прошли бы без confirm, и replaceProject затёр бы
  // их безвозвратно. >1 формы = многоформенный проект (подтверждаем всегда), либо
  // есть контент в текущей форме.
  const hasContent =
    workspace.formIds.length > 1 || canvas.cellsCount.value + canvas.linksCount.value > 0
  if (hasContent) {
    const accepted = await new Promise((resolve) => {
      confirmDanger(confirm, {
        // primary, не danger: открытие проекта не разрушающее (текущая работа
        // уже в IDB), это просто подтверждение замены.
        severity: 'primary',
        target: openBtnRef.value?.$el ?? null,
        message: 'Открыть проект? Текущая работа будет заменена.',
        acceptLabel: 'Открыть',
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      })
    })
    if (!accepted) return
  }
  importing.value = true
  try {
    await canvas.importProjectFromArchive()
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
      ref="openBtnRef"
      v-tooltip.bottom="'Открыть проект (.zip) · Ctrl+O'"
      icon="pi pi-folder-open"
      label="Открыть"
      severity="secondary"
      text
      size="small"
      :loading="importing"
      :disabled="importing"
      @click="openProject"
    />
    <!-- Экспорт — главное действие (вывод проекта): лёгкий primary-акцент
         (cyan-текст) против серого «Открыть». Только .zip. Невыгруженные правки
         (dirtySinceExport) в UI не индицируются — флаг нужен только десктопной
         оболочке для подтверждения закрытия окна; тултип о них упоминает. -->
    <Button
      v-tooltip.bottom="
        canvas.dirtySinceExport.value
          ? 'Есть изменения, не выгруженные в .zip · Ctrl+S'
          : 'Экспортировать проект (.zip) · Ctrl+S'
      "
      icon="pi pi-download"
      label="Экспорт"
      severity="primary"
      text
      size="small"
      :disabled="importing"
      @click="canvas.exportProjectToArchive"
    />
  </div>
</template>
