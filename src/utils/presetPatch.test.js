// Правки проекта поверх символа набора: отличия, наложение на любую версию, чистка
// чужого патча. Главный инвариант — патч сходится с редактором: исходник + отличия дают
// тот же json, что собрал бы редактор из правленой модели.
import { describe, it, expect } from 'vitest'
import { buildStencilJson } from './stencilSvg'
import {
  applyPresetPatch,
  diffPresetPatch,
  hasPresetPatch,
  normalizePresetPatch,
  presetEditResult,
  rebaseOnPreset,
  sameShapeStates,
} from './presetPatch'

// Символ «по значению» из редактора: три состояния с фигурами, цвет у одного.
const SHAPES = [
  { type: 'rect', x: 0, y: 0, w: 10, h: 10, state: 'on' },
  { type: 'rect', x: 10, y: 0, w: 10, h: 10, state: 'off' },
  { type: 'rect', x: 0, y: 10, w: 10, h: 10, state: 'mid' },
]

function meta(overrides = {}) {
  return {
    id: 'demo_qs',
    label: 'Разъединитель',
    category: 'Коммутация',
    width: 20,
    height: 20,
    domains: ['energy'],
    quality: false,
    stateful: true,
    stateMode: 'value',
    stateSlot: { key: 'value' },
    states: [
      { key: 'on', label: 'Вкл', code: '1' },
      { key: 'off', label: 'Откл', code: '0' },
      { key: 'mid', label: 'Пром', code: '2' },
    ],
    stateColors: { on: '#ff0000' },
    ranges: [],
    ...overrides,
  }
}

const symbol = (overrides, shapes = SHAPES) => buildStencilJson(meta(overrides), [], shapes)

// Порядок слотов функционально не важен (слот-драйвер ищется по типу), а редактор и
// патч добавляют слот `range` в разные места списка.
const canon = (json) => ({
  ...json,
  slots: [...(json.slots || [])].sort((a, b) => (a.key < b.key ? -1 : 1)),
})

const hideOn = (json, key) =>
  Object.keys(json.animationTemplate.find((c) => c.idSuffix === `.${key}`).bindings[0].when.cases)

describe('diffPresetPatch', () => {
  it('символ без правок — пустой патч', () => {
    expect(diffPresetPatch(symbol(), symbol())).toEqual({})
    expect(hasPresetPatch(diffPresetPatch(symbol(), symbol()))).toBe(false)
  })

  it('коды и подписи — по ключу, только изменённое поле', () => {
    const edited = symbol({
      states: [
        { key: 'on', label: 'Вкл', code: '5' },
        { key: 'off', label: 'Отключен', code: '0' },
        { key: 'mid', label: 'Пром', code: '2' },
      ],
    })
    expect(diffPresetPatch(symbol(), edited)).toEqual({
      states: { on: { code: '5' }, off: { label: 'Отключен' } },
    })
  })

  // Снятый цвет — не «ничего», а явное null: иначе наложение вернуло бы цвет набора.
  it('цвета: новый, изменённый и снятый (null)', () => {
    const edited = symbol({ stateColors: { off: '#00ff00', mid: { stroke: '#0000ff' } } })
    expect(diffPresetPatch(symbol(), edited).stateColors).toEqual({
      on: null,
      off: '#00ff00',
      mid: '#0000ff',
    })
  })

  it('диапазоны — списком целиком; снятые — пустым списком', () => {
    const ranges = [{ min: 0, max: 5, color: '#10b981' }]
    expect(diffPresetPatch(symbol(), symbol({ ranges })).ranges).toEqual(ranges)
    expect(diffPresetPatch(symbol({ ranges }), symbol()).ranges).toEqual([])
  })

  it('галки, категория и области; порядок областей не важен', () => {
    const base = symbol({ domains: ['energy', 'network'] })
    const edited = symbol({
      domains: ['network', 'energy'],
      quality: true,
      noRotate: true,
      category: 'Коммутация 110 кВ',
    })
    expect(diffPresetPatch(base, edited)).toEqual({
      quality: true,
      noRotate: true,
      category: 'Коммутация 110 кВ',
    })
  })

  it('видимость фигур решает вызывающий — флаг drawing', () => {
    expect(diffPresetPatch(symbol(), symbol(), { drawing: true })).toEqual({ drawing: true })
  })
})

