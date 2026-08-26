// Компонентные тесты инспектора холста. Юнит-тесты композаблов эти регрессии НЕ
// ловили: `.value` на Pinia-getter (пустые tag-picker'ы), commitNav по blur (запись
// в чужую ячейку), счётчики выделения. Поэтому проверяем через смонтированный
// компонент: реальные useCanvas (singleton) + Pinia, мокаем только реестр символов
// и DOM-инъекцию SVG.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dia, shapes } from '@joint/core'
import { TMSStencil, tmsNamespace } from '../stencils/tmsStencil'
import { mountWithApp } from '../composables/test-utils'

vi.mock('../stencils/registry', () => ({
  // Булев символ: slot.onoff с `type: 'Boolean'` — именно по типу слота инспектор
  // фильтрует теги в picker'е (не по имени ключа), как в настоящем cell_qw.
  getStencilById: vi.fn((id) =>
    id
      ? {
          id,
          label: 'Тест',
          category: 'Тест',
          width: 20,
          height: 20,
          slots: [{ key: 'onoff', type: 'Boolean' }],
        }
      : null
  ),
  hasBoolSlot: vi.fn((s) => !!s?.slots?.some((x) => x.key === 'onoff')),
}))

// SVG-инъекция в DOM в тестах не нужна (paper.findViewByModel → null и так её
// пропускает), остальное из svgInjector — реальное (текстометрия и т.п.).
vi.mock('../stencils/svgInjector', async (importActual) => ({
  ...(await importActual()),
  injectStencilSvg: vi.fn(),
}))

import CanvasInspector from './CanvasInspector.vue'
import TagPickerDialog from './TagPickerDialog.vue'
import BooleanBlock from './BooleanBlock.vue'
import { useCanvas } from '../composables/useCanvas'
import { materializeShape } from '../stencils/shapeElement'
import { useProjectStore } from '../stores/useProjectStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { createPinia, setActivePinia } from 'pinia'

const TAGS = [
  { name: 'BR1.ONOFF', type: 'Boolean' },
  { name: 'PT1.VALUE', type: 'Float' },
]

function makeCell({ locked = false, stencilId = 'cell_qw' } = {}) {
  const tms = { stencilId }
  if (locked) tms.locked = true
  return new TMSStencil({ position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, tms })
}

