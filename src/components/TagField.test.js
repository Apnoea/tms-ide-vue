// Стык компонент↔стор: индикатор проблемы тега читает tag-list из Pinia, а такие
// обращения юнитом не проверить (ошибка вида `store.getter.value` даёт «всегда
// без предупреждения» и молча проходит). Сама логика причин — в utils/tagHealth.
import { describe, it, expect } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import { useProjectStore } from '../stores/useProjectStore'
import TagField from './TagField.vue'

const WARN = '.pi-exclamation-triangle'

function mountField(props, tags = []) {
  const wrapper = mountWithApp(TagField, { props: { canPick: true, ...props } })
  useProjectStore().setTags(tags)
  return wrapper
}

describe('TagField', () => {
  it('тега нет в загруженном tag-list → предупреждение', async () => {
    const wrapper = mountField({ value: 'НЕТ.ТАКОГО' }, [{ name: 'PS031.UA', type: 'Float' }])
    await wrapper.vm.$nextTick()
    expect(wrapper.find(WARN).exists()).toBe(true)
  })

  it('тег из списка → предупреждения нет', async () => {
    const wrapper = mountField({ value: 'PS031.UA' }, [{ name: 'PS031.UA', type: 'Float' }])
    await wrapper.vm.$nextTick()
    expect(wrapper.find(WARN).exists()).toBe(false)
  })

  it('пробел в теге предупреждает даже без загруженного tag-list', async () => {
    const wrapper = mountField({ value: 'ПС 1.U' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find(WARN).exists()).toBe(true)
  })

  it('tag-list не загружен → про отсутствие тега молчим', async () => {
    const wrapper = mountField({ value: 'PS031.UA' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find(WARN).exists()).toBe(false)
  })
})
