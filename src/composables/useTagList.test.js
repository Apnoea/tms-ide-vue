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
vi.mock('../services/idb', () => ({
  idbGet: vi.fn(async () => null),
  idbSet: vi.fn(async () => true),
  idbDel: vi.fn(async () => true),
}))

import { useTagList } from './useTagList'
import { pickFile } from '../services/fileSystem'
import { idbSet, idbDel } from '../services/idb'
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore } from '../stores/useUiStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

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

describe('useTagList — подсказка замены в привязках', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    idbSet.mockResolvedValue(true)
  })

  const bound = (...tags) => ({
    cells: tags.map((tag, i) => ({ id: `c${i}`, tms: { slots: { onoff: tag } } })),
  })
  const pick = (text) =>
    pickFile.mockResolvedValue({ file: new File([text], 't.csv'), handle: null })

  it('префикс в новом tag-list сменился — диалог открывается с подобранной заменой', async () => {
    useWorkspaceStore().loadForms([{ id: 'a', graphJson: bound('OLD.X', 'OLD.Y') }], 'a')
    pick('NEW.X=Bool\nNEW.Y=Bool\n')
    await useTagList().pickTagList()
    expect(useUiStore().tagRebind).toEqual({ find: 'OLD.', replace: 'NEW.', suggested: true })
  })

  it('привязки на месте — диалог не открывается', async () => {
    useWorkspaceStore().loadForms([{ id: 'a', graphJson: bound('NEW.X', 'NEW.Y') }], 'a')
    pick('NEW.X=Bool\nNEW.Y=Bool\n')
    await useTagList().pickTagList()
    expect(useUiStore().tagRebind).toBeNull()
  })

  it('загрузка из пикера тега подсказку не открывает', async () => {
    // Замена перезагрузила бы форму под открытым пикером.
    useWorkspaceStore().loadForms([{ id: 'a', graphJson: bound('OLD.X', 'OLD.Y') }], 'a')
    pick('NEW.X=Bool\nNEW.Y=Bool\n')
    expect(await useTagList().pickTagList({ suggestRebind: false })).toBe(true)
    expect(useUiStore().tagRebind).toBeNull()
  })
})
