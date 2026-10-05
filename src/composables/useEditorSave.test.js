// @vitest-environment jsdom
// Сохранение и закрытие редактора символов: валидация, реестр, оверрайд, экземпляры во
// всех формах с итогом в тосте, сбой записи, подтверждение закрытия грязного черновика.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { withSetup } from './test-utils'
import { createStencilEditor } from './useStencilEditor'
import { useUiStore } from '../stores/useUiStore'
import { getStencilById, unregisterStencil } from '../stencils/registry'

const notify = { success: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('./useNotify', () => ({ useNotify: () => notify }))
const confirmDanger = vi.fn()
vi.mock('./useConfirmDanger', () => ({ useConfirmDanger: () => confirmDanger }))
const mockCanvas = {
  graphRef: { value: null },
  paperRef: { value: null },
  syncStencilInClosedForms: vi.fn(async () => ({ forms: 0, changed: 0, detached: 0 })),
  markDirty: vi.fn(),
  setSaveError: vi.fn(),
  bumpVersion: vi.fn(),
  requestSnapshot: vi.fn(),
  setSelection: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))
const syncStencilInstances = vi.fn(() => ({ changed: 0, detached: [] }))
vi.mock('../stencils/svgInjector', async (orig) => ({
  ...(await orig()),
  syncStencilInstances: (...a) => syncStencilInstances(...a),
}))
const overrides = { upsert: vi.fn(async () => true), remove: vi.fn(async () => true) }
vi.mock('../services/stencilOverrides', () => ({
  upsertStencilOverride: (...a) => overrides.upsert(...a),
  removeStencilOverride: (...a) => overrides.remove(...a),
}))
vi.mock('../services/stencilLibrary', () => ({ persistStencilsToDisk: async () => false }))

import { useEditorSave } from './useEditorSave'

const ID = 'cell_save_test'
let scope = null

function setup({ editTarget = null } = {}) {
  const ed = createStencilEditor()
  if (editTarget) ed.loadStencil(editTarget)
  else {
    Object.assign(ed.meta, { id: ID, label: 'Тест', category: 'Тест' })
    ed.addShape({ type: 'rect', x: 0, y: 0, w: 20, h: 20 })
  }
  const ui = useUiStore()
  ui.openStencilEditor(editTarget?.id ?? null)
  let api
  ;[api, scope] = withSetup(() =>
    useEditorSave({ ed, editTarget, isDuplicate: false, rangesOnly: false, animationOnly: false })
  )
  return { ed, ui, api }
}

describe('useEditorSave', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => {
    scope?.stop()
    unregisterStencil(ID)
  })

  it('ошибка в полях символа: тост, выделение снято, редактор открыт', async () => {
    const { ed, ui, api } = setup()
    ed.meta.label = ''
    expect(ed.selectedIds.value.length).toBe(1) // addShape выделяет новую фигуру
    await api.save()
    expect(notify.warn).toHaveBeenCalledWith('Проверь символ', expect.stringContaining('название'))
    expect(ed.selectedIds.value).toEqual([])
    expect(getStencilById(ID)).toBeUndefined()
    expect(ui.stencilEditorOpen).toBe(true)
  })

  it('новый символ: реестр, оверрайд, тост и закрытие', async () => {
    const { ui, api } = setup()
    await api.save()
    expect(getStencilById(ID)?.label).toBe('Тест')
    expect(overrides.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: ID }))
    expect(mockCanvas.markDirty).toHaveBeenCalled()
    expect(notify.success).toHaveBeenCalledWith('Символ создан', expect.any(String))
    expect(ui.stencilEditorOpen).toBe(false)
  })

  it('оверрайд не записался — saveError и тост об ошибке', async () => {
    overrides.upsert.mockResolvedValueOnce(false)
    const { api } = setup()
    await api.save()
    expect(mockCanvas.setSaveError).toHaveBeenCalledWith(true)
    expect(notify.error).toHaveBeenCalledWith('Символ не сохранён локально', expect.any(String))
  })

  it('правка с отцеплёнными проводами: warn с итогом, концы выделены', async () => {
    const first = setup()
    await first.api.save()
    scope.stop()
    vi.clearAllMocks()
    syncStencilInstances.mockReturnValueOnce({ changed: 2, detached: ['l1'] })
    const { api } = setup({ editTarget: getStencilById(ID) })
    await api.save()
    expect(mockCanvas.setSelection).toHaveBeenCalledWith([{ kind: 'link', id: 'l1' }])
    expect(notify.warn).toHaveBeenCalledWith(
      'Символ обновлён',
      'обновлено 2 символа, отцеплено 1 провод — порт удалён, перецепи'
    )
  })

  it('закрытие: чистый черновик — сразу, грязный — через подтверждение', () => {
    const { ed, ui, api } = setup({ editTarget: getStencilById('cell_qw') })
    api.requestClose()
    expect(confirmDanger).not.toHaveBeenCalled()
    expect(ui.stencilEditorOpen).toBe(false)

    ui.openStencilEditor('cell_qw')
    ed.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    api.requestClose()
    expect(confirmDanger).toHaveBeenCalledTimes(1)
    expect(ui.stencilEditorOpen).toBe(true)
  })
})