describe('applyPresetPatch', () => {
  it('исходник + отличия = json, который собрал бы редактор', () => {
    const base = symbol()
    const edited = symbol({
      states: [
        { key: 'on', label: 'Включен', code: '5' },
        { key: 'off', label: 'Откл', code: '0' },
        { key: 'mid', label: 'Пром', code: '' },
      ],
      stateColors: { off: '#00ff00' },
      ranges: [{ min: 0, max: 10, color: '#ef4444' }],
      quality: true,
      noFlip: true,
      category: 'Своя',
      domains: [],
    })
    const { json, dropped } = applyPresetPatch(base, diffPresetPatch(base, edited))
    expect(dropped).toEqual([])
    expect(canon(json)).toEqual(canon(edited))
  })

  // Карточка прячет группу на кодах соседей: правка одного кода меняет всех остальных.
  it('смена кода пересчитывает карточки соседей', () => {
    const { json } = applyPresetPatch(symbol(), { states: { on: { code: '5' } } })
    expect(hideOn(json, 'on').sort()).toEqual(['0', '2'])
    expect(hideOn(json, 'off').sort()).toEqual(['2', '5'])
    expect(hideOn(json, 'mid').sort()).toEqual(['0', '5'])
  })

  it('на новой версии: правки проекта сверху, новое из набора приходит само', () => {
    const v1 = symbol()
    const project = symbol({
      states: [...meta().states.map((s) => (s.key === 'on' ? { ...s, code: '5' } : s))],
    })
    const patch = diffPresetPatch(v1, project)
    // В 2.0 добавили состояние «Недостоверно» с фигурой и поменяли категорию.
    const v2 = symbol(
      {
        category: 'Коммутация (2.0)',
        states: [...meta().states, { key: 'bad', label: 'Недост', code: '9' }],
      },
      [...SHAPES, { type: 'rect', x: 10, y: 10, w: 10, h: 10, state: 'bad' }]
    )
    const { json, dropped } = applyPresetPatch(v2, patch)
    expect(dropped).toEqual([])
    expect(json.states.find((s) => s.key === 'on').code).toBe('5')
    expect(json.states.map((s) => s.key)).toEqual(['on', 'off', 'mid', 'bad'])
    expect(json.category).toBe('Коммутация (2.0)') // проект категорию не трогал
    // Новая карточка тоже считает коды проекта.
    expect(hideOn(json, 'bad').sort()).toEqual(['0', '2', '5'])
  })

  it('ключ, пропавший в новой версии, отбрасывается с отчётом, остальное ложится', () => {
    const v2 = symbol({ states: meta().states.filter((s) => s.key !== 'mid') }, SHAPES.slice(0, 2))
    const { json, dropped } = applyPresetPatch(v2, {
      states: { on: { code: '5' }, mid: { code: '7' } },
      stateColors: { mid: '#123456' },
    })
    expect(dropped).toEqual(['mid'])
    expect(json.states.find((s) => s.key === 'on').code).toBe('5')
    expect(json.stateColors).toEqual({ on: '#ff0000' })
  })

  it('снятые цвета и зоны снимаются вместе со слотом range', () => {
    const base = symbol({ ranges: [{ min: 0, max: 5, color: '#10b981' }] })
    const { json } = applyPresetPatch(base, { stateColors: { on: null }, ranges: [] })
    expect(json.stateColors).toBeUndefined()
    expect(json.ranges).toBeUndefined()
    expect(json.slots.map((s) => s.key)).toEqual(['value'])
  })

  it('исходник не мутируется', () => {
    const base = symbol()
    const before = JSON.stringify(base)
    applyPresetPatch(base, { states: { on: { code: '5' } }, quality: true, domains: [] })
    expect(JSON.stringify(base)).toBe(before)
  })

  // Подпись со значением тега — тоже карточка с суффиксом через точку, но `text`.
  it('карточку подписи со значением тега не трогает', () => {
    const shapes = [...SHAPES, { type: 'text', x: 0, y: 20, text: '0', valueText: true }]
    const base = symbol({}, shapes)
    const textCard = base.animationTemplate.find((c) => c.type === 'text')
    const { json } = applyPresetPatch(base, { states: { on: { code: '5' } } })
    expect(json.animationTemplate.find((c) => c.type === 'text')).toEqual(textCard)
  })

  it('булев символ: цвета по true/false, кодов нет', () => {
    const base = symbol({ stateMode: 'boolean', states: [], stateSlot: { key: 'onoff' } }, [
      { type: 'rect', x: 0, y: 0, w: 10, h: 10, state: 'true' },
    ])
    const { json, dropped } = applyPresetPatch(base, { stateColors: { false: '#00ff00' } })
    expect(dropped).toEqual([])
    expect(json.stateColors).toEqual({ false: '#00ff00' })
  })
})

