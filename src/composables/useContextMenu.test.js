// Пункт «Удалить»: работает через selection (как Del и остальные пункты меню),
// счётчик в label не обещает больше, чем удалится (замок не даёт удалить).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withSetup, makeMockCanvas } from './test-utils'

const mockCanvas = makeMockCanvas({
  selection: { value: [] },
  isSelected: vi.fn((id) => mockCanvas.selection.value.some((i) => i.id === id)),
  setSelection: vi.fn(),
  selectOnly: vi.fn(),
  expandGroups: vi.fn((items) => items),
  deleteItems: vi.fn(),
  toggleLocked: vi.fn(),
  reorderCells: vi.fn(),
  groupCells: vi.fn(),
  ungroupCells: vi.fn(),
  cellsOfStencil: vi.fn(() => []),
  selectSameStencil: vi.fn(),
  selectAllCells: vi.fn(),
  fitToContent: vi.fn(),
  // Как в useCanvas: возвращает модели без locked (линки не отбрасывает).
  writableItems: vi.fn((items) =>
    (items || [])
      .map((i) => mockCanvas.graphRef.value?.getCell(i.id))
      .filter((c) => c && !c.get('tms')?.locked)
  ),
})
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useContextMenu } from './useContextMenu'

/** Граф-мок: id → tms. */
function graphOf(cells) {
  return {
    getCell: (id) => (cells[id] ? { get: () => cells[id] } : null),
    getElements: () => Object.keys(cells).map((id) => ({ id, get: () => cells[id] })),
  }
}

function setup(overrides = {}) {
  const [api, scope] = withSetup(() =>
    useContextMenu({
      hasClipboard: () => false,
      pasteClipboard: vi.fn(),
      copySelection: vi.fn(),
      duplicateSelection: vi.fn(),
      ...overrides,
    })
  )
  return { api, scope }
}

/** Пункты меню для таргета (null — пустое место). */
function itemsFor(api, target) {
  api.showContextMenu(target, { preventDefault() {} })
  return api.ctxItems.value
}

/** Показывает меню для таргета и достаёт пункт «Удалить». */
function deleteItemFor(api, target) {
  api.showContextMenu(target, { preventDefault() {} })
  return api.ctxItems.value.find((i) => i.label?.startsWith('Удалить'))
}

describe('useContextMenu — «Удалить»', () => {
  beforeEach(() => {
    mockCanvas.deleteItems.mockClear()
    mockCanvas.selection.value = []
    mockCanvas.graphRef.value = null
  })

  it('ПКМ по элементу из выделения удаляет ВСЁ выделение', () => {
    mockCanvas.graphRef.value = graphOf({ a: {}, b: {}, w1: {} })
    const sel = [
      { kind: 'cell', id: 'a' },
      { kind: 'cell', id: 'b' },
      { kind: 'link', id: 'w1' },
    ]
    mockCanvas.selection.value = sel
    const { api, scope } = setup()

    const item = deleteItemFor(api, { kind: 'cell', id: 'b' })
    expect(item.label).toBe('Удалить (3)')
    item.command()
    expect(mockCanvas.deleteItems).toHaveBeenCalledWith(sel)
    scope.stop()
  })

  it('locked-ячейки не попадают в счётчик — label не обещает лишнего', () => {
    mockCanvas.graphRef.value = graphOf({ a: {}, b: { locked: true }, c: {} })
    mockCanvas.selection.value = [
      { kind: 'cell', id: 'a' },
      { kind: 'cell', id: 'b' },
      { kind: 'cell', id: 'c' },
    ]
    const { api, scope } = setup()
    expect(deleteItemFor(api, { kind: 'cell', id: 'a' }).label).toBe('Удалить (2)')
    scope.stop()
  })

  it('одиночная цель — label без счётчика, удаляется только она', () => {
    mockCanvas.graphRef.value = graphOf({ a: {} })
    mockCanvas.selection.value = [{ kind: 'cell', id: 'a' }]
    const { api, scope } = setup()

    const item = deleteItemFor(api, { kind: 'cell', id: 'a' })
    expect(item.label).toBe('Удалить')
    item.command()
    expect(mockCanvas.deleteItems).toHaveBeenCalledWith([{ kind: 'cell', id: 'a' }])
    scope.stop()
  })

  it('провод из выделения тоже удаляет всё выделение', () => {
    mockCanvas.graphRef.value = graphOf({ a: {}, w1: {} })
    const sel = [
      { kind: 'cell', id: 'a' },
      { kind: 'link', id: 'w1' },
    ]
    mockCanvas.selection.value = sel
    const { api, scope } = setup()

    const item = deleteItemFor(api, { kind: 'link', id: 'w1' })
    expect(item.label).toBe('Удалить (2)')
    item.command()
    expect(mockCanvas.deleteItems).toHaveBeenCalledWith(sel)
    scope.stop()
  })
})

