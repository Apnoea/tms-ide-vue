// Round-trip ZIP-архива проекта: buildProjectZipBlob ↔ readProjectZipFile.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./fileSystem', () => ({ pickFile: vi.fn() }))

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { buildProjectZipBlob, readProjectZipFile, pickProjectArchive } from './projectZip'
import { pickFile } from './fileSystem'

describe('projectZip', () => {
  it('round-trip: восстанавливает формы / символы / теги / иерархию', async () => {
    const bundle = {
      projectId: 'PRJ',
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

  // Архив распаковывается прямо в projects/ сервера: списки уровня папки, проект —
  // своей директорией, формы под views/.
  it('раскладка WebScada: списки в корне, nav и views внутри проекта', async () => {
    const blob = buildProjectZipBlob({
      projectId: 'PRJ',
      forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
      stencils: [{ id: 'cell_x', stencilJson: { id: 'cell_x' }, shapeSvg: '<g/>' }],
      tagsText: 'TAG1;Bool',
      hierarchy: [{ id: 'main', children: [] }],
    })
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual([
      'PRJ/library/cell_x/shape.svg',
      'PRJ/library/cell_x/stencil.json',
      'PRJ/nav.json',
      'PRJ/taglist.csv',
      'PRJ/views/main/animations.json',
      'PRJ/views/main/view.svg',
      'projects-list.json',
      'user-projects.json',
    ])
    const json = (p) => JSON.parse(strFromU8(entries[p]))
    expect(json('projects-list.json')).toEqual([{ id: 'PRJ', name: 'PRJ', description: '' }])
    expect(json('user-projects.json')).toEqual({ test: ['PRJ'] })
    // Узел навигации несёт viewId и подпись; своего названия у формы нет — это её id.
    expect(json('PRJ/nav.json')).toEqual([{ viewId: 'main', name: 'main', children: [] }])
  })

  it('nav.json пишется даже пустым: без него сервер не покажет проект', async () => {
    const blob = buildProjectZipBlob({
      projectId: 'PRJ',
      forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
    })
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(JSON.parse(strFromU8(entries['PRJ/nav.json']))).toEqual([])
  })

  // Архивы прошлой раскладки (forms/ и hierarchy.json в корне) должны открываться.
  it('читает прошлую раскладку: forms/ + hierarchy.json', async () => {
    const files = {
      'forms/main/view.svg': strToU8('<svg>old</svg>'),
      'forms/main/animations.json': strToU8('{}'),
      'library/cell_x/stencil.json': strToU8('{"id":"cell_x"}'),
      'library/cell_x/shape.svg': strToU8('<g/>'),
      'taglist.csv': strToU8('TAG1;Bool'),
      'hierarchy.json': strToU8('[{"id":"main","children":[]}]'),
    }
    const data = await readProjectZipFile(new Blob([zipSync(files)]))
    expect(data.forms).toEqual([{ id: 'main', svgText: '<svg>old</svg>' }])
    expect(data.stencils.map((s) => s.id)).toEqual(['cell_x'])
    expect(data.tagsText).toBe('TAG1;Bool')
    expect(data.hierarchy).toEqual([{ id: 'main', children: [] }])
  })

  it('nav.json одним корневым узлом (форма WebScada) читается как дерево', async () => {
    const files = {
      'PRJ/views/root/view.svg': strToU8('<svg/>'),
      'PRJ/nav.json': strToU8(
        '{"viewId":"root","name":"Подстанция","children":[{"viewId":"sub"}]}'
      ),
    }
    const data = await readProjectZipFile(new Blob([zipSync(files)]))
    expect(data.hierarchy).toEqual([{ id: 'root', children: [{ id: 'sub', children: [] }] }])
  })

  it('XML-дерево тегов уезжает как taglist.xml и читается обратно', async () => {
    // Tag-list возвращается скадисту тем же файлом, что он дал: формат сохраняем.
    const tagsText = '<?xml version="1.0"?>\n<Root><Tag name="A" type="Boolean"/></Root>'
    const data = await readProjectZipFile(
      buildProjectZipBlob({
        projectId: 'PRJ',
        forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
        tagsText,
      })
    )
    expect(data.tagsText).toBe(tagsText)
  })

  it('id формы с путём наружу в архив не уезжает', () => {
    // Zip-slip: `forms/../../x/view.svg` при распаковке уедет за папку проекта. Имена
    // чинит импорт (utils/formIds), здесь последний рубеж — путь наружу не должен
    // зависеть от проверки на входе.
    for (const id of ['..', 'a/b', 'a\\b', '', 'f'.repeat(65)]) {
      expect(() =>
        buildProjectZipBlob({
          projectId: 'PRJ',
          forms: [{ id, viewSvg: '<svg/>', animationsJson: '{}' }],
        })
      ).toThrow(/Недопустимый id формы/)
    }
  })

  it('id символа тоже проверяется — путь строится здесь', () => {
    expect(() =>
      buildProjectZipBlob({
        projectId: 'PRJ',
        forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
        stencils: [{ id: '../evil', stencilJson: {}, shapeSvg: '<g/>' }],
      })
    ).toThrow(/Недопустимый id символа/)
  })

  it('id проекта тоже проверяется — он имя папки в архиве', () => {
    expect(() =>
      buildProjectZipBlob({
        projectId: '../evil',
        forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
      })
    ).toThrow(/Недопустимый id проекта/)
  })

  it('минимальный бандл (только формы) → нет символов и тегов, дерево пустое', async () => {
    const blob = buildProjectZipBlob({
      projectId: 'PRJ',
      forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
    })
    const data = await readProjectZipFile(blob)
    expect(data.stencils).toEqual([])
    expect(data.tagsText).toBe(null)
    // nav.json пишется всегда, поэтому дерево приходит пустым, а не отсутствующим.
    expect(data.hierarchy).toEqual([])
    expect(data.presets).toEqual([])
  })

  // Исходники наборов едут отдельной папкой: в library/ символы уже с правками проекта,
  // и поставку из них не восстановить.
  describe('наборы в архиве', () => {
    const qw = { id: 'demo_qw', stencilJson: { id: 'demo_qw', label: 'В' }, shapeSvg: '<g/>' }
    const preset = { id: 'demo', name: 'Демо', version: '1.0', description: 'д', stencils: [qw] }

    it('пишутся раскладкой .zip набора внутри папки проекта', async () => {
      const blob = buildProjectZipBlob({
        projectId: 'PRJ',
        forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
        presets: [preset],
      })
      const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
      expect(
        Object.keys(entries)
          .filter((p) => p.includes('presets/'))
          .sort()
      ).toEqual([
        'PRJ/presets/demo/library/demo_qw/shape.svg',
        'PRJ/presets/demo/library/demo_qw/stencil.json',
        'PRJ/presets/demo/preset.json',
      ])
      expect(JSON.parse(strFromU8(entries['PRJ/presets/demo/preset.json']))).toEqual({
        id: 'demo',
        name: 'Демо',
        version: '1.0',
        description: 'д',
      })
    })

    it('читаются обратно тем же разбором, что отдельный .zip набора', async () => {
      const data = await readProjectZipFile(
        buildProjectZipBlob({
          projectId: 'PRJ',
          forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
          presets: [preset],
        })
      )
      expect(data.presets).toEqual([preset])
      // Символы набора из presets/ не смешиваются с символами проекта из library/.
      expect(data.stencils).toEqual([])
    })

    it('битый набор пропускается, проект открывается', async () => {
      const files = {
        'PRJ/views/main/view.svg': strToU8('<svg/>'),
        'PRJ/presets/bad/preset.json': strToU8('{oops'),
      }
      const data = await readProjectZipFile(new Blob([zipSync(files)]))
      expect(data.forms).toHaveLength(1)
      expect(data.presets).toEqual([])
    })

    it('id набора проверяется — он имя папки в архиве', () => {
      expect(() =>
        buildProjectZipBlob({
          projectId: 'PRJ',
          forms: [{ id: 'main', viewSvg: '<svg/>', animationsJson: '{}' }],
          presets: [{ ...preset, id: '../evil' }],
        })
      ).toThrow(/Недопустимый id набора/)
    })
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
