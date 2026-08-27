// Загрузка tag-list'а из файла. Вынесено из TagListControl, потому что кнопку
// «Загрузить tag-list» показывает ещё и пустой tag-picker: иначе пользователю
// пришлось бы закрыть диалог, найти контрол в тулбаре и открыть picker заново.
import { useNotify, TOAST_LIFE } from './useNotify'
import { useCanvas } from './useCanvas'
import { useUiStore } from '../stores/useUiStore'
import { useProjectStore } from '../stores/useProjectStore'
import * as fs from '../services/fileSystem'
import { parseTagList } from '../services/parsers'
import { nplural } from '../utils/plural'
import { idbDel, idbGet, idbSet } from '../utils/idb'

/** Ключ file-handle'а в IndexedDB — по нему tag-list освежается на старте. */
const TAG_LIST_HANDLE_KEY = 'tagListHandle'

export function useTagList() {
  const ui = useUiStore()
  const project = useProjectStore()
  const canvas = useCanvas()
  const notify = useNotify()

  async function readParsedTags(file) {
    const content = await file.text().catch(() => null)
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

  /**
   * Диалог выбора файла + разбор + персист. Вернул `true` — теги в сторе.
   *
   * `handle` приходит только там, где есть File System Access API; без него теги
   * работают ровно так же, но освежать файл на старте нечем — прежний handle тогда
   * снимаем, иначе restore тянул бы ДРУГОЙ, устаревший файл.
   */
  async function pickTagList() {
    try {
      const picked = await fs.pickFile({ startInHandle: ui.lastTagListPickerStartIn })
      if (!picked) return false
      const { file, handle } = picked
      const loaded = await readParsedTags(file)
      if (!loaded) return false

      project.setTags(loaded.parsed)
      await (handle ? idbSet(TAG_LIST_HANDLE_KEY, handle) : idbDel(TAG_LIST_HANDLE_KEY))
      // Сырой текст — с проектом (бандл на экспорте + переживает reload).
      const tagsSaved = await idbSet('project:tags', loaded.content)
      ui.setLastTagListPickerStartIn(handle)
      // taglist.csv уходит в .zip → проект разошёлся с последним экспортом.
      canvas.markDirty()
      // Запись не прошла (квота / приватный режим): теги живут только в памяти —
      // после reload вернутся прежние. Молчать нельзя.
      if (!tagsSaved) canvas.setSaveError(true)

      notify[tagsSaved ? 'success' : 'warn'](
        'Tag-list загружен',
        tagsSaved
          ? `${nplural(loaded.parsed.length, 'тег', 'тега', 'тегов')} из ${file.name}`
          : `${nplural(loaded.parsed.length, 'тег', 'тега', 'тегов')} — не сохранено локально, после перезагрузки вернутся прежние`,
        TOAST_LIFE.NORMAL
      )
      return true
    } catch (e) {
      if (e.name === 'AbortError') return false
      console.error('[useTagList] Ошибка загрузки tag-list:', e)
      notify.error('Ошибка загрузки tag-list', e.message || String(e))
      return false
    }
  }

  // На старте пытаемся освежить tag-list из запомненного file-handle (IDB). Сами теги
  // уже подняты из `project:tags` (сырой текст переживает reload), так что это лишь
  // тихое обновление: 'granted' → перечитываем файл молча; иначе (browser сбросил
  // доступ) молчим тоже — теги работают. Warn о перевыборе файла даём ТОЛЬКО когда
  // тегов вообще нет (project:tags пуст), иначе тост был бы шумом на каждой загрузке.
  async function tryRestoreTagListHandle() {
    const handle = await idbGet(TAG_LIST_HANDLE_KEY)
    if (!handle) return
    try {
      const perm = await handle.queryPermission?.({ mode: 'read' })
      if (perm === 'granted') {
        const content = await fs.getFileContentFromHandle(handle)
        if (!content) return
        const parsed = parseTagList(content)
        if (parsed.length === 0) return
        project.setTags(parsed)
        // Синхронизируем IDB со свежим содержимым файла — экспорт берёт taglist
        // именно из 'project:tags', иначе в архив уйдёт устаревшая версия.
        await idbSet('project:tags', content)
      } else if (!(await idbGet('project:tags'))) {
        notify.warn(
          'Tag-list требует разрешения',
          `Нажмите «Tag-list» и выберите файл заново, чтобы дать доступ к ${handle.name}`,
          TOAST_LIFE.LONG
        )
      }
    } catch (e) {
      console.warn('[useTagList] Не удалось восстановить tag-list handle:', e)
    }
  }

  return { pickTagList, tryRestoreTagListHandle }
}
