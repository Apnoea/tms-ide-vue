// @vitest-environment jsdom
// Компонентный тест инспектора редактора символов: проверяет стык компонент ↔
// синглтон useStencilEditor там, где юнит не достаёт — правка полей подписи меняет
// модель, а не удаляет фигуру.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountWithApp } from '../composables/test-utils'
import StencilInspector from './StencilInspector.vue'
import { useStencilEditor } from '../composables/useStencilEditor'

// В jsdom нет ResizeObserver, а его создаёт Textarea с `auto-resize` (текст подписи) —
// без заглушки инспектор падает при монтировании.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  }
)

describe('StencilInspector: подпись', () => {
  let editor
  let wrapper

  beforeEach(() => {
    editor = useStencilEditor()
    editor.reset()
    // addShape сам делает фигуру выделенной — инспектор рисует её поля.
    editor.addShape({ type: 'text', x: 10, y: 15, text: 'Величина', fontSize: 10 })
    wrapper = mountWithApp(StencilInspector)
  })

  const textarea = () => wrapper.find('textarea')

  it('очистка текста НЕ удаляет фигуру: пустая подпись штатна (её рисует иконка)', async () => {
    await textarea().setValue('')
    await textarea().trigger('blur')
    expect(editor.shapes.value).toHaveLength(1)
    expect(editor.shapes.value[0].text).toBe('')
  })

  it('галка «правится на холсте» выдаёт ключ и возвращает прежний после снятия', async () => {
    const id = editor.shapes.value[0].id
    const param = () => wrapper.find('input#se-text-param')
    await param().setValue(true)
    const key = editor.shapes.value[0].param
    expect(key).toMatch(/^p\d+$/)

    // Ключ помнится: значения экземпляров лежат под ним, и новый номер осиротил бы
    // уже расставленные подписи.
    await param().setValue(false)
    expect(editor.shapes.value[0].param).toBeUndefined()
    await param().setValue(true)
    expect(editor.shapes.value[0].param).toBe(key)
    expect(editor.shapes.value[0].id).toBe(id)
  })

  it('у подписи со значением тега галки «правится на холсте» нет', async () => {
    expect(wrapper.find('input#se-text-param').exists()).toBe(true)
    await wrapper.find('input#se-text-value').setValue(true)
    expect(wrapper.find('input#se-text-param').exists()).toBe(false)
  })
})

