// Установка и удаление набора: гейты (занятые id, исчезнувшие используемые символы),
// штамп метки и синхронизация реестра.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockNotify = vi.hoisted(() => ({
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))
vi.mock('./useNotify', () => ({ useNotify: () => mockNotify }))

const mockUsage = vi.hoisted(() => vi.fn(() => ({ count: 0, formIds: [] })))
vi.mock('./useStencilUsage', () => ({ useStencilUsage: () => ({ stencilUsage: mockUsage }) }))

const registry = vi.hoisted(() => new Map())
vi.mock('../stencils/registry', () => ({
  getAllStencils: () => [...registry.values()],
  getStencilById: (id) => registry.get(id),
  registerStencil: vi.fn((json) => {
    registry.set(json.id, json)
    return true
  }),
  unregisterStencil: vi.fn((id) => registry.delete(id)),
}))

const mockSyncInstances = vi.hoisted(() => vi.fn(() => ({ changed: 0, detached: [] })))
vi.mock('../stencils/svgInjector', () => ({ reinjectAllStencils: mockSyncInstances }))

const mockRemoveOverride = vi.hoisted(() => vi.fn())
vi.mock('../services/stencilOverrides', () => ({ removeStencilOverride: mockRemoveOverride }))

const mockCanvas = vi.hoisted(() => ({
  graphRef: { value: null },
  paperRef: { value: null },
  markDirty: vi.fn(),
  bumpVersion: vi.fn(),
  syncStencilInClosedForms: vi.fn(async () => ({ forms: 0, changed: 0, detached: 0 })),
}))
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

const store = vi.hoisted(() => ({ presets: [], file: null, bundle: null, saveOk: true }))
vi.mock('../services/presetLibrary', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    pickPresetArchive: vi.fn(async () => store.file),
    readPresetZipFile: vi.fn(async () => {
      if (store.bundle instanceof Error) throw store.bundle
      return store.bundle
    }),
    loadPresets: vi.fn(async () => store.presets),
    savePreset: vi.fn(async (p) => {
      store.presets = [...store.presets.filter((x) => x.id !== p.id), p]
      return store.saveOk
    }),
    removePreset: vi.fn(async (id) => {
      store.presets = store.presets.filter((p) => p.id !== id)
      return store.saveOk
    }),
  }
})

import { usePresets } from './usePresets'

const stencil = (id) => ({
  id,
  stencilJson: { id, label: id, category: 'К', width: 20, height: 20 },
  shapeSvg: '<g/>',
})

const bundle = (overrides = {}) => ({
  id: 'demo',
  name: 'Демо-набор',
  version: '1.0',
  description: '',
  stencils: [stencil('demo_qw')],
  ...overrides,
})

beforeEach(async () => {
  registry.clear()
  store.presets = []
  store.file = new File([''], 'preset.zip')
  store.bundle = bundle()
  store.saveOk = true
  mockUsage.mockReturnValue({ count: 0, formIds: [] })
  for (const fn of [mockSyncInstances, mockRemoveOverride, mockCanvas.markDirty]) fn.mockClear()
  mockCanvas.syncStencilInClosedForms.mockClear()
  for (const fn of Object.values(mockNotify)) fn.mockClear()
  const { refreshPresets } = usePresets()
  await refreshPresets()
})

describe('установка набора', () => {
  it('регистрирует символы с меткой набора и запоминает набор', async () => {
    const { installPresetFromFile, presets } = usePresets()
    expect(await installPresetFromFile()).toBe(true)

    expect(registry.get('demo_qw').preset).toEqual({
      id: 'demo',
      name: 'Демо-набор',
      version: '1.0',
    })
    expect(presets.value.map((p) => p.id)).toEqual(['demo'])
    expect(mockNotify.success).toHaveBeenCalledWith('Набор установлен', expect.any(String))
    // Палитра целиком уезжает в library/ архива — проект разошёлся с экспортом.
    expect(mockCanvas.markDirty).toHaveBeenCalled()
  })

  // Экземпляров у нового набора ещё нет — сверять нечего.
  it('первая установка не гоняет сверку экземпляров', async () => {
    await usePresets().installPresetFromFile()
    expect(mockSyncInstances).not.toHaveBeenCalled()
    expect(mockCanvas.syncStencilInClosedForms).not.toHaveBeenCalled()
  })

  it('отмена пикера — ничего не делает', async () => {
    store.file = null
    const { installPresetFromFile } = usePresets()
    expect(await installPresetFromFile()).toBe(false)
    expect(registry.size).toBe(0)
  })

  it('битый архив → ошибка, реестр не тронут', async () => {
    store.bundle = new Error('Не удалось прочитать архив')
    const { installPresetFromFile } = usePresets()
    expect(await installPresetFromFile()).toBe(false)
    expect(mockNotify.error).toHaveBeenCalledWith(
      'Набор не установлен',
      'Не удалось прочитать архив'
    )
    expect(registry.size).toBe(0)
  })

  // Набор ставится целиком: одна негодная запись отменяет установку.
  it('набор не по форме → отказ целиком', async () => {
    store.bundle = bundle({ stencils: [stencil('cell_qw')] })
    const { installPresetFromFile } = usePresets()
    expect(await installPresetFromFile()).toBe(false)
    expect(registry.size).toBe(0)
  })

  it('занятый чужим символом id → отказ со списком', async () => {
    registry.set('demo_qw', { id: 'demo_qw' })
    const { installPresetFromFile } = usePresets()
    expect(await installPresetFromFile()).toBe(false)
    expect(mockNotify.error).toHaveBeenCalledWith(
      'Набор не установлен',
      expect.stringContaining('demo_qw')
    )
  })

  it('запись в IDB не прошла → набор в реестре, но предупреждение', async () => {
    store.saveOk = false
    const { installPresetFromFile } = usePresets()
    expect(await installPresetFromFile()).toBe(true)
    expect(registry.has('demo_qw')).toBe(true)
    expect(mockNotify.warn).toHaveBeenCalledWith(
      'Набор установлен',
      expect.stringContaining('перезагрузки')
    )
  })
})

