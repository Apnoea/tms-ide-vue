// @vitest-environment jsdom
// Разделитель колонок: жест ловится на document (курсор во время drag'а уходит с
// 6-пиксельной полоски), поэтому проверяем именно связку «pointerdown на ручке →
// pointermove на документе». Кламп ширины живёт в сторе, здесь только знак и величина.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountWithApp } from '../composables/test-utils'
import PaneResizer from './PaneResizer.vue'

let wrapper

/** MouseEvent вместо PointerEvent: в jsdom конструктора PointerEvent нет, а
 *  слушателю важны только тип и clientX. */
const down = (w, clientX, button = 0) =>
  w.element.dispatchEvent(new MouseEvent('pointerdown', { clientX, button, cancelable: true }))
const move = (clientX) => document.dispatchEvent(new MouseEvent('pointermove', { clientX }))
const up = () => document.dispatchEvent(new MouseEvent('pointerup'))

function mount(side, width = 380) {
  wrapper = mountWithApp(PaneResizer, { props: { side, width }, attachTo: document.body })
  return wrapper
}

describe('PaneResizer', () => {
  beforeEach(() => {
    document.body.style.userSelect = ''
  })

  afterEach(() => {
    up()
    wrapper?.unmount()
  })

  it('левая колонка растёт вслед за курсором', async () => {
    const w = mount('left', 380)
    down(w, 400)
    move(460)
    expect(w.emitted('update').at(-1)).toEqual([440])
    // Величина считается от НАЧАЛА жеста, а не от предыдущего кадра: иначе сдвиги
    // накапливались бы и панель уезжала быстрее курсора.
    move(500)
    expect(w.emitted('update').at(-1)).toEqual([480])
  })

  it('у правой колонки курсор двигает границу навстречу', async () => {
    const w = mount('right', 420)
    down(w, 1000)
    move(940)
    expect(w.emitted('update').at(-1)).toEqual([480])
  })

  it('без нажатия и после отпускания движение игнорируется', async () => {
    const w = mount('left', 380)
    move(999)
    expect(w.emitted('update')).toBeUndefined()

    down(w, 400)
    up()
    move(999)
    expect(w.emitted('update')).toBeUndefined()
  })

  it('не основная кнопка жест не начинает: средняя панит холст', async () => {
    const w = mount('left', 380)
    down(w, 400, 1)
    move(500)
    expect(w.emitted('update')).toBeUndefined()
  })

  it('на время drag’а гасит выделение текста и возвращает его в конце', async () => {
    const w = mount('left', 380)
    down(w, 400)
    expect(document.body.style.userSelect).toBe('none')
    up()
    expect(document.body.style.userSelect).toBe('')
  })

  it('исчезновение ручки в середине drag’а не оставляет стили на body', () => {
    // Колонку могли свернуть кнопкой, пока её тянут: `pointerup` до ручки уже не
    // дойдёт, и курсор-ресайз с запретом выделения залипли бы на всём приложении.
    const w = mount('left', 380)
    down(w, 400)
    w.unmount()
    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
  })

  it('двойной клик просит сброс к дефолту', async () => {
    const w = mount('left', 380)
    await w.trigger('dblclick')
    expect(w.emitted('reset')).toHaveLength(1)
  })
})
