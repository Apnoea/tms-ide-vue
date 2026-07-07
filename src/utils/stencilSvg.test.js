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

  it('пишет декл-флаги (noRotate/layoutOnly/quality) когда включены, иначе опускает', () => {
    const base = { id: 'cell_x', label: 'X', category: 'Прочее', width: 20, height: 20 }
    const on = buildStencilJson({ ...base, noRotate: true, layoutOnly: true, quality: true }, [])
    expect(on).toMatchObject({ noRotate: true, layoutOnly: true, quality: true })
    const off = buildStencilJson(
      { ...base, noRotate: false, layoutOnly: false, quality: false },
      []
    )
    expect(off.noRotate).toBeUndefined()
    expect(off.layoutOnly).toBeUndefined()
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
