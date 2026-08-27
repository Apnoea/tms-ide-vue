// Загрузка tag-list'а не требует File System Access API: файл читается из `File`,
// а handle — лишь бонус для тихого обновления на старте. Без него теги обязаны
// работать так же (Brave отключает FSA по умолчанию).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockCanvas = { markDirty: vi.fn(), setSaveError: vi.fn() }
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

const notify = { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('./useNotify', () => ({
  useNotify: () => notify,
  TOAST_LIFE: { NORMAL: 3000, LONG: 6000 },
}))

vi.mock('../services/fileSystem', () => ({ pickFile: vi.fn(), getFileContentFromHandle: vi.fn() }))
vi.mock('../utils/idb', () => ({
  idbGet: vi.fn(async () => null),
  idbSet: vi.fn(async () => true),
  idbDel: vi.fn(async () => true),
}))

import { useTagList } from './useTagList'
import { pickFile } from '../services/fileSystem'
import { idbSet, idbDel } from '../utils/idb'
import { useProjectStore } from '../stores/useProjectStore'

const tagsFile = () => new File(['PS1.ONOFF=Bool\n'], 'tags.csv')

describe('useTagList — выбор файла без handle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    idbSet.mockResolvedValue(true)
    idbDel.mockResolvedValue(true)
  })

  it('браузер без FSA: теги в сторе, текст в IDB, handle не пишем', async () => {
    pickFile.mockResolvedValue({ file: tagsFile(), handle: null })
    const { pickTagList } = useTagList()

    expect(await pickTagList()).toBe(true)
    expect(useProjectStore().tags).toEqual([{ name: 'PS1.ONOFF', type: 'Bool' }])
    expect(idbSet).toHaveBeenCalledWith('project:tags', 'PS1.ONOFF=Bool\n')
    expect(idbSet).not.toHaveBeenCalledWith('tagListHandle', expect.anything())
    // Прежний handle снимаем: иначе restore на старте перечитал бы ДРУГОЙ файл.
    expect(idbDel).toHaveBeenCalledWith('tagListHandle')
  })

  it('есть FSA: handle уходит в IDB для тихого обновления', async () => {
    const handle = { name: 'tags.csv' }
    pickFile.mockResolvedValue({ file: tagsFile(), handle })
    const { pickTagList } = useTagList()

    expect(await pickTagList()).toBe(true)
    expect(idbSet).toHaveBeenCalledWith('tagListHandle', handle)
    expect(idbDel).not.toHaveBeenCalled()
  })

  it('отмена диалога — не ошибка и ничего не пишет', async () => {
    pickFile.mockResolvedValue(null)
    const { pickTagList } = useTagList()

    expect(await pickTagList()).toBe(false)
    expect(idbSet).not.toHaveBeenCalled()
    expect(notify.error).not.toHaveBeenCalled()
  })

  it('файл без валидных тегов → warn, теги не подменяются', async () => {
    pickFile.mockResolvedValue({
      file: new File(['# только комментарий\n'], 'x.csv'),
      handle: null,
    })
    const { pickTagList } = useTagList()

    expect(await pickTagList()).toBe(false)
    expect(notify.warn).toHaveBeenCalled()
    expect(useProjectStore().tags).toEqual([])
  })
})
