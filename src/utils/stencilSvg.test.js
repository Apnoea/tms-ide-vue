// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  serializeSvg,
  buildStencilJson,
  stencilDraftIssues,
  cropToContent,
  parseStencilSvg,
  shapeBounds,
  shapesBounds,
  rotateShape90,
  flipShape,
  canRotateShapes,
  canFlipShapes,
  serializeShape,
  textLines,
  TEXT_SHAPE_SIZE,
  TEXT_LINE_HEIGHT,
} from './stencilSvg'

describe('serializeSvg', () => {
  it('оборачивает фигуры в svg с viewBox из meta, без XML-декларации', () => {
    const svg = serializeSvg([], { width: 40, height: 20 })
    // Декларации быть НЕ должно: файл под git пишут два пути (редактор и импорт .zip),
    // а второй теряет её на sanitizeSvgMarkup — иначе дифф «дышит» туда-сюда.
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).not.toContain('<?xml')
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

  it('НЕ-stateful символ — без class tms-state-fill даже у заливаемых фигур', () => {
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

  it('равные радиусы дают <circle>, разные — <ellipse>', () => {
    // Круг — частный случай эллипса, но тег прежний: уже выгруженные shape.svg и
    // рукописные символы не должны переписываться при пересохранении.
    const box = { width: 20, height: 20 }
    expect(serializeSvg([{ type: 'circle', cx: 10, cy: 10, rx: 8, ry: 8 }], box)).toContain(
      '<circle cx="10" cy="10" r="8"'
    )
    expect(serializeSvg([{ type: 'circle', cx: 10, cy: 10, rx: 9, ry: 4 }], box)).toContain(
      '<ellipse cx="10" cy="10" rx="9" ry="4"'
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

  it('text — подпись с anchor=middle, цвет в fill, без обводки', () => {
    // Обводки у текста нет: stroke дал бы контур вокруг глифов, поэтому цвет
    // модели (`stroke`) уходит в fill.
    const svg = serializeSvg(
      [{ type: 'text', x: 20, y: 28, text: 'Wh', fontSize: 12, bold: true, stroke: '#333' }],
      { width: 40, height: 40 }
    )
    expect(svg).toContain('<text x="20" y="28" text-anchor="middle"')
    expect(svg).toContain('font-size="12" font-family="sans-serif" font-weight="bold"')
    expect(svg).toContain('fill="#333">Wh</text>')
    expect(svg.match(/<text[^>]*stroke=/)).toBeNull()
  })

  it('text — шрифт из whitelist уходит в SVG, чужой падает в дефолт', () => {
    const shape = (fontFamily) => [{ type: 'text', x: 0, y: 10, text: 'Wh', fontFamily }]
    const box = { width: 20, height: 20 }
    expect(serializeSvg(shape('monospace'), box)).toContain('font-family="monospace"')
    // Значение приходит из чужого shape.svg — в выход попадает только наше семейство,
    // иначе замер (canvas) и рендер панели считали бы разными шрифтами.
    expect(serializeSvg(shape('Comic Sans MS'), box)).toContain('font-family="sans-serif"')
  })

  it('text — содержимое эскейпится (XML не должен ломаться)', () => {
    const svg = serializeSvg([{ type: 'text', x: 0, y: 10, text: 'A & B <c>' }], {
      width: 20,
      height: 20,
    })
    expect(svg).toContain('&amp;')
    expect(svg).not.toContain('<c>')
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

  it('области применения: непустые пишет, чужие отбрасывает, пустое поле не создаёт', () => {
    const base = { id: 'cell_x', label: 'X', category: 'Прочее', width: 20, height: 20 }
    expect(buildStencilJson({ ...base, domains: ['network', 'bogus'] }, []).domains).toEqual([
      'network',
    ])
    expect(buildStencilJson({ ...base, domains: [] }, []).domains).toBeUndefined()
    expect(buildStencilJson(base, []).domains).toBeUndefined()
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

  it('пишет декл-флаги (noRotate/noFlip/quality) когда включены, иначе опускает', () => {
    const base = { id: 'cell_x', label: 'X', category: 'Прочее', width: 20, height: 20 }
    const on = buildStencilJson({ ...base, noRotate: true, noFlip: true, quality: true }, [])
    expect(on).toMatchObject({ noRotate: true, noFlip: true, quality: true })
    const off = buildStencilJson({ ...base, noRotate: false, noFlip: false, quality: false }, [])
    expect(off.noRotate).toBeUndefined()
    expect(off.noFlip).toBeUndefined()
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

  it('требует размеры кратные 5 (минимум 10)', () => {
    const issues = stencilDraftIssues({ ...ok, width: 12, height: 0 }, shape)
    expect(issues).toContain('Ширина кратна 5')
    expect(issues).toContain('Высота кратна 5')
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

  it('подпись со state идёт в группу состояния и читается обратно', () => {
    // Видимость (`animation-hidden` = display:none на группе) работает и для
    // <text> — в отличие от перекраски, где текст исключён селектором.
    const withText = [
      { type: 'text', x: 10, y: 20, text: 'ВКЛ', state: 'true' },
      { type: 'text', x: 10, y: 30, text: 'ОТКЛ', state: 'false' },
    ]
    const svg = serializeSvg(withText, meta)
    expect(svg).toMatch(/<g data-anim-suffix="\.true">\s*<text[^>]*>ВКЛ</)
    expect(svg).toMatch(/<g data-anim-suffix="\.false">\s*<text[^>]*>ОТКЛ</)
    const back = parseStencilSvg(svg)
    expect(back.map((s) => [s.type, s.state])).toEqual([
      ['text', 'true'],
      ['text', 'false'],
    ])
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

  it('текст со значением тега → слот Text + карточка text и метка на самом <text>', () => {
    // Метка обязана стоять на <text>, а не на группе: рантайм пишет в textContent
    // найденного узла, а группа отвечает за видимость по состоянию.
    const base = { id: 'cell_x', label: 'X', category: 'C', width: 100, height: 20 }
    const withValue = [
      { type: 'rect', x: 0, y: 0, w: 100, h: 20 },
      { type: 'text', x: 50, y: 15, text: '--', valueText: true },
    ]
    const json = buildStencilJson(base, [], withValue)
    expect(json.slots).toEqual([{ key: 'value_text', type: 'Text' }])
    expect(json.animationTemplate).toHaveLength(1)
    const card = json.animationTemplate[0]
    expect(card.idSuffix).toBe('.value')
    expect(card.type).toBe('text')
    expect(card.bindings[0]).toEqual({ tag: '{slot.value_text}', output: { text: {} } })
    // Точность в шаблоне не пишется: она свойство привязки (tms ячейки).
    expect(card.bindings[0].output.decimals).toBeUndefined()

    const svg = serializeSvg(withValue, base)
    expect(svg).toContain('<text data-anim-suffix=".value" x="50"')
  })

  it('правимая подпись → params с текстом-образцом + метка на <text>', () => {
    const base = { id: 'cell_x', label: 'X', category: 'C', width: 100, height: 20 }
    const shapes = [
      { type: 'text', x: 10, y: 15, text: 'Ua', param: 'p1' },
      { type: 'text', x: 90, y: 15, text: 'В', param: 'p2' },
    ]
    const json = buildStencilJson(base, [], shapes)
    // Текст образца — и значение по умолчанию, и подпись поля в инспекторе холста.
    expect(json.params).toEqual([
      { key: 'p1', default: 'Ua' },
      { key: 'p2', default: 'В' },
    ])
    const svg = serializeSvg(shapes, base)
    expect(svg).toContain('<text data-tms-param="p1" x="10"')
    expect(parseStencilSvg(svg)[1].param).toBe('p2')
  })

  it('пустая по умолчанию подпись объявляется параметром и переживает round-trip', () => {
    // Единица величины по умолчанию пустая — её дописывает автор на холсте.
    const base = { id: 'cell_x', label: 'X', category: 'C', width: 100, height: 20 }
    const shapes = [{ type: 'text', x: 95, y: 15, text: '', param: 'p2' }]
    expect(buildStencilJson(base, [], shapes).params).toEqual([{ key: 'p2', default: '' }])
    expect(parseStencilSvg(serializeSvg(shapes, base))[0]).toMatchObject({ param: 'p2' })
  })

  it('чужой ключ параметра отбрасывается на обоих концах, дубль объявляется один раз', () => {
    const base = { id: 'cell_x', label: 'X', category: 'C', width: 100, height: 20 }
    const bad = [{ type: 'text', x: 10, y: 15, text: 'Ua', param: 'p 1' }]
    expect(buildStencilJson(base, [], bad).params).toBeUndefined()
    expect(serializeSvg(bad, base)).not.toContain('data-tms-param')

    const dup = [
      { type: 'text', x: 10, y: 15, text: 'Ua', param: 'p1' },
      { type: 'text', x: 90, y: 15, text: 'Ua', param: 'p1' },
    ]
    expect(buildStencilJson(base, [], dup).params).toEqual([{ key: 'p1', default: 'Ua' }])
  })

  it('текст без флага метку не получает, слота и карточки нет', () => {
    const base = { id: 'cell_x', label: 'X', category: 'C', width: 100, height: 20 }
    const plain = [{ type: 'text', x: 50, y: 15, text: 'Ua' }]
    const json = buildStencilJson(base, [], plain)
    expect(json.slots).toBeUndefined()
    expect(json.animationTemplate).toBeUndefined()
    expect(serializeSvg(plain, base)).not.toContain('data-anim-suffix')
  })

  it('значение и состояние в одном символе: два слота, карточки не перетирают друг друга', () => {
    // Слоты складываются — иначе выключатель не смог бы показывать ещё и ток.
    const both = [
      { type: 'rect', x: 0, y: 0, w: 20, h: 20, state: 'true' },
      { type: 'text', x: 10, y: 15, text: '--', valueText: true },
    ]
    const json = buildStencilJson(
      { id: 'cell_x', label: 'X', category: 'C', width: 20, height: 20, ...meta },
      [],
      both
    )
    expect(json.slots).toEqual([
      { key: 'value_text', type: 'Text' },
      { key: 'onoff', type: 'Boolean' },
    ])
    expect(json.animationTemplate.map((c) => c.idSuffix).sort()).toEqual(['.true', '.value'])
  })

  it('метка текста со значением читается обратно при разборе shape.svg', () => {
    const base = { id: 'cell_x', label: 'X', category: 'C', width: 100, height: 20 }
    const shapes = [{ type: 'text', x: 50, y: 15, text: '--', valueText: true }]
    const parsed = parseStencilSvg(serializeSvg(shapes, base))
    expect(parsed[0].valueText).toBe(true)
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

  it('fill отбрасывается, если в символе нет заливаемых фигур', () => {
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
  it('подпись входит в bbox — иначе обрезалась бы на сохранении', () => {
    // Габарит текста задаёт шрифт (без замера он не виден cropToContent), поэтому
    // подпись правее фигуры обязана расширить бокс.
    const withoutText = cropToContent([{ type: 'rect', x: 0, y: 0, w: 20, h: 20 }], [])
    const withText = cropToContent(
      [
        { type: 'rect', x: 0, y: 0, w: 20, h: 20 },
        { type: 'text', x: 60, y: 15, text: 'Wh', fontSize: 12 },
      ],
      []
    )
    expect(withText.width).toBeGreaterThan(withoutText.width)
  })

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

// Общий габарит фигуры: на нём стоят и обрезка холста, и хит-тест лассо —
// разойдутся, и рамка начнёт ловить не то, что попадёт в границы символа.
describe('shapeBounds', () => {
  it('rect / circle / line / polyline', () => {
    expect(shapeBounds({ type: 'rect', x: 5, y: 6, w: 10, h: 4 })).toEqual({
      x: 5,
      y: 6,
      w: 10,
      h: 4,
    })
    expect(shapeBounds({ type: 'circle', cx: 20, cy: 20, r: 8 })).toEqual({
      x: 12,
      y: 12,
      w: 16,
      h: 16,
    })
    // Линия «справа налево»: габарит нормализован, отрицательной ширины не бывает.
    expect(shapeBounds({ type: 'line', x1: 30, y1: 10, x2: 10, y2: 20 })).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 10,
    })
    expect(
      shapeBounds({
        type: 'polyline',
        points: [
          [4, 8],
          [20, 2],
          [10, 12],
        ],
      })
    ).toEqual({ x: 4, y: 2, w: 16, h: 10 })
  })

  it('эллипс — габарит по разным полуосям', () => {
    expect(shapeBounds({ type: 'circle', cx: 20, cy: 20, rx: 10, ry: 4 })).toEqual({
      x: 10,
      y: 16,
      w: 20,
      h: 8,
    })
  })

  it('подпись — по замеренному габариту (не нулевой)', () => {
    const b = shapeBounds({ type: 'text', x: 10, y: 10, text: 'Wh', fontSize: 10 })
    expect(b.w).toBeGreaterThan(0)
    expect(b.h).toBeGreaterThan(0)
  })

  it('без габарита (нет фигуры / ломаная без вершин) → null', () => {
    expect(shapeBounds(null)).toBeNull()
    expect(shapeBounds({ type: 'polyline', points: [] })).toBeNull()
  })
})

describe('shapesBounds', () => {
  it('объединяет габариты фигур и портов', () => {
    const b = shapesBounds(
      [
        { type: 'rect', x: 10, y: 10, w: 10, h: 10 },
        { type: 'line', x1: 30, y1: 5, x2: 40, y2: 5 },
      ],
      [{ x: 0, y: 25 }]
    )
    expect(b).toEqual({ x: 0, y: 5, w: 40, h: 20 })
  })

  it('пусто (нет фигур / только фигуры без габарита) → null', () => {
    expect(shapesBounds([])).toBeNull()
    expect(shapesBounds([{ type: 'polyline', points: [] }])).toBeNull()
  })
})

describe('rotateShape90 / flipShape', () => {
  const center = { x: 20, y: 20 }

  it('поворот прямоугольника меняет стороны местами вокруг центра', () => {
    const r = rotateShape90({ type: 'rect', x: 10, y: 15, w: 20, h: 10 }, center, 1)
    expect(r).toMatchObject({ x: 15, y: 10, w: 10, h: 20 })
  })

  it('поворот по и против часовой — взаимно обратны', () => {
    const line = { type: 'line', x1: 5, y1: 8, x2: 25, y2: 30 }
    const back = rotateShape90(rotateShape90(line, center, 1), center, -1)
    expect(back).toMatchObject(line)
  })

  it('по часовой в экранных осях: точка справа от центра уходит вниз', () => {
    const p = rotateShape90({ type: 'circle', cx: 30, cy: 20, r: 4 }, center, 1)
    expect(p).toMatchObject({ cx: 20, cy: 30 })
  })

  it('поворот эллипса меняет полуоси', () => {
    const e = rotateShape90({ type: 'circle', cx: 20, cy: 20, rx: 10, ry: 4 }, center, 1)
    expect(e).toMatchObject({ cx: 20, cy: 20, rx: 4, ry: 10 })
  })

  it('отражение по горизонтали зеркалит вершины ломаной', () => {
    const f = flipShape(
      {
        type: 'polyline',
        points: [
          [10, 10],
          [30, 25],
        ],
      },
      center,
      'h'
    )
    expect(f.points).toEqual([
      [30, 10],
      [10, 25],
    ])
  })

  it('отражение дважды возвращает исходное', () => {
    const rect = { type: 'rect', x: 12, y: 14, w: 16, h: 8 }
    expect(flipShape(flipShape(rect, center, 'v'), center, 'v')).toMatchObject(rect)
  })

  it('у подписи горизонтальное отражение инвертирует якорь, вертикальное — нет', () => {
    const text = { type: 'text', x: 10, y: 20, text: 'Wh', align: 'left' }
    expect(flipShape(text, center, 'h')).toMatchObject({ x: 30, align: 'right' })
    expect(flipShape(text, center, 'v')).toMatchObject({ x: 10, align: 'left' })
  })
})

describe('canRotateShapes / canFlipShapes (доступность операции)', () => {
  it('круг: ни поворота, ни отражения — он симметричен', () => {
    const circle = [{ type: 'circle', cx: 20, cy: 20, r: 10 }]
    expect(canRotateShapes(circle)).toBe(false)
    expect(canFlipShapes(circle, 'h')).toBe(false)
    expect(canFlipShapes(circle, 'v')).toBe(false)
  })

  it('эллипс: поворот меняет полуоси, отражение — нет', () => {
    const ellipse = [{ type: 'circle', cx: 20, cy: 20, rx: 10, ry: 4 }]
    expect(canRotateShapes(ellipse)).toBe(true)
    expect(canFlipShapes(ellipse, 'h')).toBe(false)
  })

  it('квадрат: ничего не даёт; прямоугольник: только поворот', () => {
    expect(canRotateShapes([{ type: 'rect', x: 5, y: 5, w: 10, h: 10 }])).toBe(false)
    const rect = [{ type: 'rect', x: 5, y: 5, w: 20, h: 10 }]
    expect(canRotateShapes(rect)).toBe(true)
    expect(canFlipShapes(rect, 'h')).toBe(false)
    expect(canFlipShapes(rect, 'v')).toBe(false)
  })

  it('линия: поворот всегда, отражение — только у наклонной', () => {
    const horizontal = [{ type: 'line', x1: 10, y1: 10, x2: 30, y2: 10 }]
    expect(canRotateShapes(horizontal)).toBe(true)
    // Отражение горизонтальной линии лишь меняет концы местами — рисуется то же.
    expect(canFlipShapes(horizontal, 'h')).toBe(false)
    expect(canFlipShapes(horizontal, 'v')).toBe(false)
    const diagonal = [{ type: 'line', x1: 10, y1: 10, x2: 30, y2: 25 }]
    expect(canFlipShapes(diagonal, 'h')).toBe(true)
  })

  it('ломаная: симметричная не отражается, «уголок» отражается', () => {
    const symmetric = [
      {
        type: 'polyline',
        points: [
          [10, 10],
          [20, 20],
          [30, 10],
        ],
      },
    ]
    expect(canFlipShapes(symmetric, 'h')).toBe(false)
    expect(canFlipShapes(symmetric, 'v')).toBe(true)
    const corner = [
      {
        type: 'polyline',
        points: [
          [10, 10],
          [30, 10],
          [30, 20],
        ],
      },
    ]
    expect(canFlipShapes(corner, 'h')).toBe(true)
  })

  it('одиночная подпись: ни поворота, ни отражения при любом якоре', () => {
    const centered = [{ type: 'text', x: 10, y: 10, text: 'Wh' }]
    expect(canRotateShapes(centered)).toBe(false)
    expect(canFlipShapes(centered, 'h')).toBe(false)
    // Якорь роста правится полем `align`, зеркалить подпись незачем.
    const anchored = [{ type: 'text', x: 10, y: 10, text: 'Wh', align: 'left' }]
    expect(canFlipShapes(anchored, 'h')).toBe(false)
    expect(canFlipShapes(anchored, 'v')).toBe(false)
  })

  it('пачка: доступно, пока меняется взаимное расположение', () => {
    const twoCircles = [
      { type: 'circle', cx: 10, cy: 10, r: 5 },
      { type: 'circle', cx: 30, cy: 10, r: 5 },
    ]
    // По отдельности круги симметричны, но пара из горизонтальной становится
    // вертикальной / меняется местами.
    expect(canRotateShapes(twoCircles)).toBe(true)
    expect(canFlipShapes(twoCircles, 'h')).toBe(true)
    // Вертикальная ось пару на одной высоте не двигает.
    expect(canFlipShapes(twoCircles, 'v')).toBe(false)
  })

  it('пустое выделение — операций нет', () => {
    expect(canRotateShapes([])).toBe(false)
    expect(canFlipShapes(undefined, 'h')).toBe(false)
  })
})

describe('многострочная подпись', () => {
  const multi = { type: 'text', x: 10, y: 20, text: 'Ввод 110\nячейка 12', fontSize: 10 }

  it('строки режутся по \\n, пустая строка внутри значима', () => {
    expect(textLines(multi)).toEqual(['Ввод 110', 'ячейка 12'])
    expect(textLines({ text: 'A\n\nB' })).toEqual(['A', '', 'B'])
    expect(textLines({})).toEqual([''])
  })

  it('одна строка — прежняя разметка без tspan', () => {
    const svg = serializeShape({ type: 'text', x: 10, y: 20, text: 'Ввод' })
    expect(svg).toContain('>Ввод</text>')
    expect(svg).not.toContain('tspan')
  })

  it('несколько строк — tspan на строку, у первой dy=0', () => {
    const svg = serializeShape(multi)
    expect(svg).toContain('<tspan x="10" dy="0">Ввод 110</tspan>')
    expect(svg).toContain(`<tspan x="10" dy="${10 * TEXT_LINE_HEIGHT}">ячейка 12</tspan>`)
  })

  it('габарит растёт вниз: y как у одной строки, высота по числу строк', () => {
    const one = shapeBounds({ type: 'text', x: 10, y: 20, text: 'Ввод 110', fontSize: 10 })
    const two = shapeBounds(multi)
    expect(two.y).toBe(one.y)
    expect(two.h).toBeCloseTo(one.h + 10 * TEXT_LINE_HEIGHT)
    // Ширина — по самой длинной строке, а не по их сумме.
    expect(two.w).toBeGreaterThanOrEqual(one.w)
  })

  it('round-trip: выравнивание читается из text-anchor', () => {
    const shape = { type: 'text', x: 10, y: 20, text: 'Ввод', align: 'left' }
    const svg = serializeSvg([{ ...shape, stroke: '#000', strokeWidth: 2, fill: 'none' }], {
      width: 40,
      height: 20,
    })
    expect(svg).toContain('text-anchor="start"')
    expect(parseStencilSvg(svg)[0].align).toBe('left')
  })

  it('round-trip: tspan-строки читаются обратно в text с \\n', () => {
    const svg = serializeSvg([{ ...multi, stroke: '#000', strokeWidth: 2, fill: 'none' }], {
      width: 60,
      height: 40,
    })
    expect(parseStencilSvg(svg)[0].text).toBe('Ввод 110\nячейка 12')
  })
})

describe('parseStencilSvg (инверсия serializeSvg)', () => {
  it('round-trip: serialize → parse возвращает те же фигуры', () => {
    const shapes = [
      { type: 'rect', x: 0, y: 0, w: 20, h: 20, stroke: '#000', strokeWidth: 2, fill: 'none' },
      { type: 'line', x1: 5, y1: 10, x2: 15, y2: 10, stroke: '#000', strokeWidth: 2 },
      {
        type: 'circle',
        cx: 10,
        cy: 10,
        rx: 8,
        ry: 8,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
      },
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

  it('рекурсит в <g> — читает фигуры внутри группы (формат рукописных символов)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 40">' +
      '<g><line x1="10" y1="0" x2="10" y2="6" stroke="#000" stroke-width="2"/>' +
      '<circle cx="10" cy="14" r="8" fill="none" stroke="#000" stroke-width="2"/></g></svg>'
    const shapes = parseStencilSvg(svg)
    expect(shapes.map((s) => s.type)).toEqual(['line', 'circle'])
  })

  it('игнорирует незнакомые элементы (path) внутри группы', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
      '<g data-anim-suffix=".X"><path d="M0 0"/>' +
      '<rect x="0" y="0" width="10" height="10"/></g></svg>'
    const shapes = parseStencilSvg(svg)
    expect(shapes).toHaveLength(1)
    expect(shapes[0].type).toBe('rect')
  })

  it('символ с подписью переживает round-trip parse → serialize → parse', () => {
    // Случай cell_pi: корпус + надпись. После правки в редакторе подпись обязана
    // вернуться той же — иначе символ терял бы обозначение.
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g>' +
      '<rect x="5" y="6" width="30" height="28" fill="none" stroke="#000" stroke-width="2"/>' +
      '<text x="20" y="28" text-anchor="middle" font-size="12" font-family="sans-serif" ' +
      'font-weight="bold" fill="#000">Wh</text></g></svg>'
    const first = parseStencilSvg(src)
    const again = parseStencilSvg(serializeSvg(first, { width: 40, height: 40 }))
    expect(again).toHaveLength(2)
    expect(again.find((s) => s.type === 'text')).toMatchObject({
      x: 20,
      y: 28,
      text: 'Wh',
      fontSize: 12,
      bold: true,
    })
    expect(again.find((s) => s.type === 'rect')).toMatchObject({ x: 5, y: 6, w: 30, h: 28 })
  })

  it('<ellipse> читается как circle с разными радиусами, <circle> — с равными', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<ellipse cx="10" cy="10" rx="9" ry="4" fill="none" stroke="#000" stroke-width="2"/>' +
      '<circle cx="30" cy="10" r="6" fill="none" stroke="#000" stroke-width="2"/></svg>'
    expect(parseStencilSvg(svg)).toEqual([
      {
        type: 'circle',
        cx: 10,
        cy: 10,
        rx: 9,
        ry: 4,
        fill: 'none',
        stroke: '#000',
        strokeWidth: 2,
      },
      {
        type: 'circle',
        cx: 30,
        cy: 10,
        rx: 6,
        ry: 6,
        fill: 'none',
        stroke: '#000',
        strokeWidth: 2,
      },
    ])
  })

  it('разбирает <text> в подпись (цвет из fill, bold по font-weight)', () => {
    // Рукописные символы вроде cell_pi держат надпись текстом — редактор обязан
    // прочитать её обратно, иначе правка символа теряла бы подпись.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<text x="20" y="28" text-anchor="middle" font-size="12" font-family="serif" ' +
      'font-weight="bold" fill="#333">Wh</text></svg>'
    const [shape] = parseStencilSvg(svg)
    expect(shape).toMatchObject({
      type: 'text',
      x: 20,
      y: 28,
      text: 'Wh',
      fontSize: 12,
      bold: true,
      stroke: '#333',
      fontFamily: 'serif',
    })
  })

  it('чужой font-family при разборе нормализуется в дефолт', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<text x="20" y="28" font-family="Comic Sans MS" fill="#000">Wh</text></svg>'
    expect(parseStencilSvg(svg)[0].fontFamily).toBe('sans-serif')
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

  it('фигура без обязательных размеров отбраковывается при разборе', () => {
    // shape.svg приходит из чужого .zip и рукописных символов: `<rect>` без
    // width дал бы `w: NaN`, и на сохранении символа в файл уехало бы
    // `width="NaN"` — символ ломается молча. Координаты по SVG-дефолту 0,
    // поэтому у них fallback, а не отбраковка.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
      <rect x="0" y="0" height="10" fill="none" stroke="#000" stroke-width="2"/>
      <circle cx="5" cy="5" fill="none" stroke="#000" stroke-width="2"/>
      <ellipse cx="5" cy="5" rx="4" fill="none" stroke="#000" stroke-width="2"/>
      <line y1="0" x2="10" y2="0" stroke="#000" stroke-width="2"/>
    </svg>`
    const parsed = parseStencilSvg(svg)
    // Осталась только линия — с x1 по дефолту 0.
    expect(parsed).toEqual([
      { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: '#000', strokeWidth: 2 },
    ])
  })

  it('нечисловой font-size подписи откатывается к дефолту', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
      <text x="10" y="10" font-size="huge" text-anchor="middle" fill="#000">ВКЛ</text>
    </svg>`
    expect(parseStencilSvg(svg)[0].fontSize).toBe(TEXT_SHAPE_SIZE)
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

describe('выравнивание подписи (якорь роста)', () => {
  const text = { type: 'text', x: 100, y: 50, text: 'Подпись', fontSize: 14 }

  it('без align — дефолтный middle', () => {
    expect(serializeSvg([text], { width: 200, height: 100 })).toContain('text-anchor="middle"')
    const box = shapeBounds(text)
    // Центр остаётся на точке привязки.
    expect(box.x + box.w / 2).toBeCloseTo(100)
  })

  it('align задаёт anchor и bbox: точка привязки на месте, текст растёт от неё', () => {
    const left = serializeSvg([{ ...text, align: 'left' }], { width: 200, height: 100 })
    expect(left).toContain('text-anchor="start"')
    expect(shapeBounds({ ...text, align: 'left' }).x).toBeCloseTo(100)

    const right = serializeSvg([{ ...text, align: 'right' }], { width: 200, height: 100 })
    expect(right).toContain('text-anchor="end"')
    const rBox = shapeBounds({ ...text, align: 'right' })
    expect(rBox.x + rBox.w).toBeCloseTo(100)
  })
})

describe('portSeq в stencil.json', () => {
  const meta = { id: 'cell_x', label: 'X', category: 'C', width: 20, height: 20 }

  it('нулевой счётчик не пишется: у рукописных имён портов он пустой', () => {
    // Иначе поле-ноль появлялось в json при каждом пересохранении такого символа.
    const json = buildStencilJson({ ...meta, portSeq: 0 }, [{ name: 'top', x: 10, y: 0 }])
    expect(json.ports).toHaveLength(1)
    expect(json.portSeq).toBeUndefined()
  })

  it('счётчик пишется, когда порты выдавал редактор (имена pN)', () => {
    const json = buildStencilJson({ ...meta, portSeq: 0 }, [{ name: 'p3', x: 10, y: 0 }])
    // Берём максимум из счётчика и фактических имён — имя p3 занято, следующее p4.
    expect(json.portSeq).toBe(3)
  })
})
