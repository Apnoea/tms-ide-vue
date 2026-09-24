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
const mockReplaceOverrides = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../services/stencilOverrides', () => ({
  removeStencilOverride: mockRemoveOverride,
  loadStencilOverrides: vi.fn(async () => []),
  replaceStencilOverrides: mockReplaceOverrides,
}))

const mockCanvas = vi.hoisted(() => ({
  graphRef: { value: null },
  paperRef: { value: null },
  markDirty: vi.fn(),
  bumpVersion: vi.fn(),
  syncStencilInClosedForms: vi.fn(async () => ({ forms: 0, changed: 0, detached: 0 })),
}))
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

const store = vi.hoisted(() => ({
  presets: [],
  file: null,
  bundle: null,
  saveOk: true,
  rebase: null,
  bases: new Map(),
}))
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
    presetStencilBase: vi.fn((id) => store.bases.get(id) || null),
    savePreset: vi.fn(async (p) => {
      store.presets = [...store.presets.filter((x) => x.id !== p.id), p]
      return store.saveOk
    }),
    removePreset: vi.fn(async (id) => {
      store.presets = store.presets.filter((p) => p.id !== id)
      return store.saveOk
    }),
    // Наложение правок проекта проверено в presetLibrary/presetPatch; здесь — что
    // установка им пользуется: регистрирует итог и пишет изменённые оверрайды.
    rebaseOverrides: vi.fn(
      () =>
        store.rebase || {
          items: [],
          changed: false,
          report: { kept: [], dropped: [], drawingReset: [] },
        }
    ),
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
  store.rebase = null
  store.bases = new Map()
  mockReplaceOverrides.mockClear()
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

  it('откат спрашивает подтверждение; «нет» — ничего не меняется', async () => {
    store.bundle = bundle({ version: '0.9', stencils: [stencil('demo_qw'), stencil('demo_old')] })
    const confirmDowngrade = vi.fn(async () => false)
    const { installPresetFromFile, presets } = usePresets()
    expect(await installPresetFromFile({ confirmDowngrade })).toBe(false)
    expect(confirmDowngrade).toHaveBeenCalledWith(
      expect.objectContaining({ version: '0.9' }),
      expect.objectContaining({ version: '1.0' })
    )
    expect(presets.value[0].version).toBe('1.0')
    expect(registry.get('demo_qw').preset.version).toBe('1.0')
  })

  it('обновление до новой версии подтверждения не спрашивает', async () => {
    store.bundle = bundle({ version: '2.0', stencils: [stencil('demo_qw'), stencil('demo_old')] })
    const confirmDowngrade = vi.fn(async () => false)
    expect(await usePresets().installPresetFromFile({ confirmDowngrade })).toBe(true)
    expect(confirmDowngrade).not.toHaveBeenCalled()
  })
})

