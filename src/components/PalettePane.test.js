// @vitest-environment jsdom
// Фильтр палитры по набору: клик по бейджу набора в строке символа оставляет только его
// символы, повторный клик возвращает всё. Логика живёт в компоненте (computed над
// реестром и поиском), поэтому проверяется монтированием.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import PalettePane from './PalettePane.vue'
import { registerStencil, unregisterStencil } from '../stencils/registry'

const PRESET = { id: 'demo', name: 'Демо', version: '1.0' }
const symbol = (id, label) => ({
  id,
  label,
  category: 'Коммутация',
  width: 20,
  height: 20,
  preset: PRESET,
})

describe('PalettePane: фильтр по набору', () => {
  let wrapper

  beforeEach(() => {
    localStorage.clear()
    registerStencil(symbol('demo_pa', 'Выключатель Демо'), '<g/>')
    registerStencil(symbol('demo_pb', 'Отделитель Демо'), '<g/>')
    wrapper = mountWithApp(PalettePane)
  })

  afterEach(() => {
    wrapper.unmount()
    unregisterStencil('demo_pa')
    unregisterStencil('demo_pb')
  })

  const rows = () => wrapper.findAll('.stencil-thumb').length
  const badge = () => wrapper.find('.tms-preset-badge')

  it('клик по бейджу — только символы набора; повторный — снова все', async () => {
    const all = rows()
    expect(all).toBeGreaterThan(2) // встроенные + два символа набора

    await badge().trigger('click')
    expect(rows()).toBe(2)
    expect(badge().classes()).toContain('tms-preset-badge-on')
    // Что палитра отфильтрована и чем — видно в строке фильтров.
    expect(wrapper.text()).toContain('Набор «Демо»')

    await badge().trigger('click')
    expect(rows()).toBe(all)
    expect(wrapper.text()).not.toContain('Набор «Демо»')
  })

  it('крестик на чипе фильтра тоже снимает фильтр', async () => {
    const all = rows()
    await badge().trigger('click')
    await wrapper.find('.p-chip-remove-icon').trigger('click')
    expect(rows()).toBe(all)
  })

  // Бейдж лежит в строке, которая тащится по pointerdown: клик по нему не должен
  // начинать перенос символа на холст.
  it('нажатие на бейдж не начинает перетаскивание символа', async () => {
    const { useUiStore } = await import('../stores/useUiStore')
    await badge().trigger('pointerdown') // левая кнопка — значение по умолчанию
    expect(useUiStore().dragging).toBeNull()
  })
})
