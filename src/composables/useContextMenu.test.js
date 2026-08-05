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
  return { getCell: (id) => (cells[id] ? { get: () => cells[id] } : null) }
}

function setup() {
  const [api, scope] = withSetup(() =>
    useContextMenu({
      hasClipboard: () => false,
      pasteClipboard: vi.fn(),
      copySelection: vi.fn(),
      duplicateSelection: vi.fn(),
    })
  )
  return { api, scope }
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
