// @vitest-environment jsdom
// Поле цвета: палитра правит живьём, код — по коммиту, недавние применяются кликом.
// Проверяем разбор ввода (цвет уезжает в модель и в CSS экспорта — мусор пройти не
// должен) и то, что «жест закончен» эмитится один раз. Содержимое палитры живёт в
// поповере, поэтому каждый кейс сначала его открывает.
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mountWithApp } from '../composables/test-utils'
import ColorField from './ColorField.vue'
import ColorPicker from 'primevue/colorpicker'
import Popover from 'primevue/popover'

const RECENT_KEY = 'tms.recentColors'

async function open(props = {}) {
  const w = mountWithApp(ColorField, { props })
  await w.find('button').trigger('click') // свотч-триггер
  await w.vm.$nextTick()
  return w
}

/** Единственное текстовое поле в поповере — код цвета. */
const hexInput = (w) => w.find('input[spellcheck="false"]')
/** Слоты недавних цветов — мелкие кнопки в ряду под палитрой. */
const recentSlots = (w) => w.findAll('button.h-5')

describe('ColorField', () => {
  beforeEach(() => localStorage.clear())

  it('свотч показывает 6-значный hex: короткая запись разворачивается', () => {
    const w = mountWithApp(ColorField, { props: { modelValue: '#0f0' } })
    expect(w.find('button > span').attributes('style')).toContain('rgb(0, 255, 0)')
  })

  // Идёт до кейсов, которые применяют цвета: список недавних живёт в модуле
  // (localStorage), и наполненный прошлыми кейсами он не оставил бы пустых слотов.
  it('пустой слот не кликается', async () => {
    const w = await open({ modelValue: '#000000' })
    // Последний слот пуст, пока не выбрали четыре цвета: клик по нему — не выбор.
    const last = recentSlots(w).at(-1)
    expect(last.attributes('disabled')).toBeDefined()
    await last.trigger('click')
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('пустое значение и «none» дают чёрный: своего «нет цвета» у поля нет', async () => {
    expect(hexInput(await open({ modelValue: '' })).element.value).toBe('#000000')
    expect(hexInput(await open({ modelValue: 'none' })).element.value).toBe('#000000')
  })

  it('палитра правит цвет живьём, а «жест закончен» — по закрытию', async () => {
    const w = await open({ modelValue: '#000000' })
    // ColorPicker отдаёт hex БЕЗ решётки.
    await w.findComponent(ColorPicker).vm.$emit('update:modelValue', 'ff8800')
    expect(w.emitted('update:modelValue').at(-1)).toEqual(['#ff8800'])
    expect(w.emitted('change')).toBeUndefined()

    // Промежуточные оттенки в историю не идут: считается последний перед закрытием.
    await w.findComponent(ColorPicker).vm.$emit('update:modelValue', '10b981')
    await w.findComponent(Popover).vm.$emit('hide')
    expect(w.emitted('change')).toHaveLength(1)
    // В недавние уходит ВЫБРАННЫЙ цвет, а не текущий `modelValue`: вызывающий мог
    // применить правку не сразу (или не применить — при «разных» значениях).
    expect(JSON.parse(localStorage.getItem(RECENT_KEY))[0]).toBe('#10b981')
  })

  it('закрытие без выбора в недавние ничего не пишет', async () => {
    const w = await open({ modelValue: '#000000' })
    await w.findComponent(Popover).vm.$emit('hide')
    expect(w.emitted('change')).toBeUndefined()
    expect(localStorage.getItem(RECENT_KEY)).toBeNull()
  })

  it('палитра ушла вместе с компонентом — выбор всё равно запомнился', async () => {
    // `hide` эмитится хуком анимации закрытия: если поповер размонтировался (сменилось
    // выделение, перерисовался инспектор), события не будет.
    const w = await open({ modelValue: '#000000' })
    await w.findComponent(ColorPicker).vm.$emit('update:modelValue', 'abcdef')
    w.unmount()
    await nextTick() // запись в localStorage идёт вотчером useLocalStorage
    expect(JSON.parse(localStorage.getItem(RECENT_KEY))[0]).toBe('#abcdef')
  })

  it('код применяется по Enter и уходит в недавние', async () => {
    const w = await open({ modelValue: '#000000' })
    await hexInput(w).setValue('#10b981')
    // Пока код набирают, промежуточные значения цветом не являются.
    expect(w.emitted('update:modelValue')).toBeUndefined()

    await hexInput(w).trigger('keydown.enter')
    expect(w.emitted('update:modelValue').at(-1)).toEqual(['#10b981'])
    expect(w.emitted('change')).toHaveLength(1)
    // Первым в недавних — только что применённый (список общий на приложение).
    expect(JSON.parse(localStorage.getItem(RECENT_KEY))[0]).toBe('#10b981')
  })

  it('код принимается без решётки и в короткой записи, регистр приводится', async () => {
    for (const [typed, expected] of [
      ['10B981', '#10b981'],
      ['0f0', '#00ff00'],
      ['  #ABCDEF ', '#abcdef'],
    ]) {
      const w = await open({ modelValue: '#000000' })
      await hexInput(w).setValue(typed)
      await hexInput(w).trigger('blur')
      expect(w.emitted('update:modelValue').at(-1)).toEqual([expected])
    }
  })

  it('мусор и повтор текущего значения ничего не меняют', async () => {
    const w = await open({ modelValue: '#10b981' })
    for (const typed of ['не цвет', '#12345', 'url(evil)', '#10b981']) {
      await hexInput(w).setValue(typed)
      await hexInput(w).trigger('blur')
      expect(w.emitted('update:modelValue')).toBeUndefined()
      expect(hexInput(w).element.value).toBe('#10b981')
    }
  })

  it('Esc отменяет набранное', async () => {
    const w = await open({ modelValue: '#10b981' })
    await hexInput(w).setValue('#ffffff')
    await hexInput(w).trigger('keydown.esc')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(hexInput(w).element.value).toBe('#10b981')
  })

  it('применённый цвет встаёт первым слотом и возвращается кликом', async () => {
    const w = await open({ modelValue: '#000000' })
    await hexInput(w).setValue('#ff0000')
    await hexInput(w).trigger('keydown.enter')

    const slots = recentSlots(w)
    // Слотов всегда четыре, сколько бы цветов ни было выбрано.
    expect(slots).toHaveLength(4)
    expect(slots[0].attributes('style')).toContain('rgb(255, 0, 0)')

    await slots[0].trigger('click')
    expect(w.emitted('update:modelValue').at(-1)).toEqual(['#ff0000'])
    expect(w.emitted('change')).toHaveLength(2) // код + клик по слоту
  })
})
