<script setup>
/**
 * Контрол tag-list'а (в тулбаре холста, рядом с заголовком): загрузка/замена
 * файла тегов + счётчик. Сырой текст хранится в IndexedDB (`project:tags`,
 * переживает reload и попадает в бандл при экспорте), file-handle
 * (`tagListHandle`) — для тихого обновления из файла. Теги — в useProjectStore.
 */
import { computed, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import { storeToRefs } from 'pinia'
import { useNotify, TOAST_LIFE } from '../composables/useNotify'
import { useUiStore } from '../stores/useUiStore'
import { useProjectStore } from '../stores/useProjectStore'
import * as fs from '../services/fileSystem'
import { parseTagList } from '../services/parsers'
import { nplural } from '../utils/plural'
import { idbGet, idbSet } from '../utils/idb'

const ui = useUiStore()
const project = useProjectStore()
const notify = useNotify()
const { tags } = storeToRefs(project)

const IDB_HANDLE_KEY = 'tagListHandle'

// Есть ли сохранённый tag-list. Реактивный `tags` на маунте пуст (restore
// асинхронный), и кнопка мигала бы filled(primary)→text — стартуем с «есть»
// и уточняем по IDB; для общего случая (теги были) перехода нет.
const hasPersistedTags = ref(true)
const tagListPresent = computed(() => tags.value.length > 0 || hasPersistedTags.value)

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
    console.error('[TagListControl] Ошибка загрузки tag-list:', e)
    notify.error('Ошибка загрузки tag-list', e.message || String(e))
  }
}

// На mount пытаемся освежить tag-list из запомненного file-handle (IDB). Сами теги
// уже подняты из `project:tags` (сырой текст переживает reload), так что это лишь
// тихое обновление: 'granted' → перечитываем файл молча; иначе (browser сбросил
// доступ) молчим тоже — теги работают. Warn о перевыборе файла даём ТОЛЬКО когда
// тегов вообще нет (project:tags пуст), иначе тост был бы шумом на каждой загрузке.
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
    } else if (!(await idbGet('project:tags'))) {
      notify.warn(
        'Tag-list требует разрешения',
        `Нажмите «Tag-list» и выберите файл заново, чтобы дать доступ к ${handle.name}`,
        TOAST_LIFE.LONG
      )
    }
  } catch (e) {
    console.warn('[TagListControl] Не удалось восстановить tag-list handle:', e)
  }
}

onMounted(async () => {
  hasPersistedTags.value = !!(await idbGet('project:tags'))
  tryRestoreTagListHandle()
})

// Сигнал из инспектора «Загрузить tag-list…» (см. ui.requestTagListLoad).
watch(
  () => ui.tagListLoadRequest,
  () => pickTagList()
)
</script>

<template>
  <div class="flex items-center gap-1">
    <Button
      v-tooltip.bottom="tagListPresent ? 'Заменить tag-list' : 'Загрузить tag-list'"
      icon="pi pi-tags"
      :severity="tagListPresent ? 'secondary' : 'primary'"
      :text="tagListPresent"
      label="Tag-list"
      size="small"
      @click="pickTagList"
    />
    <Badge
      v-if="tags.length"
      :value="tags.length"
      size="small"
      class="!bg-surface-200 !text-surface-600"
    />
  </div>
</template>
