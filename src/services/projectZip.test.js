// Round-trip ZIP-архива проекта: buildProjectZipBlob ↔ readProjectZipFile.
import { describe, it, expect } from 'vitest'
import { buildProjectZipBlob, readProjectZipFile, collectUsedStencilIds } from './projectZip'

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
  it('round-trip: восстанавливает формы / стенсилы / теги / иерархию', async () => {
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

  it('минимальный бандл (только формы) → нет стенсилов/тегов/иерархии', async () => {
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
