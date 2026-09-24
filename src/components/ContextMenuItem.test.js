// @vitest-environment jsdom
// Строка пункта меню: сверх штатной PrimeVue рисует клавишу отдельной колонкой — это
// видно только в разметке.
import { describe, it, expect } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import ContextMenuItem from './ContextMenuItem.vue'

// Классы, которые PrimeVue отдаёт в props слота `#item`.
const BIND = {
  action: { class: 'p-contextmenu-item-link' },
  icon: { class: 'p-contextmenu-item-icon' },
  label: { class: 'p-contextmenu-item-label' },
  submenuicon: { class: 'p-contextmenu-submenu-icon' },
}

const mountItem = (item, hasSubmenu = false) =>
  mountWithApp(ContextMenuItem, { props: { item, bind: BIND, hasSubmenu } })

describe('ContextMenuItem', () => {
  it('клавиша — отдельной колонкой, не в подписи', () => {
    const w = mountItem({ label: 'Дублировать', icon: 'pi pi-clone', shortcut: 'Ctrl+D' })
    expect(w.find('.p-contextmenu-item-label').text()).toBe('Дублировать')
    expect(w.text()).toContain('Ctrl+D')
    expect(w.find('.p-contextmenu-item-icon').classes()).toContain('pi-clone')
  })

  it('у пункта с подменю — стрелка подменю', () => {
    const w = mountItem({ label: 'Порядок', icon: 'pi pi-sort-alt' }, true)
    expect(w.find('.p-contextmenu-submenu-icon').exists()).toBe(true)
  })
})
