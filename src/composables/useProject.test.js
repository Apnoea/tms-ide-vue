// Покрываем оркестрацию проектных операций (переключение / CRUD форм / импорт / экспорт).
// Реальные: dia.Graph + workspace-стор (Pinia). Мокаем canvas-singleton, notify,
// I/O-слои (projectZip/exporter/projectLoader/registry) и инжектим бэг зависимостей.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { dia } from '@joint/core'
import { tmsNamespace } from '../stencils/tmsStencil'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

vi.mock('../stencils/svgInjector', () => ({ reinjectAllStencils: vi.fn() }))
vi.mock('../stencils/registry', () => ({
  getStencilById: vi.fn(() => null),
  registerStencil: vi.fn(),
}))
vi.mock('../services/exporter', () => ({
  exportProject: vi.fn(() => ({ svgText: '<svg/>', animationsJson: '{}' })),
}))
vi.mock('../services/projectLoader', () => ({ parseSvgProject: vi.fn() }))
vi.mock('../services/projectZip', () => ({
  buildProjectZipBlob: vi.fn(() => 'BLOB'),
  downloadBlob: vi.fn(),
  pickProjectArchive: vi.fn(),
  readProjectZipFile: vi.fn(),
  collectUsedStencilIds: vi.fn(() => []),
}))