describe('normalizePresetPatch', () => {
  it('ключи состояний по маске, коды и подписи одной строкой', () => {
    expect(
      normalizePresetPatch({
        states: { on: { code: ' 5 ', label: 'Вкл\nючен' }, 'bad}key': { code: '1' }, off: 'x' },
      })
    ).toEqual({ states: { on: { code: '5', label: 'Вкл ючен' } } })
  })

  // Подделка не должна стирать цвет набора: невалидный цвет пропускается, а не «снят».
  it('цвета: невалидный пропущен, null сохранён', () => {
    expect(
      normalizePresetPatch({ stateColors: { on: 'red; }', off: null, mid: { fill: '#abc' } } })
    ).toEqual({ stateColors: { off: null, mid: { fill: '#abc' } } })
  })

  it('зоны каноном строк, галки только булевы, области по списку', () => {
    expect(
      normalizePresetPatch({
        ranges: [
          { min: 0, max: 5, color: '#10b981' },
          { min: 'x', color: 'nope' },
        ],
        quality: 'yes',
        noFlip: false,
        domains: ['energy', 'мусор'],
        category: '  Своя  ',
        drawing: 'true',
      })
    ).toEqual({
      ranges: [{ min: 0, max: 5, color: '#10b981' }],
      noFlip: false,
      domains: ['energy'],
      category: 'Своя',
    })
  })

  it('ничего годного — undefined', () => {
    expect(normalizePresetPatch({ states: { 'a b': {} }, quality: 1 })).toBeUndefined()
    expect(normalizePresetPatch([])).toBeUndefined()
    expect(normalizePresetPatch('patch')).toBeUndefined()
  })
})

describe('sameShapeStates', () => {
  it('те же фигуры в тех же состояниях — совпадает; порядок и id редактора не важны', () => {
    const edited = [...SHAPES].reverse().map((sh, i) => ({ id: `s${i}`, ...sh }))
    expect(sameShapeStates(SHAPES, edited)).toBe(true)
  })

  it('фигура переложена в другое состояние — видимость своя', () => {
    const moved = SHAPES.map((sh) => (sh.state === 'mid' ? { ...sh, state: 'on' } : sh))
    expect(sameShapeStates(SHAPES, moved)).toBe(false)
  })
})

describe('presetEditResult', () => {
  const PRESET = { id: 'demo', name: 'Демо', version: '1.0' }
  const base = { stencilJson: { ...symbol(), preset: PRESET }, shapeSvg: '<svg>набор</svg>' }

  // Символ, совпавший с набором, правки проекта не держит — иначе перекрывал бы обновления.
  it('без отличий — символ снова чистый, рисунок набора', () => {
    const r = presetEditResult(base, symbol(), { editedSvg: '<svg>редактор</svg>' })
    expect(r.pristine).toBe(true)
    expect(r.svg).toBe('<svg>набор</svg>')
    expect(r.json.presetPatch).toBeUndefined()
  })

  it('правка кодов — патч в json поверх исходника, рисунок набора', () => {
    const edited = symbol({
      states: meta().states.map((s) => (s.key === 'on' ? { ...s, code: '5' } : s)),
    })
    const r = presetEditResult(base, edited, { editedSvg: '<svg>редактор</svg>' })
    expect(r.pristine).toBe(false)
    expect(r.json.presetPatch).toEqual({ states: { on: { code: '5' } } })
    expect(r.json.preset).toEqual(PRESET)
    expect(r.svg).toBe('<svg>набор</svg>')
  })

  it('своя видимость фигур — рисунок редактора и флаг drawing', () => {
    const r = presetEditResult(base, symbol(), { editedSvg: '<svg>редактор</svg>', drawing: true })
    expect(r.pristine).toBe(false)
    expect(r.json.presetPatch).toEqual({ drawing: true })
    expect(r.svg).toBe('<svg>редактор</svg>')
  })

  // Карточка есть только у состояния с фигурами: json из исходника не знал бы о
  // состоянии, куда фигуру переложили, и она была бы видна всегда.
  it('фигура переложена в состояние без фигур — карточка у него появляется', () => {
    const twoStates = SHAPES.slice(0, 2) // у «mid» в наборе фигур нет — и карточки нет
    const presetBase = {
      stencilJson: { ...symbol({}, twoStates), preset: PRESET },
      shapeSvg: '<svg>набор</svg>',
    }
    expect(presetBase.stencilJson.animationTemplate.map((c) => c.idSuffix)).toEqual(['.on', '.off'])
    const edited = symbol({}, [twoStates[0], { ...twoStates[1], state: 'mid' }])
    const r = presetEditResult(presetBase, edited, { editedSvg: '<svg>р</svg>', drawing: true })
    expect(r.json.animationTemplate.map((c) => c.idSuffix)).toEqual(['.on', '.mid'])
  })
})