// Замок доступен и в мультивыделении/на группе: toggleLocked групповой, иначе
// подложку из десятка символов пришлось бы лочить по одному.
describe('useContextMenu — замок', () => {
  beforeEach(() => {
    mockCanvas.toggleLocked.mockClear()
    mockCanvas.selection.value = []
    mockCanvas.graphRef.value = null
  })

  function lockItemFor(api, target) {
    api.showContextMenu(target, { preventDefault() {} })
    return api.ctxItems.value.find((i) => /блокировать/.test(i.label || ''))
  }

  it('мультивыделение: пункт есть, со счётчиком, и лочит всё выделение', () => {
    mockCanvas.graphRef.value = graphOf({ a: {}, b: {}, c: {} })
    const sel = [
      { kind: 'cell', id: 'a' },
      { kind: 'cell', id: 'b' },
      { kind: 'cell', id: 'c' },
    ]
    mockCanvas.selection.value = sel
    const { api, scope } = setup()

    const item = lockItemFor(api, { kind: 'cell', id: 'b' })
    expect(item.label).toBe('Заблокировать (3)')
    item.command()
    expect(mockCanvas.toggleLocked).toHaveBeenCalledWith(sel)
    scope.stop()
  })

  it('часть выделения свободна → пункт лочит (как toggleLocked), а не разлочивает', () => {
    mockCanvas.graphRef.value = graphOf({ a: { locked: true }, b: {} })
    mockCanvas.selection.value = [
      { kind: 'cell', id: 'a' },
      { kind: 'cell', id: 'b' },
    ]
    const { api, scope } = setup()
    expect(lockItemFor(api, { kind: 'cell', id: 'a' }).label).toBe('Заблокировать (2)')
    scope.stop()
  })

  it('всё выделение заблокировано → «Разблокировать»', () => {
    mockCanvas.graphRef.value = graphOf({ a: { locked: true }, b: { locked: true } })
    mockCanvas.selection.value = [
      { kind: 'cell', id: 'a' },
      { kind: 'cell', id: 'b' },
    ]
    const { api, scope } = setup()
    expect(lockItemFor(api, { kind: 'cell', id: 'b' }).label).toBe('Разблокировать (2)')
    scope.stop()
  })

  it('одиночная ячейка — label без счётчика', () => {
    mockCanvas.graphRef.value = graphOf({ a: {} })
    mockCanvas.selection.value = [{ kind: 'cell', id: 'a' }]
    const { api, scope } = setup()
    expect(lockItemFor(api, { kind: 'cell', id: 'a' }).label).toBe('Заблокировать')
    scope.stop()
  })
})

// Порядок наложения меняет `z`, а он уезжает в мету и в порядок элементов view.svg —
// под замком этого быть не должно (reorderCells отсеивает locked).
describe('useContextMenu — «Порядок»', () => {
  const orderItemFor = (api, target) => {
    api.showContextMenu(target, { preventDefault() {} })
    return api.ctxItems.value.find((i) => i.label === 'Порядок')
  }

  beforeEach(() => {
    mockCanvas.selection.value = []
    mockCanvas.graphRef.value = null
  })

  it('заблокированная ячейка — пункта нет', () => {
    mockCanvas.graphRef.value = graphOf({ a: { locked: true } })
    mockCanvas.selection.value = [{ kind: 'cell', id: 'a' }]
    const { api, scope } = setup()
    expect(orderItemFor(api, { kind: 'cell', id: 'a' })).toBeUndefined()
    scope.stop()
  })

  it('в выделении есть свободная — пункт остаётся', () => {
    mockCanvas.graphRef.value = graphOf({ a: { locked: true }, b: {} })
    mockCanvas.selection.value = [
      { kind: 'cell', id: 'a' },
      { kind: 'cell', id: 'b' },
    ]
    const { api, scope } = setup()
    expect(orderItemFor(api, { kind: 'cell', id: 'a' })).toBeTruthy()
    scope.stop()
  })

  it('провод: замка у него нет — пункт на месте', () => {
    mockCanvas.graphRef.value = graphOf({ w1: {} })
    mockCanvas.selection.value = [{ kind: 'link', id: 'w1' }]
    const { api, scope } = setup()
    expect(orderItemFor(api, { kind: 'link', id: 'w1' })).toBeTruthy()
    scope.stop()
  })
})

