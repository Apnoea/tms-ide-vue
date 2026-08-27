// Round-trip ZIP-архива проекта: buildProjectZipBlob ↔ readProjectZipFile.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./fileSystem', () => ({ pickFile: vi.fn() }))

import {
  buildProjectZipBlob,
  readProjectZipFile,
  collectUsedStencilIds,
  pickProjectArchive,
} from './projectZip'
import { pickFile } from './fileSystem'

describe('collectUsedStencilIds', () => {
  it('собирает уникальные stencilId из форм, игнорит линки и без stencilId', () => {
    const forms = [
      { cells: [{ tms: { stencilId: 'cell_qw' } }, { tms: { stencilId: 'cell_bus' } }] },
      { cells: [{ tms: { stencilId: 'cell_qw' } }, { type: 'standard.Link', tms: {} }, {}] },
    ]
    expect(collectUsedStencilIds(forms).sort()).toEqual(['cell_bus', 'cell_qw'])
  })

  it('пустой ввод → пустой массив', () => {
    expect(collectUsedStencilIds([])).toEqual([])
    expect(collectUsedStencilIds([{ cells: [] }, {}])).toEqual([])
  })
})

describe('projectZip', () => {
  it('round-trip: восстанавливает формы / символы / теги / иерархию', async () => {
    const bundle = {
      forms: [
        { id: 'main', viewSvg: '<svg>main</svg>', animationsJson: '{"a":1}' },
        { id: 'sub', viewSvg: '<svg>sub</svg>', animationsJson: '{}' },
      ],
      stencils: [{ id: 'cell_x', stencilJson: { id: 'cell_x', label: 'X' }, shapeSvg: '<g/>' }],
      tagsText: 'TAG1;Bool',
      hierarchy: [{ id: 'main', children: [{ id: 'sub', children: [] }] }],
    }
    const data = await readProjectZipFile(buildProjectZipBlob(bundle))

    expect(data.forms.map((f) => f.id).sort()).toEqual(['main', 'sub'])
    expect(data.forms.find((f) => f.id === 'main').svgText).toBe('<svg>main</svg>')
    expect(data.stencils).toEqual([
      { id: 'cell_x', stencilJson: { id: 'cell_x', label: 'X' }, shapeSvg: '<g/>' },
    ])
    expect(data.tagsText).toBe('TAG1;Bool')
    expect(data.hierarchy).toEqual([{ id: 'main', children: [{ id: 'sub', children: [] }] }])
  })

  it('id формы с путём наружу в архив не уезжает', () => {
    // Zip-slip: `forms/../../x/view.svg` при распаковке на объекте уедет за папку
    // проекта. Импорт такие имена чинит (utils/formIds), здесь — последний рубеж:
    // путь наружу не должен зависеть от того, что кто-то раньше проверил вход.
    for (const id of ['..', 'a/b', 'a\\b', '', 'f'.repeat(65)]) {
      expect(() =>
        buildProjectZipBlob({ forms: [{ id, viewSvg: '<svg/>', animationsJson: '{}' }] })
      ).toThrow(/Недопустимый id формы/)
    }
  })

  it('id символа тоже проверяется — путь строится здесь', () => {
    expect(() =>
      buildProjectZipBlob({
        forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
        stencils: [{ id: '../evil', stencilJson: {}, shapeSvg: '<g/>' }],
      })
    ).toThrow(/Недопустимый id символа/)
  })

  it('минимальный бандл (только формы) → нет символов/тегов/иерархии', async () => {
    const blob = buildProjectZipBlob({
      forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
    })
    const data = await readProjectZipFile(blob)
    expect(data.stencils).toEqual([])
    expect(data.tagsText).toBe(null)
    expect(data.hierarchy).toBe(null)
  })

  it('битый файл (не ZIP) → внятная ошибка', async () => {
    const bad = new Blob([new Uint8Array([1, 2, 3, 4])])
    await expect(readProjectZipFile(bad)).rejects.toThrow(/архив/)
  })
})

// Открытие проекта не требует File System Access API — иначе в Brave (FSA отключён
// по умолчанию) кнопка «Открыть» отвечала ошибкой и проект было нечем загрузить.
describe('pickProjectArchive', () => {
  it('отдаёт файл, полученный общим пикером (handle архиву не нужен)', async () => {
    const file = new File([''], 'project.zip')
    pickFile.mockResolvedValue({ file, handle: null })
    expect(await pickProjectArchive()).toBe(file)
    expect(pickFile).toHaveBeenCalledWith({
      extensions: ['.zip'],
      mime: 'application/zip',
      description: 'ZIP-архив проекта',
    })
  })

  it('отмена диалога → null', async () => {
    pickFile.mockResolvedValue(null)
    expect(await pickProjectArchive()).toBeNull()
  })
})
