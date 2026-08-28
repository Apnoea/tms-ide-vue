// Покрываем оркестрацию проектных операций (переключение / CRUD форм / импорт / экспорт).
// Реальные: dia.Graph + workspace-стор (Pinia). Мокаем canvas-singleton, notify,
// I/O-слои (projectZip/exporter/projectLoader/registry) и инжектим бэг зависимостей.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { dia } from '@joint/core'
import { tmsNamespace } from '../stencils/tmsStencil'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

// Отчёт сверки портов возвращаем как настоящая функция — вызывающий читает detached.
vi.mock('../stencils/svgInjector', () => ({
  reinjectAllStencils: vi.fn(() => ({ changed: 0, detached: [] })),
}))
// registerStencil возвращает успех: false = id символа вне маски (реальный
// реестр отклоняет такие), поэтому по умолчанию true.
vi.mock('../stencils/registry', () => ({
  getStencilById: vi.fn(() => null),
  registerStencil: vi.fn(() => true),
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

// Запись файлов в definitions/ — dev-плагин по HTTP; в тесте только факт вызова.
vi.mock('../services/stencilLibrary', () => ({ persistStencilsToDisk: vi.fn(async () => true) }))

// stencilOverrides — IDB-персист правок символов; в тесте детерминируем.
// stencilSignature — упрощённая, но чувствительная к json+svg (для ветки changed).
vi.mock('../services/stencilOverrides', () => ({
  replaceStencilOverrides: vi.fn(async () => {}),
  stencilSignature: (j, s) => `${JSON.stringify(j ?? {})}|${s || ''}`,
}))

const mockNotify = { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('./useNotify', () => ({ useNotify: () => mockNotify, TOAST_LIFE: {} }))

const mockCanvas = {
  graphRef: ref(null),
  paperRef: ref(null),
  bumpVersion: vi.fn(),
  clearSelection: vi.fn(),
  fitToContent: vi.fn(),
  markDirty: vi.fn(),
  markExported: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useProject } from './useProject'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { parseSvgProject } from '../services/projectLoader'
import { getStencilById, registerStencil } from '../stencils/registry'
import { replaceStencilOverrides } from '../services/stencilOverrides'
import { buildProjectZipBlob, pickProjectArchive, readProjectZipFile } from '../services/projectZip'
import { persistStencilsToDisk } from '../services/stencilLibrary'

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
    mockCanvas.paperRef.value = { id: 'paper', freeze() {}, unfreeze() {} }
    vi.clearAllMocks()
    parseSvgProject.mockReset()
    getStencilById.mockReturnValue(null)
    registerStencil.mockReturnValue(true) // тест на отклонённый id ставит свою
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

    it('инъекция разметки идёт ПОСЛЕ разморозки paper', async () => {
      // У замороженного paper'а нет представлений добавленных ячеек, поэтому
      // reinjectAllStencils внутри заморозки молча ничего не рисует — на схеме
      // остаются только провода (символы отрисовываются пустым body). Порядок:
      // freeze → fromJSON → unfreeze → инъекция.
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const unfreeze = vi.fn()
      mockCanvas.paperRef.value = { id: 'paper', freeze: vi.fn(), unfreeze }
      const { selectForm } = useProject(makeDeps())
      await selectForm('b')

      expect(unfreeze).toHaveBeenCalled()
      expect(unfreeze.mock.invocationCallOrder[0]).toBeLessThan(
        reinjectAllStencils.mock.invocationCallOrder[0]
      )
    })

    it('вписывает контент новой формы в область видимости', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const { selectForm } = useProject(makeDeps())
      await selectForm('b')
      await nextTick()
      // Иначе форма, нарисованная не у левого-верхнего угла, открывается за кадром:
      // zoom/translate остаются от прошлой формы.
      expect(mockCanvas.fitToContent).toHaveBeenCalled()
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
      // cancelPendingSnapshot вызывается до первого await (saveActiveForm).
      expect(deps.undo.cancelPendingSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
        deps.autosave.saveActiveForm.mock.invocationCallOrder[0]
      )
    })

    it('коммитит незакоммиченную правку текста ДО смены графа', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'a'
      )
      const deps = makeDeps()
      deps.textEditing.value = { id: 'cell-1' }
      const { selectForm } = useProject(deps)
      await selectForm('b')
      // Иначе правка ушла бы в никуда (ячейки уже нет), а textarea осталась бы
      // висеть над чужой формой.
      expect(deps.commitTextEdit).toHaveBeenCalled()
      expect(deps.commitTextEdit.mock.invocationCallOrder[0]).toBeLessThan(
        deps.autosave.saveActiveForm.mock.invocationCallOrder[0]
      )
    })

    it('без inline-правки текст не коммитим', async () => {
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
      expect(deps.commitTextEdit).not.toHaveBeenCalled()
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
    function bundle(
      forms,
      { stencils = [], tagsText = null, hierarchy = null, project = undefined } = {}
    ) {
      pickProjectArchive.mockResolvedValue({ name: 'project.zip' })
      readProjectZipFile.mockResolvedValue({ forms, stencils, tagsText, hierarchy, project })
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
        null,
        'project', // имя проекта = имя архива без .zip
        undefined // редакторная мета (project.json) — в этом архиве её нет
      )
      expect(mockNotify.success).toHaveBeenCalled()
    })

    it('небезопасные имена форм чинятся, ссылки на них переезжают', async () => {
      // id формы = имя папки в архиве + цель tms.navigation: `..` уводил бы файл за
      // папку проекта при обратном экспорте, поэтому чиним на импорте и тянем за
      // собой навигацию, иерархию и фон формы.
      bundle(
        [
          { id: '..', svgText: 'a' },
          { id: 'Схема 1', svgText: 'b' },
          { id: 'main', svgText: 'c' },
        ],
        {
          hierarchy: [{ id: 'main', children: [{ id: '..', children: [] }] }],
          project: { formBg: { 'Схема 1': '#101010' } },
        }
      )
      parseSvgProject.mockImplementation((svg) => ({
        ok: true,
        // На форме `main` кнопка ведёт на форму «..» — ссылка обязана переехать.
        cells: svg === 'c' ? [{ id: 'c1', tms: { navigation: '..' } }] : [],
        stencilIds: [],
      }))
      const deps = makeDeps()
      const { importProjectFromArchive } = useProject(deps)
      await importProjectFromArchive()

      const [formsArg, , hierarchyArg, , projectArg] = deps.autosave.replaceProject.mock.calls[0]
      const ids = formsArg.map((f) => f.id)
      expect(ids).toContain('main')
      expect(ids).toEqual(expect.arrayContaining([expect.stringMatching(/^form_\d+$/)]))
      expect(ids).not.toContain('..')
      // Навигация указывает на НОВОЕ имя формы, которая была «..».
      const navTarget = formsArg.find((f) => f.id === 'main').graphJson.cells[0].tms.navigation
      expect(ids).toContain(navTarget)
      expect(navTarget).not.toBe('..')
      // Иерархия и фон переехали вместе с формами.
      expect(hierarchyArg[0].children[0].id).toBe(navTarget)
      expect(Object.keys(projectArg.formBg)).toEqual([
        formsArg.find((f) => f.id !== 'main' && f.id !== navTarget).id,
      ])
      expect(mockNotify.warn).toHaveBeenCalledWith(
        'Формы переименованы',
        expect.stringContaining('→')
      )
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

    it('неполная запись в IDB → error и НЕ шлём символы (нет POST, нет reload)', async () => {
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

    it('изменённый существующий символ регистрируется и уходит в оверрайды', async () => {
      bundle([{ id: 'f1', svgText: 'x' }], {
        stencils: [
          {
            id: 'cell_qw',
            stencilJson: { id: 'cell_qw', stateColors: { on: '#f00' } },
            shapeSvg: 'NEW',
          },
        ],
      })
      parseSvgProject.mockReturnValue({ ok: true, cells: [], stencilIds: ['cell_qw'] })
      // cell_qw уже в реестре, но с другой заливкой/svg → должен перерегистрироваться.
      getStencilById.mockReturnValue({ id: 'cell_qw', stateColors: {}, svgText: 'OLD' })
      const deps = makeDeps()
      const { importProjectFromArchive } = useProject(deps)
      await importProjectFromArchive()

      expect(registerStencil).toHaveBeenCalledWith(
        { id: 'cell_qw', stateColors: { on: '#f00' } },
        'NEW'
      )
      const savedOverrides = replaceStencilOverrides.mock.calls.at(-1)[0]
      expect(savedOverrides.map((s) => s.id)).toEqual(['cell_qw'])
    })

    // id вне маски реестр не принимает: такой символ не должен попасть ни в
    // оверрайды IDB, ни на диск — иначе он вернулся бы после reload и уехал в
    // экспортный SVG/CSS. Пользователю говорим прямо, что символ пропущен.
    it('символ с отклонённым id не уходит в оверрайды, о нём предупреждаем', async () => {
      bundle([{ id: 'f1', svgText: 'x' }], {
        stencils: [
          { id: 'cell_ok', stencilJson: { id: 'cell_ok' }, shapeSvg: 'A' },
          { id: 'ev"il', stencilJson: { id: 'ev"il' }, shapeSvg: 'B' },
        ],
      })
      parseSvgProject.mockReturnValue({ ok: true, cells: [], stencilIds: [] })
      registerStencil.mockImplementation((json) => json.id === 'cell_ok')
      const deps = makeDeps()
      const { importProjectFromArchive } = useProject(deps)
      await importProjectFromArchive()

      const savedOverrides = replaceStencilOverrides.mock.calls.at(-1)[0]
      expect(savedOverrides.map((s) => s.id)).toEqual(['cell_ok'])
      expect(mockNotify.warn).toHaveBeenCalledWith('Символы с недопустимым id пропущены', 'ev"il')
    })

    // На диск (файл в definitions/ под git) идут только символы, которых в кодовой базе
    // нет. Архив хранит версию на момент экспорта — писать ею встроенный символ значит
    // откатывать правки репозитория при открытии старого проекта.
    it('на диск уходит только НОВЫЙ символ, изменённый встроенный — лишь в оверрайды', async () => {
      bundle([{ id: 'f1', svgText: 'x' }], {
        stencils: [
          { id: 'cell_new', stencilJson: { id: 'cell_new' }, shapeSvg: 'A' },
          { id: 'cell_qw', stencilJson: { id: 'cell_qw' }, shapeSvg: 'NEW' },
        ],
      })
      parseSvgProject.mockReturnValue({ ok: true, cells: [], stencilIds: [] })
      // cell_qw в реестре есть (и отличается), cell_new — нет.
      getStencilById.mockImplementation((id) =>
        id === 'cell_qw' ? { id: 'cell_qw', svgText: 'OLD' } : null
      )
      const { importProjectFromArchive } = useProject(makeDeps())
      await importProjectFromArchive()

      expect(replaceStencilOverrides.mock.calls.at(-1)[0].map((s) => s.id)).toEqual([
        'cell_new',
        'cell_qw',
      ])
      expect(persistStencilsToDisk.mock.calls.at(-1)[0].map((s) => s.id)).toEqual(['cell_new'])
    })

    it('неизменённый существующий символ НЕ перерегистрируется', async () => {
      bundle([{ id: 'f1', svgText: 'x' }], {
        stencils: [{ id: 'cell_qw', stencilJson: { id: 'cell_qw' }, shapeSvg: 'SAME' }],
      })
      parseSvgProject.mockReturnValue({ ok: true, cells: [], stencilIds: ['cell_qw'] })
      getStencilById.mockReturnValue({ id: 'cell_qw', svgText: 'SAME' })
      const deps = makeDeps()
      const { importProjectFromArchive } = useProject(deps)
      await importProjectFromArchive()

      expect(registerStencil).not.toHaveBeenCalled()
      const savedOverrides = replaceStencilOverrides.mock.calls.at(-1)[0]
      expect(savedOverrides).toEqual([]) // нечего оверрайдить
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

  describe('duplicateForm', () => {
    const cells = [{ id: 'c1', type: 'tms.Stencil', tms: { stencilId: 'cell_qw' } }]

    it('копирует граф под `<id>_copy`, персистит и открывает копию', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells } },
          { id: 'b', graphJson: { cells: [] } },
        ],
        'b'
      )
      const deps = makeDeps()
      const { duplicateForm } = useProject(deps)
      await duplicateForm('a')

      const ws = useWorkspaceStore()
      expect(ws.hasForm('a_copy')).toBe(true)
      expect(ws.activeFormId).toBe('a_copy')
      expect(ws.getFormGraph('a_copy').cells).toEqual(cells)
      expect(deps.autosave.saveActiveForm).toHaveBeenCalled() // дублируем актуальное
      expect(deps.autosave.persistForm).toHaveBeenCalledWith('a_copy', { cells })
      expect(deps.undo.initHistory).toHaveBeenCalled()
    })

    it('копия не делит ячейки с оригиналом (правка не течёт обратно)', async () => {
      seedForms([{ id: 'a', graphJson: { cells } }], 'a')
      const { duplicateForm } = useProject(makeDeps())
      await duplicateForm('a')

      const ws = useWorkspaceStore()
      const copy = ws.getFormGraph('a_copy')
      copy.cells[0].tms.stencilId = 'cell_bus'
      expect(ws.getFormGraph('a').cells[0].tms.stencilId).toBe('cell_qw')
    })

    it('повторное дублирование даёт `_copy2`, узел встаёт после исходной формы', async () => {
      seedForms(
        [
          { id: 'a', graphJson: { cells: [] } },
          { id: 'z', graphJson: { cells: [] } },
        ],
        'a'
      )
      const ws = useWorkspaceStore()
      ws.setFormTree(null) // плоское дерево, как после restore проекта без hierarchy.json
      const { duplicateForm } = useProject(makeDeps())
      await duplicateForm('a')
      await duplicateForm('a')

      expect(ws.hasForm('a_copy2')).toBe(true)
      // Сиблинг после исходной, а не последним узлом корня (там 'z').
      expect(ws.formTree.map((n) => n.id)).toEqual(['a', 'a_copy2', 'a_copy', 'z'])
    })

    it('несуществующую форму не дублирует', async () => {
      seedForms([{ id: 'a', graphJson: { cells: [] } }], 'a')
      const deps = makeDeps()
      const { duplicateForm } = useProject(deps)
      await duplicateForm('nope')

      expect(useWorkspaceStore().formIds).toEqual(['a'])
      expect(deps.autosave.persistForm).not.toHaveBeenCalled()
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
