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
