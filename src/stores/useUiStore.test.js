import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from './useUiStore'
import { CANVAS_BG_DEFAULT } from '../stencils/canvasPaper'

describe('useUiStore: фон холста', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('дефолт — цвет холста из canvasPaper', () => {
    expect(useUiStore().canvasBg).toBe(CANVAS_BG_DEFAULT)
  })

  it('цвет пишется и переживает пересоздание стора (localStorage)', async () => {
    useUiStore().setCanvasBg('#101828')
    await nextTick() // vueuse пишет в storage отложенно (flush: 'pre')
    setActivePinia(createPinia())
    expect(useUiStore().canvasBg).toBe('#101828')
  })

  it('мусор откатывается к дефолту, а не красит холст', () => {
    // Значение приходит из localStorage — его могли поправить руками, и `url(...)`
    // или пустая строка в фоне paper'а дали бы прозрачный холст.
    const store = useUiStore()
    for (const bad of ['', 'url(x)', 'rgb(0,0,0)', null]) {
      store.setCanvasBg(bad)
      expect(store.canvasBg).toBe(CANVAS_BG_DEFAULT)
    }
  })

  it('сброс возвращает дефолт', () => {
    const store = useUiStore()
    store.setCanvasBg('#101828')
    store.resetCanvasBg()
    expect(store.canvasBg).toBe(CANVAS_BG_DEFAULT)
  })
})
