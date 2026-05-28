<script setup>
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useUiStore } from '../stores/useUiStore'
import { useProjectStore } from '../stores/useProjectStore'
import { storeToRefs } from 'pinia'
import * as fs from '../services/fileSystem'
import * as parsers from '../services/parsers'
import { nplural } from '../utils/plural'

const ui = useUiStore()
const project = useProjectStore()
const toast = useToast()
const { darkMode } = storeToRefs(ui)
const { tags, tagListHandle } = storeToRefs(project)

/**
 * Читает и парсит tag-list из FileSystem-handle с проверкой пермишена.
 * Возвращает массив тегов либо null с уже показанным toast'ом об ошибке.
 */
async function loadParsedTagsFromHandle(handle) {
  // Permission может протухнуть между сессиями (релевантно для refresh).
  // Для свежевыбранного через picker'а handle perm уже granted, queryPermission вернёт 'granted'.
  const perm = await handle.queryPermission?.({ mode: 'read' })
  if (perm && perm !== 'granted') {
    const next = await handle.requestPermission({ mode: 'read' })
    if (next !== 'granted') {
      toast.add({
        severity: 'warn',
        summary: 'Нет доступа к файлу',
        detail: 'Браузер отозвал разрешение, выберите файл заново',
        life: 4000,
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
      life: 4000,
    })
    return null
  }
  const parsed = parsers.parseTagList(content)
  if (parsed.length === 0) {
    toast.add({
      severity: 'warn',
      summary: 'Tag-list',
      detail: 'Файл пуст или не содержит валидных тегов',
      life: 4000,
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
    const dir = await fs.getFileDirectory(fileHandle)
    ui.setLastTagListPickerStartIn(dir ?? fileHandle)

    toast.add({
      severity: 'success',
      summary: 'Tag-list загружен',
      detail: `${nplural(parsed.length, 'тег', 'тега', 'тегов')} из ${fileHandle.name}`,
      life: 3000,
    })
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('[Header] Ошибка загрузки tag-list:', e)
    toast.add({
      severity: 'error',
      summary: 'Ошибка загрузки tag-list',
      detail: e.message || String(e),
      life: 5000,
    })
  }
}

/**
 * Перечитать tag-list из ранее выбранного файла без повторного picker'а.
 * Нужно если на диске обновился (например, экспорт из tag-utility).
 */
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
      life: 3000,
    })
  } catch (e) {
    console.error('[Header] Ошибка рефреша tag-list:', e)
    toast.add({
      severity: 'error',
      summary: 'Не удалось обновить tag-list',
      detail: e.message || String(e),
      life: 5000,
    })
  }
}
</script>

<template>
  <header
    class="flex items-center justify-between px-6 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900"
  >
    <div class="flex items-center gap-4">
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">
          TMS IDE
        </h1>
        <p class="text-xs text-surface-500 dark:text-surface-400">
          <template v-if="!tags.length">
            Подключите tag-list, чтобы привязывать ячейки к объектам
          </template>
          <template v-else>
            ✓ tag-list: {{ nplural(tags.length, 'тег', 'тега', 'тегов') }}
          </template>
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <Button
        v-tooltip.bottom="tags.length ? 'Выбрать другой tag-list' : 'Загрузить tag-list (.txt)'"
        :label="tags.length ? `✓ tag-list (${tags.length})` : 'Tag-list'"
        :severity="tags.length ? 'secondary' : 'primary'"
        icon="pi pi-tags"
        size="small"
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
        aria-label="Обновить tag-list"
        @click="refreshTagList"
      />
      <Button
        v-tooltip.bottom="darkMode ? 'Светлая тема' : 'Тёмная тема'"
        :icon="darkMode ? 'pi pi-sun' : 'pi pi-moon'"
        severity="secondary"
        text
        rounded
        size="small"
        :aria-label="darkMode ? 'Светлая тема' : 'Тёмная тема'"
        @click="ui.toggleDarkMode"
      />
    </div>
  </header>
</template>
