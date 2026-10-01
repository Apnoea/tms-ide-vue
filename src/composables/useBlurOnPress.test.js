// @vitest-environment jsdom
// Нажатие по холсту снимает фокус с поля инспектора и выделение текста вне холста.
import { describe, it, expect, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useBlurOnPress } from './useBlurOnPress'

const Host = defineComponent({
  setup() {
    const canvas = ref(null)
    useBlurOnPress(canvas)
    return () =>
      h('div', [
        h('input', { id: 'field' }),
        h('button', { id: 'btn' }),
        h('p', { id: 'hint' }, 'Подсказка инспектора'),
        h('div', { id: 'canvas', ref: canvas }, [h('input', { id: 'inner' })]),
      ])
  },
})

describe('useBlurOnPress', () => {
  let wrapper
  afterEach(() => wrapper?.unmount())

  const press = () =>
    wrapper.find('#canvas').element.dispatchEvent(new Event('pointerdown', { bubbles: true }))

  it('нажатие по холсту снимает фокус с поля вне него', async () => {
    wrapper = mount(Host, { attachTo: document.body })
    await nextTick() // useEventListener вешает слушатель, когда ref получил элемент
    const field = wrapper.find('#field').element
    field.focus()
    press()
    expect(document.activeElement).not.toBe(field)
  })

  it('нажатие по холсту снимает выделение текста вне него', async () => {
    wrapper = mount(Host, { attachTo: document.body })
    await nextTick()
    const range = document.createRange()
    range.selectNodeContents(wrapper.find('#hint').element)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    expect(String(window.getSelection())).toBe('Подсказка инспектора')
    press()
    expect(window.getSelection().isCollapsed).toBe(true)
  })

  it('поле внутри холста и не-поле вне его фокус сохраняют', async () => {
    wrapper = mount(Host, { attachTo: document.body })
    await nextTick()
    const inner = wrapper.find('#inner').element
    inner.focus()
    press()
    expect(document.activeElement).toBe(inner)
    const btn = wrapper.find('#btn').element
    btn.focus()
    press()
    expect(document.activeElement).toBe(btn)
  })
})
