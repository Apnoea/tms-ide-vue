<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { useUiStore } from '../stores/useUiStore'
import { useProjectStore } from '../stores/useProjectStore'
import { storeToRefs } from 'pinia'
import * as fs from '../services/fileSystem'
import { parseTagList } from '../services/parsers'
import { nplural } from '../utils/plural'
import { idbGet, idbSet, idbDel } from '../utils/idb'
import { TOAST_LIFE } from '../constants/toast'
import { useCanvas } from '../composables/useCanvas'

const ui = useUiStore()
const project = useProjectStore()
const canvas = useCanvas()
const toast = useToast()
const confirm = useConfirm()
const { tags, tagListHandle } = storeToRefs(project)

const IDB_HANDLE_KEY = 'tagListHandle'

// Ref на кнопку «Открыть» — target для ConfirmPopup.
const openBtnRef = ref(null)

async function loadParsedTagsFromHandle(handle) {
  const perm = await handle.queryPermission?.({ mode: 'read' })
  if (perm && perm !== 'granted') {
    const next = await handle.requestPermission({ mode: 'read' })
    if (next !== 'granted') {
      toast.add({
        severity: 'warn',
        summary: 'Нет доступа к файлу',
        detail: 'Браузер отозвал разрешение, выберите файл заново',
        life: TOAST_LIFE.NORMAL,
      })
      return null
    }
  }
  const content = await fs.getFileContentFromHandle(handle)
  if (!content) {
    toast.add({
      severity: 'error',
      summary: 'Tag-list',
      detail: 'Не удалось прочитать файл',
      life: TOAST_LIFE.NORMAL,
    })
    return null
  }
  const parsed = parseTagList(content)
  if (parsed.length === 0) {
    toast.add({
      severity: 'warn',
      summary: 'Tag-list',
      detail: 'Файл пуст или не содержит валидных тегов',
      life: TOAST_LIFE.NORMAL,
    })
    return null
  }
  return parsed
}

async function pickTagList() {
  try {
    const fileHandle = await fs.selectFile(ui.lastTagListPickerStartIn)
    if (!fileHandle) return
    const parsed = await loadParsedTagsFromHandle(fileHandle)
    if (!parsed) return

    project.setTags(parsed)
    project.setTagListHandle(fileHandle)
    await idbSet(IDB_HANDLE_KEY, fileHandle)
    ui.setLastTagListPickerStartIn(fileHandle)

    toast.add({
      severity: 'success',
      summary: 'Tag-list загружен',
      detail: `${nplural(parsed.length, 'тег', 'тега', 'тегов')} из ${fileHandle.name}`,
      life: TOAST_LIFE.NORMAL,
    })
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('[ProjectActions] Ошибка загрузки tag-list:', e)
    toast.add({
      severity: 'error',
      summary: 'Ошибка загрузки tag-list',
      detail: e.message || String(e),
      life: TOAST_LIFE.LONG,
    })
  }
}

function unloadTagList() {
  project.clearTagList()
  idbDel(IDB_HANDLE_KEY)
  toast.add({
    severity: 'info',
    summary: 'Tag-list сброшен',
    detail: 'Привязки на холсте сохранены, но выбрать новые теги пока нельзя',
    life: TOAST_LIFE.NORMAL,
  })
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
      toast.add({
        severity: 'info',
        summary: 'Tag-list восстановлен',
        detail: `${nplural(parsed.length, 'тег', 'тега', 'тегов')} из ${handle.name}`,
        life: TOAST_LIFE.SHORT,
      })
    } else {
      project.setTagListHandle(handle)
      toast.add({
        severity: 'warn',
        summary: 'Tag-list требует разрешения',
        detail: `Нажми обновить — браузер запросит доступ к ${handle.name}`,
        life: TOAST_LIFE.LONG,
      })
    }
  } catch (e) {
    console.warn('[ProjectActions] Не удалось восстановить tag-list handle:', e)
  }
}

onMounted(() => {
  tryRestoreTagListHandle()
  window.addEventListener('tms-open-project', openProjectSvg)
})

onBeforeUnmount(() => {
  window.removeEventListener('tms-open-project', openProjectSvg)
})

// Сигнал из инспектора «Загрузить tag-list…» (см. ui.requestTagListLoad).
watch(
  () => ui.tagListLoadRequest,
  () => pickTagList()
)

async function openProjectSvg() {
  const hasContent = canvas.cellsCount.value + canvas.linksCount.value > 0
  if (hasContent) {
    const accepted = await new Promise((resolve) => {
      confirm.require({
        target: openBtnRef.value?.$el ?? null,
        message: 'Открыть проект? Текущая работа на холсте будет заменена.',
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
    let svgText = null
    let fileName = 'SVG'

    if (typeof window !== 'undefined' && window.showOpenFilePicker) {
      const handle = await fs.selectFile(null, [
        { description: 'SVG-проект', accept: { 'image/svg+xml': ['.svg'] } },
      ])
      if (!handle) return
      const file = await handle.getFile()
      svgText = await file.text()
      fileName = handle.name
    } else {
      svgText = await new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.svg,image/svg+xml'
        input.onchange = async () => {
          const f = input.files?.[0]
          if (!f) return resolve(null)
          fileName = f.name
          resolve(await f.text())
        }
        input.click()
      })
      if (!svgText) return
    }

    await canvas.importFromSvg(svgText, fileName)
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('[ProjectActions] Ошибка загрузки SVG-проекта:', e)
    toast.add({
      severity: 'error',
      summary: 'Ошибка загрузки',
      detail: e.message || String(e),
      life: TOAST_LIFE.LONG,
    })
  }
}

async function refreshTagList() {
  const handle = tagListHandle.value
  if (!handle) return
  try {
    const parsed = await loadParsedTagsFromHandle(handle)
    if (!parsed) return
    const before = tags.value.length
    project.setTags(parsed)
    const diff = parsed.length - before
    toast.add({
      severity: 'success',
      summary: 'Tag-list обновлён',
      detail: `${nplural(parsed.length, 'тег', 'тега', 'тегов')}${diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}`,
      life: TOAST_LIFE.NORMAL,
    })
  } catch (e) {
    console.error('[ProjectActions] Ошибка рефреша tag-list:', e)
    toast.add({
      severity: 'error',
      summary: 'Не удалось обновить tag-list',
      detail: e.message || String(e),
      life: TOAST_LIFE.LONG,
    })
  }
}
</script>

<template>
  <div class="flex items-center gap-1">
    <Button
      ref="openBtnRef"
      v-tooltip.bottom="'Открыть · Ctrl+O'"
      icon="pi pi-folder-open"
      severity="secondary"
      text
      size="small"
      @click="openProjectSvg"
    />
    <Button
      v-tooltip.bottom="'Сохранить · Ctrl+S'"
      icon="pi pi-download"
      severity="secondary"
      text
      size="small"
      @click="canvas.exportProject"
    />

    <span class="text-surface-300 mx-1">|</span>

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
