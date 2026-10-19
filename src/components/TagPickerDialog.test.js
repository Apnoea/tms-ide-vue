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
import { useProjectStore } from '../stores/useProjectStore'
import { useUiStore, TAG_PICKER_WIDTH_DEFAULT } from '../stores/useUiStore'

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
    localStorage.clear()
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

  it('tag-list загружен, но подходящих тегов нет — загрузку не предлагает', async () => {
    const wrapper = mountPicker({ tags: [] })
    // Pinia ставится плагином при монтировании — стор тот же, что у диалога.
    useProjectStore().setTags([{ name: 'P1.VALUE', type: 'Float' }])
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('В tag-list нет тегов подходящего типа')
    expect(wrapper.findAll('button').some((b) => b.text().includes('Загрузить tag-list'))).toBe(
      false
    )
    wrapper.unmount()
  })

  // Окно по центру растёт в обе стороны — ширина меняется на двойной сдвиг курсора,
  // чтобы правый край шёл за мышью.
  it('ширину тянут за правый край, двойной клик возвращает исходную', async () => {
    const wrapper = mountPicker()
    await wrapper.vm.$nextTick()
    const ui = useUiStore()
    // Элементы ищем заново после каждой перерисовки: с заглушкой teleport из test-utils
    // окно пересоздаётся при смене стиля (в браузере — нет, проверено вживую).
    const handle = () => wrapper.find('[data-tag-picker-resize]').element
    const width = () => handle().closest('.p-dialog').style.width
    expect(width()).toBe(`${TAG_PICKER_WIDTH_DEFAULT}px`)

    handle().dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 500, bubbles: true })
    )
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 550 }))
    document.dispatchEvent(new MouseEvent('pointerup'))
    await wrapper.vm.$nextTick()
    expect(ui.tagPickerWidth).toBe(TAG_PICKER_WIDTH_DEFAULT + 100)
    expect(width()).toBe(`${TAG_PICKER_WIDTH_DEFAULT + 100}px`)

    // После отпускания мышь ширину не двигает.
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 700 }))
    expect(ui.tagPickerWidth).toBe(TAG_PICKER_WIDTH_DEFAULT + 100)

    handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(width()).toBe(`${TAG_PICKER_WIDTH_DEFAULT}px`)
    wrapper.unmount()
  })

  // Сдвинутое за шапку окно стоит по `left` (так его ставит PrimeVue) и растёт только
  // вправо — край идёт за мышью при одинарном сдвиге.
  it('сдвинутое окно тянется на одинарный сдвиг курсора', async () => {
    const wrapper = mountPicker()
    await wrapper.vm.$nextTick()
    const ui = useUiStore()
    const handle = wrapper.find('[data-tag-picker-resize]').element
    handle.closest('.p-dialog').style.left = '100px'

    handle.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 500, bubbles: true }))
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 550 }))
    document.dispatchEvent(new MouseEvent('pointerup'))
    expect(ui.tagPickerWidth).toBe(TAG_PICKER_WIDTH_DEFAULT + 50)
    wrapper.unmount()
  })
})