const mockNotify = { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('./useNotify', () => ({ useNotify: () => mockNotify, TOAST_LIFE: {} }))

const mockCanvas = {
  graphRef: ref(null),
  paperRef: ref(null),
  bumpVersion: vi.fn(),
  clearSelection: vi.fn(),
  fitToContent: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useProject } from './useProject'
import { parseSvgProject } from '../services/projectLoader'
import { getStencilById } from '../stencils/registry'
import { buildProjectZipBlob, pickProjectArchive, readProjectZipFile } from '../services/projectZip'

// Свежие моки инжектируемых зависимостей на каждый тест.
function makeDeps(overrides = {}) {
  return {
    restoringHistory: ref(false),
    autosave: {
      saveActiveForm: vi.fn(async () => {}),
      persistMeta: vi.fn(async () => true),
      replaceProject: vi.fn(async () => true),
      readTagsText: vi.fn(async () => null),
      persistForm: vi.fn(async () => true),
      removeFormPersist: vi.fn(async () => {}),
      ...overrides.autosave,
    },
    undo: { cancelPendingSnapshot: vi.fn(), initHistory: vi.fn(), ...overrides.undo },
    simulation: { stopSimulation: vi.fn(), simulating: ref(false), ...overrides.simulation },
    commitTextEdit: vi.fn(),
    textEditing: ref(false),
  }
}

describe('useProject', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockCanvas.graphRef.value = new dia.Graph({}, { cellNamespace: tmsNamespace })
    mockCanvas.paperRef.value = { id: 'paper' }
    vi.clearAllMocks()
    parseSvgProject.mockReset()
    getStencilById.mockReturnValue(null)
  })

  function seedForms(list, active) {
    useWorkspaceStore().loadForms(list, active)
  }

  describe('selectForm', () => {
    it('сохраняет текущую, переключает активную, грузит выбранную, сбрасывает undo', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const deps = makeDeps()
      const { selectForm } = useProject(deps)
      await selectForm('b')

      expect(deps.autosave.saveActiveForm).toHaveBeenCalled()
      expect(useWorkspaceStore().activeFormId).toBe('b')
      expect(deps.autosave.persistMeta).toHaveBeenCalled()
      expect(deps.undo.initHistory).toHaveBeenCalled()
      expect(mockCanvas.clearSelection).toHaveBeenCalled()
    })

    it('гасит pending snapshot ДО первого await (иначе таймер пишет граф A под ключ B)', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const deps = makeDeps()
      const { selectForm } = useProject(deps)
      await selectForm('b')
      // cancelPendingSnapshot вызван раньше saveActiveForm (первый await).
      expect(deps.undo.cancelPendingSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
        deps.autosave.saveActiveForm.mock.invocationCallOrder[0]
      )
    })

    it('no-op при выборе уже активной формы', async () => {
      seedForms([{ id: 'a', graphJson: { cells: [] } }], 'a')
      const deps = makeDeps()
      const { selectForm } = useProject(deps)
      await selectForm('a')
      expect(deps.autosave.saveActiveForm).not.toHaveBeenCalled()
    })
  })

  describe('projectBusy (взаимное исключение)', () => {
    it('пока selectForm в await, exportProjectToArchive возвращается рано', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      let releaseSave
      const deps = makeDeps({
        autosave: { saveActiveForm: vi.fn(() => new Promise((r) => (releaseSave = r))) },
      })
      const { selectForm, exportProjectToArchive } = useProject(deps)

      const p1 = selectForm('b') // входит, ставит projectBusy, виснет на saveActiveForm
      await exportProjectToArchive() // projectBusy=true → ранний выход
      expect(buildProjectZipBlob).not.toHaveBeenCalled()

      releaseSave()
      await p1
    })
  })

  describe('importProjectFromArchive', () => {
    function bundle(forms, { stencils = [], tagsText = null, hierarchy = null } = {}) {
      pickProjectArchive.mockResolvedValue({ name: 'project.zip' })
      readProjectZipFile.mockResolvedValue({ forms, stencils, tagsText, hierarchy })
    }

    it('пустая валидная форма сохраняется (цель навигации не теряется)', async () => {
      bundle([{ id: 'f1', svgText: '<svg/>' }])
      parseSvgProject.mockReturnValue({ ok: true, cells: [], stencilIds: [] })
      const deps = makeDeps()
      const { importProjectFromArchive } = useProject(deps)
      await importProjectFromArchive()

      expect(deps.autosave.replaceProject).toHaveBeenCalledWith(
        [{ id: 'f1', graphJson: { cells: [] } }],
        null,
        null
      )
      expect(mockNotify.success).toHaveBeenCalled()
    })

    it('битый SVG пропускается, валидные формы импортируются', async () => {
      bundle([
        { id: 'good', svgText: 'ok' },
        { id: 'bad', svgText: 'broken' },
      ])
      parseSvgProject.mockImplementation((svg) =>
        svg === 'ok'
          ? { ok: true, cells: [], stencilIds: [] }
          : { ok: false, cells: [], stencilIds: [] }
      )
      const deps = makeDeps()
      const { importProjectFromArchive } = useProject(deps)
      await importProjectFromArchive()

      const formsArg = deps.autosave.replaceProject.mock.calls[0][0]
      expect(formsArg.map((f) => f.id)).toEqual(['good'])
    })

    it('отмена picker (нет файла) → ничего не парсим', async () => {
      pickProjectArchive.mockResolvedValue(null)
      const deps = makeDeps()
      const { importProjectFromArchive } = useProject(deps)
      await importProjectFromArchive()
      expect(readProjectZipFile).not.toHaveBeenCalled()
      expect(deps.autosave.replaceProject).not.toHaveBeenCalled()
    })

    it('неполная запись в IDB → error и НЕ шлём стенсилы (нет POST, нет reload)', async () => {
      bundle([{ id: 'f1', svgText: 'x' }], {
        stencils: [{ id: 'cell_new', stencilJson: {}, shapeSvg: '' }],
      })
      parseSvgProject.mockReturnValue({ ok: true, cells: [], stencilIds: [] })
      getStencilById.mockReturnValue(null) // cell_new не в реестре → был бы POST
      global.fetch = vi.fn(() => Promise.resolve({ ok: true }))
      const deps = makeDeps({ autosave: { replaceProject: vi.fn(async () => false) } })
      const { importProjectFromArchive } = useProject(deps)
      await importProjectFromArchive()

      expect(mockNotify.error).toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe('exportProjectToArchive', () => {
    it('прогоняет все формы в .zip-бандл, возвращает активную, НЕ сбрасывает undo', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const deps = makeDeps()
      const { exportProjectToArchive } = useProject(deps)
      await exportProjectToArchive()

      const bundleArg = buildProjectZipBlob.mock.calls[0][0]
      expect(bundleArg.forms.map((f) => f.id)).toEqual(['a', 'b'])
      // Активная форма восстановлена, undo НЕ сброшен (граф идентичен дозкспортному).
      expect(useWorkspaceStore().activeFormId).toBe('a')
      expect(deps.undo.initHistory).not.toHaveBeenCalled()
      expect(deps.undo.cancelPendingSnapshot).toHaveBeenCalled()
    })
  })

  describe('createForm', () => {
    it('создаёт уникальную пустую форму, персистит и делает активной', async () => {
      seedForms([{ id: 'form1', graphJson: { cells: [] } }], 'form1')
      const deps = makeDeps()
      const { createForm } = useProject(deps)
      await createForm()

      const ws = useWorkspaceStore()
      expect(ws.formIds).toEqual(['form1', 'form2']) // form1 занят → form2
      expect(ws.activeFormId).toBe('form2')
      expect(deps.autosave.persistForm).toHaveBeenCalledWith('form2', { cells: [] })
      expect(deps.autosave.persistMeta).toHaveBeenCalled()
      expect(deps.undo.initHistory).toHaveBeenCalled()
    })
  })

  describe('deleteForm', () => {
    it('последнюю форму удалить нельзя', async () => {
      seedForms([{ id: 'a', graphJson: { cells: [] } }], 'a')
      const deps = makeDeps()
      const { deleteForm } = useProject(deps)
      await deleteForm('a')
      expect(useWorkspaceStore().formIds).toEqual(['a'])
      expect(mockNotify.warn).toHaveBeenCalled()
      expect(deps.autosave.removeFormPersist).not.toHaveBeenCalled()
    })

    it('удаление активной переключает холст на оставшуюся', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const deps = makeDeps()
      const { deleteForm } = useProject(deps)
      await deleteForm('a')

      const ws = useWorkspaceStore()
      expect(ws.formIds).toEqual(['b'])
      expect(ws.activeFormId).toBe('b')
      expect(deps.autosave.removeFormPersist).toHaveBeenCalledWith('a')
      expect(deps.undo.initHistory).toHaveBeenCalled() // активная сменилась → reload
    })

    it('удаление не активной не перегружает холст', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const deps = makeDeps()
      const { deleteForm } = useProject(deps)
      await deleteForm('b')

      expect(useWorkspaceStore().activeFormId).toBe('a')
      expect(deps.autosave.saveActiveForm).toHaveBeenCalled() // активную сохранили
      expect(deps.undo.initHistory).not.toHaveBeenCalled() // холст не трогали
    })
  })

  describe('renameForm', () => {
    it('переименовывает: перенос ключа в IDB (new write + old del) + meta', async () => {
      seedForms([{ id: 'a', graphJson: { cells: [{ id: 'x' }] } }], 'a')
      const deps = makeDeps()
      const { renameForm } = useProject(deps)
      const ok = await renameForm('a', 'substation')

      expect(ok).toBe(true)
      const ws = useWorkspaceStore()
      expect(ws.formIds).toEqual(['substation'])
      expect(ws.activeFormId).toBe('substation')
      expect(deps.autosave.persistForm).toHaveBeenCalledWith('substation', { cells: [{ id: 'x' }] })
      expect(deps.autosave.removeFormPersist).toHaveBeenCalledWith('a')
    })

    it('чинит tms.navigation-ссылки на старое имя во всех формах', async () => {
      seedForms(
        [
          { id: 'editor', graphJson: { cells: [] } }, // активная, пустая (без reload)
          {
            id: 'home',
            graphJson: { cells: [{ id: 'c1', type: 'tms.Stencil', tms: { navigation: 'sub' } }] },
          },
          { id: 'sub', graphJson: { cells: [] } },
        ],
        'editor'
      )
      const deps = makeDeps()
      const { renameForm } = useProject(deps)
      await renameForm('sub', 'substation')

      const ws = useWorkspaceStore()
      expect(ws.getFormGraph('home').cells[0].tms.navigation).toBe('substation')
      expect(deps.autosave.persistForm).toHaveBeenCalledWith(
        'home',
        expect.objectContaining({
          cells: [{ id: 'c1', type: 'tms.Stencil', tms: { navigation: 'substation' } }],
        })
      )
    })

    it('отклоняет недопустимое имя и занятое, IDB не трогает', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const deps = makeDeps()
      const { renameForm } = useProject(deps)

      expect(await renameForm('a', 'with space')).toBe(false) // невалидно
      expect(await renameForm('a', 'b')).toBe(false) // занято
      expect(deps.autosave.persistForm).not.toHaveBeenCalled()
      expect(useWorkspaceStore().formIds).toEqual(['a', 'b'])
    })
  })
})
