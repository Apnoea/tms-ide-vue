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
const { darkMode } = storeToRefs(ui)
const { tags, tagListHandle } = storeToRefs(project)

const IDB_HANDLE_KEY = 'tagListHandle'

// Ref на кнопку «Открыть» — нужен как target для ConfirmPopup. Используем и
// для click'а, и для хоткея Ctrl+O (у CustomEvent нет полезного DOM-источника).
const openBtnRef = ref(null)

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
    // Сохраняем handle в IDB — пережить F5. В рамках одной browser-session
    // permission остаётся 'granted', поэтому при перезагрузке tag-list
    // подхватится автоматически (см. tryRestoreTagListHandle).
    await idbSet(IDB_HANDLE_KEY, fileHandle)
    const dir = await fs.getFileDirectory(fileHandle)
    ui.setLastTagListPickerStartIn(dir ?? fileHandle)

    toast.add({
      severity: 'success',
      summary: 'Tag-list загружен',
      detail: `${nplural(parsed.length, 'тег', 'тега', 'тегов')} из ${fileHandle.name}`,
      life: TOAST_LIFE.NORMAL,
    })
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('[Header] Ошибка загрузки tag-list:', e)
    toast.add({
      severity: 'error',
      summary: 'Ошибка загрузки tag-list',
      detail: e.message || String(e),
      life: TOAST_LIFE.LONG,
    })
  }
}

/**
 * Сбросить загруженный tag-list — очищает теги и забывает file handle.
 * Уже привязанные слоты остаются на ячейках, но picker'ы тегов будут пустые
 * пока не загружен новый tag-list.
 */
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

/**
 * При монтировании пытаемся восстановить handle из IDB. Если permission
 * 'granted' (та же browser-session) — подгружаем теги и показываем info-toast.
 * Если 'prompt' — handle ставим (UI покажет Refresh-кнопку) + warn-toast
 * с подсказкой нажать pi-refresh, потому что requestPermission требует
 * user-gesture (silently дёргнуть нельзя).
 */
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
    console.warn('[Header] Не удалось восстановить tag-list handle:', e)
  }
}

onMounted(() => {
  tryRestoreTagListHandle()
  // Ctrl+O в CanvasPane эмитит этот event'е, потому что хоткеи живут там.
  window.addEventListener('tms-open-project', openProjectSvg)
})

onBeforeUnmount(() => {
  window.removeEventListener('tms-open-project', openProjectSvg)
})

// Запрос на открытие tag-list-picker'а из любого места приложения (например
// кнопка «Загрузить tag-list…» в инспекторе, когда юзер увидел empty-state).
// Сигнал — счётчик в UI store, повторный запрос подряд тоже триггерит watch.
watch(
  () => ui.tagListLoadRequest,
  () => pickTagList()
)

/**
 * Открывает SVG (экспортированный через «Экспорт») и восстанавливает по нему
 * холст. На SVG должны быть data-tms-meta-атрибуты — иначе парсер не вытащит
 * source/target проводов и tms-поля ячеек.
 *
 * Fallback на скрытый <input type=file> для браузеров без File System Access API.
 *
 * Confirm спрашиваем ДО открытия нативного file-picker'а: иначе попап
 * вылетает у кнопки Open уже после того как юзер выбрал файл в пикере
 * (десятки секунд), визуальная связь «кнопка → попап» теряется.
 */
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
      if (!handle) return // юзер отменил
      const file = await handle.getFile()
      svgText = await file.text()
      fileName = handle.name
    } else {
      // Fallback: скрытый input
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
    console.error('[Header] Ошибка загрузки SVG-проекта:', e)
    toast.add({
      severity: 'error',
      summary: 'Ошибка загрузки',
      detail: e.message || String(e),
      life: TOAST_LIFE.LONG,
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
      life: TOAST_LIFE.NORMAL,
    })
  } catch (e) {
    console.error('[Header] Ошибка рефреша tag-list:', e)
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

    <div class="flex items-center gap-3">
      <!-- Group 1: Project IO (open / save SVG-project) -->
      <div class="flex items-center gap-1">
        <Button
          ref="openBtnRef"
          v-tooltip.bottom="'Открыть проект из SVG · Ctrl+O'"
          label="Открыть"
          icon="pi pi-folder-open"
          severity="secondary"
          text
          size="small"
          @click="openProjectSvg"
        />
        <Button
          v-tooltip.bottom="'Сохранить view.svg + animations.json · Ctrl+S'"
          aria-label="Сохранить"
          label="Сохранить"
          icon="pi pi-download"
          severity="secondary"
          text
          size="small"
          @click="canvas.exportProject"
        />
      </div>

      <span class="text-surface-300 dark:text-surface-700">|</span>

      <!-- Group 2: Tag-list (data binding) -->
      <div class="flex items-center gap-1">
        <Button
          v-tooltip.bottom="tags.length ? 'Выбрать другой tag-list' : 'Загрузить tag-list (.txt)'"
          :label="tags.length ? `Tag-list (${tags.length})` : 'Tag-list'"
          :icon="tags.length ? 'pi pi-check' : 'pi pi-tags'"
          :severity="tags.length ? 'secondary' : 'primary'"
          :text="tags.length ? true : false"
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
          v-if="tags.length"
          v-tooltip.bottom="'Сбросить tag-list'"
          icon="pi pi-times"
          severity="secondary"
          text
          rounded
          size="small"
          aria-label="Сбросить tag-list"
          @click="unloadTagList"
        />
      </div>

      <span class="text-surface-300 dark:text-surface-700">|</span>

      <!-- Group 3: Theme -->
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
