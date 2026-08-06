// Overlay inline-правки обязан выглядеть как сама подпись: ширину поля мы считаем
// СВОЕЙ метрикой (textCellSize тем же семейством), поэтому поле, отрисованное
// системным шрифтом, показывает текст другой ширины — на коммите он «прыгает».
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { withSetup } from './test-utils'

const mockCanvas = {
  graphRef: ref(null),
  paperRef: ref({ scale: () => ({ sx: 1 }), translate: () => ({ tx: 0, ty: 0 }) }),
  bumpVersion: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useTextEdit } from './useTextEdit'

/** Граф с единственной cell_text; paper без view — рендер не нужен. */
function graphWith(tms) {
  const cell = {
    id: 't1',
    get: (k) =>
      k === 'tms' ? tms : k === 'position' ? { x: 10, y: 20 } : { width: 80, height: 20 },
    set: vi.fn(),
    resize: vi.fn(),
    position: vi.fn(),
  }
  return { getCell: (id) => (id === 't1' ? cell : null) }
}

function setup() {
  return withSetup(() => useTextEdit({ scheduleSnapshot: vi.fn() }))
}

describe('useTextEdit — стиль overlay', () => {
  beforeEach(() => {
    mockCanvas.paperRef.value.findViewByModel = () => null
  })

  it('наследует шрифт, размер, жирность и цвет подписи', () => {
    mockCanvas.graphRef.value = graphWith({
      stencilId: 'cell_text',
      text: 'QF-101',
      fontSize: 20,
      bold: true,
      color: '#ff0000',
      fontFamily: 'monospace',
    })
    const [api, scope] = setup()
    api.startTextEdit('t1')
    expect(api.textEditing.value.style).toMatchObject({
      fontFamily: 'monospace',
      fontSize: '20px',
      fontWeight: 'bold',
      color: '#ff0000',
    })
    scope.stop()
  })

  it('чужое семейство из архива не доезжает до инпута', () => {
    mockCanvas.graphRef.value = graphWith({
      stencilId: 'cell_text',
      text: 'A',
      fontFamily: 'Comic Sans MS',
    })
    const [api, scope] = setup()
    api.startTextEdit('t1')
    expect(api.textEditing.value.style.fontFamily).toBe('sans-serif')
    scope.stop()
  })

  it('заблокированную подпись не открывает', () => {
    mockCanvas.graphRef.value = graphWith({ stencilId: 'cell_text', text: 'A', locked: true })
    const [api, scope] = setup()
    api.startTextEdit('t1')
    expect(api.textEditing.value).toBeNull()
    scope.stop()
  })
})
