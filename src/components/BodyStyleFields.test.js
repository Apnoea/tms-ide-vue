// @vitest-environment jsdom
// Вид тела шины и точки: сброс цвета показывается ТОЛЬКО когда цвет свой — дефолт в
// `tms` не пишется, и крестик у дефолтного значения обещал бы работу, которой нет.
import { describe, it, expect } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import BodyStyleFields from './BodyStyleFields.vue'

const DEFAULT = '#64748b'

const mount = (color) =>
  mountWithApp(BodyStyleFields, {
    props: {
      color,
      colorDefault: DEFAULT,
      thickness: 8,
      thicknessMin: 8,
      thicknessMax: 40,
    },
  })

/** Крестик сброса — единственная кнопка в бейдже поля цвета. */
const resetButton = (w) => w.find('button.h-3\\.5')

describe('BodyStyleFields', () => {
  it('у дефолтного цвета сброса нет', () => {
    expect(resetButton(mount(DEFAULT)).exists()).toBe(false)
    // Регистр не важен: цвет мог приехать из чужого архива в верхнем.
    expect(resetButton(mount(DEFAULT.toUpperCase())).exists()).toBe(false)
  })

  it('свой цвет даёт сброс, который возвращает дефолт', async () => {
    const w = mount('#ff0000')
    const reset = resetButton(w)
    expect(reset.exists()).toBe(true)
    await reset.trigger('click')
    expect(w.emitted('update-color')).toEqual([[DEFAULT]])
  })
})