// Правки проекта у символов набора ложатся на новую версию: установка регистрирует
// итог наложения поверх исходника и пишет изменённые оверрайды.
describe('правки проекта при установке', () => {
  const tweaked = {
    id: 'demo_qw',
    stencilJson: {
      id: 'demo_qw',
      preset: { id: 'demo', name: 'Демо-набор', version: '1.0' },
      presetPatch: { quality: true },
      quality: true,
    },
    shapeSvg: '<g/>',
  }

  // Проект собран на наборе, которого здесь ещё нет: его символы пришли с архивом и
  // уже в реестре. Это свои символы, а не занятые id.
  it('символы, пришедшие с проектом, — не конфликт id', async () => {
    registry.set('demo_qw', { id: 'demo_qw', preset: { id: 'demo', version: '1.0' } })
    expect(await usePresets().installPresetFromFile()).toBe(true)
    expect(mockNotify.error).not.toHaveBeenCalled()
    // Символы уже стояли на схемах — экземпляры сверяются с установленной версией.
    expect(mockSyncInstances).toHaveBeenCalled()
  })

  it('символ с тем же id из ДРУГОГО набора — конфликт', async () => {
    registry.set('demo_qw', { id: 'demo_qw', preset: { id: 'other', version: '1.0' } })
    expect(await usePresets().installPresetFromFile()).toBe(false)
    expect(mockNotify.error).toHaveBeenCalledWith(
      'Набор не установлен',
      expect.stringContaining('demo_qw')
    )
  })

  it('итог наложения — в реестр поверх исходника, изменённые оверрайды — в IDB', async () => {
    store.rebase = {
      items: [tweaked],
      changed: true,
      report: { kept: ['demo_qw'], dropped: [], drawingReset: [] },
    }
    await usePresets().installPresetFromFile()
    expect(registry.get('demo_qw').presetPatch).toEqual({ quality: true })
    expect(mockReplaceOverrides).toHaveBeenCalledWith([tweaked])
    expect(mockNotify.success).toHaveBeenCalledWith(
      'Набор установлен',
      expect.stringContaining('настройки проекта сохранены у 1 символа')
    )
  })

  // Сброшенная видимость — повод перенастроить руками, об этом надо сказать громко.
  it('сброшенная видимость и не перенёсшиеся правки — warn с перечнем символов', async () => {
    store.rebase = {
      items: [tweaked],
      changed: true,
      report: { kept: ['demo_qw'], dropped: ['demo_qw'], drawingReset: ['demo_qw'] },
    }
    await usePresets().installPresetFromFile()
    expect(mockNotify.warn).toHaveBeenCalledWith(
      'Набор установлен',
      expect.stringMatching(/видимость фигур сброшена: demo_qw.*не перенеслась: demo_qw/)
    )
  })

  it('оверрайды не менялись — не пишем', async () => {
    store.rebase = {
      items: [],
      changed: false,
      report: { kept: [], dropped: [], drawingReset: [] },
    }
    await usePresets().installPresetFromFile()
    expect(mockReplaceOverrides).not.toHaveBeenCalled()
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

// Наборы, приехавшие с архивом проекта: проект заменяется целиком, поэтому гейтов
// установки из файла нет, а старую версию из архива не ставим никогда.
describe('наборы из архива проекта', () => {
  it('набора нет — ставится', async () => {
    const report = await usePresets().adoptProjectPresets([bundle()])
    expect(report.installed).toEqual(['«Демо-набор» 1.0'])
    expect(registry.get('demo_qw').preset.version).toBe('1.0')
  })

  it('та же версия — не трогается', async () => {
    await usePresets().installPresetFromFile()
    const report = await usePresets().adoptProjectPresets([bundle()])
    expect(report).toMatchObject({ installed: [], updated: [], older: [], skipped: [] })
  })

  it('в архиве новее — обновляется без вопросов', async () => {
    await usePresets().installPresetFromFile()
    const report = await usePresets().adoptProjectPresets([bundle({ version: '2.0' })])
    expect(report.updated).toEqual(['«Демо-набор» 2.0'])
    expect(registry.get('demo_qw').preset.version).toBe('2.0')
  })

  it('в архиве старее — остаётся установленная', async () => {
    await usePresets().installPresetFromFile()
    const report = await usePresets().adoptProjectPresets([bundle({ version: '0.9' })])
    expect(report.older).toEqual(['«Демо-набор» 0.9 (у тебя 1.0)'])
    expect(registry.get('demo_qw').preset.version).toBe('1.0')
  })

  it('битый набор и чужой набор с теми же id — пропускаются', async () => {
    store.bases.set('demo_qw', { stencilJson: { preset: { id: 'other' } } })
    const report = await usePresets().adoptProjectPresets([bundle({ id: 'Bad Id' }), bundle()])
    expect(report.skipped).toEqual(['«Демо-набор»', '«Демо-набор»'])
    expect(registry.has('demo_qw')).toBe(false)
  })

  // Проект сменился: правки прежнего поверх символов набора висеть не должны.
  it('символы установленных наборов возвращаются к поставке', async () => {
    await usePresets().installPresetFromFile()
    registry.set('demo_qw', { ...registry.get('demo_qw'), presetPatch: { quality: true } })
    await usePresets().adoptProjectPresets([])
    expect(registry.get('demo_qw').presetPatch).toBeUndefined()
  })
})
