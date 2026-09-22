// Наборы символов: чтение `.zip`, проверка формы, сравнение версий и хранилище.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fileSystem', () => ({ pickFile: vi.fn() }))

const idbStore = vi.hoisted(() => new Map())
const idbSet = vi.hoisted(() => vi.fn())
vi.mock('../utils/idb', () => ({
  idbTryGet: vi.fn(async (k) => ({ ok: true, value: idbStore.get(k) })),
  idbSet: idbSet,
}))

import { zipSync, strToU8 } from 'fflate'
import { idbTryGet } from '../utils/idb'
import {
  comparePresetVersions,
  loadPresets,
  readPresetZipFile,
  removePreset,
  savePreset,
  stampPreset,
  validatePresetBundle,
} from './presetLibrary'

const KEY = 'app:presets'

function bundle(overrides = {}) {
  return {
    id: 'demo',
    name: 'Демо-набор',
    version: '1.0',
    stencils: [
      {
        id: 'demo_qw',
        stencilJson: { id: 'demo_qw', label: 'В', category: 'К', width: 20, height: 20 },
        shapeSvg: '<g/>',
      },
    ],
    ...overrides,
  }
}

function presetZip(files) {
  return new Blob([zipSync(files)])
}

beforeEach(() => {
  idbStore.clear()
  idbSet.mockReset()
  idbSet.mockImplementation(async (k, v) => {
    idbStore.set(k, v)
    return true
  })
})

describe('comparePresetVersions', () => {
  it('сравнивает покомпонентно числами, недостающие компоненты — нули', () => {
    expect(comparePresetVersions('1.10', '1.9')).toBeGreaterThan(0) // строкой было бы наоборот
    expect(comparePresetVersions('2.0', '10.0')).toBeLessThan(0)
    expect(comparePresetVersions('1.2', '1.2.0')).toBe(0)
    expect(comparePresetVersions('1.2.1', '1.2')).toBeGreaterThan(0)
  })
})

describe('validatePresetBundle', () => {
  it('валидный набор → пусто', () => {
    expect(validatePresetBundle(bundle())).toEqual([])
  })

  it('манифест: id по маске, название, версия вида 1.2.3', () => {
    expect(validatePresetBundle(bundle({ id: 'Demo Set' }))).toContainEqual(
      expect.stringContaining('Id набора')
    )
    expect(validatePresetBundle(bundle({ name: '  ' }))).toContainEqual(
      expect.stringContaining('названия')
    )
    expect(validatePresetBundle(bundle({ version: '1.0-beta' }))).toContainEqual(
      expect.stringContaining('Версия')
    )
  })

  // Префикс — то, чем наборы разведены между собой: без него два набора рано или
  // поздно принесут одинаковый id.
  it('id символа без префикса набора отклоняется', () => {
    const bad = bundle()
    bad.stencils[0].id = 'cell_qw'
    bad.stencils[0].stencilJson.id = 'cell_qw'
    expect(validatePresetBundle(bad)).toContainEqual(expect.stringContaining('без префикса'))
  })

  it('перечисляет ВСЕ проблемы символа, а не первую', () => {
    const bad = bundle()
    bad.stencils[0].stencilJson = { id: 'demo_qw' }
    bad.stencils[0].shapeSvg = ''
    const problems = validatePresetBundle(bad)
    expect(problems).toHaveLength(5) // label, category, width, height, shape.svg
  })

  it('пустой набор отклоняется', () => {
    expect(validatePresetBundle(bundle({ stencils: [] }))).toContainEqual(
      expect.stringContaining('нет символов')
    )
  })
})

describe('readPresetZipFile', () => {
  it('читает манифест и символы из library/', async () => {
    const zip = presetZip({
      'preset.json': strToU8('{"id":"demo","name":"Демо","version":"1.0","description":"д"}'),
      'library/demo_qw/stencil.json': strToU8('{"id":"demo_qw","label":"В"}'),
      'library/demo_qw/shape.svg': strToU8('<g/>'),
    })
    const read = await readPresetZipFile(zip)
    expect(read).toMatchObject({ id: 'demo', name: 'Демо', version: '1.0', description: 'д' })
    expect(read.stencils).toEqual([
      { id: 'demo_qw', stencilJson: { id: 'demo_qw', label: 'В' }, shapeSvg: '<g/>' },
    ])
  })

  // Имя папки — источник правды: по нему строится путь, и json с другим id дал бы
  // символ, которого в архиве нет.
  it('id символа берётся из пути, а не из json', async () => {
    const zip = presetZip({
      'preset.json': strToU8('{"id":"demo","name":"Демо","version":"1.0"}'),
      'library/demo_qw/stencil.json': strToU8('{"id":"cell_other","label":"В"}'),
    })
    const read = await readPresetZipFile(zip)
    expect(read.stencils[0].stencilJson.id).toBe('demo_qw')
  })

  it('архив без preset.json — не набор', async () => {
    const zip = presetZip({ 'library/demo_qw/stencil.json': strToU8('{}') })
    await expect(readPresetZipFile(zip)).rejects.toThrow(/не набор/)
  })

  it('битый JSON манифеста и символа — внятная ошибка', async () => {
    await expect(readPresetZipFile(presetZip({ 'preset.json': strToU8('{oops') }))).rejects.toThrow(
      /preset\.json/
    )
    const zip = presetZip({
      'preset.json': strToU8('{"id":"demo","name":"Д","version":"1"}'),
      'library/demo_qw/stencil.json': strToU8('{oops'),
    })
    await expect(readPresetZipFile(zip)).rejects.toThrow(/demo_qw/)
  })

  it('не ZIP — внятная ошибка', async () => {
    await expect(readPresetZipFile(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow(/архив/)
  })
})

describe('stampPreset', () => {
  it('ставит метку из манифеста поверх любой в json', () => {
    const json = stampPreset({ id: 'demo_qw', preset: { id: 'чужой' } }, bundle())
    expect(json.preset).toEqual({ id: 'demo', name: 'Демо-набор', version: '1.0' })
  })
})

describe('хранилище наборов', () => {
  it('savePreset добавляет и заменяет по id', async () => {
    await savePreset({ id: 'demo', name: 'Д', version: '1.0', stencils: [] })
    await savePreset({ id: 'other', name: 'O', version: '1.0', stencils: [] })
    await savePreset({ id: 'demo', name: 'Д', version: '2.0', stencils: [] })
    const saved = await loadPresets()
    expect(saved.map((p) => `${p.id}@${p.version}`).sort()).toEqual(['demo@2.0', 'other@1.0'])
  })

  it('removePreset снимает один набор, остальные остаются', async () => {
    await savePreset({ id: 'demo', name: 'Д', version: '1.0', stencils: [] })
    await savePreset({ id: 'other', name: 'O', version: '1.0', stencils: [] })
    expect(await removePreset('demo')).toBe(true)
    expect((await loadPresets()).map((p) => p.id)).toEqual(['other'])
  })

  // Сбой чтения ≠ «наборов нет»: запись списком снесла бы установленные наборы.
  it('чтение упало → не пишем и сообщаем неудачу', async () => {
    idbTryGet.mockResolvedValueOnce({ ok: false, value: undefined })
    expect(await savePreset({ id: 'demo', version: '1.0', stencils: [] })).toBe(false)
    idbTryGet.mockResolvedValueOnce({ ok: false, value: undefined })
    expect(await removePreset('demo')).toBe(false)
    expect(idbSet).not.toHaveBeenCalled()
  })

  it('пустое хранилище → пустой список', async () => {
    expect(await loadPresets()).toEqual([])
    expect(idbStore.has(KEY)).toBe(false)
  })
})
