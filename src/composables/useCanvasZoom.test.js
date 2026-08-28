// Колесо мыши: прокрутка (Shift — горизонтальная), зум только с Ctrl/Cmd — модель Figma
// и схемных редакторов. Зум по «голому» колесу ломал бы трекпад: двухпальцевый жест
// приходит тем же `wheel`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const mockCanvas = {
  paperRef: ref(null),
  graphRef: ref(null),
  zoomPercent: ref(100),
  bumpPaperView: vi.fn(),
}
vi.mock('./useCanvas', () => ({ useCanvas: () => mockCanvas }))

import { useCanvasZoom } from './useCanvasZoom'

/** Мок paper'а: помнит translate/scale, как настоящий. */
function makePaper() {
  const state = { tx: 0, ty: 0, s: 1 }
  return {
    state,
    translate: (tx, ty) => {
      if (tx === undefined) return { tx: state.tx, ty: state.ty }
      state.tx = tx
      state.ty = ty
      return undefined
    },
    scale: (s) => {
      if (s === undefined) return { sx: state.s, sy: state.s }
      state.s = s
      return undefined
    },
    clientToLocalPoint: (x, y) => ({ x: (x - state.tx) / state.s, y: (y - state.ty) / state.s }),
  }
}

const wheel = (opts) => ({ preventDefault: vi.fn(), deltaX: 0, deltaY: 0, deltaMode: 0, ...opts })

describe('useCanvasZoom — колесо', () => {
  let paper
  let onWheel

  beforeEach(() => {
    setActivePinia(createPinia())
    paper = makePaper()
    mockCanvas.paperRef.value = paper
    mockCanvas.zoomPercent.value = 100
    onWheel = useCanvasZoom(ref({ clientWidth: 800, clientHeight: 600 })).onWheel
  })

  it('без модификаторов — вертикальная прокрутка, масштаб не меняется', () => {
    onWheel(wheel({ deltaY: 120 }))
    expect(paper.state).toMatchObject({ tx: 0, ty: -120, s: 1 })
  })

  it('Shift — горизонтальная прокрутка (дельта пришла в deltaY)', () => {
    onWheel(wheel({ deltaY: 120, shiftKey: true }))
    expect(paper.state).toMatchObject({ tx: -120, ty: 0 })
  })

  it('deltaX от трекпада/наклона колеса идёт по горизонтали как есть', () => {
    // Браузер сам положил дельту в deltaX при Shift — второй раз не переносим.
    onWheel(wheel({ deltaX: 40, shiftKey: true }))
    expect(paper.state).toMatchObject({ tx: -40, ty: 0 })
  })

  it('строки и страницы приводятся к пикселям (иначе шаг то 3px, то пол-экрана)', () => {
    onWheel(wheel({ deltaY: 3, deltaMode: 1 }))
    expect(paper.state.ty).toBe(-48)
    paper.state.ty = 0
    onWheel(wheel({ deltaY: 1, deltaMode: 2 }))
    expect(paper.state.ty).toBe(-600)
  })

  it('Ctrl — зум (сюда же приходит pinch трекпада), холст не прокручивается', () => {
    onWheel(wheel({ deltaY: -100, ctrlKey: true, clientX: 0, clientY: 0 }))
    expect(paper.state.s).toBeCloseTo(1.1)
    expect(mockCanvas.zoomPercent.value).toBe(110)
  })

  it('Cmd — тот же зум (macOS)', () => {
    onWheel(wheel({ deltaY: 100, metaKey: true, clientX: 0, clientY: 0 }))
    expect(paper.state.s).toBeCloseTo(0.9)
  })
})