// Шапка остаётся при выделении: её цель телепорта не должна размонтироваться.
it('StencilInspector: выделение переключает на свойства фигуры, шапка остаётся', async () => {
  const editor = useStencilEditor()
  editor.reset()
  editor.meta.label = 'Задвижка'
  const wrapper = mountWithApp(StencilInspector)
  expect(wrapper.find('input[data-field="label"]').exists()).toBe(true)
  editor.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
  await nextTick()
  expect(wrapper.find('input[data-field="label"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('Фигура')
  expect(wrapper.find('#tms-editor-actions').exists()).toBe(true)
  await wrapper.find('h2 button').trigger('click')
  expect(editor.selectedIds.value).toEqual([])
  expect(wrapper.find('input[data-field="label"]').exists()).toBe(true)
})

// Привязка к состоянию — строки «Всегда» и состояний; выбор пишется всем выделенным.
it('StencilInspector: привязка к состоянию отмечает выбранное и пишет его фигурам', async () => {
  const editor = useStencilEditor()
  editor.reset()
  editor.setAnimationMode('boolean')
  editor.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
  const wrapper = mountWithApp(StencilInspector)
  const rows = () => wrapper.findAll('[data-test="state-binding"] button')
  expect(rows().map((r) => r.find('span').text())).toEqual(['Всегда', 'Вкл', 'Выкл'])
  await rows()[1].trigger('click')
  expect(editor.shapes.value[0].state).toBe('true')
  expect(rows()[1].classes()).toContain('bg-primary-50')
})

// «По значению» фигура может быть общей для нескольких состояний; булев — одно.
it('StencilInspector: «по значению» состояния привязки переключаются набором', async () => {
  const editor = useStencilEditor()
  editor.reset()
  editor.setAnimationMode('value')
  editor.addState()
  editor.addState()
  const [a, b] = editor.meta.states.map((s) => s.key)
  editor.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
  const wrapper = mountWithApp(StencilInspector)
  const rows = () => wrapper.findAll('[data-test="state-binding"] button')
  await rows()[1].trigger('click')
  await rows()[2].trigger('click')
  expect(editor.shapes.value[0].state).toBe(`${a}+${b}`)
  await rows()[1].trigger('click')
  expect(editor.shapes.value[0].state).toBe(b)
  await rows()[0].trigger('click')
  expect(editor.shapes.value[0].state).toBe('always')
})

// Кнопки «Сохранить/Закрыть» телепортирует StencilEditor — цель в шапке инспектора.
it('StencilInspector: цель кнопок редактора — в шапке «Символ»', () => {
  useStencilEditor().reset()
  const wrapper = mountWithApp(StencilInspector)
  const target = wrapper.find('#tms-editor-actions')
  expect(target.exists()).toBe(true)
  expect(target.element.parentElement.querySelector('h2').textContent).toContain('Символ')
})

// Проблемы черновика видны при вводе: иначе занятый id или пустая категория всплывают
// только тостом после клика «Сохранить».
describe('StencilInspector: подсветка проблем', () => {
  let editor
  let wrapper

  const errors = () => wrapper.findAll('.tms-field-error').map((n) => n.text())

  beforeEach(() => {
    editor = useStencilEditor()
    editor.reset()
  })

  it('пустой черновик не краснеет: ошибок ещё нет', () => {
    wrapper = mountWithApp(StencilInspector)
    expect(errors()).toEqual([])
  })

  it('начатый символ без названия и категории подсвечивает поля', () => {
    editor.meta.id = 'cell_new'
    editor.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    // Новая фигура выделена, а поля символа видны при пустом выделении.
    editor.select(null)
    wrapper = mountWithApp(StencilInspector)
    expect(errors().join(' ')).toContain('Укажи название')
    expect(errors().join(' ')).toContain('Укажи категорию')
  })

  it('занятый id виден сразу на поле id', () => {
    editor.meta.id = 'cell_qw' // встроенный символ
    editor.meta.label = 'X'
    editor.meta.category = 'Тест'
    editor.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
    editor.select(null)
    wrapper = mountWithApp(StencilInspector)
    expect(errors().join(' ')).toContain('уже занят')
  })
})

// Режимы анимации — сворачиваемые блоки: у символа работает ровно один, поэтому
// открыт максимум один, а оба закрытых означают «анимации нет».
describe('StencilInspector: режимы анимации', () => {
  let editor
  let wrapper

  const headers = () => wrapper.findAll('[data-test="anim-mode"]')

  beforeEach(() => {
    editor = useStencilEditor()
    editor.reset()
    wrapper = mountWithApp(StencilInspector)
  })

  it('клик по заголовку открывает режим, повторный — выключает анимацию', async () => {
    expect(editor.meta.stateful).toBe(false)

    await headers()[0].trigger('click')
    expect([editor.meta.stateful, editor.meta.stateMode]).toEqual([true, 'boolean'])

    await headers()[0].trigger('click')
    expect(editor.meta.stateful).toBe(false)
  })

  it('второй режим закрывает первый: одновременно они не работают', async () => {
    await headers()[0].trigger('click')
    await headers()[1].trigger('click')
    expect([editor.meta.stateful, editor.meta.stateMode]).toEqual([true, 'value'])
    // Содержимое раскрыто только у активного: строк «Вкл/Выкл» больше нет.
    expect(wrapper.text()).not.toContain('Вкл')
  })
})

// Превью живёт в строке состояния: стол показывает только его фигуры, а связь «строка
// ↔ что видно» иначе держалась на отдельном контроле над столом.
describe('StencilInspector: превью состояния', () => {
  let editor
  let wrapper

  const eyes = () => wrapper.findAll('button .pi-eye')

  beforeEach(() => {
    editor = useStencilEditor()
    editor.reset()
    editor.setAnimationMode('boolean')
    wrapper = mountWithApp(StencilInspector)
  })

  it('глаз включает превью своего состояния, повторный клик возвращает «все»', async () => {
    expect(editor.previewState.value).toBe('all')
    await eyes()[0].trigger('click')
    expect(editor.previewState.value).toBe('true')

    await eyes()[1].trigger('click')
    expect(editor.previewState.value).toBe('false')

    await eyes()[1].trigger('click')
    expect(editor.previewState.value).toBe('all')
  })
})

// Символ поставляемого набора: название и рисунок принадлежат набору, режим и состав
// состояний тоже (по их ключам правки проекта ложатся на новую версию). Проект правит
// коды, цвета, раскладку палитры и галки.
describe('StencilInspector: символ набора', () => {
  let editor
  let wrapper

  beforeEach(() => {
    editor = useStencilEditor()
    editor.reset()
    editor.loadStencil({
      id: 'demo_qs',
      label: 'Разъединитель',
      category: 'Коммутация',
      width: 20,
      height: 20,
      preset: { id: 'demo', name: 'Демо-набор', version: '1.0' },
      slots: [{ key: 'value', type: 'Value' }],
      states: [
        { key: 'on', label: 'Вкл', code: '1' },
        { key: 'off', label: 'Откл', code: '0' },
      ],
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg"><g data-anim-suffix=".on">' +
        '<rect x="0" y="0" width="10" height="10"/></g></svg>',
    })
    wrapper = mountWithApp(StencilInspector)
  })

  it('название заперто, категория и галки открыты', () => {
    expect(wrapper.find('input[data-field="label"]').element.disabled).toBe(true)
    const category = wrapper.findAllComponents({ name: 'Select' }).find((s) => s.props('editable'))
    expect(category.props('disabled')).toBe(false)
    expect(wrapper.find('input#se-norotate').element.disabled).toBe(false)
    expect(wrapper.text()).toContain('Символ из набора «Демо-набор» 1.0')
  })

  it('режим и состав состояний заперты, коды правятся', () => {
    for (const header of wrapper.findAll('[data-test="anim-mode"]')) {
      expect(header.attributes('disabled')).toBeDefined()
    }
    expect(wrapper.text()).not.toContain('Сигнал положения')
    // «Добавить диапазон» — тоже `tms-add-row`, и он у символа набора остаётся.
    const addRows = wrapper.findAll('button.tms-add-row').map((b) => b.text())
    expect(addRows.some((t) => t.includes('состояние'))).toBe(false)
    const codes = wrapper.findAll('input[placeholder="код"]')
    expect(codes).toHaveLength(2)
    for (const code of codes) {
      expect(code.element.disabled).toBe(false)
      // В строке состояния нет кнопки «убрать» — колонка остаётся пустой.
      expect(code.element.closest('.grid').querySelector('.tms-row-btn')).toBeNull()
    }
  })
})
