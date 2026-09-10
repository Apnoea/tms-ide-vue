// @vitest-environment jsdom
// Блок зависимостей виден у любого элемента, включая провод, и чаще пустует — поэтому
// проверяем, что пустой он остаётся коротким (одна кнопка), а правило показывается лишь
// при заданных группах.
import { describe, it, expect } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import DependencyBlock from './DependencyBlock.vue'
import TagField from './TagField.vue'

const mount = (props) => mountWithApp(DependencyBlock, { props: { tagsLoaded: true, ...props } })

describe('DependencyBlock', () => {
  it('пустой: заголовок и «+ группа», без правила про ИЛИ', () => {
    const w = mount({ groups: [] })
    expect(w.text()).toContain('Зависимость от других элементов')
    expect(w.text()).toContain('группа (ИЛИ)')
    expect(w.text()).not.toContain('Активен, если выполнена любая группа')
  })

  it('с группами: правило видно, между группами — ИЛИ, теги удаляются', async () => {
    const w = mount({ groups: [['A', 'B'], ['C']] })
    expect(w.text()).toContain('Активен, если выполнена любая группа')
    expect(w.text()).toContain('Группа 2')
    const tags = w.findAllComponents(TagField)
    expect(tags.map((t) => t.props('value'))).toEqual(['A', 'B', 'C'])
    // Тег-условие снять можно — в отличие от тега состояния он опционален.
    expect(tags[0].props('removable')).toBe(true)
    await tags[0].vm.$emit('remove')
    expect(w.emitted('remove-tag').at(-1)).toEqual([0, 0])
  })

  it('× в шапке только при removable', () => {
    const empty = mount({ groups: [], removable: false })
    expect(empty.find('button.pi-times').exists()).toBe(false)
    const w = mount({ groups: [['A']], removable: true })
    expect(w.html()).toContain('pi-times')
  })
})
