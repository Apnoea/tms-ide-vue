// Компонентные тесты инспектора холста. Юнит-тесты композаблов эти регрессии НЕ
// ловили: `.value` на Pinia-getter (пустые tag-picker'ы), commitNav по blur (запись
// в чужую ячейку), счётчики выделения. Поэтому проверяем через смонтированный
// компонент: реальные useCanvas (singleton) + Pinia, мокаем только реестр стенсилов
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
import { useProjectStore } from '../stores/useProjectStore'

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