// Пункты про символ под курсором: открыть его в редакторе (подпись и режим — как у
// карандаша в палитре) и выделить его экземпляры на форме.
describe('useContextMenu — символ под курсором', () => {
  beforeEach(() => {
    mockCanvas.selection.value = []
    mockCanvas.cellsOfStencil.mockReset().mockReturnValue([])
    mockCanvas.selectSameStencil.mockClear()
  })

  it('«Редактировать символ» открывает редактор на символе под курсором', () => {
    mockCanvas.graphRef.value = graphOf({ a: { stencilId: 'cell_qw' } })
    mockCanvas.selection.value = [{ kind: 'cell', id: 'a' }]
    const editStencil = vi.fn()
    const { api, scope } = setup({ editStencil })
    itemsFor(api, { kind: 'cell', id: 'a' })
      .find((i) => i.label === 'Редактировать символ')
      .command()
    expect(editStencil).toHaveBeenCalledWith('cell_qw')
    scope.stop()
  })

  it('шина правится только диапазонами — пункт так и называется', () => {
    mockCanvas.graphRef.value = graphOf({ b: { stencilId: 'cell_bus' } })
    mockCanvas.selection.value = [{ kind: 'cell', id: 'b' }]
    const { api, scope } = setup()
    const labels = itemsFor(api, { kind: 'cell', id: 'b' }).map((i) => i.label)
    expect(labels).toContain('Диапазоны шины')
    expect(labels).not.toContain('Редактировать символ')
    scope.stop()
  })

  it('«Выделить такие же» — только когда экземпляров больше одного', () => {
    mockCanvas.graphRef.value = graphOf({ a: { stencilId: 'cell_qw' } })
    mockCanvas.selection.value = [{ kind: 'cell', id: 'a' }]
    const { api, scope } = setup()
    const same = () =>
      itemsFor(api, { kind: 'cell', id: 'a' }).find((i) => i.label?.startsWith('Выделить такие'))

    mockCanvas.cellsOfStencil.mockReturnValue([{ id: 'a' }])
    expect(same()).toBeUndefined()

    mockCanvas.cellsOfStencil.mockReturnValue([{ id: 'a' }, { id: 'b' }])
    const item = same()
    expect(item.label).toBe('Выделить такие же (2)')
    item.command()
    expect(mockCanvas.selectSameStencil).toHaveBeenCalledWith('cell_qw')
    scope.stop()
  })

  it('у фигуры разметки символа нет — и пунктов про него нет', () => {
    mockCanvas.graphRef.value = graphOf({ s: { shape: { type: 'rect' } } })
    mockCanvas.selection.value = [{ kind: 'cell', id: 's' }]
    const { api, scope } = setup({ editStencil: vi.fn() })
    const labels = itemsFor(api, { kind: 'cell', id: 's' }).map((i) => i.label)
    expect(labels).not.toContain('Редактировать символ')
    expect(labels.some((l) => l?.startsWith('Выделить такие'))).toBe(false)
    scope.stop()
  })
})

// Пустое место: «Вставить» при непустом буфере и действия над всей формой, когда на ней
// есть символы; пунктов нет — меню не открывается.
describe('useContextMenu — пустое место', () => {
  beforeEach(() => {
    mockCanvas.selection.value = []
    mockCanvas.selectAllCells.mockClear()
    mockCanvas.fitToContent.mockClear()
  })

  it('пустая форма и пустой буфер — пунктов нет, меню не открывается', () => {
    mockCanvas.graphRef.value = graphOf({})
    const { api, scope } = setup()
    expect(itemsFor(api, null)).toEqual([])
    scope.stop()
  })

  it('на форме есть символы — «Выделить всё» и «Вписать в экран»', () => {
    mockCanvas.graphRef.value = graphOf({ a: {} })
    const { api, scope } = setup()
    const items = itemsFor(api, null)
    expect(items.map((i) => i.label)).toEqual(['Выделить всё', 'Вписать в экран'])
    items[0].command()
    items[1].command()
    expect(mockCanvas.selectAllCells).toHaveBeenCalled()
    expect(mockCanvas.fitToContent).toHaveBeenCalled()
    scope.stop()
  })

  it('с буфером «Вставить» идёт первым и отделён от действий над формой', () => {
    mockCanvas.graphRef.value = graphOf({ a: {} })
    const pasteClipboard = vi.fn()
    const { api, scope } = setup({ hasClipboard: () => true, pasteClipboard })
    const items = itemsFor(api, null)
    expect(items[0]).toMatchObject({ label: 'Вставить', shortcut: 'Ctrl+V' })
    expect(items[1]).toEqual({ separator: true })
    items[0].command()
    expect(pasteClipboard).toHaveBeenCalled()
    scope.stop()
  })
})

// Клавиша стоит в пункте отдельным полем: меню — место, где хоткеи узнают, а вписанная
// в подпись она сливалась с текстом.
describe('useContextMenu — клавиши и иконки', () => {
  it('у символа: иконки как во всём интерфейсе, клавиши у своих действий', () => {
    mockCanvas.graphRef.value = graphOf({ a: {} })
    mockCanvas.selection.value = [{ kind: 'cell', id: 'a' }]
    const { api, scope } = setup()
    const items = itemsFor(api, { kind: 'cell', id: 'a' })
    const byLabel = (l) => items.find((i) => i.label === l)
    expect(byLabel('Дублировать')).toMatchObject({ icon: 'pi pi-clone', shortcut: 'Ctrl+D' })
    expect(byLabel('Скопировать')).toMatchObject({ icon: 'pi pi-copy', shortcut: 'Ctrl+C' })
    expect(byLabel('Удалить')).toMatchObject({ shortcut: 'Del' })
    const order = byLabel('Порядок')
    expect(order.icon).toBe('pi pi-sort-alt')
    expect(order.items.map((i) => i.shortcut)).toEqual([
      'Ctrl+Shift+]',
      'Ctrl+]',
      'Ctrl+[',
      'Ctrl+Shift+[',
    ])
    scope.stop()
  })
})