describe('обновление набора (тот же id)', () => {
  beforeEach(async () => {
    store.bundle = bundle({ stencils: [stencil('demo_qw'), stencil('demo_old')] })
    await usePresets().installPresetFromFile()
    mockNotify.success.mockClear()
  })

  it('свои id конфликтом не считаются; исчезнувшие символы снимаются', async () => {
    store.bundle = bundle({ version: '2.0', stencils: [stencil('demo_qw'), stencil('demo_new')] })
    const { installPresetFromFile, presets } = usePresets()
    expect(await installPresetFromFile()).toBe(true)

    expect([...registry.keys()].sort()).toEqual(['demo_new', 'demo_qw'])
    expect(registry.get('demo_qw').preset.version).toBe('2.0')
    expect(presets.value).toHaveLength(1)
    expect(mockNotify.success).toHaveBeenCalledWith('Набор обновлён', expect.any(String))
    // Расставленные экземпляры подтягивают новую версию: активная форма и закрытые.
    expect(mockSyncInstances).toHaveBeenCalled()
    expect(mockCanvas.syncStencilInClosedForms).toHaveBeenCalled()
    // Правка анимации исчезнувшего символа не должна пережить его снятие.
    expect(mockRemoveOverride).toHaveBeenCalledWith('demo_old')
  })

  // Исчезнувший в новой версии символ, стоящий на схемах, рисовать будет нечем.
  it('исчезнувший символ расставлен на схемах → отказ', async () => {
    mockUsage.mockReturnValue({ count: 3, formIds: ['main'] })
    store.bundle = bundle({ version: '2.0', stencils: [stencil('demo_qw')] })
    const { installPresetFromFile } = usePresets()
    expect(await installPresetFromFile()).toBe(false)
    expect(registry.has('demo_old')).toBe(true)
    expect(mockNotify.warn).toHaveBeenCalledWith(
      'Набор не обновлён',
      expect.stringContaining('main')
    )
  })

  it('версия ниже установленной — откат, а не обновление', async () => {
    store.bundle = bundle({ version: '0.9', stencils: [stencil('demo_qw'), stencil('demo_old')] })
    const { installPresetFromFile } = usePresets()
    await installPresetFromFile()
    expect(mockNotify.success).toHaveBeenCalledWith('Набор откачен', expect.any(String))
  })
})

describe('удаление набора', () => {
  beforeEach(async () => {
    await usePresets().installPresetFromFile()
  })

  it('снимает символы из реестра и набор из списка', async () => {
    const { removePresetById, presets } = usePresets()
    expect(await removePresetById('demo')).toBe(true)
    expect(registry.size).toBe(0)
    expect(presets.value).toEqual([])
    expect(mockNotify.success).toHaveBeenCalledWith('Набор удалён', 'Демо-набор')
    // Оверрайд с правкой анимации снимается вместе с набором: иначе символ снятого
    // набора вернулся бы в палитру на следующем старте.
    expect(mockRemoveOverride).toHaveBeenCalledWith('demo_qw')
    expect(mockCanvas.markDirty).toHaveBeenCalled()
  })

  it('символы расставлены → отказ, набор остаётся', async () => {
    mockUsage.mockReturnValue({ count: 2, formIds: ['main', 'sub'] })
    const { removePresetById, presets } = usePresets()
    expect(await removePresetById('demo')).toBe(false)
    expect(registry.has('demo_qw')).toBe(true)
    expect(presets.value).toHaveLength(1)
    expect(mockNotify.warn).toHaveBeenCalledWith(
      'Набор используется',
      expect.stringContaining('main, sub')
    )
  })

  it('неизвестный набор — no-op', async () => {
    const { removePresetById } = usePresets()
    expect(await removePresetById('nope')).toBe(false)
  })
})
