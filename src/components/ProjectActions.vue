<script setup>
import { onMounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import Button from 'primevue/button'
import { useNotify, TOAST_LIFE } from '../composables/useNotify'
import { useConfirm } from 'primevue/useconfirm'
import { useUiStore } from '../stores/useUiStore'
import { useProjectStore } from '../stores/useProjectStore'
import { storeToRefs } from 'pinia'
import * as fs from '../services/fileSystem'
import { parseTagList } from '../services/parsers'
import { nplural } from '../utils/plural'
import { idbGet, idbSet, idbDel } from '../utils/idb'
import { useCanvas } from '../composables/useCanvas'

const ui = useUiStore()
const project = useProjectStore()
const canvas = useCanvas()
const notify = useNotify()
const confirm = useConfirm()
const { tags, tagListHandle } = storeToRefs(project)

const IDB_HANDLE_KEY = 'tagListHandle'

// Ref на кнопку «Открыть проект» — target для ConfirmPopup.
const openProjectBtnRef = ref(null)

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
    project.setTagListHandle(fileHandle)
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

function unloadTagList() {
  project.clearTagList()
  idbDel(IDB_HANDLE_KEY)
  idbDel('project:tags') // иначе теги «вернутся» из проекта на следующем restore
  notify.info('Tag-list сброшен', 'Привязки на холсте сохранены, но выбрать новые теги пока нельзя')
}

// На mount пытаемся восстановить tag-list-handle из IDB. 'granted' permission
// → автоматически подгружаем; 'prompt' → ставим handle + просим нажать refresh
// (requestPermission требует user-gesture).
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
      project.setTagListHandle(handle)
      notify.info(
        'Tag-list восстановлен',
        `${nplural(parsed.length, 'тег', 'тега', 'тегов')} из ${handle.name}`,
        TOAST_LIFE.SHORT
      )
    } else {
      project.setTagListHandle(handle)
      notify.warn(
        'Tag-list требует разрешения',
        `Нажми обновить — браузер запросит доступ к ${handle.name}`,
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
  try {
    await canvas.importProject()
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('[ProjectActions] Ошибка импорта проекта:', e)
    notify.error('Ошибка импорта проекта', e.message || String(e))
  }
}

async function refreshTagList() {
  const handle = tagListHandle.value
  if (!handle) return
  try {
    const loaded = await loadParsedTagsFromHandle(handle)
    if (!loaded) return
    const before = tags.value.length
    project.setTags(loaded.parsed)
    await idbSet('project:tags', loaded.content)
    const diff = loaded.parsed.length - before
    notify.success(
      'Tag-list обновлён',
      `${nplural(loaded.parsed.length, 'тег', 'тега', 'тегов')}${diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}`,
      TOAST_LIFE.NORMAL
    )
  } catch (e) {
    console.error('[ProjectActions] Ошибка рефреша tag-list:', e)
    notify.error('Не удалось обновить tag-list', e.message || String(e))
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
      @click="openProjectFolder"
    />
    <Button
      v-tooltip.bottom="'Экспортировать проект · Ctrl+S'"
      icon="pi pi-download"
      label="Экспорт"
      severity="secondary"
      text
      size="small"
      @click="canvas.exportProjectToFolder"
    />

    <div class="w-px h-5 bg-surface-200 mx-1" aria-hidden="true"></div>

    <Button
      v-tooltip.bottom="tags.length ? `Tag-list · ${tags.length} тегов` : 'Загрузить tag-list'"
      icon="pi pi-tags"
      :severity="tags.length ? 'secondary' : 'primary'"
      :text="!!tags.length"
      size="small"
      :label="tags.length ? undefined : 'Tag-list'"
      @click="pickTagList"
    />
    <Button
      v-if="tagListHandle"
      v-tooltip.bottom="'Перечитать tag-list'"
      icon="pi pi-refresh"
      severity="secondary"
      text
      rounded
      size="small"
      @click="refreshTagList"
    />
    <Button
      v-if="tags.length"
      v-tooltip.bottom="'Сбросить tag-list'"
      icon="pi pi-times"
      severity="secondary"
      text
      rounded
      size="small"
      @click="unloadTagList"
    />
  </div>
</template>
