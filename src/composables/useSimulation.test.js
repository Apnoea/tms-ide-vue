// @vitest-environment jsdom
// Такт симуляции: классы и текст на живом DOM по значениям тегов — диапазоны, boolSource,
// булев биндинг шаблона, группы и цвет состояния «по значению», подпись со значением.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { dia, shapes } from '@joint/core'
import { useCanvas } from './useCanvas'
import { useSimulation } from './useSimulation'
import { registerStencil, unregisterStencil } from '../stencils/registry'
import { innerKey } from '../constants/ids'
import { CLASS_HIDDEN, CLASS_OFF, rangeColorClass, stateColorClass } from '../constants/animation'

const VALUE_ID = 'cell_sim_value'
const BOOL_ID = 'cell_sim_bool'

function setup() {
  registerStencil(
    {
      id: VALUE_ID,
      label: 'По значению',
      category: 'Тест',
      width: 20,
      height: 20,
      slots: [
        { key: 'value', type: 'Value' },
        { key: 'value_text', type: 'Text' },
      ],
      states: [
        { key: 'on', label: 'Вкл', code: '1' },
        { key: 'off', label: 'Выкл', code: '0' },
      ],
      stateColors: { on: '#00ff00' },
      animationTemplate: [
        { idSuffix: '.on', type: 'shape', bindings: [] },
        { idSuffix: '.off', type: 'shape', bindings: [] },
        { idSuffix: '.value', type: 'text', bindings: [{ tag: '{slot.value_text}' }] },
      ],
    },
    '<g/>'
  )
  registerStencil(
    {
      id: BOOL_ID,
      label: 'Булев',
      category: 'Тест',
      width: 20,
      height: 20,
      slots: [{ key: 'onoff', type: 'Boolean' }],
      animationTemplate: [
        {
          idSuffix: '.true',
          type: 'shape',
          bindings: [
            {
              tag: '{slot.onoff}',
              when: { cases: { false: { apply: { addClass: CLASS_HIDDEN } } } },
            },
          ],
        },
      ],
    },
    '<g/>'
  )

  const graph = new dia.Graph({}, { cellNamespace: shapes })
  const valueCell = new shapes.standard.Rectangle({ id: 'v1' })
  valueCell.set('tms', { stencilId: VALUE_ID, slots: { value: 'T.STATE', value_text: 'T.STATE' } })
  const boolCell = new shapes.standard.Rectangle({ id: 'b1' })
  boolCell.set('tms', { stencilId: BOOL_ID, slots: { onoff: 'B.ONOFF' } })
  const wire = new shapes.standard.Link({
    id: 'w1',
    source: { x: 0, y: 0 },
    target: { x: 10, y: 0 },
  })
  wire.set('tms', {
    rangeSource: { tag: 'T.U', ranges: [{ min: 0, max: 10, color: '#ff0000' }] },
    boolSource: { groups: [['B.ONOFF']] },
  })
  graph.addCells([valueCell, boolCell, wire])

  // DOM ячеек: группы состояний и подпись — по тем же id, что ставит инъекция.
  const els = new Map()
  const make = (id, inner) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.innerHTML = inner
    document.body.append(g)
    els.set(id, g)
  }
  const key = (stencilId, cellId, suffix) => innerKey(stencilId, cellId, suffix)
  make(
    'v1',
    `<g id="${key(VALUE_ID, 'v1', '.on')}"/><g id="${key(VALUE_ID, 'v1', '.off')}"/>` +
      `<text id="${key(VALUE_ID, 'v1', '.value')}">--</text>`
  )
  make('b1', `<g id="${key(BOOL_ID, 'b1', '.true')}"/>`)
  make('w1', '')
  const paper = { findViewByModel: (cell) => ({ el: els.get(cell.id) }) }
  useCanvas().setCanvasRefs(graph, paper)

  const byId = (cellId, stencilId, suffix) =>
    els.get(cellId).querySelector(`[id="${key(stencilId, cellId, suffix)}"]`)
  return { els, byId }
}

describe('useSimulation: такт', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => {
    useSimulation().stopSimulation()
    vi.useRealTimers()
    useCanvas().clearCanvasRefs()
    unregisterStencil(VALUE_ID)
    unregisterStencil(BOOL_ID)
    document.body.innerHTML = ''
  })

  it('значения тегов раскладываются в классы и текст; остановка всё снимает', () => {
    const { els, byId } = setup()
    const sim = useSimulation()
    sim.setTagValue('T.STATE', 1)
    sim.setTagValue('B.ONOFF', 0)
    sim.setTagValue('T.U', 5)
    sim.toggleSimulation()

    // «По значению»: код 1 → состояние on, группа off скрыта, символ перекрашен.
    expect(byId('v1', VALUE_ID, '.on').classList.contains(CLASS_HIDDEN)).toBe(false)
    expect(byId('v1', VALUE_ID, '.off').classList.contains(CLASS_HIDDEN)).toBe(true)
    expect(els.get('v1').classList.contains(stateColorClass(VALUE_ID, 'on'))).toBe(true)
    expect(byId('v1', VALUE_ID, '.value').textContent).toBe('1.00') // точность по умолчанию
    // Булев биндинг шаблона: тег false → класс case'а false.
    expect(byId('b1', BOOL_ID, '.true').classList.contains(CLASS_HIDDEN)).toBe(true)
    // Провод: строка диапазона по значению и выключение по boolSource.
    expect(els.get('w1').classList.contains(rangeColorClass('#ff0000'))).toBe(true)
    expect(els.get('w1').classList.contains(CLASS_OFF)).toBe(true)

    sim.stopSimulation()
    expect(byId('v1', VALUE_ID, '.off').classList.contains(CLASS_HIDDEN)).toBe(false)
    expect(els.get('w1').classList.contains(CLASS_OFF)).toBe(false)
    expect(byId('v1', VALUE_ID, '.value').textContent).toBe('--')
  })

  it('код, не совпавший ни с одним состоянием, прячет все группы', () => {
    const { byId } = setup()
    const sim = useSimulation()
    sim.setTagValue('T.STATE', 7)
    sim.toggleSimulation()
    expect(byId('v1', VALUE_ID, '.on').classList.contains(CLASS_HIDDEN)).toBe(true)
    expect(byId('v1', VALUE_ID, '.off').classList.contains(CLASS_HIDDEN)).toBe(true)
  })
})
