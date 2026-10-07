// @vitest-environment jsdom
// Предупреждение «tag-list не загружен» — одно на раздел «Анимации» вместо подсказки в
// каждой карточке: видно, только пока тегов нет.
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mountWithApp } from '../composables/test-utils'
import { useProjectStore } from '../stores/useProjectStore'
import TagListNotice from './TagListNotice.vue'

describe('TagListNotice', () => {
  it('видно без тегов, с кнопкой загрузки; пропадает, когда теги есть', async () => {
    const w = mountWithApp(TagListNotice)
    expect(w.text()).toContain('Tag-list не загружен')
    expect(w.find('button').text()).toBe('Загрузить tag-list')
    useProjectStore().tags = [{ name: 'A.ONOFF', type: 'Boolean' }]
    await nextTick()
    expect(w.text()).toBe('')
  })
})
