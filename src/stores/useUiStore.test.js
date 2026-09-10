// @vitest-environment jsdom
// Видимость боковых колонок — настройка рабочего места: она обязана переживать
// перезагрузку (localStorage) и не запирать пользователя в редакторе символов без
// панели свойств.
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore, PANE_WIDTH_DEFAULT, PANE_WIDTH_MIN, PANE_WIDTH_MAX } from './useUiStore'

const KEY_RIGHT = 'tms.rightPaneOpen'

describe('useUiStore: боковые колонки', () => {
  beforeEach(() => {
    // Чистим ДО создания стора: useLocalStorage читает значение при инициализации.
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('по умолчанию обе колонки открыты', () => {
    const ui = useUiStore()
    expect(ui.leftPaneOpen).toBe(true)
    expect(ui.rightPaneOpen).toBe(true)
  })

  it('тогл сворачивает колонку и запоминает выбор', async () => {
    const ui = useUiStore()
    ui.toggleLeftPane()
    ui.toggleRightPane()
    expect(ui.leftPaneOpen).toBe(false)
    expect(ui.rightPaneOpen).toBe(false)
    await nextTick() // запись в localStorage идёт вотчером useLocalStorage
    expect(localStorage.getItem(KEY_RIGHT)).toBe('false')
  })

  it('редактор символов раскрывает правую колонку: иначе править нечем', () => {
    const ui = useUiStore()
    ui.toggleRightPane()
    ui.openStencilEditor('cell_qw')
    expect(ui.rightPaneOpen).toBe(true)
    // Левую не трогаем — она под оверлеем и всё равно гейтится (inert).
    expect(ui.leftPaneOpen).toBe(true)
  })

  it('ширина по умолчанию — та же, что была до ресайза', () => {
    const ui = useUiStore()
    expect(ui.leftPaneWidth).toBe(PANE_WIDTH_DEFAULT.left)
    expect(ui.rightPaneWidth).toBe(PANE_WIDTH_DEFAULT.right)
  })

  it('ширина клампится и округляется до целых px', () => {
    const ui = useUiStore()
    ui.setLeftPaneWidth(10)
    expect(ui.leftPaneWidth).toBe(PANE_WIDTH_MIN)
    ui.setRightPaneWidth(5000)
    expect(ui.rightPaneWidth).toBe(PANE_WIDTH_MAX)
    // Дробные приходят из drag'а (devicePixelRatio), в стиле им делать нечего.
    ui.setLeftPaneWidth(320.4)
    expect(ui.leftPaneWidth).toBe(320)
    // Мусор (drag за пределами окна дал NaN) не должен обнулять колонку.
    ui.setLeftPaneWidth(Number.NaN)
    expect(ui.leftPaneWidth).toBe(PANE_WIDTH_MIN)
  })

  it('двойной клик по разделителю возвращает дефолт', () => {
    const ui = useUiStore()
    ui.setLeftPaneWidth(PANE_WIDTH_MAX)
    ui.setRightPaneWidth(PANE_WIDTH_MIN)
    ui.resetPaneWidth('left')
    expect(ui.leftPaneWidth).toBe(PANE_WIDTH_DEFAULT.left)
    expect(ui.rightPaneWidth).toBe(PANE_WIDTH_MIN) // чужую колонку не трогает
    ui.resetPaneWidth('right')
    expect(ui.rightPaneWidth).toBe(PANE_WIDTH_DEFAULT.right)
  })

  it('размер от другого монитора чинится клампом на старте', () => {
    localStorage.setItem('tms.leftPaneWidth', '1800')
    setActivePinia(createPinia())
    expect(useUiStore().leftPaneWidth).toBe(PANE_WIDTH_MAX)
  })
})
