import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  collectUsedStencilIds,
  writeProjectFolder,
  readProjectFolder,
  pickOutputFolder,
} from './projectIO'

// ─── In-memory мок File System Access API ───
function makeFile(name) {
  const file = { kind: 'file', name, _content: '' }
  file.getFile = async () => ({ text: async () => file._content })
  file.createWritable = async () => ({
    write: async (t) => {
      file._content = t
    },
    close: async () => {},
  })
  return file
}

function makeDir(name = 'root') {
  const children = new Map()
  return {
    kind: 'directory',
    name,
    async getDirectoryHandle(n, opts) {
      if (!children.has(n)) {
        if (!opts?.create) throw Object.assign(new Error('no dir'), { name: 'NotFoundError' })
        children.set(n, makeDir(n))
      }
      return children.get(n)
    },
    async getFileHandle(n, opts) {
      if (!children.has(n)) {
        if (!opts?.create) throw Object.assign(new Error('no file'), { name: 'NotFoundError' })
        children.set(n, makeFile(n))
      }
      return children.get(n)
    },
    async *values() {
      yield* children.values()
    },
  }
}

afterEach(() => {
  delete window.showDirectoryPicker
})

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

describe('writeProjectFolder / readProjectFolder round-trip', () => {
  it('форма + стенсил + теги переживают write→read', async () => {
    const root = makeDir()
    await writeProjectFolder(root, {
      forms: [
        { id: 'main', viewSvg: '<svg>main</svg>', animationsJson: '{"animations":{}}' },
        { id: 'feeder', viewSvg: '<svg>feeder</svg>', animationsJson: '{}' },
      ],
      stencils: [
        { id: 'cell_custom', stencilJson: { id: 'cell_custom', width: 20 }, shapeSvg: '<svg/>' },
      ],
      tagsText: 'TAG1;Bool\nTAG2;Float',
    })

    window.showDirectoryPicker = vi.fn(async () => root)
    const out = await readProjectFolder()

    expect(out.forms.map((f) => f.id).sort()).toEqual(['feeder', 'main'])
    expect(out.forms.find((f) => f.id === 'main').svgText).toBe('<svg>main</svg>')
    expect(out.stencils).toHaveLength(1)
    expect(out.stencils[0]).toMatchObject({
      id: 'cell_custom',
      stencilJson: { id: 'cell_custom', width: 20 },
      shapeSvg: '<svg/>',
    })
    expect(out.tagsText).toBe('TAG1;Bool\nTAG2;Float')
  })

  it('readProjectFolder возвращает null при отмене пикера', async () => {
    window.showDirectoryPicker = vi.fn(async () => {
      throw Object.assign(new Error('cancel'), { name: 'AbortError' })
    })
    expect(await readProjectFolder()).toBeNull()
  })

  it('пустая папка → пустые формы/стенсилы, tagsText=null', async () => {
    window.showDirectoryPicker = vi.fn(async () => makeDir())
    const out = await readProjectFolder()
    expect(out.forms).toEqual([])
    expect(out.stencils).toEqual([])
    expect(out.tagsText).toBeNull()
  })

  it('pickOutputFolder возвращает null при отмене', async () => {
    window.showDirectoryPicker = vi.fn(async () => {
      throw Object.assign(new Error('cancel'), { name: 'AbortError' })
    })
    expect(await pickOutputFolder()).toBeNull()
  })
})
