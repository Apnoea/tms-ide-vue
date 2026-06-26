<script setup>
import { onMounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import { useNotify, TOAST_LIFE } from '../composables/useNotify'
import { useConfirm } from 'primevue/useconfirm'
import { useUiStore } from '../stores/useUiStore'
import { useProjectStore } from '../stores/useProjectStore'
import { storeToRefs } from 'pinia'
import * as fs from '../services/fileSystem'
import { parseTagList } from '../services/parsers'
import { nplural } from '../utils/plural'
import { idbGet, idbSet } from '../utils/idb'
import { useCanvas } from '../composables/useCanvas'

const ui = useUiStore()
const project = useProjectStore()
const canvas = useCanvas()
const notify = useNotify()
const confirm = useConfirm()
const { tags } = storeToRefs(project)

const IDB_HANDLE_KEY = 'tagListHandle'

// Ref на кнопку «Открыть проект» — target для ConfirmPopup.
const openProjectBtnRef = ref(null)
// Идёт импорт проекта (read-folder → parse → запись в IDB): спиннер на «Открыть»
// + дизейбл проектных кнопок, чтобы не запустить вторую операцию поверх.
const importing = ref(false)

async function loadParsedTagsFromHandle(handle) {
  const perm = await handle.queryPermission?.({ mode: 'read' })
  if (perm && perm !== 'granted') {
    const next = await handle.requestPermission({ mode: 'read' })
    if (next !== 'granted') {
      notify.warn('Нет доступа к файлу', 'Браузер отозвал разрешение, выберите файл заново')
      return null
    }
  }
  const content = await fs.getFileContentFromHandle(handle)
  if (!content) {
    notify.error('Tag-list', 'Не удалось прочитать файл', TOAST_LIFE.NORMAL)
    return null
  }
  const parsed = parseTagList(content)
  if (parsed.length === 0) {
    notify.warn('Tag-list', 'Файл пуст или не содержит валидных тегов')
    return null
  }
  return { parsed, content }
}

async function pickTagList() {
  try {
    const fileHandle = await fs.selectFile(ui.lastTagListPickerStartIn)
    if (!fileHandle) return
    const loaded = await loadParsedTagsFromHandle(fileHandle)
    if (!loaded) return

    project.setTags(loaded.parsed)
    await idbSet(IDB_HANDLE_KEY, fileHandle)
    // Сырой текст — с проектом (бандл на экспорте + переживает reload).
    await idbSet('project:tags', loaded.content)
    ui.setLastTagListPickerStartIn(fileHandle)

    notify.success(
      'Tag-list загружен',
      `${nplural(loaded.parsed.length, 'тег', 'тега', 'тегов')} из ${fileHandle.name}`,
      TOAST_LIFE.NORMAL
    )
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('[ProjectActions] Ошибка загрузки tag-list:', e)
    notify.error('Ошибка загрузки tag-list', e.message || String(e))
  }
}

// На mount пытаемся восстановить tag-list из запомненного file-handle (IDB).
// 'granted' permission → подгружаем автоматически; иначе (browser сбросил доступ)
// — просим выбрать файл заново кнопкой «Tag-list» (requestPermission требует
// user-gesture, отдельной кнопки обновления у нас нет).
async function tryRestoreTagListHandle() {
  const handle = await idbGet(IDB_HANDLE_KEY)
  if (!handle) return
  try {
    const perm = await handle.queryPermission?.({ mode: 'read' })
    if (perm === 'granted') {
      const content = await fs.getFileContentFromHandle(handle)
      if (!content) return
      const parsed = parseTagList(content)
      if (parsed.length === 0) return
      project.setTags(parsed)
      notify.info(
        'Tag-list восстановлен',
        `${nplural(parsed.length, 'тег', 'тега', 'тегов')} из ${handle.name}`,
        TOAST_LIFE.SHORT
      )
    } else {
      notify.warn(
        'Tag-list требует разрешения',
        `Нажмите «Tag-list» и выберите файл заново, чтобы дать доступ к ${handle.name}`,
        TOAST_LIFE.LONG
      )
    }
  } catch (e) {
    console.warn('[ProjectActions] Не удалось восстановить tag-list handle:', e)
  }
}

// Кастомное событие из CanvasPane (Ctrl+O хоткей) → импорт проекта.
// useEventListener авто-снимает на unmount.
useEventListener(window, 'tms-open-project', () => openProjectFolder())

onMounted(() => {
  tryRestoreTagListHandle()
})

// Сигнал из инспектора «Загрузить tag-list…» (см. ui.requestTagListLoad).
watch(
  () => ui.tagListLoadRequest,
  () => pickTagList()
)

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
    <Button
      v-tooltip.bottom="'Экспортировать проект · Ctrl+S'"
      icon="pi pi-download"
      label="Экспорт"
      severity="secondary"
      text
      size="small"
      :disabled="importing"
      @click="canvas.exportProjectToFolder"
    />

    <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>

    <Button
      v-tooltip.bottom="tags.length ? 'Заменить tag-list' : 'Загрузить tag-list'"
      icon="pi pi-tags"
      :severity="tags.length ? 'secondary' : 'primary'"
      :text="!!tags.length"
      label="Tag-list"
      size="small"
      :disabled="importing"
      @click="pickTagList"
    />
    <Badge v-if="tags.length" :value="tags.length" severity="secondary" size="small" />
  </div>
</template>
