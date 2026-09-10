// @vitest-environment jsdom
// Блок состояния — один компонент на два режима символа: заголовок и справка следуют
// ТИПУ слота-драйвера, потому что на холсте режим не переключается (он задан в
// определении символа). Проверяем, что режим читается по типу, а не по ключу слота.
import { describe, it, expect } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import StateBlock from './StateBlock.vue'
import TagField from './TagField.vue'

const mount = (props) => mountWithApp(StateBlock, { props: { tagsLoaded: true, ...props } })

describe('StateBlock', () => {
  it('булев слот: заголовок «Булево значение» и состояния true/false', () => {
    const w = mount({ slotInfo: { key: 'onoff', type: 'Boolean', value: 'BR1.ONOFF' } })
    expect(w.text()).toContain('Булево значение')
    // Состояния булева слота в определении символа не перечисляются — подставляем их
    // сами, чтобы справка выглядела так же, как у режима «по значению».
    expect(w.text()).toContain('Состояния символа')
    expect(w.text()).toContain('Вкл')
    expect(w.text()).toContain('true')
    expect(w.text()).toContain('false')
  })

  it('слот «по значению»: свой заголовок и состояния символа с кодами', () => {
    const w = mount({
      slotInfo: { key: 'value', type: 'Value', value: 'BR1.STATE' },
      states: [
        { key: 'on', label: 'Включен', code: '01' },
        // Код может быть не задан — подпись всё равно показываем.
        { key: 'off', label: 'Отключен', code: '' },
      ],
    })
    expect(w.text()).toContain('Состояние по значению')
    expect(w.text()).toContain('Включен')
    expect(w.text()).toContain('01')
    expect(w.text()).toContain('Отключен')
  })

  it('тег виден и просит picker кликом', async () => {
    const w = mount({ slotInfo: { key: 'onoff', type: 'Boolean', value: 'BR1.ONOFF' } })
    const tag = w.findComponent(TagField)
    expect(tag.props('value')).toBe('BR1.ONOFF')
    // Снятие привязки живёт в шапке блока, а не в строке тега.
    expect(tag.props('removable')).toBe(false)
    await tag.vm.$emit('pick')
    expect(w.emitted('pick-tag')).toHaveLength(1)
  })

  it('× появляется только при привязанном теге', async () => {
    const empty = mount({ slotInfo: { key: 'onoff', type: 'Boolean', value: '' } })
    expect(empty.html()).not.toContain('pi-times')
    const w = mount({ slotInfo: { key: 'onoff', type: 'Boolean', value: 'BR1.ONOFF' } })
    await w.find('button.p-button').trigger('click')
    expect(w.emitted('clear')).toHaveLength(1)
  })

  it('без tag-list picker недоступен и об этом сказано', () => {
    const w = mount({ slotInfo: { key: 'onoff', type: 'Boolean', value: '' }, tagsLoaded: false })
    expect(w.findComponent(TagField).props('canPick')).toBe(false)
    expect(w.text()).toContain('Загрузи tag-list')
  })
})
