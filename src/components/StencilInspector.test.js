// @vitest-environment jsdom
// Компонентный тест инспектора редактора символов: проверяет стык компонент ↔
// синглтон useStencilEditor там, где юнит не достаёт — правка полей подписи меняет
// модель, а не удаляет фигуру.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import StencilInspector from './StencilInspector.vue'
import { useStencilEditor } from '../composables/useStencilEditor'

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

// Проблемы черновика видны при вводе: иначе занятый id или пустая категория всплывают
// только тостом после клика «Сохранить».
describe('StencilInspector: подсветка проблем', () => {
  let editor
  let wrapper

  const errors = () => wrapper.findAll('.text-red-500').map((n) => n.text())

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
    wrapper = mountWithApp(StencilInspector)
    expect(errors().join(' ')).toContain('Укажите название')
    expect(errors().join(' ')).toContain('Укажите категорию')
  })

  it('занятый id виден сразу на поле id', () => {
    editor.meta.id = 'cell_qw' // встроенный символ
    editor.meta.label = 'X'
    editor.meta.category = 'Тест'
    editor.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
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
