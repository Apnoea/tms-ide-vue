import { describe, it, expect } from 'vitest'
import {
  serializeSvg,
  buildStencilJson,
  stencilDraftIssues,
  cropToContent,
  parseStencilSvg,
} from './stencilSvg'

describe('serializeSvg', () => {
  it('оборачивает фигуры в svg с viewBox из meta', () => {
    const svg = serializeSvg([], { width: 40, height: 20 })
    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(svg).toContain('viewBox="0 0 40 20"')
    expect(svg).toContain('width="40"')
    expect(svg).toContain('height="20"')
  })

  it('rect — с fill и обводкой', () => {
    const svg = serializeSvg(
      [{ type: 'rect', x: 0, y: 0, w: 20, h: 20, stroke: '#000', strokeWidth: 2 }],
      { width: 20, height: 20 }
    )
    expect(svg).toContain(
      '<rect x="0" y="0" width="20" height="20" fill="none" stroke="#000" stroke-width="2"/>'
    )
  })

  it('stateful: заливаемый примитив получает class="tms-state-fill" (в т.ч. контурный)', () => {
    // Гейт по ТИПУ, не по текущему fill: контурный круг (fill=none) тоже можно
    // залить в конкретном состоянии → маркер должен быть. Только у stateful.
    const svg = serializeSvg(
      [
        { type: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#ff0000', stroke: '#000' },
        { type: 'circle', cx: 10, cy: 10, r: 9, fill: 'none' },
        {
          type: 'polyline',
          points: [
            [0, 0],
            [5, 5],
            [0, 5],
          ],
          closed: true,
        },
      ],
      { width: 20, height: 20, stateful: true }
    )
    expect(svg).toContain('<rect class="tms-state-fill" x="0" y="0"')
    expect(svg).toContain('<circle class="tms-state-fill" cx="10"')
    expect(svg).toContain('<polygon class="tms-state-fill" points=')
  })

  it('линия и открытая ломаная — без class tms-state-fill (заливать нечего)', () => {
    const svg = serializeSvg(
      [
        { type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 },
        {
          type: 'polyline',
          points: [
            [0, 0],
            [5, 5],
          ],
        },
      ],
      { width: 20, height: 20, stateful: true }
    )
    expect(svg).not.toContain('tms-state-fill')
  })

  it('НЕ-stateful стенсил — без class tms-state-fill даже у заливаемых фигур', () => {
    const svg = serializeSvg([{ type: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#ff0000' }], {
      width: 20,
      height: 20,
    })
    expect(svg).not.toContain('tms-state-fill')
  })

  it('line — без fill', () => {
    const svg = serializeSvg([{ type: 'line', x1: 5, y1: 10, x2: 15, y2: 10 }], {
      width: 20,
      height: 20,
    })
    expect(svg).toContain('<line x1="5" y1="10" x2="15" y2="10" stroke="#000" stroke-width="2"/>')
    expect(svg.match(/<line[^>]*fill/)).toBeNull()
  })

  it('circle — cx/cy/r', () => {
    const svg = serializeSvg([{ type: 'circle', cx: 10, cy: 10, r: 8 }], { width: 20, height: 20 })
    expect(svg).toContain(
      '<circle cx="10" cy="10" r="8" fill="none" stroke="#000" stroke-width="2"/>'
    )
  })

  it('polyline — points через пробел', () => {
    const svg = serializeSvg(
      [
        {
          type: 'polyline',
          points: [
            [0, 0],
            [10, 10],
            [20, 0],
          ],
        },
      ],
      { width: 20, height: 20 }
    )
    expect(svg).toContain('points="0,0 10,10 20,0"')
  })

  it('дефолты обводки при отсутствии полей', () => {
    const svg = serializeSvg([{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }], {
      width: 10,
      height: 10,
    })
    expect(svg).toContain('stroke="#000"')
    expect(svg).toContain('stroke-width="2"')
    expect(svg).toContain('fill="none"')
  })

  it('чистит float-хвосты в координатах', () => {
    const svg = serializeSvg([{ type: 'circle', cx: 10.0, cy: 10.0, r: 7.5 }], {
      width: 20,
      height: 20,
    })
    expect(svg).toContain('cx="10" cy="10" r="7.5"')
  })

  it('неизвестный тип примитива пропускается', () => {
    const svg = serializeSvg([{ type: 'bezier' }, { type: 'rect', x: 0, y: 0, w: 5, h: 5 }], {
      width: 10,
      height: 10,
    })
    expect(svg).not.toContain('bezier')
    expect(svg).toContain('<rect')
  })
})

describe('buildStencilJson', () => {
  it('собирает базовые поля + shapeFile', () => {
    const json = buildStencilJson(
      { id: 'cell_x', label: 'X', category: 'Прочее', width: 20, height: 20 },
      []
    )
    expect(json).toEqual({
      id: 'cell_x',
      label: 'X',
      category: 'Прочее',
      shapeFile: 'shape.svg',
      width: 20,
      height: 20,
    })
  })

  it('добавляет ports только когда они есть', () => {
    const json = buildStencilJson(
      { id: 'cell_x', label: 'X', category: 'Прочее', width: 20, height: 20 },
      [{ name: 'top', x: 10, y: 0, extra: 'ignored' }]
    )
    expect(json.ports).toEqual([{ name: 'top', x: 10, y: 0 }])
  })

  it('без портов поле ports отсутствует', () => {
    const json = buildStencilJson(
      { id: 'cell_x', label: 'X', category: 'Прочее', width: 20, height: 20 },
      []
    )
    expect(json.ports).toBeUndefined()
  })

  it('пишет декл-флаги (noRotate/quality) когда включены, иначе опускает', () => {
    const base = { id: 'cell_x', label: 'X', category: 'Прочее', width: 20, height: 20 }
    const on = buildStencilJson({ ...base, noRotate: true, quality: true }, [])
    expect(on).toMatchObject({ noRotate: true, quality: true })
    const off = buildStencilJson({ ...base, noRotate: false, quality: false }, [])
    expect(off.noRotate).toBeUndefined()
    expect(off.quality).toBeUndefined()
  })
})

describe('stencilDraftIssues', () => {
  const ok = { id: 'cell_x', label: 'X', category: 'Прочее', width: 20, height: 20 }
  const shape = [{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }]

  it('валидный черновик — без проблем', () => {
    expect(stencilDraftIssues(ok, shape, ['cell_a'])).toEqual([])
  })

  it('ловит пустой id', () => {
    expect(stencilDraftIssues({ ...ok, id: '' }, shape)).toContain('Укажите id')
  })

  it('ловит недопустимые символы в id', () => {
    const issues = stencilDraftIssues({ ...ok, id: 'Cell-X' }, shape)
    expect(issues.some((i) => i.includes('id:'))).toBe(true)
  })

  it('ловит занятый id', () => {
    expect(stencilDraftIssues(ok, shape, ['cell_x'])).toContain('id «cell_x» уже занят')
  })

  it('требует название и категорию', () => {
    const issues = stencilDraftIssues({ ...ok, label: ' ', category: '' }, shape)
    expect(issues).toContain('Укажите название')
    expect(issues).toContain('Укажите категорию')
  })

  it('требует хотя бы одну фигуру', () => {
    expect(stencilDraftIssues(ok, [])).toContain('Добавьте хотя бы одну фигуру')
  })

  it('требует размеры кратные 10', () => {
    const issues = stencilDraftIssues({ ...ok, width: 25, height: 0 }, shape)
    expect(issues).toContain('Ширина кратна 10')
    expect(issues).toContain('Высота кратна 10')
  })
})

describe('внутренняя анимация (state)', () => {
  const shapes = [
    { type: 'line', x1: 10, y1: 12, x2: 10, y2: 28, stroke: '#000', strokeWidth: 2, state: 'true' },
    { type: 'line', x1: 10, y1: 28, x2: 0, y2: 16, stroke: '#000', strokeWidth: 2, state: 'false' },
    { type: 'circle', cx: 10, cy: 28, r: 2, stroke: '#000', strokeWidth: 2, fill: 'none' },
  ]
  const meta = {
    width: 20,
    height: 40,
    stateful: true,
    stateSlot: { key: 'onoff', label: 'Рычаг' },
  }

  it('serializeSvg группирует true/false в <g data-anim-suffix>, статику — в базовую', () => {
    const svg = serializeSvg(shapes, meta)
    expect(svg).toContain('<g data-anim-suffix=".true">')
    expect(svg).toContain('<g data-anim-suffix=".false">')
    // circle без state попал в базовую группу (без суффикса)
    expect(svg).toMatch(/<g>\s*<circle/)
  })

  it('serializeSvg игнорирует state, когда stateful выключен (одна группа, без суффикса)', () => {
    const svg = serializeSvg(shapes, { width: 20, height: 40 })
    expect(svg).not.toContain('data-anim-suffix')
  })

  it('пустые true/false группы не эмитятся', () => {
    const svg = serializeSvg([{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }], {
      width: 10,
      height: 10,
      stateful: true,
    })
    expect(svg).not.toContain('data-anim-suffix')
  })

  it('parseStencilSvg читает .true/.false → state, round-trip сохраняет', () => {
    const svg = serializeSvg(shapes, meta)
    const parsed = parseStencilSvg(svg)
    expect(parsed.find((s) => s.state === 'true')).toBeTruthy()
    expect(parsed.find((s) => s.state === 'false')).toBeTruthy()
    // статика — без поля state
    expect(parsed.find((s) => s.type === 'circle').state).toBeUndefined()
  })

  it('buildStencilJson эмитит slot + animationTemplate при stateful и наличии true/false', () => {
    const json = buildStencilJson(
      { id: 'cell_x', label: 'X', category: 'C', width: 20, height: 40, ...meta },
      [],
      shapes
    )
    expect(json.slots).toEqual([{ key: 'onoff', type: 'Boolean' }])
    expect(json.animationTemplate).toHaveLength(2)
    const onTrue = json.animationTemplate.find((t) => t.idSuffix === '.true')
    expect(onTrue.bindings[0].tag).toBe('{slot.onoff}')
    expect(onTrue.bindings[0].when.cases.false.apply.addClass).toBe('animation-hidden')
    const onFalse = json.animationTemplate.find((t) => t.idSuffix === '.false')
    expect(onFalse.bindings[0].when.cases.true.apply.addClass).toBe('animation-hidden')
  })

  it('buildStencilJson не эмитит анимацию, если stateful выключен или нет true/false', () => {
    const base = { id: 'cell_x', label: 'X', category: 'C', width: 20, height: 20 }
    const staticShapes = [{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }]
    const offToggle = buildStencilJson({ ...base, stateful: false }, [], shapes)
    expect(offToggle.slots).toBeUndefined()
    expect(offToggle.animationTemplate).toBeUndefined()
    const noStates = buildStencilJson(
      { ...base, stateful: true, stateSlot: { key: 'state', label: 'X' } },
      [],
      staticShapes
    )
    expect(noStates.slots).toBeUndefined()
  })

  it('эмитит только используемые состояния (одно из двух)', () => {
    const json = buildStencilJson(
      { id: 'cell_x', label: 'X', category: 'C', width: 20, height: 20, ...meta },
      [],
      [shapes[0]] // только true
    )
    expect(json.animationTemplate).toHaveLength(1)
    expect(json.animationTemplate[0].idSuffix).toBe('.true')
  })
})

describe('внутренняя анимация по значению (stateMode=value)', () => {
  const shapes = [
    { type: 'line', x1: 10, y1: 12, x2: 10, y2: 28, stroke: '#000', strokeWidth: 2, state: 'on' },
    { type: 'line', x1: 0, y1: 20, x2: 20, y2: 20, stroke: '#000', strokeWidth: 2, state: 'off' },
    { type: 'circle', cx: 10, cy: 20, r: 2, stroke: '#000', strokeWidth: 2, fill: 'none' },
  ]
  const meta = {
    width: 20,
    height: 40,
    stateful: true,
    stateMode: 'value',
    stateSlot: { key: 'value' },
    states: [
      { key: 'on', label: 'Включен', code: '01' },
      { key: 'off', label: 'Отключен', code: '10' },
    ],
  }

  it('serializeSvg группирует по ключам состояний (.on/.off), статику — в базовую', () => {
    const svg = serializeSvg(shapes, meta)
    expect(svg).toContain('<g data-anim-suffix=".on">')
    expect(svg).toContain('<g data-anim-suffix=".off">')
    expect(svg).toMatch(/<g>\s*<circle/)
  })

  it('parseStencilSvg читает произвольный суффикс → state (round-trip)', () => {
    const parsed = parseStencilSvg(serializeSvg(shapes, meta))
    expect(parsed.find((s) => s.state === 'on')).toBeTruthy()
    expect(parsed.find((s) => s.state === 'off')).toBeTruthy()
    expect(parsed.find((s) => s.type === 'circle').state).toBeUndefined()
  })

  it('buildStencilJson: слот value + states + карточка на состояние, прячется на чужих кодах', () => {
    const json = buildStencilJson(
      { id: 'cell_x', label: 'X', category: 'C', width: 20, height: 40, ...meta },
      [],
      shapes
    )
    expect(json.slots).toEqual([{ key: 'value', type: 'Value' }])
    expect(json.states).toEqual([
      { key: 'on', label: 'Включен', code: '01' },
      { key: 'off', label: 'Отключен', code: '10' },
    ])
    expect(json.animationTemplate).toHaveLength(2)
    const on = json.animationTemplate.find((t) => t.idSuffix === '.on')
    expect(on.bindings[0].tag).toBe('{slot.value}')
    // .on прячется на коде «отключено» (10), а на своём (01) — нет.
    expect(on.bindings[0].when.cases['10'].apply.addClass).toBe('animation-hidden')
    expect(on.bindings[0].when.cases['01']).toBeUndefined()
  })

  it('states пишется даже без фигур, но animationTemplate — только при наличии фигур', () => {
    const json = buildStencilJson(
      { id: 'cell_x', label: 'X', category: 'C', width: 20, height: 40, ...meta },
      [],
      [] // фигур нет
    )
    expect(json.slots).toEqual([{ key: 'value', type: 'Value' }])
    expect(json.states).toHaveLength(2)
    expect(json.animationTemplate).toBeUndefined()
  })
})

describe('stateColors (перекрас символа по состоянию)', () => {
  const shapes = [
    { type: 'line', x1: 10, y1: 12, x2: 10, y2: 28, stroke: '#000', strokeWidth: 2, state: 'on' },
    { type: 'line', x1: 0, y1: 20, x2: 20, y2: 20, stroke: '#000', strokeWidth: 2, state: 'off' },
  ]
  const valueMeta = {
    id: 'cell_x',
    label: 'X',
    category: 'C',
    width: 20,
    height: 40,
    stateful: true,
    stateMode: 'value',
    stateSlot: { key: 'value' },
    states: [
      { key: 'on', label: 'Включен', code: '01' },
      { key: 'off', label: 'Отключен', code: '10' },
    ],
  }

  it('value: пишет непустые цвета объявленных состояний', () => {
    const json = buildStencilJson({ ...valueMeta, stateColors: { off: '#64748b' } }, [], shapes)
    expect(json.stateColors).toEqual({ off: '#64748b' })
  })

  it('boolean: пишет цвет по ключам true/false', () => {
    const boolShapes = [{ type: 'rect', x: 0, y: 0, w: 10, h: 10, state: 'false' }]
    const json = buildStencilJson(
      {
        id: 'cell_b',
        label: 'B',
        category: 'C',
        width: 10,
        height: 10,
        stateful: true,
        stateMode: 'boolean',
        stateSlot: { key: 'onoff' },
        stateColors: { false: '#64748b' },
      },
      [],
      boolShapes
    )
    expect(json.stateColors).toEqual({ false: '#64748b' })
  })

  it('пусто / нет цветов → поле не пишется', () => {
    const json = buildStencilJson({ ...valueMeta, stateColors: {} }, [], shapes)
    expect(json.stateColors).toBeUndefined()
    const json2 = buildStencilJson({ ...valueMeta }, [], shapes)
    expect(json2.stateColors).toBeUndefined()
  })

  it('игнорит цвет для несуществующего состояния', () => {
    const json = buildStencilJson({ ...valueMeta, stateColors: { ghost: '#fff' } }, [], shapes)
    expect(json.stateColors).toBeUndefined()
  })

  // Заливаемая фигура (rect с fill) — заливка по состоянию имеет смысл.
  const fillShapes = [{ type: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#000', state: 'on' }]

  it('stroke+fill → объект { stroke, fill } при наличии заливаемой фигуры', () => {
    const json = buildStencilJson(
      { ...valueMeta, stateColors: { on: { stroke: '#111', fill: '#222' } } },
      [],
      fillShapes
    )
    expect(json.stateColors).toEqual({ on: { stroke: '#111', fill: '#222' } })
  })

  it('только fill → объект { fill }', () => {
    const json = buildStencilJson(
      { ...valueMeta, stateColors: { on: { fill: '#222' } } },
      [],
      fillShapes
    )
    expect(json.stateColors).toEqual({ on: { fill: '#222' } })
  })

  it('только stroke → компактная строка (legacy-форма)', () => {
    const json = buildStencilJson(
      { ...valueMeta, stateColors: { on: { stroke: '#111' } } },
      [],
      fillShapes
    )
    expect(json.stateColors).toEqual({ on: '#111' })
  })

  it('контурный круг (fill=none) считается заливаемым → fill пишется', () => {
    const contourCircle = [{ type: 'circle', cx: 10, cy: 10, r: 9, fill: 'none', state: 'on' }]
    const json = buildStencilJson(
      { ...valueMeta, stateColors: { on: { fill: '#222' } } },
      [],
      contourCircle
    )
    expect(json.stateColors).toEqual({ on: { fill: '#222' } })
  })

  it('fill отбрасывается, если в стенсиле нет заливаемых фигур', () => {
    // shapes — только линии (fill некуда применить) → остаётся лишь stroke-строка.
    const json = buildStencilJson(
      { ...valueMeta, stateColors: { on: { stroke: '#111', fill: '#222' } } },
      [],
      shapes
    )
    expect(json.stateColors).toEqual({ on: '#111' })
  })
})

describe('cropToContent', () => {
  it('обрезает поля и сдвигает контент в (0,0)', () => {
    const { shapes, width, height } = cropToContent(
      [{ type: 'rect', x: 10, y: 10, w: 20, h: 20 }],
      []
    )
    expect(width).toBe(20)
    expect(height).toBe(20)
    expect(shapes[0]).toMatchObject({ x: 0, y: 0, w: 20, h: 20 })
  })

  it('границы расширяет до кратных grid (min вниз, max вверх)', () => {
    // контент 5..25 → бокс 0..30 (ширина 30), фигура не сдвигается (dx=0)
    const { shapes, width } = cropToContent([{ type: 'rect', x: 5, y: 5, w: 20, h: 20 }], [])
    expect(width).toBe(30)
    expect(shapes[0]).toMatchObject({ x: 5, y: 5 })
  })

  it('учитывает порты в bbox и сдвигает их', () => {
    const { ports, width } = cropToContent(
      [{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }],
      [{ id: 'p1', name: 'p1', x: 30, y: 0 }]
    )
    expect(width).toBe(30) // порт на x=30 расширяет бокс
    expect(ports[0]).toMatchObject({ x: 30, y: 0 })
  })

  it('circle: bbox по радиусу', () => {
    const { width, height, shapes } = cropToContent([{ type: 'circle', cx: 20, cy: 20, r: 8 }], [])
    // bbox 12..28 → 10..30 → 20×20; центр сдвигается на -10
    expect(width).toBe(20)
    expect(height).toBe(20)
    expect(shapes[0]).toMatchObject({ cx: 10, cy: 10, r: 8 })
  })

  it('пустой ввод → нулевой размер', () => {
    expect(cropToContent([], [])).toMatchObject({ width: 0, height: 0 })
  })
})

describe('parseStencilSvg (инверсия serializeSvg)', () => {
  it('round-trip: serialize → parse возвращает те же фигуры', () => {
    const shapes = [
      { type: 'rect', x: 0, y: 0, w: 20, h: 20, stroke: '#000', strokeWidth: 2, fill: 'none' },
      { type: 'line', x1: 5, y1: 10, x2: 15, y2: 10, stroke: '#000', strokeWidth: 2 },
      { type: 'circle', cx: 10, cy: 10, r: 8, stroke: '#000', strokeWidth: 2, fill: 'none' },
      {
        type: 'polyline',
        points: [
          [0, 0],
          [10, 10],
          [20, 0],
        ],
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
      },
    ]
    const svg = serializeSvg(shapes, { width: 20, height: 20 })
    expect(parseStencilSvg(svg)).toEqual(shapes)
  })

  it('читает нестандартные stroke/fill/width', () => {
    const svg = serializeSvg(
      [{ type: 'rect', x: 0, y: 0, w: 10, h: 10, stroke: '#f00', strokeWidth: 4, fill: '#eee' }],
      { width: 10, height: 10 }
    )
    expect(parseStencilSvg(svg)[0]).toMatchObject({ stroke: '#f00', strokeWidth: 4, fill: '#eee' })
  })

  it('пустой/битый ввод → []', () => {
    expect(parseStencilSvg('')).toEqual([])
    expect(parseStencilSvg(null)).toEqual([])
  })

  it('serializeSvg оборачивает фигуры в <g>', () => {
    const svg = serializeSvg([{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }], {
      width: 10,
      height: 10,
    })
    expect(svg).toMatch(/<g>[\s\S]*<rect[\s\S]*<\/g>/)
  })

  it('рекурсит в <g> — читает фигуры внутри группы (формат рукописных стенсилов)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 40">' +
      '<g><line x1="10" y1="0" x2="10" y2="6" stroke="#000" stroke-width="2"/>' +
      '<circle cx="10" cy="14" r="8" fill="none" stroke="#000" stroke-width="2"/></g></svg>'
    const shapes = parseStencilSvg(svg)
    expect(shapes.map((s) => s.type)).toEqual(['line', 'circle'])
  })

  it('игнорирует незнакомые элементы (path/text) внутри группы', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
      '<g data-anim-suffix=".X"><path d="M0 0"/>' +
      '<rect x="0" y="0" width="10" height="10"/></g><text>Wh</text></svg>'
    const shapes = parseStencilSvg(svg)
    expect(shapes).toHaveLength(1)
    expect(shapes[0].type).toBe('rect')
  })

  it('замкнутая ломаная сериализуется в <polygon>', () => {
    const svg = serializeSvg(
      [
        {
          type: 'polyline',
          closed: true,
          points: [
            [0, 0],
            [10, 0],
            [5, 10],
          ],
        },
      ],
      { width: 10, height: 10 }
    )
    expect(svg).toContain('<polygon points="0,0 10,0 5,10"')
    expect(svg).not.toContain('<polyline')
  })

  it('<polygon> парсится в замкнутую ломаную (closed) и round-trip сохраняет флаг', () => {
    const shape = {
      type: 'polyline',
      closed: true,
      points: [
        [0, 0],
        [10, 0],
        [5, 10],
      ],
      stroke: '#000',
      strokeWidth: 2,
      fill: 'none',
    }
    const svg = serializeSvg([shape], { width: 10, height: 10 })
    expect(parseStencilSvg(svg)).toEqual([shape])
  })
})

describe('скругление (rounded)', () => {
  it('rect rounded → rx, round-trip сохраняет', () => {
    const shape = {
      type: 'rect',
      x: 0,
      y: 0,
      w: 20,
      h: 20,
      fill: 'none',
      stroke: '#000',
      strokeWidth: 2,
      rounded: true,
    }
    const svg = serializeSvg([shape], { width: 20, height: 20 })
    expect(svg).toContain('rx="2"')
    expect(parseStencilSvg(svg)).toEqual([shape])
  })

  it('line rounded → stroke-linecap=round, round-trip сохраняет', () => {
    const shape = {
      type: 'line',
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 0,
      stroke: '#000',
      strokeWidth: 2,
      rounded: true,
    }
    const svg = serializeSvg([shape], { width: 10, height: 10 })
    expect(svg).toContain('stroke-linecap="round"')
    expect(parseStencilSvg(svg)).toEqual([shape])
  })

  it('без rounded — атрибутов скругления нет', () => {
    const svg = serializeSvg([{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }], {
      width: 10,
      height: 10,
    })
    expect(svg).not.toContain('rx=')
    expect(svg).not.toContain('stroke-linecap')
  })
})
