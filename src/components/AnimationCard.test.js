// @vitest-environment jsdom
// Шапка карточки анимации: иконка, заголовок, уточнение; полоса действий — только со слотом.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AnimationCard from './AnimationCard.vue'

describe('AnimationCard', () => {
  it('шапка, тело и действия', () => {
    const w = mount(AnimationCard, {
      props: { icon: 'pi pi-sitemap text-purple-500', title: 'Зависимость', hint: 'от тегов' },
      slots: { default: '<p class="body">тело</p>', actions: '<button class="act">×</button>' },
      attrs: { 'data-test': 'card' },
    })
    expect(w.find('i').classes()).toEqual(['pi', 'pi-sitemap', 'text-purple-500'])
    expect(w.text()).toContain('Зависимость')
    expect(w.text()).toContain('от тегов')
    expect(w.find('.body').exists()).toBe(true)
    expect(w.find('.ml-auto .act').exists()).toBe(true)
    expect(w.attributes('data-test')).toBe('card')
  })

  it('без слота действий полосы справа нет, без уточнения — только заголовок', () => {
    const w = mount(AnimationCard, { props: { icon: 'pi pi-eye', title: 'Привязка' } })
    expect(w.find('.ml-auto').exists()).toBe(false)
    expect(w.find('.tms-hint').exists()).toBe(false)
  })
})
