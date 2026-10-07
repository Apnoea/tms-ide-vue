// @vitest-environment jsdom
// Поле поиска — одно на четыре места: лупа слева, × только при запросе и чистит его,
// `class` — обёртке (раскладка), остальные атрибуты — самому input.
import { describe, it, expect } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import SearchField from './SearchField.vue'

describe('SearchField', () => {
  it('лупа всегда, × при запросе; × чистит v-model', async () => {
    const w = mountWithApp(SearchField, {
      props: { modelValue: '', 'onUpdate:modelValue': (v) => w.setProps({ modelValue: v }) },
      attrs: { class: 'w-56', placeholder: 'Найти' },
    })
    expect(w.find('.pi-search').exists()).toBe(true)
    expect(w.find('.pi-times').exists()).toBe(false)
    expect(w.classes()).toContain('w-56')
    expect(w.find('input').attributes('placeholder')).toBe('Найти')
    expect(w.find('input').classes()).not.toContain('w-56')

    await w.find('input').setValue('PS031')
    expect(w.props('modelValue')).toBe('PS031')
    await w.find('.pi-times').trigger('click')
    expect(w.props('modelValue')).toBe('')
  })
})