describe('rebaseOnPreset', () => {
  const mark = (version) => ({ id: 'demo', name: 'Демо', version })
  const v1 = { stencilJson: { ...symbol(), preset: mark('1.0') }, shapeSvg: '<svg>1.0</svg>' }
  const onCode = (code) => meta().states.map((s) => (s.key === 'on' ? { ...s, code } : s))
  // Символ проекта, сохранённый редактором на версии 1.0.
  const project = (patch, svg = '<svg>1.0</svg>') => ({
    stencilJson: { ...applyPresetPatch(v1.stencilJson, patch).json, presetPatch: patch },
    shapeSvg: svg,
  })

  it('та же версия, правка кодов — остаётся как была', () => {
    const r = rebaseOnPreset(v1, project({ states: { on: { code: '5' } } }))
    expect(r.pristine).toBe(false)
    expect(r.json.states.find((s) => s.key === 'on').code).toBe('5')
    expect(r.svg).toBe('<svg>1.0</svg>')
    expect(r.drawingReset).toBe(false)
  })

  it('та же версия, свой рисунок — символ проекта как есть', () => {
    const p = project({ drawing: true }, '<svg>проект</svg>')
    const r = rebaseOnPreset(v1, p)
    expect(r.svg).toBe('<svg>проект</svg>')
    expect(r.json.presetPatch).toEqual({ drawing: true })
  })

  it('новая версия: коды проекта сверху, рисунок новый, своя видимость сброшена', () => {
    const v2 = {
      stencilJson: { ...symbol({ category: 'Новая' }), preset: mark('2.0') },
      shapeSvg: '<svg>2.0</svg>',
    }
    const r = rebaseOnPreset(v2, project({ states: { on: { code: '5' } }, drawing: true }))
    expect(r.json.preset.version).toBe('2.0')
    expect(r.json.states.find((s) => s.key === 'on').code).toBe('5')
    expect(r.json.category).toBe('Новая')
    expect(r.svg).toBe('<svg>2.0</svg>')
    expect(r.drawingReset).toBe(true)
    expect(r.json.presetPatch).toEqual({ states: { on: { code: '5' } } })
  })

  it('новая версия без нужного состояния: ключ выпадает, остальное остаётся', () => {
    const v2 = {
      stencilJson: {
        ...symbol({ states: meta().states.filter((s) => s.key !== 'mid') }, SHAPES.slice(0, 2)),
        preset: mark('2.0'),
      },
      shapeSvg: '<svg>2.0</svg>',
    }
    const r = rebaseOnPreset(v2, project({ states: { on: { code: '5' }, mid: { code: '7' } } }))
    expect(r.dropped).toEqual(['mid'])
    expect(r.json.presetPatch).toEqual({ states: { on: { code: '5' } } })
  })

  it('новая версия, из правок ничего не перенеслось — символ чистый', () => {
    const v2 = { stencilJson: { ...symbol(), preset: mark('2.0') }, shapeSvg: '<svg>2.0</svg>' }
    const r = rebaseOnPreset(v2, project({ drawing: true }, '<svg>проект</svg>'))
    expect(r.pristine).toBe(true)
    expect(r.drawingReset).toBe(true)
    expect(r.svg).toBe('<svg>2.0</svg>')
  })

  // Правки, сохранённые снимком до появления патча, становятся патчем при подъёме.
  it('снимок прошлого формата превращается в патч', () => {
    const snapshot = {
      stencilJson: { ...symbol({ states: onCode('5') }), preset: mark('1.0') },
      shapeSvg: '<svg>1.0</svg>',
    }
    const r = rebaseOnPreset(v1, snapshot)
    expect(r.json.presetPatch).toEqual({ states: { on: { code: '5' } } })
  })
})
