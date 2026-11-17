// @vitest-environment jsdom
// Шапка дерева форм: клик по ней сворачивает секцию, по её кнопкам — нет. Кнопка формы
// проверки тегов идёт без `.stop` (ConfirmPopup ловит клик на document), поэтому её
// отсекает сам обработчик шапки.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mountWithApp } from '../composables/test-utils'

const mockCanvas = { formTrash: ref([]), generateTagCheckForm: vi.fn() }
vi.mock('../composables/useCanvas', () => ({ useCanvas: () => mockCanvas }))

import FormTree from './FormTree.vue'
import { useProjectStore } from '../stores/useProjectStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

describe('FormTree — форма проверки тегов', () => {
  beforeEach(() => {
    localStorage.clear()
    mockCanvas.generateTagCheckForm.mockClear()
  })

  it('кнопка видна при загруженном tag-list, строит форму и не сворачивает секцию', async () => {
    const wrapper = mountWithApp(FormTree)
    useWorkspaceStore().loadForms([{ id: 'main', graphJson: { cells: [] } }], 'main')
    expect(wrapper.find('.pi-list-check').exists()).toBe(false)

    const tags = [{ name: 'A.ON', type: 'Bool' }]
    useProjectStore().setTags(tags)
    await wrapper.vm.$nextTick()
    await wrapper.find('.pi-list-check').element.closest('button').click()
    await wrapper.vm.$nextTick()

    expect(mockCanvas.generateTagCheckForm).toHaveBeenCalledWith(tags)
    // Секция не свернулась: кнопки шапки на месте.
    expect(wrapper.find('.pi-plus').exists()).toBe(true)
    wrapper.unmount()
  })
})
