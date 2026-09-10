// @vitest-environment jsdom
// Вид тела шины и точки: сброс показывается ТОЛЬКО когда значение своё — дефолты в
// `tms` не пишутся, и крестик у дефолтного значения обещал бы работу, которой нет.
import { describe, it, expect } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import BodyStyleFields from './BodyStyleFields.vue'

const DEFAULT = '#64748b'
const THICKNESS_DEFAULT = 8

const mount = (props = {}) =>
  mountWithApp(BodyStyleFields, {
    props: {
      color: DEFAULT,
      colorDefault: DEFAULT,
      thickness: THICKNESS_DEFAULT,
      thicknessMin: THICKNESS_DEFAULT,
      thicknessMax: 40,
      thicknessDefault: THICKNESS_DEFAULT,
      ...props,
    },
  })

/** Крестики сброса — мелкие кнопки-бейджи: первая у цвета, вторая у толщины. */
const resetButtons = (w) => w.findAll('button.h-3\\.5')

describe('BodyStyleFields', () => {
  it('у дефолтных цвета и толщины сбросов нет', () => {
    expect(resetButtons(mount())).toHaveLength(0)
    // Регистр не важен: цвет мог приехать из чужого архива в верхнем.
    expect(resetButtons(mount({ color: DEFAULT.toUpperCase() }))).toHaveLength(0)
  })

  it('свой цвет даёт сброс, который возвращает дефолт', async () => {
    const w = mount({ color: '#ff0000' })
    const resets = resetButtons(w)
    expect(resets).toHaveLength(1)
    await resets[0].trigger('click')
    expect(w.emitted('update-color')).toEqual([[DEFAULT]])
  })

  it('своя толщина даёт сброс, который возвращает дефолт', async () => {
    const w = mount({ thickness: 20 })
    const resets = resetButtons(w)
    expect(resets).toHaveLength(1)
    await resets[0].trigger('click')
    expect(w.emitted('update-thickness')).toEqual([[THICKNESS_DEFAULT]])
  })

  it('оба свои — два сброса, цвет первым', () => {
    expect(resetButtons(mount({ color: '#ff0000', thickness: 20 }))).toHaveLength(2)
  })
})
