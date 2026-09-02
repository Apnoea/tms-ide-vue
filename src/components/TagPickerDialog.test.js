// @vitest-environment jsdom
// Компонентные тесты picker'а тега: поведение диалога живёт во вьюхе (клик по
// опции Listbox, пустое состояние), юнитом до него не добраться.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountWithApp } from '../composables/test-utils'

const pickTagList = vi.fn()
vi.mock('../composables/useTagList', () => ({
  useTagList: () => ({ pickTagList, tryRestoreTagListHandle: vi.fn() }),
}))

import TagPickerDialog from './TagPickerDialog.vue'

const TAGS = [
  { name: 'BR1.ONOFF', type: 'Boolean' },
  { name: 'BR2.ONOFF', type: 'Boolean' },
]

/** Dialog рендерит контент в body — обёртка attachTo нужна для поиска опций. */
function mountPicker(props = {}) {
  return mountWithApp(TagPickerDialog, {
    props: { visible: true, tags: TAGS, ...props },
    attachTo: document.body,
  })
}

describe('TagPickerDialog', () => {
  beforeEach(() => {
    pickTagList.mockClear()
  })

  it('одинарный клик по тегу подтверждает выбор и закрывает диалог', async () => {
    const wrapper = mountPicker()
    await wrapper.vm.$nextTick()

    const options = document.querySelectorAll('[data-pc-section="option"]')
    expect(options.length).toBe(TAGS.length)
    options[1].click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('select')).toEqual([['BR2.ONOFF']])
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
    wrapper.unmount()
  })

  it('клик по уже привязанному тегу подтверждает его же (Listbox тоглит выбор в null)', async () => {
    const wrapper = mountPicker({ selected: 'BR1.ONOFF' })
    await wrapper.vm.$nextTick()

    document.querySelectorAll('[data-pc-section="option"]')[0].click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('select')).toEqual([['BR1.ONOFF']])
    wrapper.unmount()
  })

  it('Enter в поиске подтверждает первый отфильтрованный тег', async () => {
    const wrapper = mountPicker()
    await wrapper.vm.$nextTick()

    const input = document.querySelector('input')
    input.value = 'br2'
    input.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('select')).toEqual([['BR2.ONOFF']])
    wrapper.unmount()
  })

  it('пустой tag-list предлагает загрузить его прямо из диалога', async () => {
    const wrapper = mountPicker({ tags: [] })
    await wrapper.vm.$nextTick()

    const load = wrapper.findAll('button').find((b) => b.text().includes('Загрузить tag-list'))
    expect(load).toBeTruthy()
    await load.trigger('click')

    expect(pickTagList).toHaveBeenCalled()
    // Диалог остаётся открытым — теги подтянутся в тот же список.
    expect(wrapper.emitted('update:visible')).toBeUndefined()
    wrapper.unmount()
  })
})