describe('CanvasInspector', () => {
  let canvas
  let graph
  let wrapper

  beforeEach(() => {
    canvas = useCanvas()
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    canvas.setCanvasRefs(graph, {
      id: 'paper',
      options: { gridSize: 5 },
      findViewByModel: () => null,
    })
    canvas.clearSelection()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  /** Монтирует инспектор и заполняет tag-list (пикеры фильтруют по типу тега). */
  function setup() {
    wrapper = mountWithApp(CanvasInspector, { global: { stubs: { TagPickerDialog: true } } })
    useProjectStore().setTags(TAGS)
    return wrapper
  }

  it('tag-picker булева слота получает bool-теги (getters стора — без .value)', async () => {
    const cell = makeCell()
    graph.addCell(cell)
    canvas.selectOnly('cell', cell.id)
    setup()
    await wrapper.vm.$nextTick()

    // Открываем picker так же, как это делает клик по чипу тега в блоке.
    wrapper.findComponent(BooleanBlock).vm.$emit('open-slot-picker')
    await wrapper.vm.$nextTick()

    const picker = wrapper.findComponent(TagPickerDialog)
    expect(picker.props('visible')).toBe(true)
    // Регрессия: `project.booleanTags.value` давал undefined → пустой picker
    // с сообщением «tag-list не загружен».
    expect(picker.props('tags').map((t) => t.name)).toEqual(['BR1.ONOFF'])
  })

  it('мульти-режим: провода не считаются символами, «Удалить» — по фактически удаляемым', async () => {
    const a = makeCell()
    const b = makeCell({ locked: true })
    const link = new shapes.standard.Link({ source: { id: a.id }, target: { id: b.id } })
    graph.addCells([a, b, link])
    canvas.setSelection([
      { kind: 'cell', id: a.id },
      { kind: 'cell', id: b.id },
      { kind: 'link', id: link.id },
    ])
    setup()
    await wrapper.vm.$nextTick()

    const text = wrapper.text()
    expect(text).toContain('2 символа + 1 провод') // не «3 символа»
    expect(text).toContain('1 заблокировано')
    // Удалятся свободная ячейка + провод; locked остаётся.
    expect(text).toContain('Удалить (2)')
  })

  it('commitNav не пишет навигацию в ЧУЖУЮ ячейку после смены выделения', async () => {
    const a = makeCell()
    const b = makeCell()
    graph.addCells([a, b])
    canvas.selectOnly('cell', a.id)
    setup()
    await wrapper.vm.$nextTick()

    // Черновик поля навигации набран для ячейки A…
    wrapper.vm.navInput = 'view_a'
    // …а выделение уже переехало на B (клик приходит ДО blur поля).
    canvas.selectOnly('cell', b.id)
    await wrapper.vm.$nextTick()
    wrapper.vm.commitNav()

    expect(b.get('tms').navigation).toBeUndefined()
    expect(a.get('tms').navigation).toBeUndefined()
  })
  it('cell_value: ввод подписи и единицы пишется в tms (без справочника величин)', async () => {
    const cell = makeCell({ stencilId: 'cell_value' })
    cell.set('tms', { stencilId: 'cell_value', valueTag: 'T1.UA' })
    graph.addCell(cell)
    canvas.selectOnly('cell', cell.id)
    setup()
    await wrapper.vm.$nextTick()

    const inputs = wrapper.findAll('input[type="text"]')
    await inputs.find((i) => i.attributes('placeholder') === 'Ua').setValue('Ua')
    await inputs.find((i) => i.attributes('placeholder') === 'В').setValue('В')
    await wrapper.vm.$nextTick()

    expect(cell.get('tms')).toMatchObject({ valueLabel: 'Ua', valueUnit: 'В' })
  })
})

describe('CanvasInspector: фигура-разметка', () => {
  let canvas
  let graph
  let wrapper

  beforeEach(() => {
    canvas = useCanvas()
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    canvas.setCanvasRefs(graph, {
      id: 'paper',
      options: { gridSize: 5 },
      findViewByModel: () => null,
    })
    canvas.clearSelection()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  function selectShape(shape) {
    const cell = materializeShape(graph, canvas.paperRef.value, shape)
    canvas.selectOnly('cell', cell.id)
    wrapper = mountWithApp(CanvasInspector, { global: { stubs: { TagPickerDialog: true } } })
    return cell
  }

  it('у фигуры показывает её тип и НЕ показывает блоки анимаций', async () => {
    selectShape({ type: 'rect', x: 0, y: 0, w: 40, h: 20, stroke: '#000', strokeWidth: 2 })
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    expect(text).toContain('Фигура')
    expect(text).toContain('Прямоугольник')
    // Анимаций у разметки нет — блоки тегов не рендерим (иначе привязка вела бы
    // в никуда: карточек для фигур exporter не эмитит).
    expect(wrapper.findComponent(BooleanBlock).exists()).toBe(false)
    expect(text).not.toContain('Диапазоны значений')
  })

  it('правка цвета пишет в tms.shape выделенной фигуры', async () => {
    const cell = selectShape({ type: 'rect', x: 0, y: 0, w: 40, h: 20 })
    await wrapper.vm.$nextTick()

    const colorInput = wrapper.find('input[type="color"]')
    expect(colorInput.exists()).toBe(true)
    colorInput.element.value = '#ff0000'
    await colorInput.trigger('input')

    expect(cell.get('tms').shape.stroke).toBe('#ff0000')
  })

  it('пустое поле текста удаляет подпись, но только по коммиту', async () => {
    // Подпись без текста невидима (габарит схлопывается) и отбрасывается на
    // загрузке — поэтому пустое поле её удаляет. На каждый символ удалять нельзя:
    // стирание «под новый текст» сносило бы фигуру на первом же пустом состоянии.
    const cell = selectShape({ type: 'text', x: 20, y: 20, text: 'Подпись', fontSize: 14 })
    await wrapper.vm.$nextTick()
    const input = wrapper.find('textarea')
    input.element.value = ''
    await input.trigger('input')
    expect(graph.getCell(cell.id)).toBeTruthy()
    await input.trigger('blur')
    expect(graph.getCell(cell.id)).toBeFalsy()
  })

  it('непустой текст пишется в фигуру живьём', async () => {
    const cell = selectShape({ type: 'text', x: 20, y: 20, text: 'Подпись', fontSize: 14 })
    await wrapper.vm.$nextTick()
    const input = wrapper.find('textarea')
    input.element.value = 'Секция'
    await input.trigger('input')
    expect(cell.get('tms').shape.text).toBe('Секция')
    await input.trigger('blur')
    expect(graph.getCell(cell.id)).toBeTruthy()
  })

  it('перенос строки в поле растит габарит ячейки вниз', async () => {
    // Подпись правится в Textarea (Enter = новая строка), поэтому в модель приходит
    // многострочный текст — ячейка обязана стать выше, иначе фигура вылезет за неё.
    const cell = selectShape({ type: 'text', x: 20, y: 20, text: 'Ввод', fontSize: 14 })
    await wrapper.vm.$nextTick()
    const before = cell.get('size').height
    const top = cell.get('position').y
    const input = wrapper.find('textarea')
    input.element.value = 'Ввод\nячейка 12'
    await input.trigger('input')
    expect(cell.get('tms').shape.text).toBe('Ввод\nячейка 12')
    expect(cell.get('size').height).toBeGreaterThan(before)
    expect(cell.get('position').y).toBe(top)
  })

  it('у линии нет заливки, у подписи есть текст и шрифт', async () => {
    selectShape({ type: 'line', x1: 0, y1: 0, x2: 40, y2: 0 })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('Заливка')
    wrapper.unmount()

    selectShape({ type: 'text', x: 20, y: 20, text: 'Подпись', fontSize: 14 })
    wrapper = mountWithApp(CanvasInspector, { global: { stubs: { TagPickerDialog: true } } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Текст')
    expect(wrapper.text()).toContain('Шрифт')
    expect(wrapper.text()).not.toContain('Толщина')
  })
})

// Стиль провода правится на ВСЁ выделение, а при пустом выделении — как настройки
// нового провода («липкие»): серию однотипных линий настраивают один раз.
describe('CanvasInspector: стиль провода', () => {
  let canvas
  let graph
  let wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    canvas = useCanvas()
    graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    canvas.setCanvasRefs(graph, {
      id: 'paper',
      options: { gridSize: 5 },
      findViewByModel: () => null,
    })
    canvas.clearSelection()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  function twoLinks() {
    const a = new shapes.standard.Link({ source: { x: 0, y: 0 }, target: { x: 40, y: 0 } })
    const b = new shapes.standard.Link({ source: { x: 0, y: 20 }, target: { x: 40, y: 20 } })
    graph.addCells([a, b])
    return [a, b]
  }

  function mount() {
    wrapper = mountWithApp(CanvasInspector, { global: { stubs: { TagPickerDialog: true } } })
    return wrapper
  }

  it('цвет применяется ко всем выделенным проводам', async () => {
    const [a, b] = twoLinks()
    canvas.setSelection([
      { kind: 'link', id: a.id },
      { kind: 'link', id: b.id },
    ])
    mount()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('2 провода')

    const color = wrapper.find('input[type="color"]')
    color.element.value = '#ff0000'
    await color.trigger('input')
    expect(a.get('tms').strokeColor).toBe('#ff0000')
    expect(b.get('tms').strokeColor).toBe('#ff0000')
  })

  it('расхождение показывается как «разные», а не подменяется значением первого', async () => {
    const [a, b] = twoLinks()
    a.set('tms', { strokeColor: '#ff0000' })
    b.set('tms', { strokeColor: '#00ff00' })
    canvas.setSelection([
      { kind: 'link', id: a.id },
      { kind: 'link', id: b.id },
    ])
    mount()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('разные')
  })

  it('заблокированный провод не правим', async () => {
    const [a, b] = twoLinks()
    b.set('tms', { locked: true })
    canvas.setSelection([
      { kind: 'link', id: a.id },
      { kind: 'link', id: b.id },
    ])
    mount()
    await wrapper.vm.$nextTick()
    const color = wrapper.find('input[type="color"]')
    color.element.value = '#ff0000'
    await color.trigger('input')
    expect(a.get('tms').strokeColor).toBe('#ff0000')
    expect(b.get('tms').strokeColor).toBeUndefined()
  })

  it('правка запоминается как вид НОВОГО провода', async () => {
    const [a] = twoLinks()
    canvas.setSelection([{ kind: 'link', id: a.id }])
    mount()
    await wrapper.vm.$nextTick()
    const color = wrapper.find('input[type="color"]')
    color.element.value = '#123456'
    await color.trigger('input')
    expect(useWorkspaceStore().wireStyle.strokeColor).toBe('#123456')
  })

  it('при пустом выделении блока стиля нет — прежняя заглушка', async () => {
    canvas.clearSelection()
    mount()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Ничего не выделено')
    expect(wrapper.find('input[type="color"]').exists()).toBe(false)
  })

  it('дефолтное значение снимает поле, а не пишет его в tms', async () => {
    const [a] = twoLinks()
    a.set('tms', { strokeColor: '#ff0000' })
    canvas.setSelection([{ kind: 'link', id: a.id }])
    mount()
    await wrapper.vm.$nextTick()
    const color = wrapper.find('input[type="color"]')
    color.element.value = '#000000'
    await color.trigger('input')
    expect(a.get('tms').strokeColor).toBeUndefined()
    expect(useWorkspaceStore().wireStyle.strokeColor).toBeUndefined()
  })
})
